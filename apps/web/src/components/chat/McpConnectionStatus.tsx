import { ExternalLink, Link2, Link2Off, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { useHarness } from "@/hooks/useHarnesses";
import { useMcpConnections } from "@/hooks/useMcpConnections";

const FASTAPI_URL =
	typeof window !== "undefined"
		? (env.VITE_FASTAPI_URL ?? "http://localhost:8000")
		: "http://localhost:8000";

const SERVER_LABELS: Record<string, string> = {
	notion: "Notion",
	github: "GitHub",
	linear: "Linear",
	"junction-engine": "JunctionEngine",
};

interface McpConnectionStatusProps {
	userId: string;
	harnessId?: string;
}

export function McpConnectionStatus({
	userId,
	harnessId,
}: McpConnectionStatusProps) {
	const { harness } = useHarness(harnessId);
	const { isConnected, removeConnection } = useMcpConnections(userId);

	if (!harness) return null;

	const servers = harness.mcpServers;
	if (servers.length === 0) return null;

	return (
		<div className="space-y-2">
			{servers.map((server) => {
				const connected =
					server.authType === "none" || isConnected(server.name);
				const label = SERVER_LABELS[server.name] ?? server.name;

				return (
					<div
						key={server.name}
						className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-secondary/50 border border-border/50"
					>
						<div className="flex items-center gap-2 min-w-0">
							{connected ? (
								<Link2 className="size-3.5 text-emerald-400 flex-shrink-0" />
							) : (
								<Link2Off className="size-3.5 text-muted-foreground flex-shrink-0" />
							)}
							<span className="text-sm truncate">{label}</span>
							{server.authType === "none" && (
								<Badge variant="outline" className="text-[10px] px-1.5 py-0">
									open
								</Badge>
							)}
						</div>

						{server.authType === "oauth" &&
							(connected ? (
								<Button
									variant="ghost"
									size="icon-xs"
									className="text-muted-foreground hover:text-destructive"
									onClick={() =>
										removeConnection({
											userId,
											serverName: server.name,
										})
									}
								>
									<X className="size-3" />
								</Button>
							) : (
								<Button
									variant="outline"
									size="xs"
									className="text-primary border-primary/30 hover:bg-primary/10"
									onClick={() => {
										window.location.href = `${FASTAPI_URL}/auth/${server.name}/start?user_id=${userId}`;
									}}
								>
									<ExternalLink className="size-3 mr-1" />
									Connect
								</Button>
							))}
					</div>
				);
			})}
		</div>
	);
}
