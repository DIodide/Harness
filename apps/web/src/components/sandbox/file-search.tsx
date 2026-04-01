import { useAuth } from "@clerk/clerk-react";
import { FileText, Loader2, Search, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { createSandboxApi, type SearchMatch } from "../../lib/sandbox-api";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { ScrollArea } from "../ui/scroll-area";

export function FileSearch({ onClose }: { onClose: () => void }) {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchMatch[]>([]);
	const [searching, setSearching] = useState(false);
	const [searched, setSearched] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);
	const sandboxId = panel?.sandboxId;
	const searchPath = panel?.currentDir ?? "/home/daytona";

	const handleSearch = useCallback(async () => {
		if (!sandboxId || !query.trim()) return;
		setSearching(true);
		setSearched(false);
		try {
			const res = await api.searchFiles(sandboxId, query.trim(), searchPath);
			setResults(res.matches);
		} catch {
			setResults([]);
		} finally {
			setSearching(false);
			setSearched(true);
		}
	}, [sandboxId, api, query, searchPath]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSearch();
			}
			if (e.key === "Escape") {
				onClose();
			}
		},
		[handleSearch, onClose],
	);

	return (
		<div className="flex h-full flex-col">
			{/* Search bar */}
			<div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5">
				<Search size={12} className="shrink-0 text-muted-foreground/40" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Search in files..."
					className="flex-1 bg-transparent font-mono text-[11px] text-foreground/80 outline-none placeholder:text-muted-foreground/30"
				/>
				{searching && (
					<Loader2
						size={11}
						className="shrink-0 animate-spin text-muted-foreground/40"
					/>
				)}
				<button
					type="button"
					onClick={onClose}
					className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
				>
					<X size={11} />
				</button>
			</div>

			{/* Results */}
			<ScrollArea className="min-h-0 flex-1 overflow-hidden">
				<div className="py-1">
					{!searched && results.length === 0 && (
						<p className="px-3 py-8 text-center font-mono text-[10px] text-muted-foreground/30">
							Enter a pattern and press Enter
						</p>
					)}
					{searched && results.length === 0 && (
						<p className="px-3 py-8 text-center font-mono text-[10px] text-muted-foreground/30">
							No matches found
						</p>
					)}
					{results.map((match, i) => (
						<button
							key={`${match.file}-${match.line}-${i}`}
							type="button"
							className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.03]"
							onClick={() => {
								panel?.openFile(match.file);
							}}
						>
							<FileText
								size={12}
								className="mt-0.5 shrink-0 text-muted-foreground/30"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-baseline gap-1.5">
									<span className="truncate font-mono text-[10.5px] text-foreground/70">
										{match.file.replace(/^\/home\/daytona\//, "")}
									</span>
									{match.line != null && (
										<span className="shrink-0 font-mono text-[9px] text-muted-foreground/30">
											:{match.line}
										</span>
									)}
								</div>
								<pre className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/50">
									{match.content.trim()}
								</pre>
							</div>
						</button>
					))}
				</div>
			</ScrollArea>

			{/* Footer */}
			{searched && results.length > 0 && (
				<div className="shrink-0 border-t border-border px-2.5 py-1">
					<span className="font-mono text-[9px] text-muted-foreground/30">
						{results.length} match{results.length !== 1 ? "es" : ""}
					</span>
				</div>
			)}
		</div>
	);
}
