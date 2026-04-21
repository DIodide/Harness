import { describe, expect, it } from "vitest";
import {
	acceptString,
	allowedMimeTypes,
	MODELS,
	mimeToAudioFormat,
	modelSupportsAudio,
	modelSupportsMedia,
} from "./models";

describe("MODELS catalog", () => {
	it("has unique values", () => {
		const values = MODELS.map((m) => m.value);
		expect(new Set(values).size).toBe(values.length);
	});

	it("every model has label and modalities array", () => {
		for (const m of MODELS) {
			expect(m.value).toBeTruthy();
			expect(m.label).toBeTruthy();
			expect(Array.isArray(m.modalities)).toBe(true);
		}
	});
});

describe("modelSupportsMedia", () => {
	it("true for image-capable models", () => {
		expect(modelSupportsMedia("gpt-4o")).toBe(true);
		expect(modelSupportsMedia("claude-opus-4")).toBe(true);
		expect(modelSupportsMedia("gemini-2.5-pro")).toBe(true);
	});

	it("false for text-only models", () => {
		expect(modelSupportsMedia("deepseek-r1")).toBe(false);
		expect(modelSupportsMedia("deepseek-v3")).toBe(false);
		expect(modelSupportsMedia("grok-3-mini")).toBe(false);
	});

	it("false for undefined / unknown models", () => {
		expect(modelSupportsMedia(undefined)).toBe(false);
		expect(modelSupportsMedia("made-up-model")).toBe(false);
	});
});

describe("modelSupportsAudio", () => {
	it("true for gemini audio-capable models", () => {
		expect(modelSupportsAudio("gemini-2.5-pro")).toBe(true);
		expect(modelSupportsAudio("gemini-2.5-flash")).toBe(true);
	});

	it("false for non-audio models", () => {
		expect(modelSupportsAudio("gpt-4o")).toBe(false);
		expect(modelSupportsAudio("claude-sonnet-4")).toBe(false);
	});

	it("false for undefined", () => {
		expect(modelSupportsAudio(undefined)).toBe(false);
	});
});

describe("allowedMimeTypes", () => {
	it("returns empty set for text-only model", () => {
		expect(allowedMimeTypes("deepseek-r1").size).toBe(0);
	});

	it("returns images + pdf for gpt-4o", () => {
		const mimes = allowedMimeTypes("gpt-4o");
		expect(mimes.has("image/png")).toBe(true);
		expect(mimes.has("image/jpeg")).toBe(true);
		expect(mimes.has("application/pdf")).toBe(true);
		expect(mimes.has("audio/wav")).toBe(false);
	});

	it("returns image + pdf + audio for gemini-2.5-pro", () => {
		const mimes = allowedMimeTypes("gemini-2.5-pro");
		expect(mimes.has("image/png")).toBe(true);
		expect(mimes.has("application/pdf")).toBe(true);
		expect(mimes.has("audio/wav")).toBe(true);
		expect(mimes.has("audio/mpeg")).toBe(true);
	});

	it("returns empty set for undefined model", () => {
		expect(allowedMimeTypes(undefined).size).toBe(0);
	});
});

describe("acceptString", () => {
	it("returns comma-separated mime list", () => {
		const accept = acceptString("gpt-4o");
		expect(accept).toContain("image/png");
		expect(accept).toContain("application/pdf");
		expect(accept.split(",")).toHaveLength(5);
	});

	it("returns empty string when no modalities", () => {
		expect(acceptString("deepseek-r1")).toBe("");
	});
});

describe("mimeToAudioFormat", () => {
	it("maps known audio mimes", () => {
		expect(mimeToAudioFormat("audio/wav")).toBe("wav");
		expect(mimeToAudioFormat("audio/mpeg")).toBe("mp3");
		expect(mimeToAudioFormat("audio/mp3")).toBe("mp3");
		expect(mimeToAudioFormat("audio/x-m4a")).toBe("m4a");
		expect(mimeToAudioFormat("audio/webm")).toBe("webm");
	});

	it("falls back to wav for unknown mimes", () => {
		expect(mimeToAudioFormat("audio/something-else")).toBe("wav");
		expect(mimeToAudioFormat("")).toBe("wav");
	});
});
