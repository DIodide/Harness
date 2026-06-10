import { useAuth } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	FileDiff,
	Lock,
	Menu,
	MessagesSquare,
	Plug,
	Repeat,
	Server,
	ShieldCheck,
	Sparkles,
	SquareTerminal,
	Workflow,
	X,
} from "lucide-react";
import {
	AnimatePresence,
	motion,
	useInView,
	useScroll,
	useTransform,
} from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
	ClaudeLogo,
	CursorLogo,
	GeminiLogo,
	OpenAILogo,
	OpenCodeLogo,
} from "../components/agent-logos";
import { HarnessMark } from "../components/harness-mark";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { generateFloatingDots } from "../lib/floating-dots";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/")({
	component: LandingPage,
	head: () => ({
		meta: [
			{ title: "Harness — Every coding agent. One chat. Every tool." },
			{
				name: "description",
				content:
					"Connect Claude Code, Codex, or Cursor. Harness equips them with MCP servers and skills, and lets you swap their entire toolset mid-conversation — in one click.",
			},
		],
	}),
});

/* ─────────────────────── Constants ─────────────────────── */

const AGENTS = [
	{
		name: "Claude Code",
		blurb: "Anthropic's coding agent",
		logo: ClaudeLogo,
		live: true,
	},
	{
		name: "Codex CLI",
		blurb: "OpenAI's coding agent",
		logo: OpenAILogo,
		live: true,
	},
	{ name: "Cursor", blurb: "Cursor's CLI agent", logo: CursorLogo, live: true },
	{
		name: "OpenCode",
		blurb: "Open-source agent",
		logo: OpenCodeLogo,
		live: false,
	},
	{
		name: "Gemini CLI",
		blurb: "Google's coding agent",
		logo: GeminiLogo,
		live: false,
	},
];

const rotatingContexts = [
	"code review",
	"deep research",
	"issue triage",
	"on-call ops",
];

const primaryFeatures = [
	{
		icon: Plug,
		title: "Bring your own agent",
		description:
			"Connect Claude Code, Codex, or Cursor with your own subscription. Each runs in an isolated cloud sandbox — Harness never sees your model bill.",
	},
	{
		icon: Repeat,
		title: "Rapid MCP context switching",
		description:
			"Swap your agent's entire toolset mid-conversation. Go from a research stack to a GitHub-ops stack in one click — the context carries over, the tools change instantly.",
	},
	{
		icon: MessagesSquare,
		title: "One chat for all of them",
		description:
			"The same polished UI for every agent: streaming reasoning, terminal output, file diffs, and inline approvals. No editor, no per-agent setup.",
	},
];

const secondaryFeatures = [
	{
		icon: Server,
		title: "A catalog of MCP servers",
		description:
			"GitHub, Notion, Linear, DeepWiki, Context7, and any custom URL. OAuth handled and refreshed — credentials brokered server-side, never in the sandbox.",
	},
	{
		icon: Sparkles,
		title: "Skills from skills.sh",
		description:
			"Bundle battle-tested playbooks — code review, debugging, web search — into a harness. Your agent imports your team's conventions on connect.",
	},
	{
		icon: ShieldCheck,
		title: "Sandboxed & approvals-first",
		description:
			"Agents execute in isolated Daytona sandboxes with a real terminal and git. Sensitive commands surface an inline approval card before they run.",
	},
];

const steps = [
	{
		num: "01",
		title: "Connect an agent",
		description:
			"Bring Claude Code, Codex, or Cursor — or start with Harness's built-in models, no setup. Credentials are encrypted and write-only.",
	},
	{
		num: "02",
		title: "Equip a harness",
		description:
			"Bundle the MCP servers and skills your agent needs. OAuth into GitHub, Notion, or Linear in one popup. Save it as a reusable harness.",
	},
	{
		num: "03",
		title: "Chat & switch",
		description:
			"Send a message and watch tool calls, diffs, and terminal output stream in. Swap harnesses any time — the conversation keeps going.",
	},
];

const ease = [0.16, 1, 0.3, 1] as const;

/* ─────────────────────── Utility Components ─────────────────────── */

function FadeIn({
	children,
	delay = 0,
	className,
}: {
	children: React.ReactNode;
	delay?: number;
	className?: string;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 24 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-60px" }}
			transition={{ duration: 0.6, delay, ease }}
			className={className}
		>
			{children}
		</motion.div>
	);
}

