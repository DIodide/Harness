import { useAuth } from "@clerk/clerk-react";
import {
	ChevronRight,
	File,
	Folder,
	FolderOpen,
	RefreshCw,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSandboxApi, type SandboxFile } from "../../lib/sandbox-api";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { cn } from "../../lib/utils";
import { RoseCurveSpinner } from "../rose-curve-spinner";
import { ScrollArea } from "../ui/scroll-area";
import { FileContextMenu } from "./file-context-menu";
import { FileSearch } from "./file-search";

interface DirNode {
	files: SandboxFile[];
	loading: boolean;
	expanded: boolean;
}

interface ContextMenuState {
	x: number;
	y: number;
	file: SandboxFile;
}

export function FileExplorer() {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const [dirs, setDirs] = useState<Map<string, DirNode>>(new Map());
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [showSearch, setShowSearch] = useState(false);

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);
	const sandboxId = panel?.sandboxId;
	const currentDir = panel?.currentDir ?? "/home/daytona";

	const loadDir = useCallback(
		async (path: string) => {
			if (!sandboxId) return;
			setDirs((prev) => {
				const next = new Map(prev);
				const existing = next.get(path);
				next.set(path, {
					files: existing?.files ?? [],
					loading: true,
					expanded: true,
				});
				return next;
			});
			try {
				const res = await api.listFiles(sandboxId, path);
				const sorted = [...res.files].sort((a, b) => {
					if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
					return a.name.localeCompare(b.name);
				});
				setDirs((prev) => {
					const next = new Map(prev);
					next.set(path, { files: sorted, loading: false, expanded: true });
					return next;
				});
			} catch (err) {
				console.error("Failed to list files:", err);
				setDirs((prev) => {
					const next = new Map(prev);
					next.set(path, { files: [], loading: false, expanded: true });
					return next;
				});
			}
		},
		[sandboxId, api],
	);

	useEffect(() => {
		if (sandboxId) {
			loadDir(currentDir);
		}
	}, [sandboxId, currentDir, loadDir]);

	const toggleDir = useCallback(
		(path: string) => {
			const node = dirs.get(path);
			if (node?.expanded) {
				setDirs((prev) => {
					const next = new Map(prev);
					next.set(path, { ...node, expanded: false });
					return next;
				});
			} else {
				loadDir(path);
			}
		},
		[dirs, loadDir],
	);

	const handleFileClick = useCallback(
		(file: SandboxFile) => {
			if (file.is_dir) {
				toggleDir(file.path);
			} else {
				panel?.openFile(file.path);
			}
		},
		[panel, toggleDir],
	);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent, file: SandboxFile) => {
			e.preventDefault();
			setContextMenu({ x: e.clientX, y: e.clientY, file });
		},
		[],
	);

	const handleRefresh = useCallback(() => {
		loadDir(currentDir);
	}, [currentDir, loadDir]);

	const rootNode = dirs.get(currentDir);
	const pathSegments = currentDir.split("/").filter(Boolean);

	if (showSearch) {
		return <FileSearch onClose={() => setShowSearch(false)} />;
	}

	return (
		<div className="flex h-full flex-col">
			{/* Path bar */}
			<div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
				<span className="flex-1 truncate font-mono text-[10.5px] text-muted-foreground/60">
					{pathSegments.length > 2
						? `.../${pathSegments.slice(-2).join("/")}`
						: `/${pathSegments.join("/")}`}
				</span>
				<button
					type="button"
					onClick={() => setShowSearch(true)}
					title="Search in files"
					className="flex h-5 w-5 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
				>
					<Search size={10} />
				</button>
				<button
					type="button"
					onClick={() => loadDir(currentDir)}
					title="Refresh"
					className="flex h-5 w-5 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
				>
					<RefreshCw size={10} />
				</button>
			</div>

			{/* File tree */}
			<ScrollArea className="min-h-0 flex-1 overflow-hidden">
				<div className="py-0.5">
					{rootNode?.loading && rootNode.files.length === 0 ? (
						<div className="flex items-center justify-center py-12">
							<RoseCurveSpinner
								size={14}
								className="text-muted-foreground/40"
							/>
						</div>
					) : rootNode?.files.length === 0 ? (
						<p className="px-4 py-8 text-center font-mono text-[10.5px] text-muted-foreground/40">
							empty directory
						</p>
					) : (
						rootNode?.files.map((file) => (
							<FileTreeNode
								key={file.path}
								file={file}
								depth={0}
								dirs={dirs}
								onToggle={toggleDir}
								onClick={handleFileClick}
								onContextMenu={handleContextMenu}
								activeFile={panel?.activeFile ?? null}
							/>
						))
					)}
				</div>
			</ScrollArea>

			{/* Footer */}
			{rootNode && !rootNode.loading && (
				<div className="border-t border-border px-2.5 py-1">
					<span className="font-mono text-[9.5px] text-muted-foreground/35">
						{rootNode.files.length} items
					</span>
				</div>
			)}

			{/* Context menu */}
			{contextMenu && (
				<FileContextMenu
					menu={contextMenu}
					onClose={() => setContextMenu(null)}
					onRefresh={handleRefresh}
				/>
			)}
		</div>
	);
}

