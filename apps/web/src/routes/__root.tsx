import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
	useRouteContext,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { Toaster } from "react-hot-toast";
import { TooltipProvider } from "../components/ui/tooltip";
import appCss from "../styles.css?url";

const CHROMELESS_ROUTES = ["/", "/sign-in", "/onboarding"];

const fetchClerkAuth = createServerFn({ method: "GET" }).handler(async () => {
	const { userId, getToken } = await auth();
	const token = await getToken({ template: "convex" });

	return {
		userId,
		token,
	};
});

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
	convexClient: ConvexReactClient;
	convexQueryClient: ConvexQueryClient;
}>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Harness",
			},
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	beforeLoad: async (ctx) => {
		const { userId, token } = await fetchClerkAuth();

		if (token) {
			ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
		}

		return {
			userId,
			token,
		};
	},
	component: RootComponent,
	shellComponent: RootDocument,
});

function RootComponent() {
	const context = useRouteContext({ from: Route.id });
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isChromeless =
		CHROMELESS_ROUTES.includes(pathname) || pathname.startsWith("/share/");

	return (
		<ClerkProvider
			appearance={{
				variables: {
					borderRadius: "0rem",
					fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
					colorBackground: "var(--background)",
					colorText: "var(--foreground)",
					colorPrimary: "var(--primary)",
					colorTextOnPrimaryBackground: "var(--primary-foreground)",
					colorDanger: "var(--destructive)",
					colorInputBackground: "var(--background)",
					colorInputText: "var(--foreground)",
				},
				elements: {
					modalContent: "rounded-none shadow-none border border-border",
					modalCloseButton: "rounded-none",
					card: "shadow-none rounded-none border-0",
					navbar: "border-r border-border",
					navbarButton: "rounded-none text-xs font-medium",
					pageScrollBox: "p-6",
					formButtonPrimary:
						"rounded-none text-xs font-medium h-9 shadow-none bg-foreground text-background hover:bg-foreground/90",
					formButtonReset:
						"rounded-none text-xs font-medium h-9 shadow-none border border-border",
					formFieldInput: "rounded-none border-border text-sm shadow-none",
					formFieldLabel: "text-xs font-medium",
					badge: "rounded-none text-[10px]",
					dividerLine: "bg-border",
					dividerText: "text-muted-foreground text-xs",
					footerActionLink: "text-foreground hover:text-foreground/80",
					socialButtonsBlockButton:
						"rounded-none border-border text-xs font-medium",
				},
			}}
		>
			<ConvexProviderWithClerk client={context.convexClient} useAuth={useAuth}>
				<TooltipProvider delayDuration={300}>
					{isChromeless ? (
						<Outlet />
					) : (
						<div className="flex h-screen overflow-hidden">
							<div className="flex flex-1 flex-col overflow-hidden">
								<Outlet />
							</div>
						</div>
					)}
					<Toaster
						position="bottom-right"
						toastOptions={{
							style: {
								borderRadius: "0px",
								fontSize: "13px",
							},
						}}
					/>
				</TooltipProvider>
			</ConvexProviderWithClerk>
		</ClerkProvider>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
