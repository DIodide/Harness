import { cn } from "../../lib/utils";

/** Split a shortcut label like "⌘⌥1" or "Ctrl+Alt+1" into individual key tokens. */
function splitKeys(shortcut: string): string[] {
	if (shortcut.includes("+")) return shortcut.split("+").filter(Boolean);
	return Array.from(shortcut);
}

export function CommandKbd({
	shortcut,
	className,
}: {
	shortcut: string;
	className?: string;
}) {
	const keys = splitKeys(shortcut);
	return (
		<kbd
			className={cn(
				"pointer-events-none inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground",
				className,
			)}
			aria-label={shortcut}
		>
			{keys.map((key, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: shortcut keys form a fixed ordered set
					key={i}
					className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border/70 bg-muted/60 px-1 leading-none text-foreground/80"
				>
					{key}
				</span>
			))}
		</kbd>
	);
}
