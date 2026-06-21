import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	accountUsageFromRateLimit,
	accountUsagesFromRateLimit,
	formatResetTime,
} from "./usage-display";

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
	// Active windows must reset in the FUTURE (a past reset self-heals to null).
	const futureSec = Math.floor(Date.now() / 1000) + 3600; // +1h, seconds
	const futureMs = Date.now() + 3_600_000; // +1h, ms
	const pastSec = Math.floor(Date.now() / 1000) - 3600; // -1h, seconds

	it("parses a hard limit (status rejected) with a seconds reset timestamp", () => {
		const a = accountUsageFromRateLimit({
			rateLimitType: "five_hour",
			status: "rejected",
			resetsAt: futureSec,
			isUsingOverage: false,
		});
		expect(a).toEqual({
			label: "Current session",
			status: "rejected",
			utilization: undefined,
			resetsAtMs: futureSec * 1000, // seconds ×1000
		});
	});

	it("parses utilization + a millisecond reset timestamp", () => {
		const a = accountUsageFromRateLimit({
			rateLimitType: "seven_day",
			status: "allowed_warning",
			utilization: 73.7,
			resetsAt: futureMs, // already ms
		});
		expect(a?.label).toBe("Current week");
		expect(a?.status).toBe("warning");
		expect(a?.utilization).toBeCloseTo(73.7);
		expect(a?.resetsAtMs).toBe(futureMs);
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

	it("self-heals: a rejected snapshot whose reset is already past returns null", () => {
		// The window already reset; don't keep showing a stale 'limit reached'.
		expect(
			accountUsageFromRateLimit({
				rateLimitType: "five_hour",
				status: "rejected",
				resetsAt: pastSec,
			}),
		).toBeNull();
	});

	it("falls back to a generic label for an unknown type", () => {
		const a = accountUsageFromRateLimit({
			status: "rejected",
			resetsAt: futureSec,
		});
		expect(a?.label).toBe("Claude account");
		expect(a?.status).toBe("rejected");
	});
});

describe("accountUsagesFromRateLimit (multi-window buckets shape)", () => {
	const futureSec = Math.floor(Date.now() / 1000) + 3600;
	const pastSec = Math.floor(Date.now() / 1000) - 3600;

	it("parses 5h + weekly windows, ordered, normalizing 0–1 to 0–100", () => {
		const windows = accountUsagesFromRateLimit({
			buckets: {
				// out of order on purpose — should sort five_hour first
				seven_day: {
					utilization: 0.46,
					status: "allowed",
					resetsAt: futureSec,
				},
				five_hour: {
					utilization: 0.14,
					status: "allowed",
					resetsAt: futureSec,
				},
				seven_day_sonnet: {
					utilization: 0.07,
					status: "allowed",
					resetsAt: futureSec,
				},
			},
		});
		expect(windows.map((w) => w.label)).toEqual([
			"Current session",
			"Current week",
			"Current week (Sonnet)",
		]);
		expect(windows[0].utilization).toBeCloseTo(14);
		expect(windows[1].utilization).toBeCloseTo(46);
		expect(windows[2].utilization).toBeCloseTo(7);
	});

	it("keeps a rejected window and drops one whose reset has passed", () => {
		const windows = accountUsagesFromRateLimit({
			buckets: {
				five_hour: { utilization: 1, status: "rejected", resetsAt: futureSec },
				seven_day: { utilization: 0.9, status: "allowed", resetsAt: pastSec },
			},
		});
		expect(windows).toHaveLength(1);
		expect(windows[0].label).toBe("Current session");
		expect(windows[0].status).toBe("rejected");
		expect(windows[0].utilization).toBeCloseTo(100);
	});

	it("falls back to the legacy flat single-window shape", () => {
		const windows = accountUsagesFromRateLimit({
			rateLimitType: "seven_day",
			status: "allowed",
			utilization: 73.7,
			resetsAt: futureSec,
		});
		expect(windows).toHaveLength(1);
		expect(windows[0].label).toBe("Current week");
		expect(windows[0].utilization).toBeCloseTo(73.7);
	});

	it("returns [] for an empty/unknown snapshot", () => {
		expect(accountUsagesFromRateLimit(null)).toEqual([]);
		expect(accountUsagesFromRateLimit({})).toEqual([]);
		expect(accountUsagesFromRateLimit({ buckets: {} })).toEqual([]);
	});
});
