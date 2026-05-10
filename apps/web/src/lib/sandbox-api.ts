import { env } from "../env";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export interface SandboxFile {
	name: string;
	path: string;
	is_dir: boolean;
	size: number | null;
}

interface ListFilesResponse {
	path: string;
	files: SandboxFile[];
}

interface ReadFileResponse {
	path: string;
	content: string;
}

export interface SearchMatch {
	file: string;
	line: number | null;
	content: string;
}

interface SearchResponse {
	matches: SearchMatch[];
	pattern: string;
}

export interface CommandResponse {
	exit_code: number;
	stdout: string;
	stderr: string;
}

export interface GitFileStatus {
	path: string;
	status: string;
}

export interface GitStatusResponse {
	branch: string;
	ahead: number;
	behind: number;
	files: GitFileStatus[];
}

export interface GitCommit {
	sha: string;
	message: string;
	author: string;
	date: string;
}

export interface SandboxLifecycleResponse {
	success: boolean;
	status: string;
}

export interface CreateSandboxRequest {
	harnessId?: string;
	name: string;
	language: string;
	resourceTier: "basic" | "standard" | "performance";
	ephemeral: boolean;
	gitRepo?: string;
}

export interface CreateSandboxResponse {
	id: string;
	status: string;
	language: string;
	resource_tier: string;
	ephemeral: boolean;
}

async function sandboxFetch<T>(
	path: string,
	getToken: () => Promise<string | null>,
	options?: RequestInit,
): Promise<T> {
	const token = await getToken();
	const res = await fetch(`${API_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...options?.headers,
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Sandbox API error ${res.status}: ${text}`);
	}
	try {
		return await res.json();
	} catch {
		throw new Error(`Sandbox API error: invalid JSON response from ${path}`);
	}
}

export function createSandboxApi(getToken: () => Promise<string | null>) {
	return {
		createSandbox(request: CreateSandboxRequest) {
			return sandboxFetch<CreateSandboxResponse>("/api/sandbox", getToken, {
				method: "POST",
				body: JSON.stringify({
					harness_id: request.harnessId,
					name: request.name,
					language: request.language,
					resource_tier: request.resourceTier,
					ephemeral: request.ephemeral,
					git_repo: request.gitRepo,
				}),
			});
		},

		startSandbox(sandboxId: string) {
			return sandboxFetch<SandboxLifecycleResponse>(
				`/api/sandbox/${sandboxId}/start`,
				getToken,
				{ method: "POST" },
			);
		},

		stopSandbox(sandboxId: string) {
			return sandboxFetch<SandboxLifecycleResponse>(
				`/api/sandbox/${sandboxId}/stop`,
				getToken,
				{ method: "POST" },
			);
		},

		listFiles(sandboxId: string, path = "/home/daytona") {
			return sandboxFetch<ListFilesResponse>(
				`/api/sandbox/${sandboxId}/files?path=${encodeURIComponent(path)}`,
				getToken,
			);
		},

		readFile(sandboxId: string, path: string) {
			return sandboxFetch<ReadFileResponse>(
				`/api/sandbox/${sandboxId}/files/read?path=${encodeURIComponent(path)}`,
				getToken,
			);
		},

		writeFile(sandboxId: string, path: string, content: string) {
			return sandboxFetch<{ success: boolean }>(
				`/api/sandbox/${sandboxId}/files/write`,
				getToken,
				{
					method: "POST",
					body: JSON.stringify({ path, content }),
				},
			);
		},

		runCommand(
			sandboxId: string,
			command: string,
			workingDirectory?: string,
			timeout?: number,
		) {
			return sandboxFetch<CommandResponse>(
				`/api/sandbox/${sandboxId}/command`,
				getToken,
				{
					method: "POST",
					body: JSON.stringify({
						command,
						working_directory: workingDirectory,
						timeout: timeout ?? 60,
					}),
				},
			);
		},

		deleteFile(sandboxId: string, path: string, recursive = false) {
			return sandboxFetch<{ success: boolean }>(
				`/api/sandbox/${sandboxId}/files?path=${encodeURIComponent(path)}&recursive=${recursive}`,
				getToken,
				{ method: "DELETE" },
			);
		},

		moveFile(sandboxId: string, source: string, destination: string) {
			return sandboxFetch<{ success: boolean }>(
				`/api/sandbox/${sandboxId}/files/move`,
				getToken,
				{
					method: "POST",
					body: JSON.stringify({ source, destination }),
				},
			);
		},

		createDirectory(sandboxId: string, path: string) {
			return sandboxFetch<{ success: boolean }>(
				`/api/sandbox/${sandboxId}/files/mkdir`,
				getToken,
				{
					method: "POST",
					body: JSON.stringify({ path }),
				},
			);
		},

		searchFiles(sandboxId: string, pattern: string, path = "/home/daytona") {
			return sandboxFetch<SearchResponse>(
				`/api/sandbox/${sandboxId}/files/search?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}`,
				getToken,
			);
		},

		async downloadUrl(sandboxId: string, path: string): Promise<string> {
			const token = await getToken();
			const res = await fetch(
				`${API_URL}/api/sandbox/${sandboxId}/files/download?path=${encodeURIComponent(path)}`,
				{
					headers: token ? { Authorization: `Bearer ${token}` } : {},
				},
			);
			if (!res.ok) {
				throw new Error(`Download failed: ${res.status}`);
			}
			const blob = await res.blob();
			return URL.createObjectURL(blob);
		},

		// ── Git ──────────────────────────────────────────────

		gitStatus(sandboxId: string, path = "/home/daytona") {
			return sandboxFetch<GitStatusResponse>(
				`/api/sandbox/${sandboxId}/git/status?path=${encodeURIComponent(path)}`,
				getToken,
			);
		},

		gitAdd(sandboxId: string, path: string, files: string[]) {
			return sandboxFetch<{ success: boolean }>(
				`/api/sandbox/${sandboxId}/git/add`,
				getToken,
				{
					method: "POST",
					body: JSON.stringify({ path, files }),
				},
			);
		},

		gitCommit(sandboxId: string, path: string, message: string) {
			return sandboxFetch<{ success: boolean; sha: string }>(
				`/api/sandbox/${sandboxId}/git/commit`,
				getToken,
				{
					method: "POST",
					body: JSON.stringify({ path, message }),
				},
			);
		},

		gitDiff(sandboxId: string, path: string, staged = false) {
			return sandboxFetch<{ diff: string }>(
				`/api/sandbox/${sandboxId}/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`,
				getToken,
			);
		},

		gitLog(sandboxId: string, path: string, count = 20) {
			return sandboxFetch<{ commits: GitCommit[] }>(
				`/api/sandbox/${sandboxId}/git/log?path=${encodeURIComponent(path)}&count=${count}`,
				getToken,
			);
		},

		gitBranches(sandboxId: string, path: string) {
			return sandboxFetch<{ branches: string[] }>(
				`/api/sandbox/${sandboxId}/git/branches?path=${encodeURIComponent(path)}`,
				getToken,
			);
		},
	};
}
