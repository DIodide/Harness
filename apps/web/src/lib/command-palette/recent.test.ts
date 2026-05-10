import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentCommandIds, pushRecentCommand } from "./recent";

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	window.localStorage.clear();
});

describe("getRecentCommandIds", () => {
	it("returns empty array when nothing stored", () => {
		expect(getRecentCommandIds()).toEqual([]);
	});

	it("returns stored ids", () => {
		window.localStorage.setItem("cmdk:recent", JSON.stringify(["a", "b"]));
		expect(getRecentCommandIds()).toEqual(["a", "b"]);
	});

	it("filters non-string entries", () => {
		window.localStorage.setItem(
			"cmdk:recent",
			JSON.stringify(["a", 42, null, "b"]),
		);
		expect(getRecentCommandIds()).toEqual(["a", "b"]);
	});

	it("returns empty array if stored value is not an array", () => {
		window.localStorage.setItem("cmdk:recent", JSON.stringify({ foo: "bar" }));
		expect(getRecentCommandIds()).toEqual([]);
	});

	it("returns empty array if stored value is invalid JSON", () => {
		window.localStorage.setItem("cmdk:recent", "{not json}");
		expect(getRecentCommandIds()).toEqual([]);
	});
});

describe("pushRecentCommand", () => {
	it("stores the id as the head of the list", () => {
		pushRecentCommand("one");
		expect(getRecentCommandIds()).toEqual(["one"]);
	});

	it("moves an existing id to the front (no duplicates)", () => {
		pushRecentCommand("a");
		pushRecentCommand("b");
		pushRecentCommand("a");
		expect(getRecentCommandIds()).toEqual(["a", "b"]);
	});

	it("caps the list at 20 entries", () => {
		for (let i = 0; i < 25; i++) pushRecentCommand(`id-${i}`);
		const ids = getRecentCommandIds();
		expect(ids).toHaveLength(20);
		expect(ids[0]).toBe("id-24");
		expect(ids[19]).toBe("id-5");
	});
});
