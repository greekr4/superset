import { useEffect, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { ChangeCategory } from "shared/changes-types";
import { isImageFile } from "shared/file-types";

interface UseFileContentParams {
	worktreePath: string;
	filePath: string;
	viewMode: "raw" | "diff" | "rendered";
	diffCategory?: ChangeCategory;
	commitHash?: string;
	oldPath?: string;
	isDirty: boolean;
	originalContentRef: React.MutableRefObject<string>;
	originalDiffContentRef: React.MutableRefObject<string>;
}

export function useFileContent({
	worktreePath,
	filePath,
	viewMode,
	diffCategory,
	commitHash,
	oldPath,
	isDirty,
	originalContentRef,
	originalDiffContentRef,
}: UseFileContentParams) {
	// For remote URLs (e.g. Vercel Blob), skip all IPC queries
	const isRemote =
		filePath.startsWith("https://") || filePath.startsWith("http://");

	// Absolute paths (starting with /) are external files outside the worktree
	const isAbsolutePath = filePath.startsWith("/");

	const { data: branchData } = electronTrpc.changes.getBranches.useQuery(
		{ worktreePath },
		{
			enabled:
				!isRemote &&
				!isAbsolutePath &&
				!!worktreePath &&
				diffCategory === "against-base",
		},
	);
	const effectiveBaseBranch =
		branchData?.worktreeBaseBranch ?? branchData?.defaultBranch ?? "main";

	const isImage = isImageFile(filePath);

	// Use filesystem.readFile for absolute paths (external files)
	const { data: externalFileData, isLoading: isLoadingExternal } =
		electronTrpc.filesystem.readFile.useQuery(
			{ filePath },
			{
				enabled:
					isAbsolutePath &&
					!isRemote &&
					viewMode !== "diff" &&
					!isImage &&
					!!filePath,
			},
		);

	// Use changes.readWorkingFile for worktree-relative paths
	const { data: rawFileData, isLoading: isLoadingRaw } =
		electronTrpc.changes.readWorkingFile.useQuery(
			{ worktreePath, filePath },
			{
				enabled:
					!isRemote &&
					!isAbsolutePath &&
					viewMode !== "diff" &&
					!isImage &&
					!!filePath &&
					!!worktreePath,
			},
		);

	// Merge external and worktree file data into a single result
	const effectiveRawFileData = isAbsolutePath ? externalFileData : rawFileData;
	const effectiveIsLoadingRaw = isAbsolutePath
		? isLoadingExternal
		: isLoadingRaw;

	const { data: imageData, isLoading: isLoadingImage } =
		electronTrpc.changes.readWorkingFileImage.useQuery(
			{ worktreePath, filePath },
			{
				enabled:
					!isRemote &&
					!isAbsolutePath &&
					viewMode === "rendered" &&
					isImage &&
					!!filePath &&
					!!worktreePath,
			},
		);

	const { data: diffData, isLoading: isLoadingDiff } =
		electronTrpc.changes.getFileContents.useQuery(
			{
				worktreePath,
				filePath,
				oldPath,
				category: diffCategory ?? "unstaged",
				commitHash,
				defaultBranch:
					diffCategory === "against-base" ? effectiveBaseBranch : undefined,
			},
			{
				enabled:
					!isRemote &&
					!isAbsolutePath &&
					viewMode === "diff" &&
					!!diffCategory &&
					!!filePath &&
					!!worktreePath,
			},
		);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Only update baseline when content loads
	useEffect(() => {
		if (effectiveRawFileData?.ok === true && !isDirty) {
			originalContentRef.current = effectiveRawFileData.content;
		}
	}, [effectiveRawFileData]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Only update baseline when diff loads
	useEffect(() => {
		if (diffData && !isDirty) {
			originalDiffContentRef.current = diffData.modified;
		}
	}, [diffData]);

	// For remote URLs, return the URL directly as imageData (works with <img src=>)
	const remoteImageData = useMemo(
		() =>
			isRemote
				? { ok: true as const, dataUrl: filePath, byteLength: 0 }
				: undefined,
		[isRemote, filePath],
	);

	return {
		rawFileData: effectiveRawFileData,
		isLoadingRaw: effectiveIsLoadingRaw || (isImage && isLoadingImage),
		imageData: isRemote ? remoteImageData : imageData,
		isLoadingImage: isRemote ? false : isLoadingImage,
		diffData,
		isLoadingDiff,
	};
}
