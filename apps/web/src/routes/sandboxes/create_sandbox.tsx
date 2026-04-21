import { useAuth } from "@clerk/tanstack-react-start";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, Cpu, HardDrive, Loader2, Play } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { env } from "../../env";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export const Route = createFileRoute("/sandboxes/create_sandbox")({
	beforeLoad: ({ context }) => {
		if (!context.userId) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const [name, setName] = useState("New sandbox");
	const [isCreating, setIsCreating] = useState(false);
	const [sandboxConfig, setSandboxConfig] = useState({
		persistent: false,
		autoStart: true,
		defaultLanguage: "python",
		resourceTier: "basic" as "basic" | "standard" | "performance",
	});

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
				const text = await res.text().catch(() => "");
				throw new Error(text || `Sandbox API error ${res.status}`);
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

					<StepSandbox config={sandboxConfig} setConfig={setSandboxConfig} />

					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							onClick={handleCreate}
							disabled={isCreating}
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

function StepSandbox({
	config,
	setConfig,
}: {
	config: {
		persistent: boolean;
		autoStart: boolean;
		defaultLanguage: string;
		resourceTier: "basic" | "standard" | "performance";
	};
	setConfig: (v: {
		persistent: boolean;
		autoStart: boolean;
		defaultLanguage: string;
		resourceTier: "basic" | "standard" | "performance";
	}) => void;
}) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Create a sandbox for code execution, file management, terminal commands,
				and git operations.
			</p>

			<motion.div
				initial={{ opacity: 0, height: 0 }}
				animate={{ opacity: 1, height: "auto" }}
				exit={{ opacity: 0, height: 0 }}
				className="space-y-4"
			>
				{/* Sandbox type */}
				<div>
					<span className="mb-1.5 block text-xs font-medium text-foreground">
						Sandbox Type
					</span>
					<div className="grid gap-2 sm:grid-cols-2">
						<button
							type="button"
							onClick={() => setConfig({ ...config, persistent: false })}
							className={`flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors ${
								!config.persistent
									? "border-foreground bg-foreground/5"
									: "border-border hover:bg-muted/30"
							}`}
						>
							<Play size={12} className="mt-0.5 shrink-0" />
							<div>
								<p className="text-xs font-medium">Ephemeral</p>
								<p className="text-[11px] text-muted-foreground">
									Created per conversation, auto-deleted when done
								</p>
							</div>
						</button>
						<button
							type="button"
							onClick={() => setConfig({ ...config, persistent: true })}
							className={`flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors ${
								config.persistent
									? "border-foreground bg-foreground/5"
									: "border-border hover:bg-muted/30"
							}`}
						>
							<HardDrive size={12} className="mt-0.5 shrink-0" />
							<div>
								<p className="text-xs font-medium">Persistent</p>
								<p className="text-[11px] text-muted-foreground">
									Maintains state across conversations
								</p>
							</div>
						</button>
					</div>
				</div>

				{/* Resource tier */}
				<div>
					<span className="mb-1.5 block text-xs font-medium text-foreground">
						Resource Tier
					</span>
					<Select
						value={config.resourceTier}
						onValueChange={(v) =>
							setConfig({
								...config,
								resourceTier: v as "basic" | "standard" | "performance",
							})
						}
					>
						<SelectTrigger className="max-w-sm text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="basic">
								<Cpu size={10} />
								Basic — 1 CPU, 1 GB RAM, 3 GB Disk
							</SelectItem>
							<SelectItem value="standard">
								<Cpu size={10} />
								Standard — 2 CPU, 4 GB RAM, 8 GB Disk
							</SelectItem>
							<SelectItem value="performance">
								<Cpu size={10} />
								Performance — 4 CPU, 8 GB RAM, 10 GB Disk
							</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* Default language */}
				<div>
					<span className="mb-1.5 block text-xs font-medium text-foreground">
						Default Language
					</span>
					<Select
						value={config.defaultLanguage}
						onValueChange={(v) => setConfig({ ...config, defaultLanguage: v })}
					>
						<SelectTrigger className="max-w-sm text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="python">Python</SelectItem>
							<SelectItem value="javascript">JavaScript</SelectItem>
							<SelectItem value="typescript">TypeScript</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</motion.div>
		</div>
	);
}
