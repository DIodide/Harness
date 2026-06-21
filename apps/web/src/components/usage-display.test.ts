import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountUsageFromRateLimit, formatResetTime } from "./usage-display";

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

describe("accountUsageFromRateLimit (SDK rate_limit_info shape)", () => {
	it("parses a hard limit (status rejected) with a seconds reset timestamp", () => {
		const a = accountUsageFromRateLimit({
			rateLimitType: "five_hour",
			status: "rejected",
			resetsAt: 1771606800, // seconds
			isUsingOverage: false,
		});
		expect(a).toEqual({
			label: "Current session",
			status: "rejected",
			utilization: undefined,
			resetsAtMs: 1771606800000, // ×1000
		});
	});

	it("parses utilization + a millisecond reset timestamp", () => {
		const a = accountUsageFromRateLimit({
			rateLimitType: "seven_day",
			status: "allowed_warning",
			utilization: 73.7,
			resetsAt: 1771606800000, // already ms
		});
		expect(a?.label).toBe("Current week");
		expect(a?.status).toBe("warning");
		expect(a?.utilization).toBeCloseTo(73.7);
		expect(a?.resetsAtMs).toBe(1771606800000);
	});

	it("maps every known rateLimitType and clamps utilization", () => {
		expect(
			accountUsageFromRateLimit({
				rateLimitType: "seven_day_sonnet",
				status: "allowed",
				utilization: 150,
			})?.label,
		).toBe("Current week (Sonnet)");
		expect(
			accountUsageFromRateLimit({
				rateLimitType: "seven_day_sonnet",
				status: "allowed",
				utilization: 150,
			})?.utilization,
		).toBe(100); // clamped
	});

	it("returns null for the normal allowed state with no number or reset", () => {
		expect(
			accountUsageFromRateLimit({
				rateLimitType: "five_hour",
				status: "allowed",
			}),
		).toBeNull();
		expect(accountUsageFromRateLimit(null)).toBeNull();
		expect(accountUsageFromRateLimit("nope")).toBeNull();
	});

	it("falls back to a generic label for an unknown type", () => {
		const a = accountUsageFromRateLimit({
			status: "rejected",
			resetsAt: 1771606800,
		});
		expect(a?.label).toBe("Claude account");
		expect(a?.status).toBe("rejected");
	});
});
