import { internalMutation } from "./_generated/server";

/**
 * Migrate harnesses from old `mcps: string[]` to new `mcpServers: McpServer[]`.
 *
 * Run once via the Convex dashboard:
 *   npx convex run migrations:migrateHarnessMcps
 */
export const migrateHarnessMcps = internalMutation({
	handler: async (ctx) => {
		const allHarnesses = await ctx.db.query("harnesses").collect();
		let migrated = 0;

		for (const harness of allHarnesses) {
			// Check if this doc still has the old field and lacks the new one
			const doc = harness as Record<string, unknown>;
			if (!("mcpServers" in doc) || doc.mcpServers === undefined) {
				await ctx.db.patch(harness._id, {
					mcpServers: [],
				});
				migrated++;
			}
		}

		return { total: allHarnesses.length, migrated };
	},
});
