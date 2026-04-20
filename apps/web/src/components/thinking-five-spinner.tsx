import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

interface ThinkingFiveSpinnerProps {
	size?: number | string;
	className?: string;
	label?: string;
}

const PARTICLE_COUNT = 62;
const TRAIL_SPAN = 0.38;
const DURATION_MS = 4600;
const ROTATION_DURATION_MS = 28000;
const PULSE_DURATION_MS = 4200;
const STROKE_WIDTH = 5.5;
const BASE_RADIUS = 7;
const DETAIL_AMPLITUDE = 3;
const PETAL_COUNT = 5;
const CURVE_SCALE = 3.9;
const PATH_STEPS = 480;

function point(progress: number, detailScale: number) {
	const t = progress * Math.PI * 2;
	const x =
		BASE_RADIUS * Math.cos(t) -
		DETAIL_AMPLITUDE * detailScale * Math.cos(PETAL_COUNT * t);
	const y =
		BASE_RADIUS * Math.sin(t) -
		DETAIL_AMPLITUDE * detailScale * Math.sin(PETAL_COUNT * t);
	return { x: 50 + x * CURVE_SCALE, y: 50 + y * CURVE_SCALE };
}

function normalizeProgress(p: number) {
	return ((p % 1) + 1) % 1;
}

function getDetailScale(time: number) {
	const pulseProgress = (time % PULSE_DURATION_MS) / PULSE_DURATION_MS;
	const pulseAngle = pulseProgress * Math.PI * 2;
	return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

function buildPath(detailScale: number) {
	let d = "";
	for (let i = 0; i <= PATH_STEPS; i++) {
		const pt = point(i / PATH_STEPS, detailScale);
		d += `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
	}
	return d;
}

const INITIAL_DETAIL_SCALE = getDetailScale(0);
const INITIAL_PATH_D = buildPath(INITIAL_DETAIL_SCALE);
const INITIAL_PARTICLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
	const tailOffset = i / (PARTICLE_COUNT - 1);
	const pt = point(
		normalizeProgress(-tailOffset * TRAIL_SPAN),
		INITIAL_DETAIL_SCALE,
	);
	const fade = (1 - tailOffset) ** 0.56;
	return {
		cx: pt.x.toFixed(2),
		cy: pt.y.toFixed(2),
		r: (0.9 + fade * 2.7).toFixed(2),
		opacity: (0.04 + fade * 0.96).toFixed(3),
	};
});

export function ThinkingFiveSpinner({
	size = 96,
	className,
	label = "Loading",
}: ThinkingFiveSpinnerProps) {
	const groupRef = useRef<SVGGElement>(null);
	const pathRef = useRef<SVGPathElement>(null);
	const particleRefs = useRef<Array<SVGCircleElement | null>>([]);

	useEffect(() => {
		const group = groupRef.current;
		const pathEl = pathRef.current;
		if (!group || !pathEl) return;

		const reduced = window?.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;

		const paintFrame = (time: number) => {
			const progress = (time % DURATION_MS) / DURATION_MS;
			const detailScale = getDetailScale(time);
			const rotation =
				-((time % ROTATION_DURATION_MS) / ROTATION_DURATION_MS) * 360;

			group.setAttribute("transform", `rotate(${rotation} 50 50)`);
			pathEl.setAttribute("d", buildPath(detailScale));

			for (let i = 0; i < PARTICLE_COUNT; i++) {
				const node = particleRefs.current[i];
				if (!node) continue;
				const tailOffset = i / (PARTICLE_COUNT - 1);
				const pt = point(
					normalizeProgress(progress - tailOffset * TRAIL_SPAN),
					detailScale,
				);
				const fade = (1 - tailOffset) ** 0.56;
				node.setAttribute("cx", pt.x.toFixed(2));
				node.setAttribute("cy", pt.y.toFixed(2));
				node.setAttribute("r", (0.9 + fade * 2.7).toFixed(2));
				node.setAttribute("opacity", (0.04 + fade * 0.96).toFixed(3));
			}
		};

		if (reduced) {
			paintFrame(0);
			return;
		}

		const startedAt = performance.now();
		let rafId = 0;
		const tick = (now: number) => {
			paintFrame(now - startedAt);
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
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
			<g ref={groupRef}>
				<path
					ref={pathRef}
					d={INITIAL_PATH_D}
					stroke="currentColor"
					strokeWidth={STROKE_WIDTH}
					strokeLinecap="round"
					strokeLinejoin="round"
					opacity={0.1}
				/>
				{INITIAL_PARTICLES.map((p, i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length ordered set
						key={i}
						ref={(el) => {
							particleRefs.current[i] = el;
						}}
						fill="currentColor"
						cx={p.cx}
						cy={p.cy}
						r={p.r}
						opacity={p.opacity}
					/>
				))}
			</g>
		</svg>
	);
}
