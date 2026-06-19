import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { StreamPart } from "./use-chat-stream";

export type SandboxTab = "files" | "terminal" | "git" | "agents";

interface SandboxPanelState {
	/** Whether the panel is open. */
	panelOpen: boolean;
	/** Current active tab. */
	activeTab: SandboxTab;
	/** The Daytona sandbox ID for API calls. */
	sandboxId: string | null;
	/** Incremented whenever the sandbox changes so panel children can remount. */
	reloadKey: number;
	/** Currently open file paths (tabs in the file viewer). */
	openFiles: string[];
	/** Which open file is active. */
	activeFile: string | null;
	/** Current directory the file explorer is viewing. */
	currentDir: string;
	/** Live stream parts for the active conversation — drives the Agents tab. */
	agentParts: StreamPart[];
	/** Whether the active conversation is streaming (Agents tab statuses). */
	agentIsStreaming: boolean;

	togglePanel: () => void;
	setActiveTab: (tab: SandboxTab) => void;
	/** Open the panel directly on the Agents tab (composer toggle). */
	openAgentsTab: () => void;
	openFile: (path: string) => void;
	closeFile: (path: string) => void;
	setActiveFile: (path: string | null) => void;
	navigateTo: (dir: string) => void;
}

const SandboxPanelContext = createContext<SandboxPanelState | null>(null);

export function SandboxPanelProvider({
	sandboxId,
	agentParts = [],
	agentIsStreaming = false,
	children,
}: {
	sandboxId: string | null;
	agentParts?: StreamPart[];
	agentIsStreaming?: boolean;
	children: React.ReactNode;
}) {
	const [panelOpen, setPanelOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<SandboxTab>("files");
	const [openFiles, setOpenFiles] = useState<string[]>([]);
	const [activeFile, setActiveFile] = useState<string | null>(null);
	const [currentDir, setCurrentDir] = useState("/home/daytona");
	const [reloadKey, setReloadKey] = useState(0);
	const previousSandboxIdRef = useRef(sandboxId);

	useEffect(() => {
		if (previousSandboxIdRef.current === sandboxId) return;
		previousSandboxIdRef.current = sandboxId;
		setActiveTab("files");
		setOpenFiles([]);
		setActiveFile(null);
		setCurrentDir("/home/daytona");
		setReloadKey((key) => key + 1);
	}, [sandboxId]);

	const togglePanel = useCallback(() => setPanelOpen((o) => !o), []);

	const openFile = useCallback((path: string) => {
		setPanelOpen(true);
		setActiveTab("files");
		setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
		setActiveFile(path);
	}, []);

	const closeFile = useCallback(
		(path: string) => {
			setOpenFiles((prev) => {
				const next = prev.filter((p) => p !== path);
				if (activeFile === path) {
					setActiveFile(next.length > 0 ? next[next.length - 1] : null);
				}
				return next;
			});
		},
		[activeFile],
	);

	const navigateTo = useCallback((dir: string) => {
		setPanelOpen(true);
		setActiveTab("files");
		setCurrentDir(dir);
	}, []);

	const openAgentsTab = useCallback(() => {
		setPanelOpen(true);
		setActiveTab("agents");
	}, []);

	const value = useMemo(
		() => ({
			panelOpen,
			activeTab,
			sandboxId,
			reloadKey,
			openFiles,
			activeFile,
			currentDir,
			agentParts,
			agentIsStreaming,
			togglePanel,
			setActiveTab,
			openAgentsTab,
			openFile,
			closeFile,
			setActiveFile,
			navigateTo,
		}),
		[
			panelOpen,
			activeTab,
			sandboxId,
			reloadKey,
			openFiles,
			activeFile,
			currentDir,
			agentParts,
			agentIsStreaming,
			togglePanel,
			openAgentsTab,
			openFile,
			closeFile,
			navigateTo,
		],
	);

	return (
		<SandboxPanelContext.Provider value={value}>
			{children}
		</SandboxPanelContext.Provider>
	);
}

export function useSandboxPanel() {
	return useContext(SandboxPanelContext);
}
