#!/usr/bin/env python3
"""Regenerate the app + tray icons from the canonical Affilync mark.

Why this exists: resources/icon.png and the four tray PNGs shipped the RETIRED
node-and-swoosh glyph — the green/blue swoosh with six detached white node
circles, in the pre-2026 palette. affilync-web replaced that mark with the
faceted "Chisel" A (teal + amber on #0A0E1A) and even guards it in
AffilyncLogo.test.jsx, but this repo's binaries were never regenerated. The
Windows taskbar, the macOS dock and the tray all still showed the old logo.

Binary assets rot silently precisely because nobody diffs them. Generating them
from one committed source, with a script, makes the next rebrand a one-command
change rather than an archaeology exercise.

    python3 scripts/generate-icons.py      # requires Pillow

Source of truth: resources/source/affilync-mark-1024.png, copied from
affilync-web/public/logo.png. Keep the two in step.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "resources/source/affilync-mark-1024.png"
TRAY_DIR = ROOT / "resources/tray"

# Tray status tints.
#
# These are the CURRENT brand tokens (affilync-web src/constants/brandColors.ts)
# and were already correct on the old icons — only the glyph was stale, so they
# carry over unchanged rather than being "modernised" into a different palette.
#
# `idle` gets no dot on purpose: registered-but-quiet is the resting state and
# should not compete for attention in a system tray.
TRAY_STATES: dict[str, str | None] = {
    "idle": None,
    "away": "#8B93A7",
    "oncall": "#00FF88",
    "ringing": "#FFCC00",
}

TRAY_SIZE = 32
DOT_D = 13  # ~40% of the canvas — legible at 32px, still reads as a badge
RING = "#0A0E1A"  # brand page background, used as the dot's separator ring


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source mark: {SOURCE}")

    TRAY_DIR.mkdir(parents=True, exist_ok=True)
    mark = Image.open(SOURCE).convert("RGBA")

    # App icon. electron-builder derives .ico and .icns from this, so 512 is
    # the highest-fidelity input it needs.
    mark.resize((512, 512), Image.LANCZOS).save(ROOT / "resources/icon.png")
    print("wrote resources/icon.png (512x512)")

    base = mark.resize((TRAY_SIZE, TRAY_SIZE), Image.LANCZOS)

    for state, color in TRAY_STATES.items():
        icon = base.copy()

        if color:
            draw = ImageDraw.Draw(icon)
            x1, y1 = TRAY_SIZE - 1, TRAY_SIZE - 1
            x0, y0 = x1 - DOT_D, y1 - DOT_D
            # The ring is not decoration: without it the dot merges into a
            # light desktop wallpaper and the state becomes unreadable.
            draw.ellipse((x0, y0, x1, y1), fill=RING)
            draw.ellipse((x0 + 2, y0 + 2, x1 - 2, y1 - 2), fill=color)

        icon.save(TRAY_DIR / f"tray-{state}.png")
        print(f"wrote resources/tray/tray-{state}.png ({TRAY_SIZE}x{TRAY_SIZE})")


if __name__ == "__main__":
    main()
