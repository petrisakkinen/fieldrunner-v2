#!/usr/bin/env python3
"""
Horizontally mirror every cell of a sprite sheet (e.g. lane_left -> lane_right).

Each cell is flipped left-right individually, then re-stitched in the same
order. This is symmetric: the cell sequence is unchanged, only the artwork
within each cell is mirrored.

Usage:
    python tools/mirror_sprite_sheet.py \
        --input  final_sprites/repo/lane_left/sheets/repo_lane_left_8f_256.png \
        --output final_sprites/repo/lane_right/sheets/repo_lane_right_8f_256.png \
        --frames 8
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--frames", type=int, required=True)
    args = p.parse_args()

    src = Image.open(args.input).convert("RGBA")
    sheet_w, sheet_h = src.size
    if sheet_w % args.frames != 0:
        raise SystemExit(f"Sheet width {sheet_w} not divisible by --frames {args.frames}")
    cell = sheet_w // args.frames
    out = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    for i in range(args.frames):
        crop = src.crop((i * cell, 0, (i + 1) * cell, sheet_h))
        out.paste(crop.transpose(Image.FLIP_LEFT_RIGHT), (i * cell, 0))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output, "PNG")
    print(f"Mirrored {args.frames} cells: {args.input} -> {args.output}")


if __name__ == "__main__":
    main()
