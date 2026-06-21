import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getIdentity } from "./authDev";

/**
 * Upsert commands for the authenticated user: insert new ones, update the
 * caller's existing ones (matched by userId + name). Returns command IDs in
 * input order. Scoping by userId prevents one user's sync from overwriting
 * another user's identically-named command row.
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
		const identity = await getIdentity(ctx);
		if (!identity) throw new Error("Unauthenticated");
		const userId = identity.subject;

		// Batch-lookup the caller's existing commands by (userId, name).
		const existing = await Promise.all(
			args.commands.map((cmd) =>
				ctx.db
					.query("commands")
					.withIndex("by_user_and_name", (q) =>
						q.eq("userId", userId).eq("name", cmd.name),
					)
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
				const id = await ctx.db.insert("commands", { ...cmd, userId });
				ids.push(id);
			}
		}
		return ids;
	},
});

/** Fetch commands by a list of IDs, scoped to the caller. Rows owned by
 *  another user are filtered out (legacy unowned rows are still returned for
 *  backward-compat during the transition). */
export const getByIds = query({
	args: { ids: v.array(v.id("commands")) },
	handler: async (ctx, args) => {
		const identity = await getIdentity(ctx);
		const userId = identity?.subject;
		const results = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
		return results.filter(
			(row) => row && (row.userId === undefined || row.userId === userId),
		);
	},
});
