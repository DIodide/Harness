import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";

const ACCEPTED_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

export interface PendingAttachment {
	localId: string;
	previewUrl: string | null; // object URL for images, null for PDFs
	mimeType: string;
	status: "uploading" | "ready" | "error";
	storageId?: string;
	fileName: string;
	fileSize: number;
}

export function useFileAttachments() {
	const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
	const convex = useConvex();
	const localIdCounter = useRef(0);

	const uploadOne = useCallback(
		async (file: File, localId: string) => {
			try {
				const uploadUrl = await convex.mutation(
					api.files.generateUploadUrl,
					{},
				);
				const res = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": file.type },
					body: file,
				});
				if (!res.ok) throw new Error("Upload failed");
				const { storageId } = await res.json();
				setAttachments((prev) =>
					prev.map((a) =>
						a.localId === localId ? { ...a, status: "ready", storageId } : a,
					),
				);
			} catch {
				setAttachments((prev) =>
					prev.map((a) =>
						a.localId === localId ? { ...a, status: "error" } : a,
					),
				);
				toast.error(`Failed to upload ${file.name}`);
			}
		},
		[convex],
	);

	const addFiles = useCallback(
		(files: File[]) => {
			for (const file of files) {
				if (!ACCEPTED_TYPES.has(file.type)) {
					toast.error(`${file.name}: only images (PNG, JPG, GIF, WebP) and PDFs are supported`);
					continue;
				}
				const maxBytes =
					file.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
				if (file.size > maxBytes) {
					const limit = file.type === "application/pdf" ? "20 MB" : "10 MB";
					toast.error(`${file.name}: exceeds ${limit} limit`);
					continue;
				}

				const localId = String(++localIdCounter.current);
				const previewUrl = file.type.startsWith("image/")
					? URL.createObjectURL(file)
					: null;

				setAttachments((prev) => [
					...prev,
					{
						localId,
						previewUrl,
						mimeType: file.type,
						status: "uploading",
						fileName: file.name,
						fileSize: file.size,
					},
				]);

				// Fire and forget — state updates happen inside uploadOne
				uploadOne(file, localId);
			}
		},
		[uploadOne],
	);

	const removeAttachment = useCallback((localId: string) => {
		setAttachments((prev) => {
			const target = prev.find((a) => a.localId === localId);
			if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
			return prev.filter((a) => a.localId !== localId);
		});
	}, []);

	const clearAttachments = useCallback(() => {
		setAttachments((prev) => {
			for (const a of prev) {
				if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
			}
			return [];
		});
	}, []);

	const hasUploading = attachments.some((a) => a.status === "uploading");

	const resolveSignedUrls = useCallback(
		async (
			readyAttachments: Array<{
				storageId: string;
				mimeType: string;
				fileName: string;
			}>,
		): Promise<Array<{ url: string; mime_type: string; file_name: string }>> => {
			const results = await Promise.all(
				readyAttachments.map(async (a) => {
					const url = await convex.query(api.files.getFileUrl, {
						storageId: a.storageId as Id<"_storage">,
					});
					return url ? { url, mime_type: a.mimeType, file_name: a.fileName } : null;
				}),
			);
			return results.filter((r): r is NonNullable<typeof r> => r !== null);
		},
		[convex],
	);

	return {
		attachments,
		addFiles,
		removeAttachment,
		clearAttachments,
		hasUploading,
		resolveSignedUrls,
	};
}
