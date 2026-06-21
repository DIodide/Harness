import {
	useAuth as clerkUseAuth,
	useClerk as clerkUseClerk,
	useReverification as clerkUseReverification,
	useUser as clerkUseUser,
} from "@clerk/tanstack-react-start";
import { env } from "../env";

/**
 * Single switch for the loginless local-dev mode. When `VITE_ENABLE_DEV_AUTH` is
 * "true", the app skips Clerk entirely and runs as a fixed dev user — pair it
 * with `ENABLE_DEV_AUTH` on the Convex deployment and the FastAPI gateway.
 *
 * Off by default, and `DEV_AUTH` is a build-time constant, so the exported hooks
 * below resolve to the REAL Clerk hooks in every normal build — this module is a
 * pure pass-through unless a developer explicitly opts in. Import the auth hooks
 * from here (`@/lib/auth`) instead of `@clerk/tanstack-react-start` so the
 * bypass reaches every call site.
 */
export const DEV_AUTH = env.VITE_ENABLE_DEV_AUTH === "true";
export const DEV_USER_ID = "dev-user";

// Dev stubs — shapes mirror the subset of each Clerk hook's return the app reads.
const devUseAuth = (() => ({
	isLoaded: true,
	isSignedIn: true,
	userId: DEV_USER_ID,
	sessionId: "dev-session",
	orgId: null,
	orgRole: null,
	// Return null, not a fake token: Convex/FastAPI bypass auth via ENABLE_DEV_AUTH,
	// and a non-JWT token fails Convex's header parse.
	getToken: async () => null,
	signOut: async () => {},
})) as unknown as typeof clerkUseAuth;

const devUseUser = (() => ({
	isLoaded: true,
	isSignedIn: true,
	user: {
		id: DEV_USER_ID,
		fullName: "Dev User",
		firstName: "Dev",
		lastName: "User",
		primaryEmailAddress: { emailAddress: "dev@localhost" },
		imageUrl: "",
	},
})) as unknown as typeof clerkUseUser;

const devUseClerk = (() => ({
	signOut: async () => {},
	openSignIn: () => {},
	openUserProfile: () => {},
})) as unknown as typeof clerkUseClerk;

// useReverification wraps an action that may need step-up auth; in dev, pass through.
const devUseReverification = (<T>(fn: T) =>
	fn) as unknown as typeof clerkUseReverification;

export const useAuth = DEV_AUTH ? devUseAuth : clerkUseAuth;
export const useUser = DEV_AUTH ? devUseUser : clerkUseUser;
export const useClerk = DEV_AUTH ? devUseClerk : clerkUseClerk;
export const useReverification = DEV_AUTH
	? devUseReverification
	: clerkUseReverification;
