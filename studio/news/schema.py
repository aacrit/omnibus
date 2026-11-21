# Net-new in omnibus (E3).
"""The omnibus screenplay's own fields, checked at plan time. Pure: no I/O.

Show bible v2, section o (ticket 1, the schema spine). What an omnibus screenplay (``show: "omnibus"``,
studio/news/profile.py) adds to screenplay v2 (GRAMMAR 12):

- top level: ``issue``; ``as_of``, the edition's cutoff; ``news`` naming its inputs (``week``, ``rundown``,
  ``echo_pick``, each relative to the film folder or, failing that, to the repo root) and stating the edition
  (``news-fields``): ``news.edition`` {issue, cutoff_utc, archive_commit} (``as_of`` is the cutoff, the commit the
  pinned archive's), ``news.clusters[]`` {id, rank, weight, slot} (slot ``lead``, ``package_<n>`` or ``brief_<n>``),
  ``news.desk_credit`` (the fixed string, bible k) and ``news.coi`` (a bool: a story touches Anthropic or an AI lab,
  bible m);
- each part: ``segment`` (one of SEGMENTS). The spine (``segment-spine``): the clock first, the credits last, the
  parts in SEGMENTS order, every segment present and once, except ``package``, which repeats (3 or 4 of them:
  ``package-count`` advises outside that). A label is trusted only where the order puts it (``segments``): an
  exemption is read from that checked order, never from a part's own label or ``kind``, so a news part labelled
  ``credits`` or ``clock`` is still linted as news. A part's own ``as_of`` is optional, and The Echo's is required
  (its own century; bible k: one horizon for the news parts, the cutoff). A lead or package part may state its
  ``shape`` (``full`` or ``document``, the rundown story's): a quote card is allowed only in a document package and
  in The Echo (bible i);
- lines (``line-schema``): ``kind`` in LINE_KINDS. ``vo`` is the narrator; ``read`` a document, translation or period
  voice read by the reader (``quote_sha256`` and ``read_by``: ``reader-quote-sha``, ``reader-read-by``); ``sot`` a
  sound bite in the speaker's own voice (``speaker``, ``shot_ref`` to the part's ``archive_video`` shot whose
  ``sound.role`` is ``sot``, the bite's ``in_s``/``out_s`` inside the transcript's timing, a ``transcript_ref`` on the
  line or on its shot's sound, and no ``read_by``); ``signon`` only in the title, ``signoff`` only in the sign-off,
  whose one line it is;
- shots: the kinds are unchanged. Every ``archive_video`` states ``sound`` (``sound-role``): ``role`` in SOUND_ROLES
  and ``translation`` in TRANSLATIONS; ``muted`` with its ``mute_reason`` (a sentence), and a clip the rights ledger
  airs muted is never played as ``sot`` or ``nat``; ``sot`` with its ``lang`` (an English bite is ``translation:
  none``, any other ``official`` or ``ours``). Every ``card`` states ``card`` in CARD_KINDS (``card-kind``): a
  ``count`` declares its ``figures``, a ``quote`` is ``quote: true``; the one house card is the ident card (the
  engine's ``lockup``), in the title and the sign-off only;
- the ``graphic`` kind (studio/news/graphic.py), as a shot (full frame) or a part's text element (over a picture):
  ``subtype`` (graphic.SUBTYPES), ``asset`` (its graphics-ledger item), ``data_ref`` for the subtypes that draw
  figures, and ``shows``: what it puts on screen, as data the lints read (``lines`` of our own text, ``figures``
  [{value, field}], ``title_lines`` and ``week_line``). A bumper is the first shot of the briefs or of The Echo and
  shows its segment's word; an SOT super shows two or three lines, the third a translation or party label; a brief
  strip shows one line and lives in the tease or the briefs;
- the alteration ``text composited`` (type laid over an archival picture: the title's teleprinter) is allowed, and a
  shot that names any alteration is RECONSTRUCTED;
- every ``silence: intended`` moment (a shot, a part, a cue or a top-level ``moments`` entry) states its ``reason``.

V1 ONLY (frozen): issue 33 was written to the v1 bible (The Week, The Weight, The Margins, The Question, the framings
board, v1's ``narration``/``testimony`` lines). Its files stay in the repo as a frozen regression fixture, read
through the V1 spine below, which only the issues in V1_ISSUES select: no new screenplay can opt into it. The v2-only
checks (``news-fields``, ``line-schema``, ``sound-role``, ``card-kind``, ``package-count``) bind on v2 only. The lints
the v2 bible kills (``board-rule``, ``tour-no-claim-before-board``, ``ending-question``, ``title-lines-verbatim``,
``fair-use-excerpt``, ``fair-use-on-timeline``) are gone for both, and ``fair-use-refused`` holds both.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from studio.news import graphic as G
from studio.news import profile as SHOW

GRAMMAR = "omnibus bible v2 o"
SEGMENTS = ("clock", "tease", "title", "lead", "package", "briefs", "echo", "signoff", "credits")
NEWS_SEGMENTS = ("tease", "lead", "package", "briefs")      # bible j: no music under news
REPEATS = ("package",)                                       # every other segment runs exactly once
PACKAGES_MIN, PACKAGES_MAX = 3, 4                           # packages 2 to 4, and 5 when it clears the cap (advise)
AS_OF_EXEMPT = ("clock", "credits")
AS_OF_OWN = ("echo",)                                        # the one part with its own horizon (bible k)
SPINE_ONCE = ("clock", "credits")                            # first and last
LINE_KINDS = ("vo", "sot", "read", "signon", "signoff")
NARRATOR_KINDS = ("vo", "signon", "signoff", "narration")    # the narrator's voice ("narration": the engine's and v1's)
READER_KINDS = ("read",)
ENGINE_LINE_KIND = {"vo": "narration", "signon": "narration", "signoff": "narration", "read": "testimony",
                    "sot": "testimony"}                      # how the lifted engine's A0 surfaces read a v2 line
LINE_SEGMENTS = {"signon": ("title",), "signoff": ("signoff",)}
SOUND_ROLES = ("sot", "nat", "muted")
TRANSLATIONS = ("official", "ours", "none")
CARD_KINDS = ("count", "quote")
HOUSE_CARDS = ("lockup",)                                    # the ident card (bible d, h): the engine's lockup card,
HOUSE_CARD_SEGMENTS = ("title", "signoff")                   # in the title and the sign-off only
QUOTE_CARD_SEGMENTS = ("echo",)                              # and a lead or package part of shape document
PART_SHAPES = ("full", "document")
SHAPED_SEGMENTS = ("lead", "package")
DOT_LABEL_WORDS = ("RELEASED BY", "PUBLISHED", "FILMED", "PHOTOGRAPHED", "OUR TRANSLATION")   # bible o's new labels
DESK_CREDIT = "Research desk: void news"                     # bible k: the one credits line, never read on screen
SLOT_RE = re.compile(r"^(?:lead|package_[1-9]\d*|brief_[1-9]\d*)$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
CUTOFF_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$")
LANG_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
TEXT_COMPOSITED = "text composited"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REASON_MIN_WORDS = 4
SHOWS_KEYS = {"lines", "figures", "title_lines", "week_line"}
# An ISO date (YYYY-MM-DD) or a date-time with a zone (Z or +hh:mm): a part's horizon is an instant, or a whole day
AS_OF_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$")

# V1 ONLY (frozen, issue 33): the v1 bible's spine, read for the frozen regression fixture and nothing else.
V1_ISSUES = (33,)
V1_SEGMENTS = ("clock", "cold_open", "title", "week", "weight", "echo", "margins", "question", "credits")
V1_NEWS_SEGMENTS = ("cold_open", "week", "weight", "margins")
V1_SHOWS_KEYS = {"lines", "figures", "rows", "headlines", "title_lines", "week_line"}


@dataclass(frozen=True)
class Spine:
    name: str
    segments: tuple
    news: tuple
    repeats: tuple
    subtypes: tuple
    overlay: tuple
    data: tuple
    figure: tuple
    shows_keys: frozenset


V2 = Spine("v2", SEGMENTS, NEWS_SEGMENTS, REPEATS, G.SUBTYPES, G.OVERLAY_SUBTYPES, G.DATA_SUBTYPES,
           G.FIGURE_SUBTYPES, frozenset(SHOWS_KEYS))
V1 = Spine("v1-frozen", V1_SEGMENTS, V1_NEWS_SEGMENTS, tuple(x for x in V1_SEGMENTS if x not in SPINE_ONCE),
           G.V1_SUBTYPES, G.V1_OVERLAY_SUBTYPES, G.V1_DATA_SUBTYPES, G.V1_FIGURE_SUBTYPES, frozenset(V1_SHOWS_KEYS))


def spine(play: dict) -> Spine:
    """The spine a screenplay is read by: v2, except the frozen issues (V1_ISSUES), which keep v1's."""
    iss = play.get("issue") if isinstance(play, dict) else None
    return V1 if isinstance(iss, int) and not isinstance(iss, bool) and iss in V1_ISSUES else V2


