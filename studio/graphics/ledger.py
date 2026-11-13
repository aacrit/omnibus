"""The graphics ledger: one row per rendered graphic (id, subtype,
data_ref, the source template's sha256, the output path on D:, the
output file's sha256, its frame count, and its class, which is always
DRAWN - every pixel here is typeset or composited by code, never a
photograph or a model). Pure except `sha256_file`, which only reads
bytes off disk (no network, no subprocess).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path

CLASS_DRAWN = "DRAWN"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass(frozen=True)
class LedgerEntry:
    id: str
    subtype: str
    data_ref: str
    source_template_sha256: str
    output_path: str
    output_sha256: str
    frames: int
    cls: str = CLASS_DRAWN

    def __post_init__(self):
        if self.cls != CLASS_DRAWN:
            raise ValueError(f"graphics ledger entries are always {CLASS_DRAWN}, got {self.cls!r}")
        if self.frames < 1:
            raise ValueError(f"{self.id}: frames must be >= 1, got {self.frames}")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["class"] = d.pop("cls")
        return d


def build_entry(*, id: str, subtype: str, data_ref: str, template_html: str, output_path: str | Path,
                 frames: int, output_bytes: bytes | None = None) -> LedgerEntry:
    """``output_bytes`` lets a test build an entry without touching disk;
    the real render pipeline passes the encoded media's bytes (or reads
    them from ``output_path`` if omitted and the file exists)."""
    if output_bytes is not None:
        out_hash = sha256_bytes(output_bytes)
    else:
        out_hash = sha256_file(output_path)
    return LedgerEntry(
        id=id,
        subtype=subtype,
        data_ref=data_ref,
        source_template_sha256=sha256_text(template_html),
        output_path=str(output_path),
        output_sha256=out_hash,
        frames=frames,
    )


def write_ledger(entries: list[LedgerEntry], path: str | Path) -> None:
    payload = [e.to_dict() for e in entries]
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_ledger(path: str | Path) -> list[dict]:
    return json.loads(Path(path).read_text(encoding="utf-8"))
