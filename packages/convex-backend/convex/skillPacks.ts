import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

// Defensive bounds. Packs are lightweight, but cap them so a runaway client
// can't accumulate unbounded rows, and bound the markdown so a pack can't bloat
// the harness config / sandbox writes.
const MAX_SKILL_PACKS_PER_USER = 50;
const MAX_MD_LENGTH = 50_000;
const MAX_NAME_LENGTH = 120;

const skillValidator = v.object({
	name: v.string(),
	description: v.string(),
});

function sanitizeName(raw: string): string {
	const name = raw.trim();
	if (!name) throw new Error("Skill pack name is required");
	if (name.length > MAX_NAME_LENGTH) throw new Error("Skill pack name is too long");
	return name;
}

function checkMd(label: string, value: string | undefined) {
	if (value && value.length > MAX_MD_LENGTH) {
		throw new Error(`${label} is too large (max ${MAX_MD_LENGTH} characters)`);
	}
}

export const list = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		return await ctx.db
			.query("skillPacks")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
	},
});

export const get = query({
	args: { id: v.id("skillPacks") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const pack = await ctx.db.get(args.id);
		if (!pack || pack.userId !== identity.subject) return null;
		return pack;
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		skills: v.optional(v.array(skillValidator)),
		agentsMd: v.optional(v.string()),
		claudeMd: v.optional(v.string()),
		claudeImportsAgents: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const name = sanitizeName(args.name);
		checkMd("AGENTS.md", args.agentsMd);
		checkMd("CLAUDE.md", args.claudeMd);

		const existing = await ctx.db
			.query("skillPacks")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		if (existing.length >= MAX_SKILL_PACKS_PER_USER) {
			throw new Error(
				`You've reached the limit of ${MAX_SKILL_PACKS_PER_USER} skill packs.`,
			);
		}

		const now = Date.now();
		return await ctx.db.insert("skillPacks", {
			userId: identity.subject,
			name,
			description: args.description?.trim() || undefined,
			skills: args.skills ?? [],
			agentsMd: args.agentsMd || undefined,
			claudeMd: args.claudeMd || undefined,
			claudeImportsAgents: args.claudeImportsAgents || undefined,
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("skillPacks"),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		skills: v.optional(v.array(skillValidator)),
		agentsMd: v.optional(v.string()),
		claudeMd: v.optional(v.string()),
		claudeImportsAgents: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const pack = await ctx.db.get(args.id);
		if (!pack || pack.userId !== identity.subject) {
			throw new Error("Skill pack not found");
		}
		checkMd("AGENTS.md", args.agentsMd);
		checkMd("CLAUDE.md", args.claudeMd);

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.name !== undefined) updates.name = sanitizeName(args.name);
		if (args.description !== undefined) {
			updates.description = args.description.trim() || undefined;
		}
		if (args.skills !== undefined) updates.skills = args.skills;
		// Empty string clears the field (an empty AGENTS.md/CLAUDE.md = none).
		if (args.agentsMd !== undefined) updates.agentsMd = args.agentsMd || undefined;
		if (args.claudeMd !== undefined) updates.claudeMd = args.claudeMd || undefined;
		if (args.claudeImportsAgents !== undefined) {
			updates.claudeImportsAgents = args.claudeImportsAgents || undefined;
		}
		await ctx.db.patch(args.id, updates);
	},
});

export const remove = mutation({
	args: { id: v.id("skillPacks") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const pack = await ctx.db.get(args.id);
		if (!pack || pack.userId !== identity.subject) {
			throw new Error("Skill pack not found");
		}
		// Detach this pack from any harness that references it, so harnesses
		// never point at a deleted pack.
		const harnesses = await ctx.db
			.query("harnesses")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		await Promise.all(
			harnesses
				.filter((h) => h.skillPackIds?.includes(args.id))
				.map((h) =>
					ctx.db.patch(h._id, {
						skillPackIds: h.skillPackIds?.filter((id) => id !== args.id),
					}),
				),
		);
		await ctx.db.delete(args.id);
	},
});

/**
 * Resolve a harness's skill packs into the context the ACP gateway needs:
 * concatenated AGENTS.md / CLAUDE.md (in pack order, each headed by its pack
 * name) and the union of skills joined to their cached SKILL.md content. Only
 * packs owned by `userId` are honored (defense-in-depth — the gateway passes
 * the owner's id). Skills whose SKILL.md isn't cached yet come back with an
 * empty `detail`; the gateway skips materializing those.
 */
export const resolveForGateway = internalQuery({
	args: {
		userId: v.string(),
		skillPackIds: v.array(v.id("skillPacks")),
	},
	handler: async (ctx, args) => {
		const packs = (
			await Promise.all(args.skillPackIds.map((id) => ctx.db.get(id)))
		).filter((p) => p && p.userId === args.userId);

		const agentsParts: string[] = [];
		const claudeParts: string[] = [];
		let claudeImportsAgents = false;
		// Union skills across packs, de-duped by name (first description wins).
		const skillByName = new Map<string, string>();
		for (const pack of packs) {
			if (!pack) continue;
			if (pack.agentsMd) agentsParts.push(`<!-- ${pack.name} -->\n${pack.agentsMd}`);
			if (pack.claudeMd) claudeParts.push(`<!-- ${pack.name} -->\n${pack.claudeMd}`);
			if (pack.claudeImportsAgents) claudeImportsAgents = true;
			for (const skill of pack.skills) {
				if (!skillByName.has(skill.name)) {
					skillByName.set(skill.name, skill.description);
				}
			}
		}

		const skills = await Promise.all(
			[...skillByName.entries()].map(async ([name, description]) => {
				const detailRow = await ctx.db
					.query("skillDetails")
					.withIndex("by_name", (q) => q.eq("name", name))
					.first();
				return {
					name,
					description,
					detail: detailRow?.detail ?? "",
					skillName: detailRow?.skillName ?? name.split("/").pop() ?? name,
				};
			}),
		);

		return {
			agentsMd: agentsParts.join("\n\n"),
			claudeMd: claudeParts.join("\n\n"),
			claudeImportsAgents,
			skills,
		};
	},
});
