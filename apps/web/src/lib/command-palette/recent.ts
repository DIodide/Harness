const STORAGE_KEY = "cmdk:recent";
const MAX_RECENT = 20;

function safeStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function getRecentCommandIds(): string[] {
	const storage = safeStorage();
	if (!storage) return [];
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((x): x is string => typeof x === "string");
	} catch {
		return [];
	}
}

export function pushRecentCommand(id: string): void {
	const storage = safeStorage();
	if (!storage) return;
	const current = getRecentCommandIds().filter((x) => x !== id);
	const next = [id, ...current].slice(0, MAX_RECENT);
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Quota exceeded or storage disabled — silent failure is fine.
	}
}
