"""The only module that shells out to ffmpeg. Streams a frame sequence
(RGBA PIL Images from `compose.py`'s generators) to ProRes 4444 with
alpha, 30 fps, at the given path on D:. Frames go to ffmpeg's stdin as raw
RGBA, one at a time: no PNG sequence on disk (C: runs near its floor) and
no frame list in memory.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable

FPS = 30


def encode_prores(frames: Iterable, out_path: str | Path, *, size: tuple[int, int] = (1920, 1080), fps: int = FPS,
                  ffmpeg: str = "ffmpeg") -> int:
    """Returns the frame count written. Raises `ValueError` on an empty
    sequence or a frame of the wrong size, and `RuntimeError` on a
    non-zero ffmpeg exit (never silently drops a frame or exits 0 on
    failure)."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    w, h = size
    cmd = [
        ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}",
        "-r", str(fps), "-i", "-",
        "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "ap10", str(out_path),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    count = 0
    try:
        for frame in frames:
            if frame.size != (w, h):
                raise ValueError(f"frame {count} is {frame.size}, expected {size}")
            proc.stdin.write(frame.convert("RGBA").tobytes())
            count += 1
    except BaseException:
        proc.kill()
        proc.wait()
        raise
    _, err = proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}) encoding {out_path}:\n{err.decode(errors='replace')[-4000:]}")
    if count == 0:
        raise ValueError("encode_prores needs at least one frame")
    return count


def extract_frame(mov: str | Path, index: int, out_png: str | Path, *, ffmpeg: str = "ffmpeg") -> None:
    """Decodes frame `index` (0-based) of `mov` to an RGBA PNG, alpha kept."""
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", str(mov), "-vf", f"select=eq(n\\,{index})",
           "-fps_mode", "passthrough", "-frames:v", "1", "-pix_fmt", "rgba", str(out_png)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not Path(out_png).exists():
        raise RuntimeError(f"ffmpeg could not extract frame {index} of {mov}:\n{result.stderr[-2000:]}")


def ffmpeg_available(ffmpeg: str = "ffmpeg") -> bool:
    return shutil.which(ffmpeg) is not None