def _check(rule, ok, *, unit=None, severity="block", evidence=None) -> dict:
    return {"rule": rule, "ok": bool(ok), "unit": unit, "severity": severity, "evidence": evidence, "grammar": GRAMMAR}


def _words(text) -> int:
    return len(re.findall(r"[A-Za-z']+", text)) if isinstance(text, str) else 0


def is_news(play: dict) -> bool:
    try:
        return bool(SHOW.of(play)["news"])
    except SHOW.ShowError:
        return False


def is_reader_line(ln: dict) -> bool:
    """A line a computer voice reads as a quotation: a v2 ``read`` line, or (v1, issue 33) a testimony that plays no
    clip."""
    k = ln.get("kind")
    return k in READER_KINDS or (k == "testimony" and not ln.get("clip") and not ln.get("archival_audio"))


def reader_lines(play: dict) -> list[tuple[dict, dict]]:
    """(part, line) for every line a computer voice reads as a quotation."""
    return [(p, ln) for p in play.get("parts") or [] for ln in p.get("lines") or [] if is_reader_line(ln)]


def engine_line(ln: dict) -> dict:
    """A v2 line as the lifted engine's A0 surfaces read it (``vo``, ``signon`` and ``signoff`` are narration; ``read``
    and ``sot`` are quotations, testimony), its own kind kept as ``news_kind``. A v1 or engine line is returned as is."""
    k = ln.get("kind")
    return dict(ln, kind=ENGINE_LINE_KIND[k], news_kind=k) if k in ENGINE_LINE_KIND else ln


