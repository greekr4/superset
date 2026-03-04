import type { AgentPreset } from "@superset/local-db";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Switch } from "@superset/ui/switch";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useRef, useState } from "react";
import {
	getPresetIcon,
	useIsDarkTheme,
} from "renderer/assets/app-icons/preset-icons";
import { useAgentPresets } from "renderer/react-query/agent-presets";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../utils/settings-search";

interface AgentSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

type AgentTextField =
	| "label"
	| "description"
	| "command"
	| "promptCommand"
	| "promptCommandSuffix"
	| "taskPromptTemplate";

function getFieldValue(preset: AgentPreset, field: AgentTextField): string {
	switch (field) {
		case "label":
			return preset.label;
		case "description":
			return preset.description ?? "";
		case "command":
			return preset.command;
		case "promptCommand":
			return preset.promptCommand;
		case "promptCommandSuffix":
			return preset.promptCommandSuffix ?? "";
		case "taskPromptTemplate":
			return preset.taskPromptTemplate;
	}
}

function isRequiredField(field: AgentTextField): boolean {
	return (
		field === "label" ||
		field === "command" ||
		field === "promptCommand" ||
		field === "taskPromptTemplate"
	);
}

export function AgentSettings({ visibleItems }: AgentSettingsProps) {
	const showAgents = isItemVisible(SETTING_ITEM_ID.AGENT_PRESETS, visibleItems);
	const showPromptTemplate = isItemVisible(
		SETTING_ITEM_ID.AGENT_PROMPT_TEMPLATE,
		visibleItems,
	);
	const isDark = useIsDarkTheme();

	const { presets: serverPresets, isLoading, updatePreset } = useAgentPresets();
	const [localPresets, setLocalPresets] =
		useState<AgentPreset[]>(serverPresets);
	const serverPresetsRef = useRef(serverPresets);

	useEffect(() => {
		serverPresetsRef.current = serverPresets;
		setLocalPresets(serverPresets);
	}, [serverPresets]);

	const showCards = showAgents || showPromptTemplate;

	const updateLocalField = (
		presetId: string,
		field: AgentTextField,
		value: string,
	) => {
		setLocalPresets((current) =>
			current.map((preset) =>
				preset.id === presetId ? { ...preset, [field]: value } : preset,
			),
		);
	};

	const handleFieldBlur = (presetId: string, field: AgentTextField) => {
		const localPreset = localPresets.find((preset) => preset.id === presetId);
		const serverPreset = serverPresetsRef.current.find(
			(preset) => preset.id === presetId,
		);
		if (!localPreset || !serverPreset) return;

		const localValue = getFieldValue(localPreset, field);
		const serverValue = getFieldValue(serverPreset, field);

		if (localValue === serverValue) return;

		if (isRequiredField(field) && localValue.trim().length === 0) {
			updateLocalField(presetId, field, serverValue);
			return;
		}

		switch (field) {
			case "label":
				updatePreset.mutate({
					id: localPreset.id,
					patch: { label: localValue.trim() },
				});
				return;
			case "description":
				updatePreset.mutate({
					id: localPreset.id,
					patch: { description: localValue.trim() || null },
				});
				return;
			case "command":
				updatePreset.mutate({
					id: localPreset.id,
					patch: { command: localValue.trim() },
				});
				return;
			case "promptCommand":
				updatePreset.mutate({
					id: localPreset.id,
					patch: { promptCommand: localValue.trim() },
				});
				return;
			case "promptCommandSuffix":
				updatePreset.mutate({
					id: localPreset.id,
					patch: { promptCommandSuffix: localValue.trim() || null },
				});
				return;
			case "taskPromptTemplate":
				updatePreset.mutate({
					id: localPreset.id,
					patch: { taskPromptTemplate: localValue.trim() },
				});
				return;
		}
	};

	const handleEnabledChange = (presetId: string, enabled: boolean) => {
		setLocalPresets((current) =>
			current.map((preset) =>
				preset.id === presetId ? { ...preset, enabled } : preset,
			),
		);
		updatePreset.mutate({
			id: presetId as AgentPreset["id"],
			patch: { enabled },
		});
	};

	return (
		<div className="p-6 max-w-7xl w-full">
			<div className="mb-8">
				<h2 className="text-xl font-semibold">Agent</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Configure agent dropdown commands and task prompt templates
				</p>
			</div>

			{showCards && (
				<div className="space-y-4">
					{isLoading && (
						<p className="text-xs text-muted-foreground">Loading agents...</p>
					)}

					{localPresets.map((preset) => {
						const icon = getPresetIcon(preset.id, isDark);
						const enabled = preset.enabled ?? true;

						return (
							<div
								key={preset.id}
								className="rounded-lg border border-border p-4 space-y-4"
							>
								<div className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2 min-w-0">
										{icon && (
											<img
												src={icon}
												alt=""
												className="size-4 object-contain"
											/>
										)}
										<p className="font-medium truncate">{preset.label}</p>
										<span className="text-xs text-muted-foreground shrink-0">
											{preset.id}
										</span>
									</div>
									<div className="flex items-center gap-2 shrink-0">
										<Label
											htmlFor={`agent-enabled-${preset.id}`}
											className="text-xs text-muted-foreground"
										>
											Enabled
										</Label>
										<Switch
											id={`agent-enabled-${preset.id}`}
											checked={enabled}
											onCheckedChange={(checked) =>
												handleEnabledChange(preset.id, checked)
											}
										/>
									</div>
								</div>

								{showAgents && (
									<>
										<div className="space-y-1.5">
											<Label htmlFor={`agent-label-${preset.id}`}>Label</Label>
											<Input
												id={`agent-label-${preset.id}`}
												value={preset.label}
												onChange={(e) =>
													updateLocalField(preset.id, "label", e.target.value)
												}
												onBlur={() => handleFieldBlur(preset.id, "label")}
											/>
										</div>

										<div className="space-y-1.5">
											<Label htmlFor={`agent-command-${preset.id}`}>
												Command (No Prompt)
											</Label>
											<Input
												id={`agent-command-${preset.id}`}
												value={preset.command}
												onChange={(e) =>
													updateLocalField(preset.id, "command", e.target.value)
												}
												onBlur={() => handleFieldBlur(preset.id, "command")}
											/>
										</div>

										<div className="space-y-1.5">
											<Label htmlFor={`agent-prompt-command-${preset.id}`}>
												Command (With Prompt)
											</Label>
											<Input
												id={`agent-prompt-command-${preset.id}`}
												value={preset.promptCommand}
												onChange={(e) =>
													updateLocalField(
														preset.id,
														"promptCommand",
														e.target.value,
													)
												}
												onBlur={() =>
													handleFieldBlur(preset.id, "promptCommand")
												}
											/>
										</div>

										<div className="space-y-1.5">
											<Label htmlFor={`agent-prompt-suffix-${preset.id}`}>
												Prompt Command Suffix (Optional)
											</Label>
											<Input
												id={`agent-prompt-suffix-${preset.id}`}
												value={preset.promptCommandSuffix ?? ""}
												onChange={(e) =>
													updateLocalField(
														preset.id,
														"promptCommandSuffix",
														e.target.value,
													)
												}
												onBlur={() =>
													handleFieldBlur(preset.id, "promptCommandSuffix")
												}
												placeholder="e.g. --yolo"
											/>
										</div>
									</>
								)}

								{showPromptTemplate && (
									<div className="space-y-1.5">
										<Label htmlFor={`agent-task-prompt-${preset.id}`}>
											Task Prompt Template
										</Label>
										<Textarea
											id={`agent-task-prompt-${preset.id}`}
											value={preset.taskPromptTemplate}
											onChange={(e) =>
												updateLocalField(
													preset.id,
													"taskPromptTemplate",
													e.target.value,
												)
											}
											onBlur={() =>
												handleFieldBlur(preset.id, "taskPromptTemplate")
											}
											className="min-h-40 font-mono text-xs"
										/>
										<p className="text-xs text-muted-foreground">
											Supported variables: {"{{id}}"}, {"{{slug}}"},{" "}
											{"{{title}}"}, {"{{description}}"}, {"{{priority}}"},{" "}
											{"{{statusName}}"}, {"{{labels}}"}
										</p>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
