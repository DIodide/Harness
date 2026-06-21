import type { Auth, UserIdentity } from "convex/server";

/**
 * Fixed identity used when ENABLE_DEV_AUTH is turned on for a deployment. Keep
 * this in sync with the FastAPI gateway's dev user (`app.auth.DEV_USER_ID`) so a
 * locally-run stack agrees on who "you" are.
 */
export const DEV_USER_ID = "dev-user";

/**
 * Resolve the caller's identity.
 *
 * In production this is EXACTLY `ctx.auth.getUserIdentity()`. When the
 * deployment env var `ENABLE_DEV_AUTH` is `"true"` (LOCAL DEVELOPMENT ONLY — set
 * it with `npx convex env set ENABLE_DEV_AUTH true`), it instead returns a fixed
 * fake identity so the whole app runs without Clerk for screenshots/local work.
 *
 * The flag is off by default, so every call site behaves identically to the raw
 * `ctx.auth.getUserIdentity()` in any real deployment — this is a pure
 * pass-through unless a developer explicitly opts in.
 */
export async function getIdentity(ctx: {
	auth: Auth;
}): Promise<UserIdentity | null> {
	if (process.env.ENABLE_DEV_AUTH === "true") {
		return {
			subject: DEV_USER_ID,
			issuer: "dev-auth",
			tokenIdentifier: `dev-auth|${DEV_USER_ID}`,
		};
	}
	return await ctx.auth.getUserIdentity();
}
