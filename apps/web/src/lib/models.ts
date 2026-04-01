// Per-model modality support on OpenRouter
// "image" = image inputs, "pdf" = PDF inputs, "audio" = audio inputs
type Modality = "image" | "pdf" | "audio";

export const MODELS: Array<{
	value: string;
	label: string;
	modalities: Modality[];
}> = [
	// Audio input: only Gemini models are confirmed on OpenRouter
	{ value: "openai/gpt-5.4", label: "GPT-5.4", modalities: ["image", "pdf"] },
	{ value: "gpt-4o", label: "GPT-4o", modalities: ["image", "pdf"] },
	{ value: "gpt-4.1", label: "GPT-4.1", modalities: ["image", "pdf"] },
	{
		value: "gpt-4.1-mini",
		label: "GPT-4.1 Mini",
		modalities: ["image", "pdf"],
	},
	{
		value: "claude-sonnet-4",
		label: "Claude Sonnet 4",
		modalities: ["image", "pdf"],
	},
	{
		value: "claude-sonnet-4-thinking",
		label: "Claude Sonnet 4 (Thinking)",
		modalities: ["image", "pdf"],
	},
	{
		value: "claude-opus-4",
		label: "Claude Opus 4",
		modalities: ["image", "pdf"],
	},
	{
		value: "claude-opus-4-thinking",
		label: "Claude Opus 4 (Thinking)",
		modalities: ["image", "pdf"],
	},
	{
		value: "google/gemini-3.1-flash-lite-preview",
		label: "Gemini 3.1 Flash Lite Preview",
		modalities: ["image", "pdf", "audio"],
	},
	{
		value: "gemini-2.5-pro",
		label: "Gemini 2.5 Pro",
		modalities: ["image", "pdf", "audio"],
	},
	{
		value: "gemini-2.5-flash",
		label: "Gemini 2.5 Flash",
		modalities: ["image", "pdf", "audio"],
	},
	{ value: "kimi-k2", label: "Kimi K2", modalities: ["image"] },
	{ value: "deepseek-r1", label: "DeepSeek R1", modalities: [] },
	{ value: "deepseek-v3", label: "DeepSeek V3", modalities: [] },
	{ value: "grok-3", label: "Grok 3", modalities: ["image"] },
	{ value: "grok-3-mini", label: "Grok 3 Mini", modalities: [] },
];

// Lookup index built once from the MODELS array
const modalityIndex = new Map(
	MODELS.map((m) => [m.value, new Set(m.modalities)]),
);

function modelHas(model: string | undefined, modality: Modality): boolean {
	if (!model) return false;
	return modalityIndex.get(model)?.has(modality) ?? false;
}

export function modelSupportsMedia(model: string | undefined): boolean {
	return modelHas(model, "image");
}

export function modelSupportsAudio(model: string | undefined): boolean {
	return modelHas(model, "audio");
}

// ── MIME mappings ────────────────────────────────────────────────────

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const PDF_MIMES = ["application/pdf"];
const AUDIO_MIMES = [
	"audio/wav",
	"audio/mpeg",
	"audio/mp3",
	"audio/aiff",
	"audio/aac",
	"audio/ogg",
	"audio/flac",
	"audio/mp4",
	"audio/x-m4a",
	"audio/webm",
];

/** Returns the set of MIME types the model can accept, or empty set if none. */
export function allowedMimeTypes(model: string | undefined): Set<string> {
	const mimes: string[] = [];
	if (modelHas(model, "image")) mimes.push(...IMAGE_MIMES);
	if (modelHas(model, "pdf")) mimes.push(...PDF_MIMES);
	if (modelHas(model, "audio")) mimes.push(...AUDIO_MIMES);
	return new Set(mimes);
}

/** Returns an `accept` string for <input type="file"> based on model capabilities. */
export function acceptString(model: string | undefined): string {
	return [...allowedMimeTypes(model)].join(",");
}

/** Map MIME type to OpenRouter audio format identifier */
const AUDIO_FORMAT_MAP: Record<string, string> = {
	"audio/wav": "wav",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/aiff": "aiff",
	"audio/aac": "aac",
	"audio/ogg": "ogg",
	"audio/flac": "flac",
	"audio/mp4": "m4a",
	"audio/x-m4a": "m4a",
	"audio/webm": "webm",
};

export function mimeToAudioFormat(mime: string): string {
	return AUDIO_FORMAT_MAP[mime] ?? "wav";
}
