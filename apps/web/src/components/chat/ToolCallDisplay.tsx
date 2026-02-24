import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";

interface ToolCallDisplayProps {
	toolCall: { id?: string; name: string; arguments?: string };
	toolResult: { name: string; result: string };
}

export function ToolCallDisplay({
	toolCall,
	toolResult,
}: ToolCallDisplayProps) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="border border-border/60 rounded-lg overflow-hidden text-xs">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
			>
				<Wrench className="size-3 text-primary flex-shrink-0" />
				<span className="font-mono font-medium text-foreground/80 truncate">
					{toolCall.name}
				</span>
				{expanded ? (
					<ChevronDown className="size-3 text-muted-foreground ml-auto flex-shrink-0" />
				) : (
					<ChevronRight className="size-3 text-muted-foreground ml-auto flex-shrink-0" />
				)}
			</button>

			{expanded && (
				<div className="px-3 py-2 space-y-2 border-t border-border/40">
					{toolCall.arguments && (
						<div>
							<p className="text-muted-foreground mb-1 font-mono uppercase tracking-wider text-[10px]">
								Input
							</p>
							<pre className="bg-secondary/50 rounded p-2 overflow-x-auto font-mono text-[11px] leading-relaxed">
								{typeof toolCall.arguments === "string"
									? toolCall.arguments
									: JSON.stringify(toolCall.arguments, null, 2)}
							</pre>
						</div>
					)}
					<div>
						<p className="text-muted-foreground mb-1 font-mono uppercase tracking-wider text-[10px]">
							Output
						</p>
						<pre className="bg-secondary/50 rounded p-2 overflow-x-auto font-mono text-[11px] leading-relaxed max-h-48">
							{toolResult.result}
						</pre>
					</div>
				</div>
			)}
		</div>
	);
}
