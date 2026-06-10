import { mimeToAudioFormat } from "./models";

type ContentPart = Record<string, unknown>;
export type MessageContent = string | ContentPart[];

/** Read a Blob into a raw base64 string (no data-URL prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result as string;
			resolve(result.split(",")[1]);
		};
		reader.onerror = () => reject(new Error("Failed to read audio data"));
		reader.readAsDataURL(blob);
	});
}

type ResolveSignedUrls = (
	atts: Array<{ storageId: string; mimeType: string; fileName: string }>,
) => Promise<Array<{ url: string; mime_type: string; file_name: string }>>;

/**
 * Build an OpenRouter multimodal content array from text + attachment metadata.
 * Returns a plain string when there are no attachments.
 */
export async function buildMultimodalContent(
	text: string,
	atts: Array<{ storageId: string; mimeType: string; fileName: string }>,
	resolveSignedUrls: ResolveSignedUrls,
): Promise<MessageContent> {
	const signed = await resolveSignedUrls(atts);
	if (signed.length === 0) return text;

	const parts: ContentPart[] = [];
	if (text) parts.push({ type: "text", text });

	for (const a of signed) {
		if (a.mime_type.startsWith("image/")) {
			parts.push({ type: "image_url", image_url: { url: a.url } });
		} else if (a.mime_type === "application/pdf") {
			parts.push({
				type: "file",
				file: { filename: a.file_name, file_data: a.url },
			});
		} else if (a.mime_type.startsWith("audio/")) {
			try {
				const res = await fetch(a.url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const blob = await res.blob();
				const base64 = await blobToBase64(blob);
				parts.push({
					type: "input_audio",
					input_audio: {
						data: base64,
						format: mimeToAudioFormat(a.mime_type),
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : "unknown error";
				throw new Error(`Failed to encode audio "${a.file_name}": ${msg}`);
			}
		}
	}

	return parts;
}

/** ACP image content block (session/prompt). */
export interface AcpImageBlock {
	type: "image";
	data: string; // raw base64
	mimeType: string;
}

/**
 * Convert an OpenRouter-shaped multimodal content array into ACP image
 * blocks by fetching each image URL and base64-encoding it. Non-image
 * parts are ignored (ACP agents advertise image support only).
 */
export async function buildAcpImageBlocks(
	content: MessageContent,
): Promise<AcpImageBlock[]> {
	if (typeof content === "string") return [];
	const blocks: AcpImageBlock[] = [];
	for (const part of content) {
		if (part.type !== "image_url") continue;
		const url = (part.image_url as { url?: string } | undefined)?.url;
		if (!url) continue;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			blocks.push({
				type: "image",
				data: await blobToBase64(blob),
				mimeType: blob.type || "image/png",
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown error";
			throw new Error(`Failed to load attached image: ${msg}`);
		}
	}
	return blocks;
}
