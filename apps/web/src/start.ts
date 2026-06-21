import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createStart } from "@tanstack/react-start";

// Build-time constant (read directly, not via ./lib/auth which pulls client
// hooks) so loginless dev mode skips Clerk's server middleware — it throws
// "no secret key provided" on every request when Clerk isn't configured.
const DEV_AUTH = import.meta.env.VITE_ENABLE_DEV_AUTH === "true";

// https://clerk.com/docs/tanstack-react-start/getting-started/quickstart
export const startInstance = createStart(() => {
	return {
		requestMiddleware: DEV_AUTH ? [] : [clerkMiddleware()],
	};
});
