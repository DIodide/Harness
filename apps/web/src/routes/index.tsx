import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { SignInButton } from "@clerk/tanstack-react-start";
import {
	Briefcase,
	Code,
	GraduationCap,
	ArrowRight,
	Layers,
	Zap,
	Shield,
	GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHarnesses } from "@/hooks/useHarnesses";

export const Route = createFileRoute("/")({ component: LandingPage });

const ICON_MAP: Record<string, React.ElementType> = {
	briefcase: Briefcase,
	code: Code,
	"graduation-cap": GraduationCap,
};

function LandingPage() {
	const { isSignedIn, isLoaded } = useUser();
	const navigate = useNavigate();
	const { harnesses } = useHarnesses();

	return (
		<div className="min-h-screen bg-background">
			{/* Hero */}
			<div className="relative overflow-hidden">
				<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.72_0.19_192/0.08),transparent_60%)]" />
				<div className="relative max-w-5xl mx-auto px-6 pt-20 pb-16">
					<nav className="flex items-center justify-between mb-20">
						<div className="flex items-center gap-2.5">
							<div className="size-8 rounded-lg bg-primary flex items-center justify-center">
								<span className="text-primary-foreground font-bold text-sm font-mono">
									H
								</span>
							</div>
							<span className="font-semibold text-lg tracking-tight">
								Harness
							</span>
						</div>
						{isLoaded && (
							<>
								{isSignedIn ? (
									<Button
										onClick={() => navigate({ to: "/chat", search: { connected: undefined, c: undefined } })}
										className="gap-2"
									>
										Open Chat
										<ArrowRight className="size-4" />
									</Button>
								) : (
									<SignInButton mode="modal">
										<Button variant="outline">Sign In</Button>
									</SignInButton>
								)}
							</>
						)}
					</nav>

					<div className="text-center max-w-3xl mx-auto">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-mono mb-6">
							<Zap className="size-3" />
							MCP-Powered AI Chat
						</div>
						<h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.1]">
							Your AI, your{" "}
							<span className="text-primary">tools</span>,{" "}
							<br className="hidden md:block" />
							your harness.
						</h1>
						<p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
							Connect to Notion, GitHub, Linear, and more through MCP.
							Switch between pre-configured harnesses that give your AI
							the right tools for the job.
						</p>
						{isSignedIn ? (
							<Button
								size="lg"
								onClick={() => navigate({ to: "/chat", search: { connected: undefined, c: undefined } })}
								className="gap-2 text-base px-8 glow-teal"
							>
								Start Chatting
								<ArrowRight className="size-4" />
							</Button>
						) : (
							<SignInButton mode="modal">
								<Button size="lg" className="gap-2 text-base px-8 glow-teal">
									Get Started
									<ArrowRight className="size-4" />
								</Button>
							</SignInButton>
						)}
					</div>
				</div>
			</div>

			{/* Features */}
			<div className="max-w-5xl mx-auto px-6 py-16">
				<div className="grid md:grid-cols-3 gap-6">
					<FeatureCard
						icon={<Layers className="size-5" />}
						title="Harness Profiles"
						description="Pre-configured tool sets for different workflows. Switch between Productivity, Developer, and Princeton harnesses."
					/>
					<FeatureCard
						icon={<Shield className="size-5" />}
						title="Secure OAuth"
						description="Connect to MCP servers with per-user OAuth 2.1 authentication. Your credentials, your control."
					/>
					<FeatureCard
						icon={<GitBranch className="size-5" />}
						title="Model Agnostic"
						description="Switch between GPT-4o, Claude Sonnet, Gemini Pro, and more. Same harness, different brain."
					/>
				</div>
			</div>

			{/* Harness cards */}
			{harnesses.length > 0 && (
				<div className="max-w-5xl mx-auto px-6 pb-20">
					<h2 className="text-2xl font-semibold mb-6 text-center">
						Available Harnesses
					</h2>
					<div className="grid md:grid-cols-3 gap-4">
						{harnesses.map((h: { _id: string; icon: string; color: string; name: string; description: string; mcpServers: { name: string; url: string; authType: string }[] }) => {
							const Icon = ICON_MAP[h.icon] ?? Layers;
							return (
								<div
									key={h._id}
									className="border border-border rounded-xl p-5 bg-card hover:border-primary/30 transition-colors"
								>
									<div
										className="size-10 rounded-lg flex items-center justify-center mb-3"
										style={{
											backgroundColor: `${h.color}15`,
											color: h.color,
										}}
									>
										<Icon className="size-5" />
									</div>
									<h3 className="font-semibold mb-1">{h.name}</h3>
									<p className="text-sm text-muted-foreground mb-3">
										{h.description}
									</p>
									<div className="flex gap-1.5 flex-wrap">
										{h.mcpServers.map((s: { name: string }) => (
											<span
												key={s.name}
												className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary text-muted-foreground"
											>
												{s.name}
											</span>
										))}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

function FeatureCard({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="border border-border rounded-xl p-5 bg-card/50">
			<div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
				{icon}
			</div>
			<h3 className="font-semibold mb-1.5">{title}</h3>
			<p className="text-sm text-muted-foreground leading-relaxed">
				{description}
			</p>
		</div>
	);
}
