"""Build the Daytona snapshot used by the ACP agent gateway.

Bakes node 22 plus both ACP agents into a snapshot so sandbox boot is fast:
  - codex-acp (zed-industries prebuilt linux binary) at /usr/local/bin/codex-acp
  - @agentclientprotocol/claude-agent-acp (npm global, /usr/local/bin/claude-agent-acp)

The shim itself is uploaded at session start so it can iterate without
rebuilding the image.

Usage (from packages/fastapi):
    .venv/bin/python scripts/create_acp_snapshot.py [--name harness-acp-v1]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from daytona_sdk import CreateSnapshotParams, Daytona, DaytonaConfig, Image, Resources

from app.config import settings
from app.services.agents.registry import CLAUDE_AGENT_ACP_VERSION, CODEX_ACP_URL


def build_image() -> Image:
    return (
        Image.debian_slim("3.13")
        .run_commands(
            "apt-get update && apt-get install -y --no-install-recommends "
            "curl ca-certificates git ripgrep && rm -rf /var/lib/apt/lists/*",
            # Node 22 (required by claude-agent-acp and the shim).
            "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - "
            "&& apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*",
            # Claude Code ACP adapter (global npm install).
            "npm install -g "
            f"@agentclientprotocol/claude-agent-acp@{CLAUDE_AGENT_ACP_VERSION}",
            # Codex ACP adapter (prebuilt linux x86_64 binary).
            f"curl -fsSL -o /tmp/codex-acp.tgz {CODEX_ACP_URL} "
            "&& tar -xzf /tmp/codex-acp.tgz -C /usr/local/bin "
            "&& chmod +x /usr/local/bin/codex-acp && rm /tmp/codex-acp.tgz",
            # Cursor CLI (cursor-agent) — provides `cursor-agent acp`.
            "curl -fsS https://cursor.com/install | bash "
            "&& ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent "
            "&& /usr/local/bin/cursor-agent --version || true",
            "node --version && codex-acp --version || true",
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=settings.acp_snapshot_name)
    args = parser.parse_args()

    client = Daytona(
        DaytonaConfig(
            api_key=settings.daytona_api_key,
            api_url=settings.daytona_api_url,
            target=settings.daytona_target,
        )
    )
    print(f"Creating snapshot '{args.name}' (this builds an image, ~minutes)...")
    snapshot = client.snapshot.create(
        CreateSnapshotParams(
            name=args.name,
            image=build_image(),
            resources=Resources(cpu=2, memory=4, disk=10),
        ),
        on_logs=lambda line: print(f"  [build] {line}"),
        timeout=900,
    )
    print(f"Snapshot ready: {snapshot.name} (state={snapshot.state})")


if __name__ == "__main__":
    main()
