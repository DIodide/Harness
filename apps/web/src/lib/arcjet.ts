import { createClient } from "@arcjet/protocol/client.js";
import { createTransport } from "@arcjet/transport";
import arcjetCore, { shield, tokenBucket } from "arcjet";

import { env } from "@/env";

const BASE_URL = "https://decide.arcjet.com";

export const aj = env.ARCJET_KEY
	? arcjetCore({
			client: createClient({
				baseUrl: BASE_URL,
				// biome-ignore lint/suspicious/noExplicitAny: Arcjet SDK doesn't export the sdkStack enum type
				sdkStack: "NODEJS" as any,
				// Keep in sync with arcjet version in package.json
				sdkVersion: "1.3.1",
				timeout: 500,
				transport: createTransport(BASE_URL),
			}),
			key: env.ARCJET_KEY,
			log: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: console.error,
			},
			rules: [
				tokenBucket({
					mode: "LIVE",
					characteristics: ["userId"],
					refillRate: 20,
					interval: "1m",
					capacity: 30,
				}),
				shield({ mode: "LIVE" }),
			],
		})
	: null;
