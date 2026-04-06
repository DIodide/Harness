import { internalMutation } from "./_generated/server";

/**
 * Backfill userId on messages that were created before the field was added.
 * Looks up the parent conversation and copies its userId onto the message.
 *
 * Run via the Convex dashboard:
 *   npx convex run --prod migrations:backfillMessageUserId
 *
 * Processes up to 500 messages per invocation to stay within Convex limits.
 * Re-run until it returns { migrated: 0 } to confirm all messages are patched.
 */
export const backfillMessageUserId = internalMutation({
	handler: async (ctx) => {
		const messages = await ctx.db
			.query("messages")
			.filter((q) => q.eq(q.field("userId"), undefined))
			.take(500);

		let migrated = 0;
		for (const msg of messages) {
			const convo = await ctx.db.get(msg.conversationId);
			if (convo) {
				await ctx.db.patch(msg._id, { userId: convo.userId });
				migrated++;
			}
		}

		return { migrated, done: messages.length < 500 };
	},
});
