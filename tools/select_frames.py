#!/usr/bin/env python3
"""
Step 4b: Copy a subset of extracted frames into a new ordered folder.

Indices are 1-based. Both comma-separated lists ("1,6,11,17") and inclusive
ranges ("24-48") are supported, and may be combined.

Usage:
    python tools/select_frames.py \
        --source-dir "<run-dir>/extracted/<character>/<animation>" \
        --output-dir "<run-dir>/selected/<character>/<animation>/12f" \
        --indices    "1,6,11,17,22,27,32,38,43,49,54,60" \
        --frame-prefix "<character>_<animation>_12f"
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path


def natural_key(p: Path) -> list:
    return [int(s) if s.isdigit() else s.lower() for s in re.split(r"(\d+)", p.name)]


def parse_indices(spec: str) -> list[int]:
    out: list[int] = []
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        if "-" in token:
            a, b = token.split("-", 1)
            a, b = int(a), int(b)
            if a > b:
                a, b = b, a
            out.extend(range(a, b + 1))
        else:
            out.append(int(token))
    return out


def parse_beats(spec: str | None, expected: int) -> list[str | None]:
    if not spec:
        return [None] * expected
    parts = [s.strip() for s in spec.split(",")]
    if len(parts) != expected:
        raise SystemExit(f"--beats has {len(parts)} entries, expected {expected}.")
    return [p or None for p in parts]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--source-dir", required=True, type=Path)
    p.add_argument("--output-dir", required=True, type=Path)
    p.add_argument("--indices", required=True,
                   help="1-based selection. Examples: '1,6,11,17' or '24-48' or '1,6,11,17,22-30'.")
    p.add_argument("--frame-prefix", required=True)
    p.add_argument("--beats", default=None,
                   help="Optional beat labels matching --indices in order, comma-separated.")
    p.add_argument("--note", default="human-selected",
                   help="Note about who/why selected these frames.")
    args = p.parse_args()

    sources = sorted([f for f in args.source_dir.iterdir() if f.suffix.lower() == ".png"], key=natural_key)
    if not sources:
        raise SystemExit(f"No PNG frames found in {args.source_dir}")
    total = len(sources)

    indices = parse_indices(args.indices)
    for i in indices:
        if i < 1 or i > total:
            raise SystemExit(f"Index {i} out of range 1..{total}")

    beats = parse_beats(args.beats, len(indices))

    if args.output_dir.exists():
        for old in args.output_dir.glob("*.png"):
            old.unlink()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    per_frame: list[dict] = []
    for out_idx, src_idx in enumerate(indices, start=1):
        src = sources[src_idx - 1]
        dst = args.output_dir / f"{args.frame_prefix}_{out_idx:04d}.png"
        shutil.copy2(src, dst)
        per_frame.append({
            "output_frame": out_idx,
            "output_filename": dst.name,
            "source_index": src_idx,
            "source_filename": src.name,
            "beat": beats[out_idx - 1],
        })

    report = {
        "source_dir": str(args.source_dir),
        "output_dir": str(args.output_dir),
        "total_source_frames": total,
        "selected_frame_count": len(indices),
        "selected_source_indices": indices,
        "selection_note": args.note,
        "per_frame": per_frame,
    }
    (args.output_dir / "selection_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
