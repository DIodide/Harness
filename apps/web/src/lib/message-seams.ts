/**
 * Seam geometry for mid-message rewind — pure, UI-free, and unit-tested.
 *
 * An assistant message renders from `organizeParts(parts)`: a tree where
 * subagent activity (parts tagged with a parent tool-call id) is collapsed
 * UNDER the tool call that spawned it. The RENDER walks that organized tree,
 * but truncation must slice the FLAT `parts[]` array. A "seam" sits in the gap
 * below each top-level rendered block; cutting at it keeps that block and
 * everything above, and drops everything below.
 *
 * The one correctness rule: a seam's keep-count must include a kept tool call's
 * ENTIRE subtree (all transitive children), so a cut never orphans a subagent
 * child or keeps a child whose parent was removed. We therefore key the cut to
 * the max flat index of the block's subtree, producing a valid flat prefix.
 *
 * Indices here line up 1:1 with `organizeParts(parts)` output order, so the
 * render can pair each top-level block with its seam by array position.
 */

export interface SeamPart {
	type: "text" | "reasoning" | "tool_call";
	content?: string;
	call_id?: string;
	parentId?: string | null; // stream shape
	parent_id?: string | null; // persisted shape
}

export interface SeamGeometry {
	/** Number of top-level (organized) blocks. */
	topCount: number;
	/** keepCounts[t] = how many flat parts to KEEP when cutting AFTER top-level
	 *  block t (i.e. the boundary message keeps parts[0..keepCounts[t]-1]). */
	keepCounts: number[];
	/** firstFlatIdx[t] = flat index where top-level block t begins. Used to dim
	 *  the blocks a hovered seam would drop. */
	firstFlatIdx: number[];
}

/**
 * Compute seam geometry, mirroring `organizeParts`' top-level numbering exactly
 * (same parent-lookup), so indices align with the rendered blocks.
 */
export function computeSeams(parts: SeamPart[]): SeamGeometry {
	// call_id -> the top-level block index that owns this tool call's subtree.
	const ownerByCallId = new Map<string, number>();
	const topOfFlat: number[] = [];
	const firstFlatIdx: number[] = [];
	let topCount = 0;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const parentId = part.parentId ?? part.parent_id ?? null;
		let owner: number;
		if (parentId != null && ownerByCallId.has(parentId)) {
			// Inherit the top-level owner of the parent — handles arbitrary
			// nesting (grandchildren resolve to the same top-level block).
			owner = ownerByCallId.get(parentId) as number;
		} else {
			owner = topCount;
			firstFlatIdx[owner] = i;
			topCount++;
		}
		topOfFlat[i] = owner;
		if (part.type === "tool_call" && part.call_id) {
			ownerByCallId.set(part.call_id, owner);
		}
	}

	// Last flat index (exclusive end) owned by each top-level block.
	const endForTop = new Array<number>(topCount).fill(0);
	for (let i = 0; i < parts.length; i++) {
		const t = topOfFlat[i];
		if (i + 1 > endForTop[t]) endForTop[t] = i + 1;
	}
	// Prefix-max so cutting after block t includes every block <= t — keeps the
	// slice a valid flat prefix even if a background subagent's parts interleave
	// after a later block.
	const keepCounts = new Array<number>(topCount).fill(0);
	let run = 0;
	for (let t = 0; t < topCount; t++) {
		if (endForTop[t] > run) run = endForTop[t];
		keepCounts[t] = run;
	}

	return { topCount, keepCounts, firstFlatIdx };
}

export interface DroppedSummary {
	text: number;
	tools: number;
	reasoning: number;
	total: number;
	/** True iff a non-empty text part is dropped — i.e. the agent's context
	 *  (rebuilt from `content`, which is text-parts-only) actually changes.
	 *  False when only trailing reasoning/tool_call parts are dropped. */
	contentChanges: boolean;
}

/** Summarize what cutting to `keepPartCount` flat parts drops, for the confirm
 *  copy. `keepPartCount` is a flat index from `computeSeams`. */
export function summarizeDropped(
	parts: SeamPart[],
	keepPartCount: number,
): DroppedSummary {
	let text = 0;
	let tools = 0;
	let reasoning = 0;
	let contentChanges = false;
	for (let i = keepPartCount; i < parts.length; i++) {
		const p = parts[i];
		if (p.type === "text") {
			text++;
			if (p.content) contentChanges = true;
		} else if (p.type === "tool_call") {
			tools++;
		} else if (p.type === "reasoning") {
			reasoning++;
		}
	}
	return {
		text,
		tools,
		reasoning,
		total: parts.length - keepPartCount,
		contentChanges,
	};
}

/** Human-readable "Drop N … below." line for the seam confirm. */
export function describeDropped(d: DroppedSummary): string {
	const segs: string[] = [];
	if (d.text) segs.push(`${d.text} paragraph${d.text > 1 ? "s" : ""}`);
	if (d.tools) segs.push(`${d.tools} tool call${d.tools > 1 ? "s" : ""}`);
	if (d.reasoning)
		segs.push(`${d.reasoning} reasoning block${d.reasoning > 1 ? "s" : ""}`);
	const list = segs.length
		? segs.join(" + ")
		: `${d.total} block${d.total > 1 ? "s" : ""}`;
	return `Drop ${list} below.`;
}
