import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	ArrowRight,
	Code,
	Database,
	Globe,
	Layers,
	Menu,
	MessageSquare,
	Terminal,
	X,
	Zap,
} from "lucide-react";
import {
	AnimatePresence,
	motion,
	useInView,
	useScroll,
	useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/")({
	component: LandingPage,
	head: () => ({
		meta: [
			{ title: "Harness — The toolkit for AI agents" },
			{
				name: "description",
				content:
					"Create, manage, and deploy custom tool configurations for AI agents. Switch contexts in seconds.",
			},
		],
	}),
});

/* ─────────────────────── Constants ─────────────────────── */

const rotatingWords = [
	"anything",
	"coding",
	"research",
	"browsing",
	"learning",
];

const features = [
	{
		icon: ArrowLeftRight,
		title: "Instant Context Switching",
		description:
			"Swap between agent profiles on the fly. Go from coding to research to browsing — without missing a beat.",
	},
	{
		icon: MessageSquare,
		title: "Unified Chat Interface",
		description:
			"Talk to your configured agents through a powerful chat interface. Every tool at your fingertips, one conversation away.",
	},
	{
		icon: Code,
		title: "Developer-First API",
		description:
			"Access your harnesses programmatically through a clean REST API. Build downstream applications with our SDK.",
	},
];

const steps = [
	{
		num: "01",
		title: "Configure",
		description:
			"Define your harness with the tools, MCPs, and environments your agent needs.",
	},
	{
		num: "02",
		title: "Deploy",
		description:
			"We handle provisioning and orchestration. Your harness goes live instantly.",
	},
	{
		num: "03",
		title: "Use",
		description:
			"Chat with your agent or integrate via API. Fully equipped, ready to go.",
	},
];

const toolNodes = [
	{ icon: Globe, label: "Browser" },
	{ icon: Terminal, label: "Terminal" },
	{ icon: Code, label: "Editor" },
	{ icon: Database, label: "Storage" },
	{ icon: Zap, label: "API" },
	{ icon: Layers, label: "MCP" },
];

const terminalLines: {
	prefix: string;
	text: string;
	color: string;
}[] = [
	{
		prefix: "$",
		text: "harness deploy --profile coding",
		color: "text-emerald-400",
	},
	{
		prefix: "→",
		text: "Loading tools: editor, terminal, git",
		color: "text-white/60",
	},
	{
		prefix: "→",
		text: "MCP servers: 3 connected",
		color: "text-white/60",
	},
	{
		prefix: "✓",
		text: "Agent equipped. Ready.",
		color: "text-emerald-400",
	},
	{ prefix: "", text: "", color: "" },
	{
		prefix: "$",
		text: "harness switch research",
		color: "text-emerald-400",
	},
	{
		prefix: "→",
		text: "Switching context...",
		color: "text-white/60",
	},
	{
		prefix: "✓",
		text: "Research profile active. 4 tools loaded.",
		color: "text-emerald-400",
	},
];

const ease = [0.16, 1, 0.3, 1] as const;

/* ─────────────────────── Logo ─────────────────────── */

function HarnessMark({
	size = 24,
	className,
}: {
	size?: number;
	className?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			<path d="M7 4v16" strokeWidth="2.5" />
			<path d="M17 4v16" strokeWidth="2.5" />
			<path d="M7 12 C9.5 8, 14.5 8, 17 12" strokeWidth="2" />
			<path d="M7 12 C9.5 16, 14.5 16, 17 12" strokeWidth="2" />
		</svg>
	);
}

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

/* ─────────────────────── Animated Graphics ─────────────────────── */

