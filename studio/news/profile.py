# Net-new in omnibus (E3).
"""Show profiles: what an omnibus episode does differently from a document film, read in one place.

A screenplay names its show with a top-level ``show`` ("document" when absent, so every document-shaped film and
every lifted engine test behaves exactly as it did in document@b62c4fa). The profile carries:

- ``wordmark`` and ``tagline``: the brand the title card and the lockup card draw (motion.py), and the studio name
  the credits roll prints;
- ``masters``: the master frame rates cadence.py accepts (A44). document keeps 24 and 30000/1001; omnibus adds 30/1
  (the plan's 30 fps, census item A44);
- ``target_lufs`` / ``target_tp``: the programme loudness (document -18 LUFS, omnibus -16 LUFS, both -1.5 dBTP; show
  bible g);
- the public pages a description and sources.json link to: document's ``/f/<slug>/sources/``, omnibus's charter
  shape ``/e/<issue>/sources`` (CHARTER.md);
- ``news``: whether the news lints (studio/news/lints.py) bind.

Pure data and pure functions, no I/O.
"""

from __future__ import annotations

from types import MappingProxyType

DEFAULT = "document"

_PROFILES = {
    "document": {
        "show": "document",
        "wordmark": ("void", "document"),
        "tagline": "As It Was",
        "studio": "void document studio",
        "site": "https://document.voidvision.org",
        "sources_path": "/f/{key}/sources/",
        "correct_path": "/f/{key}/correct/",
        "page_key": "slug",
        "target_lufs": -18.0,
        "target_tp": -1.5,
        "masters": ("24", "30000/1001"),
        "news": False,
    },
    "omnibus": {
        "show": "omnibus",
        "wordmark": ("void", "omnibus"),
        "tagline": "The week, weighed.",
        "studio": "void omnibus studio",
        "site": "https://omnibus.voidvision.org",
        "sources_path": "/e/{key}/sources",
        "correct_path": "/e/{key}/correct",
        "page_key": "issue",
        "target_lufs": -16.0,
        "target_tp": -1.5,
        "masters": ("24", "30000/1001", "30"),
        "news": True,
    },
}
PROFILES = MappingProxyType({k: MappingProxyType(v) for k, v in _PROFILES.items()})


class ShowError(ValueError):
    pass


def of(play: dict | None) -> MappingProxyType:
    """The profile a screenplay names (``show``), document's when it names none. An unknown show raises ShowError."""
    name = (play or {}).get("show", DEFAULT)
    if name is None:
        name = DEFAULT
    if not isinstance(name, str) or name not in PROFILES:
        raise ShowError(f"show must be one of {sorted(PROFILES)}, not {name!r}")
    return PROFILES[name]


def problems(play: dict | None) -> list[str]:
    """Why the screenplay's show declaration cannot be used, one line each ([] when it can)."""
    try:
        prof = of(play)
    except ShowError as e:
        return [str(e)]
    key = page_key(prof, play or {})
    if prof["page_key"] == "issue" and not (isinstance(key, str) and key.isdigit()):
        return [f"an {prof['show']} screenplay names its issue (a whole number): its pages are "
                f"{prof['site']}{prof['sources_path'].format(key='<issue>')}"]
    return []


def page_key(prof, play: dict) -> str | None:
    """The key the show's public pages are addressed by: document's slug, omnibus's issue number."""
    v = play.get(prof["page_key"])
    if isinstance(v, bool) or v is None:
        return None
    return str(v).strip() or None


def sources_url(prof, key: str) -> str:
    return prof["site"] + prof["sources_path"].format(key=key)


def correct_url(prof, key: str) -> str:
    return prof["site"] + prof["correct_path"].format(key=key)


def wordmark_text(prof) -> str:
    return " ".join(prof["wordmark"])


def lockup_text(prof) -> str:
    return f"{wordmark_text(prof)} · {prof['tagline']}"


def record(prof, play: dict) -> dict:
    """The show as sources.json records it: description.py writes its links and brand from this, never from a
    constant, so a description can never point at another show's site."""
    key = page_key(prof, play) or ""
    return {"show": prof["show"], "site": prof["site"], "key": key,
            "sources_page": sources_url(prof, key), "correct_page": correct_url(prof, key),
            "wordmark": wordmark_text(prof), "studio": prof["studio"],
            "target_lufs": prof["target_lufs"], "target_tp": prof["target_tp"]}


def masters(play: dict | None) -> tuple[str, ...]:
    """The master rates the screenplay's show accepts, as cadence.py names them."""
    try:
        return tuple(of(play)["masters"])
    except ShowError:
        return tuple(PROFILES[DEFAULT]["masters"])
