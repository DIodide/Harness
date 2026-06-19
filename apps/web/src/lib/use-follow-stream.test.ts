import { describe, expect, it } from "vitest";
import { reduceFollow } from "./use-follow-stream";

describe("reduceFollow", () => {
	it("accumulates tokens into content + a text part", () => {
		let s = reduceFollow(null, "token", { content: "Hello" });
		s = reduceFollow(s, "token", { content: " world" });
		expect(s?.content).toBe("Hello world");
		expect(s?.parts).toHaveLength(1);
		expect(s?.parts[0]).toMatchObject({ type: "text", content: "Hello world" });
	});

	it("splits tokens with different message ids into distinct parts", () => {
		let s = reduceFollow(null, "token", { content: "a", message_id: "m1" });
		s = reduceFollow(s, "token", { content: "b", message_id: "m2" });
		expect(s?.parts).toHaveLength(2);
		expect(s?.content).toBe("ab");
	});

	it("turn_start resets any prior partial", () => {
		let s = reduceFollow(null, "token", { content: "stale" });
		s = reduceFollow(s, "turn_start", {});
		expect(s?.content).toBeNull();
		expect(s?.parts).toEqual([]);
	});

	it("tool_call then tool_result patches the matching part", () => {
		let s = reduceFollow(null, "tool_call", {
			tool: "bash",
			call_id: "c1",
			arguments: { cmd: "ls" },
		});
		s = reduceFollow(s, "tool_result", {
			call_id: "c1",
			result: "file.txt",
			status: "completed",
		});
		const part = s?.parts.find((p) => p.type === "tool_call");
		expect(part).toMatchObject({ call_id: "c1", result: "file.txt", status: "completed" });
	});

	it("append tool_result concatenates output deltas", () => {
		let s = reduceFollow(null, "tool_call", { tool: "bash", call_id: "c1" });
		s = reduceFollow(s, "tool_result", { call_id: "c1", append: true, output_delta: "line1\n" });
		s = reduceFollow(s, "tool_result", { call_id: "c1", append: true, output_delta: "line2\n" });
		const part = s?.parts.find((p) => p.type === "tool_call");
		expect(part?.result).toBe("line1\nline2\n");
	});

	it("done sets pendingDoneContent so the bubble hands off to the persisted row", () => {
		let s = reduceFollow(null, "token", { content: "answer" });
		s = reduceFollow(s, "done", { content: "answer", model: "gpt-5.5" });
		expect(s?.pendingDoneContent).toBe("answer");
		expect(s?.model).toBe("gpt-5.5");
	});

	it("error clears the followed partial", () => {
		let s = reduceFollow(null, "token", { content: "partial" });
		s = reduceFollow(s, "error", { message: "boom" });
		expect(s).toBeNull();
	});
});