function RotatingWord() {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		const timer = setInterval(
			() => setIndex((i) => (i + 1) % rotatingContexts.length),
			2400,
		);
		return () => clearInterval(timer);
	}, []);

	return (
		<span className="relative inline-flex h-[1.12em] overflow-hidden align-bottom">
			<AnimatePresence mode="wait">
				<motion.span
					key={rotatingContexts[index]}
					className="inline-block"
					initial={{ y: "100%", opacity: 0 }}
					animate={{ y: "0%", opacity: 1 }}
					exit={{ y: "-110%", opacity: 0 }}
					transition={{ duration: 0.4, ease }}
				>
					{rotatingContexts[index]}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}

function GradientOrb({
	className,
	delay = 0,
}: {
	className?: string;
	delay?: number;
}) {
	return (
		<motion.div
			className={cn(
				"pointer-events-none absolute rounded-full blur-[100px]",
				className,
			)}
			animate={{
				x: [0, 30, -20, 0],
				y: [0, -20, 30, 0],
				scale: [1, 1.15, 0.9, 1],
			}}
			transition={{
				duration: 12,
				repeat: Number.POSITIVE_INFINITY,
				ease: "easeInOut",
				delay,
			}}
		/>
	);
}

function FloatingDots() {
	const dots = useMemo(() => generateFloatingDots(), []);

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			{dots.map((dot) => (
				<motion.div
					key={dot.id}
					className="absolute rounded-full bg-black/[0.04]"
					style={{
						left: `${dot.x}%`,
						top: `${dot.y}%`,
						width: dot.size,
						height: dot.size,
					}}
					animate={{
						y: [0, -15, 0],
						opacity: [0.3, 0.7, 0.3],
					}}
					transition={{
						duration: dot.duration,
						repeat: Number.POSITIVE_INFINITY,
						ease: "easeInOut",
						delay: dot.delay,
					}}
				/>
			))}
		</div>
	);
}

/* ─────────────────────── Hero Product Mock ─────────────────────── */

/**
 * MockAgentChat — visual stand-in for the agent chat surface. Shows an
 * external coding agent (Codex) running a real task with the first-class
 * tool rendering Harness ships: a plan checklist, a terminal command, and
 * a file diff. Not interactive.
 */
function MockAgentChat() {
	const ref = useRef<HTMLDivElement>(null);
	const isInView = useInView(ref, { once: true, margin: "-60px" });

	return (
		<div ref={ref} className="relative w-full max-w-[470px]">
			<div className="absolute -inset-6 -z-10 bg-black/[0.015] blur-3xl" />
			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={isInView ? { opacity: 1, y: 0 } : {}}
				transition={{ duration: 0.6, ease }}
				className="border border-black/[0.08] bg-white shadow-[0_24px_64px_-32px_rgba(0,0,0,0.18)]"
			>
				{/* Header — agent identity + active harness */}
				<div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2.5">
					<div className="flex h-6 w-6 items-center justify-center bg-black">
						<OpenAILogo size={13} className="text-white" />
					</div>
					<div className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
						<span className="font-medium">Codex CLI</span>
						<span className="text-black/30">·</span>
						<span className="flex items-center gap-1 bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-black/65">
							<Workflow size={9} />
							Backend Ops
						</span>
					</div>
					<div className="flex items-center gap-1 text-[10px] text-black/40">
						<div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
						<span>sandbox</span>
					</div>
				</div>

				{/* Messages */}
				<div className="space-y-3 px-4 py-4 text-[12px] leading-relaxed">
					<motion.div
						initial={{ opacity: 0, y: 6 }}
						animate={isInView ? { opacity: 1, y: 0 } : {}}
						transition={{ duration: 0.4, delay: 0.35, ease }}
						className="ml-auto max-w-[85%] bg-[#fafafa] px-3 py-2 text-black/80"
					>
						The auth test is failing in CI. Find it and fix it.
					</motion.div>

					<motion.div
						initial={{ opacity: 0, y: 6 }}
						animate={isInView ? { opacity: 1, y: 0 } : {}}
						transition={{ duration: 0.4, delay: 0.8, ease }}
						className="space-y-2"
					>
						<MockPlan />
						<MockTerminal />
						<MockDiff />

						<div className="text-black/85">
							Fixed — the token refresh compared timestamps without the
							clock-skew window. Tests pass.
						</div>
						<MockStreamingDot />
					</motion.div>
				</div>

				{/* Composer with harness switcher hint */}
				<div className="border-t border-black/[0.06] px-3 py-2">
					<div className="flex items-center gap-2 text-[10px] text-black/40">
						<span className="flex items-center gap-1 border border-black/[0.08] px-2 py-1">
							<OpenAILogo size={10} />
							Codex
						</span>
						<span className="flex items-center gap-1 border border-black/[0.08] px-2 py-1">
							<Workflow size={9} />
							Backend Ops
						</span>
						<span className="ml-auto">⌘K to switch</span>
					</div>
				</div>
			</motion.div>
		</div>
	);
}

