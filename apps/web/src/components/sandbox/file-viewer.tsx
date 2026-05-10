import { useAuth } from "@clerk/clerk-react";
import { Check, Copy, Download, Pencil, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSandboxApi } from "../../lib/sandbox-api";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { detectLanguage, useHighlighted } from "../../lib/syntax-highlight";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import { ScrollArea } from "../ui/scroll-area";

interface FileCache {
	content: string;
	loading: boolean;
	error: string | null;
}

export function FileViewer() {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const [cache, setCache] = useState<Map<string, FileCache>>(new Map());

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);
	const sandboxId = panel?.sandboxId;
	const activeFile = panel?.activeFile;

	const loadFile = useCallback(
		async (path: string) => {
			if (!sandboxId) return;
			setCache((prev) => {
				const next = new Map(prev);
				next.set(path, { content: "", loading: true, error: null });
				return next;
			});
			try {
				const res = await api.readFile(sandboxId, path);
				setCache((prev) => {
					const next = new Map(prev);
					next.set(path, { content: res.content, loading: false, error: null });
					return next;
				});
			} catch (err) {
				setCache((prev) => {
					const next = new Map(prev);
					next.set(path, {
						content: "",
						loading: false,
						error: String(err),
					});
					return next;
				});
			}
		},
		[sandboxId, api],
	);

	const updateCachedContent = useCallback((path: string, content: string) => {
		setCache((prev) => {
			const next = new Map(prev);
			const existing = next.get(path);
			if (existing) {
				next.set(path, { ...existing, content });
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (activeFile && !cache.has(activeFile)) {
			loadFile(activeFile);
		}
	}, [activeFile, cache, loadFile]);

	if (!activeFile) return null;

	const entry = cache.get(activeFile);

	if (!entry || entry.loading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<RoseCurveSpinner size={14} className="text-muted-foreground/40" />
			</div>
		);
	}

	if (entry.error) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<p className="font-mono text-[10.5px] text-red-400/80">{entry.error}</p>
			</div>
		);
	}

	return (
		<FileContent
			path={activeFile}
			content={entry.content}
			sandboxId={sandboxId ?? null}
			onContentSaved={updateCachedContent}
		/>
	);
}

