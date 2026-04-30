import { useAuth } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	FolderTree,
	GitBranch,
	GraduationCap,
	Layers,
	Menu,
	Plug,
	Plus,
	Server,
	Sparkles,
	TerminalSquare,
	Wallet,
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
			{ title: "Harness — One chat, every tool your agent needs" },
			{
				name: "description",
				content:
					"Bundle your model, MCP servers, skills, and a live sandbox into a harness. Switch from coding to research to coursework in one click.",
			},
		],
	}),
});

/* ─────────────────────── Constants ─────────────────────── */

const rotatingWords = [
	"code review",
	"course planning",
	"deep research",
	"weekly notes",
];

const primaryFeatures = [
	{
		icon: Layers,
		title: "One agent, many contexts",
		description:
			"A harness saves your model, system prompt, MCPs, skills, and sandbox. Switch from a coding agent to a research agent in one click.",
	},
	{
		icon: Plug,
		title: "Plug in any tool",
		description:
			"Twelve MCPs in the catalog — GitHub, Notion, Linear, Slack, Jira, plus four built for Princeton students. OAuth handled. Custom URLs welcome.",
	},
	{
		icon: TerminalSquare,
		title: "Real code, not just chat",
		description:
			"Each harness can attach a Daytona-backed sandbox: file explorer, terminal, git. Your agent edits, runs, and ships — you watch it land.",
	},
];

const secondaryFeatures = [
	{
		icon: Sparkles,
		title: "Skills from skills.sh",
		description:
			"Pull battle-tested instructions for code review, debugging, web search, PDFs. Your agent learns your team's playbook on import.",
	},
	{
		icon: Server,
		title: "Slash commands & rich attachments",
		description:
			"Every MCP tool becomes a / command. Drop in images, PDFs, audio. Streaming reasoning across Claude, GPT, and Gemini.",
	},
	{
		icon: Wallet,
		title: "Transparent budgets",
		description:
			"Daily and weekly cost caps with per-model and per-harness breakdowns. No surprise bills at the end of the month.",
	},
];