def engine_sound(sound):
    """A v2 shot ``sound`` as the engine's clip sound reads it: ``role: muted`` is the engine's ``mode: mute`` (a
    stated mode is kept, and ``sound-role`` holds it to the role); anything else is returned as is."""
    if isinstance(sound, dict) and sound.get("role") == "muted" and "mode" not in sound:
        return dict(sound, mode="mute", reason=sound.get("mute_reason"))
    return sound


def segments(play: dict) -> list[str | None]:
    """Each part's segment as the checked order trusts it (aligned with ``parts``), None where it does not: a label
    outside the spine's segments, a clock that is not the first part, credits that are not the last, or a part off
    the longest run of labels in the spine's order (only the spine's repeating segments repeat). Every exemption
    reads this, never a part's own label or kind, so a mislabelled news part is still linted as news."""
    sp = spine(play)
    parts = play.get("parts") or []
    n = len(parts)
    rank = {x: i for i, x in enumerate(sp.segments)}
    labels = [p.get("segment") if isinstance(p, dict) and isinstance(p.get("segment"), str) else None for p in parts]
    cand = [k for k, x in enumerate(labels) if x in rank and not (x == "clock" and k != 0)
            and not (x == "credits" and k != n - 1)]
    best, prev = [1] * len(cand), [-1] * len(cand)
    for a in range(len(cand)):
        ra = rank[labels[cand[a]]]
        for b in range(a):
            rb = rank[labels[cand[b]]]
            if (rb < ra or (rb == ra and labels[cand[a]] in sp.repeats)) and best[b] + 1 > best[a]:
                best[a], prev[a] = best[b] + 1, b
    out: list[str | None] = [None] * n
    if cand:
        k = max(range(len(cand)), key=lambda i: (best[i], -i))
        while k != -1:
            out[cand[k]] = labels[cand[k]]
            k = prev[k]
    return out


