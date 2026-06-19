/**
 * Client helpers for conversation sharing.
 *
 * The share-link secret is generated in the browser with the Web Crypto
 * CSPRNG (Convex handlers have no native CSPRNG) and passed into the
 * owner-gated `shares.ensurePublicLink` / `rotatePublicLink` mutations. 32
 * random bytes → ~43 base64url chars, comfortably above the backend's
 * MIN_TOKEN_LENGTH and unguessable.
 */

/** Generate a high-entropy, URL-safe share token (prefix + 256 bits). */
export function generateShareToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	const b64url = btoa(bin)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return `shr_${b64url}`;
}

/** Absolute, copy-pasteable URL for a share token. */
export function buildShareUrl(token: string): string {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return `${origin}/share/${token}`;
}

/** Copy text to the clipboard, returning whether it succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
