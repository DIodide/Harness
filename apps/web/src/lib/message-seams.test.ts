import { describe, expect, it } from "vitest";
import {
	computeSeams,
	contentFromParts,
	describeDropped,
	hasRenderableAfter,
	type SeamPart,
	summarizeDropped,
} from "./message-seams";

const text = (c: string): SeamPart => ({ type: "text", content: c });
const reasoning = (c: string): SeamPart => ({ type: "reasoning", content: c });
const tool = (callId: string): SeamPart => ({
	type: "tool_call",
	tool: "Read",
	call_id: callId,
});
const child = (callId: string, parentId: string): SeamPart => ({
	type: "tool_call",
	tool: "Read",
	call_id: callId,
	parent_id: parentId,
});

describe("computeSeams", () => {
	it("treats each flat part as its own top-level block when no nesting", () => {
		const parts = [text("a"), reasoning("r"), text("b")];
		const g = computeSeams(parts);
		expect(g.topCount).toBe(3);
		// keepCounts[t] = flat parts kept cutting AFTER block t
		expect(g.keepCounts).toEqual([1, 2, 3]);
		expect(g.firstFlatIdx).toEqual([0, 1, 2]);
	});

	it("keeps a tool call's children inside its block (no orphans)", () => {
		// flat: [text, tool A, child of A, child of A, text]
		const parts = [
			text("intro"),
			tool("A"),
			child("A1", "A"),
			child("A2", "A"),
			text("after"),
		];
		const g = computeSeams(parts);
		// top blocks: [text, A(+2 children), text] => 3
		expect(g.topCount).toBe(3);
		expect(g.firstFlatIdx).toEqual([0, 1, 4]);
		// cutting after block 0 keeps 1; after block 1 (A+children) keeps 4;
		// after block 2 keeps 5 (all).
		expect(g.keepCounts).toEqual([1, 4, 5]);
	});

	it("resolves grandchildren to the same top-level block", () => {
		// A -> A1 -> A1a (grandchild), then trailing text
		const parts = [
			tool("A"),
			child("A1", "A"),
			child("A1a", "A1"),
			text("done"),
		];
		const g = computeSeams(parts);
		expect(g.topCount).toBe(2);
		expect(g.firstFlatIdx).toEqual([0, 3]);
		expect(g.keepCounts).toEqual([3, 4]);
	});

	it("keeps a valid flat prefix when a subagent child interleaves after a later block", () => {
		// flat: [tool A, text B, child of A] — A's child streams in after B.
		// Cutting after A must still produce a valid prefix that keeps A's child
		// (no orphan), which means B is kept too. keepCounts[0] = 3.
		const parts = [tool("A"), text("B"), child("A1", "A")];
		const g = computeSeams(parts);
		// organizeParts groups child under A => top blocks [A(+child), B] = 2
		expect(g.topCount).toBe(2);
		expect(g.firstFlatIdx).toEqual([0, 1]);
		expect(g.keepCounts).toEqual([3, 3]);
	});
});

describe("contentFromParts", () => {
	it("joins ONLY text parts, with no separator", () => {
		const parts = [text("A"), reasoning("hmm"), tool("X"), text("B")];
		expect(contentFromParts(parts)).toBe("AB");
	});
	it("ignores empty text parts", () => {
		expect(contentFromParts([text("A"), { type: "text" } as SeamPart])).toBe(
			"A",
		);
	});
});

describe("hasRenderableAfter", () => {
	it("is false when the cut drops nothing (keep === length)", () => {
		const parts = [text("a"), tool("A")];
		expect(hasRenderableAfter(parts, 2)).toBe(false);
	});
	it("is false when only empty/non-rendering parts are dropped", () => {
		const parts = [text("a"), { type: "text" } as SeamPart];
		expect(hasRenderableAfter(parts, 1)).toBe(false);
	});
	it("is true when a tool call or non-empty text is dropped", () => {
		expect(hasRenderableAfter([text("a"), tool("A")], 1)).toBe(true);
		expect(hasRenderableAfter([text("a"), text("b")], 1)).toBe(true);
	});
});

describe("summarizeDropped", () => {
	it("counts only RENDERABLE dropped parts; flags context change vs stored content", () => {
		const parts = [text("keep"), tool("A"), text("drop me")];
		// stored content is the faithful join of all text parts.
		const d = summarizeDropped(parts, 1, "keepdrop me"); // keep only parts[0]
		expect(d).toEqual({
			text: 1,
			tools: 1,
			reasoning: 0,
			total: 2,
			contentChanges: true, // recompute "keep" !== "keepdrop me"
		});
	});

	it("does NOT flag context change when the recompute equals stored content", () => {
		// drop only a reasoning + tool_call; kept text join still equals stored.
		const parts = [text("keep"), reasoning("hmm"), tool("A")];
		const d = summarizeDropped(parts, 1, "keep");
		expect(d.contentChanges).toBe(false);
		expect(d.tools).toBe(1);
		expect(d.reasoning).toBe(1);
		expect(d.text).toBe(0);
	});

	it("flags context change for the OpenRouter case where stored content is last-iteration only", () => {
		// parts hold one text part per iteration; stored content = last only ("B").
		const parts = [text("A"), tool("A"), text("B")];
		// keep [A, tool] -> recompute "A" !== stored "B" -> changes.
		const d = summarizeDropped(parts, 2, "B");
		expect(d.contentChanges).toBe(true);
		expect(d.text).toBe(1); // dropped one non-empty text part
	});

	it("does NOT count an empty dropped text part", () => {
		const parts = [text("keep"), { type: "text" } as SeamPart];
		const d = summarizeDropped(parts, 1, "keep");
		expect(d.text).toBe(0);
		expect(d.contentChanges).toBe(false);
	});
});

describe("describeDropped", () => {
	it("pluralizes and joins segments", () => {
		expect(
			describeDropped({
				text: 2,
				tools: 1,
				reasoning: 0,
				total: 3,
				contentChanges: true,
			}),
		).toBe("Drop 2 paragraphs + 1 tool call below.");
	});

	it("falls back to a block count, pluralizing on != 1", () => {
		expect(
			describeDropped({
				text: 0,
				tools: 0,
				reasoning: 0,
				total: 1,
				contentChanges: false,
			}),
		).toBe("Drop 1 block below.");
		expect(
			describeDropped({
				text: 0,
				tools: 0,
				reasoning: 0,
				total: 0,
				contentChanges: false,
			}),
		).toBe("Drop 0 blocks below.");
	});
});
