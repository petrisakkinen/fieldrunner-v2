#!/usr/bin/env python3
"""
Step 4a: Build a contact sheet PNG from a directory of extracted frames.

Reads PNGs in natural filename order, places thumbnails on a grid, and writes
each frame number visibly under its thumbnail. Source frames are not
modified.

Usage:
    python tools/make_contact_sheet.py \
        --source-dir "<run-dir>/extracted/<character>/<animation>" \
        --output     "<run-dir>/contact_sheets/<character>_<animation>_raw_contact.png" \
        --cols 12 --cell-size 128 --image-size 112
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def natural_key(p: Path) -> list:
    return [int(s) if s.isdigit() else s.lower() for s in re.split(r"(\d+)", p.name)]


def load_font(size: int):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--source-dir", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--cols", type=int, default=12)
    p.add_argument("--cell-size", type=int, default=128)
    p.add_argument("--image-size", type=int, default=112)
    p.add_argument("--label-height", type=int, default=22)
    p.add_argument("--bg-color", default="#222222")
    p.add_argument("--fg-color", default="#FFFFFF")
    args = p.parse_args()

    frames = sorted([f for f in args.source_dir.iterdir() if f.suffix.lower() == ".png"], key=natural_key)
    if not frames:
        raise SystemExit(f"No PNG frames found in {args.source_dir}")

    cols = args.cols
    rows = (len(frames) + cols - 1) // cols
    cell_w = args.cell_size
    cell_h = args.cell_size + args.label_height
    sheet_w = cols * cell_w
    sheet_h = rows * cell_h
    sheet = Image.new("RGB", (sheet_w, sheet_h), args.bg_color)
    draw = ImageDraw.Draw(sheet)
    font = load_font(14)

    for idx, frame in enumerate(frames):
        col = idx % cols
        row = idx // cols
        cx = col * cell_w
        cy = row * cell_h

        thumb = Image.open(frame).convert("RGBA")
        thumb.thumbnail((args.image_size, args.image_size), Image.LANCZOS)
        bg = Image.new("RGB", (args.image_size, args.image_size), args.bg_color)
        ox = (args.image_size - thumb.width) // 2
        oy = (args.image_size - thumb.height) // 2
        if thumb.mode == "RGBA":
            bg.paste(thumb, (ox, oy), thumb)
        else:
            bg.paste(thumb, (ox, oy))
        sheet.paste(bg, (cx + (cell_w - args.image_size) // 2, cy + (args.cell_size - args.image_size) // 2))

        label = f"{idx + 1}"
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(
            (cx + (cell_w - tw) // 2, cy + args.cell_size + (args.label_height - th) // 2 - 2),
            label, font=font, fill=args.fg_color,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, "PNG")
    print(f"Wrote contact sheet ({len(frames)} frames, {cols}x{rows}): {args.output}")


if __name__ == "__main__":
    main()
