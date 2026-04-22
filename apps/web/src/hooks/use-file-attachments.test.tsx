import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mutationMock, queryMock, toastMock } = vi.hoisted(() => ({
	mutationMock: vi.fn(),
	queryMock: vi.fn(),
	toastMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useConvex: () => ({
		mutation: mutationMock,
		query: queryMock,
	}),
}));

vi.mock("react-hot-toast", () => ({
	default: { error: toastMock, success: toastMock },
}));

vi.mock("@harness/convex-backend/convex/_generated/api", () => ({
	api: {
		files: {
			generateUploadUrl: "files:generateUploadUrl",
			getFileUrl: "files:getFileUrl",
		},
	},
}));

import { useFileAttachments } from "./use-file-attachments";

function makeFile(name: string, type: string, size: number) {
	const blob = new Blob([new Uint8Array(size)], { type });
	return new File([blob], name, { type });
}

beforeEach(() => {
	mutationMock.mockReset();
	queryMock.mockReset();
	toastMock.mockReset();
	// URL.createObjectURL / revokeObjectURL in jsdom
	if (!URL.createObjectURL) {
		URL.createObjectURL = vi.fn(() => "blob:test");
	}
	if (!URL.revokeObjectURL) {
		URL.revokeObjectURL = vi.fn();
	}
});

describe("useFileAttachments", () => {
	const imageMime = "image/png";
	const pdfMime = "application/pdf";
	const audioMime = "audio/wav";
	const allowed = new Set([imageMime, pdfMime, audioMime]);

	it("starts empty", () => {
		const { result } = renderHook(() => useFileAttachments(allowed));
		expect(result.current.attachments).toEqual([]);
		expect(result.current.hasUploading).toBe(false);
	});

	it("rejects files with disallowed mime types", () => {
		const { result } = renderHook(() =>
			useFileAttachments(new Set([imageMime])),
		);
		act(() => {
			result.current.addFiles([makeFile("a.pdf", pdfMime, 100)]);
		});
		expect(result.current.attachments).toEqual([]);
		expect(toastMock).toHaveBeenCalledWith(
			"a.pdf: not supported by this model",
		);
	});

	it("rejects oversized images (>10 MB)", () => {
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([
				makeFile("big.png", imageMime, 11 * 1024 * 1024),
			]);
		});
		expect(result.current.attachments).toEqual([]);
		expect(toastMock).toHaveBeenCalledWith(
			expect.stringContaining("exceeds 10 MB limit"),
		);
	});

	it("rejects oversized PDFs (>20 MB)", () => {
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([makeFile("big.pdf", pdfMime, 21 * 1024 * 1024)]);
		});
		expect(toastMock).toHaveBeenCalledWith(
			expect.stringContaining("exceeds 20 MB limit"),
		);
	});

	it("rejects oversized audio (>25 MB)", () => {
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([
				makeFile("big.wav", audioMime, 26 * 1024 * 1024),
			]);
		});
		expect(toastMock).toHaveBeenCalledWith(
			expect.stringContaining("exceeds 25 MB limit"),
		);
	});

	it("caps at 5 attachments", () => {
		mutationMock.mockResolvedValue("https://upload/url");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ storageId: "sid" }), { status: 200 }),
		);
		const { result } = renderHook(() => useFileAttachments(allowed));
		const files = Array.from({ length: 6 }, (_, i) =>
			makeFile(`f${i}.png`, imageMime, 100),
		);
		act(() => {
			result.current.addFiles(files);
		});
		expect(result.current.attachments).toHaveLength(5);
		expect(toastMock).toHaveBeenCalledWith("Maximum 5 attachments per message");
	});

	it("creates a preview URL for images, null for non-images", () => {
		mutationMock.mockResolvedValue("https://upload/url");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ storageId: "sid" }), { status: 200 }),
		);
		const createSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:x");
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([
				makeFile("a.png", imageMime, 10),
				makeFile("b.pdf", pdfMime, 10),
			]);
		});
		const att = result.current.attachments;
		expect(att).toHaveLength(2);
		expect(att[0].previewUrl).toBe("blob:x");
		expect(att[1].previewUrl).toBeNull();
		expect(createSpy).toHaveBeenCalledTimes(1);
	});

	it("transitions attachment to ready after successful upload", async () => {
		mutationMock.mockResolvedValue("https://upload/url");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ storageId: "stored-id" }), { status: 200 }),
		);
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([makeFile("a.png", imageMime, 10)]);
		});
		await waitFor(() => {
			expect(result.current.attachments[0].status).toBe("ready");
		});
		expect(result.current.attachments[0].storageId).toBe("stored-id");
		expect(result.current.hasUploading).toBe(false);
	});

	it("marks attachment as error when upload POST fails", async () => {
		mutationMock.mockResolvedValue("https://upload/url");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("boom", { status: 500 }),
		);
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([makeFile("a.png", imageMime, 10)]);
		});
		await waitFor(() => {
			expect(result.current.attachments[0].status).toBe("error");
		});
		expect(toastMock).toHaveBeenCalledWith("Failed to upload a.png");
	});

	it("marks attachment as error when generateUploadUrl throws", async () => {
		mutationMock.mockRejectedValue(new Error("auth"));
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([makeFile("a.png", imageMime, 10)]);
		});
		await waitFor(() => {
			expect(result.current.attachments[0].status).toBe("error");
		});
	});

	it("removeAttachment drops by localId and revokes preview URL", async () => {
		mutationMock.mockResolvedValue("https://upload");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ storageId: "s" }), { status: 200 }),
		);
		const revoke = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => {});
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([makeFile("a.png", imageMime, 10)]);
		});
		const id = result.current.attachments[0].localId;
		act(() => {
			result.current.removeAttachment(id);
		});
		expect(result.current.attachments).toEqual([]);
		expect(revoke).toHaveBeenCalled();
	});

	it("clearAttachments drops all and revokes previews", async () => {
		mutationMock.mockResolvedValue("https://upload");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ storageId: "s" }), { status: 200 }),
		);
		const revoke = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => {});
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([
				makeFile("a.png", imageMime, 10),
				makeFile("b.png", imageMime, 10),
			]);
		});
		act(() => {
			result.current.clearAttachments();
		});
		expect(result.current.attachments).toEqual([]);
		expect(revoke).toHaveBeenCalledTimes(2);
	});

	it("hasUploading is true right after addFiles", () => {
		mutationMock.mockReturnValue(new Promise(() => {})); // hang forever
		vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
		const { result } = renderHook(() => useFileAttachments(allowed));
		act(() => {
			result.current.addFiles([makeFile("a.png", imageMime, 10)]);
		});
		expect(result.current.hasUploading).toBe(true);
	});

	it("resolveSignedUrls returns resolved URLs and filters null", async () => {
		queryMock.mockImplementation(async (_name, args: { storageId: string }) => {
			if (args.storageId === "good") return "https://signed/good";
			return null;
		});
		const { result } = renderHook(() => useFileAttachments(allowed));
		const urls = await result.current.resolveSignedUrls([
			{ storageId: "good", mimeType: "image/png", fileName: "a.png" },
			{ storageId: "bad", mimeType: "image/png", fileName: "b.png" },
		]);
		expect(urls).toEqual([
			{
				url: "https://signed/good",
				mime_type: "image/png",
				file_name: "a.png",
			},
		]);
	});
});
