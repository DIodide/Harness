import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const listByUser = query({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const connections = await ctx.db
			.query("userMcpConnections")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.collect();

		return connections.map((c) => ({
			_id: c._id,
			serverName: c.serverName,
			serverUrl: c.serverUrl,
			connectedAt: c.connectedAt,
		}));
	},
});

export const getToken = internalQuery({
	args: { userId: v.string(), serverName: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("userMcpConnections")
			.withIndex("by_user_server", (q) =>
				q.eq("userId", args.userId).eq("serverName", args.serverName),
			)
			.unique();
	},
});

export const upsert = internalMutation({
	args: {
		userId: v.string(),
		serverName: v.string(),
		serverUrl: v.string(),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
		scopes: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("userMcpConnections")
			.withIndex("by_user_server", (q) =>
				q.eq("userId", args.userId).eq("serverName", args.serverName),
			)
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				accessToken: args.accessToken,
				refreshToken: args.refreshToken,
				tokenExpiresAt: args.tokenExpiresAt,
				scopes: args.scopes,
				connectedAt: Date.now(),
			});
			return existing._id;
		}

		return await ctx.db.insert("userMcpConnections", {
			userId: args.userId,
			serverName: args.serverName,
			serverUrl: args.serverUrl,
			accessToken: args.accessToken,
			refreshToken: args.refreshToken,
			tokenExpiresAt: args.tokenExpiresAt,
			scopes: args.scopes,
			connectedAt: Date.now(),
		});
	},
});

export const remove = mutation({
	args: { userId: v.string(), serverName: v.string() },
	handler: async (ctx, args) => {
		const connection = await ctx.db
			.query("userMcpConnections")
			.withIndex("by_user_server", (q) =>
				q.eq("userId", args.userId).eq("serverName", args.serverName),
			)
			.unique();

		if (connection) {
			await ctx.db.delete(connection._id);
		}
	},
});
