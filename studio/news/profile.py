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

# E9i: the licence map. omnibus's rights ledger (scripts/rights.mjs) writes canonical licence ids
# (scripts/lib/rights/licences.mjs ALLOWED_IDS); the engine's allowlist (render.LICENCE_OK, LICENCE_SHARE_ALIKE) reads
# document's words. This is the one place an id is read as the engine's semantics, on a news show only, so a document
# film's licences are read exactly as before:
#
# - ``allowed``: the house allowlist (render.LICENCE_OK: public domain, CC0, CC BY);
# - ``share_alike``: CC BY-SA, allowed only in a screenplay that declares ``share_alike`` with its DECISIONS entry
#   (every omnibus episode is CC BY-SA 4.0, show bible f), journaled per asset as a decision.
#
# ``reads_as`` is the engine's word for the id, for the evidence; ``attribution`` whether the licence asks for the
# credit wherever the work is shown (CC BY and BY-SA, and the EU's reuse decision, whose credit is mandatory).
# own-property (void news's own printed pages, the same owner's publication: founder ruling 2026-11-12) is no
# licence anyone granted; it is allowed as our own work, shown as printed.
CC_VERSIONS = ("1.0", "2.0", "2.1", "2.5", "3.0", "4.0")      # as licences.mjs CC_VERSIONS
_LICENCES = {
    "pd-us-federal": {"as": "allowed", "reads_as": "public domain", "attribution": False,
                      "basis": "a work of the US federal government (17 U.S.C. 105)"},
    "pd-age": {"as": "allowed", "reads_as": "public domain", "attribution": False, "basis": "copyright expired"},
    "pd-dedication": {"as": "allowed", "reads_as": "public domain", "attribution": False,
                      "basis": "dedicated to the public domain by its author"},
    "cc0-1.0": {"as": "allowed", "reads_as": "CC0 1.0", "attribution": False, "basis": "CC0 1.0"},
    "eu-reuse-credit": {"as": "allowed", "reads_as": "CC BY 4.0", "attribution": True,
                        "basis": "EU reuse with mandatory credit (Commission Decision 2011/833/EU)"},
    "own-property": {"as": "allowed", "reads_as": None, "attribution": False,
                     "basis": "void news's own printed page, the same owner's publication (no licence granted)"},
    **{f"cc-by-{v}": {"as": "allowed", "reads_as": f"CC BY {v}", "attribution": True, "basis": f"CC BY {v}"}
       for v in CC_VERSIONS},
    **{f"cc-by-sa-{v}": {"as": "share_alike", "reads_as": f"CC BY-SA {v}", "attribution": True, "basis": f"CC BY-SA {v}"}
       for v in CC_VERSIONS},
}
LICENCES = MappingProxyType({k: MappingProxyType(v) for k, v in _LICENCES.items()})
LICENCE_SEMANTICS = ("allowed", "share_alike")


def is_news(play: dict | None) -> bool:
    """Whether the screenplay's show lints news (False for document, or for a show this module does not know)."""
    try:
        return bool(of(play)["news"])
    except ShowError:
        return False


def licence_reading(play: dict | None, lic) -> MappingProxyType | None:
    """How the screenplay's show reads a ledger licence id: the licence map's entry on a news show, None on document
    (whose licences the engine reads as before) or for an id the map does not hold (left to the house allowlist, so a
    studio-made item's "CC BY-SA 4.0" reads as it always has)."""
    if not is_news(play):
        return None
    return LICENCES.get(str(lic or "").strip())


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