function MockPlan() {
	const items = [
		{ label: "Locate the failing auth test", done: true },
		{ label: "Reproduce in the sandbox", done: true },
		{ label: "Patch the token refresh", active: true },
	];
	return (
		<div className="border border-black/[0.06] bg-[#fafafa] px-2.5 py-2">
			<div className="mb-1 flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-black/45">
				<Workflow size={9} />
				Plan
				<span className="ml-auto tracking-normal">2/3</span>
			</div>
			<div className="space-y-0.5">
				{items.map((it) => (
					<div
						key={it.label}
						className="flex items-center gap-1.5 text-[10.5px]"
					>
						{it.done ? (
							<Check size={9} className="shrink-0 text-emerald-600" />
						) : (
							<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-black/40" />
						)}
						<span
							className={
								it.done ? "text-black/40 line-through" : "text-black/80"
							}
						>
							{it.label}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function MockTerminal() {
	return (
		<div className="overflow-hidden bg-[#0a0a0a] font-mono text-[10px]">
			<div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-1 text-white/80">
				<SquareTerminal size={10} className="text-emerald-400" />
				<span className="text-white/40">$</span>
				<span>pytest tests/auth -x</span>
			</div>
			<div className="space-y-0.5 px-2.5 py-1.5 text-white/55">
				<div>
					tests/auth/test_refresh.py::test_skew{" "}
					<span className="text-red-400">FAILED</span>
				</div>
				<div className="text-white/35">AssertionError: token expired early</div>
			</div>
		</div>
	);
}

function MockDiff() {
	return (
		<div className="overflow-hidden border border-black/[0.08] font-mono text-[10px]">
			<div className="flex items-center gap-1.5 bg-[#fafafa] px-2.5 py-1 text-black/55">
				<FileDiff size={10} />
				app/auth/refresh.py
			</div>
			<div>
				<div className="bg-red-500/10 px-2.5 text-red-600">
					- if now &gt; token.expires_at:
				</div>
				<div className="bg-emerald-500/10 px-2.5 text-emerald-700">
					+ if now &gt; token.expires_at + SKEW:
				</div>
			</div>
		</div>
	);
}

function MockStreamingDot() {
	return (
		<div className="flex items-center gap-1">
			{[0, 0.15, 0.3].map((delay) => (
				<motion.div
					key={delay}
					className="h-1.5 w-1.5 rounded-full bg-black/30"
					animate={{ opacity: [0.3, 1, 0.3] }}
					transition={{
						duration: 1.2,
						repeat: Number.POSITIVE_INFINITY,
						delay,
						ease: "easeInOut",
					}}
				/>
			))}
		</div>
	);
}

/* ─────────── Context-switch mock (the bread & butter) ─────────── */

const HARNESS_CONFIGS = [
	{
		name: "Research",
		tools: ["DeepWiki", "Exa", "Context7"],
	},
	{
		name: "GitHub Ops",
		tools: ["GitHub", "Linear", "Notion"],
	},
] as const;

/**
 * MockContextSwitch — animates the harness switcher cycling between two MCP
 * configurations on the same live agent, illustrating that the toolset
 * swaps instantly while the conversation continues.
 */
function MockContextSwitch() {
	const ref = useRef<HTMLDivElement>(null);
	const isInView = useInView(ref, { margin: "-80px" });
	const [active, setActive] = useState(0);

	useEffect(() => {
		if (!isInView) return;
		const timer = setInterval(
			() => setActive((a) => (a + 1) % HARNESS_CONFIGS.length),
			2600,
		);
		return () => clearInterval(timer);
	}, [isInView]);

	const config = HARNESS_CONFIGS[active];

	return (
		<div
			ref={ref}
			className="border border-black/[0.08] bg-white shadow-[0_24px_64px_-32px_rgba(0,0,0,0.18)]"
		>
			{/* Header with the live harness switcher */}
			<div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2.5 text-[11px]">
				<div className="flex h-6 w-6 items-center justify-center bg-black">
					<ClaudeLogo size={13} className="text-white" />
				</div>
				<span className="font-medium">Claude Code</span>
				<span className="text-black/30">·</span>
				<div className="relative flex items-center gap-1 bg-black/[0.05] px-2 py-0.5">
					<Workflow size={10} className="text-black/50" />
					<AnimatePresence mode="wait">
						<motion.span
							key={config.name}
							initial={{ y: 6, opacity: 0 }}
							animate={{ y: 0, opacity: 1 }}
							exit={{ y: -6, opacity: 0 }}
							transition={{ duration: 0.25, ease }}
							className="font-medium text-black/80"
						>
							{config.name}
						</motion.span>
					</AnimatePresence>
					<Repeat size={9} className="ml-0.5 text-black/40" />
				</div>
				<span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-600">
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
					context kept
				</span>
			</div>

			{/* Tool chips that morph when the harness switches */}
			<div className="px-4 py-4">
				<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-black/40">
					Tools available right now
				</p>
				<div className="flex min-h-[58px] flex-wrap gap-2">
					<AnimatePresence mode="popLayout">
						{config.tools.map((tool) => (
							<motion.span
								key={tool}
								layout
								initial={{ scale: 0.85, opacity: 0 }}
								animate={{ scale: 1, opacity: 1 }}
								exit={{ scale: 0.85, opacity: 0 }}
								transition={{ duration: 0.25, ease }}
								className="flex h-fit items-center gap-1.5 border border-black/[0.08] bg-[#fafafa] px-2.5 py-1.5 text-[11px] text-black/75"
							>
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
								{tool}
							</motion.span>
						))}
					</AnimatePresence>
				</div>

				<div className="mt-3 flex items-center gap-1.5 border-t border-black/[0.06] pt-3 text-[10.5px] text-black/45">
					<MessagesSquare size={11} />
					Same conversation — the agent just picked up a new toolset.
				</div>
			</div>
		</div>
	);
}

/* ─────────────────────── Nav ─────────────────────── */

const NAV_LINKS = [
	["Agents", "agents"],
	["Switching", "switching"],
	["Features", "features"],
	["How It Works", "how-it-works"],
] as const;

function LandingNav() {
	const { isSignedIn } = useAuth();
	const [scrolled, setScrolled] = useState(false);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const fn = () => setScrolled(window.scrollY > 10);
		window.addEventListener("scroll", fn, { passive: true });
		return () => window.removeEventListener("scroll", fn);
	}, []);

	return (
		<header
			className={cn(
				"sticky top-0 z-50 transition-all duration-300",
				scrolled
					? "bg-white/80 shadow-[0_1px_0_rgba(0,0,0,0.06)] backdrop-blur-xl"
					: "bg-white",
			)}
		>
			<div className="mx-auto flex h-16 max-w-[76rem] items-center justify-between px-6 lg:px-12">
				<Link
					to="/"
					className="flex items-center gap-2 text-lg font-semibold tracking-tight text-black"
				>
					<HarnessMark size={22} />
					Harness
				</Link>

				<nav className="hidden items-center gap-7 lg:flex">
					{NAV_LINKS.map(([label, id]) => (
						<a
							key={id}
							href={`#${id}`}
							className="text-[15px] font-medium text-black/70 transition-colors hover:text-black"
						>
							{label}
						</a>
					))}
				</nav>

				<div className="hidden items-center gap-3 lg:flex">
					{isSignedIn ? (
						<Button size="sm" asChild>
							<Link to="/app">
								Open Harness
								<ArrowRight size={14} />
							</Link>
						</Button>
					) : (
						<>
							<Button variant="ghost" size="sm" asChild>
								<Link to="/sign-in">Log in</Link>
							</Button>
							<Button size="sm" asChild>
								<Link to="/sign-up">
									Get Started
									<ArrowRight size={14} />
								</Link>
							</Button>
						</>
					)}
				</div>

				<button
					type="button"
					className="text-black lg:hidden"
					onClick={() => setOpen(!open)}
					aria-label="Toggle menu"
				>
					{open ? <X size={22} /> : <Menu size={22} />}
				</button>
			</div>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.25, ease }}
						className="overflow-hidden border-t border-black/5 bg-white lg:hidden"
					>
						<nav className="flex flex-col gap-1 px-6 py-4">
							{NAV_LINKS.map(([label, id]) => (
								<button
									key={id}
									type="button"
									onClick={() => {
										setOpen(false);
										document
											.getElementById(id)
											?.scrollIntoView({ behavior: "smooth" });
									}}
									className="px-3 py-2.5 text-left text-[15px] font-medium transition-colors hover:bg-black/[0.03]"
								>
									{label}
								</button>
							))}
							<Separator className="my-2" />
							<div className="flex flex-col gap-2 pt-1">
								{isSignedIn ? (
									<Button asChild>
										<Link to="/app" onClick={() => setOpen(false)}>
											Open Harness
											<ArrowRight size={14} />
										</Link>
									</Button>
								) : (
									<>
										<Button variant="ghost" className="justify-start" asChild>
											<Link to="/sign-in" onClick={() => setOpen(false)}>
												Log in
											</Link>
										</Button>
										<Button asChild>
											<Link to="/sign-up" onClick={() => setOpen(false)}>
												Get Started
												<ArrowRight size={14} />
											</Link>
										</Button>
									</>
								)}
							</div>
						</nav>
					</motion.div>
				)}
			</AnimatePresence>
		</header>
	);
}

