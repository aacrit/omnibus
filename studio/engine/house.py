"""Net-new (not from document). Where the lifted engine's design-dependency files live.

``studio/engine/maps.py`` reads ``design/tokens.css`` and three tests read ``design/brand-kit/*``
(docs/TRANSPLANT-document-engine.md): those files are document's own, authored for its own brand, and are never
merged into omnibus's own ``design/tokens.css`` (omnibus's tokens are its own; an omnibus-specific studio palette
is a later ticket, E3+). They are carried instead, unchanged, under ``studio/house/document/`` with their own
provenance headers, and every lifted module or test that needs one of them reads it through this one constant
(coordinator ruling 2026-11-12, after PR omnibus#10's gate failed on a missing ``--color-letterbox`` token) so
there is a single place that would need to change if document's engine is ever rebased to a newer sha.
"""
from __future__ import annotations

from pathlib import Path

HOUSE_ROOT = Path(__file__).resolve().parents[1] / "house" / "document"
