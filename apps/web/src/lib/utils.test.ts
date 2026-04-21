import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
	it("joins plain class names", () => {
		expect(cn("a", "b")).toBe("a b");
	});

	it("drops falsy values", () => {
		expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
	});

	it("merges conflicting tailwind classes (last wins)", () => {
		expect(cn("p-2", "p-4")).toBe("p-4");
	});

	it("flattens nested arrays and object syntax", () => {
		expect(cn(["a", { b: true, c: false }], "d")).toBe("a b d");
	});

	it("returns empty string for no inputs", () => {
		expect(cn()).toBe("");
	});
});
