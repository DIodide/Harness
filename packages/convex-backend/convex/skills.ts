import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
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

/**
 * Background action called after saving a harness.
 * Fetches skill details from HuggingFace and upserts them into the database.
 * Skips skills whose detail can't be resolved (no insert with empty detail,
 * and existing records are left unchanged when HF returns nothing).
 */
export const ensureSkillDetails = action({
	args: { names: v.array(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		for (const name of args.names) {
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
				// Non-blocking: if fetch fails, detail stays empty → skip below
			}

			if (!detail) continue;

			await ctx.runMutation(internal.skills.upsertSkillDetail, {
				name,
				skillName,
				description,
				detail,
				code,
			});
		}
	},
});
