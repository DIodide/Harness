import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PendingAttachment } from "../hooks/use-file-attachments";
import { AttachmentChip } from "./attachment-chip";

function makeAttachment(
	partial: Partial<PendingAttachment> = {},
): PendingAttachment {
	return {
		localId: "id-1",
		previewUrl: null,
		mimeType: "image/png",
		status: "ready",
		fileName: "file.png",
		fileSize: 100,
		...partial,
	};
}

describe("AttachmentChip", () => {
	it("renders an image preview when previewUrl is set and mime is image/*", () => {
		const att = makeAttachment({
			mimeType: "image/png",
			previewUrl: "blob:abc",
			fileName: "pic.png",
		});
		render(<AttachmentChip attachment={att} onRemove={() => {}} />);
		const img = screen.getByAltText("pic.png") as HTMLImageElement;
		expect(img).toBeInTheDocument();
		expect(img.src).toContain("blob:abc");
	});

	it("renders a file-name label with icon for PDFs", () => {
		const att = makeAttachment({
			mimeType: "application/pdf",
			fileName: "notes.pdf",
		});
		render(<AttachmentChip attachment={att} onRemove={() => {}} />);
		expect(screen.getByText("notes.pdf")).toBeInTheDocument();
	});

	it("renders a file-name label with icon for audio", () => {
		const att = makeAttachment({
			mimeType: "audio/wav",
			fileName: "sound.wav",
		});
		render(<AttachmentChip attachment={att} onRemove={() => {}} />);
		expect(screen.getByText("sound.wav")).toBeInTheDocument();
	});

	it("shows an uploading overlay when status is uploading", () => {
		const att = makeAttachment({ status: "uploading" });
		const { container } = render(
			<AttachmentChip attachment={att} onRemove={() => {}} />,
		);
		// Overlay uses bg-background/70 — spinner is rendered inside it.
		expect(container.querySelector(".bg-background\\/70")).toBeTruthy();
	});

	it("shows an 'Error' label when status is error", () => {
		const att = makeAttachment({ status: "error" });
		render(<AttachmentChip attachment={att} onRemove={() => {}} />);
		expect(screen.getByText("Error")).toBeInTheDocument();
	});

	it("calls onRemove when the X button is clicked", () => {
		const onRemove = vi.fn();
		const att = makeAttachment({
			mimeType: "application/pdf",
			fileName: "a.pdf",
		});
		render(<AttachmentChip attachment={att} onRemove={onRemove} />);
		// The X button is the only <button> in the chip.
		fireEvent.click(screen.getByRole("button"));
		expect(onRemove).toHaveBeenCalledTimes(1);
	});
});
