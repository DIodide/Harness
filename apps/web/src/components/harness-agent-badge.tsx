import { useAgentCatalog } from "../lib/use-agent-catalog";
import { ClaudeLogo, CursorLogo, OpenAILogo } from "./agent-logos";
import { credentialDisplayName } from "./agent-loop-picker";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const AGENT_LOGOS: Record<
	string,
	(props: { size?: number; className?: string }) => React.ReactNode
> = {
	"claude-code": ClaudeLogo,
	codex: OpenAILogo,
	cursor: CursorLogo,
};

const AGENT_NAMES: Record<string, string> = {
	"claude-code": "Claude Code",
	codex: "Codex CLI",
	cursor: "Cursor",
};

/**
 * Header badge for a harness's agent loop: brand logo + name, with the
 * linked credential in the tooltip. Renders nothing for the default loop.
 */
export function HarnessAgentBadge({
	agent,
	agentCredentialId,
}: {
	agent?: string;
	agentCredentialId?: string;
}) {
	const { data: catalog } = useAgentCatalog();
	if (!agent || agent === "default") return null;
	const entry = catalog?.find((e) => e.id === agent);
	const cred =
		entry?.credentials.find((c) => c.credential_id === agentCredentialId) ??
		entry?.credentials[0];
	const Logo = AGENT_LOGOS[agent];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant="secondary" className="text-[10px]">
					{Logo && <Logo size={9} />}
					{AGENT_NAMES[agent] ?? agent}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				{cred
					? `Runs on your account — ${credentialDisplayName(cred)}`
					: "No credential linked — add one in the harness settings"}
			</TooltipContent>
		</Tooltip>
	);
}
