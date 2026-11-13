# Net-new in omnibus (E3).
"""The lint fixture (episode.py) as a film folder the engine can plan and render: test-pattern stills, the graphics as
ProRes 4444 clips with straight alpha at 30 fps (made by ffmpeg), a tone per voice line, the three news inputs and
the ledgers. Made at test time, never committed (R-08). Every picture is a test pattern, so every shot is DRAWN."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import episode as EP
from studio.engine.render import ffmpeg


def _still(path: Path, rgb) -> None:
    img = Image.new("RGB", (1920, 1080), rgb)
    d = ImageDraw.Draw(img)
    for k in range(0, 1920, 160):
        d.line([(k, 0), (k + 400, 1080)], fill=(rgb[0] // 2, rgb[1] // 2, rgb[2] // 2), width=9)
    img.save(path)


def _graphic(path: Path, frames: int, rgb, alpha: int) -> None:
    """A test graphic: an opaque band across the lower third, the rest at ``alpha`` (0: transparent)."""
    a = np.full((1080, 1920, 4), [*rgb, alpha], np.uint8)
    a[700:860, 120:1800, 3] = 255
    png = path.with_suffix(".png")
    Image.fromarray(a, "RGBA").save(png)
    r = subprocess.run([ffmpeg(), "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", str(png),
                        "-frames:v", str(frames), "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
                        str(path)], capture_output=True, text=True)
    png.unlink()
    if r.returncode:
        raise RuntimeError(r.stderr[-400:])


def tone(path: Path, seconds: float, hz: float = 440.0) -> None:
    import soundfile as sf
    t = np.arange(int(48000 * seconds)) / 48000
    x = 0.2 * np.sin(2 * np.pi * hz * t)
    x[(t < 0.25) | (t >= seconds - 0.25) | (np.abs(t - seconds / 2) < 0.1)] = 0.0
    sf.write(str(path), x.astype("float32"), 48000)


def make(dest: Path) -> Path:
    play, assets, inputs = EP.episode()
    media = dest / "media"
    media.mkdir(parents=True)
    items = []
    for aid, it in assets.items():
        it = dict(it, test_fixture=True, shows_bodies=False, drawn_kind="image")
        if it.get("kind") == "graphic":
            _graphic(media / it["file"], it["frames"], (40, 90, 160) if aid != "g-lt" else (200, 120, 40),
                     255 if aid != "g-lt" else 0)
        else:
            it["file"] = f"{aid}.png"
            _still(media / it["file"], (120, 100, 80))
        items.append(it)
    (dest / "ledger.json").write_text(json.dumps({"items": items}), encoding="utf-8")
    play["ledgers"] = {"media": {"path": "ledger.json", "media": "media"}}
    for v in play["cast"]["voices"]:            # test tones stand in for Kokoro, as in the engine's own fixture
        v.update(engine="test-tone", voice="none")
        v.pop("speed", None)
    for p in play["parts"]:
        for s in p.get("shots") or []:
            if s["kind"] == "archive_still":
                s.update(mark="DRAWN", preset="HOLD", fill_ok=True)
                s.pop("alterations", None)
        for ln in p.get("lines") or []:
            (dest / "audio").mkdir(exist_ok=True)
            tone(dest / "audio" / f"{ln['id']}.wav", float(ln["dur_s"]), 330.0 if ln["kind"] == "testimony" else 440.0)
    for name, key in (("week.json", "record"), ("rundown.json", "rundown"), ("echo-pick.json", "echo")):
        (dest / name).write_text(json.dumps(inputs[key]), encoding="utf-8")
    (dest / "screenplay.json").write_text(json.dumps(play, indent=1), encoding="utf-8")
    return dest
