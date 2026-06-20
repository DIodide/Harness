import { describe, expect, it } from "vitest";
import {
	computeSeams,
	describeDropped,
	type SeamPart,
	summarizeDropped,
} from "./message-seams";

const text = (c: string): SeamPart => ({ type: "text", content: c });
const reasoning = (c: string): SeamPart => ({ type: "reasoning", content: c });
const tool = (callId: string): SeamPart => ({
	type: "tool_call",
	call_id: callId,
});
const child = (callId: string, parentId: string): SeamPart => ({
	type: "tool_call",
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

describe("summarizeDropped", () => {
	it("counts dropped parts by type and flags content change on dropped text", () => {
		const parts = [text("keep"), tool("A"), text("drop me")];
		const d = summarizeDropped(parts, 1); // keep only parts[0]
		expect(d).toEqual({
			text: 1,
			tools: 1,
			reasoning: 0,
			total: 2,
			contentChanges: true,
		});
	});

	it("does NOT flag content change when only reasoning/tool_call parts drop", () => {
		const parts = [text("keep"), reasoning("hmm"), tool("A")];
		const d = summarizeDropped(parts, 1);
		expect(d.contentChanges).toBe(false);
		expect(d.tools).toBe(1);
		expect(d.reasoning).toBe(1);
		expect(d.text).toBe(0);
	});

	it("does NOT flag content change for an empty text part", () => {
		const parts = [text("keep"), { type: "text" } as SeamPart];
		const d = summarizeDropped(parts, 1);
		expect(d.text).toBe(1);
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

	it("falls back to a block count when nothing categorized", () => {
		expect(
			describeDropped({
				text: 0,
				tools: 0,
				reasoning: 0,
				total: 1,
				contentChanges: false,
			}),
		).toBe("Drop 1 block below.");
	});
});
