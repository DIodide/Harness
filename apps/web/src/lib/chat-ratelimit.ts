import { ArcjetHeaders } from "@arcjet/headers";
import { createServerFn } from "@tanstack/react-start";
import {
	getRequestHeaders,
	getRequestHost,
	getRequestProtocol,
	getWebRequest,
} from "vinxi/http";
import { aj } from "./arcjet";

export interface RateLimitResult {
	allowed: boolean;
	retryAfter?: number;
}

/**
 * Pre-flight rate limit check via Arcjet.
 * Called before the frontend sends a chat stream request to FastAPI.
 * Checks per-user request rate (not token budget — that's in Convex/FastAPI).
 */
export const checkChatRateLimit = createServerFn({ method: "POST" })
	.inputValidator((data: { userId: string }) => data)
	.handler(async ({ data }): Promise<RateLimitResult> => {
		const headers = getRequestHeaders();
		const host = getRequestHost();
		const protocol = getRequestProtocol();
		const request = getWebRequest();
		const url = new URL(request.url);

		const ip =
			(headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
			(headers["cf-connecting-ip"] as string) ||
			"127.0.0.1";

		const decision = await aj.protect(
			{ getBody: async () => "" },
			{
				cookies: headers.cookie ?? "",
				host,
				headers: new ArcjetHeaders(headers),
				ip,
				method: "POST",
				path: url.pathname,
				protocol: `${protocol}:`,
				query: url.search,
				userId: data.userId,
				requested: 1,
			},
		);

		if (decision.isDenied()) {
			let retryAfter: number | undefined;
			for (const result of decision.results) {
				if (result.reason.isRateLimit() && "reset" in result.reason) {
					retryAfter = result.reason.reset as number;
					break;
				}
			}
			return { allowed: false, retryAfter };
		}

		return { allowed: true };
	});
