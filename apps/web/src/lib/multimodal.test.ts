import { describe, expect, it, vi } from "vitest";
import { buildMultimodalContent } from "./multimodal";

function makeResolver(
	signed: Array<{ url: string; mime_type: string; file_name: string }>,
) {
	return vi.fn().mockResolvedValue(signed);
}

describe("buildMultimodalContent", () => {
	it("returns plain text when no attachments resolved", async () => {
		const out = await buildMultimodalContent("hello", [], makeResolver([]));
		expect(out).toBe("hello");
	});

	it("returns text-only parts when input text is empty but images exist", async () => {
		const out = await buildMultimodalContent(
			"",
			[{ storageId: "a", mimeType: "image/png", fileName: "a.png" }],
			makeResolver([
				{ url: "https://s/a", mime_type: "image/png", file_name: "a.png" },
			]),
		);
		expect(Array.isArray(out)).toBe(true);
		expect(out).toEqual([
			{ type: "image_url", image_url: { url: "https://s/a" } },
		]);
	});

	it("builds text + image parts", async () => {
		const out = await buildMultimodalContent(
			"caption",
			[{ storageId: "a", mimeType: "image/png", fileName: "a.png" }],
			makeResolver([
				{ url: "https://s/a", mime_type: "image/png", file_name: "a.png" },
			]),
		);
		expect(out).toEqual([
			{ type: "text", text: "caption" },
			{ type: "image_url", image_url: { url: "https://s/a" } },
		]);
	});

	it("builds pdf file part", async () => {
		const out = await buildMultimodalContent(
			"",
			[{ storageId: "p", mimeType: "application/pdf", fileName: "doc.pdf" }],
			makeResolver([
				{
					url: "https://s/p",
					mime_type: "application/pdf",
					file_name: "doc.pdf",
				},
			]),
		);
		expect(out).toEqual([
			{
				type: "file",
				file: { filename: "doc.pdf", file_data: "https://s/p" },
			},
		]);
	});

	it("encodes audio as base64", async () => {
		// Base64 of "hi" is "aGk="; data URL prefix is "data:audio/wav;base64,"
		const dataUrl = "data:audio/wav;base64,aGk=";
		const mockReader = {
			result: dataUrl,
			onloadend: null as (() => void) | null,
			onerror: null as (() => void) | null,
			readAsDataURL() {
				queueMicrotask(() => this.onloadend?.());
			},
		};
		// @ts-expect-error jsdom stub
		globalThis.FileReader = vi.fn(() => mockReader);
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("hi", { status: 200 }));

		const out = await buildMultimodalContent(
			"",
			[{ storageId: "a", mimeType: "audio/wav", fileName: "clip.wav" }],
			makeResolver([
				{ url: "https://s/a", mime_type: "audio/wav", file_name: "clip.wav" },
			]),
		);
		expect(out).toEqual([
			{
				type: "input_audio",
				input_audio: { data: "aGk=", format: "wav" },
			},
		]);
		fetchSpy.mockRestore();
	});

	it("raises a descriptive error when audio fetch fails", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("err", { status: 500 }));
		await expect(
			buildMultimodalContent(
				"",
				[{ storageId: "a", mimeType: "audio/wav", fileName: "boom.wav" }],
				makeResolver([
					{ url: "https://s/a", mime_type: "audio/wav", file_name: "boom.wav" },
				]),
			),
		).rejects.toThrow(/Failed to encode audio "boom\.wav"/);
		fetchSpy.mockRestore();
	});
});
