#!/usr/bin/env python3
"""
Step 8: Rebuild the sprite gallery manifest consumed by sprite_viewer.html.

Walks the promoted final_sprites/ folder, picks promoted sheet PNGs (skipping
the per-frame folders), and writes a JS file with metadata sorted newest first.

Usage:
    python tools/build_sprite_gallery_manifest.py \
        --folder final_sprites \
        --output sprite_gallery_manifest.js
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


def is_sheet(path: Path) -> bool:
    if path.suffix.lower() != ".png":
        return False
    parts = [p.lower() for p in path.parts]
    if "frames" in parts or "12f_256" in parts or "24f_256" in parts:
        return False
    if path.parent.name.lower() == "frames":
        return False
    if path.parent.parent and path.parent.parent.name.lower() == "frames":
        return False
    return path.parent.name.lower() == "sheets" or "sheet" in path.name.lower()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--folder", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--limit-newest", type=int, default=10)
    p.add_argument("--project", default=None,
                   help="Optional project/game label to attach to every entry.")
    args = p.parse_args()

    if not args.folder.exists():
        raise SystemExit(f"Folder not found: {args.folder}")

    entries = []
    for f in args.folder.rglob("*.png"):
        if not is_sheet(f):
            continue
        try:
            with Image.open(f) as img:
                w, h = img.size
        except Exception:
            continue
        rel = f.relative_to(args.folder.parent if args.folder.parent != Path(".") else Path("."))
        try:
            character = f.relative_to(args.folder).parts[0]
        except Exception:
            character = ""
        try:
            animation = f.relative_to(args.folder).parts[1]
        except Exception:
            animation = ""
        stat = f.stat()
        entries.append({
            "label": f.stem,
            "path": str(rel).replace("\\", "/"),
            "folder": str(f.parent.relative_to(args.folder.parent if args.folder.parent != Path(".") else Path("."))).replace("\\", "/"),
            "project": args.project,
            "character": character,
            "animation": animation,
            "width": w,
            "height": h,
            "byte_size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "modified_ts": stat.st_mtime,
        })

    entries.sort(key=lambda e: e["modified_ts"], reverse=True)
    for e in entries:
        e.pop("modified_ts", None)

    manifest = (
        f"window.SPRITE_LATEST_LIMIT = {args.limit_newest};\n"
        f"window.SPRITE_SHEETS = {json.dumps(entries, indent=2)};\n"
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(manifest)
    print(f"Wrote manifest with {len(entries)} entries: {args.output}")


if __name__ == "__main__":
    main()
