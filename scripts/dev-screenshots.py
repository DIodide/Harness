#!/usr/bin/env python3
"""Capture product screenshots of a locally-running Harness with dev auth on.

Prereqs:
  1. Run the app loginless (no Clerk):
       - apps/web/.env.local:            VITE_ENABLE_DEV_AUTH=true
       - FastAPI .env:                   ENABLE_DEV_AUTH=true
       - Convex deployment:              npx convex env set ENABLE_DEV_AUTH true
       Then `turbo dev` (web on :3000, FastAPI on :8000, convex dev running).
  2. Install Playwright + a browser:
       pip install playwright && playwright install chromium

Run:
  python3 scripts/dev-screenshots.py
  # options:
  BASE_URL=http://localhost:3000 OUT=assets/screenshots python3 scripts/dev-screenshots.py

Notes:
  - Screenshots reflect whatever data the dev user has. Create a couple of
    workspaces / chats first so the shots aren't empty.
  - Routes that need an id (a specific chat, harness, sandbox) are best captured
    by adding their paths to ROUTES below once you know the ids.
"""

import os
import pathlib
import sys

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = pathlib.Path(os.environ.get("OUT", "assets/screenshots"))
VIEWPORT = {"width": 1440, "height": 900}

# (filename, path, full_page)
ROUTES = [
    ("landing.png", "/", True),
    ("workspaces.png", "/workspaces", False),
    ("chat.png", "/chat", False),
    ("harnesses.png", "/harnesses", False),
    ("sandboxes.png", "/sandboxes", False),
]


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed. Run: pip install playwright && playwright install chromium")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Capturing {len(ROUTES)} routes from {BASE_URL} -> {OUT}/")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=2)
        captured = 0
        for name, path, full_page in ROUTES:
            url = f"{BASE_URL}{path}"
            try:
                page.goto(url, wait_until="networkidle", timeout=30_000)
                # Let realtime data + animations settle.
                page.wait_for_timeout(1500)
                page.screenshot(path=str(OUT / name), full_page=full_page)
                print(f"  ✓ {name}  ({url})")
                captured += 1
            except Exception as e:  # noqa: BLE001 - best-effort capture loop
                print(f"  ✗ {name}  ({url}): {e}")
        browser.close()

    print(f"Done — {captured}/{len(ROUTES)} captured in {OUT}/")
    return 0 if captured else 1


if __name__ == "__main__":
    sys.exit(main())
