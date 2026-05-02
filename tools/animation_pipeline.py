#!/usr/bin/env python3
"""
Step 6: Turn a folder of selected frames into game-ready 256x256 transparent
sprite cells, a horizontal sprite strip, a checker preview, and a JSON report.

Default: --background-mode chroma (key out #00FF00) and
         --layout-mode preserve-canvas (scale full source canvas into each cell).

Usage (12-frame export):
    python tools/animation_pipeline.py \
        --source-frames-dir "<run-dir>/selected/<character>/<animation>/12f" \
        --frames 12 \
        --output  "<run-dir>/sheets/<character>/<animation>/<character>_<animation>_12f_256.png" \
        --preview "<run-dir>/previews/<character>/<animation>/<character>_<animation>_12f_256_preview.png" \
        --frames-dir "<run-dir>/frames/<character>/<animation>/12f_256" \
        --report  "<run-dir>/reports/<character>/<animation>/<character>_<animation>_12f_256_report.json" \
        --background-mode chroma \
        --layout-mode preserve-canvas \
        --frame-prefix "<character>_<animation>_12f"

For 24-frame export, run again with the 24f selected source folder, --frames 24,
and 24f-named outputs.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


CHROMA_KEY = (0, 255, 0)


def natural_key(p: Path) -> list:
    return [int(s) if s.isdigit() else s.lower() for s in re.split(r"(\d+)", p.name)]


def chroma_key_and_despill(rgba: np.ndarray, key_rgb=CHROMA_KEY,
                           key_tolerance: int = 60, spill_threshold: int = 25) -> np.ndarray:
    """Remove pixels near the chroma key and despill remaining green-tinted pixels.

    Conservative: only kills pixels where green is dominant (g > r and g > b and
    g - max(r,b) > tolerance). This preserves cyan weapon tips, green accents,
    and antialiased character details.
    """
    out = rgba.copy()
    r = out[..., 0].astype(np.int16)
    g = out[..., 1].astype(np.int16)
    b = out[..., 2].astype(np.int16)
    a = out[..., 3]

    max_rb = np.maximum(r, b)
    green_dominance = g - max_rb

    # Kill background: green clearly dominates AND color is close to key (broadly).
    # Use a permissive distance to the green axis: g high, r/b low-ish.
    near_key = (
        (g > 150) & (r < 120) & (b < 120) & (green_dominance > key_tolerance)
    )
    a[near_key] = 0

    # Despill remaining pixels where green still spills onto edges.
    spill = (~near_key) & (green_dominance > spill_threshold) & (a > 0)
    if spill.any():
        clamped_g = np.clip(max_rb + spill_threshold, 0, 255)
        out[..., 1] = np.where(spill, clamped_g, out[..., 1])

    out[..., 3] = a
    return out


def remove_tiny_components(rgba: np.ndarray, min_area: int = 8, keep_largest_only: bool = False) -> np.ndarray:
    """Remove tiny opaque blobs (noise specks) using a simple flood-fill labelling.

    With keep_largest_only=True, every component except the single largest one
    is dropped — useful when a video model has hallucinated a free-floating
    object (e.g. a soccer ball) that is not connected to the character.
    """
    a = rgba[..., 3]
    if min_area <= 1:
        return rgba
    h, w = a.shape
    visited = np.zeros_like(a, dtype=bool)
    label = np.zeros_like(a, dtype=np.int32)
    next_label = 1
    sizes: list[int] = [0]  # index 0 reserved

    # Iterative BFS using stacks
    for sy in range(h):
        row_a = a[sy]
        row_v = visited[sy]
        for sx in range(w):
            if row_a[sx] == 0 or row_v[sx]:
                continue
            stack = [(sy, sx)]
            count = 0
            while stack:
                y, x = stack.pop()
                if y < 0 or y >= h or x < 0 or x >= w:
                    continue
                if visited[y, x] or a[y, x] == 0:
                    continue
                visited[y, x] = True
                label[y, x] = next_label
                count += 1
                stack.append((y + 1, x))
                stack.append((y - 1, x))
                stack.append((y, x + 1))
                stack.append((y, x - 1))
            sizes.append(count)
            next_label += 1

    if next_label <= 1:
        return rgba
    sizes_arr = np.array(sizes, dtype=np.int32)

    if keep_largest_only:
        # Find the largest non-background label and drop everything else.
        labels_only = sizes_arr.copy()
        labels_only[0] = 0  # background sentinel
        largest = int(np.argmax(labels_only))
        keep_mask = (label == largest)
        rgba[..., 3] = np.where(keep_mask, rgba[..., 3], 0)
        return rgba

    small_labels = np.where(sizes_arr < min_area)[0]
    if len(small_labels) <= 1:
        return rgba
    mask = np.isin(label, small_labels[small_labels > 0])
    rgba[..., 3] = np.where(mask, 0, rgba[..., 3])
    return rgba


def scale_preserve_canvas(rgba: np.ndarray, cell_size: int) -> tuple[np.ndarray, dict]:
    """Scale the entire source canvas into a fixed cell_size x cell_size cell.

    Source canvas is preserved 1:1; we letterbox/pillarbox if it isn't square.
    """
    src_h, src_w = rgba.shape[:2]
    src_aspect = src_w / src_h
    if src_aspect >= 1:
        new_w = cell_size
        new_h = max(1, int(round(cell_size / src_aspect)))
    else:
        new_h = cell_size
        new_w = max(1, int(round(cell_size * src_aspect)))

    img = Image.fromarray(rgba, mode="RGBA").resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (cell_size, cell_size), (0, 0, 0, 0))
    paste_x = (cell_size - new_w) // 2
    paste_y = (cell_size - new_h) // 2
    canvas.paste(img, (paste_x, paste_y), img)

    info = {
        "source_canvas_size": [src_w, src_h],
        "scaled_canvas_size": [new_w, new_h],
        "scale_x": new_w / src_w,
        "scale_y": new_h / src_h,
        "paste_position": [paste_x, paste_y],
    }
    return np.array(canvas), info


def fit_foreground(rgba: np.ndarray, cell_size: int, padding_ratio: float = 0.10) -> tuple[np.ndarray, dict]:
    """Legacy rescue mode: crop the visible foreground bbox and recenter it.

    DO NOT use this for video-generated animations — it creates fake camera
    movement between frames. Kept for one-off image rescue work.
    """
    a = rgba[..., 3]
    ys, xs = np.where(a > 0)
    if len(ys) == 0:
        return scale_preserve_canvas(rgba, cell_size)
    min_y, max_y = ys.min(), ys.max()
    min_x, max_x = xs.min(), xs.max()
    cropped = rgba[min_y:max_y + 1, min_x:max_x + 1]
    bbox_h, bbox_w = cropped.shape[:2]
    pad = int(cell_size * padding_ratio)
    target = cell_size - 2 * pad
    if bbox_w / bbox_h >= 1:
        new_w = target
        new_h = max(1, int(round(target * bbox_h / bbox_w)))
    else:
        new_h = target
        new_w = max(1, int(round(target * bbox_w / bbox_h)))
    img = Image.fromarray(cropped, mode="RGBA").resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (cell_size, cell_size), (0, 0, 0, 0))
    paste_x = (cell_size - new_w) // 2
    paste_y = (cell_size - new_h) // 2
    canvas.paste(img, (paste_x, paste_y), img)
    info = {
        "source_canvas_size": [int(rgba.shape[1]), int(rgba.shape[0])],
        "scaled_canvas_size": [new_w, new_h],
        "scale_x": new_w / bbox_w,
        "scale_y": new_h / bbox_h,
        "paste_position": [paste_x, paste_y],
        "fit_foreground_bbox": [int(min_x), int(min_y), int(max_x), int(max_y)],
    }
    return np.array(canvas), info


def make_checker_background(size: int, square: int = 16) -> Image.Image:
    img = Image.new("RGB", (size, size), (200, 200, 200))
    px = img.load()
    for y in range(size):
        for x in range(size):
            if ((x // square) + (y // square)) % 2:
                px[x, y] = (160, 160, 160)
    return img


def silhouette_diff(prev: np.ndarray, cur: np.ndarray) -> float:
    """Fraction of cells where alpha changed (rough motion-pop detector)."""
    pa = prev[..., 3] > 32
    ca = cur[..., 3] > 32
    diff = pa ^ ca
    return float(diff.sum()) / diff.size


def main() -> None:
    p = argparse.ArgumentParser()
    src_group = p.add_mutually_exclusive_group(required=True)
    src_group.add_argument("--source-frames-dir", type=Path)
    src_group.add_argument("--source", type=Path,
                           help="Legacy: a single horizontal source sheet to slice.")
    p.add_argument("--frames", type=int, required=True, help="Expected frame count.")
    p.add_argument("--output", required=True, type=Path, help="Path of the horizontal sheet PNG.")
    p.add_argument("--preview", required=True, type=Path)
    p.add_argument("--frames-dir", required=True, type=Path,
                   help="Directory for individual cell PNGs.")
    p.add_argument("--report", required=True, type=Path)
    p.add_argument("--background-mode", choices=["chroma", "alpha"], default="chroma")
    p.add_argument("--layout-mode", choices=["preserve-canvas", "fit-foreground"], default="preserve-canvas")
    p.add_argument("--frame-size", type=int, default=256)
    p.add_argument("--frame-prefix", required=True)
    p.add_argument("--chroma-key", default="#00FF00",
                   help="Hex string. Default #00FF00.")
    p.add_argument("--key-tolerance", type=int, default=60)
    p.add_argument("--spill-threshold", type=int, default=25)
    p.add_argument("--noise-min-area", type=int, default=8)
    p.add_argument("--keep-largest-component", action="store_true",
                   help="After chroma keying, keep only the single largest connected opaque component. Use this when the video model hallucinated a free-floating object (e.g. a soccer ball) detached from the character.")
    p.add_argument("--watermark-clear", default=None,
                   help="Optional clear box for video-tool watermarks. Format: x0,y0,x1,y1 (in cell coords).")
    args = p.parse_args()

    key_rgb = tuple(int(args.chroma_key.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))

    # Load source frames
    if args.source_frames_dir is not None:
        files = sorted(
            [f for f in args.source_frames_dir.iterdir() if f.suffix.lower() == ".png"],
            key=natural_key,
        )
        if not files:
            raise SystemExit(f"No PNG frames found in {args.source_frames_dir}")
        if len(files) != args.frames:
            print(f"WARNING: expected {args.frames} frames, found {len(files)}.")
        frames = [np.array(Image.open(f).convert("RGBA")) for f in files]
        source_paths = [str(f) for f in files]
    else:
        sheet = np.array(Image.open(args.source).convert("RGBA"))
        if sheet.shape[1] % args.frames != 0:
            raise SystemExit(
                f"Legacy sheet width {sheet.shape[1]} not divisible by frame count {args.frames}."
            )
        cell_w = sheet.shape[1] // args.frames
        frames = [sheet[:, i * cell_w:(i + 1) * cell_w].copy() for i in range(args.frames)]
        source_paths = [str(args.source)] * args.frames

    # Process each frame
    args.frames_dir.mkdir(parents=True, exist_ok=True)
    cells: list[np.ndarray] = []
    layout_infos: list[dict] = []
    edge_alpha_counts: list[int] = []

    wm_box = None
    if args.watermark_clear:
        wm_box = tuple(int(v) for v in args.watermark_clear.split(","))

    for idx, frame in enumerate(frames, start=1):
        if args.background_mode == "chroma":
            frame = chroma_key_and_despill(
                frame,
                key_rgb=key_rgb,
                key_tolerance=args.key_tolerance,
                spill_threshold=args.spill_threshold,
            )
            frame = remove_tiny_components(frame, min_area=args.noise_min_area,
                                            keep_largest_only=args.keep_largest_component)
        # alpha mode: trust input alpha as-is

        if args.layout_mode == "preserve-canvas":
            cell, info = scale_preserve_canvas(frame, args.frame_size)
        else:
            cell, info = fit_foreground(frame, args.frame_size)

        if wm_box is not None:
            x0, y0, x1, y1 = wm_box
            cell[y0:y1, x0:x1, 3] = 0

        a = cell[..., 3]
        edge_count = int((a[0, :] > 0).sum() + (a[-1, :] > 0).sum() + (a[:, 0] > 0).sum() + (a[:, -1] > 0).sum())
        edge_alpha_counts.append(edge_count)

        layout_infos.append(info)
        cells.append(cell)

        cell_path = args.frames_dir / f"{args.frame_prefix}_{idx:02d}.png"
        Image.fromarray(cell, mode="RGBA").save(cell_path, "PNG")

    # Stitch sprite strip
    sheet_w = args.frame_size * len(cells)
    sheet_h = args.frame_size
    strip = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        strip.paste(Image.fromarray(cell, mode="RGBA"), (i * args.frame_size, 0))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    strip.save(args.output, "PNG")

    # Preview on checker background
    checker = make_checker_background(args.frame_size).convert("RGBA")
    preview_h = args.frame_size
    preview = Image.new("RGBA", (sheet_w, preview_h), (0, 0, 0, 255))
    for i, cell in enumerate(cells):
        bg = checker.copy()
        bg.paste(Image.fromarray(cell, mode="RGBA"), (0, 0), Image.fromarray(cell, mode="RGBA"))
        preview.paste(bg, (i * args.frame_size, 0))
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    preview.save(args.preview, "PNG")

    # Report metrics
    final_bboxes: list[list[int] | None] = []
    for cell in cells:
        a = cell[..., 3]
        ys, xs = np.where(a > 0)
        if len(ys):
            final_bboxes.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
        else:
            final_bboxes.append(None)

    motion_diffs = [None]
    for i in range(1, len(cells)):
        motion_diffs.append(silhouette_diff(cells[i - 1], cells[i]))

    duplicate_warnings = []
    for i in range(1, len(cells)):
        if motion_diffs[i] is not None and motion_diffs[i] < 0.002:
            duplicate_warnings.append(i + 1)

    pop_warnings = []
    for i in range(1, len(cells)):
        if motion_diffs[i] is not None and motion_diffs[i] > 0.25:
            pop_warnings.append(i + 1)

    edge_warnings = [i + 1 for i, c in enumerate(edge_alpha_counts) if c > 0]

    widths = [info["scaled_canvas_size"][0] for info in layout_infos]
    heights = [info["scaled_canvas_size"][1] for info in layout_infos]

    expected_size = (sheet_w, sheet_h)
    actual_size = strip.size

    errors: list[str] = []
    warnings: list[str] = []
    if actual_size != expected_size:
        errors.append(f"Sheet size {actual_size} != expected {expected_size}")
    if len(set(widths)) > 1 or len(set(heights)) > 1:
        warnings.append(
            f"Frame canvas size variance: widths {sorted(set(widths))}, heights {sorted(set(heights))}"
        )
    if len(cells) != args.frames:
        warnings.append(f"Frame count mismatch: got {len(cells)}, expected {args.frames}")

    report = {
        "status": "fail" if errors else "pass",
        "errors": errors,
        "warnings": warnings,
        "frame_count": len(cells),
        "frame_size": args.frame_size,
        "sheet_size": list(actual_size),
        "expected_sheet_size": list(expected_size),
        "source_paths": source_paths,
        "output_paths": {
            "sheet": str(args.output),
            "preview": str(args.preview),
            "frames_dir": str(args.frames_dir),
        },
        "background_mode": args.background_mode,
        "layout_mode": args.layout_mode,
        "chroma_key": list(key_rgb),
        "key_tolerance": args.key_tolerance,
        "spill_threshold": args.spill_threshold,
        "noise_min_area": args.noise_min_area,
        "watermark_clear": list(wm_box) if wm_box else None,
        "per_frame": [
            {
                "index": i + 1,
                "source": source_paths[i] if i < len(source_paths) else None,
                "source_canvas_size": layout_infos[i]["source_canvas_size"],
                "scaled_canvas_size": layout_infos[i]["scaled_canvas_size"],
                "paste_position": layout_infos[i]["paste_position"],
                "scale_x": layout_infos[i]["scale_x"],
                "scale_y": layout_infos[i]["scale_y"],
                "final_bbox": final_bboxes[i],
                "edge_alpha_count": edge_alpha_counts[i],
                "silhouette_diff_to_prev": motion_diffs[i],
            }
            for i in range(len(cells))
        ],
        "duplicate_frame_indices": duplicate_warnings,
        "motion_pop_indices": pop_warnings,
        "edge_contact_indices": edge_warnings,
    }

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2))
    print(f"Status: {report['status']}")
    print(f"Sheet: {args.output} ({sheet_w}x{sheet_h})")
    print(f"Preview: {args.preview}")
    print(f"Cells dir: {args.frames_dir}")
    print(f"Report: {args.report}")
    if warnings:
        print("Warnings:")
        for w in warnings:
            print(f"  - {w}")
    if errors:
        print("Errors:")
        for e in errors:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
