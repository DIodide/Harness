import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createStart } from "@tanstack/react-start";

// https://clerk.com/docs/tanstack-react-start/getting-started/quickstart
export const startInstance = createStart(() => {
	return {
		requestMiddleware: [clerkMiddleware()],
	};
});
