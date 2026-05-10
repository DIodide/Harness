import { Command as Cmdk } from "cmdk";
import type { Command } from "../../lib/command-palette/types";
import { cn } from "../../lib/utils";
import { CommandKbd } from "./command-kbd";

interface CommandItemProps {
	command: Command;
	onRun: (command: Command) => void;
}

export function CommandItem({ command, onRun }: CommandItemProps) {
	const Icon = command.icon;
	return (
		<Cmdk.Item
			value={`${command.id} ${command.title} ${(command.keywords ?? []).join(" ")}`}
			keywords={command.keywords}
			onSelect={() => onRun(command)}
			className={cn(
				"group/cmd-item relative flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 text-sm",
				"text-foreground/85 outline-none transition-colors",
				"aria-selected:bg-muted aria-selected:text-foreground",
				"data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40",
			)}
		>
			<span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground group-aria-selected/cmd-item:text-foreground">
				{command.colorDot ? (
					<span
						className="inline-block h-2 w-2 rounded-full ring-1 ring-border/60"
						style={{ backgroundColor: command.colorDot }}
						aria-hidden="true"
					/>
				) : Icon ? (
					<Icon className="h-4 w-4" />
				) : null}
			</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="truncate">{command.title}</span>
				{command.subtitle && (
					<span className="truncate text-xs text-muted-foreground">
						{command.subtitle}
					</span>
				)}
			</span>
			{command.shortcut && (
				<CommandKbd
					shortcut={command.shortcut}
					className="shrink-0 opacity-0 transition-opacity group-aria-selected/cmd-item:opacity-100"
				/>
			)}
		</Cmdk.Item>
	);
}
