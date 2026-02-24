import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@harness/backend/convex/_generated/api";
import { env } from "@/env";

const FASTAPI_URL = typeof window !== "undefined"
	? (env.VITE_FASTAPI_URL ?? "http://localhost:8000")
	: "http://localhost:8000";

export function useSendMessage() {
	const [isSending, setIsSending] = useState(false);
	const sendMutation = useMutation(api.messages.send);

	const sendMessage = useCallback(
		async (params: {
			conversationId: string;
			harnessId: string;
			model: string;
			userId: string;
			content: string;
		}) => {
			setIsSending(true);
			try {
				await sendMutation({
					conversationId: params.conversationId as any,
					content: params.content,
				});

				const resp = await fetch(`${FASTAPI_URL}/api/chat/stream`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						conversation_id: params.conversationId,
						harness_id: params.harnessId,
						model: params.model,
						user_id: params.userId,
					}),
				});

				if (!resp.ok) {
					throw new Error(`Chat API error: ${resp.status}`);
				}

				return await resp.json();
			} finally {
				setIsSending(false);
			}
		},
		[sendMutation],
	);

	return { sendMessage, isSending };
}
