import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	ArrowRight,
	Code,
	Menu,
	MessageSquare,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

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

const ease = [0.16, 1, 0.3, 1] as const;

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
		const timer = setInterval(() => {
			setIndex((i) => (i + 1) % rotatingWords.length);
		}, 2400);
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

/* ─── Nav ─── */

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
			className={`sticky top-0 z-50 transition-all duration-200 ${scrolled ? "bg-white shadow-[0_1px_0_rgba(0,0,0,0.06)]" : "bg-white"}`}
		>
			<div className="mx-auto flex h-16 max-w-[76rem] items-center justify-between px-6 lg:px-12">
				<Link
					to="/"
					className="text-lg font-semibold tracking-tight text-black"
				>
					Harness
				</Link>

				<nav className="hidden items-center gap-7 lg:flex">
					<a
						href="#features"
						className="text-[15px] font-medium text-black transition-opacity hover:opacity-60"
					>
						Features
					</a>
					<a
						href="#how-it-works"
						className="text-[15px] font-medium text-black transition-opacity hover:opacity-60"
					>
						How It Works
					</a>
				</nav>

				<div className="hidden items-center gap-5 lg:flex">
					<Link
						to="/chat"
						className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-black transition-opacity hover:opacity-60"
					>
						Log in
						<ArrowRight
							size={15}
							className="opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
						/>
					</Link>
					<Link
						to="/chat"
						className="inline-flex items-center gap-2 rounded-md border border-black bg-black px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80"
					>
						Get Started
						<ArrowRight size={14} />
					</Link>
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

			{open && (
				<div className="border-t border-black/5 bg-white px-6 pb-6 pt-4 lg:hidden">
					<nav className="flex flex-col gap-4">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								document
									.getElementById("features")
									?.scrollIntoView({ behavior: "smooth" });
							}}
							className="text-left text-[15px] font-medium"
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
							className="text-left text-[15px] font-medium"
						>
							How It Works
						</button>
						<hr className="border-black/5" />
						<Link
							to="/chat"
							onClick={() => setOpen(false)}
							className="text-[15px] font-medium"
						>
							Log in
						</Link>
						<Link
							to="/chat"
							onClick={() => setOpen(false)}
							className="inline-flex items-center justify-center gap-2 rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white"
						>
							Get Started
							<ArrowRight size={14} />
						</Link>
					</nav>
				</div>
			)}
		</header>
	);
}

/* ─── Hero ─── */

function HeroSection() {
	return (
		<section className="overflow-hidden bg-white pb-16 pt-16 text-black md:pb-24 md:pt-24 lg:pb-40 lg:pt-40">
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="max-w-[42rem]">
					<motion.p
						initial={{ opacity: 0, y: 16 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, ease }}
						className="mb-5 text-xs font-medium uppercase tracking-[0.12em] opacity-60"
					>
						The Agent Platform
					</motion.p>

					<motion.h1
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, delay: 0.08, ease }}
						className="mb-6 text-[clamp(2.5rem,6vw,5.25rem)] font-medium leading-[1] tracking-tight"
						style={{ textWrap: "balance" }}
					>
						Equip your AI agents for <RotatingWord />.
					</motion.h1>

					<motion.p
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, delay: 0.16, ease }}
						className="mb-10 max-w-[28rem] text-[clamp(1rem,1.8vw,1.125rem)] leading-[1.6] opacity-60 md:mb-14"
					>
						Create, manage, and deploy custom tool configurations for AI agents
						— switching contexts in seconds, not hours.
					</motion.p>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, delay: 0.24, ease }}
						className="flex flex-wrap items-center gap-5"
					>
						<Link
							to="/chat"
							className="group inline-flex items-center gap-2 rounded-md bg-black px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-80"
						>
							Get Started
							<ArrowRight
								size={15}
								className="transition-transform group-hover:translate-x-0.5"
							/>
						</Link>
						<a
							href="#features"
							className="group inline-flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-60"
						>
							Learn more
							<ArrowRight
								size={14}
								className="transition-transform group-hover:translate-x-0.5"
							/>
						</a>
					</motion.div>
				</div>
			</div>
		</section>
	);
}

/* ─── Features ─── */

