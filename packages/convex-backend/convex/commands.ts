import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Upsert commands: insert new ones, update existing ones (matched by name + userId).
 * Returns an array of command IDs in the same order as the input.
 */
export const upsert = mutation({
	args: {
		commands: v.array(
			v.object({
				name: v.string(),
				server: v.string(),
				tool: v.string(),
				description: v.string(),
				parametersJson: v.string(),
			}),
		),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		// Batch-lookup existing commands by name
		const existing = await Promise.all(
			args.commands.map((cmd) =>
				ctx.db
					.query("commands")
					.withIndex("by_name", (q) => q.eq("name", cmd.name))
					.unique(),
			),
		);

		const ids = [];
		for (let i = 0; i < args.commands.length; i++) {
			const cmd = args.commands[i];
			const found = existing[i];
			if (found) {
				await ctx.db.patch(found._id, {
					server: cmd.server,
					tool: cmd.tool,
					description: cmd.description,
					parametersJson: cmd.parametersJson,
				});
				ids.push(found._id);
			} else {
				const id = await ctx.db.insert("commands", cmd);
				ids.push(id);
			}
		}
		return ids;
	},
});

/** Fetch commands by a list of IDs. */
export const getByIds = query({
	args: { ids: v.array(v.id("commands")) },
	handler: async (ctx, args) => {
		const results = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
		return results.filter(Boolean);
	},
});
