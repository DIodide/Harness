// Recover from "Failed to fetch dynamically imported module" — a stale chunk
// hash that 404s after a redeploy (the user's tab loaded an older build, then
// a new deploy renamed the hashed chunk). The browser memoizes the rejected
// module URL, so TanStack Router's router.invalidate() can't recover it; only a
// hard reload — which re-fetches the SSR-rendered document and its fresh asset
// manifest — does. Guarded with a sessionStorage cooldown so a genuinely
// missing chunk can never trigger an infinite reload loop.

const RELOAD_GUARD_KEY = "harness:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_LOAD_RE =
	/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \d+ failed/i;

/** True for a dynamic-import / chunk-load failure (cross-browser wording). */
export function isChunkLoadError(error: unknown): boolean {
	if (error instanceof Error && error.name === "ChunkLoadError") return true;
	const msg =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	return CHUNK_LOAD_RE.test(msg);
}

/**
 * Hard-reload at most once per cooldown to pick up the current build. Returns
 * true if a reload was triggered. The cooldown (shared key, both entry points)
 * means a chunk that's genuinely gone surfaces the error UI instead of looping.
 */
export function reloadOnceForStaleChunk(): boolean {
	if (typeof window === "undefined") return false;
	try {
		const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
		if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
		sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
	} catch {
		// sessionStorage unavailable (private mode / blocked) — fail safe and do
		// NOT reload, since without the guard a reload could loop forever.
		return false;
	}
	window.location.reload();
	return true;
}

let registered = false;

/**
 * One-time listener for Vite's `vite:preloadError`, fired when a dynamic
 * import's preload fails. preventDefault stops Vite from rethrowing, and we
 * recover proactively — before the failure ever reaches the error boundary.
 */
export function registerStaleChunkRecovery(): void {
	if (typeof window === "undefined" || registered) return;
	registered = true;
	window.addEventListener("vite:preloadError", (event) => {
		event.preventDefault();
		reloadOnceForStaleChunk();
	});
}