def spine_problems(play: dict) -> list[str]:
    """Why the parts do not run as the bible's spine, one line each ([] when they do)."""
    sp = spine(play)
    parts = play.get("parts") or []
    if not parts:
        return ["the screenplay has no parts"]
    labels = [p.get("segment") if isinstance(p, dict) else None for p in parts]
    trusted = segments(play)
    out = []
    if labels[0] != "clock":
        out.append(f"the first part is the clock, not {labels[0]!r}")
    if labels[-1] != "credits":
        out.append(f"the last part is the credits, not {labels[-1]!r}")
    for seg in sp.segments:
        if seg in sp.repeats:
            continue
        c = labels.count(seg)
        if c > 1:
            out.append(f"{c} parts are labelled {seg}: there is exactly one")
        elif c == 0 and sp is V2:
            out.append(f"no part is labelled {seg}: the rundown runs every segment of {list(sp.segments)}")
    if sp is V2 and "package" not in labels:
        out.append("no part is labelled package: the lead is followed by its packages (bible b)")
    for p, lab, t in zip(parts, labels, trusted):
        if lab in sp.segments and t is None:
            out.append(f"part {p.get('id')} ({lab}) is out of the spine's order {list(sp.segments)}: it is linted as news")
    return out


def graphic_problems(x: dict, item: dict | None, *, overlay: bool, sp: Spine = V2, segment: str | None = None,
                     first: bool = False) -> list[str]:
    """Why a graphic shot (or, with ``overlay``, a graphic text element) is malformed, one line each. ``segment`` is
    the part's trusted segment (None: linted as news) and ``first`` whether the shot opens its part."""
    out = []
    sub = x.get("subtype")
    allowed = sp.overlay if overlay else tuple(s for s in sp.subtypes if s not in ("sot_super", "brief_strip"))
    if sub not in allowed:
        out.append(f"subtype must be one of {list(allowed)}, not {sub!r}")
    if not x.get("asset"):
        out.append("a graphic cites its pre-rendered clip as its asset (the graphics ledger)")
    elif item is None:
        out.append(f"asset {x.get('asset')!r} is in no ledger")
    if not overlay and x.get("mark") != "DRAWN":
        out.append(f"a graphic is DRAWN, not {x.get('mark')!r}")
    if sub in sp.data and not (isinstance(x.get("data_ref"), str) and x["data_ref"].strip()):
        out.append(f"a {sub} graphic draws figures from the record, so it names its data_ref")
    shows = x.get("shows")
    if shows is not None:
        if not isinstance(shows, dict):
            out.append("shows is an object")
        else:
            extra = sorted(set(shows) - sp.shows_keys)
            if extra:
                out.append(f"shows has unknown keys {extra} (known: {sorted(sp.shows_keys)})")
    sh = shows if isinstance(shows, dict) else {}
    lines = sh.get("lines") if isinstance(sh.get("lines"), list) else []
    if sub in sp.figure and not (isinstance(sh.get("figures"), list) and sh["figures"]):
        out.append(f"a {sub} graphic declares the figures it draws (shows.figures: at least one {{value, field}}), so "
                   "counts-match can hold them to the record")
    if sp is V1 and sub == "board" and not (isinstance(sh.get("rows"), list) and sh["rows"]):
        out.append("a board declares the rows it shows (shows.rows)")              # V1 ONLY (frozen, issue 33)
    if sp is V2:
        if sub == "bumper":
            word = G.BUMPER_WORDS.get(segment)
            if word is None or not first:
                out.append(f"a bumper is the first shot of the briefs or of The Echo ({sorted(G.BUMPER_WORDS)}), not "
                           f"{'a later shot of ' if word and not first else ''}{segment or 'an untrusted part'}")
            elif not lines or str(lines[0]) != word:
                out.append(f"a bumper in {segment} shows its segment's word {word!r} as its first line (shows.lines)")
        if sub == "sot_super":
            if not 2 <= len(lines) <= 3 or not all(isinstance(v, str) and v.strip() for v in lines):
                out.append("an SOT super shows the speaker's name and role, and an optional third line (shows.lines: "
                           "two or three lines)")
            elif len(lines) == 3 and not str(lines[2]).startswith(G.SOT_SUPER_LABELS):
                out.append(f"an SOT super's third line is a translation or party label, starting one of "
                           f"{list(G.SOT_SUPER_LABELS)}, not {lines[2]!r}")
        if sub == "brief_strip":
            if len(lines) != 1 or not (isinstance(lines[0], str) and lines[0].strip()):
                out.append("a brief strip shows one line, the place and date (shows.lines)")
            if segment not in G.BRIEF_STRIP_SEGMENTS:
                out.append(f"a brief strip runs in the tease or the briefs, not {segment or 'an untrusted part'}")
    if item is not None:
        alpha = item.get("alpha")
        if alpha not in (None, False) and alpha not in G.ALPHA_MODES:
            out.append(f"alpha must be 'straight' (or absent for an opaque clip), not {alpha!r}: loom and the overlay "
                       "pass read alpha straight")
        if overlay and alpha not in G.ALPHA_MODES:
            out.append("a graphic drawn over a picture needs a straight alpha (alpha: 'straight')")
        if G.rate_of(item) is None:
            out.append(f"the clip's fps must be 24, 30000/1001 or 30, not {item.get('fps')!r}")
        if not isinstance(item.get("frames"), int) or isinstance(item.get("frames"), bool) or item["frames"] <= 0:
            out.append("the clip states its frame count (frames)")
    if overlay:
        try:
            if not float(x["end_s"]) > float(x["start_s"]):
                out.append("end_s is after start_s")
        except (KeyError, TypeError, ValueError):
            out.append("a graphic over a picture states start_s and end_s")
    return out


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _cutoff(value):
    if not (isinstance(value, str) and CUTOFF_RE.match(value)):
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def news_field_problems(play: dict) -> dict[str, list[str]]:
    """Why each v2 episode field (``news.edition``, ``news.clusters``, ``news.desk_credit``, ``news.coi``) is malformed,
    keyed by its path ([] where it holds)."""
    news = play.get("news") if isinstance(play.get("news"), dict) else {}
    out: dict[str, list[str]] = {}
    ed, probs = news.get("edition"), []
    if not isinstance(ed, dict):
        probs.append("news.edition states the edition: {issue, cutoff_utc, archive_commit}")
    else:
        if ed.get("issue") != play.get("issue") or isinstance(ed.get("issue"), bool):
            probs.append(f"news.edition.issue is the screenplay's issue {play.get('issue')!r}, not {ed.get('issue')!r}")
        cut = _cutoff(ed.get("cutoff_utc"))
        if cut is None:
            probs.append(f"news.edition.cutoff_utc is the pinned commit's time in UTC (YYYY-MM-DDThh:mm[:ss]Z), not "
                         f"{ed.get('cutoff_utc')!r}")
        else:
            try:
                a = dt.datetime.fromisoformat(str(play.get("as_of")).replace("Z", "+00:00"))
                same = a.tzinfo is not None and a == cut
            except ValueError:
                same = False
            if not same:
                probs.append(f"as_of is the cutoff ({ed['cutoff_utc']}), not {play.get('as_of')!r} (bible o)")
        if not (isinstance(ed.get("archive_commit"), str) and COMMIT_RE.match(ed["archive_commit"])):
            probs.append("news.edition.archive_commit is the pinned archive commit (40 hex characters)")
    out["news.edition"] = probs
    cl, probs = news.get("clusters"), []
    if not (isinstance(cl, list) and cl):
        probs.append("news.clusters lists the issue's clusters: [{id, rank, weight, slot}]")
    else:
        seen = set()
        for k, c in enumerate(cl):
            if not isinstance(c, dict):
                probs.append(f"news.clusters[{k}] is an object")
                continue
            cid = c.get("id")
            if not (isinstance(cid, str) and cid.strip()):
                probs.append(f"news.clusters[{k}] names its id")
            elif cid in seen:
                probs.append(f"news.clusters[{k}]: cluster {cid!r} is listed twice")
            seen.add(cid)
            if not (isinstance(c.get("rank"), int) and not isinstance(c.get("rank"), bool) and c["rank"] >= 1):
                probs.append(f"news.clusters[{k}].rank is a whole number from 1")
            if not _is_num(c.get("weight")):
                probs.append(f"news.clusters[{k}].weight is the reproduced score (a number)")
            if not (isinstance(c.get("slot"), str) and SLOT_RE.match(c["slot"])):
                probs.append(f"news.clusters[{k}].slot is lead, package_<n> or brief_<n>, not {c.get('slot')!r}")
    out["news.clusters"] = probs
    out["news.desk_credit"] = [] if news.get("desk_credit") == DESK_CREDIT else [
        f"news.desk_credit is the fixed string {DESK_CREDIT!r} (bible k), not {news.get('desk_credit')!r}"]
    out["news.coi"] = [] if isinstance(news.get("coi"), bool) else [
        "news.coi states whether a story touches Anthropic or an AI lab (true or false, bible m)"]
    return out


