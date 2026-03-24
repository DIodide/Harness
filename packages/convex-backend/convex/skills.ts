import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";

const HF_DATASET = "tickleliu/all-skills-from-skills-sh";
const HF_BASE = "https://datasets-server.huggingface.co";

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

export const insertSkillDetail = internalMutation({
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
		if (existing) return existing._id;
		return await ctx.db.insert("skillDetails", args);
	},
});

export const checkExists = internalQuery({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
		return row !== null;
	},
});

/**
 * Background action called after saving a harness.
 * Fetches and stores skill details from HuggingFace for any skills
 * that don't already have a detail record in the database.
 */
export const ensureSkillDetails = action({
	args: { names: v.array(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		for (const name of args.names) {
			const exists = await ctx.runQuery(internal.skills.checkExists, { name });
			if (exists) continue;

			let detail = "";
			let skillName = name.split("/").pop() ?? name;
			let description = "";
			let code = "";

			try {
				const encoded = encodeURIComponent(name);
				const url = `${HF_BASE}/search?dataset=${HF_DATASET}&config=default&split=train&query=${encoded}&offset=0&length=5`;
				const resp = await fetch(url);
				if (resp.ok) {
					const data = await resp.json();
					for (const entry of data.rows ?? []) {
						const row = entry.row ?? entry;
						if (row.name === name) {
							detail = row.detail ?? "";
							skillName = row.skill_name ?? skillName;
							description = row.description ?? "";
							code = row.code ?? "";
							break;
						}
					}
				}
			} catch {
				// Non-blocking: store with whatever we have
			}

			await ctx.runMutation(internal.skills.insertSkillDetail, {
				name,
				skillName,
				description,
				detail,
				code,
			});
		}
	},
});
