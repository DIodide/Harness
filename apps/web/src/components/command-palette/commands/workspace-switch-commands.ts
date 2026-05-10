import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMemo } from "react";
import { useRegisterCommands } from "../../../hooks/use-register-commands";
import type { Command } from "../../../lib/command-palette/types";
import { formatShortcut } from "../../../lib/platform";
import { getWorkspaceColorHex } from "../../../lib/workspace-colors";

interface WorkspaceLike {
	_id: Id<"workspaces">;
	name: string;
	color?: string;
}

/**
 * Registers one switch-to-<workspace> command per workspace.
 * Render from inside the /workspaces route where `onSelect` can directly call
 * `setActiveWorkspaceId`.
 */
export function useWorkspaceSwitchCommands(
	workspaces: ReadonlyArray<WorkspaceLike> | undefined,
	onSelect: (id: Id<"workspaces">) => void,
	isMac: boolean,
): void {
	const commands = useMemo<Command[]>(() => {
		if (!workspaces || workspaces.length === 0) return [];
		return workspaces.map((workspace, index) => {
			const colorDot = getWorkspaceColorHex(workspace.color) ?? undefined;
			const shortcut = index < 9 ? formatShortcut(index + 1, isMac) : undefined;
			return {
				id: `workspace:switch:${workspace._id}`,
				title: `Switch to ${workspace.name}`,
				group: "workspace",
				keywords: ["workspace", "switch", workspace.name],
				colorDot,
				shortcut,
				perform: () => onSelect(workspace._id),
			};
		});
	}, [workspaces, onSelect, isMac]);

	useRegisterCommands(commands);
}