def sound_problems(s: dict, item: dict | None) -> list[str]:
    """Why an ``archive_video`` shot's v2 ``sound`` is malformed, one line each."""
    snd = s.get("sound")
    if not isinstance(snd, dict):
        return [f"an archive_video states its sound: {{role: {'|'.join(SOUND_ROLES)}, translation, ...}}"]
    out = []
    role = snd.get("role")
    if role not in SOUND_ROLES:
        out.append(f"sound.role is one of {list(SOUND_ROLES)}, not {role!r}")
    tr = snd.get("translation")
    if tr not in TRANSLATIONS:
        out.append(f"sound.translation is one of {list(TRANSLATIONS)}, not {tr!r}")
    mode = snd.get("mode")
    if role == "muted":
        if _words(snd.get("mute_reason")) < REASON_MIN_WORDS:
            out.append(f"a muted clip states its mute_reason (a sentence, at least {REASON_MIN_WORDS} words: a music "
                       "bed in the source, an agency voice, a dignity exclusion)")
        if mode not in (None, "mute"):
            out.append(f"a muted clip's engine mode is mute, not {mode!r}")
    elif role in ("sot", "nat"):
        if mode == "mute":
            out.append(f"a {role} clip plays its own sound: its engine mode is not mute")
        a = (item or {}).get("audio")
        if isinstance(a, dict) and a.get("mode") == "muted":
            out.append(f"the rights ledger airs {s.get('asset')!r} muted, so it is never {role}: state role muted with "
                       "the ledger's reason")
    if role == "sot":
        lang = snd.get("lang")
        if not (isinstance(lang, str) and LANG_RE.match(lang)):
            out.append(f"an sot clip states the bite's language (lang, an ISO 639 code), not {lang!r}")
        elif tr in TRANSLATIONS:
            english = lang == "en" or lang.startswith("en-")
            if english and tr != "none":
                out.append("an English bite has no translation (translation: none)")
            if not english and tr == "none":
                out.append(f"a bite in {lang!r} is translated: official (the party's transcript) or ours")
    elif snd.get("transcript_ref") is not None and role != "sot":
        out.append("only an sot clip names a transcript_ref")
    return out


