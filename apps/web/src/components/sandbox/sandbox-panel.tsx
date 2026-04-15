import { ChevronLeft, Files, GitBranch, Terminal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type SandboxTab,
	useSandboxPanel,
} from "../../lib/sandbox-panel-context";
import { cn } from "../../lib/utils";
import { CommandRunner } from "./command-input";
import { FileExplorer } from "./file-explorer";
import { FileViewer } from "./file-viewer";
import { GitPanel } from "./git-panel";

const WebTerminal = lazy(() =>
	import("./terminal").then((m) => ({ default: m.WebTerminal })),
);

const TABS: { id: SandboxTab; icon: typeof Files; label: string }[] = [
	{ id: "files", icon: Files, label: "Files" },
	{ id: "terminal", icon: Terminal, label: "Terminal" },
	{ id: "git", icon: GitBranch, label: "Git" },
];

const MIN_WIDTH = 360;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 520;

export function SandboxPanel() {
	const panel = useSandboxPanel();
	const [terminalMode, setTerminalMode] = useState<"pty" | "runner">("pty");
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const dragging = useRef(false);
	const startX = useRef(0);
	const startWidth = useRef(0);
	const cleanupRef = useRef<(() => void) | null>(null);

	// Clean up drag listeners on unmount
	useEffect(() => {
		return () => {
			cleanupRef.current?.();
		};
	}, []);

	const handleDragStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			dragging.current = true;
			startX.current = e.clientX;
			startWidth.current = width;

			const onMove = (ev: MouseEvent) => {
				if (!dragging.current) return;
				const delta = startX.current - ev.clientX;
				const newWidth = Math.min(
					MAX_WIDTH,
					Math.max(MIN_WIDTH, startWidth.current + delta),
				);
				setWidth(newWidth);
			};

			const onUp = () => {
				dragging.current = false;
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				cleanupRef.current = null;
			};

			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

			cleanupRef.current = onUp;
		},
		[width],
	);

	if (!panel) return null;

	const {
		activeTab,
		setActiveTab,
		activeFile,
		openFiles,
		togglePanel,
		setActiveFile,
	} = panel;
	const showViewer =
		activeTab === "files" && openFiles.length > 0 && activeFile;

	return (
		<motion.aside
			initial={{ width: 0, opacity: 0 }}
			animate={{ width, opacity: 1 }}
			exit={{ width: 0, opacity: 0 }}
			transition={
				dragging.current ? { duration: 0 } : { duration: 0.15, ease: "easeOut" }
			}
			className="relative flex h-full flex-col overflow-hidden border-l border-border bg-background"
		>
			{/* Resize handle */}
			<button
				type="button"
				aria-label="Resize sandbox panel"
				className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize border-0 bg-transparent p-0 hover:bg-foreground/10 active:bg-foreground/15"
				onMouseDown={handleDragStart}
			/>

			{/* Top bar: tabs + close */}
			<div className="flex h-9 shrink-0 items-center border-b border-border">
				<div className="flex flex-1 items-center">
					{TABS.map((tab) => {
						const Icon = tab.icon;
						const isActive = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className={cn(
									"flex h-9 items-center gap-1.5 px-3 font-mono text-[11px] transition-colors",
									isActive
										? "border-b border-foreground text-foreground"
										: "text-muted-foreground/50 hover:text-muted-foreground",
								)}
							>
								<Icon size={13} strokeWidth={1.5} />
								{tab.label}
							</button>
						);
					})}
				</div>
				{/* Terminal mode toggle */}
				{activeTab === "terminal" && (
					<div className="flex items-center gap-0.5 pr-1">
						<button
							type="button"
							onClick={() => setTerminalMode("pty")}
							title="Interactive terminal (PTY)"
							className={cn(
								"rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors",
								terminalMode === "pty"
									? "bg-foreground/10 text-foreground"
									: "text-muted-foreground/35 hover:text-muted-foreground/60",
							)}
						>
							PTY
						</button>
						<button
							type="button"
							onClick={() => setTerminalMode("runner")}
							title="Simple command runner"
							className={cn(
								"rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors",
								terminalMode === "runner"
									? "bg-foreground/10 text-foreground"
									: "text-muted-foreground/35 hover:text-muted-foreground/60",
							)}
						>
							Run
						</button>
					</div>
				)}
				<button
					type="button"
					onClick={togglePanel}
					title="Close panel"
					className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
				>
					<X size={14} strokeWidth={1.5} />
				</button>
			</div>

			{/* Content */}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{/* Files tab */}
				{activeTab === "files" && (
					<AnimatePresence mode="wait" initial={false}>
						{showViewer ? (
							<motion.div
								key="viewer"
								initial={{ opacity: 0, x: 16 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: 16 }}
								transition={{ duration: 0.1 }}
								className="flex flex-1 flex-col overflow-hidden"
							>
								{/* File tabs bar */}
								<div className="flex items-center border-b border-border bg-muted/20">
									<button
										type="button"
										onClick={() => setActiveFile(null)}
										className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors hover:text-muted-foreground"
										title="Back to files"
									>
										<ChevronLeft size={13} />
									</button>
									<div className="flex flex-1 items-center overflow-x-auto">
										{openFiles.map((filePath) => {
											const fileName = filePath.split("/").pop() ?? filePath;
											const isCurrent = filePath === activeFile;
											return (
												<button
													key={filePath}
													type="button"
													onClick={() => panel.setActiveFile(filePath)}
													title={filePath}
													className={cn(
														"group flex shrink-0 items-center gap-1 border-r border-border/50 px-2.5 py-1.5 font-mono text-[10.5px] transition-colors",
														isCurrent
															? "bg-background text-foreground"
															: "text-muted-foreground/60 hover:text-foreground",
													)}
												>
													<span className="max-w-[100px] truncate">
														{fileName}
													</span>
													<button
														type="button"
														tabIndex={0}
														className="ml-0.5 rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-60 [button:hover>&]:opacity-60"
														onClick={(e) => {
															e.stopPropagation();
															panel.closeFile(filePath);
														}}
													>
														<X size={9} />
													</button>
												</button>
											);
										})}
									</div>
								</div>

								<FileViewer />
							</motion.div>
						) : (
							<motion.div
								key="explorer"
								initial={{ opacity: 0, x: -16 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: -16 }}
								transition={{ duration: 0.1 }}
								className="flex flex-1 flex-col overflow-hidden"
							>
								<FileExplorer />
							</motion.div>
						)}
					</AnimatePresence>
				)}

				{/* Terminal — always mounted, hidden via CSS to preserve state */}
				<div
					className={cn(
						"flex flex-1 flex-col overflow-hidden",
						activeTab !== "terminal" && "hidden",
					)}
				>
					{terminalMode === "pty" ? (
						<Suspense
							fallback={
								<div className="flex flex-1 items-center justify-center">
									<span className="font-mono text-[10.5px] text-muted-foreground/40">
										Loading terminal...
									</span>
								</div>
							}
						>
							<WebTerminal />
						</Suspense>
					) : (
						<CommandRunner />
					)}
				</div>

				{activeTab === "git" && <GitPanel />}
			</div>
		</motion.aside>
	);
}
