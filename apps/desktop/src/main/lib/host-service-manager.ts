import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { getProcessEnvWithShellPath } from "../../lib/trpc/routers/workspaces/utils/shell-env";
import { SUPERSET_HOME_DIR } from "./app-environment";

type HostServiceStatus = "starting" | "running" | "crashed";

interface HostServiceProcess {
	process: ChildProcess | null;
	port: number | null;
	status: HostServiceStatus;
	restartCount: number;
	lastCrash?: number;
	organizationId: string;
	portPromise: Promise<number>;
	resolvePort: (port: number) => void;
	rejectPort: (error: Error) => void;
	startupTimeout?: ReturnType<typeof setTimeout>;
	onStdoutData?: (data: Buffer) => void;
}

const MAX_RESTART_DELAY = 30_000;
const BASE_RESTART_DELAY = 1_000;

function createPortDeferred(): {
	promise: Promise<number>;
	resolve: (port: number) => void;
	reject: (error: Error) => void;
} {
	let resolve!: (port: number) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<number>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

export class HostServiceManager {
	private instances = new Map<string, HostServiceProcess>();
	private scriptPath = path.join(__dirname, "host-service.js");
	private authToken: string | null = null;
	private cloudApiUrl: string | null = null;

	setAuthToken(token: string | null): void {
		this.authToken = token;
	}

	setCloudApiUrl(url: string | null): void {
		this.cloudApiUrl = url;
	}

	async start(organizationId: string): Promise<number> {
		const existing = this.instances.get(organizationId);
		if (existing?.status === "running" && existing.port !== null) {
			return existing.port;
		}
		if (existing?.status === "starting") {
			return this.waitForPort(organizationId);
		}

		return this.spawn(organizationId);
	}

	stop(organizationId: string): void {
		const instance = this.instances.get(organizationId);
		if (!instance) return;

		instance.status = "crashed"; // prevent restart
		this.clearStartupState(instance);
		instance.rejectPort(new Error("Host service stopped"));
		instance.process?.kill("SIGTERM");
		this.instances.delete(organizationId);
	}

	stopAll(): void {
		for (const [id] of this.instances) {
			this.stop(id);
		}
	}

	getPort(organizationId: string): number | null {
		return this.instances.get(organizationId)?.port ?? null;
	}

	getStatus(organizationId: string): HostServiceStatus | null {
		return this.instances.get(organizationId)?.status ?? null;
	}

	private async spawn(organizationId: string): Promise<number> {
		const deferred = createPortDeferred();
		const instance: HostServiceProcess = {
			process: null,
			port: null,
			status: "starting",
			restartCount: 0,
			organizationId,
			portPromise: deferred.promise,
			resolvePort: deferred.resolve,
			rejectPort: deferred.reject,
		};
		this.instances.set(organizationId, instance);

		try {
			const env = await getProcessEnvWithShellPath({
				...(process.env as Record<string, string>),
				ELECTRON_RUN_AS_NODE: "1",
				ORGANIZATION_ID: organizationId,
				HOST_DB_PATH: path.join(SUPERSET_HOME_DIR, "host.db"),
				HOST_MIGRATIONS_PATH: app.isPackaged
					? path.join(process.resourcesPath, "resources/host-migrations")
					: path.join(app.getAppPath(), "../../packages/host-service/drizzle"),
			});
			if (this.authToken) {
				env.AUTH_TOKEN = this.authToken;
			}
			if (this.cloudApiUrl) {
				env.CLOUD_API_URL = this.cloudApiUrl;
			}

			if (this.instances.get(organizationId) !== instance) {
				const error = new Error("Host service start cancelled");
				instance.rejectPort(error);
				throw error;
			}

			const child = spawn(process.execPath, [this.scriptPath], {
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});
			instance.process = child;

			child.stderr?.on("data", (data: Buffer) => {
				console.error(
					`[host-service:${organizationId}] ${data.toString().trim()}`,
				);
			});

			child.on("exit", (code) => {
				console.log(
					`[host-service:${organizationId}] exited with code ${code}`,
				);
				const current = this.instances.get(organizationId);
				if (
					current &&
					current.process === child &&
					current.status !== "crashed"
				) {
					this.clearStartupState(current);
					if (current.port === null) {
						current.rejectPort(
							new Error("Host service exited before reporting port"),
						);
					}
					current.status = "crashed";
					current.lastCrash = Date.now();
					this.scheduleRestart(organizationId);
				}
			});

			this.attachPortListener(instance);
			return instance.portPromise;
		} catch (error) {
			if (this.instances.get(organizationId) === instance) {
				this.instances.delete(organizationId);
			}
			this.clearStartupState(instance);
			instance.rejectPort(
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		}
	}

	private waitForPort(organizationId: string): Promise<number> {
		const instance = this.instances.get(organizationId);
		if (!instance) {
			return Promise.reject(new Error("Instance not found"));
		}

		if (instance.port !== null) {
			return Promise.resolve(instance.port);
		}

		return instance.portPromise;
	}

	private failStartup(instance: HostServiceProcess, error: Error): void {
		this.clearStartupState(instance);
		instance.status = "crashed";
		instance.rejectPort(error);
		instance.process?.kill("SIGTERM");
		if (this.instances.get(instance.organizationId) === instance) {
			this.instances.delete(instance.organizationId);
		}
	}

	private attachPortListener(instance: HostServiceProcess): void {
		let buffer = "";
		const onData = (data: Buffer) => {
			buffer += data.toString();
			const newlineIdx = buffer.indexOf("\n");
			if (newlineIdx === -1) return;

			const line = buffer.slice(0, newlineIdx);
			this.clearStartupState(instance);

			try {
				const parsed = JSON.parse(line) as { port: number };
				instance.port = parsed.port;
				instance.status = "running";
				console.log(
					`[host-service:${instance.organizationId}] listening on port ${parsed.port}`,
				);
				instance.resolvePort(parsed.port);
			} catch {
				this.failStartup(
					instance,
					new Error(`Failed to parse port from host-service: ${line}`),
				);
			}
		};

		instance.onStdoutData = onData;
		instance.process?.stdout?.on("data", onData);
		instance.startupTimeout = setTimeout(() => {
			this.failStartup(
				instance,
				new Error("Timeout waiting for host-service port"),
			);
		}, 10_000);
	}

	private clearStartupState(instance: HostServiceProcess): void {
		if (instance.onStdoutData) {
			instance.process?.stdout?.off("data", instance.onStdoutData);
			instance.onStdoutData = undefined;
		}
		if (instance.startupTimeout) {
			clearTimeout(instance.startupTimeout);
			instance.startupTimeout = undefined;
		}
	}

	private scheduleRestart(organizationId: string): void {
		const instance = this.instances.get(organizationId);
		if (!instance) return;

		const delay = Math.min(
			BASE_RESTART_DELAY * 2 ** instance.restartCount,
			MAX_RESTART_DELAY,
		);
		instance.restartCount++;

		console.log(
			`[host-service:${organizationId}] restarting in ${delay}ms (attempt ${instance.restartCount})`,
		);

		setTimeout(() => {
			const current = this.instances.get(organizationId);
			if (current?.status === "crashed") {
				this.instances.delete(organizationId);
				this.spawn(organizationId).catch((err) => {
					console.error(
						`[host-service:${organizationId}] restart failed:`,
						err,
					);
				});
			}
		}, delay);
	}
}

let manager: HostServiceManager | null = null;

export function getHostServiceManager(): HostServiceManager {
	if (!manager) {
		manager = new HostServiceManager();
	}
	return manager;
}
