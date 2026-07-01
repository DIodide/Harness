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
		expect(part).toMatchObject({
			call_id: "c1",
			result: "file.txt",
			status: "completed",
		});
	});

	it("tool_result merges late-arriving arguments onto the tool_call", () => {
		// ACP ships the initial tool_call with empty/partial input; the complete
		// input (terminal command, read-file path, Workflow script) arrives on the
		// refining tool_result. A viewer must show it, not the generic placeholder.
		let s = reduceFollow(null, "tool_call", {
			tool: "Read",
			call_id: "c1",
			arguments: {},
		});
		s = reduceFollow(s, "tool_result", {
			call_id: "c1",
			arguments: { path: "/etc/hosts" },
			result: "127.0.0.1 localhost",
			status: "completed",
		});
		const part = s?.parts.find((p) => p.type === "tool_call");
		expect(part).toMatchObject({
			call_id: "c1",
			arguments: { path: "/etc/hosts" },
			result: "127.0.0.1 localhost",
		});
	});

	it("append tool_result merges late arguments without clobbering streamed output", () => {
		let s = reduceFollow(null, "tool_call", {
			tool: "bash",
			call_id: "c1",
			arguments: {},
		});
		s = reduceFollow(s, "tool_result", {
			call_id: "c1",
			append: true,
			output_delta: "out\n",
		});
		s = reduceFollow(s, "tool_result", {
			call_id: "c1",
			append: true,
			arguments: { cmd: "echo hi" },
		});
		const part = s?.parts.find((p) => p.type === "tool_call");
		expect(part?.arguments).toMatchObject({ cmd: "echo hi" });
		expect(part?.result).toBe("out\n");
	});

	it("append tool_result concatenates output deltas", () => {
		let s = reduceFollow(null, "tool_call", { tool: "bash", call_id: "c1" });
		s = reduceFollow(s, "tool_result", {
			call_id: "c1",
			append: true,
			output_delta: "line1\n",
		});
		s = reduceFollow(s, "tool_result", {
			call_id: "c1",
			append: true,
			output_delta: "line2\n",
		});
		const part = s?.parts.find((p) => p.type === "tool_call");
		expect(part?.result).toBe("line1\nline2\n");
	});

	it("done clears the plan card (so a finished follower doesn't show a stale plan)", () => {
		let s = reduceFollow(null, "plan", {
			entries: [{ content: "step 1", status: "in_progress" }],
		});
		expect(s?.plan).toHaveLength(1);
		s = reduceFollow(s, "done", { content: "answer" });
		expect(s?.plan).toBeNull();
	});

	it("plan skips the update (same reference) when entries are unchanged", () => {
		const entries = [{ content: "a", status: "pending" }];
		const s1 = reduceFollow(null, "plan", { entries });
		const s2 = reduceFollow(s1, "plan", {
			entries: [{ content: "a", status: "pending" }],
		});
		expect(s2).toBe(s1);
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
