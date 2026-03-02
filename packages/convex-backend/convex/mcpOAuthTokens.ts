import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

/**
 * Get OAuth token status for a specific MCP server (frontend use).
 * Returns whether the user has a valid token, without exposing the token itself.
 */
export const getStatus = query({
	args: { mcpServerUrl: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const token = await ctx.db
			.query("mcpOAuthTokens")
			.withIndex("by_user_and_server", (q) =>
				q.eq("userId", identity.subject).eq("mcpServerUrl", args.mcpServerUrl),
			)
			.unique();
		if (!token) return { connected: false };
		return {
			connected: true,
			expiresAt: token.expiresAt,
			scopes: token.scopes,
		};
	},
});

/**
 * Get all OAuth token statuses for the current user (frontend use).
 */
export const listStatuses = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const tokens = await ctx.db
			.query("mcpOAuthTokens")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		return tokens.map((t) => ({
			mcpServerUrl: t.mcpServerUrl,
			connected: true,
			expiresAt: t.expiresAt,
			scopes: t.scopes,
		}));
	},
});

/**
 * Store or update OAuth tokens for a user+server pair.
 * Called by the FastAPI backend via deploy key after OAuth callback.
 */
export const storeTokens = internalMutation({
	args: {
		userId: v.string(),
		mcpServerUrl: v.string(),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		expiresAt: v.number(),
		scopes: v.string(),
		authServerUrl: v.string(),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("mcpOAuthTokens")
			.withIndex("by_user_and_server", (q) =>
				q.eq("userId", args.userId).eq("mcpServerUrl", args.mcpServerUrl),
			)
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				accessToken: args.accessToken,
				refreshToken: args.refreshToken,
				expiresAt: args.expiresAt,
				scopes: args.scopes,
				authServerUrl: args.authServerUrl,
			});
		} else {
			await ctx.db.insert("mcpOAuthTokens", args);
		}
	},
});

/**
 * Get tokens for a user+server pair. Called by FastAPI backend via deploy key
 * to resolve tokens when making MCP requests.
 */
export const getTokens = internalQuery({
	args: {
		userId: v.string(),
		mcpServerUrl: v.string(),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("mcpOAuthTokens")
			.withIndex("by_user_and_server", (q) =>
				q.eq("userId", args.userId).eq("mcpServerUrl", args.mcpServerUrl),
			)
			.unique();
	},
});

/**
 * Delete OAuth tokens for a user+server pair.
 * Can be called from frontend (authenticated) or backend (deploy key).
 */
export const deleteTokens = mutation({
	args: { mcpServerUrl: v.string() },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		const token = await ctx.db
			.query("mcpOAuthTokens")
			.withIndex("by_user_and_server", (q) =>
				q.eq("userId", identity.subject).eq("mcpServerUrl", args.mcpServerUrl),
			)
			.unique();
		if (token) {
			await ctx.db.delete(token._id);
		}
	},
});

/**
 * Internal delete for backend use (e.g., when refresh fails).
 */
export const deleteTokensInternal = internalMutation({
	args: {
		userId: v.string(),
		mcpServerUrl: v.string(),
	},
	handler: async (ctx, args) => {
		const token = await ctx.db
			.query("mcpOAuthTokens")
			.withIndex("by_user_and_server", (q) =>
				q.eq("userId", args.userId).eq("mcpServerUrl", args.mcpServerUrl),
			)
			.unique();
		if (token) {
			await ctx.db.delete(token._id);
		}
	},
});
