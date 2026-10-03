"""Stage 3: staff lines, staves, systems and bar lines of a scanned page.

Bar-line detection needs to know where noteheads are (a stem shouldn't be
mistaken for a bar line), so it runs after heads are found: `page_geometry`
gives staves and systems only, and the caller (`geometry.py`) calls
`assign_bars` once `heads.noteheads`/`heads.place` have run."""
from itertools import combinations

import numpy as np


def _runs(idx, gap=1):
    out = []
    for i in idx:
        if out and i - out[-1][-1] <= gap:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def vertical_run_lengths(black):
    """Per-pixel length of the vertical black run through it, shared with
    heads.erase_staff_lines's band-local version of the same trick."""
    h, w = black.shape
    up = np.zeros((h, w), dtype=int)
    down = np.zeros((h, w), dtype=int)
    for r in range(h):
        up[r] = np.where(black[r], (up[r - 1] if r else 0) + 1, 0)
    for r in range(h - 1, -1, -1):
        down[r] = np.where(black[r], (down[r + 1] if r < h - 1 else 0) + 1, 0)
    return up + down - 1


def staff_lines(black):
    """Candidate staff-line rows, from their *thin* pixels only (a beam
    lying along a line, or a row of ledger lines, is thicker and doesn't
    widen or shift the line's own centre): thickness is read from the
    rows that are mostly black (not the page-wide mode, which a page
    dominated by thick beams would give as the beam's own thickness), then
    only pixels no taller than about twice that are kept as candidates."""
    h, w = black.shape
    rows = np.where(black.sum(1) > 0.25 * w)[0]
    if len(rows) == 0:
        return []
    runs = vertical_run_lengths(black)
    row_runs = runs[rows]
    row_black = black[rows]
    thick_candidates = row_runs[row_black]
    if thick_candidates.size == 0:
        return []
    t = int(np.bincount(thick_candidates).argmax())
    thin = black & (runs <= max(2, 2 * t + 1))
    cand = np.where(thin.sum(1) > 0.25 * w)[0]
    return [dict(y=(g[0] + g[-1]) / 2, thick=len(g), fill=int(black[g].any(axis=0).sum()))
            for g in _runs(cand)]


def staves_from_lines(lines):
    """Group lines into 5-line staves with even spacing; spurious lines (a
    beam lying along a line, or a row of ledger lines under a run of high
    notes) are dropped by preferring the evenest set of five whose fill is
    close to its fullest line (a staff's five lines all span the system; a
    row of ledger lines only spans part of it)."""
    ys = [l["y"] for l in lines]
    fills = [l["fill"] for l in lines]
    staves = []
    i = 0
    while i + 4 < len(ys):
        best = None
        # try the next up-to-7 lines for the evenest 5 starting at ys[i]
        window = ys[i:i + 8]
        for combo in combinations(range(1, len(window)), 4):
            pick = [window[0]] + [window[c] for c in combo]
            gaps = np.diff(pick)
            if gaps.min() <= 0:
                continue
            f = [fills[i]] + [fills[i + c] for c in combo]
            if min(f) < 0.6 * max(f):
                continue
            spread = (gaps.max() - gaps.min()) / gaps.mean()
            if spread < 0.15 and (best is None or spread < best[0]):
                best = (spread, combo, pick)
        if best is None:
            i += 1
            continue
        _, combo, pick = best
        staves.append(dict(lines=[float(y) for y in pick], space=float(np.mean(np.diff(pick)))))
        i += combo[-1] + 1
    return staves


def systems_from_staves(black, staves):
    """Join vertically adjacent staves into a system when a vertical line at
    the staves' left edge connects them (the system's opening bar line)."""
    systems = []
    for st in staves:
        if systems:
            prev = systems[-1]["staves"][-1]
            if _connected(black, prev, st):
                systems[-1]["staves"].append(st)
                continue
        systems.append(dict(staves=[st]))
    return systems


def _connected(black, a, b):
    """True when some column is black all the way from a's bottom line to
    b's top line: the system's opening line or a bar line through the gap."""
    y0, y1 = int(round(a["lines"][-1])), int(round(b["lines"][0]))
    band = black[y0:y1 + 1]
    wob = band.copy()
    wob[:, 1:] |= band[:, :-1]
    wob[:, :-1] |= band[:, 1:]
    return bool((wob.mean(axis=0) >= 0.97).any())

def _column_fill(black, y0, y1):
    band = black[int(round(y0)):int(round(y1)) + 1]
    wob = band.copy()
    wob[:, 1:] |= band[:, :-1]
    wob[:, :-1] |= band[:, 1:]
    return wob.mean(axis=0)


def _real_content_before(heads, x, space):
    """True when the heads positioned before x are spread wide enough to
    be genuine, separate notes rather than one clef glyph's artifacts (a
    treble clef's loops can read as one or two small blobs, but they
    cluster within about a space of each other, far narrower than
    distinct notes a measure wide)."""
    xs = [h["x"] for h in heads if h["x"] < x]
    return len(xs) >= 2 and (max(xs) - min(xs)) > 1.5 * space


def _head_touches(heads, x0, x1, space):
    """True when a notehead's edge sits within 3 px of this column's near
    edge: a stem-up note's head just left of it (its right edge near the
    column's right edge), or a stem-down note's just right of it (its left
    edge near the column's left edge)."""
    for h in heads:
        hw = h.get("w", space)
        left, right = h["x"] - hw / 2, h["x"] + hw / 2
        if abs(right - x1) <= 3 or abs(left - x0) <= 3:
            return True
    return False


