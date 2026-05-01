"""Generate a high-level Excalidraw diagram for the Frontend Tier.

Designed for a slide: one frontend box, three arrows out to the backends.
Run: python3 scripts/gen_frontend_excalidraw.py
Outputs: frontend-tier.excalidraw at the repo root.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

random.seed(11)

ELEMENTS: list[dict] = []


def _seed() -> int:
    return random.randint(1, 2_000_000_000)


def _common() -> dict:
    return {
        "angle": 0,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "seed": _seed(),
        "version": 1,
        "versionNonce": _seed(),
        "isDeleted": False,
        "boundElements": [],
        "updated": 1,
        "link": None,
        "locked": False,
    }


def rect(eid, x, y, w, h, *, bg="transparent", stroke="#1e1e1e",
         stroke_width=2, rounded=True):
    ELEMENTS.append({
        "id": eid, "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h,
        "strokeColor": stroke, "backgroundColor": bg,
        "fillStyle": "solid", "strokeWidth": stroke_width,
        "strokeStyle": "solid", "roughness": 1,
        "roundness": {"type": 3} if rounded else None,
        **_common(),
    })


def text(eid, x, y, w, h, content, *, size=18, align="center",
         color="#1e1e1e", bold=False):
    ELEMENTS.append({
        "id": eid, "type": "text",
        "x": x, "y": y, "width": w, "height": h,
        "strokeColor": color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1,
        "strokeStyle": "solid", "roughness": 1, "roundness": None,
        "fontSize": size,
        "fontFamily": 3 if bold else 1,
        "text": content, "textAlign": align, "verticalAlign": "middle",
        "containerId": None, "originalText": content,
        "lineHeight": 1.25, "baseline": int(size * 0.85),
        **_common(),
    })


def arrow(eid, x, y, points, *, stroke="#1e1e1e", stroke_width=2):
    ELEMENTS.append({
        "id": eid, "type": "arrow",
        "x": x, "y": y,
        "width": (max(p[0] for p in points) - min(p[0] for p in points)) or 1,
        "height": (max(p[1] for p in points) - min(p[1] for p in points)) or 1,
        "strokeColor": stroke, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": stroke_width,
        "strokeStyle": "solid", "roughness": 1,
        "roundness": {"type": 2},
        "points": [list(p) for p in points],
        "lastCommittedPoint": None,
        "startBinding": None, "endBinding": None,
        "startArrowhead": None, "endArrowhead": "arrow",
        **_common(),
    })


# Palette
INK = "#1e1e1e"
WHITE = "#ffffff"
FRONTEND = "#dbeafe"   # soft blue for the frontend block
PURPLE = "#d6c8f5"
ORANGE = "#fbd8b0"
BLUE = "#bcd9ff"
YELLOW = "#fff1b3"


# --- canvas ----------------------------------------------------------------

CW = 1300  # logical canvas width

# Title
text("title", 0, 20, CW, 44,
     "Frontend Tier", size=36, bold=True)

# --- Frontend box ----------------------------------------------------------

FB_X, FB_Y, FB_W, FB_H = 220, 110, 860, 360
rect("frontend", FB_X, FB_Y, FB_W, FB_H, bg=FRONTEND, stroke_width=3)

# Top label inside frontend box
text("fe-1", FB_X, FB_Y + 30, FB_W, 32,
     "React 19  ·  TanStack Start  (SSR + Routing)",
     size=22, bold=True)
text("fe-2", FB_X, FB_Y + 70, FB_W, 26,
     "TypeScript  ·  Vite",
     size=16, color="#444")

# Three feature pills inside the frontend box
pills = ["Routes & Pages", "UI Components", "Realtime & Streaming"]
pill_y = FB_Y + 130
pill_h = 70
pill_gap = 24
inner_w = FB_W - 40
pill_w = (inner_w - pill_gap * (len(pills) - 1)) / len(pills)
for i, label in enumerate(pills):
    px = FB_X + 20 + i * (pill_w + pill_gap)
    rect(f"pill-{i}", px, pill_y, pill_w, pill_h, bg=WHITE, stroke=INK)
    text(f"pill-text-{i}", px, pill_y + 22, pill_w, 28, label,
         size=18, bold=True)

# Caption inside frontend box
text("fe-style", FB_X, FB_Y + 230, FB_W, 24,
     "Tailwind v4   ·   shadcn/ui   ·   Radix UI   ·   Motion",
     size=15, color="#333")

# Hosting strip at the bottom of the frontend box
host_y = FB_Y + FB_H - 56
rect("host-bg", FB_X + 20, host_y, FB_W - 40, 36, bg=YELLOW)
text("host-text", FB_X + 20, host_y + 4, FB_W - 40, 28,
     "Hosted on Cloudflare Workers (edge SSR + static assets)",
     size=15, bold=True)

# --- Backend boxes ---------------------------------------------------------

BACK_Y = FB_Y + FB_H + 130
BACK_H = 110
BACK_W = 240

backends = [
    ("Convex DB",  "Realtime · WebSocket", PURPLE),
    ("FastAPI",    "LLM · Sandbox · HTTP", ORANGE),
    ("Clerk",      "Auth · OAuth · JWT",   BLUE),
]
nb = len(backends)

# Distribute three backends evenly under the frontend box
back_total_w = nb * BACK_W + (nb - 1) * 80
back_x0 = FB_X + (FB_W - back_total_w) / 2

centers: list[float] = []
for i, (name, sub, bg) in enumerate(backends):
    bx = back_x0 + i * (BACK_W + 80)
    rect(f"be-{i}", bx, BACK_Y, BACK_W, BACK_H, bg=bg, stroke=INK,
         stroke_width=2)
    text(f"be-name-{i}", bx, BACK_Y + 22, BACK_W, 32, name,
         size=22, bold=True)
    text(f"be-sub-{i}",  bx, BACK_Y + 64, BACK_W, 26, sub,
         size=14, color="#222")
    centers.append(bx + BACK_W / 2)

# Arrows from frontend bottom -> each backend top
fe_bottom = FB_Y + FB_H
for i, cx in enumerate(centers):
    # start: just above the backend box, aligned vertically
    start_x = cx
    start_y = fe_bottom + 6
    end_y = BACK_Y - 6
    arrow(f"arr-{i}", start_x, start_y,
          [(0, 0), (0, end_y - start_y)],
          stroke=INK, stroke_width=2)


# --- write -----------------------------------------------------------------

doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": ELEMENTS,
    "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
    "files": {},
}

out = Path(__file__).resolve().parent.parent / "frontend-tier.excalidraw"
out.write_text(json.dumps(doc, indent=2))
print(f"wrote {out}  ({len(ELEMENTS)} elements)")
