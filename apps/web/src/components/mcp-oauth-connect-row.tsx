import { useAuth } from "@clerk/tanstack-react-start";
import { Loader2, Server, Shield } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { env } from "../env";
import type { McpServerEntry } from "../lib/mcp";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";

export function OAuthConnectRow({
	server,
	isConnected,
}: {
	server: McpServerEntry;
	isConnected: boolean;
}) {
	const { getToken } = useAuth();
	const [connecting, setConnecting] = useState(false);

	// Refs so the cleanup effect always sees the latest handler/interval.
	const cleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			cleanupRef.current?.();
		};
	}, []);

	const handleConnect = useCallback(async () => {
		setConnecting(true);
		try {
			const token = await getToken();
			const res = await fetch(
				`${API_URL}/api/mcp/oauth/start?server_url=${encodeURIComponent(server.url)}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			);
			if (!res.ok) throw new Error("Failed to start OAuth");
			const data = await res.json();

			const popup = window.open(
				data.authorization_url,
				"mcp-oauth",
				"width=600,height=700",
			);

			const handler = (event: MessageEvent) => {
				if (event.data?.type === "mcp-oauth-callback") {
					cleanup();
					if (event.data.success) {
						toast.success(`Connected to ${server.name}`);
					} else {
						toast.error(event.data.error || "OAuth connection failed");
					}
					setConnecting(false);
					popup?.close();
				}
			};

			const interval = setInterval(() => {
				if (popup?.closed) {
					cleanup();
					setConnecting(false);
				}
			}, 500);

			const cleanup = () => {
				clearInterval(interval);
				window.removeEventListener("message", handler);
				cleanupRef.current = null;
			};
			cleanupRef.current = cleanup;

			window.addEventListener("message", handler);
		} catch {
			toast.error("Failed to start OAuth flow");
			setConnecting(false);
		}
	}, [getToken, server.url, server.name]);

	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			className="flex items-center gap-3 border border-border px-3 py-2.5"
		>
			<Server size={14} className="shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-foreground">{server.name}</p>
				<p className="truncate text-[11px] text-muted-foreground">
					{server.url}
				</p>
			</div>
			{isConnected ? (
				<Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
					<div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
					Connected
				</Badge>
			) : (
				<Button
					variant="outline"
					size="sm"
					className="shrink-0 text-xs"
					onClick={handleConnect}
					disabled={connecting}
				>
					{connecting ? (
						<Loader2 size={10} className="animate-spin" />
					) : (
						<Shield size={10} />
					)}
					Connect
				</Button>
			)}
		</motion.div>
	);
}
