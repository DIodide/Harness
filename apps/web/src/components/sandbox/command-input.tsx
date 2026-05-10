import { useAuth } from "@clerk/clerk-react";
import { AlertCircle, ChevronRight, TerminalSquare } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { type CommandResponse, createSandboxApi } from "../../lib/sandbox-api";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { cn } from "../../lib/utils";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import { ScrollArea } from "../ui/scroll-area";

interface CommandEntry {
	id: number;
	command: string;
	cwd: string;
	result: CommandResponse | null;
	error: string | null;
	running: boolean;
}

export function CommandRunner() {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const [entries, setEntries] = useState<CommandEntry[]>([]);
	const [input, setInput] = useState("");
	const [cwd, setCwd] = useState("/home/daytona");
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [tabHint, setTabHint] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const tabCompletingRef = useRef(false);
	const entryIdRef = useRef(0);

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);
	const sandboxId = panel?.sandboxId;

	const history = useMemo(
		() => entries.filter((e) => !e.running).map((e) => e.command),
		[entries],
	);

	// Refocus input after renders
	useEffect(() => {
		const timer = setTimeout(() => inputRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	});

	// Scroll to bottom when entries change
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	const runCommand = useCallback(
		async (command: string) => {
			if (!sandboxId || !command.trim()) return;

			const trimmed = command.trim();
			const id = ++entryIdRef.current;

			setEntries((prev) => [
				...prev,
				{ id, command: trimmed, cwd, result: null, error: null, running: true },
			]);
			setInput("");
			setHistoryIndex(-1);
			setTabHint(null);

			// Handle cd: wrap with pwd to get resolved path
			const cdMatch = trimmed.match(/^cd\s*(.*)?$/);
			const cdTarget = cdMatch?.[1]?.trim() || "~";
			const actualCommand = cdMatch ? `cd ${cdTarget} && pwd` : trimmed;

			try {
				const result = await api.runCommand(sandboxId, actualCommand, cwd);

				// Update entry by id (avoids stale index issues)
				setEntries((prev) =>
					prev.map((e) => {
						if (e.id !== id) return e;
						if (cdMatch && result.exit_code === 0) {
							const newDir = result.stdout
								.trim()
								.replace(/^\/home\/daytona/, "~");
							return {
								...e,
								result: { ...result, stdout: newDir },
								running: false,
							};
						}
						return { ...e, result, running: false };
					}),
				);

				if (cdMatch && result.exit_code === 0 && result.stdout.trim()) {
					setCwd(result.stdout.trim());
				}
			} catch (err) {
				setEntries((prev) =>
					prev.map((e) =>
						e.id === id ? { ...e, error: String(err), running: false } : e,
					),
				);
			}
		},
		[sandboxId, api, cwd],
	);

	const handleTabComplete = useCallback(
		async (currentInput: string) => {
			if (!sandboxId || tabCompletingRef.current) return;
			tabCompletingRef.current = true;
			setTabHint(null);

			try {
				// Extract the word being completed (last space-separated token)
				const parts = currentInput.split(/\s+/);
				const partial = parts[parts.length - 1] || "";
				const prefix =
					parts.length > 1 ? `${parts.slice(0, -1).join(" ")} ` : "";

				// Use bash -c to ensure compgen is available
				const isFirstWord = parts.length <= 1 && !currentInput.includes(" ");
				const compgenFlag = isFirstWord ? "-c -f" : "-f";

				// Escape single quotes in partial for the shell
				const escaped = partial.replace(/'/g, "'\\''");
				const cmd = `bash -c 'compgen ${compgenFlag} -- '"'"'${escaped}'"'"' 2>/dev/null | head -20'`;

				const result = await api.runCommand(sandboxId, cmd, cwd);

				if (result.exit_code === 0 && result.stdout.trim()) {
					const matches = result.stdout.trim().split("\n").filter(Boolean);

					if (matches.length === 1) {
						setInput(prefix + matches[0]);
						setTabHint(null);
					} else if (matches.length > 1) {
						const common = findCommonPrefix(matches);
						if (common.length > partial.length) {
							setInput(prefix + common);
						}
						setTabHint(
							matches.slice(0, 8).join("  ") +
								(matches.length > 8 ? "  ..." : ""),
						);
					}
				}
			} catch {
				// Tab completion is best-effort
			} finally {
				tabCompletingRef.current = false;
				inputRef.current?.focus();
			}
		},
		[sandboxId, api, cwd],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Tab") {
				e.preventDefault();
				handleTabComplete(input);
				return;
			}

			// Clear tab hint on any other key
			if (tabHint) setTabHint(null);

			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				runCommand(input);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				if (history.length === 0) return;
				const next =
					historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
				setHistoryIndex(next);
				setInput(history[history.length - 1 - next]);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				if (historyIndex <= 0) {
					setHistoryIndex(-1);
					setInput("");
				} else {
					const next = historyIndex - 1;
					setHistoryIndex(next);
					setInput(history[history.length - 1 - next]);
				}
			} else if (e.key === "l" && e.ctrlKey) {
				e.preventDefault();
				setEntries([]);
			}
		},
		[input, runCommand, history, historyIndex, handleTabComplete, tabHint],
	);

	const isRunning = entries.some((e) => e.running);
	const displayCwd = cwd.replace(/^\/home\/daytona/, "~");
	const commandInputId = useId();

	return (
		<label
			htmlFor={commandInputId}
			className="flex h-full cursor-text flex-col"
		>
			{/* Output area */}
			<ScrollArea className="min-h-0 flex-1 overflow-hidden">
				<div className="p-2.5">
					{entries.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground/30">
							<TerminalSquare size={24} strokeWidth={1} />
							<span className="font-mono text-[10.5px]">
								Run a command below
							</span>
							<span className="font-mono text-[9px] text-muted-foreground/20">
								Tab to complete &middot; Ctrl+L to clear
							</span>
						</div>
					) : (
						entries.map((entry) => (
							<div key={entry.id} className="mb-2.5 last:mb-0">
								{/* Prompt + command */}
								<div className="flex items-baseline gap-1.5">
									<span className="shrink-0 font-mono text-[10px] text-muted-foreground/30">
										{entry.cwd.replace(/^\/home\/daytona/, "~")}
									</span>
									<ChevronRight
										size={10}
										className="mt-px shrink-0 text-muted-foreground/35"
									/>
									<span className="font-mono text-[11px] font-medium text-foreground/80">
										{entry.command}
									</span>
									{entry.running && (
										<RoseCurveSpinner
											size={10}
											className="shrink-0 text-muted-foreground/40"
										/>
									)}
								</div>

								{/* Output */}
								{entry.result && (
									<div className="mt-0.5">
										{entry.result.stdout && (
											<pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-foreground/55">
												{entry.result.stdout}
											</pre>
										)}
										{entry.result.stderr && (
											<pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-red-400/70">
												{entry.result.stderr}
											</pre>
										)}
										{entry.result.exit_code !== 0 && (
											<div className="mt-0.5 flex items-center gap-1">
												<AlertCircle size={9} className="text-red-400/50" />
												<span className="font-mono text-[9px] text-red-400/50">
													exit {entry.result.exit_code}
												</span>
											</div>
										)}
									</div>
								)}

								{entry.error && (
									<div className="mt-0.5">
										<pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-red-400/70">
											{entry.error}
										</pre>
									</div>
								)}
							</div>
						))
					)}
					<div ref={bottomRef} />
				</div>
			</ScrollArea>

			{/* Tab completion hints */}
			{tabHint && (
				<div className="shrink-0 border-t border-border/50 px-2.5 py-1">
					<span className="font-mono text-[10px] leading-relaxed text-muted-foreground/40">
						{tabHint}
					</span>
				</div>
			)}

			{/* Input bar */}
			<div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2.5 py-1.5">
				<span className="shrink-0 font-mono text-[10px] text-muted-foreground/30">
					{displayCwd}
				</span>
				<ChevronRight size={10} className="shrink-0 text-muted-foreground/35" />
				<input
					id={commandInputId}
					ref={inputRef}
					type="text"
					value={input}
					onChange={(e) => {
						setInput(e.target.value);
						if (tabHint) setTabHint(null);
					}}
					onKeyDown={handleKeyDown}
					placeholder={isRunning ? "running..." : ""}
					disabled={isRunning}
					className={cn(
						"flex-1 bg-transparent font-mono text-[11px] text-foreground/80 outline-none placeholder:text-muted-foreground/25",
						isRunning && "opacity-50",
					)}
				/>
			</div>
		</label>
	);
}

function findCommonPrefix(strings: string[]): string {
	if (strings.length === 0) return "";
	let prefix = strings[0];
	for (let i = 1; i < strings.length; i++) {
		while (!strings[i].startsWith(prefix)) {
			prefix = prefix.slice(0, -1);
			if (!prefix) return "";
		}
	}
	return prefix;
}
