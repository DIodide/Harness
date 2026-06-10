import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
	const raw = convexTest(schema, modules);
	return {
		raw,
		asUser: (uid: string) =>
			raw.withIdentity({ subject: uid, issuer: "test" }),
	};
}

describe("userSettings.get", () => {
	it("returns baked-in defaults when unauthenticated", async () => {
		const { raw } = makeT();
		const settings = await raw.query(api.userSettings.get, {});
		expect(settings).toEqual({
			autoSwitchHarness: true,
			displayMode: "standard",
			modelSelectorMode: "session",
			chatConfigScope: "harness",
			workspacesMode: "workspaces",
		});
	});

	it("returns defaults when the user has no row yet", async () => {
		const a = makeT().asUser("user-a");
		const settings = await a.query(api.userSettings.get, {});
		expect(settings.autoSwitchHarness).toBe(true);
		expect(settings.displayMode).toBe("standard");
	});

	it("returns the stored row after an update", async () => {
		const a = makeT().asUser("user-a");
		await a.mutation(api.userSettings.update, {
			autoSwitchHarness: false,
			displayMode: "developer",
			modelSelectorMode: "harness",
			workspacesMode: "workspaces",
		});
		const settings = await a.query(api.userSettings.get, {});
		expect(settings).toEqual({
			autoSwitchHarness: false,
			displayMode: "developer",
			modelSelectorMode: "harness",
			chatConfigScope: "harness",
			workspacesMode: "workspaces",
		});
	});
});

describe("userSettings.update", () => {
	it("requires authentication", async () => {
		const { raw } = makeT();
		await expect(
			raw.mutation(api.userSettings.update, { autoSwitchHarness: false }),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("partially updates without clobbering existing fields", async () => {
		const a = makeT().asUser("user-a");
		await a.mutation(api.userSettings.update, {
			autoSwitchHarness: false,
			displayMode: "zen",
		});
		await a.mutation(api.userSettings.update, { displayMode: "developer" });
		const settings = await a.query(api.userSettings.get, {});
		expect(settings.displayMode).toBe("developer");
		expect(settings.autoSwitchHarness).toBe(false); // preserved
	});

	it("isolates settings per user", async () => {
		const { asUser } = makeT();
		const a = asUser("user-a");
		const b = asUser("user-b");
		await a.mutation(api.userSettings.update, { displayMode: "zen" });
		const bSettings = await b.query(api.userSettings.get, {});
		expect(bSettings.displayMode).toBe("standard");
	});

	it("ignores undefined args so they don't overwrite stored values", async () => {
		const a = makeT().asUser("user-a");
		await a.mutation(api.userSettings.update, { displayMode: "zen" });
		await a.mutation(api.userSettings.update, {}); // no-op
		const settings = await a.query(api.userSettings.get, {});
		expect(settings.displayMode).toBe("zen");
	});
});

describe("userSettings.chatConfigScope legacy fallback", () => {
	it("keeps session scope for rows that predate chatConfigScope", async () => {
		const { raw, asUser } = makeT();
		// Legacy row: explicit modelSelectorMode, no chatConfigScope field.
		await raw.run(async (ctx) => {
			await ctx.db.insert("userSettings", {
				userId: "legacy-user",
				autoSwitchHarness: true,
				modelSelectorMode: "session",
			});
		});
		const settings = await asUser("legacy-user").query(api.userSettings.get, {});
		expect(settings.chatConfigScope).toBe("session");
	});

	it("explicit chatConfigScope wins over the legacy field", async () => {
		const a = makeT().asUser("user-x");
		await a.mutation(api.userSettings.update, {
			modelSelectorMode: "session",
			chatConfigScope: "harness",
		});
		const settings = await a.query(api.userSettings.get, {});
		expect(settings.chatConfigScope).toBe("harness");
	});
});