def card_problems(s: dict, segment: str | None, part: dict) -> list[str]:
    """Why a v2 ``card`` shot is malformed, one line each (bible i: a card is a count or a quote)."""
    k = s.get("card")
    if k in HOUSE_CARDS and segment in HOUSE_CARD_SEGMENTS:
        return []                             # the ident card, drawn whole by the engine
    if k not in CARD_KINDS:
        return [f"a card is one of {list(CARD_KINDS)} (card), not {k!r}: headline and consensus cards are gone"
                + (f"; the {k} card runs only in {list(HOUSE_CARD_SEGMENTS)}" if k in HOUSE_CARDS else "")]
    out = []
    if k == "count" and not (isinstance(s.get("figures"), list) and s["figures"]):
        out.append("a count card declares its figures ([{value, field}]), so counts-match holds it to the record")
    if k == "quote":
        if s.get("quote") is not True:
            out.append("a quote card is drawn as a quotation (quote: true)")
        shaped = segment in SHAPED_SEGMENTS and part.get("shape") == "document"
        if segment not in QUOTE_CARD_SEGMENTS and not shaped:
            out.append(f"a quote card runs only in a document package or in The Echo, not in "
                       f"{segment or 'an untrusted part'}{' of shape ' + str(part.get('shape')) if segment in SHAPED_SEGMENTS else ''}")
    return out


