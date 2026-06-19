/**
 * Client helpers for conversation sharing.
 *
 * The share-link secret is generated in the browser with the Web Crypto
 * CSPRNG (Convex handlers have no native CSPRNG) and passed into the
 * owner-gated `shares.ensurePublicLink` / `rotatePublicLink` mutations. 32
 * random bytes → ~43 base64url chars, comfortably above the backend's
 * MIN_TOKEN_LENGTH and unguessable.
 */

// sessionStorage keys that carry a "fork this shared chat" intent across the
// sign-up → onboarding → completion redirect chain (too many hops to thread
// through router search params). Set on the share page when an anonymous
// visitor clicks "Sign in to fork"; consumed at onboarding completion (to
// return to the share) and on the share page (to auto-resume the fork).
export const FORK_INTENT_KEY = "shareForkIntent";
export const SHARE_RETURN_KEY = "shareReturn";

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
