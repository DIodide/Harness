import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { Edit3, FolderPlus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useRegisterCommands } from "../../../hooks/use-register-commands";
import type { Command } from "../../../lib/command-palette/types";
import { getWorkspaceColorHex } from "../../../lib/workspace-colors";

interface ActiveWorkspace {
	_id: Id<"workspaces">;
	name: string;
	harnessId?: Id<"harnesses">;
	sandboxId?: Id<"sandboxes">;
	color?: string;
}

interface WorkspaceActionCommandsInput {
	activeWorkspace: ActiveWorkspace | undefined;
	canCreateWorkspace: boolean;
	onCreateWorkspace: () => void;
	onRenameActiveWorkspace: () => void;
}

export function useWorkspaceActionCommands({
	activeWorkspace,
	canCreateWorkspace,
	onCreateWorkspace,
	onRenameActiveWorkspace,
}: WorkspaceActionCommandsInput): void {
	const activeColor = activeWorkspace
		? (getWorkspaceColorHex(activeWorkspace.color) ?? undefined)
		: undefined;

	const commands = useMemo<Command[]>(() => {
		const list: Command[] = [
			{
				id: "workspace:create",
				title: "Create workspace…",
				subtitle: "Open the new workspace dialog",
				group: "workspace",
				icon: FolderPlus,
				keywords: ["new", "workspace", "add"],
				when: () => canCreateWorkspace,
				perform: onCreateWorkspace,
			},
		];

		if (activeWorkspace) {
			list.push({
				id: "workspace:rename-active",
				title: `Rename workspace: ${activeWorkspace.name}`,
				group: "workspace",
				icon: Edit3,
				colorDot: activeColor,
				shortcut: "⇧⌘R",
				keywords: ["rename", "edit", "workspace", activeWorkspace.name],
				perform: onRenameActiveWorkspace,
			});
		}

		return list;
	}, [
		activeWorkspace,
		activeColor,
		canCreateWorkspace,
		onCreateWorkspace,
		onRenameActiveWorkspace,
	]);

	useRegisterCommands(commands);

	// Latest callback in a ref so the keydown effect doesn't rebind on every
	// render. We need activeWorkspace's presence though, so the effect still
	// resubscribes when that flips.
	const renameRef = useRef(onRenameActiveWorkspace);
	renameRef.current = onRenameActiveWorkspace;
	const hasActive = !!activeWorkspace;

	useEffect(() => {
		if (!hasActive) return;
		const handler = (e: KeyboardEvent) => {
			if (e.repeat) return;
			if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
			if (e.key !== "r" && e.key !== "R") return;
			e.preventDefault();
			renameRef.current();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [hasActive]);
}
