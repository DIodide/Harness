import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
	clearHarnessCloneIntent,
	peekHarnessCloneIntent,
	setHarnessCloneIntent,
} from "../../lib/share";

export const Route = createFileRoute("/share-harness/$token")({
	// No beforeLoad auth guard — anonymous visitors must be able to view.
	component: SharedHarnessView,
});

function SharedHarnessView() {
	const { token } = Route.useParams();
	const navigate = useNavigate();
	const { isSignedIn } = useAuth();

	const { data: harness, isPending } = useQuery(
		convexQuery(api.harnessShares.getSharedHarness, { token }),
	);

	const clone = useMutation({
		mutationFn: useConvexMutation(api.harnessShares.cloneSharedHarness),
	});

	const requestClone = async () => {
		if (!isSignedIn) {
			setHarnessCloneIntent(token);
			navigate({
				to: "/sign-in",
				search: { redirect: `/share-harness/${token}` },
			});
			return;
		}
		try {
			const id = await clone.mutateAsync({ token });
			clearHarnessCloneIntent();
			toast.success("Cloned to your harnesses");
			navigate({ to: "/harnesses/$harnessId", params: { harnessId: id } });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't clone");
		}
	};

	// Owner opened their OWN link → send them to their editable harness.
	const ownerRedirected = useRef(false);
	useEffect(() => {
		if (harness?.viewerIsOwner && !ownerRedirected.current) {
			ownerRedirected.current = true;
			navigate({
				to: "/harnesses/$harnessId",
				params: { harnessId: harness.harnessId as Id<"harnesses"> },
			});
		}
	}, [harness, navigate]);

	// Resume a pending clone once the visitor returns signed-in.
	const autoCloned = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once when auth+harness settle
	useEffect(() => {
		if (
			autoCloned.current ||
			!isSignedIn ||
			!harness ||
			harness.viewerIsOwner ||
			peekHarnessCloneIntent() !== token
		) {
			return;
		}
		autoCloned.current = true;
		void requestClone();
	}, [isSignedIn, harness, token]);

	if (isPending || harness?.viewerIsOwner) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<Loader2 className="animate-spin text-muted-foreground" size={20} />
			</div>
		);
	}

	if (!harness) {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
				<Lock className="text-muted-foreground" size={28} />
				<h1 className="text-lg font-medium text-foreground">
					This shared harness isn’t available
				</h1>
				<p className="max-w-sm text-sm text-muted-foreground">
					The link may have been turned off, reset, or never existed.
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => navigate({ to: "/" })}
				>
					Go to Harness
				</Button>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
				<div className="flex min-w-0 items-center gap-3">
					<a
						href="/"
						className="shrink-0 font-semibold tracking-tight text-foreground"
					>
						Harness
					</a>
					<span className="text-border">/</span>
					<span className="truncate text-sm text-foreground">
						{harness.name}
					</span>
					{harness.ownerName && (
						<span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
							<Avatar className="h-5 w-5">
								<AvatarImage src={harness.ownerImageUrl ?? undefined} />
								<AvatarFallback className="bg-muted text-[9px]">
									{harness.ownerName.charAt(0).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							Shared by {harness.ownerName}
						</span>
					)}
				</div>
				<Button
					size="sm"
					onClick={requestClone}
					disabled={clone.isPending}
					className="shrink-0"
				>
					<Copy size={14} />
					{isSignedIn ? "Clone to my harnesses" : "Sign in to clone"}
				</Button>
			</header>

			<div className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-6">
				<div className="flex items-center gap-2">
					<h1 className="text-xl font-medium tracking-tight text-foreground">
						{harness.name}
					</h1>
					{harness.locked && (
						<Badge variant="outline" className="gap-1 text-[10px]">
							<Lock size={10} /> Locked
						</Badge>
					)}
				</div>

				<dl className="space-y-3 text-sm">
					<Row label="Model" value={harness.model} />
					<Row label="Agent" value={harness.agent} />
					{harness.systemPrompt && (
						<div>
							<dt className="text-xs uppercase tracking-wide text-muted-foreground">
								System prompt
							</dt>
							<dd className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground/90">
								{harness.systemPrompt}
							</dd>
						</div>
					)}
				</dl>

				{harness.skills.length > 0 && (
					<Section title={`Skills (${harness.skills.length})`}>
						<div className="flex flex-wrap gap-1.5">
							{harness.skills.map((s) => (
								<Badge key={s.name} variant="secondary" className="gap-1">
									<Sparkles size={10} />
									{s.name}
								</Badge>
							))}
						</div>
					</Section>
				)}

				{harness.mcpServers.length > 0 && (
					<Section title={`MCP servers (${harness.mcpServers.length})`}>
						<ul className="space-y-1.5">
							{harness.mcpServers.map((m) => (
								<li
									key={m.name}
									className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
								>
									<span className="flex-1 truncate text-foreground">
										{m.name}
									</span>
									{m.hasAuth && (
										<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
											<ShieldCheck size={11} /> requires auth
										</span>
									)}
								</li>
							))}
						</ul>
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							Server URLs and credentials stay private — cloning lets you
							connect your own.
						</p>
					</Section>
				)}
			</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-3">
			<dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="truncate font-mono text-xs text-foreground">{value}</dd>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-2">
			<h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{children}
		</div>
	);
}
