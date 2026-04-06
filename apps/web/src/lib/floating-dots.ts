export interface FloatingDot {
	id: number;
	x: number;
	y: number;
	size: number;
	duration: number;
	delay: number;
}

function createSeededRandom(seed: number) {
	let state = seed;
	return () => {
		state += 0x6d2b79f5;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function generateFloatingDots({
	seed = 2026,
	count = 24,
}: {
	seed?: number;
	count?: number;
} = {}): FloatingDot[] {
	const random = createSeededRandom(seed);

	return Array.from({ length: count }, (_, i) => ({
		id: i,
		x: random() * 100,
		y: random() * 100,
		size: 1.5 + random() * 2,
		duration: 4 + random() * 6,
		delay: random() * 3,
	}));
}
