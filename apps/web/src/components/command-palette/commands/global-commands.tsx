import { useAuth, useClerk } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	Box,
	BoxIcon,
	FolderKanban,
	LogOut,
	MessageSquare,
	Package,
	SlidersHorizontal,
} from "lucide-react";
import { useMemo } from "react";
import { useRegisterCommands } from "../../../hooks/use-register-commands";
import type { Command } from "../../../lib/command-palette/types";

/**
 * Always-available navigation + account commands.
 * Must be rendered inside `CommandPaletteProvider` — mount once at the root.
 */
export function GlobalCommands() {
	const navigate = useNavigate();
	const { signOut } = useClerk();
	const { isSignedIn } = useAuth();

	const { data: harnesses } = useQuery({
		...convexQuery(api.harnesses.list, {}),
		enabled: !!isSignedIn,
	});
	const { data: sandboxes } = useQuery({
		...convexQuery(api.sandboxes.list, {}),
		enabled: !!isSignedIn,
	});

	const commands = useMemo<Command[]>(() => {
		if (!isSignedIn) return [];

		const list: Command[] = [
			{
				id: "nav:chat",
				title: "Go to Chat",
				group: "navigation",
				icon: MessageSquare,
				keywords: ["conversation", "message"],
				perform: () => navigate({ to: "/chat" }),
			},
			{
				id: "nav:workspaces",
				title: "Go to Workspaces",
				group: "navigation",
				icon: FolderKanban,
				keywords: ["projects"],
				perform: () => navigate({ to: "/workspaces" }),
			},
			{
				id: "nav:harnesses",
				title: "Manage Harnesses",
				group: "navigation",
				icon: SlidersHorizontal,
				keywords: ["agents", "configurations"],
				perform: () => navigate({ to: "/harnesses" }),
			},
			{
				id: "nav:sandboxes",
				title: "Manage Sandboxes",
				group: "navigation",
				icon: Box,
				keywords: ["environments", "daytona"],
				perform: () => navigate({ to: "/sandboxes" }),
			},
			{
				id: "sandbox:create",
				title: "Create sandbox…",
				group: "sandbox",
				icon: BoxIcon,
				keywords: ["new", "sandbox", "add", "daytona"],
				perform: () => navigate({ to: "/sandboxes/create_sandbox" }),
			},
		];

		for (const harness of harnesses ?? []) {
			list.push({
				id: `harness:open:${harness._id}`,
				title: `Open harness: ${harness.name}`,
				subtitle: harness.status,
				group: "harness",
				icon: Package,
				keywords: ["harness", "agent", harness.name, harness.status],
				perform: () =>
					navigate({
						to: "/harnesses/$harnessId",
						params: { harnessId: harness._id },
					}),
			});
		}

		for (const sandbox of sandboxes ?? []) {
			list.push({
				id: `sandbox:open:${sandbox._id}`,
				title: `Open sandbox: ${sandbox.name}`,
				subtitle: sandbox.status,
				group: "sandbox",
				icon: Package,
				keywords: ["sandbox", "environment", sandbox.name, sandbox.status],
				perform: () =>
					navigate({
						to: "/sandboxes/$sandboxId",
						params: { sandboxId: sandbox._id },
					}),
			});
		}

		list.push({
			id: "account:sign-out",
			title: "Sign out",
			group: "account",
			icon: LogOut,
			keywords: ["logout", "leave"],
			perform: async () => {
				await signOut();
				navigate({ to: "/sign-in" });
			},
		});

		return list;
	}, [isSignedIn, navigate, signOut, harnesses, sandboxes]);

	useRegisterCommands(commands);
	return null;
}
