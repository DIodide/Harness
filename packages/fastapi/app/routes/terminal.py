"""
WebSocket terminal endpoint for interactive PTY sessions.

Proxies between a browser WebSocket and a Daytona PTY session,
enabling real-time terminal interaction with sandboxes.
"""

import asyncio
import json
import logging
import uuid

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.auth import _get_jwks
from app.services.convex import verify_sandbox_owner
from app.services.daytona_service import get_daytona_service

router = APIRouter()
logger = logging.getLogger(__name__)


async def _verify_ws_token(websocket: WebSocket, token: str) -> dict | None:
    """Verify a Clerk JWT from a WebSocket query parameter."""
    try:
        http_client = websocket.app.state.http_client

        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            return None

        unverified_claims = jwt.decode(token, options={"verify_signature": False})
        issuer = unverified_claims.get("iss", "")
        if not issuer:
            return None

        jwks = await _get_jwks(http_client, issuer)
        key = None
        for k in jwks.get("keys", []):
            if k.get("kid") == kid:
                key = jwt.algorithms.RSAAlgorithm.from_jwk(k)
                break

        if key is None:
            return None

        payload = jwt.decode(
            token, key, algorithms=["RS256"], options={"verify_aud": False}
        )
        return payload

    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, Exception) as e:
        logger.warning("WebSocket auth failed: %s", e)
        return None


@router.websocket("/{sandbox_id}/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    sandbox_id: str,
    token: str = Query(...),
    cols: int = Query(default=80),
    rows: int = Query(default=24),
):
    """WebSocket endpoint for interactive terminal sessions.

    Protocol (JSON messages):
        Client → Server:
            { "type": "input", "data": "<string>" }   — keystrokes
            { "type": "resize", "cols": N, "rows": N } — terminal resize

        Server → Client:
            { "type": "output", "data": "<string>" }   — terminal output
            { "type": "connected", "sessionId": "..." } — PTY ready
            { "type": "exit", "code": N }               — PTY exited
            { "type": "error", "message": "..." }       — error
    """
    # Authenticate
    user = await _verify_ws_token(websocket, token)
    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Verify ownership
    user_id = user.get("sub")
    if not await verify_sandbox_owner(sandbox_id, user_id):
        await websocket.close(code=4003, reason="Forbidden")
        return

    await websocket.accept()

    service = get_daytona_service()
    session_id = f"term-{uuid.uuid4().hex[:8]}"
    loop = asyncio.get_running_loop()
    pty_handle = None
    stop_event = asyncio.Event()

    try:
        # Create PTY session (sync SDK call in threadpool)
        from daytona_sdk.common.pty import PtySize

        def _create_pty():
            sandbox = service._ensure_running(sandbox_id)
            handle = sandbox.process.create_pty_session(
                id=session_id,
                cwd="/home/daytona",
                pty_size=PtySize(rows=rows, cols=cols),
            )
            return handle, sandbox

        pty_handle, sandbox = await loop.run_in_executor(None, _create_pty)

        await websocket.send_json({"type": "connected", "sessionId": session_id})

        # Task 1: Read PTY output in a thread → forward to client
        async def forward_pty_to_client():
            """Read from PTY (blocking iterator) in a thread, send to WebSocket."""
            try:

                def _read_loop():
                    """Blocking loop that reads PTY data and pushes to async queue."""
                    results = []
                    try:
                        for data in pty_handle:
                            if stop_event.is_set():
                                break
                            results.append(data)
                            # Use a threadsafe callback to send immediately
                            future = asyncio.run_coroutine_threadsafe(
                                _send_output(data), loop
                            )
                            try:
                                future.result(timeout=5)
                            except Exception:
                                break
                    except Exception as e:
                        logger.debug("PTY read loop ended: %s", e)

                await loop.run_in_executor(None, _read_loop)
            except Exception as e:
                logger.error("PTY forward error: %s", e)
            finally:
                stop_event.set()

        async def _send_output(data: bytes):
            """Send PTY output to the WebSocket client."""
            if stop_event.is_set():
                return
            try:
                text = data.decode("utf-8", errors="replace")
                await websocket.send_json({"type": "output", "data": text})
            except Exception:
                stop_event.set()

        # Task 2: Read client input → forward to PTY
        async def forward_client_to_pty():
            """Read from WebSocket, send to PTY."""
            try:
                while not stop_event.is_set():
                    raw = await websocket.receive_text()
                    msg = json.loads(raw)

                    if msg.get("type") == "input":
                        data = msg.get("data", "")
                        await loop.run_in_executor(
                            None, lambda d=data: pty_handle.send_input(d)
                        )
                    elif msg.get("type") == "resize":
                        new_cols = msg.get("cols", 80)
                        new_rows = msg.get("rows", 24)
                        # Ignore 0x0 resize (happens when container is hidden)
                        if new_cols > 0 and new_rows > 0:
                            await loop.run_in_executor(
                                None,
                                lambda c=new_cols, r=new_rows: pty_handle.resize(
                                    PtySize(rows=r, cols=c)
                                ),
                            )
            except WebSocketDisconnect:
                logger.debug("Client disconnected from terminal %s", session_id)
            except Exception as e:
                logger.debug("Client reader ended: %s", e)
            finally:
                stop_event.set()

        # Run both directions concurrently
        await asyncio.gather(
            forward_pty_to_client(),
            forward_client_to_pty(),
            return_exceptions=True,
        )

        # Send exit message
        exit_code = pty_handle.exit_code if pty_handle else None
        try:
            await websocket.send_json({"type": "exit", "code": exit_code})
        except Exception:
            pass

    except Exception as e:
        logger.error("Terminal session error for sandbox '%s': %s", sandbox_id, e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        stop_event.set()
        # Clean up PTY
        if pty_handle:
            try:
                await loop.run_in_executor(None, pty_handle.disconnect)
            except Exception:
                pass
        # Close WebSocket
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("Terminal session %s closed for sandbox %s", session_id, sandbox_id)
