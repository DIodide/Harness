// Harness ACP shim — runs INSIDE a Daytona sandbox.
//
// Spawns an ACP agent (codex-acp, claude-agent-acp, ...) as a child process
// and bridges its stdio JSON-RPC stream to HTTP so the Harness FastAPI
// backend can talk to it through the sandbox preview URL:
//
//   GET  /healthz          → { ok, agentRunning, seq }
//   GET  /events?since=N   → SSE stream of agent stdout lines (id = seq),
//                            replaying the in-memory buffer from N first.
//   POST /stdin            → body is one JSON-RPC message, written as a
//                            single ndjson line to the agent's stdin.
//
// MCP relay (Daytona sandboxes have restricted egress, so MCP traffic is
// tunneled out through the backend, which also keeps MCP auth tokens out
// of the sandbox entirely):
//   ANY  /mcp/<n>          → agent-facing MCP endpoint (no shim token —
//                            the agent is a localhost caller). The request
//                            is emitted as a `relay_request` SSE event and
//                            held until the backend posts the answer.
//   POST /relay-response   → backend delivers {reqId, status, headers,
//                            bodyB64} for a held /mcp request.
//
// Zero npm dependencies — Node stdlib only, so it can be uploaded and run
// on any image with node installed. Configured via environment:
//   SHIM_PORT   listen port (default 8787)
//   SHIM_TOKEN  required x-shim-token header value ("" disables the check)
//   AGENT_CMD   JSON array, e.g. ["/usr/local/bin/codex-acp"]
import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";

const PORT = Number.parseInt(process.env.SHIM_PORT || "8787", 10);
const TOKEN = process.env.SHIM_TOKEN || "";
const AGENT_CMD = JSON.parse(process.env.AGENT_CMD || "[]");
if (!Array.isArray(AGENT_CMD) || AGENT_CMD.length === 0) {
	console.error("AGENT_CMD must be a non-empty JSON array");
	process.exit(1);
}

let seq = 0;
const MAX_BUFFER = 20000;
const buffer = []; // { id, event, data }
const clients = new Set();
// Highest event id ever evicted from the replay buffer. A reconnect asking
// for older events gets a `gap` event first — silent loss would leave the
// backend waiting forever on JSON-RPC responses it can never receive.
let evictedThrough = 0;

function writeEvent(res, entry) {
	const data = entry.data.split("\n").join("\ndata: ");
	res.write(`id: ${entry.id}\nevent: ${entry.event}\ndata: ${data}\n\n`);
}

function push(event, data) {
	const entry = { id: ++seq, event, data };
	buffer.push(entry);
	if (buffer.length > MAX_BUFFER) {
		const evicted = buffer.splice(0, buffer.length - MAX_BUFFER);
		evictedThrough = evicted[evicted.length - 1].id;
	}
	for (const res of clients) {
		try {
			writeEvent(res, entry);
		} catch {
			clients.delete(res);
		}
	}
}

const child = spawn(AGENT_CMD[0], AGENT_CMD.slice(1), {
	stdio: ["pipe", "pipe", "pipe"],
	env: process.env,
});
// exitCode stays null for signal-killed children (only signalCode is set),
// so track liveness with an explicit flag instead of `exitCode === null` —
// a SIGKILLed agent must not report as running.
let agentExited = false;
child.on("error", (err) => {
	agentExited = true;
	push("spawn_error", String(err));
});
child.on("exit", (code, signal) => {
	agentExited = true;
	push("exit", JSON.stringify({ code, signal }));
});
readline.createInterface({ input: child.stdout }).on("line", (l) => push("line", l));
readline.createInterface({ input: child.stderr }).on("line", (l) => push("stderr", l));

// ── MCP relay state ──
let relaySeq = 0;
const RELAY_TIMEOUT_MS = 120000;
const relayPending = new Map(); // reqId -> { res, timer }

function handleMcpRequest(req, res, url) {
	if (req.method !== "POST" && req.method !== "DELETE") {
		// Streamable-HTTP GET listen-streams can't be relayed in buffered
		// mode; clients treat 405 as "no server-push stream available".
		res.writeHead(405, { allow: "POST, DELETE" });
		res.end();
		return;
	}
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", () => {
		const reqId = ++relaySeq;
		const timer = setTimeout(() => {
			relayPending.delete(reqId);
			res.writeHead(504, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "relay timeout" }));
		}, RELAY_TIMEOUT_MS);
		relayPending.set(reqId, { res, timer });
		push(
			"relay_request",
			JSON.stringify({
				reqId,
				path: url.pathname,
				method: req.method,
				headers: {
					"content-type": req.headers["content-type"],
					accept: req.headers.accept,
					"mcp-session-id": req.headers["mcp-session-id"],
					"mcp-protocol-version": req.headers["mcp-protocol-version"],
				},
				bodyB64: Buffer.concat(chunks).toString("base64"),
			}),
		);
	});
}

function handleRelayResponse(req, res) {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", () => {
		try {
			const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			const pending = relayPending.get(payload.reqId);
			if (!pending) {
				res.writeHead(404);
				res.end();
				return;
			}
			relayPending.delete(payload.reqId);
			clearTimeout(pending.timer);
			pending.res.writeHead(payload.status || 200, payload.headers || {});
			pending.res.end(Buffer.from(payload.bodyB64 || "", "base64"));
			res.writeHead(204);
			res.end();
		} catch (err) {
			res.writeHead(400);
			res.end(String(err));
		}
	});
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	// Agent-facing MCP endpoints: localhost caller, no shim token.
	if (url.pathname.startsWith("/mcp/")) {
		handleMcpRequest(req, res, url);
		return;
	}
	if (TOKEN && req.headers["x-shim-token"] !== TOKEN) {
		res.writeHead(401);
		res.end("unauthorized");
		return;
	}
	if (req.method === "POST" && url.pathname === "/relay-response") {
		handleRelayResponse(req, res);
		return;
	}

	if (req.method === "GET" && url.pathname === "/healthz") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, agentRunning: !agentExited, seq }));
		return;
	}

	if (req.method === "GET" && url.pathname === "/events") {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		});
		res.write(":connected\n\n");
		const since = Number.parseInt(url.searchParams.get("since") || "0", 10);
		if (since < evictedThrough) {
			// Events the client never saw were evicted — it must resync
			// (revive) rather than silently miss JSON-RPC responses. The
			// event id advances the client's cursor past the eviction
			// boundary so a reconnect doesn't re-trigger the gap forever.
			writeEvent(res, {
				id: evictedThrough,
				event: "gap",
				data: JSON.stringify({ evictedThrough }),
			});
		}
		for (const entry of buffer) {
			if (entry.id > since) writeEvent(res, entry);
		}
		clients.add(res);
		const heartbeat = setInterval(() => {
			try {
				res.write(":hb\n\n");
			} catch {
				clearInterval(heartbeat);
				clients.delete(res);
			}
		}, 15000);
		req.on("close", () => {
			clearInterval(heartbeat);
			clients.delete(res);
		});
		return;
	}

	if (req.method === "POST" && url.pathname === "/stdin") {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			if (agentExited) {
				res.writeHead(409, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: "agent exited",
						code: child.exitCode,
						signal: child.signalCode,
					}),
				);
				return;
			}
			try {
				child.stdin.write(`${body.trimEnd()}\n`);
				res.writeHead(204);
				res.end();
			} catch (err) {
				res.writeHead(500);
				res.end(String(err));
			}
		});
		return;
	}

	res.writeHead(404);
	res.end();
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`acp-shim listening on ${PORT}, agent: ${AGENT_CMD.join(" ")}`);
});
