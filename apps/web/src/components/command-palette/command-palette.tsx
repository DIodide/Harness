import { Command as Cmdk } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandPaletteHotkey } from "../../hooks/use-command-palette-hotkey";
import { useCommandPalette } from "../../lib/command-palette/context";
import {
	getRecentCommandIds,
	pushRecentCommand,
} from "../../lib/command-palette/recent";
import {
	COMMAND_GROUP_LABELS,
	COMMAND_GROUP_ORDER,
	type Command,
	type CommandGroupId,
} from "../../lib/command-palette/types";
import { cn } from "../../lib/utils";
import { CommandItem } from "./command-item";

export function CommandPalette() {
	useCommandPaletteHotkey();

	const { open, setOpen, snapshot } = useCommandPalette();
	const [search, setSearch] = useState("");
	const [recentIds, setRecentIds] = useState<string[]>([]);
	const [snapshotCommands, setSnapshotCommands] = useState<Command[]>([]);
	const wasOpenRef = useRef(false);

	useEffect(() => {
		if (!open) {
			wasOpenRef.current = false;
			return;
		}
		const justOpened = !wasOpenRef.current;
		wasOpenRef.current = true;
		if (justOpened) {
			setSearch("");
			setRecentIds(getRecentCommandIds());
		}
		setSnapshotCommands(snapshot().filter((c) => !c.when || c.when()));
	}, [open, snapshot]);

	const { groups, recentCommands } = useMemo(() => {
		const byGroup = new Map<CommandGroupId, Command[]>();
		for (const cmd of snapshotCommands) {
			const list = byGroup.get(cmd.group) ?? [];
			list.push(cmd);
			byGroup.set(cmd.group, list);
		}

		const byId = new Map(snapshotCommands.map((c) => [c.id, c]));
		const recent: Command[] = [];
		if (search.trim().length === 0) {
			for (const id of recentIds) {
				const cmd = byId.get(id);
				if (cmd) recent.push(cmd);
				if (recent.length >= 5) break;
			}
		}

		const ordered: Array<{ id: CommandGroupId; commands: Command[] }> = [];
		for (const groupId of COMMAND_GROUP_ORDER) {
			if (groupId === "recent") continue;
			const commands = byGroup.get(groupId);
			if (commands && commands.length > 0) {
				ordered.push({ id: groupId, commands });
			}
		}
		return { groups: ordered, recentCommands: recent };
	}, [snapshotCommands, recentIds, search]);

	const runCommand = (command: Command) => {
		setOpen(false);
		pushRecentCommand(command.id);
		// Defer to let the dialog close animation start before the handler fires
		// (e.g., navigation). Keeps the UI feeling snappy and avoids focus fights.
		queueMicrotask(() => {
			try {
				command.perform();
			} catch (err) {
				console.error("[command-palette] command failed", command.id, err);
			}
		});
	};

	return (
		<Cmdk.Dialog
			open={open}
			onOpenChange={setOpen}
			label="Command Palette"
			loop
			overlayClassName={cn(
				"fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]",
				"data-[state=open]:animate-in data-[state=closed]:animate-out",
				"data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
			)}
			contentClassName={cn(
				"fixed left-1/2 top-[18vh] z-[61] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2",
				"overflow-hidden rounded-lg border border-border bg-background shadow-2xl shadow-black/30",
				"outline-none",
				"data-[state=open]:animate-in data-[state=closed]:animate-out",
				"data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
				"data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
				"data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2",
				"duration-150",
			)}
		>
			<div className="flex items-center gap-2 border-b border-border/80 px-3">
				<Search
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<Cmdk.Input
					value={search}
					onValueChange={setSearch}
					autoFocus
					placeholder="Type a command or search…"
					className={cn(
						"flex h-12 w-full bg-transparent text-sm text-foreground outline-none",
						"placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50",
					)}
				/>
				<kbd className="ml-auto hidden shrink-0 items-center rounded-sm border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
					esc
				</kbd>
			</div>

			<Cmdk.List className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain p-1.5">
				<Cmdk.Empty className="flex h-24 flex-col items-center justify-center gap-1 text-center">
					<span className="text-sm text-muted-foreground">
						No results found
					</span>
					<span className="text-xs text-muted-foreground/70">
						Try a different keyword
					</span>
				</Cmdk.Empty>

				{recentCommands.length > 0 && (
					<Cmdk.Group
						heading={<GroupHeading>Recently used</GroupHeading>}
						className="mb-1"
					>
						{recentCommands.map((command) => (
							<CommandItem
								key={`recent-${command.id}`}
								command={command}
								onRun={runCommand}
							/>
						))}
					</Cmdk.Group>
				)}

				{groups.map(({ id, commands }) => (
					<Cmdk.Group
						key={id}
						heading={<GroupHeading>{COMMAND_GROUP_LABELS[id]}</GroupHeading>}
						className="mb-1"
					>
						{commands.map((command) => (
							<CommandItem
								key={command.id}
								command={command}
								onRun={runCommand}
							/>
						))}
					</Cmdk.Group>
				))}
			</Cmdk.List>

			<div className="flex items-center justify-between border-t border-border/80 px-3 py-1.5 text-[11px] text-muted-foreground">
				<div className="flex items-center gap-3">
					<FooterHint label="navigate">
						<FooterKey>↑</FooterKey>
						<FooterKey>↓</FooterKey>
					</FooterHint>
					<FooterHint label="select">
						<FooterKey>↵</FooterKey>
					</FooterHint>
					<FooterHint label="close">
						<FooterKey>esc</FooterKey>
					</FooterHint>
				</div>
				<span className="hidden font-mono text-[10px] opacity-70 sm:inline">
					Harness
				</span>
			</div>
		</Cmdk.Dialog>
	);
}

function GroupHeading({ children }: { children: React.ReactNode }) {
	return (
		<div className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
			{children}
		</div>
	);
}

function FooterHint({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-1">
			<span className="inline-flex items-center gap-0.5">{children}</span>
			<span>{label}</span>
		</span>
	);
}

function FooterKey({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-[3px] border border-border/70 bg-muted/60 px-1 font-mono text-[10px] leading-none text-foreground/80">
			{children}
		</kbd>
	);
}
