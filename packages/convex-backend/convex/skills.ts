import { v } from "convex/values";
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";

// ── skillDetails (full SKILL.md content, cached) ────────────────────

export const getByName = query({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
	},
});

export const getByNames = query({
	args: { names: v.array(v.string()) },
	handler: async (ctx, args) => {
		const results = await Promise.all(
			args.names.map((name) =>
				ctx.db
					.query("skillDetails")
					.withIndex("by_name", (q) => q.eq("name", name))
					.first(),
			),
		);
		return results.filter(Boolean);
	},
});

export const upsertSkillDetail = internalMutation({
	args: {
		name: v.string(),
		skillName: v.string(),
		description: v.string(),
		detail: v.string(),
		code: v.string(),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				skillName: args.skillName,
				description: args.description,
				detail: args.detail,
				code: args.code,
			});
			return existing._id;
		}
		return await ctx.db.insert("skillDetails", args);
	},
});

// ── skillsIndex (browseable catalog) ────────────────────────────────

export const browseSkills = query({
	args: { offset: v.number(), limit: v.number() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("skillsIndex")
			.withIndex("by_installs")
			.order("desc")
			.take(args.offset + args.limit);
		return {
			rows: rows.slice(args.offset),
			offset: args.offset,
			limit: args.limit,
		};
	},
});

export const searchSkillsIndex = query({
	args: { query: v.string(), limit: v.number() },
	handler: async (ctx, args) => {
		const results = await ctx.db
			.query("skillsIndex")
			.withSearchIndex("search_skills", (q) => q.search("description", args.query))
			.take(args.limit);
		return results;
	},
});

export const getSkillsIndexCount = query({
	args: {},
	handler: async (ctx) => {
		const all = await ctx.db.query("skillsIndex").collect();
		return all.length;
	},
});

/** Upsert a batch of skills discovered from skills.sh search API */
export const upsertSkillsIndexBatch = mutation({
	args: {
		skills: v.array(
			v.object({
				skillId: v.string(),
				fullId: v.string(),
				source: v.string(),
				description: v.string(),
				installs: v.number(),
			}),
		),
	},
	handler: async (ctx, args) => {
		let added = 0;
		for (const skill of args.skills) {
			const existing = await ctx.db
				.query("skillsIndex")
				.withIndex("by_fullId", (q) => q.eq("fullId", skill.fullId))
				.first();
			if (existing) {
				// Update installs count if changed
				if (existing.installs !== skill.installs) {
					await ctx.db.patch(existing._id, { installs: skill.installs });
				}
			} else {
				await ctx.db.insert("skillsIndex", skill);
				added++;
			}
		}
		return added;
	},
});

/** Check which fullIds already exist in the index */
export const checkExistingSkills = internalQuery({
	args: { fullIds: v.array(v.string()) },
	handler: async (ctx, args) => {
		const existing = new Set<string>();
		for (const fullId of args.fullIds) {
			const doc = await ctx.db
				.query("skillsIndex")
				.withIndex("by_fullId", (q) => q.eq("fullId", fullId))
				.first();
			if (doc) existing.add(fullId);
		}
		return [...existing];
	},
});

/**
 * Background action called after saving a harness.
 * Fetches SKILL.md content from GitHub and caches in skillDetails.
 */
export const ensureSkillDetails = action({
	args: { names: v.array(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		for (const name of args.names) {
			// Check if we already have it cached
			const existing = await ctx.runQuery(internal.skills.getDetailByName, {
				name,
			});
			if (existing?.detail) continue;

			// Parse name: "owner/repo/skill-id" → source="owner/repo", skillId="skill-id"
			const parts = name.split("/");
			const skillId = parts.pop() ?? name;
			const source = parts.join("/");

			if (!source) continue;

			// Try fetching SKILL.md from GitHub raw with path fallbacks
			const urlsToTry = [
				`https://raw.githubusercontent.com/${source}/main/skills/${skillId}/SKILL.md`,
				`https://raw.githubusercontent.com/${source}/main/.agents/skills/${skillId}/SKILL.md`,
				`https://raw.githubusercontent.com/${source}/main/.claude/skills/${skillId}/SKILL.md`,
				`https://raw.githubusercontent.com/${source}/main/SKILL.md`,
			];

			let detail = "";
			let description = "";
			for (const url of urlsToTry) {
				try {
					const resp = await fetch(url);
					if (resp.ok) {
						const text = await resp.text();
						detail = text;
						// Extract description from YAML frontmatter
						const fmMatch = text.match(
							/^---\s*\n([\s\S]*?)\n---/,
						);
						if (fmMatch) {
							const descMatch = fmMatch[1].match(
								/description:\s*(.+)/,
							);
							if (descMatch) {
								description = descMatch[1].trim().replace(/^["']|["']$/g, "");
							}
						}
						break;
					}
				} catch {
					// Try next URL
				}
			}

			if (!detail) continue;

			await ctx.runMutation(internal.skills.upsertSkillDetail, {
				name,
				skillName: skillId,
				description,
				detail,
				code: `npx skills add https://github.com/${source} --skill ${skillId}`,
			});
		}
	},
});

/** Internal query used by ensureSkillDetails to check cache */
export const getDetailByName = internalQuery({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
	},
});

/**
 * Action to discover and upsert new skills from skills.sh search API.
 * Called from the frontend when search returns results not in our index.
 */
export const discoverSkillsFromSearch = action({
	args: {
		skills: v.array(
			v.object({
				skillId: v.string(),
				fullId: v.string(),
				source: v.string(),
				installs: v.number(),
			}),
		),
	},
	handler: async (ctx, args): Promise<number> => {
		// Check which ones we already have
		const fullIds = args.skills.map((s) => s.fullId);
		const existingIds = await ctx.runQuery(
			internal.skills.checkExistingSkills,
			{ fullIds },
		);
		const existingSet = new Set(existingIds);

		const newSkills = args.skills.filter(
			(s) => !existingSet.has(s.fullId),
		);
		if (newSkills.length === 0) return 0;

		// For each new skill, try to fetch description from GitHub SKILL.md
		const toUpsert: Array<{
			skillId: string;
			fullId: string;
			source: string;
			description: string;
			installs: number;
		}> = [];

		for (const skill of newSkills) {
			let description = "";
			const urlsToTry = [
				`https://raw.githubusercontent.com/${skill.source}/main/skills/${skill.skillId}/SKILL.md`,
				`https://raw.githubusercontent.com/${skill.source}/main/.agents/skills/${skill.skillId}/SKILL.md`,
				`https://raw.githubusercontent.com/${skill.source}/main/.claude/skills/${skill.skillId}/SKILL.md`,
			];

			for (const url of urlsToTry) {
				try {
					const resp = await fetch(url);
					if (resp.ok) {
						const text = await resp.text();
						const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
						if (fmMatch) {
							const descMatch = fmMatch[1].match(
								/description:\s*(.+)/,
							);
							if (descMatch) {
								description = descMatch[1].trim().replace(/^["']|["']$/g, "");
							}
						}
						break;
					}
				} catch {
					// Try next URL
				}
			}

			toUpsert.push({
				skillId: skill.skillId,
				fullId: skill.fullId,
				source: skill.source,
				description,
				installs: skill.installs,
			});
		}

		if (toUpsert.length > 0) {
			return await ctx.runMutation(api.skills.upsertSkillsIndexBatch, {
				skills: toUpsert,
			});
		}
		return 0;
	},
});
