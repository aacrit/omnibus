# Net-new (not from document). Guards studio/house/document/ (docs/TRANSPLANT-document-engine.md,
# docs/DECISIONS.md 2026-11-12) against silent drift: motion.py's PALETTE is a set of literal RGB tuples
# (motion.py:45-52), each commented with the --doc-* custom property it was read off; studio/engine/maps.py's
# own resolve() (already used, unchanged, to read design tokens for a map) can recompute the same custom
# properties from studio/house/document/tokens.css, including the two oklch(from var()...) derived ones. If a
# later sync of studio/house/document/tokens.css ever drifts from motion.py's hard-coded copy, this is the test
# that catches it (reviewer finding, PR omnibus#10).
from __future__ import annotations

from studio.engine import house as HOUSE
from studio.engine import maps as MP
from studio.engine import motion as M


def _tokens() -> dict[str, str]:
    return MP.read_tokens(HOUSE.HOUSE_ROOT / "tokens.css")


def test_studio_house_document_tokens_css_exists_and_parses():
    tokens = _tokens()
    assert tokens["--doc-bone"] == "#ede2cf"
    assert "--mark-text" in tokens


def test_motions_hard_coded_primaries_match_the_house_tokens():
    tokens = _tokens()
    for role, token in (("bone", "--doc-bone"), ("safelight", "--doc-safelight"),
                        ("cold", "--doc-cold"), ("ink", "--doc-ink")):
        rgb = MP.resolve(token, tokens)[:3]
        assert M.PALETTE[role] == rgb, (role, token, M.PALETTE[role], rgb)


def test_mark_text_derived_token_matches_motions_hard_coded_value():
    # --mark-text: oklch(from var(--doc-bone) calc(l + 0.06) c h) - derived, not a literal in tokens.css.
    tokens = _tokens()
    rgb = MP.resolve("--mark-text", tokens)[:3]
    assert M.PALETTE["mark_text"] == rgb


def test_film_black_is_deliberately_not_the_theatre_black_token():
    # motion.py:45-48: on film, black is RGB 0,0,0 (founder ruling, the teaser), never --doc-black (#0f0c0a);
    # this is the one PALETTE entry this file does NOT expect to match studio/house/document/tokens.css.
    tokens = _tokens()
    assert M.PALETTE["black"] == (0, 0, 0)
    assert MP.resolve("--doc-black", tokens)[:3] != (0, 0, 0)
