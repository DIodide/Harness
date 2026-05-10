import { describe, expect, it } from "vitest";
import { RECOMMENDED_SKILLS } from "./skills";

describe("RECOMMENDED_SKILLS", () => {
	it("contains at least 5 curated skills", () => {
		expect(RECOMMENDED_SKILLS.length).toBeGreaterThanOrEqual(5);
	});

	it("each entry has id + skill with consistent shape", () => {
		for (const r of RECOMMENDED_SKILLS) {
			expect(r.id).toBeTruthy();
			expect(r.skill.skillId).toBeTruthy();
			expect(r.skill.fullId.includes(r.skill.skillId)).toBe(true);
			expect(r.skill.source).toBeTruthy();
			expect(typeof r.skill.installs).toBe("number");
			expect(r.skill.installs).toBeGreaterThan(0);
		}
	});

	it("ids are unique", () => {
		const ids = RECOMMENDED_SKILLS.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("top id matches its skillId", () => {
		for (const r of RECOMMENDED_SKILLS) {
			expect(r.id).toBe(r.skill.skillId);
		}
	});
});