function NetworkGraph() {
	const containerRef = useRef<HTMLDivElement>(null);
	const isInView = useInView(containerRef, { once: true, margin: "-80px" });

	const nodeCount = toolNodes.length;
	const radius = 135;
	const center = { x: 200, y: 200 };

	const positions = toolNodes.map((_, i) => {
		const angle = (i * 2 * Math.PI) / nodeCount - Math.PI / 2;
		return {
			x: center.x + radius * Math.cos(angle),
			y: center.y + radius * Math.sin(angle),
		};
	});

	return (
		<div
			ref={containerRef}
			className="relative mx-auto aspect-square w-full max-w-[440px]"
		>
			<div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.015] blur-[80px]" />

			<svg
				viewBox="0 0 400 400"
				className="absolute inset-0 h-full w-full"
				fill="none"
				role="img"
				aria-label="Animated network graph showing AI agent connected to tools"
			>
				{positions.map((pos, i) => (
					<g key={toolNodes[i].label}>
						<motion.path
							d={`M${center.x},${center.y} L${pos.x},${pos.y}`}
							stroke="rgba(0,0,0,0.07)"
							strokeWidth="1"
							initial={{ pathLength: 0, opacity: 0 }}
							animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
							transition={{
								duration: 1,
								delay: 0.4 + i * 0.1,
								ease: "easeOut",
							}}
						/>

						{isInView && (
							<circle r="2.5" fill="rgba(0,0,0,0.12)">
								<animateMotion
									dur={`${2.5 + i * 0.3}s`}
									repeatCount="indefinite"
									begin={`${1.5 + i * 0.1}s`}
									path={`M${center.x},${center.y} L${pos.x},${pos.y}`}
								/>
							</circle>
						)}

						{isInView && (
							<circle r="1.8" fill="rgba(0,0,0,0.06)">
								<animateMotion
									dur={`${3.2 + i * 0.4}s`}
									repeatCount="indefinite"
									begin={`${2 + i * 0.2}s`}
									path={`M${pos.x},${pos.y} L${center.x},${center.y}`}
								/>
							</circle>
						)}
					</g>
				))}

				{isInView &&
					[0, 1.5].map((delay) => (
						<circle
							key={delay}
							cx={center.x}
							cy={center.y}
							r="28"
							fill="none"
							stroke="rgba(0,0,0,0.05)"
							strokeWidth="1"
						>
							<animate
								attributeName="r"
								from="28"
								to="70"
								dur="3s"
								begin={`${delay}s`}
								repeatCount="indefinite"
							/>
							<animate
								attributeName="opacity"
								from="0.3"
								to="0"
								dur="3s"
								begin={`${delay}s`}
								repeatCount="indefinite"
							/>
						</circle>
					))}
			</svg>

			<motion.div
				className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
				initial={{ scale: 0, opacity: 0 }}
				animate={isInView ? { scale: 1, opacity: 1 } : {}}
				transition={{ duration: 0.5, delay: 0.15, ease }}
			>
				<div className="flex h-16 w-16 items-center justify-center bg-primary shadow-xl shadow-primary/20">
					<HarnessMark size={28} className="text-primary-foreground" />
				</div>
			</motion.div>

			{toolNodes.map((node, i) => {
				const pos = positions[i];
				const pctLeft = (pos.x / 400) * 100;
				const pctTop = (pos.y / 400) * 100;

				return (
					<motion.div
						key={node.label}
						className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
						style={{ left: `${pctLeft}%`, top: `${pctTop}%` }}
						initial={{ scale: 0, opacity: 0 }}
						animate={isInView ? { scale: 1, opacity: 1 } : {}}
						transition={{ duration: 0.4, delay: 0.6 + i * 0.08, ease }}
					>
						<motion.div
							animate={{ y: [0, -5, 0] }}
							transition={{
								duration: 3 + i * 0.4,
								repeat: Number.POSITIVE_INFINITY,
								ease: "easeInOut",
								delay: i * 0.3,
							}}
						>
							<div className="flex h-12 w-12 items-center justify-center border border-black/[0.06] bg-white shadow-sm transition-shadow hover:shadow-md">
								<node.icon
									size={20}
									strokeWidth={1.5}
									className="text-black/70"
								/>
							</div>
							<p className="mt-1.5 text-center text-[10px] font-medium text-black/40">
								{node.label}
							</p>
						</motion.div>
					</motion.div>
				);
			})}
		</div>
	);
}

