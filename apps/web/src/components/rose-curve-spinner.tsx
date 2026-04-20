import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const PARTICLE_COUNT = 78;
const TRAIL_SPAN = 0.32;
const DURATION_MS = 5400;
const ROTATION_DURATION_MS = 28000;
const PULSE_DURATION_MS = 4600;
const DEFAULT_STROKE_WIDTH = 4.5;
const ROSE_A = 9.2;
const ROSE_A_BOOST = 0.6;
const ROSE_BREATH_BASE = 0.72;
const ROSE_BREATH_BOOST = 0.28;
const ROSE_K = 5;
const ROSE_SCALE = 3.25;
const PATH_STEPS = 480;
const PARTICLE_IDS = Array.from({ length: PARTICLE_COUNT }, (_, i) => `p-${i}`);

function normalizeProgress(value: number) {
	return ((value % 1) + 1) % 1;
}

function computePoint(progress: number, detailScale: number) {
	const t = progress * Math.PI * 2;
	const a = ROSE_A + detailScale * ROSE_A_BOOST;
	const r =
		a *
		(ROSE_BREATH_BASE + detailScale * ROSE_BREATH_BOOST) *
		Math.cos(ROSE_K * t);
	return {
		x: 50 + Math.cos(t) * r * ROSE_SCALE,
		y: 50 + Math.sin(t) * r * ROSE_SCALE,
	};
}

function buildPathD(detailScale: number) {
	let d = "";
	for (let i = 0; i <= PATH_STEPS; i++) {
		const p = computePoint(i / PATH_STEPS, detailScale);
		d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
	}
	return d;
}

function getDetailScale(time: number) {
	const pulseProgress = (time % PULSE_DURATION_MS) / PULSE_DURATION_MS;
	const pulseAngle = pulseProgress * Math.PI * 2;
	return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

function getRotation(time: number) {
	return -((time % ROTATION_DURATION_MS) / ROTATION_DURATION_MS) * 360;
}

export interface RoseCurveSpinnerProps {
	/** Width and height of the spinner. Number is treated as px. Default: 24. */
	size?: number | string;
	/** Additional class names. Spinner inherits color via `currentColor`. */
	className?: string;
	/** Accessible label for screen readers. Default: "Loading". */
	label?: string;
	/** Stroke width of the ghost curve, in viewBox units. Default: 4.5. */
	strokeWidth?: number;
}

/**
 * Animated rose-curve loading indicator. Renders an SVG that draws the path
 * r = a·cos(kθ) and sweeps trailing particles along it, with a slow rotation
 * and a breathing-amplitude pulse. Color is inherited via `currentColor`, so
 * wrap it in a Tailwind `text-*` utility to tint.
 */
export function RoseCurveSpinner({
	size = 24,
	className,
	label = "Loading",
	strokeWidth = DEFAULT_STROKE_WIDTH,
}: RoseCurveSpinnerProps) {
	const groupRef = useRef<SVGGElement>(null);
	const pathRef = useRef<SVGPathElement>(null);
	const particlesRef = useRef<Array<SVGCircleElement | null>>([]);

	useEffect(() => {
		const group = groupRef.current;
		const path = pathRef.current;
		if (!group || !path) return;
		const particles = particlesRef.current;

		const render = (elapsed: number) => {
			const progress = (elapsed % DURATION_MS) / DURATION_MS;
			const detailScale = getDetailScale(elapsed);

			group.setAttribute("transform", `rotate(${getRotation(elapsed)} 50 50)`);
			path.setAttribute("d", buildPathD(detailScale));

			for (let i = 0; i < PARTICLE_COUNT; i++) {
				const node = particles[i];
				if (!node) continue;
				const tailOffset = i / (PARTICLE_COUNT - 1);
				const point = computePoint(
					normalizeProgress(progress - tailOffset * TRAIL_SPAN),
					detailScale,
				);
				const fade = (1 - tailOffset) ** 0.56;
				node.setAttribute("cx", point.x.toFixed(2));
				node.setAttribute("cy", point.y.toFixed(2));
				node.setAttribute("r", (0.9 + fade * 2.7).toFixed(2));
				node.setAttribute("opacity", (0.04 + fade * 0.96).toFixed(3));
			}
		};

		const prefersReduced =
			window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

		if (prefersReduced) {
			render(0);
			return;
		}

		const startedAt = performance.now();
		let rafId = 0;
		const loop = (now: number) => {
			render(now - startedAt);
			rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafId);
	}, []);

	const dim = typeof size === "number" ? `${size}px` : size;

	return (
		<svg
			viewBox="0 0 100 100"
			fill="none"
			role="img"
			aria-label={label}
			aria-live="polite"
			className={cn("inline-block shrink-0 overflow-visible", className)}
			style={{ width: dim, height: dim }}
		>
			<title>{label}</title>
			<g ref={groupRef}>
				<path
					ref={pathRef}
					stroke="currentColor"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeLinejoin="round"
					opacity={0.1}
				/>
				{PARTICLE_IDS.map((id, i) => (
					<circle
						key={id}
						ref={(el) => {
							particlesRef.current[i] = el;
						}}
						fill="currentColor"
						r={0}
					/>
				))}
			</g>
		</svg>
	);
}
