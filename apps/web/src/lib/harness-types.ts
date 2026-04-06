313; /**
 * Sandbox-related fields on the harness document.
 * These exist in the Convex schema but are missing from the stale generated types.
 * Remove this file once `npx convex dev` regenerates the types.
 */
export interface HarnessSandboxFields {
	sandboxEnabled?: boolean;
	daytonaSandboxId?: string;
	sandboxConfig?: {
		persistent: boolean;
		autoStart: boolean;
		defaultLanguage: string;
		resourceTier: "basic" | "standard" | "performance";
		snapshotId?: string;
		gitRepo?: string;
		networkRestricted?: boolean;
	};
}

/** Helper to extract sandbox config as the snake_case shape expected by the API. */
export function toSandboxApiConfig(h: HarnessSandboxFields) {
	return h.sandboxConfig
		? {
				persistent: h.sandboxConfig.persistent,
				auto_start: h.sandboxConfig.autoStart,
				default_language: h.sandboxConfig.defaultLanguage,
				resource_tier: h.sandboxConfig.resourceTier,
			}
		: undefined;
}