function AnimatedTerminal() {
	const ref = useRef<HTMLDivElement>(null);
	const isInView = useInView(ref, { once: true, margin: "-80px" });

	return (
		<div ref={ref} className="mx-auto w-full max-w-2xl">
			<div className="overflow-hidden border border-white/[0.06] bg-[#0a0a0a] shadow-2xl shadow-black/40">
				<div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
					<div className="h-3 w-3 rounded-full bg-white/10" />
					<div className="h-3 w-3 rounded-full bg-white/10" />
					<div className="h-3 w-3 rounded-full bg-white/10" />
					<span className="ml-3 font-mono text-xs text-white/20">terminal</span>
				</div>

				<div className="space-y-1.5 p-5 font-mono text-sm leading-relaxed">
					{terminalLines.map((line) => {
						if (!line.text) {
							return (
								<motion.div
									key="spacer"
									className="h-3"
									initial={{ opacity: 0 }}
									animate={isInView ? { opacity: 1 } : {}}
									transition={{ delay: 1.2 }}
								/>
							);
						}

						return (
							<motion.div
								key={`${line.prefix}-${line.text}`}
								initial={{ opacity: 0, x: -10 }}
								animate={isInView ? { opacity: 1, x: 0 } : {}}
								transition={{
									delay: 0.2 + terminalLines.indexOf(line) * 0.3,
									duration: 0.4,
									ease,
								}}
							>
								<span className="mr-2 text-white/25">{line.prefix}</span>
								<span className={line.color}>{line.text}</span>
							</motion.div>
						);
					})}

					<motion.div
						initial={{ opacity: 0 }}
						animate={isInView ? { opacity: 1 } : {}}
						transition={{ delay: terminalLines.length * 0.3 + 0.5 }}
					>
						<span className="mr-2 text-white/25">$</span>
						<span className="inline-block h-4 w-[7px] translate-y-[2px] animate-pulse bg-emerald-400/80" />
					</motion.div>
				</div>
			</div>
		</div>
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
	const dots = Array.from({ length: 24 }, (_, i) => ({
		id: i,
		x: Math.random() * 100,
		y: Math.random() * 100,
		size: 1.5 + Math.random() * 2,
		duration: 4 + Math.random() * 6,
		delay: Math.random() * 3,
	}));

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

/* ─────────────────────── Nav ─────────────────────── */

function LandingNav() {
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
						href="#how-it-works"
						className="text-[15px] font-medium text-black/70 transition-colors hover:text-black"
					>
						How It Works
					</a>
				</nav>

				<div className="hidden items-center gap-3 lg:flex">
					<Button variant="ghost" size="sm" asChild>
						<Link to="/chat">Log in</Link>
					</Button>
					<Button size="sm" asChild>
						<Link to="/chat">
							Get Started
							<ArrowRight size={14} />
						</Link>
					</Button>
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
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									document
										.getElementById("features")
										?.scrollIntoView({ behavior: "smooth" });
								}}
								className="px-3 py-2.5 text-left text-[15px] font-medium transition-colors hover:bg-black/[0.03]"
							>
								Features
							</button>
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									document
										.getElementById("how-it-works")
										?.scrollIntoView({ behavior: "smooth" });
								}}
								className="px-3 py-2.5 text-left text-[15px] font-medium transition-colors hover:bg-black/[0.03]"
							>
								How It Works
							</button>
							<Separator className="my-2" />
							<div className="flex flex-col gap-2 pt-1">
								<Button variant="ghost" className="justify-start" asChild>
									<Link to="/chat" onClick={() => setOpen(false)}>
										Log in
									</Link>
								</Button>
								<Button asChild>
									<Link to="/chat" onClick={() => setOpen(false)}>
										Get Started
										<ArrowRight size={14} />
									</Link>
								</Button>
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
	return (
		<section className="relative overflow-hidden bg-white pb-16 pt-20 text-black md:pb-24 md:pt-28 lg:pb-32 lg:pt-36">
			<FloatingDots />

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
					<div>
						<motion.div
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, ease }}
						>
							<Badge variant="secondary" className="mb-6 font-medium">
								The Agent Platform
							</Badge>
						</motion.div>

						<motion.h1
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.08, ease }}
							className="mb-6 text-[clamp(2.25rem,5vw,4.5rem)] font-medium leading-[1.05] tracking-tight"
							style={{ textWrap: "balance" }}
						>
							Equip your AI agents for <RotatingWord />.
						</motion.h1>

						<motion.p
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.16, ease }}
							className="mb-10 max-w-[28rem] text-[clamp(1rem,1.8vw,1.125rem)] leading-[1.6] text-black/55"
						>
							Create, manage, and deploy custom tool configurations for AI
							agents — switching contexts in seconds, not hours.
						</motion.p>

						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.6, delay: 0.24, ease }}
							className="flex flex-wrap items-center gap-4"
						>
							<Button size="lg" asChild>
								<Link to="/chat">
									Get Started
									<ArrowRight size={16} />
								</Link>
							</Button>
							<Button variant="ghost" size="lg" asChild>
								<a href="#features">
									Learn more
									<ArrowRight size={14} />
								</a>
							</Button>
						</motion.div>
					</div>

					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.8, delay: 0.3, ease }}
						className="hidden lg:block"
					>
						<NetworkGraph />
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
						className="mb-16 max-w-[32rem] text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight md:mb-20"
						style={{ textWrap: "balance" }}
					>
						Everything your agents need.{" "}
						<span className="text-black/40">Nothing they don't.</span>
					</h2>
				</FadeIn>

				<div className="grid gap-5 md:grid-cols-3">
					{features.map((f, i) => (
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
			</div>
		</section>
	);
}

/* ─────────────────────── Terminal Demo Section ─────────────────────── */

function TerminalSection() {
	return (
		<section className="relative overflow-hidden bg-white pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-36 lg:pt-36">
			<GradientOrb
				className="left-[5%] top-[10%] h-80 w-80 bg-black/[0.02]"
				delay={0}
			/>
			<GradientOrb
				className="right-[5%] bottom-[10%] h-64 w-64 bg-black/[0.015]"
				delay={4}
			/>

			<div className="relative mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
					<FadeIn>
						<Badge variant="outline" className="mb-5">
							In Action
						</Badge>
						<h2
							className="mb-6 text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight"
							style={{ textWrap: "balance" }}
						>
							Deploy and switch{" "}
							<span className="text-black/40">in seconds.</span>
						</h2>
						<p className="max-w-[26rem] text-[15px] leading-[1.6] text-black/55">
							Watch your agent come alive. Deploy a fully-equipped coding agent,
							then switch to research mode — instantly. No restarts, no
							reconfiguration.
						</p>
					</FadeIn>

					<FadeIn delay={0.15}>
						<AnimatedTerminal />
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
						Set up in minutes. <span className="text-white/40">Not weeks.</span>
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
							Ready to equip your agents?
						</h2>
						<p className="mx-auto mb-10 max-w-md text-[15px] leading-[1.6] text-black/55">
							Join the next generation of AI-powered workflows. Set up your
							first harness in minutes.
						</p>
						<div className="flex flex-wrap items-center justify-center gap-4">
							<Button size="lg" asChild>
								<Link to="/chat">
									Get Started Free
									<ArrowRight size={16} />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<a href="#features">See Features</a>
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
					<div className="sm:col-span-4">
						<span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
							<HarnessMark size={20} />
							Harness
						</span>
						<p className="mt-2 max-w-[14rem] text-sm leading-relaxed text-black/40">
							The toolkit for AI agents. Create, manage, and deploy custom tool
							configurations.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-8 sm:col-span-8 sm:grid-cols-3">
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
										href="#how-it-works"
										className="text-sm text-black/50 transition-colors hover:text-black"
									>
										How It Works
									</a>
								</li>
							</ul>
						</div>
						<div>
							<h3 className="mb-4 text-sm font-medium">Company</h3>
							<ul className="space-y-3">
								<li>
									<span className="text-sm text-black/50">About</span>
								</li>
								<li>
									<span className="text-sm text-black/50">GitHub</span>
								</li>
							</ul>
						</div>
						<div>
							<h3 className="mb-4 text-sm font-medium">Legal</h3>
							<ul className="space-y-3">
								<li>
									<span className="text-sm text-black/50">Privacy</span>
								</li>
								<li>
									<span className="text-sm text-black/50">Terms</span>
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
				<TerminalSection />
				<HowItWorksSection />
				<CTASection />
			</main>
			<LandingFooter />
		</div>
	);
}
