import { useAuth } from "@clerk/clerk-react";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../../env";
import { useSandboxPanel } from "../../lib/sandbox-panel-context";
import { RoseCurveSpinner } from "../rose-curve-spinner";

const WS_URL = (() => {
	const url = new URL(env.VITE_FASTAPI_URL ?? "http://localhost:8000");
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.origin;
})();

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export function WebTerminal() {
	const panel = useSandboxPanel();
	const { getToken } = useAuth();
	const sandboxId = panel?.sandboxId;

	const termContainerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const [state, setState] = useState<ConnectionState>("disconnected");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const connectingRef = useRef(false);
	const stateRef = useRef(state);
	stateRef.current = state;

	const connect = useCallback(async () => {
		if (!sandboxId || !termContainerRef.current || connectingRef.current)
			return;
		connectingRef.current = true;
		setState("connecting");
		setErrorMsg(null);

		// Lazy-load xterm to keep bundle small
		const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
			import("@xterm/xterm"),
			import("@xterm/addon-fit"),
			import("@xterm/addon-web-links"),
		]);

		// Clean up previous instance
		if (termRef.current) {
			termRef.current.dispose();
			termRef.current = null;
		}
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		// Create terminal
		const term = new Terminal({
			cursorBlink: true,
			cursorStyle: "bar",
			fontSize: 13,
			fontFamily:
				"'Geist Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
			lineHeight: 1.35,
			scrollback: 5000,
			theme: {
				background: "transparent",
				foreground: "#d4d4d8",
				cursor: "#d4d4d8",
				selectionBackground: "#3f3f4640",
				black: "#27272a",
				red: "#f87171",
				green: "#4ade80",
				yellow: "#facc15",
				blue: "#60a5fa",
				magenta: "#c084fc",
				cyan: "#22d3ee",
				white: "#e4e4e7",
				brightBlack: "#52525b",
				brightRed: "#fca5a5",
				brightGreen: "#86efac",
				brightYellow: "#fde68a",
				brightBlue: "#93c5fd",
				brightMagenta: "#d8b4fe",
				brightCyan: "#67e8f9",
				brightWhite: "#fafafa",
			},
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.loadAddon(new WebLinksAddon());

		term.open(termContainerRef.current);
		termRef.current = term;
		fitAddonRef.current = fitAddon;

		// Initial fit
		try {
			fitAddon.fit();
		} catch {
			// Container may not be sized yet
		}

		const { cols, rows } = term;

		// Get auth token
		const token = await getToken();
		if (!token) {
			setState("error");
			setErrorMsg("Authentication required");
			connectingRef.current = false;
			return;
		}

		// Connect WebSocket
		const wsUrl = `${WS_URL}/api/sandbox/${sandboxId}/terminal?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			// Wait for the "connected" message from server
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "connected") {
					setState("connected");
					connectingRef.current = false;
					term.focus();
				} else if (msg.type === "output") {
					term.write(msg.data);
				} else if (msg.type === "exit") {
					term.writeln(
						`\r\n\x1b[90m[Process exited with code ${msg.code ?? "unknown"}]\x1b[0m`,
					);
					setState("disconnected");
				} else if (msg.type === "error") {
					term.writeln(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m`);
					setState("error");
					setErrorMsg(msg.message);
				}
			} catch {
				// Non-JSON message, write raw
				term.write(event.data);
			}
		};

		ws.onerror = () => {
			setState("error");
			setErrorMsg("Connection failed");
			connectingRef.current = false;
		};

		ws.onclose = (event) => {
			if (stateRef.current !== "error") {
				setState("disconnected");
			}
			connectingRef.current = false;
			if (event.code !== 1000) {
				term.writeln(
					`\r\n\x1b[90m[Connection closed: ${event.reason || `code ${event.code}`}]\x1b[0m`,
				);
			}
		};

		// Forward terminal input to WebSocket
		term.onData((data) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "input", data }));
			}
		});

		// Handle terminal resize
		term.onResize(({ cols, rows }) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "resize", cols, rows }));
			}
		});
	}, [sandboxId, getToken]);

	// Auto-connect on mount
	useEffect(() => {
		if (sandboxId && state === "disconnected" && !connectingRef.current) {
			connect();
		}
	}, [sandboxId, state, connect]);

	// Fit terminal on container resize (skip when hidden to avoid 0x0 resize killing processes)
	useEffect(() => {
		const container = termContainerRef.current;
		if (!container) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			// Skip fit when container is hidden (display:none gives 0x0)
			if (width === 0 || height === 0) return;
			try {
				fitAddonRef.current?.fit();
			} catch {
				// Ignore fit errors during transitions
			}
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			wsRef.current?.close();
			termRef.current?.dispose();
		};
	}, []);

	return (
		<div className="flex h-full flex-col">
			{/* Terminal header */}
			<div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2.5">
				<div className="flex items-center gap-1.5">
					<TerminalSquare size={12} className="text-muted-foreground/40" />
					<span className="font-mono text-[10.5px] text-muted-foreground/50">
						{state === "connected"
							? "bash"
							: state === "connecting"
								? "connecting..."
								: state === "error"
									? "error"
									: "disconnected"}
					</span>
					{state === "connecting" && (
						<RoseCurveSpinner size={10} className="text-muted-foreground/40" />
					)}
				</div>
				{(state === "disconnected" || state === "error") && (
					<button
						type="button"
						onClick={connect}
						title="Reconnect"
						className="flex h-5 w-5 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
					>
						<RotateCcw size={11} />
					</button>
				)}
			</div>

			{/* Terminal content */}
			<div className="relative min-h-0 flex-1">
				<div ref={termContainerRef} className="absolute inset-0 p-1.5" />

				{/* Overlay for disconnected/error states */}
				{(state === "disconnected" || state === "error") &&
					!connectingRef.current && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80">
							<TerminalSquare
								size={24}
								strokeWidth={1}
								className="text-muted-foreground/30"
							/>
							{errorMsg ? (
								<span className="font-mono text-[10.5px] text-red-400/60">
									{errorMsg}
								</span>
							) : (
								<span className="font-mono text-[10.5px] text-muted-foreground/30">
									Terminal disconnected
								</span>
							)}
							<button
								type="button"
								onClick={connect}
								className="mt-1 rounded border border-border px-3 py-1 font-mono text-[10.5px] text-muted-foreground/60 transition-colors hover:border-foreground/20 hover:text-muted-foreground"
							>
								Reconnect
							</button>
						</div>
					)}
			</div>
		</div>
	);
}