function FeaturesSection() {
	return (
		<section
			id="features"
			className="bg-white pb-20 pt-20 text-black md:pb-28 md:pt-28 lg:pb-36 lg:pt-36"
		>
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<FadeIn>
					<p className="mb-5 text-xs font-medium uppercase tracking-[0.12em] opacity-60">
						Features
					</p>
					<h2
						className="mb-16 max-w-[32rem] text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight md:mb-20"
						style={{ textWrap: "balance" }}
					>
						Everything your agents need.{" "}
						<span className="opacity-60">Nothing they don't.</span>
					</h2>
				</FadeIn>

				<div className="grid gap-6 md:grid-cols-3">
					{features.map((f, i) => (
						<FadeIn key={f.title} delay={0.08 * i}>
							<div className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-8">
								<div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-black/[0.06]">
									<f.icon size={20} strokeWidth={1.5} />
								</div>
								<h3 className="mb-2 text-lg font-medium">{f.title}</h3>
								<p className="text-[15px] leading-[1.6] opacity-60">
									{f.description}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

/* ─── How It Works ─── */

function HowItWorksSection() {
	return (
		<section
			id="how-it-works"
			className="bg-black pb-20 pt-20 text-white md:pb-28 md:pt-28 lg:pb-36 lg:pt-36"
		>
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid gap-12 md:grid-cols-2 md:items-start md:gap-16">
					<div>
						<FadeIn>
							<h2
								className="mb-6 text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight"
								style={{ textWrap: "balance" }}
							>
								Set up in minutes.{" "}
								<span className="opacity-60">Not weeks.</span>
							</h2>
							<p className="max-w-[26rem] text-[15px] leading-[1.6] opacity-60">
								Harness fits into your workflow in minutes, not weeks. Pick a
								profile and go — no complex infrastructure needed.
							</p>
						</FadeIn>
					</div>

					<div className="grid gap-4">
						{steps.map((s, i) => (
							<FadeIn key={s.title} delay={0.08 * i}>
								<div className="rounded-xl border border-white/[0.08] bg-[#141414] px-7 py-6">
									<span className="mb-3 block font-mono text-sm tracking-wide text-white/30">
										{s.num}
									</span>
									<h3 className="mb-1.5 text-[17px] font-medium">{s.title}</h3>
									<p className="text-[15px] leading-[1.6] text-white/60">
										{s.description}
									</p>
								</div>
							</FadeIn>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

/* ─── CTA ─── */

function CTASection() {
	return (
		<section className="bg-black pb-20 pt-20 text-white md:pb-28 md:pt-28 lg:pb-36 lg:pt-36">
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<FadeIn>
					<p className="mb-5 text-xs font-medium uppercase tracking-[0.12em] opacity-60">
						Get Started
					</p>
					<h2
						className="mb-10 max-w-[28rem] text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.1] tracking-tight"
						style={{ textWrap: "balance" }}
					>
						Ready to equip your agents?
					</h2>
					<Link
						to="/chat"
						className="group inline-flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-80"
					>
						Get Started
						<ArrowRight
							size={15}
							className="transition-transform group-hover:translate-x-0.5"
						/>
					</Link>
				</FadeIn>
			</div>
		</section>
	);
}

/* ─── Footer ─── */

function LandingFooter() {
	return (
		<footer className="bg-black py-10 text-white md:py-12 lg:py-16">
			<div className="mx-auto max-w-[76rem] px-6 lg:px-12">
				<div className="grid gap-10 sm:grid-cols-12 sm:gap-8">
					<div className="sm:col-span-3">
						<span className="text-lg font-semibold tracking-tight">
							Harness
						</span>
					</div>
					<div className="grid grid-cols-2 gap-8 sm:col-span-9 sm:grid-cols-3">
						<div>
							<h3 className="mb-4 text-sm font-medium">Product</h3>
							<ul className="space-y-3">
								<li>
									<a
										href="#features"
										className="text-sm text-white/60 transition-colors hover:text-white"
									>
										Features
									</a>
								</li>
								<li>
									<a
										href="#how-it-works"
										className="text-sm text-white/60 transition-colors hover:text-white"
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
									<span className="text-sm text-white/60">About</span>
								</li>
								<li>
									<span className="text-sm text-white/60">GitHub</span>
								</li>
							</ul>
						</div>
						<div>
							<h3 className="mb-4 text-sm font-medium">Legal</h3>
							<ul className="space-y-3">
								<li>
									<span className="text-sm text-white/60">Privacy</span>
								</li>
								<li>
									<span className="text-sm text-white/60">Terms</span>
								</li>
							</ul>
						</div>
					</div>
				</div>
				<div className="mt-12 flex items-center justify-between border-t border-white/[0.08] pt-8">
					<p className="text-xs text-white/40">
						&copy; 2026 Harness. All rights reserved.
					</p>
				</div>
			</div>
		</footer>
	);
}

/* ─── Page ─── */

function LandingPage() {
	return (
		<div className="min-h-screen bg-white">
			<LandingNav />
			<main>
				<HeroSection />
				<FeaturesSection />
				<HowItWorksSection />
				<CTASection />
			</main>
			<LandingFooter />
		</div>
	);
}
