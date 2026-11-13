"""E6: graphics-clean - no scanline, noise, vignette, curvature or
interlace in any engine-drawn layer, ever (frame.css's own rule)."""

from __future__ import annotations

import pytest

from studio.graphics import clean


@pytest.mark.parametrize("snippet", [
    '<div class="scanline-overlay"></div>',
    '<div class="scan-line"></div>',
    "<style>.grain { background: url(noise.png); }</style>",
    '<filter><feTurbulence type="fractalNoise"/></filter>',
    '<div class="vignette"></div>',
    '<div style="filter: barrel-distort(0.2)"></div>',
    '<div class="curvature"></div>',
    '<div class="interlace-rows"></div>',
])
def test_forbidden_effects_are_caught(snippet):
    assert clean.find_forbidden_effects(snippet) != []
    with pytest.raises(clean.GraphicsNotClean):
        clean.assert_clean(snippet, where="test-layer")


def test_clean_markup_passes():
    html = '<div class="board-head"><span class="bc-caps">THE WEIGHT</span></div>'
    assert clean.find_forbidden_effects(html) == []
    clean.assert_clean(html, where="board")  # must not raise


def test_graphics_not_clean_names_the_layer_and_effect():
    try:
        clean.assert_clean('<div class="vignette"></div>', where="count-card cw-1")
    except clean.GraphicsNotClean as exc:
        assert "count-card cw-1" in str(exc)
        assert "vignette" in str(exc)
    else:
        pytest.fail("expected GraphicsNotClean")