def line_problems(ln: dict, segment: str | None, part: dict, speakers: set) -> list[str]:
    """Why a v2 line is malformed, one line each."""
    k = ln.get("kind")
    if k not in LINE_KINDS:
        return [f"a line's kind is one of {list(LINE_KINDS)}, not {k!r}"]
    out = []
    if not (isinstance(ln.get("text"), str) and ln["text"].strip()):
        out.append("a line states its text")
    where = LINE_SEGMENTS.get(k)
    if where and segment not in where:
        out.append(f"a {k} line is spoken only in {list(where)}, not in {segment or 'an untrusted part'}")
    if k == "sot":
        if ln.get("speaker") not in speakers:
            out.append(f"an sot line names its speaker from cast.speakers, not {ln.get('speaker')!r}")
        if ln.get("read_by"):
            out.append("an sot line is the speaker's own voice: it names no read_by")
        shot = next((s for s in part.get("shots") or [] if s.get("id") == ln.get("shot_ref")), None)
        snd = (shot or {}).get("sound") if isinstance((shot or {}).get("sound"), dict) else {}
        if shot is None:
            out.append(f"an sot line's shot_ref is a shot of its own part, not {ln.get('shot_ref')!r}")
        elif shot.get("kind") != "archive_video" or snd.get("role") != "sot":
            out.append(f"an sot line plays an archive_video whose sound.role is sot ({ln.get('shot_ref')} is "
                       f"{shot.get('kind')}, role {snd.get('role')!r})")
        if not (isinstance(ln.get("transcript_ref"), str) and ln["transcript_ref"].strip()) and not snd.get("transcript_ref"):
            out.append("an sot line names its transcript (transcript_ref, on the line or its shot's sound)")
        if not (_is_num(ln.get("in_s")) and _is_num(ln.get("out_s")) and ln["out_s"] > ln["in_s"] >= 0):
            out.append("an sot line states the bite's in_s and out_s inside the transcript's timing (out after in)")
    return out


def _silences(play: dict):
    for p in play.get("parts") or []:
        if p.get("silence") == "intended":
            yield f"part {p.get('id')}", p
        for coll in ("shots", "cues"):
            for x in p.get(coll) or []:
                if x.get("silence") == "intended":
                    yield x.get("id"), x
    for coll in ("music", "moments"):
        for x in play.get(coll) or []:
            if x.get("silence") == "intended":
                yield x.get("id"), x


