import { useAuth } from "@clerk/clerk-react";
import {
	Check,
	ChevronRight,
	GitBranch,
	GitCommitHorizontal,
	Minus,
	Plus,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	createSandboxApi,
	type GitCommit,
	type GitFileStatus,
} from "../../lib/sandbox-api";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { cn } from "../../lib/utils";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import { ScrollArea } from "../ui/scroll-area";

type Section = "changes" | "log";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
	modified: { label: "M", color: "text-amber-400" },
	added: { label: "A", color: "text-green-400" },
	deleted: { label: "D", color: "text-red-400" },
	renamed: { label: "R", color: "text-blue-400" },
	untracked: { label: "?", color: "text-muted-foreground/60" },
	copied: { label: "C", color: "text-cyan-400" },
};

function statusInfo(status: string) {
	const lower = status.toLowerCase();
	for (const [key, val] of Object.entries(STATUS_LABELS)) {
		if (lower.includes(key)) return val;
	}
	return { label: "?", color: "text-muted-foreground/50" };
}

export function GitPanel() {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const [section, setSection] = useState<Section>("changes");
	const [branch, setBranch] = useState<string | null>(null);
	const [ahead, setAhead] = useState(0);
	const [behind, setBehind] = useState(0);
	const [files, setFiles] = useState<GitFileStatus[]>([]);
	const [commits, setCommits] = useState<GitCommit[]>([]);
	const [loading, setLoading] = useState(false);
	const [committing, setCommitting] = useState(false);
	const [commitMsg, setCommitMsg] = useState("");
	const [diff, setDiff] = useState<string | null>(null);
	const [diffFile, setDiffFile] = useState<string | null>(null);
	const [staged, setStaged] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);
	const sandboxId = panel?.sandboxId;
	const repoPath = panel?.currentDir ?? "/home/daytona";

	const refresh = useCallback(async () => {
		if (!sandboxId) return;
		setLoading(true);
		setError(null);
		try {
			const statusRes = await api.gitStatus(sandboxId, repoPath);
			setBranch(statusRes.branch);
			setAhead(statusRes.ahead);
			setBehind(statusRes.behind);
			setFiles(statusRes.files);
			// Only fetch log if status succeeded (it's a git repo)
			try {
				const logRes = await api.gitLog(sandboxId, repoPath, 20);
				setCommits(logRes.commits);
			} catch {
				setCommits([]);
			}
		} catch (err) {
			const msg =
				err instanceof Error ? err.message : "Failed to load git status";
			// Detect non-git-repo errors
			if (
				msg.includes("not a git repository") ||
				msg.includes("Not a git repository") ||
				msg.includes("128") ||
				msg.includes("Failed to get status") ||
				msg.includes("400") ||
				msg.includes("500")
			) {
				setError("Not a git repository in this directory");
			} else {
				setError(msg);
			}
		} finally {
			setLoading(false);
		}
	}, [sandboxId, api, repoPath]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleStageAll = useCallback(() => {
		setStaged(new Set(files.map((f) => f.path)));
	}, [files]);

	const handleUnstageAll = useCallback(() => {
		setStaged(new Set());
	}, []);

	const toggleStage = useCallback((path: string) => {
		setStaged((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const handleCommit = useCallback(async () => {
		if (!sandboxId || !commitMsg.trim() || staged.size === 0) return;
		setCommitting(true);
		try {
			await api.gitAdd(sandboxId, repoPath, Array.from(staged));
			await api.gitCommit(sandboxId, repoPath, commitMsg.trim());
			setCommitMsg("");
			setStaged(new Set());
			await refresh();
		} catch (err) {
			console.error("Commit failed:", err);
		} finally {
			setCommitting(false);
		}
	}, [sandboxId, api, repoPath, commitMsg, staged, refresh]);

	const handleViewDiff = useCallback(
		async (filePath: string) => {
			if (!sandboxId) return;
			if (diffFile === filePath) {
				setDiff(null);
				setDiffFile(null);
				return;
			}
			try {
				const res = await api.gitDiff(sandboxId, repoPath);
				// Extract only the diff for the clicked file
				const filtered = extractFileDiff(res.diff, filePath);
				setDiff(filtered || "(no diff available)");
				setDiffFile(filePath);
			} catch {
				setDiff(null);
				setDiffFile(null);
			}
		},
		[sandboxId, api, repoPath, diffFile],
	);

	if (error) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
				<GitBranch
					size={18}
					strokeWidth={1}
					className="text-muted-foreground/30"
				/>
				<span className="text-center font-mono text-[11px] text-muted-foreground/50">
					{error}
				</span>
				<button
					type="button"
					onClick={refresh}
					className="mt-1 rounded px-2 py-0.5 font-mono text-[10px] text-muted-foreground/40 transition-colors hover:bg-foreground/5 hover:text-muted-foreground"
				>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Branch header */}
			<div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
				<GitBranch
					size={11}
					strokeWidth={1.5}
					className="shrink-0 text-muted-foreground/50"
				/>
				<span className="flex-1 truncate font-mono text-[10.5px] text-foreground/70">
					{loading && !branch ? "..." : (branch ?? "no branch")}
				</span>
				{(ahead > 0 || behind > 0) && (
					<span className="font-mono text-[9px] text-muted-foreground/40">
						{ahead > 0 && `↑${ahead}`}
						{behind > 0 && `↓${behind}`}
					</span>
				)}
				<button
					type="button"
					onClick={refresh}
					disabled={loading}
					title="Refresh"
					className="flex h-5 w-5 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground disabled:opacity-30"
				>
					{loading ? <RoseCurveSpinner size={10} /> : <RefreshCw size={10} />}
				</button>
			</div>

			{/* Section tabs */}
			<div className="flex shrink-0 border-b border-border">
				<button
					type="button"
					onClick={() => setSection("changes")}
					className={cn(
						"flex-1 py-1.5 font-mono text-[10px] transition-colors",
						section === "changes"
							? "border-b border-foreground text-foreground"
							: "text-muted-foreground/40 hover:text-muted-foreground/60",
					)}
				>
					Changes{files.length > 0 ? ` (${files.length})` : ""}
				</button>
				<button
					type="button"
					onClick={() => setSection("log")}
					className={cn(
						"flex-1 py-1.5 font-mono text-[10px] transition-colors",
						section === "log"
							? "border-b border-foreground text-foreground"
							: "text-muted-foreground/40 hover:text-muted-foreground/60",
					)}
				>
					History
				</button>
			</div>

			{loading && files.length === 0 && commits.length === 0 ? (
				<div className="flex flex-1 items-center justify-center">
					<RoseCurveSpinner size={14} className="text-muted-foreground/40" />
				</div>
			) : (
				<>
					{section === "changes" && (
						<div className="flex min-h-0 flex-1 flex-col">
							{/* Commit input */}
							<div className="shrink-0 border-b border-border p-2">
								<textarea
									value={commitMsg}
									onChange={(e) => setCommitMsg(e.target.value)}
									placeholder="Commit message..."
									rows={2}
									className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/25 focus:border-foreground/20"
								/>
								<div className="mt-1.5 flex items-center gap-1.5">
									<button
										type="button"
										onClick={handleCommit}
										disabled={
											committing || !commitMsg.trim() || staged.size === 0
										}
										className="flex items-center gap-1 rounded bg-foreground/10 px-2 py-1 font-mono text-[10px] text-foreground/80 transition-colors hover:bg-foreground/15 disabled:opacity-30"
									>
										{committing ? (
											<RoseCurveSpinner size={9} />
										) : (
											<Check size={9} />
										)}
										Commit ({staged.size})
									</button>
									<button
										type="button"
										onClick={handleStageAll}
										title="Stage all"
										className="rounded px-1.5 py-1 font-mono text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/5 hover:text-muted-foreground/70"
									>
										<Plus size={9} />
									</button>
									<button
										type="button"
										onClick={handleUnstageAll}
										title="Unstage all"
										className="rounded px-1.5 py-1 font-mono text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/5 hover:text-muted-foreground/70"
									>
										<Minus size={9} />
									</button>
								</div>
							</div>

							{/* File list */}
							<ScrollArea className="min-h-0 flex-1">
								<div className="py-0.5">
									{files.length === 0 ? (
										<p className="px-3 py-8 text-center font-mono text-[10px] text-muted-foreground/30">
											No changes
										</p>
									) : (
										files.map((f) => {
											const info = statusInfo(f.status);
											const isStaged = staged.has(f.path);
											const showDiff = diffFile === f.path && diff;
											const shortPath = f.path.replace(
												/^\/home\/daytona\//,
												"",
											);
											return (
												<div key={f.path}>
													<div
														className={cn(
															"group flex w-full items-center gap-1.5 px-2.5 py-[3px] text-left transition-colors",
															isStaged
																? "bg-foreground/[0.04]"
																: "hover:bg-foreground/[0.02]",
														)}
													>
														<button
															type="button"
															onClick={() => toggleStage(f.path)}
															className={cn(
																"flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
																isStaged
																	? "border-foreground/20 bg-foreground/10 text-foreground"
																	: "border-border text-transparent hover:border-foreground/20",
															)}
														>
															<Check size={8} />
														</button>
														<button
															type="button"
															onClick={() => handleViewDiff(f.path)}
															className="flex min-w-0 flex-1 items-center gap-1.5"
														>
															<span
																className={cn(
																	"shrink-0 font-mono text-[10px] font-medium",
																	info.color,
																)}
															>
																{info.label}
															</span>
															<span className="truncate font-mono text-[10.5px] text-foreground/65">
																{shortPath}
															</span>
															<ChevronRight
																size={9}
																className={cn(
																	"ml-auto shrink-0 text-muted-foreground/30 transition-transform",
																	showDiff && "rotate-90",
																)}
															/>
														</button>
													</div>
													{showDiff && (
														<div className="border-b border-border/50 bg-muted/20">
															<pre className="overflow-x-auto p-2 font-mono text-[10px] leading-relaxed">
																{diff.split("\n").map((line, i) => {
																	let cls = "text-muted-foreground/60";
																	if (
																		line.startsWith("+") &&
																		!line.startsWith("+++")
																	)
																		cls = "text-green-400/80";
																	else if (
																		line.startsWith("-") &&
																		!line.startsWith("---")
																	)
																		cls = "text-red-400/80";
																	else if (line.startsWith("@@"))
																		cls = "text-blue-400/60";
																	return (
																		<div key={`${f.path}-${i}`} className={cls}>
																			{line}
																		</div>
																	);
																})}
															</pre>
														</div>
													)}
												</div>
											);
										})
									)}
								</div>
							</ScrollArea>
						</div>
					)}

					{section === "log" && (
						<ScrollArea className="min-h-0 flex-1">
							<div className="py-0.5">
								{commits.length === 0 ? (
									<p className="px-3 py-8 text-center font-mono text-[10px] text-muted-foreground/30">
										No commits
									</p>
								) : (
									commits.map((c) => (
										<div
											key={c.sha}
											className="flex items-start gap-2 px-2.5 py-2 transition-colors hover:bg-foreground/[0.02]"
										>
											<GitCommitHorizontal
												size={12}
												strokeWidth={1.5}
												className="mt-0.5 shrink-0 text-muted-foreground/30"
											/>
											<div className="min-w-0 flex-1">
												<p className="truncate font-mono text-[10.5px] text-foreground/70">
													{c.message}
												</p>
												<div className="mt-0.5 flex items-center gap-2">
													<span className="font-mono text-[9px] text-muted-foreground/35">
														{c.sha.slice(0, 7)}
													</span>
													<span className="font-mono text-[9px] text-muted-foreground/30">
														{c.author}
													</span>
													{c.date && (
														<span className="font-mono text-[9px] text-muted-foreground/25">
															{formatRelativeDate(c.date)}
														</span>
													)}
												</div>
											</div>
										</div>
									))
								)}
							</div>
						</ScrollArea>
					)}
				</>
			)}
		</div>
	);
}

function extractFileDiff(fullDiff: string, filePath: string): string | null {
	// Git diff sections start with "diff --git a/... b/..."
	const sections = fullDiff.split(/^(?=diff --git )/m);
	const fileName = filePath.replace(/^\/home\/daytona\//, "");
	for (const section of sections) {
		if (
			section.includes(`a/${fileName}`) ||
			section.includes(`b/${fileName}`)
		) {
			return section.trim();
		}
	}
	return null;
}

function formatRelativeDate(dateStr: string): string {
	try {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const mins = Math.floor(diffMs / 60000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		return date.toLocaleDateString();
	} catch {
		return dateStr;
	}
}