function FileTreeNode({
	file,
	depth,
	dirs,
	onToggle,
	onClick,
	onContextMenu,
	activeFile,
}: {
	file: SandboxFile;
	depth: number;
	dirs: Map<string, DirNode>;
	onToggle: (path: string) => void;
	onClick: (file: SandboxFile) => void;
	onContextMenu: (e: React.MouseEvent, file: SandboxFile) => void;
	activeFile: string | null;
}) {
	const node = file.is_dir ? dirs.get(file.path) : null;
	const isExpanded = node?.expanded ?? false;
	const isActive = !file.is_dir && file.path === activeFile;

	return (
		<>
			<button
				type="button"
				className={cn(
					"group flex w-full items-center gap-1 py-[3px] text-left transition-colors",
					isActive
						? "bg-foreground/[0.06] text-foreground"
						: "text-foreground/65 hover:bg-foreground/[0.03] hover:text-foreground/90",
				)}
				style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "8px" }}
				onClick={() => onClick(file)}
				onContextMenu={(e) => onContextMenu(e, file)}
			>
				{file.is_dir ? (
					<>
						<ChevronRight
							size={10}
							strokeWidth={1.5}
							className={cn(
								"shrink-0 text-muted-foreground/40 transition-transform duration-150",
								isExpanded && "rotate-90",
							)}
						/>
						{isExpanded ? (
							<FolderOpen
								size={13}
								strokeWidth={1.5}
								className="shrink-0 text-amber-500/70"
							/>
						) : (
							<Folder
								size={13}
								strokeWidth={1.5}
								className="shrink-0 text-amber-500/60"
							/>
						)}
					</>
				) : (
					<>
						<span className="w-[10px] shrink-0" />
						<File
							size={13}
							strokeWidth={1.5}
							className="shrink-0 text-muted-foreground/35"
						/>
					</>
				)}
				<span
					className={cn(
						"truncate font-mono text-[11px] leading-tight",
						file.is_dir && "font-medium",
					)}
				>
					{file.name}
				</span>
			</button>

			{file.is_dir &&
				isExpanded &&
				node &&
				(node.loading && node.files.length === 0 ? (
					<div
						className="flex items-center gap-1 py-1 font-mono text-[10px] text-muted-foreground/35"
						style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
					>
						<RoseCurveSpinner size={9} />
					</div>
				) : (
					node.files.map((child) => (
						<FileTreeNode
							key={child.path}
							file={child}
							depth={depth + 1}
							dirs={dirs}
							onToggle={onToggle}
							onClick={onClick}
							onContextMenu={onContextMenu}
							activeFile={activeFile}
						/>
					))
				))}
		</>
	);
}
