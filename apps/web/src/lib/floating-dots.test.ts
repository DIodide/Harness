import { describe, expect, it } from "vitest";
import { generateFloatingDots } from "./floating-dots";

describe("generateFloatingDots", () => {
	it("is deterministic for the same seed", () => {
		const first = generateFloatingDots({ seed: 123, count: 5 });
		const second = generateFloatingDots({ seed: 123, count: 5 });

		expect(first).toEqual(second);
	});

	it("changes output when the seed changes", () => {
		const first = generateFloatingDots({ seed: 123, count: 5 });
		const second = generateFloatingDots({ seed: 124, count: 5 });

		expect(first).not.toEqual(second);
	});

	it("keeps dot values in expected ranges", () => {
		const dots = generateFloatingDots({ seed: 2026, count: 24 });
		expect(dots).toHaveLength(24);

		for (const dot of dots) {
			expect(dot.x).toBeGreaterThanOrEqual(0);
			expect(dot.x).toBeLessThanOrEqual(100);
			expect(dot.y).toBeGreaterThanOrEqual(0);
			expect(dot.y).toBeLessThanOrEqual(100);
			expect(dot.size).toBeGreaterThanOrEqual(1.5);
			expect(dot.size).toBeLessThanOrEqual(3.5);
			expect(dot.duration).toBeGreaterThanOrEqual(4);
			expect(dot.duration).toBeLessThanOrEqual(10);
			expect(dot.delay).toBeGreaterThanOrEqual(0);
			expect(dot.delay).toBeLessThanOrEqual(3);
		}
	});
});
