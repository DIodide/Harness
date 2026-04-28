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
		expect(modelSupportsMedia("gpt-5.4")).toBe(true);
		expect(modelSupportsMedia("claude-opus-4.7")).toBe(true);
		expect(modelSupportsMedia("gemini-3.1-pro")).toBe(true);
	});

	it("false for unknown models", () => {
		expect(modelSupportsMedia("made-up-model-2")).toBe(false);
	});

	it("false for undefined / unknown models", () => {
		expect(modelSupportsMedia(undefined)).toBe(false);
		expect(modelSupportsMedia("made-up-model")).toBe(false);
	});
});

describe("modelSupportsAudio", () => {
	it("true for gemini audio-capable models", () => {
		expect(modelSupportsAudio("gemini-3.1-pro")).toBe(true);
		expect(modelSupportsAudio("gemini-3-flash")).toBe(true);
	});

	it("false for non-audio models", () => {
		expect(modelSupportsAudio("gpt-5.4")).toBe(false);
		expect(modelSupportsAudio("claude-sonnet-4.6")).toBe(false);
	});

	it("false for undefined", () => {
		expect(modelSupportsAudio(undefined)).toBe(false);
	});
});

describe("allowedMimeTypes", () => {
	it("returns empty set for text-only model", () => {
		expect(allowedMimeTypes("made-up-model").size).toBe(0);
	});

	it("returns images + pdf for gpt-5.4", () => {
		const mimes = allowedMimeTypes("gpt-5.4");
		expect(mimes.has("image/png")).toBe(true);
		expect(mimes.has("image/jpeg")).toBe(true);
		expect(mimes.has("application/pdf")).toBe(true);
		expect(mimes.has("audio/wav")).toBe(false);
	});

	it("returns image + pdf + audio for gemini-3.1-pro", () => {
		const mimes = allowedMimeTypes("gemini-3.1-pro");
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
		const accept = acceptString("gpt-5.4");
		expect(accept).toContain("image/png");
		expect(accept).toContain("application/pdf");
		expect(accept.split(",")).toHaveLength(5);
	});

	it("returns empty string when no modalities", () => {
		expect(acceptString("made-up-model")).toBe("");
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
