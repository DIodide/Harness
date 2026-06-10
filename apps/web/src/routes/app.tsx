// Redirect to workspaces or chat based on workspacesMode setting.
//
// Right after Clerk completes sign-in/up client-side there is a window
// where the server (root beforeLoad's auth()) does not see the session
// cookie yet. Throwing to /sign-in in that window bounced users through
// Clerk's already-signed-in fallback and onto the landing page. So:
// server-side userId present → fast server redirect; absent → render a
// client gate that waits for Clerk's client state (authoritative) and
// routes from there.
import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { RoseCurveSpinner } from "../components/rose-curve-spinner";

export const Route = createFileRoute("/app")({
	validateSearch: (
		search: Record<string, unknown>,
	): { harnessId?: string; workspaceId?: string } => ({
		harnessId: (search.harnessId as string) ?? undefined,
		workspaceId: (search.workspaceId as string) ?? undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		if (!context.userId) {
			// Cookie may simply not have propagated yet — let the client gate
			// decide using Clerk's client-side session state.
			return;
		}
		const settings = await context.queryClient.ensureQueryData(
			convexQuery(api.userSettings.get, {}),
		);

		if (settings.workspacesMode === "workspaces") {
			throw redirect({ to: "/workspaces", search: {} });
		}
		throw redirect({
			to: "/chat",
			search: { harnessId: search.harnessId },
		});
	},
	component: AuthGate,
});

function AuthGate() {
	const navigate = useNavigate();
	const search = Route.useSearch();
	const { isLoaded, isSignedIn } = useAuth();
	const { isAuthenticated: convexReady } = useConvexAuth();
	const { data: settings } = useQuery({
		...convexQuery(api.userSettings.get, {}),
		enabled: convexReady,
	});

	useEffect(() => {
		if (!isLoaded) return;
		if (!isSignedIn) {
			navigate({ to: "/sign-in", replace: true });
			return;
		}
		if (!settings) return; // wait for convex auth + settings
		if (settings.workspacesMode === "workspaces") {
			navigate({ to: "/workspaces", replace: true });
		} else {
			navigate({
				to: "/chat",
				search: { harnessId: search.harnessId },
				replace: true,
			});
		}
	}, [isLoaded, isSignedIn, settings, navigate, search.harnessId]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<RoseCurveSpinner size={40} className="text-foreground" />
		</div>
	);
}