/* ─────────────────────── Hero Section ─────────────────────── */

function HeroSection() {
	const { isSignedIn } = useAuth();

	return (
		<section className="relative overflow-hidden bg-white pb-16 pt-20 text-black md:pb-24 md:pt-28 lg:pb-28 lg:pt-32">
			<FloatingDots />

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
					<div>
						<motion.div
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, ease }}
						>
							<Badge variant="secondary" className="mb-6 font-medium">
								Bring your own coding agent
							</Badge>
						</motion.div>

						<motion.h1
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.08, ease }}
							className="mb-6 text-[clamp(2.25rem,5vw,4.25rem)] font-medium leading-[1.05] tracking-tight"
							style={{ textWrap: "balance" }}
						>
							Every coding agent. One chat. Every tool.
						</motion.h1>

						<motion.p
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.16, ease }}
							className="mb-8 max-w-[33rem] text-[clamp(1rem,1.8vw,1.125rem)] leading-[1.6] text-black/55"
						>
							Connect Claude Code, Codex, or Cursor. Harness equips them with
							MCP servers and skills — and lets you swap their entire toolset
							mid-conversation, in one click.
						</motion.p>

						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.24, ease }}
							className="flex flex-wrap items-center gap-4"
						>
							<Button size="lg" asChild>
								<Link to={isSignedIn ? "/app" : "/sign-up"}>
									{isSignedIn ? "Open Harness" : "Get Started"}
									<ArrowRight size={16} />
								</Link>
							</Button>
							<Button variant="ghost" size="lg" asChild>
								<a href="#agents">
									See supported agents
									<ArrowRight size={14} />
								</a>
							</Button>
						</motion.div>

						{/* "Works with" agent logo strip */}
						<motion.div
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ duration: 0.6, delay: 0.4, ease }}
							className="mt-10"
						>
							<p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-black/35">
								Works with
							</p>
							<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
								{AGENTS.filter((a) => a.live).map((a) => (
									<span
										key={a.name}
										className="flex items-center gap-2 text-[13px] font-medium text-black/70"
									>
										<a.logo size={16} className="text-black" />
										{a.name}
									</span>
								))}
								<span className="text-[12px] text-black/35">
									+ OpenCode, Gemini soon
								</span>
							</div>
						</motion.div>
					</div>

					<motion.div
						initial={{ opacity: 0, scale: 0.96 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.8, delay: 0.3, ease }}
						className="hidden justify-self-center lg:flex"
					>
						<MockAgentChat />
					</motion.div>
				</div>
			</div>
		</section>
	);
}