def barlines(black, system, heads_in_system=None, min_fill=0.9, min_gap_fill=0.97, partial_gap_fill=0.5):
    """x positions of a system's bar lines, by a two-tier rule:
    1. the system's opening line is always a bar line;
    2. a column filling every staff and every *barred* inter-staff gap at
       min_gap_fill is a bar line outright (a cramped engraving packs
       noteheads right against it);
    3. a column filling a barred gap only partially, or any column of a
       one-staff system (which has no gap test), is a bar line only if no
       notehead touches it from one side.
    A gap is "barred" when most of the system's full-staff columns cross
    it fully: a voice-plus-piano system's bar lines cross the piano pair's
    gap but not the voice-piano gap.
    The system's header (clef, key, time before a start-repeat) is never
    counted as a bar: when the interval after the opening line holds no
    notehead and ends at a wide (double/thick-plus-thin) group, that
    opening line is dropped, since it isn't really separating a measure."""
    heads_in_system = heads_in_system or []
    staves = system["staves"]
    space = float(np.mean([s["space"] for s in staves]))
    w = black.shape[1]
    one_staff = len(staves) == 1

    staff_full = np.ones(w, dtype=bool)
    for st in staves:
        staff_full &= _column_fill(black, st["lines"][0], st["lines"][-1]) >= min_fill

    gaps = list(zip(staves, staves[1:]))
    gap_fill = [_column_fill(black, a["lines"][-1], b["lines"][0]) for a, b in gaps]
    n_cand = int(staff_full.sum())
    barred = [n_cand == 0 or bool((gf[staff_full] >= min_gap_fill).sum() >= 0.5 * n_cand) for gf in gap_fill]

    # a bar line stops at the outer staff lines; a stem that happens to
    # fill both staves carries its notehead past one of them
    top, bot = staves[0]["lines"][0], staves[-1]["lines"][-1]
    margin_ok = (_column_fill(black, top - 1.0 * space, top - 0.3 * space) < 0.5) & \
                (_column_fill(black, bot + 0.3 * space, bot + 1.0 * space) < 0.5)

    full_ok = staff_full & margin_ok
    partial_ok = staff_full & margin_ok
    for (_a, _b), gf, is_barred in zip(gaps, gap_fill, barred):
        if not is_barred:
            continue
        full_ok &= gf >= min_gap_fill
        partial_ok &= gf >= partial_gap_fill
    if one_staff:
        full_ok = np.zeros(w, dtype=bool)  # no gap test exists; rule 3 always applies

    candidate = full_ok | partial_ok
    groups = [g for g in _runs(np.where(candidate)[0], gap=int(space * 0.9))
              if (g[-1] - g[0] + 1) <= 2 * space]
    if not groups:
        return []

    out = []
    for i, g in enumerate(groups):
        x0, x1 = int(g[0]), int(g[-1])
        # the opening-line exemption only applies to a candidate genuinely
        # at the system's left end: a system with no drawn opening stroke
        # (common for a single-staff part's continuation systems) must
        # not have its first real candidate -- which may be an ordinary
        # stem -- wrongly exempted from the head-touch check just for
        # being first in the list
        # (a stray head before it -- a clef loop's round bowl can read as
        # one or two -- shouldn't disqualify a genuine opening line)
        is_opening = i == 0 and not _real_content_before(heads_in_system, x0, space)
        is_full = bool(full_ok[x0:x1 + 1].any())
        if not is_opening and not is_full and _head_touches(heads_in_system, x0, x1, space):
            continue
        out.append(dict(x0=x0, x1=x1, x=float(np.mean(g)), is_full=is_full))

    if len(out) >= 2:
        a, b = out[0], out[1]
        no_heads_between = not any(a["x1"] < h["x"] < b["x0"] for h in heads_in_system)
        b_width = b["x1"] - b["x0"] + 1
        if no_heads_between and b_width > 0.4 * space:
            out = out[1:]  # a's "bar" was really the header before a start-repeat
    return out


def from_black(black):
    """Staves and systems only (no bar lines yet: see module docstring),
    from an already-thresholded/preprocessed boolean ink mask."""
    lines = staff_lines(black)
    staves = staves_from_lines(lines)
    systems = systems_from_staves(black, staves)
    for sys_ in systems:
        sys_["top"] = sys_["staves"][0]["lines"][0]
        sys_["bottom"] = sys_["staves"][-1]["lines"][-1]
    return dict(black=black, systems=systems)


def page_geometry(gray, threshold=128):
    """Staves and systems only (no bar lines yet: see module docstring)."""
    return from_black(gray < threshold)


def assign_bars(black, systems, heads):
    """Fills in each system's `bars`/`measures`, now that `heads` (each
    carrying its placed `system` index, from `heads.place`) are known."""
    for si, sys_ in enumerate(systems):
        heads_in_system = [h for h in heads if h["system"] == si]
        bars = barlines(black, sys_, heads_in_system)
        space = float(np.mean([s["space"] for s in sys_["staves"]]))
        if bars and not bars[0]["is_full"] and _real_content_before(heads_in_system, bars[0]["x0"], space):
            # no drawn opening stroke (a single-staff part's continuation
            # system commonly has none): synthesise one at the system's
            # own left edge, so the first measure -- otherwise unreachable,
            # since `measures` only spans between consecutive bars -- isn't
            # lost. Never second-guessed when bars[0] already passed the
            # strict full-gap-fill rule: that is strong, reliable evidence
            # of a true opening line, which a clef or a brace reading as a
            # stray head or two must not override.
            bars = [dict(x0=0, x1=0, x=0.0)] + bars
        sys_["bars"] = bars
        sys_["measures"] = [dict(x0=bars[i]["x1"], x1=bars[i + 1]["x0"]) for i in range(len(bars) - 1)]