function FileContent({
	path,
	content,
	sandboxId,
	onContentSaved,
}: {
	path: string;
	content: string;
	sandboxId: string | null;
	onContentSaved: (path: string, content: string) => void;
}) {
	const { getToken } = useAuth();
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [editContent, setEditContent] = useState(content);
	const [saving, setSaving] = useState(false);
	const [saveStatus, setSaveStatus] = useState<"saved" | "error" | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const language = detectLanguage(path);
	const highlighted = useHighlighted(content, language);
	const lines = editing ? editContent.split("\n") : content.split("\n");

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(editing ? editContent : content);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [content, editing, editContent]);

	const handleDownload = useCallback(() => {
		const fileName = path.split("/").pop() ?? "file";
		const blob = new Blob([content], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(url);
	}, [content, path]);

	const handleEdit = useCallback(() => {
		setEditContent(content);
		setEditing(true);
		setSaveStatus(null);
		setTimeout(() => textareaRef.current?.focus(), 50);
	}, [content]);

	const handleCancel = useCallback(() => {
		setEditing(false);
		setEditContent(content);
		setSaveStatus(null);
	}, [content]);

	const handleSave = useCallback(async () => {
		if (!sandboxId) return;
		setSaving(true);
		setSaveStatus(null);
		try {
			await api.writeFile(sandboxId, path, editContent);
			onContentSaved(path, editContent);
			setSaveStatus("saved");
			setEditing(false);
			setTimeout(() => setSaveStatus(null), 2000);
		} catch {
			setSaveStatus("error");
		} finally {
			setSaving(false);
		}
	}, [sandboxId, api, path, editContent, onContentSaved]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Cmd/Ctrl+S to save
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				handleSave();
			}
			// Escape to cancel
			if (e.key === "Escape") {
				handleCancel();
			}
			// Tab to indent
			if (e.key === "Tab") {
				e.preventDefault();
				const textarea = textareaRef.current;
				if (!textarea) return;
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				const val = textarea.value;
				setEditContent(`${val.substring(0, start)}\t${val.substring(end)}`);
				setTimeout(() => {
					textarea.selectionStart = textarea.selectionEnd = start + 1;
				}, 0);
			}
		},
		[handleSave, handleCancel],
	);

	const hasChanges = editing && editContent !== content;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* File info bar */}
			<div className="flex h-7 shrink-0 items-center justify-between border-b border-border px-2.5">
				<div className="flex min-w-0 flex-1 items-center gap-1.5">
					<span className="truncate font-mono text-[10.5px] text-muted-foreground/50">
						{path}
					</span>
					{language && (
						<span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/30">
							{language}
						</span>
					)}
					{saveStatus === "saved" && (
						<span className="shrink-0 font-mono text-[9px] text-emerald-500/70">
							saved
						</span>
					)}
					{saveStatus === "error" && (
						<span className="shrink-0 font-mono text-[9px] text-red-400/70">
							save failed
						</span>
					)}
				</div>
				<div className="flex shrink-0 items-center">
					{editing ? (
						<>
							<button
								type="button"
								onClick={handleCancel}
								title="Cancel (Esc)"
								className="flex h-6 w-6 items-center justify-center text-muted-foreground/35 transition-colors hover:text-muted-foreground"
							>
								<X size={11} />
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={saving || !hasChanges}
								title="Save (Cmd+S)"
								className="flex h-6 items-center gap-1 px-1.5 font-mono text-[10px] text-emerald-500/70 transition-colors hover:text-emerald-500 disabled:opacity-30"
							>
								{saving ? <RoseCurveSpinner size={11} /> : <Save size={11} />}
								Save
							</button>
						</>
					) : (
						<>
							{sandboxId && (
								<button
									type="button"
									onClick={handleEdit}
									title="Edit file"
									className="flex h-6 w-6 items-center justify-center text-muted-foreground/35 transition-colors hover:text-muted-foreground"
								>
									<Pencil size={11} />
								</button>
							)}
							<button
								type="button"
								onClick={handleCopy}
								title="Copy file"
								className="flex h-6 w-6 items-center justify-center text-muted-foreground/35 transition-colors hover:text-muted-foreground"
							>
								{copied ? (
									<Check size={11} className="text-emerald-500" />
								) : (
									<Copy size={11} />
								)}
							</button>
							{sandboxId && (
								<button
									type="button"
									onClick={handleDownload}
									title="Download"
									className="flex h-6 w-6 items-center justify-center text-muted-foreground/35 transition-colors hover:text-muted-foreground"
								>
									<Download size={11} />
								</button>
							)}
						</>
					)}
				</div>
			</div>

			{/* Code area */}
			<ScrollArea className="min-h-0 flex-1 overflow-hidden">
				<div className="flex min-h-full">
					{/* Line numbers */}
					<div
						className="sticky left-0 shrink-0 select-none border-r border-border/60 bg-muted/15 px-2 py-1.5 text-right font-mono text-[10.5px] leading-[1.65] text-muted-foreground/20"
						aria-hidden
					>
						{lines.map((line, i) => (
							<div key={`${i + 1}:${line}`}>{i + 1}</div>
						))}
					</div>

					{/* Content */}
					<div className="min-w-0 flex-1">
						{editing ? (
							<textarea
								ref={textareaRef}
								value={editContent}
								onChange={(e) => setEditContent(e.target.value)}
								onKeyDown={handleKeyDown}
								spellCheck={false}
								className="block h-full w-full resize-none bg-transparent py-1.5 pl-3 pr-3 font-mono text-[11.5px] leading-[1.65] text-foreground/80 outline-none"
								style={{ minHeight: `${lines.length * 1.65}em` }}
							/>
						) : highlighted ? (
							<pre className="hljs whitespace-pre-wrap break-words py-1.5 pl-3 pr-3 font-mono text-[11.5px] leading-[1.65]">
								<code
									// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output for read-only file display
									dangerouslySetInnerHTML={{ __html: highlighted }}
								/>
							</pre>
						) : (
							<pre className="whitespace-pre-wrap break-words py-1.5 pl-3 pr-3 font-mono text-[11.5px] leading-[1.65] text-foreground/80">
								{content}
							</pre>
						)}
					</div>
				</div>
			</ScrollArea>

			{/* Status bar */}
			<div className="flex shrink-0 items-center justify-between border-t border-border px-2.5 py-0.5">
				<span className="font-mono text-[9px] text-muted-foreground/25">
					{lines.length} lines{editing ? " (editing)" : ""}
				</span>
				<span className="font-mono text-[9px] text-muted-foreground/25">
					{formatBytes(new Blob([editing ? editContent : content]).size)}
				</span>
			</div>
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
