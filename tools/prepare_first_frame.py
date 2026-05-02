#!/usr/bin/env python3
"""
Prepare a Kling first-frame from an image-model output.

Detects the non-green character bbox, rescales it to a target height ratio of
the canvas, and pastes it onto a pure #00FF00 background, centered with
animation-safe margins.

Usage:
    python tools/prepare_first_frame.py \
        --input  work/runs/<run>/source/repo_back_v2_gpt2.png \
        --output work/runs/<run>/source/repo_back_v2_prepped.png \
        --canvas 1024 \
        --char-height 0.50
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


CHROMA = (0, 255, 0)


def is_background(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel[0], pixel[1], pixel[2]
    return g > 200 and r < 100 and b < 100 and g > max(r, b) + 60


def bbox_of_character(img: Image.Image) -> tuple[int, int, int, int]:
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    min_x, min_y, max_x, max_y = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if not is_background(px[x, y]):
                if x < min_x: min_x = x
                if y < min_y: min_y = y
                if x > max_x: max_x = x
                if y > max_y: max_y = y
    if max_x < 0:
        raise SystemExit("No non-background pixels found — bad input.")
    return min_x, min_y, max_x, max_y


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--canvas", type=int, default=1024)
    p.add_argument("--char-height", type=float, default=0.50,
                   help="Target character height as fraction of canvas (0.40-0.50 recommended).")
    p.add_argument("--report", type=Path, default=None)
    args = p.parse_args()

    src = Image.open(args.input).convert("RGBA")
    bg_rgb = Image.open(args.input).convert("RGB")
    sw, sh = src.size

    min_x, min_y, max_x, max_y = bbox_of_character(bg_rgb)
    bbox_w = max_x - min_x + 1
    bbox_h = max_y - min_y + 1

    char = src.crop((min_x, min_y, max_x + 1, max_y + 1))

    target_h = int(args.canvas * args.char_height)
    scale = target_h / bbox_h
    new_w = max(1, int(round(bbox_w * scale)))
    new_h = target_h
    char_resized = char.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGB", (args.canvas, args.canvas), CHROMA)
    paste_x = (args.canvas - new_w) // 2
    paste_y = (args.canvas - new_h) // 2

    if char_resized.mode == "RGBA":
        rgb_layer = char_resized.convert("RGB")
        # The character image keeps its near-green outline pixels — we are not
        # alpha-keying here. Instead we replace any near-green pixel inside the
        # resized character with exact #00FF00 so the output canvas stays
        # uniformly chroma-keyable.
        px_in = rgb_layer.load()
        for y in range(new_h):
            for x in range(new_w):
                if is_background(px_in[x, y]):
                    rgb_layer.putpixel((x, y), CHROMA)
        canvas.paste(rgb_layer, (paste_x, paste_y))
    else:
        canvas.paste(char_resized, (paste_x, paste_y))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output, "PNG")

    report = {
        "input": str(args.input),
        "output": str(args.output),
        "source_size": [sw, sh],
        "canvas": args.canvas,
        "target_char_height_ratio": args.char_height,
        "detected_bbox": [min_x, min_y, max_x, max_y],
        "detected_bbox_size": [bbox_w, bbox_h],
        "scale": scale,
        "resized_char_size": [new_w, new_h],
        "paste_position": [paste_x, paste_y],
        "margins": {
            "top": paste_y / args.canvas,
            "bottom": (args.canvas - paste_y - new_h) / args.canvas,
            "left": paste_x / args.canvas,
            "right": (args.canvas - paste_x - new_w) / args.canvas,
        },
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
