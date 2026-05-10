import { Cpu, HardDrive, Play } from "lucide-react";
import { motion } from "motion/react";
import { DEFAULT_SANDBOX_CONFIG, type SandboxConfig } from "../../lib/sandbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";

type SandboxConfigFormProps = {
	config: SandboxConfig;
	setConfig: (config: SandboxConfig) => void;
	description?: string;
};

export function SandboxConfigForm({
	config,
	setConfig,
	description = "Create a sandbox for code execution, file management, terminal commands, and git operations.",
}: SandboxConfigFormProps) {
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">{description}</p>

			<motion.div
				initial={{ opacity: 0, height: 0 }}
				animate={{ opacity: 1, height: "auto" }}
				exit={{ opacity: 0, height: 0 }}
				className="space-y-4"
			>
				<div>
					<span className="mb-1.5 block text-xs font-medium text-foreground">
						Sandbox Type
					</span>
					<div className="grid gap-2 sm:grid-cols-2">
						<button
							type="button"
							onClick={() =>
								setConfig({
									...config,
									persistent: DEFAULT_SANDBOX_CONFIG.persistent,
								})
							}
							className={`flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors ${
								!config.persistent
									? "border-foreground bg-foreground/5"
									: "border-border hover:bg-muted/30"
							}`}
						>
							<Play size={12} className="mt-0.5 shrink-0" />
							<div>
								<p className="text-xs font-medium">Ephemeral</p>
								<p className="text-[11px] text-muted-foreground">
									Created per conversation, auto-deleted when done
								</p>
							</div>
						</button>
						<button
							type="button"
							onClick={() => setConfig({ ...config, persistent: true })}
							className={`flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors ${
								config.persistent
									? "border-foreground bg-foreground/5"
									: "border-border hover:bg-muted/30"
							}`}
						>
							<HardDrive size={12} className="mt-0.5 shrink-0" />
							<div>
								<p className="text-xs font-medium">Persistent</p>
								<p className="text-[11px] text-muted-foreground">
									Maintains state across conversations
								</p>
							</div>
						</button>
					</div>
				</div>

				<div>
					<span className="mb-1.5 block text-xs font-medium text-foreground">
						Resource Tier
					</span>
					<Select
						value={config.resourceTier}
						onValueChange={(value) =>
							setConfig({
								...config,
								resourceTier: value as SandboxConfig["resourceTier"],
							})
						}
					>
						<SelectTrigger className="max-w-sm text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="basic">
								<Cpu size={10} />
								Basic - 1 CPU, 1 GB RAM, 3 GB Disk
							</SelectItem>
							<SelectItem value="standard">
								<Cpu size={10} />
								Standard - 2 CPU, 4 GB RAM, 8 GB Disk
							</SelectItem>
							<SelectItem value="performance">
								<Cpu size={10} />
								Performance - 4 CPU, 8 GB RAM, 10 GB Disk
							</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div>
					<span className="mb-1.5 block text-xs font-medium text-foreground">
						Default Language
					</span>
					<Select
						value={config.defaultLanguage}
						onValueChange={(value) =>
							setConfig({ ...config, defaultLanguage: value })
						}
					>
						<SelectTrigger className="max-w-sm text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="python">Python</SelectItem>
							<SelectItem value="javascript">JavaScript</SelectItem>
							<SelectItem value="typescript">TypeScript</SelectItem>
							<SelectItem value="bash">Bash</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</motion.div>
		</div>
	);
}
