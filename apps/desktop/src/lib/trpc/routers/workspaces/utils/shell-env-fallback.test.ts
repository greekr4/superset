import { describe, expect, test } from "bun:test";
import { augmentPathForMacOS } from "./shell-env";

describe("augmentPathForMacOS", () => {
	test("adds common macOS paths when they are missing", () => {
		if (process.platform !== "darwin") return;

		const env: Record<string, string> = {
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		};
		augmentPathForMacOS(env);

		expect(env.PATH).toContain("/opt/homebrew/bin");
		expect(env.PATH).toContain("/opt/homebrew/sbin");
		expect(env.PATH).toContain("/usr/local/bin");
		expect(env.PATH).toContain("/usr/local/sbin");
		// Original paths should still be present
		expect(env.PATH).toContain("/usr/bin");
		expect(env.PATH).toContain("/bin");
	});

	test("does not duplicate paths already present", () => {
		if (process.platform !== "darwin") return;

		const env: Record<string, string> = {
			PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
		};
		augmentPathForMacOS(env);

		const parts = env.PATH.split("/opt/homebrew/bin");
		expect(parts.length - 1).toBe(1);
	});

	test("handles empty PATH", () => {
		if (process.platform !== "darwin") return;

		const env: Record<string, string> = { PATH: "" };
		augmentPathForMacOS(env);

		expect(env.PATH).toContain("/opt/homebrew/bin");
		expect(env.PATH).toContain("/usr/local/bin");
	});

	test("handles missing PATH key", () => {
		if (process.platform !== "darwin") return;

		const env: Record<string, string> = {};
		augmentPathForMacOS(env);

		expect(env.PATH).toContain("/opt/homebrew/bin");
		expect(env.PATH).toContain("/usr/local/bin");
	});

	test("augmented PATH allows finding git binary", () => {
		if (process.platform !== "darwin") return;

		const env: Record<string, string> = {
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		};
		augmentPathForMacOS(env);

		const { execFileSync } = require("node:child_process");
		const gitPath = execFileSync("which", ["git"], {
			env: { ...process.env, PATH: env.PATH },
			encoding: "utf8",
		}).trim();
		expect(gitPath.length).toBeGreaterThan(0);
	});
});
