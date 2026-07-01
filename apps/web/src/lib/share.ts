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

// The intent is time-boxed so an abandoned flow can't silently auto-fork on a
// much-later revisit of the same link.
const FORK_INTENT_TTL_MS = 30 * 60 * 1000;

/** Arm the fork-on-return intent for a token (timestamped). */
export function setForkIntent(token: string): void {
	try {
		sessionStorage.setItem(
			FORK_INTENT_KEY,
			JSON.stringify({ token, ts: Date.now() }),
		);
		sessionStorage.setItem(SHARE_RETURN_KEY, `/share/${token}`);
	} catch {}
}

/** Drop the intent entirely (abandoned or consumed). */
export function clearForkIntent(): void {
	try {
		sessionStorage.removeItem(FORK_INTENT_KEY);
		sessionStorage.removeItem(SHARE_RETURN_KEY);
	} catch {}
}

/** The intended token IF a fresh intent exists, else null. Pure read. */
export function peekForkIntent(): string | null {
	try {
		const raw = sessionStorage.getItem(FORK_INTENT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { token?: string; ts?: number };
		if (
			!parsed.token ||
			typeof parsed.ts !== "number" ||
			Date.now() - parsed.ts > FORK_INTENT_TTL_MS
		) {
			return null;
		}
		return parsed.token;
	} catch {
		return null;
	}
}

function randomToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Carry a "clone this shared harness" intent across the sign-in redirect, so a
// signed-out visitor who clicks Clone resumes automatically on return.
const HARNESS_CLONE_INTENT_KEY = "harnessCloneIntent";
const CLONE_INTENT_TTL_MS = 30 * 60 * 1000;

export function setHarnessCloneIntent(token: string): void {
	try {
		sessionStorage.setItem(
			HARNESS_CLONE_INTENT_KEY,
			JSON.stringify({ token, ts: Date.now() }),
		);
	} catch {}
}
export function clearHarnessCloneIntent(): void {
	try {
		sessionStorage.removeItem(HARNESS_CLONE_INTENT_KEY);
	} catch {}
}
export function peekHarnessCloneIntent(): string | null {
	try {
		const raw = sessionStorage.getItem(HARNESS_CLONE_INTENT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { token?: string; ts?: number };
		if (
			!parsed.token ||
			typeof parsed.ts !== "number" ||
			Date.now() - parsed.ts > CLONE_INTENT_TTL_MS
		) {
			return null;
		}
		return parsed.token;
	} catch {
		return null;
	}
}

/** Generate a high-entropy, URL-safe share token (prefix + 256 bits). */
export function generateShareToken(): string {
	return `shr_${randomToken()}`;
}

/** Generate a high-entropy harness-share token (distinct prefix). */
export function generateHarnessShareToken(): string {
	return `hsh_${randomToken()}`;
}

/** Absolute, copy-pasteable URL for a conversation share token. */
export function buildShareUrl(token: string): string {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return `${origin}/share/${token}`;
}

/** Absolute, copy-pasteable URL for a harness share token. */
export function buildHarnessShareUrl(token: string): string {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return `${origin}/share-harness/${token}`;
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
