import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { SandboxConfigForm } from "../../components/sandbox/sandbox-config-form";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { env } from "../../env";
import {
	DEFAULT_SANDBOX_CONFIG,
	MAX_SANDBOXES_PER_USER,
	type SandboxConfig,
} from "../../lib/sandbox";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export const Route = createFileRoute("/sandboxes/create_sandbox")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			// SSR can't see the Clerk session (the prod session cookies are not
			// shared to the app domain), so context.userId is null even for
			// signed-in users. Defer to the client auth gate instead of bouncing
			// to /sign-in, which loops. Mirrors /app.
			return;
		}
	},
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const [name, setName] = useState("New sandbox");
	const [isCreating, setIsCreating] = useState(false);
	const [sandboxConfig, setSandboxConfig] = useState<SandboxConfig>(
		DEFAULT_SANDBOX_CONFIG,
	);
	const { data: sandboxes } = useQuery(convexQuery(api.sandboxes.list, {}));
	const sandboxCount = sandboxes?.length ?? 0;
	const atSandboxLimit = sandboxCount >= MAX_SANDBOXES_PER_USER;

	const handleCreate = async () => {
		setIsCreating(true);
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/sandbox`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					name: name.trim() || "New sandbox",
					language: sandboxConfig.defaultLanguage,
					resource_tier: sandboxConfig.resourceTier,
					ephemeral: !sandboxConfig.persistent,
				}),
			});

			if (!res.ok) {
				const body = await res.json().catch(() => null);
				const detail =
					body && typeof body.detail === "string" ? body.detail : "";
				throw new Error(detail || `Sandbox API error ${res.status}`);
			}

			toast.success("Sandbox created");
			navigate({ to: "/sandboxes" });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to create sandbox",
			);
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<div className="flex h-full flex-col overflow-auto bg-background">
			<header className="flex items-center gap-4 border-b border-border px-6 py-4">
				<Button variant="ghost" size="icon-xs" asChild>
					<Link to="/sandboxes">
						<ArrowLeft size={14} />
					</Link>
				</Button>
				<div>
					<h1 className="text-lg font-medium tracking-tight text-foreground">
						Create Sandbox
					</h1>
					<p className="text-xs text-muted-foreground">
						Configure your sandbox
					</p>
				</div>
			</header>

			<div className="flex-1 p-6">
				<div className="mx-auto max-w-2xl space-y-6">
					{atSandboxLimit && (
						<div className="flex items-start gap-2 border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-foreground">
							<AlertCircle
								size={16}
								className="mt-0.5 shrink-0 text-amber-500"
							/>
							<div>
								<p className="font-medium">
									Sandbox limit reached ({sandboxCount} /{" "}
									{MAX_SANDBOXES_PER_USER})
								</p>
								<p className="mt-0.5 text-muted-foreground">
									You've hit the maximum number of sandboxes per account.{" "}
									<Link to="/sandboxes" className="underline">
										Delete an existing sandbox
									</Link>{" "}
									before creating a new one.
								</p>
							</div>
						</div>
					)}
					<div className="space-y-2">
						<label
							htmlFor="sandbox-name"
							className="block text-xs font-medium text-foreground"
						>
							Name
						</label>
						<Input
							id="sandbox-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							className="max-w-sm"
						/>
					</div>

					<SandboxConfigForm
						config={sandboxConfig}
						setConfig={setSandboxConfig}
					/>

					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							onClick={handleCreate}
							disabled={isCreating || atSandboxLimit}
							title={atSandboxLimit ? "Sandbox limit reached" : undefined}
						>
							{isCreating ? (
								<Loader2 size={14} className="animate-spin" />
							) : null}
							Create Sandbox
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link to="/sandboxes">Cancel</Link>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
