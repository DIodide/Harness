// redirect to either workspaces or chat based on workspacesMode setting
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app")({
	validateSearch: (
		search: Record<string, unknown>,
	): { harnessId?: string; workspaceId?: string } => ({
		harnessId: (search.harnessId as string) ?? undefined,
		workspaceId: (search.workspaceId as string) ?? undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
		const settings = await context.queryClient.ensureQueryData(
			convexQuery(api.userSettings.get, {}),
		);

		if (settings.workspacesMode === "workspaces") {
			throw redirect({
				to: "/workspaces",
				search: {},
			});
		} else {
			throw redirect({
				to: "/chat",
				search: { harnessId: search.harnessId },
			});
		}
	},
});
