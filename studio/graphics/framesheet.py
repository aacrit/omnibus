"""Frame sheets: the first, middle and last frame of every rendered layer,
each composited over a checkerboard so transparency shows (an overlay's
empty frame reads as checker, not as black). Pure PIL; the frames
themselves are decoded from the encoded .mov files by `encode.extract_frame`
in `render.py`, so the sheet shows what was actually written.
"""

from __future__ import annotations

from PIL import Image, ImageDraw


def checker(size: tuple[int, int], *, cell: int = 24, light: tuple[int, int, int] = (200, 200, 200),
            dark: tuple[int, int, int] = (150, 150, 150)) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, light)
    draw = ImageDraw.Draw(img)
    for y in range(0, h, cell):
        for x in range((y // cell) % 2 * cell, w, cell * 2):
            draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=dark)
    return img


def over_checker(frame: Image.Image, *, cell: int = 24) -> Image.Image:
    bg = checker(frame.size, cell=cell).convert("RGBA")
    bg.alpha_composite(frame.convert("RGBA"))
    return bg.convert("RGB")


def sheet(rows: list[tuple[str, list[tuple[str, Image.Image]]]], *, thumb: tuple[int, int] = (640, 360),
          label_h: int = 22, gap: int = 8) -> Image.Image:
    """`rows`: (layer name, [(frame caption, RGBA frame), ...]). Each frame
    is put over a checker at full size, then scaled to `thumb`."""
    cols = max(len(frames) for _, frames in rows)
    tw, th = thumb
    w = cols * tw + (cols + 1) * gap
    h = len(rows) * (th + label_h * 2 + gap) + gap
    out = Image.new("RGB", (w, h), (40, 40, 40))
    draw = ImageDraw.Draw(out)
    y = gap
    for name, frames in rows:
        draw.text((gap, y + 4), name, fill=(240, 240, 240))
        for c, (caption, frame) in enumerate(frames):
            x = gap + c * (tw + gap)
            out.paste(over_checker(frame).resize(thumb, Image.LANCZOS), (x, y + label_h))
            draw.text((x, y + label_h + th + 4), caption, fill=(220, 220, 220))
        y += th + label_h * 2 + gap
    return out
