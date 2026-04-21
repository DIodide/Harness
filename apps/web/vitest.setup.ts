import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

expect.extend(matchers);

afterEach(() => {
	cleanup();
});

if (typeof window !== "undefined") {
	// Bun's runtime injects a stubbed window.localStorage that shadows jsdom's.
	// Replace it with a working in-memory Storage so tests that touch persistence work.
	const makeStorage = (): Storage => {
		const store = new Map<string, string>();
		return {
			get length() {
				return store.size;
			},
			clear() {
				store.clear();
			},
			getItem(key: string) {
				return store.has(key) ? (store.get(key) as string) : null;
			},
			key(index: number) {
				return Array.from(store.keys())[index] ?? null;
			},
			removeItem(key: string) {
				store.delete(key);
			},
			setItem(key: string, value: string) {
				store.set(key, String(value));
			},
		};
	};
	Object.defineProperty(window, "localStorage", {
		value: makeStorage(),
		configurable: true,
		writable: true,
	});
	Object.defineProperty(window, "sessionStorage", {
		value: makeStorage(),
		configurable: true,
		writable: true,
	});

	if (!window.matchMedia) {
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		});
	}

	if (!window.ResizeObserver) {
		window.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}

	if (!window.IntersectionObserver) {
		window.IntersectionObserver = class IntersectionObserver {
			root = null;
			rootMargin = "";
			thresholds = [];
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		} as unknown as typeof IntersectionObserver;
	}
}
