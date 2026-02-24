export function StreamingIndicator() {
	return (
		<div className="flex items-center gap-2 text-muted-foreground text-xs px-1 py-2">
			<div className="flex gap-1">
				<span className="size-1.5 bg-primary/50 rounded-full animate-pulse" />
				<span className="size-1.5 bg-primary/50 rounded-full animate-pulse [animation-delay:200ms]" />
				<span className="size-1.5 bg-primary/50 rounded-full animate-pulse [animation-delay:400ms]" />
			</div>
			<span className="font-mono text-[10px] uppercase tracking-wider">
				Thinking
			</span>
		</div>
	);
}
