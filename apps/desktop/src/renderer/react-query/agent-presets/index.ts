import { electronTrpc } from "renderer/lib/electron-trpc";

function useUpdateAgentPreset(
	options?: Parameters<
		typeof electronTrpc.settings.updateAgentPreset.useMutation
	>[0],
) {
	const utils = electronTrpc.useUtils();

	return electronTrpc.settings.updateAgentPreset.useMutation({
		...options,
		onSuccess: async (...args) => {
			await utils.settings.getAgentPresets.invalidate();
			await options?.onSuccess?.(...args);
		},
	});
}

export function useAgentPresets() {
	const { data: presets = [], isLoading } =
		electronTrpc.settings.getAgentPresets.useQuery();

	const updatePreset = useUpdateAgentPreset();

	return {
		presets,
		isLoading,
		updatePreset,
	};
}
