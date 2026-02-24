import { api } from "@harness/backend/convex/_generated/api";
import { useQuery } from "convex/react";

export function useHarnesses() {
	const harnesses = useQuery(api.harnesses.list);
	return {
		harnesses: harnesses ?? [],
		isLoading: harnesses === undefined,
	};
}

export function useHarness(id: string | undefined) {
	const harness = useQuery(api.harnesses.get, id ? { id: id as any } : "skip");
	return { harness, isLoading: harness === undefined };
}
