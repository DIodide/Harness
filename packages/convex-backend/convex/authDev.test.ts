import { afterEach, describe, expect, it } from "vitest";
import { DEV_USER_ID, getIdentity } from "./authDev";

const realIdentity = {
	subject: "real-user",
	issuer: "clerk",
	tokenIdentifier: "clerk|real-user",
};

// Minimal ctx stub — getIdentity only touches ctx.auth.getUserIdentity().
function makeCtx(onCall?: () => void) {
	return {
		auth: {
			getUserIdentity: async () => {
				onCall?.();
				return realIdentity;
			},
		},
	} as unknown as Parameters<typeof getIdentity>[0];
}

afterEach(() => {
	process.env.ENABLE_DEV_AUTH = undefined;
});

describe("getIdentity", () => {
	it("delegates to ctx.auth.getUserIdentity() when ENABLE_DEV_AUTH is unset", async () => {
		expect(await getIdentity(makeCtx())).toEqual(realIdentity);
	});

	it("delegates when ENABLE_DEV_AUTH is set to anything other than 'true'", async () => {
		process.env.ENABLE_DEV_AUTH = "false";
		expect(await getIdentity(makeCtx())).toEqual(realIdentity);
	});

	it("returns a fixed dev identity when ENABLE_DEV_AUTH=true", async () => {
		process.env.ENABLE_DEV_AUTH = "true";
		const id = await getIdentity(makeCtx());
		expect(id?.subject).toBe(DEV_USER_ID);
		expect(id?.issuer).toBe("dev-auth");
	});

	it("does not consult ctx.auth in dev mode", async () => {
		process.env.ENABLE_DEV_AUTH = "true";
		let called = false;
		const id = await getIdentity(
			makeCtx(() => {
				called = true;
			}),
		);
		expect(called).toBe(false);
		expect(id?.subject).toBe(DEV_USER_ID);
	});
});