const steps = [
	{
		num: "01",
		title: "Configure",
		description:
			"Name a harness. Pick a model — Claude, GPT, or Gemini. Attach the MCPs and skills your agent needs. Optionally add a Daytona sandbox.",
	},
	{
		num: "02",
		title: "Connect",
		description:
			"OAuth into GitHub, Notion, Linear, or any provider in one popup. Tokens are stored encrypted and refreshed on demand — no manual key wrangling.",
	},
	{
		num: "03",
		title: "Chat",
		description:
			"Streaming reasoning, slash commands, tool calls, attachments, and live sandbox output — all in one conversation.",
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
			() => setIndex((i) => (i + 1) % rotatingWords.length),
			2400,
		);
		return () => clearInterval(timer);
	}, []);

	return (
		<span className="relative inline-flex h-[1.12em] overflow-hidden align-bottom">
			<AnimatePresence mode="wait">
				<motion.span
					key={rotatingWords[index]}
					className="inline-block"
					initial={{ y: "100%", opacity: 0 }}
					animate={{ y: "0%", opacity: 1 }}
					exit={{ y: "-110%", opacity: 0 }}
					transition={{ duration: 0.4, ease }}
				>
					{rotatingWords[index]}
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

/* ─────────────────────── Product Mocks ─────────────────────── */

/**
 * MockChatPanel — visual stand-in for the real chat surface, used in the hero.
 * Not interactive. Shows a generic issue-triage agent example wired to GitHub
 * + Linear MCPs to highlight the agent → tool-call → answer loop.
 */
function MockChatPanel() {
	const ref = useRef<HTMLDivElement>(null);
	const isInView = useInView(ref, { once: true, margin: "-60px" });

	return (
		<div ref={ref} className="relative w-full max-w-[460px]">
			<div className="absolute -inset-6 -z-10 bg-black/[0.015] blur-3xl" />
			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={isInView ? { opacity: 1, y: 0 } : {}}
				transition={{ duration: 0.6, ease }}
				className="border border-black/[0.08] bg-white shadow-[0_24px_64px_-32px_rgba(0,0,0,0.18)]"
			>
				{/* Header */}
				<div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2.5">
					<div className="flex h-6 w-6 items-center justify-center bg-black">
						<HarnessMark size={12} className="text-white" />
					</div>
					<div className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
						<span className="font-medium">Issue triage agent</span>
						<span className="text-black/30">·</span>
						<span className="text-black/50">claude-sonnet-4.6</span>
					</div>
					<div className="flex items-center gap-1 text-[10px] text-black/40">
						<div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
						<span>3 MCPs</span>
					</div>
				</div>

				{/* Messages */}
				<div className="space-y-3 px-4 py-4 text-[12px] leading-relaxed">
					<motion.div
						initial={{ opacity: 0, y: 6 }}
						animate={isInView ? { opacity: 1, y: 0 } : {}}
						transition={{ duration: 0.4, delay: 0.4, ease }}
						className="ml-auto max-w-[85%] bg-[#fafafa] px-3 py-2 text-black/80"
					>
						Pull this week's open auth-related bug reports and file the
						highest-signal ones in Linear.
					</motion.div>

					<motion.div
						initial={{ opacity: 0, y: 6 }}
						animate={isInView ? { opacity: 1, y: 0 } : {}}
						transition={{ duration: 0.4, delay: 0.9, ease }}
						className="space-y-2"
					>
						<MockToolCall
							server="github"
							tool="search_issues"
							arg="auth is:open"
							ms={142}
						/>
						<MockToolCall
							server="linear"
							tool="create_issue"
							arg="Auth: SSO token refresh"
							ms={268}
						/>

						<div className="text-black/85">
							Found 7 open issues mentioning auth. The top theme — SSO token
							refresh failing — appears in{" "}
							<span className="font-medium">4 reports</span>. Filed{" "}
							<span className="bg-emerald-500/10 px-1 text-emerald-700">
								LIN-481
							</span>{" "}
							and grouped the long tail under{" "}
							<span className="font-medium">LIN-482</span>.
						</div>

						<MockStreamingDot />
					</motion.div>
				</div>

				{/* Composer with slash hint */}
				<div className="border-t border-black/[0.06] px-3 py-2">
					<div className="flex items-center gap-2 border border-black/[0.08] bg-white px-2.5 py-1.5">
						<span className="font-mono text-[11px] text-emerald-600">/</span>
						<span className="font-mono text-[11px] text-black/45">
							linear_create_issue
						</span>
						<span className="ml-auto text-[10px] text-black/30">↵ run</span>
					</div>
				</div>
			</motion.div>
		</div>
	);
}

function MockToolCall({
	server,
	tool,
	arg,
	ms,
}: {
	server: string;
	tool: string;
	arg: string;
	ms: number;
}) {
	return (
		<div className="flex items-center gap-2 border border-black/[0.06] bg-[#fafafa] px-2 py-1.5 font-mono text-[10.5px]">
			<Check size={10} className="shrink-0 text-emerald-600" />
			<span className="text-black/55">{server}</span>
			<span className="text-black/30">·</span>
			<span className="text-black/80">{tool}</span>
			<span className="truncate text-black/40">("{arg}")</span>
			<span className="ml-auto shrink-0 text-black/35">{ms}ms</span>
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

/**
 * MockMcpPopover — visual stand-in for the new inline MCP add popover.
 * Mirrors the real component (mcp-server-status.tsx) at a glance.
 */
function MockMcpPopover() {
	return (
		<div className="border border-black/[0.08] bg-white shadow-[0_16px_48px_-20px_rgba(0,0,0,0.18)]">
			<div className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2">
				<span className="flex-1 text-[10px] font-medium uppercase tracking-wider text-black/50">
					MCP Servers
				</span>
				<div className="flex h-4 w-4 items-center justify-center text-black/50">
					<Plus size={11} />
				</div>
			</div>
			<div className="py-1">
				{[
					{ name: "GitHub", status: "Connected", badge: "OAuth", oauth: true },
					{
						name: "TigerJunction",
						status: "Connected",
						badge: "Princeton",
						princeton: true,
					},
					{
						name: "Context7",
						status: "Connected",
						badge: "Public",
					},
					{ name: "Notion", status: "Token expired", warn: true },
				].map((s) => (
					<div
						key={s.name}
						className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
					>
						<div
							className={`h-1.5 w-1.5 shrink-0 rounded-full ${
								s.warn ? "bg-amber-400" : "bg-emerald-500"
							}`}
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate font-medium text-black/85">{s.name}</div>
							<div className="text-[10px] text-black/45">{s.status}</div>
						</div>
						{s.badge && (
							<span className="flex shrink-0 items-center gap-0.5 bg-black/[0.05] px-1.5 py-0.5 text-[9px] text-black/65">
								{s.princeton && <GraduationCap size={8} />}
								{s.oauth && (
									<span className="h-1 w-1 rounded-full bg-emerald-500" />
								)}
								{s.badge}
							</span>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * MockSlashPalette — visual stand-in for the / command palette.
 */
function MockSlashPalette() {
	const commands = [
		{ name: "github_search_repositories", desc: "Search public + your repos" },
		{ name: "notion_create_page", desc: "Create a page in a database" },
		{ name: "linear_create_issue", desc: "Open an issue in your team" },
		{
			name: "tigerjunction_search_courses",
			desc: "Find Princeton courses by name",
		},
		{ name: "exa_search", desc: "Semantic web search" },
	];
	return (
		<div className="border border-black/[0.08] bg-white shadow-[0_16px_48px_-20px_rgba(0,0,0,0.18)]">
			<div className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2 font-mono text-[11px]">
				<span className="text-emerald-600">/</span>
				<span className="text-black/85">github</span>
				<span className="ml-auto text-[9px] uppercase tracking-wider text-black/35">
					commands
				</span>
			</div>
			<div className="py-1">
				{commands.map((c, i) => (
					<div
						key={c.name}
						className={`flex items-center gap-2 px-3 py-1.5 ${
							i === 0 ? "bg-black/[0.03]" : ""
						}`}
					>
						<span
							className={`shrink-0 font-mono text-[11px] ${
								i === 0 ? "text-emerald-600" : "text-black/35"
							}`}
						>
							/
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate font-mono text-[11px] text-black/85">
								{c.name}
							</div>
							<div className="truncate text-[10px] text-black/45">{c.desc}</div>
						</div>
						{i === 0 && (
							<span className="shrink-0 text-[9px] text-black/40">↵</span>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * MockSandboxTabs — visual stand-in for the Daytona sandbox panel.
 */
function MockSandboxTabs() {
	const ref = useRef<HTMLDivElement>(null);
	const isInView = useInView(ref, { once: true, margin: "-60px" });
	const lines = [
		{ t: "$", c: "npm test", color: "text-emerald-400" },
		{ t: "→", c: "Test Suites: 12 passed, 12 total", color: "text-white/60" },
		{ t: "→", c: "Tests:       148 passed, 148 total", color: "text-white/60" },
		{ t: "✓", c: "All green. Committing.", color: "text-emerald-400" },
		{
			t: "$",
			c: "git commit -m 'feat: streaming retries'",
			color: "text-emerald-400",
		},
		{
			t: "→",
			c: "[main 2f1e9a0] feat: streaming retries",
			color: "text-white/60",
		},
	];

	return (
		<div
			ref={ref}
			className="border border-black/[0.08] bg-[#0a0a0a] shadow-[0_24px_64px_-28px_rgba(0,0,0,0.45)]"
		>
			{/* Tab strip */}
			<div className="flex items-center border-b border-white/[0.06] px-1 py-1">
				{[
					{ icon: FolderTree, label: "Files" },
					{ icon: TerminalSquare, label: "Terminal", active: true },
					{ icon: GitBranch, label: "Git" },
				].map((tab) => (
					<div
						key={tab.label}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] ${
							tab.active ? "bg-white/[0.06] text-white" : "text-white/40"
						}`}
					>
						<tab.icon size={11} />
						{tab.label}
					</div>
				))}
				<span className="ml-auto px-2 text-[10px] text-white/30">
					sandbox · running
				</span>
			</div>

			{/* Terminal body */}
			<div className="space-y-1 px-4 py-3 font-mono text-[11px] leading-relaxed">
				{lines.map((line, i) => (
					<motion.div
						key={`${line.t}-${line.c}`}
						initial={{ opacity: 0, x: -8 }}
						animate={isInView ? { opacity: 1, x: 0 } : {}}
						transition={{ duration: 0.35, delay: 0.2 + i * 0.18, ease }}
					>
						<span className="mr-2 text-white/25">{line.t}</span>
						<span className={line.color}>{line.c}</span>
					</motion.div>
				))}
				<motion.div
					initial={{ opacity: 0 }}
					animate={isInView ? { opacity: 1 } : {}}
					transition={{ delay: lines.length * 0.18 + 0.3 }}
				>
					<span className="mr-2 text-white/25">$</span>
					<span className="inline-block h-3 w-[6px] translate-y-[2px] animate-pulse bg-emerald-400/80" />
				</motion.div>
			</div>
		</div>
	);
}

/* ─────────────────────── Nav ─────────────────────── */

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
					<a
						href="#features"
						className="text-[15px] font-medium text-black/70 transition-colors hover:text-black"
					>
						Features
					</a>
					<a
						href="#product"
						className="text-[15px] font-medium text-black/70 transition-colors hover:text-black"
					>
						Product
					</a>
					<a
						href="#how-it-works"
						className="text-[15px] font-medium text-black/70 transition-colors hover:text-black"
					>
						How It Works
					</a>
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
							{[
								["Features", "features"],
								["Product", "product"],
								["How It Works", "how-it-works"],
							].map(([label, id]) => (
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
		<section className="relative overflow-hidden bg-white pb-16 pt-20 text-black md:pb-24 md:pt-28 lg:pb-32 lg:pt-36">
			<FloatingDots />

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
					<div>
						<motion.div
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, ease }}
						>
							<Badge variant="secondary" className="mb-6 font-medium">
								AI toolkit, not a platform
							</Badge>
						</motion.div>

						<motion.h1
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.08, ease }}
							className="mb-6 text-[clamp(2.25rem,5vw,4.5rem)] font-medium leading-[1.05] tracking-tight"
							style={{ textWrap: "balance" }}
						>
							Equip your AI agent for <RotatingWord />.
						</motion.h1>

						<motion.p
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.16, ease }}
							className="mb-10 max-w-[32rem] text-[clamp(1rem,1.8vw,1.125rem)] leading-[1.6] text-black/55"
						>
							A harness bundles your model, MCP servers, skills, and a live
							sandbox. Switch contexts in one click — your agent gets a
							different brain for every job.
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
								<a href="#product">
									See it in action
									<ArrowRight size={14} />
								</a>
							</Button>
						</motion.div>

						<motion.div
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ duration: 0.6, delay: 0.4, ease }}
							className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-black/45"
						>
							<span className="flex items-center gap-1.5">
								<Check size={12} className="text-emerald-600" />
								Bring your own MCPs
							</span>
							<span className="flex items-center gap-1.5">
								<Check size={12} className="text-emerald-600" />
								Daily + weekly cost caps
							</span>
							<span className="flex items-center gap-1.5">
								<Check size={12} className="text-emerald-600" />
								Princeton-ready
							</span>
						</motion.div>
					</div>

					<motion.div
						initial={{ opacity: 0, scale: 0.96 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.8, delay: 0.3, ease }}
						className="hidden justify-self-center lg:flex"
					>
						<MockChatPanel />
					</motion.div>
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
			className="bg-[#fafafa] pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-36 lg:pt-36"
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
						Built for the agent you actually use.{" "}
						<span className="text-black/40">
							Not the demo your boss saw on Twitter.
						</span>
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

/* ─────────────────────── Product Mocks Section ─────────────────────── */

function ProductSection() {
	return (
		<section
			id="product"
			className="relative overflow-hidden bg-white pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-36 lg:pt-36"
		>
			<GradientOrb
				className="left-[5%] top-[10%] h-80 w-80 bg-black/[0.02]"
				delay={0}
			/>
			<GradientOrb
				className="right-[5%] bottom-[10%] h-64 w-64 bg-black/[0.015]"
				delay={4}
			/>

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<FadeIn>
					<Badge variant="outline" className="mb-5">
						The Product
					</Badge>
					<h2
						className="mb-4 max-w-[36rem] text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight"
						style={{ textWrap: "balance" }}
					>
						Three real surfaces.{" "}
						<span className="text-black/40">No mockups.</span>
					</h2>
					<p className="mb-16 max-w-[36rem] text-[15px] leading-[1.6] text-black/55 md:mb-20">
						This is what you'll see five minutes after signup — the same UI we
						use every day.
					</p>
				</FadeIn>

				<div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
					<FadeIn delay={0.05}>
						<div>
							<p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-black/40">
								MCP Status & Add
							</p>
							<h3 className="mb-3 text-xl font-medium tracking-tight">
								Add servers without leaving the chat.
							</h3>
							<p className="mb-6 max-w-md text-[14px] leading-[1.6] text-black/55">
								Click the MCP indicator in the header. Pick from the catalog or
								paste a custom URL. OAuth pops automatically. Status badges
								update live.
							</p>
							<div className="max-w-[300px]">
								<MockMcpPopover />
							</div>
						</div>
					</FadeIn>

					<FadeIn delay={0.15}>
						<div>
							<p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-black/40">
								Slash Command Palette
							</p>
							<h3 className="mb-3 text-xl font-medium tracking-tight">
								Every MCP tool. One keystroke away.
							</h3>
							<p className="mb-6 max-w-md text-[14px] leading-[1.6] text-black/55">
								Type <span className="font-mono text-black/80">/</span> to
								filter across every connected server's tools. Keyboard-first,
								typo-forgiving, scoped to the active harness.
							</p>
							<div className="max-w-[380px]">
								<MockSlashPalette />
							</div>
						</div>
					</FadeIn>

					<FadeIn delay={0.2} className="lg:col-span-2">
						<div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12 lg:items-center">
							<div>
								<p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-black/40">
									Live Sandbox
								</p>
								<h3 className="mb-3 text-xl font-medium tracking-tight">
									A real dev environment, attached to the chat.
								</h3>
								<p className="max-w-md text-[14px] leading-[1.6] text-black/55">
									Daytona-backed sandboxes give your agent file editing, a real
									terminal, and git — persistent across sessions. Watch tests
									pass before the agent commits.
								</p>
							</div>
							<MockSandboxTabs />
						</div>
					</FadeIn>
				</div>
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
			className="bg-black pb-20 pt-20 text-white md:pb-28 md:pt-28 lg:pb-36 lg:pt-36"
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
						Three minutes from signup to first answer.{" "}
						<span className="text-white/40">No SDK to install.</span>
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
							Build your first harness.
						</h2>
						<p className="mx-auto mb-10 max-w-md text-[15px] leading-[1.6] text-black/55">
							Free to try. Bring your own MCPs and your own model preferences.
							Three minutes to your first answer.
						</p>
						<div className="flex flex-wrap items-center justify-center gap-4">
							<Button size="lg" asChild>
								<Link to={isSignedIn ? "/app" : "/sign-up"}>
									{isSignedIn ? "Open Harness" : "Get Started"}
									<ArrowRight size={16} />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<a href="#features">See features</a>
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
						<p className="mt-2 max-w-[18rem] text-sm leading-relaxed text-black/45">
							The toolkit for AI agents. Bundle your model, MCPs, skills, and a
							live sandbox into one chat.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-8 sm:col-span-7 sm:grid-cols-2">
						<div>
							<h3 className="mb-4 text-sm font-medium">Product</h3>
							<ul className="space-y-3">
								<li>
									<a
										href="#features"
										className="text-sm text-black/50 transition-colors hover:text-black"
									>
										Features
									</a>
								</li>
								<li>
									<a
										href="#product"
										className="text-sm text-black/50 transition-colors hover:text-black"
									>
										Product
									</a>
								</li>
								<li>
									<a
										href="#how-it-works"
										className="text-sm text-black/50 transition-colors hover:text-black"
									>
										How it works
									</a>
								</li>
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
				<FeaturesSection />
				<ProductSection />
				<HowItWorksSection />
				<CTASection />
			</main>
			<LandingFooter />
		</div>
	);
}
