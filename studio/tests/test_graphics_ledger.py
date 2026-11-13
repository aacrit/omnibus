"""E6: the graphics ledger (id, subtype, data_ref, source template sha256,
output path, output sha256, frames, class DRAWN)."""

from __future__ import annotations

import json

import pytest

from studio.graphics import ledger


def test_build_entry_hashes_template_and_output():
    entry = ledger.build_entry(id="tc-week", subtype="testcard", data_ref="rundown:the-week.testcard",
                                template_html="<html>hi</html>", output_path="D:/fake/tc-week.mov",
                                frames=54, output_bytes=b"not-really-a-mov")
    assert entry.id == "tc-week"
    assert entry.cls == "DRAWN"
    assert entry.source_template_sha256 == ledger.sha256_text("<html>hi</html>")
    assert entry.output_sha256 == ledger.sha256_bytes(b"not-really-a-mov")
    assert entry.frames == 54


def test_entry_rejects_zero_frames():
    with pytest.raises(ValueError):
        ledger.build_entry(id="x", subtype="testcard", data_ref="r", template_html="<a></a>",
                            output_path="p", frames=0, output_bytes=b"x")


def test_entry_class_is_always_drawn():
    with pytest.raises(ValueError):
        ledger.LedgerEntry(id="x", subtype="t", data_ref="r", source_template_sha256="a",
                            output_path="p", output_sha256="b", frames=1, cls="RECONSTRUCTED")


def test_write_and_read_ledger_round_trips(tmp_path):
    entries = [
        ledger.build_entry(id="a", subtype="testcard", data_ref="r1", template_html="<a/>",
                            output_path="p1", frames=10, output_bytes=b"1"),
        ledger.build_entry(id="b", subtype="board", data_ref="r2", template_html="<b/>",
                            output_path="p2", frames=20, output_bytes=b"22"),
    ]
    path = tmp_path / "graphics-ledger.json"
    ledger.write_ledger(entries, path)
    rows = ledger.read_ledger(path)
    assert len(rows) == 2
    assert rows[0]["id"] == "a"
    assert rows[0]["class"] == "DRAWN"
    assert rows[1]["frames"] == 20
    # Valid JSON, not just valid Python.
    json.loads(path.read_text(encoding="utf-8"))


def test_sha256_file_matches_known_bytes(tmp_path):
    p = tmp_path / "f.bin"
    p.write_bytes(b"hello world")
    import hashlib
    assert ledger.sha256_file(p) == hashlib.sha256(b"hello world").hexdigest()
