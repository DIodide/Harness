import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Generates a short-lived presigned upload URL for Convex file storage.
 * The client POSTs the file bytes directly to this URL, then receives
 * a storageId in the response JSON.
 */
export const generateUploadUrl = mutation({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		return await ctx.storage.generateUploadUrl();
	},
});

/**
 * Returns the serving URL for a stored file, or null if not found.
 * Used to render attachment thumbnails in message history and to
 * resolve storageIds to URLs before sending to FastAPI.
 */
export const getFileUrl = query({
	args: { storageId: v.id("_storage") },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return await ctx.storage.getUrl(args.storageId);
	},
});
