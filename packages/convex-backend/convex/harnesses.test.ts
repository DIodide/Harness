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

const baseHarness = (overrides: Partial<{
	name: string;
	model: string;
	status: "started" | "stopped" | "draft";
	systemPrompt?: string;
}> = {}) => ({
	name: "test",
	model: "claude-opus-4.7",
	status: "stopped" as const,
	mcpServers: [],
	skills: [],
	...overrides,
});

describe("harnesses.list / get", () => {
	it("returns [] when unauthenticated", async () => {
		const { raw } = makeT();
		expect(await raw.query(api.harnesses.list, {})).toEqual([]);
	});

	it("scopes list to the caller's user", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		await a.mutation(api.harnesses.create, baseHarness({ name: "a1" }));
		await b.mutation(api.harnesses.create, baseHarness({ name: "b1" }));
		const aList = await a.query(api.harnesses.list, {});
		expect(aList.map((h) => h.name)).toEqual(["a1"]);
	});

	it("get returns null for a harness owned by someone else", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const id = await a.mutation(api.harnesses.create, baseHarness());
		expect(await b.query(api.harnesses.get, { id })).toBeNull();
	});
});

describe("harnesses.create", () => {
	it("requires authentication", async () => {
		const { raw } = makeT();
		await expect(
			raw.mutation(api.harnesses.create, baseHarness()),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("rejects system prompts longer than 4000 chars", async () => {
		const a = makeT().asUser("u-a");
		await expect(
			a.mutation(
				api.harnesses.create,
				baseHarness({ systemPrompt: "x".repeat(4001) }),
			),
		).rejects.toThrow(/at most 4000 characters/);
	});

	it("accepts exactly 4000-char system prompts (boundary)", async () => {
		const a = makeT().asUser("u-a");
		const id = await a.mutation(
			api.harnesses.create,
			baseHarness({ systemPrompt: "x".repeat(4000) }),
		);
		const row = await a.query(api.harnesses.get, { id });
		expect(row?.systemPrompt?.length).toBe(4000);
	});
});

describe("harnesses.update", () => {
	it("rejects oversize system prompt on update", async () => {
		const a = makeT().asUser("u-a");
		const id = await a.mutation(api.harnesses.create, baseHarness());
		await expect(
			a.mutation(api.harnesses.update, {
				id,
				systemPrompt: "y".repeat(4001),
			}),
		).rejects.toThrow(/at most 4000 characters/);
	});

	it("ignores undefined fields in patch", async () => {
		const a = makeT().asUser("u-a");
		const id = await a.mutation(
			api.harnesses.create,
			baseHarness({ name: "orig" }),
		);
		await a.mutation(api.harnesses.update, { id }); // no-op
		const row = await a.query(api.harnesses.get, { id });
		expect(row?.name).toBe("orig");
	});

	it("rejects updates from a different user", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const id = await a.mutation(api.harnesses.create, baseHarness());
		await expect(
			b.mutation(api.harnesses.update, { id, name: "hijack" }),
		).rejects.toThrow(/Not found/);
	});
});

describe("harnesses.duplicate", () => {
	it("clones with a 'Copy of' name prefix", async () => {
		const a = makeT().asUser("u-a");
		const id = await a.mutation(
			api.harnesses.create,
			baseHarness({ name: "base" }),
		);
		const dupId = await a.mutation(api.harnesses.duplicate, { id });
		const dup = await a.query(api.harnesses.get, { id: dupId });
		expect(dup?.name).toBe("Copy of base");
	});
});

describe("harnesses.remove", () => {
	it("deletes a row owned by the caller", async () => {
		const a = makeT().asUser("u-a");
		const id = await a.mutation(api.harnesses.create, baseHarness());
		await a.mutation(api.harnesses.remove, { id });
		expect(await a.query(api.harnesses.get, { id })).toBeNull();
	});

	it("rejects removing a row owned by someone else", async () => {
		const { asUser } = makeT();
		const a = asUser("u-a");
		const b = asUser("u-b");
		const id = await a.mutation(api.harnesses.create, baseHarness());
		await expect(b.mutation(api.harnesses.remove, { id })).rejects.toThrow(
			/Not found/,
		);
	});
});
