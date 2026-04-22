import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatResetTime } from "./usage-display";

describe("formatResetTime", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-21T12:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 'now' when the reset time is in the past or equal", () => {
		expect(formatResetTime("2026-04-21T12:00:00Z")).toBe("now");
		expect(formatResetTime("2026-04-21T11:00:00Z")).toBe("now");
	});

	it("returns minutes only when less than one hour remains", () => {
		// 45 min away
		expect(formatResetTime("2026-04-21T12:45:00Z")).toBe("45m");
	});

	it("returns hours and minutes when between 1 and 24 hours remain", () => {
		// 5h 30m away
		expect(formatResetTime("2026-04-21T17:30:00Z")).toBe("5h 30m");
	});

	it("returns days and hours when more than 24 hours remain", () => {
		// 2 days, 3 hours away
		expect(formatResetTime("2026-04-23T15:00:00Z")).toBe("2d 3h");
	});

	it("rounds minutes down (uses Math.floor)", () => {
		// 1h 59m 59s away -> 1h 59m
		expect(formatResetTime("2026-04-21T13:59:59Z")).toBe("1h 59m");
	});
});