def checks(play: dict, assets: dict | None = None) -> list[dict]:
    """Every schema check for an omnibus screenplay ([] for any other show: these fields bind only on news)."""
    assets = assets or {}
    out = []
    probs = SHOW.problems(play)
    out.append(_check("show-profile", not probs, unit="show", evidence={"show": play.get("show"), "problems": probs}))
    if probs or not is_news(play):
        return out
    sp = spine(play)
    v2 = sp is V2
    # the episode's own fields (v2)
    if v2:
        for unit, pr in news_field_problems(play).items():
            out.append(_check("news-fields", not pr, unit=unit, evidence={"problems": pr}))
    # parts: a segment each, in the spine's order, and a horizon where one is declared or required
    sprobs = spine_problems(play)
    out.append(_check("segment-spine", not sprobs, unit="parts", evidence={
        "spine": sp.name, "segments": [p.get("segment") for p in play.get("parts") or []], "problems": sprobs}))
    trusted = segments(play)
    if v2:
        n = sum(1 for t in trusted if t == "package")
        ok = PACKAGES_MIN <= n <= PACKAGES_MAX
        out.append(_check("package-count", ok, unit="parts", severity="warn", evidence={
            "packages": n, "range": [PACKAGES_MIN, PACKAGES_MAX], **({} if ok else {
                "why": "the lead and 3 or 4 packages; a fifth only when rank 5 clears the footage cap (bible b)"})}))
    for p, seg in zip(play.get("parts") or [], trusted):
        lab = p.get("segment")
        out.append(_check("part-segment", lab in sp.segments, unit=f"part {p.get('id')}",
                          evidence={"segment": lab, "segments": list(sp.segments)}))
        if v2 and p.get("shape") is not None:
            ok = seg in SHAPED_SEGMENTS and p["shape"] in PART_SHAPES
            out.append(_check("part-shape", ok, unit=f"part {p.get('id')}", evidence={
                "shape": p["shape"], "segment": seg, **({} if ok else {
                    "fix": f"a lead or package part's shape is one of {list(PART_SHAPES)} (the rundown story's)"})}))
        if seg in AS_OF_EXEMPT:
            continue
        a = p.get("as_of")
        if v2 and a is None and seg not in AS_OF_OWN:
            continue                          # a news part's horizon is the cutoff (bible k)
        ok = isinstance(a, str) and bool(AS_OF_RE.match(a.strip()))
        out.append(_check("part-as-of-declared", ok, unit=f"part {p.get('id')}",
                          evidence={"as_of": a, **({} if ok else {
                              "fix": "the part's horizon: an ISO date, or a date-time with its zone (2026-11-02T00:59:28Z)"
                                     + ("; The Echo always states its own" if seg in AS_OF_OWN else "")})}))
    # shots, graphics (as shots and as text elements), lines
    speakers = {s.get("id") for s in (play.get("cast") or {}).get("speakers") or [] if isinstance(s, dict)}
    for p, seg in zip(play.get("parts") or [], trusted):
        for k, s in enumerate(p.get("shots") or []):
            if G.is_graphic(s):
                pr = graphic_problems(s, assets.get(s.get("asset")), overlay=False, sp=sp, segment=seg, first=k == 0)
                out.append(_check("graphic-schema", not pr, unit=s.get("id"),
                                  evidence={"subtype": s.get("subtype"), "problems": pr}))
            alts = s.get("alterations") or []
            if alts:
                ok = s.get("mark") == "RECONSTRUCTED"
                out.append(_check("alteration-marked", ok, unit=s.get("id"), evidence={
                    "alterations": alts, "mark": s.get("mark"),
                    **({} if ok else {"fix": "a shot that names an alteration (text composited included) is RECONSTRUCTED"})}))
            if v2 and s.get("kind") == "archive_video":
                pr = sound_problems(s, assets.get(s.get("asset")))
                out.append(_check("sound-role", not pr, unit=s.get("id"), evidence={"sound": s.get("sound"), "problems": pr}))
            if v2 and s.get("kind") == "card":
                pr = card_problems(s, seg, p)
                out.append(_check("card-kind", not pr, unit=s.get("id"), evidence={"card": s.get("card"), "problems": pr}))
        for t in p.get("text") or []:
            if G.is_graphic(t):
                pr = graphic_problems(t, assets.get(t.get("asset")), overlay=True, sp=sp, segment=seg)
                out.append(_check("graphic-schema", not pr, unit=t.get("id"),
                                  evidence={"subtype": t.get("subtype"), "problems": pr}))
        if v2:
            for ln in p.get("lines") or []:
                pr = line_problems(ln, seg, p, speakers)
                out.append(_check("line-schema", not pr, unit=ln.get("id"), evidence={"kind": ln.get("kind"), "problems": pr}))
            if seg == "signoff":
                kinds = [ln.get("kind") for ln in p.get("lines") or []]
                ok = kinds == ["signoff"]
                out.append(_check("line-schema", ok, unit=f"part {p.get('id')}", evidence={
                    "kinds": kinds, **({} if ok else {"problems": ["the sign-off is one spoken line, a signoff line (bible h)"]})}))
    # reader lines carry the hash of their extract
    for _, ln in reader_lines(play):
        h = ln.get("quote_sha256")
        ok = isinstance(h, str) and bool(SHA256.match(h))
        out.append(_check("reader-quote-sha", ok, unit=ln.get("id"), evidence={
            "quote_sha256": h, **({} if ok else {"fix": "a reader line carries quote_sha256: its extract's sha256"})}))
        rb = ln.get("read_by")
        ok = isinstance(rb, str) and bool(rb.strip())
        out.append(_check("reader-read-by", ok, unit=ln.get("id"), evidence={
            "read_by": rb, **({} if ok else {"fix": "a reader line names the cast voice that reads it (read_by), so its "
                                                    "computer voice is disclosed"})}))
    # every intended silence says why
    for unit, x in _silences(play):
        ok = _words(x.get("reason")) >= REASON_MIN_WORDS
        out.append(_check("silence-reason", ok, unit=unit, evidence={
            "reason": x.get("reason"), **({} if ok else {"fix": f"silence: intended states its reason (a sentence, at least "
                                                               f"{REASON_MIN_WORDS} words)"})}))
    return out
