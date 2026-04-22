import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type {
	Doc,
	Id,
} from "@harness/convex-backend/convex/_generated/dataModel";
import type { QueryClient } from "@tanstack/react-query";

export type Sandbox = Doc<"sandboxes">;

export type SandboxConfig = {
	persistent: boolean;
	autoStart: boolean;
	defaultLanguage: string;
	resourceTier: "basic" | "standard" | "performance";
};

export type DefaultSandboxSelection = {
	sandboxId: Id<"sandboxes">;
	daytonaSandboxId: string;
	config: SandboxConfig;
};

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
	persistent: false,
	autoStart: true,
	defaultLanguage: "python",
	resourceTier: "basic",
};

export function getDefaultSandboxSelection(
	sandbox: Sandbox | undefined,
): DefaultSandboxSelection | undefined {
	if (!sandbox) return undefined;
	return {
		sandboxId: sandbox._id,
		daytonaSandboxId: sandbox.daytonaSandboxId,
		config: {
			persistent: !sandbox.ephemeral,
			autoStart: true,
			defaultLanguage: sandbox.language ?? "python",
			resourceTier: getResourceTierFromSandbox(sandbox),
		},
	};
}

export function getResourceTierFromSandbox(
	sandbox: Sandbox,
): SandboxConfig["resourceTier"] {
	if (sandbox.resources.cpu >= 4 || sandbox.resources.memoryGB >= 8) {
		return "performance";
	}
	if (sandbox.resources.cpu >= 2 || sandbox.resources.memoryGB >= 4) {
		return "standard";
	}
	return "basic";
}

export function formatSandboxMeta(sandbox: Sandbox) {
	const type = sandbox.ephemeral ? "Ephemeral" : "Persistent";
	const language = sandbox.language
		? sandbox.language.charAt(0).toUpperCase() + sandbox.language.slice(1)
		: "Default";
	return `${type} - ${language} - ${sandbox.resources.cpu} CPU - ${sandbox.resources.memoryGB} GB RAM`;
}

export async function waitForSandboxRecord(
	queryClient: QueryClient,
	daytonaSandboxId: string,
	attempts = 12,
) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const sandboxes = await queryClient.fetchQuery(
			convexQuery(api.sandboxes.list, {}),
		);
		const sandbox = sandboxes.find(
			(item) => item.daytonaSandboxId === daytonaSandboxId,
		);
		if (sandbox) return sandbox;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return null;
}
