import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

const MODELS = [
	{ id: "openai/gpt-4o", name: "GPT-4o" },
	{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
	{ id: "google/gemini-2.5-pro-preview-06-05", name: "Gemini 2.5 Pro" },
	{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
	{ id: "x-ai/grok-3", name: "Grok 3" },
	{ id: "x-ai/grok-3-mini", name: "Grok 3 Mini" },
];

interface ModelSelectorProps {
	model: string;
	onModelChange: (model: string) => void;
}

export function ModelSelector({ model, onModelChange }: ModelSelectorProps) {
	return (
		<Select value={model} onValueChange={onModelChange}>
			<SelectTrigger className="w-[180px] h-8 text-xs font-mono bg-secondary/50 border-border/60">
				<SelectValue placeholder="Select model" />
			</SelectTrigger>
			<SelectContent>
				{MODELS.map((m) => (
					<SelectItem key={m.id} value={m.id} className="text-xs font-mono">
						{m.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
