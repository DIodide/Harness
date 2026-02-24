import { useMutation, useQuery } from "convex/react";
import { api } from "@harness/backend/convex/_generated/api";

export function useMcpConnections(userId: string | undefined) {
	const connections = useQuery(
		api.mcpConnections.listByUser,
		userId ? { userId } : "skip",
	);
	const removeConnection = useMutation(api.mcpConnections.remove);

	const isConnected = (serverName: string) =>
		connections?.some((c) => c.serverName === serverName) ?? false;

	return {
		connections: connections ?? [],
		isLoading: connections === undefined,
		isConnected,
		removeConnection,
	};
}
