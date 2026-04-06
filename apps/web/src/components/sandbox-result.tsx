import { useAuth } from "@clerk/clerk-react";
import {
	AlertTriangle,
	Check,
	ChevronDown,
	Clock,
	Code,
	Copy,
	ExternalLink,
	File,
	Folder,
	GitBranch,
	Github,
	Terminal,
	X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { env } from "../env";
import { useSandboxPanel } from "../lib/sandbox-panel-context";
import { detectLanguage, useHighlighted } from "../lib/syntax-highlight";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";
const BACKEND_ORIGIN = new URL(API_URL).origin;

interface SandboxResultProps {
	result: string;
	toolName?: string;
	/** Tool call arguments — passed through so components can show source code, etc. */
	args?: Record<string, unknown>;
}

/**
 * Renders sandbox tool results as rich UI blocks in the chat.
 * Parses the JSON result from sandbox tools and renders appropriate
 * visualizations for code execution, commands, files, git, etc.
 */
export function SandboxResult({ result, args }: SandboxResultProps) {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(result);
	} catch {
		return <FallbackResult result={result} />;
	}

	const type = parsed.type as string;

	switch (type) {
		case "code_execution":
			return <CodeExecutionResult data={parsed} args={args} />;
		case "command_result":
			return <CommandResult data={parsed} />;
		case "file_content":
			return <FileContentResult data={parsed} />;
		case "image":
			return <ImageResult data={parsed} />;
		case "file_list":
			return <FileListResult data={parsed} />;
		case "git_status":
			return <GitStatusResult data={parsed} />;
		case "git_commit":
			return <GitCommitResult data={parsed} />;
		case "git_log":
			return <GitLogResult data={parsed} />;
		case "git_diff":
			return <GitDiffResult data={parsed} />;
		case "git_branches":
			return <GitBranchesResult data={parsed} />;
		case "search_results":
			return <SearchResult data={parsed} />;
		case "success":
			return <SuccessResult data={parsed} />;
		case "error":
			return <ErrorResult data={parsed} />;
		default:
			return <FallbackResult result={result} />;
	}
}

