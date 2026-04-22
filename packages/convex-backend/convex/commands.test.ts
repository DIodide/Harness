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

const baseCmd = (overrides: Partial<{
	name: string;
	server: string;
	tool: string;
	description: string;
	parametersJson: string;
}> = {}) => ({
	name: "do-thing",
	server: "srv",
	tool: "tool",
	description: "does a thing",
	parametersJson: "{}",
	...overrides,
});

describe("commands.upsert", () => {
	it("requires authentication", async () => {
		const { raw } = makeT();
		await expect(
			raw.mutation(api.commands.upsert, { commands: [baseCmd()] }),
		).rejects.toThrow(/Unauthenticated/);
	});

	it("inserts new commands and returns their IDs in input order", async () => {
		const a = makeT().asUser("user-a");
		const ids = await a.mutation(api.commands.upsert, {
			commands: [
				baseCmd({ name: "a" }),
				baseCmd({ name: "b" }),
			],
		});
		expect(ids).toHaveLength(2);
		const rows = await a.query(api.commands.getByIds, { ids });
		expect(rows.map((r) => r?.name)).toEqual(["a", "b"]);
	});

	it("updates existing command rows when the name matches", async () => {
		const a = makeT().asUser("user-a");
		const [id] = await a.mutation(api.commands.upsert, {
			commands: [baseCmd({ name: "dup", description: "v1" })],
		});
		const [id2] = await a.mutation(api.commands.upsert, {
			commands: [baseCmd({ name: "dup", description: "v2" })],
		});
		expect(id).toBe(id2);
		const [row] = await a.query(api.commands.getByIds, { ids: [id] });
		expect(row?.description).toBe("v2");
	});
});

describe("commands.getByIds", () => {
	it("returns rows for valid IDs and filters out missing ones", async () => {
		const { raw, asUser } = makeT();
		const a = asUser("user-a");
		const [good] = await a.mutation(api.commands.upsert, {
			commands: [baseCmd({ name: "g" })],
		});

		// Delete it directly through the harness to simulate a stale ID.
		await raw.run(async (ctx) => {
			await ctx.db.delete(good);
		});

		const rows = await a.query(api.commands.getByIds, { ids: [good] });
		expect(rows).toEqual([]);
	});

	it("returns empty for an empty input array", async () => {
		const a = makeT().asUser("user-a");
		const rows = await a.query(api.commands.getByIds, { ids: [] });
		expect(rows).toEqual([]);
	});
});
