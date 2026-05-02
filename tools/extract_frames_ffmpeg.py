#!/usr/bin/env python3
"""
Step 3: Extract full-resolution PNG frames from a video using ffmpeg/ffprobe.

Default behavior is source-frame passthrough (every decoded frame in playback
order). Use --fps to sample at a constant rate. Use --crop to apply an
ffmpeg crop expression (rare; the canvas is normally preserved).

Usage:
    python tools/extract_frames_ffmpeg.py \
        --input  "<source-video>" \
        --output-dir "<run-dir>/extracted/<character>/<animation>" \
        --overwrite
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


def run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return proc.stdout


def ffprobe_metadata(video: Path) -> dict:
    out = run([
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration",
        "-of", "json", str(video),
    ])
    data = json.loads(out)
    stream = data["streams"][0] if data.get("streams") else {}

    def parse_rate(rate: str) -> float | None:
        if not rate or rate == "0/0":
            return None
        try:
            num, den = rate.split("/")
            return float(num) / float(den) if float(den) else None
        except Exception:
            return None

    return {
        "width": stream.get("width"),
        "height": stream.get("height"),
        "fps": parse_rate(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or ""),
        "duration": float(stream["duration"]) if stream.get("duration") else None,
        "nb_frames": int(stream["nb_frames"]) if stream.get("nb_frames") else None,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output-dir", required=True, type=Path)
    p.add_argument("--fps", type=float, default=None,
                   help="Optional output FPS. If omitted, every source frame is extracted in order.")
    p.add_argument("--crop", default=None,
                   help="Optional ffmpeg crop expression (e.g. 'iw:ih-40:0:0'). Avoid this — the full canvas is part of the alignment strategy.")
    p.add_argument("--pattern", default="frame_%04d.png")
    p.add_argument("--start-number", type=int, default=1)
    p.add_argument("--overwrite", action="store_true")
    args = p.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input video not found: {args.input}")

    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        if not args.overwrite:
            raise SystemExit(f"Output dir not empty: {args.output_dir}. Pass --overwrite to replace.")
        for old in args.output_dir.glob("frame_*.png"):
            old.unlink()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    metadata = ffprobe_metadata(args.input)

    out_pattern = str(args.output_dir / args.pattern)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(args.input)]

    vf_parts: list[str] = []
    if args.crop:
        vf_parts.append(f"crop={args.crop}")
    if args.fps is not None:
        vf_parts.append(f"fps={args.fps}")
    if vf_parts:
        cmd += ["-vf", ",".join(vf_parts)]
    if args.start_number != 1:
        cmd += ["-start_number", str(args.start_number)]
    cmd += [out_pattern]

    run(cmd)

    extracted = sorted(args.output_dir.glob("frame_*.png"))
    report = {
        "input": str(args.input),
        "output_dir": str(args.output_dir),
        "output_pattern": args.pattern,
        "requested_fps": args.fps,
        "crop": args.crop,
        "mode": "constant-fps" if args.fps else "source-frame-passthrough",
        "source_metadata": metadata,
        "extracted_frame_count": len(extracted),
        "ffmpeg_cmd": " ".join(cmd),
    }
    (args.output_dir / "extraction_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("ffmpeg and ffprobe are required (install via Homebrew: brew install ffmpeg).")
    main()
