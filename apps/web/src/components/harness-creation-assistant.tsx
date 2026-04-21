import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import {
	ArrowRight,
	Box,
	FileText,
	Lock,
	Paperclip,
	ThumbsDown,
	ThumbsUp,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { env } from "../env";
import { PRESET_MCPS, presetIdsToServerEntries } from "../lib/mcp";
import { MODELS } from "../lib/models";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

const FASTAPI_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";
const CONTEXT_MAX_CHARS = 8000;

const INITIAL_MESSAGE =
	"Hi! I'll help you set up a harness. What would you like it to help you with?";

interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
}

interface SkillSuggestion {
	id: string;
	fullId: string;
	description: string;
	installs: number;
}

interface HarnessConfigPreview {
	name: string;
	model: string;
	mcpIds: string[];
	skillIds: string[];
	sandboxEnabled: boolean;
	sandboxLanguage: string;
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function stripConfigBlock(content: string): string {
	return content
		.replace(/<harness-config>[\s\S]*?<\/harness-config>/, "")
		.replace(/<harness-config>[\s\S]*$/, "") // strip partial block during streaming
		.trim();
}

export function HarnessCreationAssistant({ open, onOpenChange }: Props) {
	const navigate = useNavigate();
	const { getToken } = useAuth();
	const convex = useConvex();

	const [messages, setMessages] = useState<ChatMessage[]>([
		{ id: "init", role: "assistant", content: INITIAL_MESSAGE },
	]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	const [harnessConfig, setHarnessConfig] =
		useState<HarnessConfigPreview | null>(null);
	const [editedConfig, setEditedConfig] = useState<HarnessConfigPreview>({
		name: "",
		model: "claude-sonnet-4",
		mcpIds: [],
		skillIds: [],
		sandboxEnabled: false,
		sandboxLanguage: "python",
	});
	const [availableSkills, setAvailableSkills] = useState<SkillSuggestion[]>([]);
	const [similarHarness, setSimilarHarness] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [configRating, setConfigRating] = useState<"up" | "down" | null>(null);

	// Context pane state
	const [showContextPane, setShowContextPane] = useState(false);
	const [pastedContext, setPastedContext] = useState("");
	const [contextFileName, setContextFileName] = useState<string | null>(null);

	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const { data: existingHarnesses } = useQuery(
		convexQuery(api.harnesses.list, {}),
	);

	const createConversation = useMutation({
		mutationFn: useConvexMutation(api.conversations.create),
	});
	const sendMessage = useMutation({
		mutationFn: useConvexMutation(api.messages.send),
	});
	const createHarness = useMutation({
		mutationFn: useConvexMutation(api.harnesses.create),
	});
	const rateConfig = useMutation({
		mutationFn: useConvexMutation(api.harnessConfigRatings.rate),
	});

	// Scroll to bottom when messages change
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs on new messages and streaming content
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamingContent]);

