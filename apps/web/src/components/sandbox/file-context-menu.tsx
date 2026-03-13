import { useAuth } from "@clerk/clerk-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createSandboxApi, type SandboxFile } from "../../lib/sandbox-api";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { cn } from "../../lib/utils";

interface ContextMenuState {
	x: number;
	y: number;
	file: SandboxFile;
}

interface FileContextMenuProps {
	menu: ContextMenuState;
	onClose: () => void;
	onRefresh: () => void;
}

export function FileContextMenu({
	menu,
	onClose,
	onRefresh,
}: FileContextMenuProps) {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const menuRef = useRef<HTMLDivElement>(null);
	const [renaming, setRenaming] = useState(false);
	const [newName, setNewName] = useState(menu.file.name);
	const [creating, setCreating] = useState<"file" | "folder" | null>(null);
	const [createName, setCreateName] = useState("");

	const api = useMemo(() => createSandboxApi(getToken), [getToken]);
	const sandboxId = panel?.sandboxId;

	// Close on click outside
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [onClose]);

	// Close on Escape
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [onClose]);

	const handleDelete = useCallback(async () => {
		if (!sandboxId) return;
		const label = menu.file.is_dir ? "directory" : "file";
		if (!window.confirm(`Delete ${label} "${menu.file.name}"?`)) return;
		try {
			await api.deleteFile(sandboxId, menu.file.path, menu.file.is_dir);
			onRefresh();
		} catch (err) {
			console.error("Delete failed:", err);
		}
		onClose();
	}, [sandboxId, api, menu.file, onClose, onRefresh]);

	const handleRename = useCallback(async () => {
		if (!sandboxId || !newName.trim() || newName === menu.file.name) {
			setRenaming(false);
			return;
		}
		const parentDir = menu.file.path.substring(
			0,
			menu.file.path.lastIndexOf("/"),
		);
		const destination = `${parentDir}/${newName.trim()}`;
		try {
			await api.moveFile(sandboxId, menu.file.path, destination);
			onRefresh();
		} catch (err) {
			console.error("Rename failed:", err);
		}
		onClose();
	}, [sandboxId, api, menu.file, newName, onClose, onRefresh]);

	const handleCreate = useCallback(
		async (type: "file" | "folder") => {
			const name = createName.trim();
			if (
				!sandboxId ||
				!name ||
				name.includes("/") ||
				name.includes("\\") ||
				name.includes("..")
			) {
				setCreating(null);
				return;
			}
			const parentPath = menu.file.is_dir
				? menu.file.path
				: menu.file.path.substring(0, menu.file.path.lastIndexOf("/"));
			const fullPath = `${parentPath}/${name}`;
			try {
				if (type === "folder") {
					await api.createDirectory(sandboxId, fullPath);
				} else {
					await api.writeFile(sandboxId, fullPath, "");
				}
				onRefresh();
			} catch (err) {
				console.error("Create failed:", err);
			}
			onClose();
		},
		[sandboxId, api, menu.file, createName, onClose, onRefresh],
	);

	const handleOpenFile = useCallback(() => {
		if (!menu.file.is_dir) {
			panel?.openFile(menu.file.path);
		}
		onClose();
	}, [menu.file, panel, onClose]);

	// Inline rename input
	if (renaming) {
		return createPortal(
			<div
				ref={menuRef}
				className="fixed z-50 rounded border border-border bg-popover p-1.5 shadow-md"
				style={{ left: menu.x, top: menu.y }}
			>
				<input
					type="text"
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleRename();
						if (e.key === "Escape") onClose();
					}}
					className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-foreground/30"
				/>
			</div>,
			document.body,
		);
	}

	// Inline create input
	if (creating) {
		return createPortal(
			<div
				ref={menuRef}
				className="fixed z-50 rounded border border-border bg-popover p-1.5 shadow-md"
				style={{ left: menu.x, top: menu.y }}
			>
				<p className="mb-1 font-mono text-[9.5px] text-muted-foreground/50">
					New {creating}
				</p>
				<input
					type="text"
					value={createName}
					onChange={(e) => setCreateName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleCreate(creating);
						if (e.key === "Escape") onClose();
					}}
					placeholder={creating === "folder" ? "folder name" : "filename.txt"}
					className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30"
				/>
			</div>,
			document.body,
		);
	}

	return createPortal(
		<div
			ref={menuRef}
			className="fixed z-50 min-w-[160px] rounded border border-border bg-popover py-1 shadow-md"
			style={{ left: menu.x, top: menu.y }}
		>
			{!menu.file.is_dir && <MenuItem onClick={handleOpenFile}>Open</MenuItem>}
			<MenuItem
				onClick={() => {
					setCreating("file");
					setCreateName("");
				}}
			>
				New File
			</MenuItem>
			<MenuItem
				onClick={() => {
					setCreating("folder");
					setCreateName("");
				}}
			>
				New Folder
			</MenuItem>
			<div className="my-1 border-t border-border/50" />
			<MenuItem
				onClick={() => {
					setRenaming(true);
					setNewName(menu.file.name);
				}}
			>
				Rename
			</MenuItem>
			<MenuItem onClick={handleDelete} destructive>
				Delete
			</MenuItem>
		</div>,
		document.body,
	);
}

function MenuItem({
	children,
	onClick,
	destructive,
}: {
	children: React.ReactNode;
	onClick: () => void;
	destructive?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center px-2.5 py-1 text-left font-mono text-[11px] transition-colors",
				destructive
					? "text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
					: "text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