function CodeExecutionResult({
	data,
	args,
}: {
	data: Record<string, unknown>;
	args?: Record<string, unknown>;
}) {
	const [expanded, setExpanded] = useState(true);
	const [codeVisible, setCodeVisible] = useState(false);
	const exitCode = data.exit_code as number;
	const stdout = data.stdout as string;
	const stderr = data.stderr as string;
	const language = data.language as string;
	const executionTime = data.execution_time as number | undefined;
	const charts = data.charts as
		| Array<{ title?: string; png?: string }>
		| undefined;
	const success = exitCode === 0;
	const sourceCode = (args?.code as string) ?? "";
	const highlightedCode = useHighlighted(sourceCode, language);

	const handleCopy = () => {
		navigator.clipboard.writeText(stdout || stderr);
	};

	const handleCopyCode = () => {
		navigator.clipboard.writeText(sourceCode);
	};

	return (
		<div className="my-1 border border-border">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
			>
				<Code size={12} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 text-xs font-medium">Code Execution</span>
				<Badge
					variant="secondary"
					className="text-[10px] uppercase tracking-wider"
				>
					{language}
				</Badge>
				{executionTime != null && (
					<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
						<Clock size={8} />
						{executionTime}s
					</span>
				)}
				<span
					className={cn(
						"flex items-center gap-1 text-[10px]",
						success ? "text-emerald-500" : "text-red-500",
					)}
				>
					{success ? <Check size={10} /> : <X size={10} />}
					Exit {exitCode}
				</span>
				<ChevronDown
					size={10}
					className={cn(
						"text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>

			{expanded && (
				<div className="border-t border-border">
					{/* Source code (collapsible, like Cursor) */}
					{sourceCode && (
						<div className="border-b border-border">
							<button
								type="button"
								onClick={() => setCodeVisible(!codeVisible)}
								className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-muted/20"
							>
								<ChevronDown
									size={8}
									className={cn(
										"transition-transform",
										!codeVisible && "-rotate-90",
									)}
								/>
								<Code size={8} />
								<span>Source</span>
								<span className="ml-auto text-[9px] tabular-nums">
									{sourceCode.split("\n").length} lines
								</span>
							</button>
							{codeVisible && (
								<div className="relative">
									{highlightedCode ? (
										<pre className="hljs max-h-60 overflow-auto px-3 py-2 text-xs leading-relaxed">
											<code
												// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output for read-only code display
												dangerouslySetInnerHTML={{
													__html: highlightedCode,
												}}
											/>
										</pre>
									) : (
										<pre className="max-h-60 overflow-auto bg-muted/20 px-3 py-2 font-mono text-xs leading-relaxed">
											{sourceCode}
										</pre>
									)}
									<Button
										variant="ghost"
										size="icon-xs"
										className="absolute right-1 top-1 opacity-0 transition-opacity hover:opacity-100 [div:hover>&]:opacity-100"
										onClick={handleCopyCode}
									>
										<Copy size={10} />
									</Button>
								</div>
							)}
						</div>
					)}

					{/* stdout */}
					{stdout && (
						<div className="relative">
							<pre className="max-h-80 overflow-auto bg-muted/20 px-3 py-2 font-mono text-xs leading-relaxed">
								{stdout}
							</pre>
							<Button
								variant="ghost"
								size="icon-xs"
								className="absolute right-1 top-1 opacity-0 transition-opacity hover:opacity-100 [div:hover>&]:opacity-100"
								onClick={handleCopy}
							>
								<Copy size={10} />
							</Button>
						</div>
					)}

					{/* stderr */}
					{stderr && (
						<div className="border-t border-border">
							<div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-red-500">
								<AlertTriangle size={8} />
								stderr
							</div>
							<pre className="max-h-40 overflow-auto bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-600 dark:text-red-400">
								{stderr}
							</pre>
						</div>
					)}

					{/* Chart images from execution artifacts */}
					{charts && charts.length > 0 && (
						<div className="border-t border-border p-2 space-y-2">
							{charts.map((chart) => (
								<div
									key={
										chart.png
											? `chart-png-${chart.png.slice(0, 48)}`
											: (chart.title ?? "chart")
									}
								>
									{chart.title && (
										<p className="mb-1 px-1 text-[10px] font-medium text-muted-foreground">
											{chart.title}
										</p>
									)}
									{chart.png && (
										<img
											src={`data:image/png;base64,${chart.png}`}
											alt={chart.title || "Chart"}
											className="max-w-full rounded border border-border"
										/>
									)}
								</div>
							))}
						</div>
					)}

					{!stdout && !stderr && (!charts || charts.length === 0) && (
						<p className="px-3 py-2 text-xs italic text-muted-foreground">
							No output
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function CommandResult({ data }: { data: Record<string, unknown> }) {
	const [expanded, setExpanded] = useState(true);
	const exitCode = data.exit_code as number;
	const stdout = data.stdout as string;
	const stderr = data.stderr as string;
	const command = data.command as string;
	const success = exitCode === 0;

	return (
		<div className="my-1 border border-border">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
			>
				<Terminal size={12} className="shrink-0 text-muted-foreground" />
				<code className="flex-1 truncate text-xs font-mono">{command}</code>
				<span
					className={cn(
						"flex items-center gap-1 text-[10px]",
						success ? "text-emerald-500" : "text-red-500",
					)}
				>
					{success ? <Check size={10} /> : <X size={10} />}
					Exit {exitCode}
				</span>
				<ChevronDown
					size={10}
					className={cn(
						"text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>

			{expanded && (stdout || stderr) && (
				<div className="border-t border-border">
					{stdout && (
						<pre className="max-h-60 overflow-auto bg-muted/20 px-3 py-2 text-xs leading-relaxed">
							{stdout}
						</pre>
					)}
					{stderr && (
						<pre className="max-h-40 overflow-auto border-t border-border bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-600 dark:text-red-400">
							{stderr}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}

function FileContentResult({ data }: { data: Record<string, unknown> }) {
	const [expanded, setExpanded] = useState(true);
	const path = data.path as string;
	const content = data.content as string;
	const fileName = path.split("/").pop() ?? path;
	const language = detectLanguage(path);
	const highlighted = useHighlighted(content, language);

	const handleCopy = () => {
		navigator.clipboard.writeText(content);
	};

	return (
		<div className="my-1 border border-border">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
			>
				<File size={12} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 truncate text-xs font-medium">{fileName}</span>
				{language && (
					<Badge
						variant="secondary"
						className="text-[10px] uppercase tracking-wider"
					>
						{language}
					</Badge>
				)}
				<span className="text-[10px] text-muted-foreground">{path}</span>
				<ChevronDown
					size={10}
					className={cn(
						"text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>

			{expanded && (
				<div className="relative border-t border-border">
					{highlighted ? (
						<pre className="hljs max-h-80 overflow-auto px-3 py-2 text-xs leading-relaxed">
							<code
								// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output for read-only code display
								dangerouslySetInnerHTML={{ __html: highlighted }}
							/>
						</pre>
					) : (
						<pre className="max-h-80 overflow-auto bg-muted/20 px-3 py-2 text-xs leading-relaxed">
							{content}
						</pre>
					)}
					<Button
						variant="ghost"
						size="icon-xs"
						className="absolute right-1 top-1 opacity-0 transition-opacity hover:opacity-100 [div:hover>&]:opacity-100"
						onClick={handleCopy}
					>
						<Copy size={10} />
					</Button>
				</div>
			)}
		</div>
	);
}

function ImageResult({ data }: { data: Record<string, unknown> }) {
	const [expanded, setExpanded] = useState(true);
	const path = data.path as string;
	const mime = data.mime as string;
	const b64 = data.data as string;
	const fileName = path.split("/").pop() ?? path;

	return (
		<div className="my-1 border border-border">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
			>
				<File size={12} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 truncate text-xs font-medium">{fileName}</span>
				<Badge
					variant="secondary"
					className="text-[10px] uppercase tracking-wider"
				>
					image
				</Badge>
				<span className="text-[10px] text-muted-foreground">{path}</span>
				<ChevronDown
					size={10}
					className={cn(
						"text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>

			{expanded && (
				<div className="border-t border-border p-2">
					<img
						src={`data:${mime};base64,${b64}`}
						alt={fileName}
						className="max-w-full rounded border border-border"
					/>
				</div>
			)}
		</div>
	);
}

function FileListResult({ data }: { data: Record<string, unknown> }) {
	const panel = useSandboxPanel();
	const path = data.path as string;
	const files = data.files as Array<{
		name: string;
		path: string;
		is_dir: boolean;
		size: number | null;
	}>;

	return (
		<div className="my-1 border border-border">
			<div className="flex items-center gap-2 px-3 py-2">
				<Folder size={12} className="shrink-0 text-muted-foreground" />
				<span className="text-xs font-medium">{path}</span>
				<Badge variant="secondary" className="text-[10px]">
					{files.length} items
				</Badge>
			</div>
			<div className="border-t border-border">
				{files.map((file) => (
					<button
						key={file.path}
						type="button"
						className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-muted/30 cursor-pointer transition-colors"
						onClick={() => {
							if (file.is_dir) {
								panel?.navigateTo(file.path);
							} else {
								panel?.openFile(file.path);
							}
						}}
					>
						{file.is_dir ? (
							<Folder size={10} className="text-amber-500" />
						) : (
							<File size={10} className="text-muted-foreground" />
						)}
						<span className={file.is_dir ? "font-medium" : ""}>
							{file.name}
						</span>
						{file.size != null && !file.is_dir && (
							<span className="ml-auto text-[10px] text-muted-foreground">
								{formatBytes(file.size)}
							</span>
						)}
					</button>
				))}
			</div>
		</div>
	);
}

function GitStatusResult({ data }: { data: Record<string, unknown> }) {
	const branch = data.branch as string;
	const ahead = data.ahead as number;
	const behind = data.behind as number;
	const files = data.files as Array<{ path: string; status: string }>;

	return (
		<div className="my-1 border border-border">
			<div className="flex items-center gap-2 px-3 py-2">
				<GitBranch size={12} className="shrink-0 text-muted-foreground" />
				<span className="text-xs font-medium">{branch}</span>
				{ahead > 0 && (
					<Badge variant="secondary" className="text-[10px]">
						+{ahead} ahead
					</Badge>
				)}
				{behind > 0 && (
					<Badge variant="secondary" className="text-[10px]">
						-{behind} behind
					</Badge>
				)}
			</div>
			{files.length > 0 && (
				<div className="border-t border-border">
					{files.map((file) => (
						<div
							key={file.path}
							className="flex items-center gap-2 px-3 py-1 text-xs"
						>
							<span
								className={cn(
									"w-2 text-center text-[10px] font-bold",
									file.status === "modified" && "text-amber-500",
									file.status === "added" && "text-emerald-500",
									file.status === "deleted" && "text-red-500",
								)}
							>
								{file.status === "modified"
									? "M"
									: file.status === "added"
										? "A"
										: file.status === "deleted"
											? "D"
											: "?"}
							</span>
							<span>{file.path}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function GitCommitResult({ data }: { data: Record<string, unknown> }) {
	const sha = data.sha as string;
	const message = data.message as string;

	return (
		<div className="my-1 flex items-center gap-2 border border-border px-3 py-2">
			<Check size={12} className="shrink-0 text-emerald-500" />
			<span className="text-xs">Committed:</span>
			<code className="text-xs font-mono text-muted-foreground">
				{sha.slice(0, 7)}
			</code>
			<span className="truncate text-xs text-foreground">{message}</span>
		</div>
	);
}

function GitLogResult({ data }: { data: Record<string, unknown> }) {
	const commits = data.commits as Array<{
		sha: string;
		message: string;
		author: string;
		date: string;
	}>;

	return (
		<div className="my-1 border border-border">
			<div className="flex items-center gap-2 px-3 py-2">
				<GitBranch size={12} className="shrink-0 text-muted-foreground" />
				<span className="text-xs font-medium">Git Log</span>
				<Badge variant="secondary" className="text-[10px]">
					{commits.length} commits
				</Badge>
			</div>
			<div className="border-t border-border">
				{commits.map((commit) => (
					<div
						key={commit.sha}
						className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-muted/20"
					>
						<code className="shrink-0 font-mono text-[10px] text-muted-foreground">
							{commit.sha.slice(0, 7)}
						</code>
						<span className="flex-1 truncate">{commit.message}</span>
						<span className="shrink-0 text-[10px] text-muted-foreground">
							{commit.author}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function GitDiffResult({ data }: { data: Record<string, unknown> }) {
	const [expanded, setExpanded] = useState(true);
	const diff = data.diff as string;

	if (!diff.trim()) {
		return (
			<div className="my-1 flex items-center gap-2 border border-border px-3 py-2 text-xs text-muted-foreground">
				<Check size={10} />
				No changes
			</div>
		);
	}

	return (
		<div className="my-1 border border-border">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
			>
				<GitBranch size={12} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 text-xs font-medium">Diff</span>
				<ChevronDown
					size={10}
					className={cn(
						"text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>

			{expanded && (
				<div className="border-t border-border">
					<pre className="max-h-80 overflow-auto px-3 py-2 text-xs leading-relaxed">
						{diff.split("\n").map((line, i) => (
							<span
								key={`${i}:${line}`}
								className={cn(
									"block",
									line.startsWith("+") &&
										!line.startsWith("+++") &&
										"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
									line.startsWith("-") &&
										!line.startsWith("---") &&
										"bg-red-500/10 text-red-600 dark:text-red-400",
									line.startsWith("@@") && "text-blue-500",
								)}
							>
								{line}
							</span>
						))}
					</pre>
				</div>
			)}
		</div>
	);
}

function GitBranchesResult({ data }: { data: Record<string, unknown> }) {
	const branches = data.branches as string[];

	return (
		<div className="my-1 border border-border">
			<div className="flex items-center gap-2 px-3 py-2">
				<GitBranch size={12} className="shrink-0 text-muted-foreground" />
				<span className="text-xs font-medium">Branches</span>
				<Badge variant="secondary" className="text-[10px]">
					{branches.length}
				</Badge>
			</div>
			<div className="border-t border-border">
				{branches.map((branch) => (
					<div
						key={branch}
						className="flex items-center gap-2 px-3 py-1 text-xs"
					>
						<GitBranch size={8} className="text-muted-foreground" />
						{branch}
					</div>
				))}
			</div>
		</div>
	);
}

function SearchResult({ data }: { data: Record<string, unknown> }) {
	const matches = (data.matches as Array<Record<string, unknown>>) ?? [];
	const files = (data.files as string[]) ?? [];
	const items = matches.length > 0 ? matches : files;

	return (
		<div className="my-1 border border-border">
			<div className="flex items-center gap-2 px-3 py-2">
				<File size={12} className="shrink-0 text-muted-foreground" />
				<span className="text-xs font-medium">Search Results</span>
				<Badge variant="secondary" className="text-[10px]">
					{items.length} matches
				</Badge>
			</div>
			{items.length > 0 && (
				<div className="max-h-60 overflow-auto border-t border-border">
					{matches.length > 0
						? matches.map((m) => (
								<div
									key={`${String(m.file ?? "")}:${String(m.line ?? "")}:${String(m.content ?? "")}`}
									className="flex gap-2 px-3 py-1 text-xs hover:bg-muted/20"
								>
									<span className="shrink-0 text-muted-foreground">
										{String(m.file ?? "")}
									</span>
									{m.line != null && (
										<span className="text-muted-foreground">
											:{String(m.line)}
										</span>
									)}
									<span className="truncate">{String(m.content ?? "")}</span>
								</div>
							))
						: files.map((f) => (
								<div key={f} className="px-3 py-1 text-xs hover:bg-muted/20">
									{f}
								</div>
							))}
				</div>
			)}
		</div>
	);
}

function SuccessResult({ data }: { data: Record<string, unknown> }) {
	return (
		<div className="my-1 flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
			<Check size={12} className="shrink-0 text-emerald-500" />
			<span className="text-xs">{String(data.message ?? "Success")}</span>
		</div>
	);
}

function ErrorResult({ data }: { data: Record<string, unknown> }) {
	const errorCode = data.error_code as string | undefined;

	if (errorCode === "github_auth_required") {
		return <GitHubAuthRequiredError message={String(data.message ?? "")} />;
	}

	return (
		<div className="my-1 border border-red-500/20 bg-red-500/5 px-3 py-2">
			<div className="flex items-center gap-2">
				<AlertTriangle size={12} className="shrink-0 text-red-500" />
				<span className="text-xs text-red-600 dark:text-red-400">
					{String(data.message ?? "Error")}
				</span>
			</div>
		</div>
	);
}

function GitHubAuthRequiredError({ message }: { message: string }) {
	const { getToken } = useAuth();
	const [status, setStatus] = useState<"idle" | "connecting" | "connected">(
		"idle",
	);

	const handleConnect = useCallback(async () => {
		setStatus("connecting");

		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/mcp/oauth/github/start`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error("Failed to start GitHub OAuth");
			const data = await res.json();

			const popup = window.open(
				data.authorization_url,
				"github-oauth",
				"width=600,height=700",
			);

			const handler = (event: MessageEvent) => {
				if (event.origin !== BACKEND_ORIGIN) return;
				if (popup && event.source !== popup) return;
				if (event.data?.type === "mcp-oauth-callback") {
					window.removeEventListener("message", handler);
					setStatus(event.data.success ? "connected" : "idle");
				}
			};
			window.addEventListener("message", handler);

			const check = setInterval(() => {
				if (popup?.closed) {
					clearInterval(check);
					window.removeEventListener("message", handler);
					setStatus((s) => (s === "connecting" ? "idle" : s));
				}
			}, 500);
		} catch {
			setStatus("idle");
		}
	}, [getToken]);

	return (
		<div className="my-1 border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
			<div className="flex items-start gap-2">
				<Github size={14} className="mt-0.5 shrink-0 text-amber-600" />
				<div className="flex-1 space-y-1.5">
					<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
						GitHub Authentication Required
					</p>
					<p className="text-[11px] leading-relaxed text-amber-600/80 dark:text-amber-400/70">
						{message ||
							"Connect your GitHub account to push, pull, and clone repositories in the sandbox."}
					</p>
					{status === "connected" ? (
						<div className="flex items-center gap-1.5 text-[11px] text-emerald-600">
							<Check size={10} />
							<span>GitHub connected — retry your message to push.</span>
						</div>
					) : (
						<Button
							size="sm"
							variant="outline"
							className="mt-1 h-7 gap-1.5 border-amber-500/30 text-[11px] hover:bg-amber-500/10"
							onClick={handleConnect}
							disabled={status === "connecting"}
						>
							{status === "connecting" ? (
								<>
									<ExternalLink size={10} className="animate-pulse" />
									Connecting...
								</>
							) : (
								<>
									<Github size={10} />
									Connect GitHub
								</>
							)}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function FallbackResult({ result }: { result: string }) {
	const [expanded, setExpanded] = useState(false);
	const isLong = result.length > 200;

	return (
		<div className="my-1 border border-border">
			<pre
				className={cn(
					"overflow-auto px-3 py-2 text-xs leading-relaxed",
					!expanded && isLong && "max-h-20",
				)}
			>
				{result}
			</pre>
			{isLong && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="w-full border-t border-border px-3 py-1 text-center text-[10px] text-muted-foreground hover:bg-muted/30"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