	// Focus input when dialog opens
	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [open]);

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const allowedTypes = ["text/plain", "text/markdown", "application/json"];
		const allowedExtensions = [".txt", ".md", ".json"];
		const hasAllowedExtension = allowedExtensions.some((ext) =>
			file.name.toLowerCase().endsWith(ext),
		);

		if (!allowedTypes.includes(file.type) && !hasAllowedExtension) {
			toast.error("Only .txt, .md, and .json files are supported.");
			e.target.value = "";
			return;
		}

		const reader = new FileReader();
		reader.onload = (event) => {
			const content = event.target?.result as string;
			if (content.length > CONTEXT_MAX_CHARS) {
				setPastedContext(content.slice(0, CONTEXT_MAX_CHARS));
				toast("File was truncated to 8,000 characters.");
			} else {
				setPastedContext(content);
			}
			setContextFileName(file.name);
			setShowContextPane(true);
		};
		reader.readAsText(file);
		e.target.value = "";
	};

	const handleClearContext = () => {
		setPastedContext("");
		setContextFileName(null);
		setShowContextPane(false);
	};

	const handleSend = async () => {
		if (!input.trim() || isStreaming) return;
		const userText = input.trim();
		setInput("");

		const updatedMessages: ChatMessage[] = [
			...messages,
			{ id: `user-${Date.now()}`, role: "user", content: userText },
		];
		setMessages(updatedMessages);
		setIsStreaming(true);
		setStreamingContent("");

		// Capture context for this send, then clear it
		const contextForThisSend = pastedContext.trim() || null;
		if (contextForThisSend) {
			handleClearContext();
		}

		// On first user message, fetch relevant skills from Convex
		let skillsForThisSend = availableSkills;
		if (availableSkills.length === 0) {
			try {
				const fetched = await convex.query(
					api.skills.searchForCreationAssistant,
					{ query: userText, limit: 20 },
				);
				skillsForThisSend = fetched;
				setAvailableSkills(fetched);
			} catch {
				// Non-fatal — proceed without skills
			}
		}

		try {
			// Stream suggestion from FastAPI
			const token = await getToken();
			const response = await fetch(
				`${FASTAPI_URL}/api/harness/suggest/stream`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify({
						messages: updatedMessages.map((m) => ({
							role: m.role,
							content: m.content,
						})),
						context: contextForThisSend,
						available_skills:
							skillsForThisSend.length > 0 ? skillsForThisSend : null,
					}),
				},
			);

			if (!response.ok || !response.body) {
				throw new Error(`Request failed: ${response.status}`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let currentEvent = "";
			let fullContent = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("event: ")) {
						currentEvent = line.slice(7).trim();
						continue;
					}
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6));
							if (currentEvent === "token" && data.content) {
								fullContent += data.content;
								setStreamingContent(fullContent);
							}
						} catch {
							// skip malformed chunks
						}
						currentEvent = "";
					}
				}
			}

			// Extract <harness-config> block from complete response
			const configMatch = fullContent.match(
				/<harness-config>([\s\S]*?)<\/harness-config>/,
			);
			let displayContent = stripConfigBlock(fullContent);

			if (configMatch) {
				try {
					const config = JSON.parse(
						configMatch[1].trim(),
					) as HarnessConfigPreview;

					const validMcpIds = new Set(PRESET_MCPS.map((p) => p.id));
					const filteredMcpIds = (config.mcpIds ?? []).filter((id) =>
						validMcpIds.has(id),
					);
					if (filteredMcpIds.length < (config.mcpIds ?? []).length) {
						toast(
							"Some suggested integrations aren't available and were removed.",
						);
					}

					const validSkillIds = new Set(skillsForThisSend.map((s) => s.id));
					const filteredSkillIds = (config.skillIds ?? []).filter((id) =>
						validSkillIds.has(id),
					);

					const validated: HarnessConfigPreview = {
						...config,
						mcpIds: filteredMcpIds,
						skillIds: filteredSkillIds,
						sandboxEnabled: config.sandboxEnabled ?? false,
						sandboxLanguage: config.sandboxLanguage ?? "python",
					};
					setHarnessConfig(validated);
					setEditedConfig(validated);
				} catch {
					// Config block was malformed — show the full response as-is
					displayContent = fullContent;
				}
			}

			setMessages((prev) => [
				...prev,
				{
					id: `asst-${Date.now()}`,
					role: "assistant",
					content: displayContent,
				},
			]);
		} catch {
			toast.error("Something went wrong. Please try again.");
			setMessages((prev) => [
				...prev,
				{
					id: `asst-err-${Date.now()}`,
					role: "assistant",
					content: "Sorry, I ran into an error. Please try again.",
				},
			]);
		} finally {
			setIsStreaming(false);
			setStreamingContent("");
		}
	};

	const handleCreate = async (skipDuplicateCheck = false) => {
		if (!skipDuplicateCheck) {
			const configUrls = new Set(
				presetIdsToServerEntries(editedConfig.mcpIds).map((s) => s.url),
			);
			const configSkillNames = new Set(
				editedConfig.skillIds
					.map((id) => availableSkills.find((s) => s.id === id)?.fullId)
					.filter((n): n is string => n !== undefined),
			);

			const match = (existingHarnesses ?? []).find((h) => {
				// Model must match
				if (h.model !== editedConfig.model) return false;

				// MCPs must match (compare by server URL)
				const harnessUrls = new Set(h.mcpServers.map((s) => s.url));
				if (harnessUrls.size !== configUrls.size) return false;
				for (const url of configUrls) {
					if (!harnessUrls.has(url)) return false;
				}

				// Skills must match (compare by fullId / name)
				const harnessSkillNames = new Set(h.skills.map((s) => s.name));
				if (harnessSkillNames.size !== configSkillNames.size) return false;
				for (const name of configSkillNames) {
					if (!harnessSkillNames.has(name)) return false;
				}

				// Sandbox must match
				const harnessSandboxEnabled = h.sandboxEnabled ?? false;
				if (harnessSandboxEnabled !== editedConfig.sandboxEnabled) return false;
				if (
					editedConfig.sandboxEnabled &&
					h.sandboxConfig?.defaultLanguage !== editedConfig.sandboxLanguage
				) {
					return false;
				}

				return true;
			});
			if (match) {
				setSimilarHarness({ id: match._id, name: match.name });
				return;
			}
		}

		const mcpServers = presetIdsToServerEntries(editedConfig.mcpIds);
		const skills = editedConfig.skillIds
			.map((id) => {
				const skill = availableSkills.find((s) => s.id === id);
				return skill
					? { name: skill.fullId, description: skill.description }
					: null;
			})
			.filter((s): s is { name: string; description: string } => s !== null);

		try {
			const harnessId = await createHarness.mutateAsync({
				name: editedConfig.name,
				model: editedConfig.model,
				status: "started",
				mcpServers,
				skills,
				sandboxEnabled: editedConfig.sandboxEnabled || undefined,
				sandboxConfig: editedConfig.sandboxEnabled
					? {
							persistent: false,
							autoStart: true,
							defaultLanguage: editedConfig.sandboxLanguage,
							resourceTier: "basic",
						}
					: undefined,
			});

			// Save conversation + all messages now that a harness was created
			const convoId = await createConversation.mutateAsync({
				title: "Harness Setup",
				harnessId,
			});
			for (const msg of messages) {
				await sendMessage.mutateAsync({
					conversationId: convoId,
					role: msg.role,
					content: msg.content,
				});
			}

			onOpenChange(false);
			navigate({ to: "/chat", search: { harnessId: harnessId as string } });
		} catch {
			toast.error("Failed to create harness. Please try again.");
		}
	};

	const handleEditManually = () => {
		const skillsForPrefill = editedConfig.skillIds
			.map((id) => {
				const skill = availableSkills.find((s) => s.id === id);
				return skill
					? { name: skill.fullId, description: skill.description }
					: null;
			})
			.filter((s): s is { name: string; description: string } => s !== null);

		sessionStorage.setItem(
			"harness-prefill",
			JSON.stringify({
				name: editedConfig.name,
				model: editedConfig.model,
				selectedPresetMcps: editedConfig.mcpIds,
				skills: skillsForPrefill,
				sandboxEnabled: editedConfig.sandboxEnabled,
				sandboxLanguage: editedConfig.sandboxLanguage,
			}),
		);
		onOpenChange(false);
		navigate({ to: "/onboarding" });
	};

	const handleRate = async (rating: "up" | "down") => {
		if (!harnessConfig || configRating !== null) return;
		setConfigRating(rating);
		try {
			await rateConfig.mutateAsync({
				rating,
				configSnapshot: {
					name: harnessConfig.name,
					model: harnessConfig.model,
					mcpIds: harnessConfig.mcpIds,
				},
				conversationSnapshot: messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
			});
		} catch {
			setConfigRating(null);
			toast.error("Failed to save rating.");
		}
	};

	const handleToggleMcp = (id: string) => {
		setSimilarHarness(null);
		setEditedConfig((prev) => ({
			...prev,
			mcpIds: prev.mcpIds.includes(id)
				? prev.mcpIds.filter((m) => m !== id)
				: [...prev.mcpIds, id],
		}));
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setMessages([
				{ id: "init", role: "assistant", content: INITIAL_MESSAGE },
			]);
			setInput("");
			setIsStreaming(false);
			setStreamingContent("");
			setHarnessConfig(null);
			setEditedConfig({
				name: "",
				model: "claude-sonnet-4",
				mcpIds: [],
				skillIds: [],
				sandboxEnabled: false,
				sandboxLanguage: "python",
			});
			setAvailableSkills([]);
			setSimilarHarness(null);
			setConfigRating(null);
			setPastedContext("");
			setContextFileName(null);
			setShowContextPane(false);
		}
		onOpenChange(nextOpen);
	};

	const authRequiredMcps = editedConfig.mcpIds.filter((id) => {
		const preset = PRESET_MCPS.find((p) => p.id === id);
		return preset && preset.server.authType !== "none";
	});

	const contextCharCount = pastedContext.length;
	const contextOverLimit = contextCharCount > CONTEXT_MAX_CHARS;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
				<DialogHeader className="shrink-0 border-b px-5 py-4">
					<DialogTitle className="text-sm font-medium">
						Create with AI
					</DialogTitle>
				</DialogHeader>

				{/* Message list */}
				<div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
					{messages.map((msg) => (
						<div
							key={msg.id}
							className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
						>
							<div
								className={`max-w-[85%] rounded px-3 py-2 text-sm leading-relaxed ${
									msg.role === "user"
										? "bg-foreground text-background"
										: "bg-muted text-foreground"
								}`}
							>
								{msg.content}
							</div>
						</div>
					))}

					{/* Streaming response */}
					{isStreaming && (
						<div className="flex justify-start">
							<div className="max-w-[85%] rounded bg-muted px-3 py-2 text-sm text-foreground leading-relaxed">
								{streamingContent ? (
									stripConfigBlock(streamingContent) || (
										<span className="text-muted-foreground">…</span>
									)
								) : (
									<span className="text-muted-foreground text-xs">
										Thinking…
									</span>
								)}
							</div>
						</div>
					)}

					<div ref={messagesEndRef} />
				</div>

				{/* Config preview (shown after AI produces a config) */}
				{harnessConfig && (
					<div className="shrink-0 border-t bg-background p-4 space-y-3">
						<p className="text-xs font-medium text-foreground">
							Review your harness
						</p>

						<div className="space-y-2">
							{/* Name */}
							<div className="space-y-1">
								<label
									htmlFor="creation-name"
									className="text-[11px] text-muted-foreground"
								>
									Name
								</label>
								<Input
									id="creation-name"
									value={editedConfig.name}
									onChange={(e) =>
										setEditedConfig((p) => ({ ...p, name: e.target.value }))
									}
									className="h-7 text-xs"
								/>
							</div>

							{/* Model */}
							<div className="space-y-1">
								<p className="text-[11px] text-muted-foreground">Model</p>
								<Select
									value={editedConfig.model}
									onValueChange={(v) =>
										setEditedConfig((p) => ({ ...p, model: v }))
									}
								>
									<SelectTrigger className="h-7 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{MODELS.map((m) => (
											<SelectItem
												key={m.value}
												value={m.value}
												className="text-xs"
											>
												{m.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{/* MCP chips */}
							{editedConfig.mcpIds.length > 0 && (
								<div className="space-y-1">
									<p className="text-[11px] text-muted-foreground">
										Integrations
									</p>
									<div className="flex flex-wrap gap-1.5">
										{editedConfig.mcpIds.map((id) => {
											const preset = PRESET_MCPS.find((p) => p.id === id);
											if (!preset) return null;
											const needsAuth = preset.server.authType !== "none";
											return (
												<Badge
													key={id}
													variant="outline"
													className="flex items-center gap-1 pr-1 text-xs"
												>
													{needsAuth && (
														<Lock
															size={9}
															className="shrink-0 text-muted-foreground"
														/>
													)}
													{preset.server.name}
													<button
														type="button"
														onClick={() => handleToggleMcp(id)}
														className="ml-0.5 text-muted-foreground hover:text-foreground"
													>
														<X size={9} />
													</button>
												</Badge>
											);
										})}
									</div>
									{authRequiredMcps.length > 0 && (
										<p className="text-[10px] text-muted-foreground">
											Integrations with <Lock size={8} className="inline" />{" "}
											require sign-in after creation.
										</p>
									)}
								</div>
							)}
						</div>

						{/* Skills chips */}
						{editedConfig.skillIds.length > 0 && (
							<div className="space-y-1">
								<p className="text-[11px] text-muted-foreground">Skills</p>
								<div className="flex flex-wrap gap-1.5">
									{editedConfig.skillIds.map((id) => {
										const skill = availableSkills.find((s) => s.id === id);
										return (
											<Badge
												key={id}
												variant="outline"
												className="flex items-center gap-1 pr-1 text-xs"
												title={skill?.description ?? id}
											>
												{id}
												<button
													type="button"
													onClick={() =>
														setEditedConfig((prev) => ({
															...prev,
															skillIds: prev.skillIds.filter((s) => s !== id),
														}))
													}
													className="ml-0.5 text-muted-foreground hover:text-foreground"
												>
													<X size={9} />
												</button>
											</Badge>
										);
									})}
								</div>
							</div>
						)}

						{/* Sandbox */}
						<div className="space-y-1.5">
							<p className="text-[11px] text-muted-foreground">Sandbox</p>
							<button
								type="button"
								onClick={() =>
									setEditedConfig((p) => ({
										...p,
										sandboxEnabled: !p.sandboxEnabled,
									}))
								}
								className={`flex w-full items-center gap-2.5 border px-2.5 py-2 text-left transition-colors ${
									editedConfig.sandboxEnabled
										? "border-foreground/40 bg-foreground/5"
										: "border-border hover:border-foreground/20"
								}`}
							>
								<Box
									size={12}
									className={
										editedConfig.sandboxEnabled
											? "shrink-0 text-foreground"
											: "shrink-0 text-muted-foreground"
									}
								/>
								<div className="flex-1">
									<p className="text-[11px] font-medium text-foreground">
										{editedConfig.sandboxEnabled
											? "Sandbox enabled"
											: "No sandbox"}
									</p>
									<p className="text-[10px] text-muted-foreground">
										{editedConfig.sandboxEnabled
											? "Isolated environment for code execution and file operations"
											: "Chat only — no code execution environment"}
									</p>
								</div>
							</button>
							{editedConfig.sandboxEnabled && (
								<Select
									value={editedConfig.sandboxLanguage}
									onValueChange={(v) =>
										setEditedConfig((p) => ({ ...p, sandboxLanguage: v }))
									}
								>
									<SelectTrigger className="h-7 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="python" className="text-xs">
											Python
										</SelectItem>
										<SelectItem value="javascript" className="text-xs">
											JavaScript
										</SelectItem>
										<SelectItem value="typescript" className="text-xs">
											TypeScript
										</SelectItem>
									</SelectContent>
								</Select>
							)}
						</div>

						{/* Config rating */}
						<div className="flex items-center justify-between pt-1">
							<p className="text-[10px] text-muted-foreground">
								Was this suggestion helpful?
							</p>
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => handleRate("up")}
									disabled={configRating !== null}
									className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
										configRating === "up"
											? "text-green-600"
											: configRating !== null
												? "cursor-default text-muted-foreground/40"
												: "text-muted-foreground hover:text-green-600"
									}`}
									title="Good suggestion"
								>
									<ThumbsUp size={12} />
								</button>
								<button
									type="button"
									onClick={() => handleRate("down")}
									disabled={configRating !== null}
									className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
										configRating === "down"
											? "text-red-500"
											: configRating !== null
												? "cursor-default text-muted-foreground/40"
												: "text-muted-foreground hover:text-red-500"
									}`}
									title="Bad suggestion"
								>
									<ThumbsDown size={12} />
								</button>
							</div>
						</div>

						{/* Duplicate harness warning */}
						{similarHarness && (
							<div className="rounded border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 p-2.5 space-y-2">
								<p className="text-xs text-yellow-800 dark:text-yellow-200">
									You already have a similar harness:{" "}
									<span className="font-medium">{similarHarness.name}</span>
								</p>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											onOpenChange(false);
											navigate({
												to: "/chat",
												search: { harnessId: similarHarness.id },
											});
										}}
										className="flex-1 text-xs"
									>
										Go to existing
									</Button>
									<Button
										size="sm"
										onClick={() => handleCreate(true)}
										disabled={
											createHarness.isPending || !editedConfig.name.trim()
										}
										className="flex-1 text-xs"
									>
										{createHarness.isPending ? "Creating…" : "Create anyway"}
									</Button>
								</div>
							</div>
						)}

						{/* Action buttons */}
						{!similarHarness && (
							<div className="flex gap-2 pt-1">
								<Button
									size="sm"
									onClick={() => handleCreate()}
									disabled={
										!editedConfig.name.trim() || createHarness.isPending
									}
									className="flex-1 text-xs"
								>
									{createHarness.isPending ? "Creating…" : "Create Harness"}
									{!createHarness.isPending && <ArrowRight size={12} />}
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={handleEditManually}
									className="text-xs"
								>
									Edit manually
								</Button>
							</div>
						)}
					</div>
				)}

				{/* Context pane */}
				{showContextPane && (
					<div className="shrink-0 border-t bg-muted/30 p-3 space-y-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-1.5">
								<FileText size={11} className="text-muted-foreground" />
								<span className="text-[11px] font-medium text-foreground">
									{contextFileName ? contextFileName : "Context"}
								</span>
								<span
									className={`text-[10px] ${contextOverLimit ? "text-destructive" : "text-muted-foreground"}`}
								>
									{contextCharCount}/{CONTEXT_MAX_CHARS}
								</span>
							</div>
							<button
								type="button"
								onClick={handleClearContext}
								className="text-muted-foreground hover:text-foreground"
							>
								<X size={11} />
							</button>
						</div>
						<Textarea
							value={pastedContext}
							onChange={(e) => {
								setPastedContext(e.target.value);
								if (contextFileName) setContextFileName(null);
							}}
							placeholder="Paste a document, job description, README, or any relevant context…"
							className="min-h-[80px] max-h-[160px] resize-none text-xs"
						/>
					</div>
				)}

				{/* Hidden file input */}
				<input
					ref={fileInputRef}
					type="file"
					accept=".txt,.md,.json"
					className="hidden"
					onChange={handleFileUpload}
				/>

				{/* Input bar */}
				<div className="shrink-0 border-t p-3">
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => {
								if (showContextPane) {
									handleClearContext();
								} else {
									setShowContextPane(true);
									setTimeout(() => inputRef.current?.focus(), 50);
								}
							}}
							className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border text-muted-foreground transition-colors hover:text-foreground ${
								showContextPane
									? "border-foreground/30 bg-muted text-foreground"
									: "border-transparent"
							}`}
							title={showContextPane ? "Hide context" : "Add context"}
						>
							<Paperclip size={13} />
						</button>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground transition-colors hover:text-foreground"
							title="Upload a file"
						>
							<FileText size={13} />
						</button>
						<Input
							ref={inputRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSend();
								}
							}}
							placeholder={
								harnessConfig
									? "Refine your harness…"
									: "Describe what you want…"
							}
							className="h-8 text-xs"
							disabled={isStreaming}
						/>
						<Button
							size="sm"
							onClick={handleSend}
							disabled={!input.trim() || isStreaming || contextOverLimit}
							className="h-8 px-3 text-xs"
						>
							Send
						</Button>
					</div>
					{pastedContext && !showContextPane && (
						<div className="mt-1.5 flex items-center gap-1">
							<FileText size={10} className="text-muted-foreground" />
							<span className="text-[10px] text-muted-foreground">
								Context attached
							</span>
							<button
								type="button"
								onClick={handleClearContext}
								className="text-[10px] text-muted-foreground underline hover:text-foreground"
							>
								Remove
							</button>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
