"""The only module that shells out to ffmpeg. Writes a frame sequence
(RGBA PIL Images, already built by `motion.py`'s callers) to ProRes 4444
(alpha kept where any frame has one), 30 fps, at the given path on D:.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

FPS = 30


def encode_prores(frames: list, out_path: str | Path, *, fps: int = FPS, ffmpeg: str = "ffmpeg") -> int:
    """`frames` is a list of PIL Images (RGBA for alpha, RGB otherwise),
    all the same size. Returns the frame count written. Raises
    `RuntimeError` on a non-zero ffmpeg exit (never silently drops a
    frame or exits 0 on failure)."""
    if not frames:
        raise ValueError("encode_prores needs at least one frame")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    has_alpha = frames[0].mode == "RGBA"
    with tempfile.TemporaryDirectory(prefix="omnibus-graphics-") as tmp:
        tmp_dir = Path(tmp)
        for i, frame in enumerate(frames):
            frame.save(tmp_dir / f"f{i:06d}.png")
        pix_fmt = "yuva444p10le" if has_alpha else "yuv444p10le"
        profile = "4" if has_alpha else "3"
        cmd = [
            ffmpeg, "-y", "-framerate", str(fps), "-i", str(tmp_dir / "f%06d.png"),
            "-c:v", "prores_ks", "-profile:v", profile, "-pix_fmt", pix_fmt,
            "-vendor", "ap10", str(out_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed ({result.returncode}) encoding {out_path}:\n{result.stderr[-4000:]}")
    return len(frames)


def ffmpeg_available(ffmpeg: str = "ffmpeg") -> bool:
    return shutil.which(ffmpeg) is not None
