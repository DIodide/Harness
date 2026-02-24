import { ArrowUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
	onSend: (content: string) => void;
	disabled: boolean;
	harnessName?: string;
}

export function ChatInput({ onSend, disabled, harnessName }: ChatInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleSend = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setValue("");
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}, [value, disabled, onSend]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleInput = () => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	};

	return (
		<div className="border-t border-border bg-background">
			<div className="max-w-3xl mx-auto px-4 py-3">
				<div className="relative flex items-end gap-2 bg-secondary/50 border border-border/60 rounded-xl px-4 py-3 focus-within:border-primary/40 focus-within:glow-teal-sm transition-all">
					<Textarea
						ref={textareaRef}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={handleKeyDown}
						onInput={handleInput}
						placeholder={
							harnessName
								? `Message with ${harnessName} harness...`
								: "Send a message..."
						}
						disabled={disabled}
						rows={1}
						className="flex-1 resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[20px] max-h-[200px] placeholder:text-muted-foreground/50"
					/>
					<Button
						size="icon-sm"
						onClick={handleSend}
						disabled={!value.trim() || disabled}
						className="flex-shrink-0 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-30"
					>
						<ArrowUp className="size-4" />
					</Button>
				</div>
				{harnessName && (
					<p className="text-[10px] text-muted-foreground/50 text-center mt-1.5 font-mono">
						Using {harnessName} harness
					</p>
				)}
			</div>
		</div>
	);
}