/* ─────────────────────── Agents Section ─────────────────────── */

function AgentsSection() {
	return (
		<section
			id="agents"
			className="bg-[#fafafa] pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-32 lg:pt-32"
		>
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<FadeIn>
					<Badge variant="outline" className="mb-5">
						Supported Agents
					</Badge>
					<h2
						className="mb-4 max-w-[34rem] text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight"
						style={{ textWrap: "balance" }}
					>
						Use the agent you already pay for.
					</h2>
					<p className="mb-12 max-w-[34rem] text-[15px] leading-[1.6] text-black/55 md:mb-16">
						No lock-in, no markup. Connect once with your own subscription — the
						agent runs in an isolated cloud sandbox, billed to your account.
						Switch agents whenever you like.
					</p>
				</FadeIn>

				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
					{AGENTS.map((agent, i) => (
						<FadeIn key={agent.name} delay={0.06 * i}>
							<motion.div
								whileHover={agent.live ? { y: -4 } : undefined}
								transition={{ duration: 0.2 }}
								className={cn(
									"relative h-full border bg-white p-5",
									agent.live
										? "border-black/[0.08] hover:shadow-lg hover:shadow-black/[0.04]"
										: "border-black/[0.05] opacity-60",
								)}
							>
								<span
									className={cn(
										"absolute right-3 top-3 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
										agent.live
											? "text-emerald-600"
											: "border border-black/[0.08] text-black/40",
									)}
								>
									{agent.live ? "Live" : "Soon"}
								</span>
								<agent.logo size={26} className="mb-4 text-black" />
								<h3 className="text-[15px] font-medium">{agent.name}</h3>
								<p className="mt-0.5 text-[12px] leading-snug text-black/50">
									{agent.blurb}
								</p>
							</motion.div>
						</FadeIn>
					))}
				</div>

				<FadeIn delay={0.2}>
					<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-black/45">
						<span className="flex items-center gap-1.5">
							<Lock size={12} className="text-emerald-600" />
							Encrypted, write-only credentials
						</span>
						<span className="flex items-center gap-1.5">
							<ShieldCheck size={12} className="text-emerald-600" />
							Runs in an isolated sandbox
						</span>
						<span className="flex items-center gap-1.5">
							<Check size={12} className="text-emerald-600" />
							Or use Harness's built-in models
						</span>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

/* ─────────────────── Context Switching Section ─────────────────── */

function ContextSwitchSection() {
	return (
		<section
			id="switching"
			className="relative overflow-hidden bg-white pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-32 lg:pt-32"
		>
			<GradientOrb
				className="right-[6%] top-[12%] h-80 w-80 bg-black/[0.02]"
				delay={0}
			/>

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
					<FadeIn>
						<div>
							<Badge variant="outline" className="mb-5">
								The bread & butter
							</Badge>
							<h2
								className="mb-4 text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight"
								style={{ textWrap: "balance" }}
							>
								Switch contexts for{" "}
								<span className="text-black/40">
									<RotatingWord />
								</span>{" "}
								without losing your place.
							</h2>
							<p className="mb-6 max-w-[34rem] text-[15px] leading-[1.6] text-black/55">
								A harness bundles a set of MCP servers and skills. Swap from one
								to another mid-conversation and your agent's entire toolset
								changes in a click — the chat keeps going, context intact.
							</p>
							<ul className="space-y-3">
								{[
									"One agent, many tool configurations",
									"Credentials brokered server-side — never in the sandbox",
									"No restart, no re-explaining — the transcript carries over",
								].map((line) => (
									<li
										key={line}
										className="flex items-start gap-2.5 text-[14px] text-black/70"
									>
										<Check
											size={15}
											className="mt-0.5 shrink-0 text-emerald-600"
										/>
										{line}
									</li>
								))}
							</ul>
						</div>
					</FadeIn>

					<FadeIn delay={0.15}>
						<MockContextSwitch />
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

/* ─────────────────────── Features Section ─────────────────────── */

function FeaturesSection() {
	return (
		<section
			id="features"
			className="bg-[#fafafa] pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-32 lg:pt-32"
		>
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<FadeIn>
					<Badge variant="outline" className="mb-5">
						Features
					</Badge>
					<h2
						className="mb-16 max-w-[34rem] text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight md:mb-20"
						style={{ textWrap: "balance" }}
					>
						The control plane for your agents.{" "}
						<span className="text-black/40">Not another model wrapper.</span>
					</h2>
				</FadeIn>

				<div className="grid gap-5 md:grid-cols-3">
					{primaryFeatures.map((f, i) => (
						<FadeIn key={f.title} delay={0.1 * i}>
							<motion.div
								whileHover={{ y: -4 }}
								transition={{ duration: 0.2 }}
								className="h-full"
							>
								<Card className="h-full gap-0 border-black/[0.04] bg-white py-0 shadow-none transition-shadow hover:shadow-lg hover:shadow-black/[0.04]">
									<CardContent className="p-7">
										<motion.div
											className="mb-5 flex h-11 w-11 items-center justify-center border border-black/[0.06] bg-[#fafafa]"
											whileHover={{ scale: 1.1, rotate: 5 }}
											transition={{ duration: 0.2 }}
										>
											<f.icon size={20} strokeWidth={1.5} />
										</motion.div>
										<h3 className="mb-2 text-lg font-medium">{f.title}</h3>
										<p className="text-[15px] leading-[1.6] text-black/55">
											{f.description}
										</p>
									</CardContent>
								</Card>
							</motion.div>
						</FadeIn>
					))}
				</div>

				{/* Secondary features — smaller, denser */}
				<FadeIn delay={0.2}>
					<div className="mt-12 grid gap-4 md:grid-cols-3">
						{secondaryFeatures.map((f) => (
							<div
								key={f.title}
								className="flex gap-3 border border-black/[0.05] bg-white p-5 transition-shadow hover:shadow-md hover:shadow-black/[0.03]"
							>
								<div className="flex h-8 w-8 shrink-0 items-center justify-center border border-black/[0.06] bg-[#fafafa]">
									<f.icon size={14} strokeWidth={1.5} />
								</div>
								<div>
									<h3 className="mb-1 text-[14px] font-medium">{f.title}</h3>
									<p className="text-[13px] leading-[1.55] text-black/55">
										{f.description}
									</p>
								</div>
							</div>
						))}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

/* ─────────────────────── How It Works Section ─────────────────────── */

function HowItWorksSection() {
	const sectionRef = useRef<HTMLDivElement>(null);
	const { scrollYProgress } = useScroll({
		target: sectionRef,
		offset: ["start end", "end start"],
	});
	const lineWidth = useTransform(scrollYProgress, [0.15, 0.55], ["0%", "100%"]);

	return (
		<section
			ref={sectionRef}
			id="how-it-works"
			className="bg-black pb-20 pt-20 text-white md:pb-28 md:pt-28 lg:pb-32 lg:pt-32"
		>
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<FadeIn>
					<Badge
						variant="outline"
						className="mb-5 border-white/10 text-white/60"
					>
						How It Works
					</Badge>
					<h2
						className="mb-16 text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight md:mb-20"
						style={{ textWrap: "balance" }}
					>
						From your agent to your tools in three steps.{" "}
						<span className="text-white/40">No SDK, no editor.</span>
					</h2>
				</FadeIn>

				<div className="relative grid gap-6 md:grid-cols-3">
					<div className="absolute left-0 right-0 top-[22px] z-0 hidden h-[1px] md:block">
						<div className="h-full w-full bg-white/[0.06]" />
						<motion.div
							className="absolute left-0 top-0 h-full bg-gradient-to-r from-white/25 via-white/15 to-transparent"
							style={{ width: lineWidth }}
						/>
					</div>

					{steps.map((s, i) => (
						<FadeIn key={s.title} delay={0.1 * i}>
							<div className="relative">
								<motion.div
									className="relative z-10 mb-6"
									initial={{ scale: 0 }}
									whileInView={{ scale: 1 }}
									viewport={{ once: true }}
									transition={{
										delay: 0.2 + i * 0.12,
										type: "spring",
										stiffness: 200,
										damping: 15,
									}}
								>
									<div className="flex h-11 w-11 items-center justify-center border border-white/[0.1] bg-[#111]">
										<span className="font-mono text-sm font-medium text-white/60">
											{s.num}
										</span>
									</div>
								</motion.div>

								<Card className="gap-0 border-white/[0.06] bg-[#111] py-0 shadow-none">
									<CardContent className="p-6">
										<h3 className="mb-2 text-lg font-medium text-white">
											{s.title}
										</h3>
										<p className="text-[15px] leading-[1.6] text-white/50">
											{s.description}
										</p>
									</CardContent>
								</Card>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

/* ─────────────────────── CTA Section ─────────────────────── */

function CTASection() {
	const { isSignedIn } = useAuth();

	return (
		<section className="relative overflow-hidden bg-white pb-24 pt-24 text-black md:pb-36 md:pt-36 lg:pb-44 lg:pt-44">
			<GradientOrb
				className="left-[10%] top-[15%] h-80 w-80 bg-black/[0.02]"
				delay={0}
			/>
			<GradientOrb
				className="right-[8%] bottom-[10%] h-96 w-96 bg-black/[0.015]"
				delay={3}
			/>

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="mx-auto max-w-2xl text-center">
					<motion.div
						initial={{ opacity: 0, scale: 0.85 }}
						whileInView={{ opacity: 1, scale: 1 }}
						viewport={{ once: true, margin: "-60px" }}
						transition={{ duration: 0.7, ease }}
						className="mb-10"
					>
						<div className="mx-auto flex h-24 w-24 items-center justify-center bg-primary">
							<div className="harness-glow">
								<HarnessMark size={48} className="text-primary-foreground" />
							</div>
						</div>
					</motion.div>

					<FadeIn>
						<h2
							className="mb-6 text-[clamp(1.75rem,4vw,3.5rem)] font-medium leading-[1.1] tracking-tight"
							style={{ textWrap: "balance" }}
						>
							Connect your first agent.
						</h2>
						<p className="mx-auto mb-10 max-w-md text-[15px] leading-[1.6] text-black/55">
							Bring Claude Code, Codex, or Cursor — or start with Harness's
							built-in models. Equip it with tools in minutes.
						</p>
						<div className="flex flex-wrap items-center justify-center gap-4">
							<Button size="lg" asChild>
								<Link to={isSignedIn ? "/app" : "/sign-up"}>
									{isSignedIn ? "Open Harness" : "Get Started"}
									<ArrowRight size={16} />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<a href="#agents">See supported agents</a>
							</Button>
						</div>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

/* ─────────────────────── Footer ─────────────────────── */

function LandingFooter() {
	return (
		<footer className="bg-[#fafafa] py-12 text-black md:py-16">
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid gap-10 sm:grid-cols-12 sm:gap-8">
					<div className="sm:col-span-5">
						<span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
							<HarnessMark size={20} />
							Harness
						</span>
						<p className="mt-2 max-w-[20rem] text-sm leading-relaxed text-black/45">
							The chat and tool control plane for coding agents. Bring Claude
							Code, Codex, or Cursor — equip them with MCP servers and switch
							contexts in one click.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-8 sm:col-span-7 sm:grid-cols-2">
						<div>
							<h3 className="mb-4 text-sm font-medium">Product</h3>
							<ul className="space-y-3">
								{NAV_LINKS.map(([label, id]) => (
									<li key={id}>
										<a
											href={`#${id}`}
											className="text-sm text-black/50 transition-colors hover:text-black"
										>
											{label}
										</a>
									</li>
								))}
							</ul>
						</div>
						<div>
							<h3 className="mb-4 text-sm font-medium">Get started</h3>
							<ul className="space-y-3">
								<li>
									<Link
										to="/sign-up"
										className="text-sm text-black/50 transition-colors hover:text-black"
									>
										Sign up
									</Link>
								</li>
								<li>
									<Link
										to="/sign-in"
										className="text-sm text-black/50 transition-colors hover:text-black"
									>
										Log in
									</Link>
								</li>
							</ul>
						</div>
					</div>
				</div>
				<Separator className="my-8 bg-black/[0.06]" />
				<p className="text-xs text-black/35">
					&copy; 2026 Harness. All rights reserved.
				</p>
			</div>
		</footer>
	);
}

/* ─────────────────────── Main Page ─────────────────────── */

function LandingPage() {
	return (
		<div className="min-h-screen bg-white">
			<LandingNav />
			<main>
				<HeroSection />
				<AgentsSection />
				<ContextSwitchSection />
				<FeaturesSection />
				<HowItWorksSection />
				<CTASection />
			</main>
			<LandingFooter />
		</div>
	);
}
