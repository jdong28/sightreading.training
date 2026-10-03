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


def staff_lines(black, frac_thresh=0.25):
    """Candidate staff-line rows, from their *thin* pixels only (a beam
    lying along a line, or a row of ledger lines, is thicker and doesn't
    widen or shift the line's own centre): thickness is read from the
    rows that are mostly black (not the page-wide mode, which a page
    dominated by thick beams would give as the beam's own thickness), then
    only pixels no taller than about twice that are kept as candidates.
    `frac_thresh` is lowered by `_recover_missing_staff`'s second pass,
    for a staff whose ink is suppressed below the normal floor by dense,
    unrelated content on the same rows (ornaments, grace-note chords)."""
    h, w = black.shape
    rows = np.where(black.sum(1) > frac_thresh * w)[0]
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
    cand = np.where(thin.sum(1) > frac_thresh * w)[0]
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


def _real_content_between(heads, lo, hi, space):
    """True when the heads positioned in (lo, hi) are spread wide enough
    to be genuine, separate notes rather than one glyph's artifacts (a
    clef's loops, a key signature's accidentals, or a brace's curve can
    each read as a stray small blob, clustering within about a space of
    each other -- far narrower than distinct notes a measure wide)."""
    xs = [h["x"] for h in heads if lo < h["x"] < hi]
    return len(xs) >= 2 and (max(xs) - min(xs)) > 1.5 * space


def _real_content_before(heads, x, space):
    return _real_content_between(heads, float("-inf"), x, space)


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

    out = _drop_header(out, heads_in_system, space)
    out = _drop_stem_bars(out, black, staves, space)

    # rule 1 (above) says the opening line is always a bar line, but its
    # own ink can be the one place on the page where that's locally
    # broken or faint (worn print, a crease) rather than genuinely
    # absent, failing full_ok's per-staff min_fill at every column even
    # though it's still, by a wide margin, the strongest connecting
    # stroke in the system's header region: real notehead content before
    # the first bar actually found (never true of a genuine header) is
    # the signal that one was missed, not just skipped as a header --
    # except that the same key-signature accidentals that can fool
    # `_real_content_before` fool this too, so the recovered candidate is
    # run back through `_drop_header` exactly as a freshly-detected one
    # would be, rather than trusted outright.
    if len(staves) > 1 and out and _real_content_before(heads_in_system, out[0]["x0"], space):
        bx, bf = _best_connecting_column(black, staves, 0, out[0]["x0"])
        if bx is not None and bf >= 0.75:
            candidate = [dict(x0=bx, x1=bx, x=float(bx), is_full=True)] + out
            trimmed = _drop_header(candidate, heads_in_system, space)
            if trimmed and trimmed[0]["x0"] == bx:
                out = trimmed
    return out


def _drop_header(out, heads_in_system, space):
    """The system's header (clef, key, time before a start-repeat) is
    never counted as a bar: when the interval after the first bar holds
    no notehead, or ends at a wide (double/thick-plus-thin) group much
    narrower than this system's real measures, that first bar is
    dropped, since it isn't really separating a measure."""
    if len(out) < 2:
        return out
    a, b = out[0], out[1]
    no_notes_between = not _real_content_between(heads_in_system, a["x1"], b["x0"], space)
    b_width = b["x1"] - b["x0"] + 1
    is_wide = b_width > 0.4 * space
    # a header interval (clef, key signature, measure number) is
    # reliably much narrower than this system's real measures, since
    # it compresses notation metadata rather than laying out music by
    # rhythm. Compared against the system's other, unambiguous
    # measures when there are enough of them to average reliably:
    # a key signature's accidentals (or a measure number) can read as
    # noteheads and defeat the simpler no-notes check above, but they
    # never widen the interval to a real measure's span.
    header_by_width = False
    if is_wide and len(out) >= 4:
        other_widths = [out[i + 1]["x"] - out[i]["x"] for i in range(1, len(out) - 1)]
        avg_other = sum(other_widths) / len(other_widths)
        first_width = b["x"] - a["x"]
        header_by_width = avg_other > 0 and first_width < 0.65 * avg_other
    if is_wide and (no_notes_between or header_by_width):
        return out[1:]  # a's "bar" was really the header before a start-repeat
    return out


def _longest_gap_run(black, y0, y1, x):
    """The longest unbroken run of non-ink in column `x` between y0 and
    y1: a real bar line's stroke is unbroken for its whole height (print
    noise aside), while two unrelated notes' stems -- one reaching down
    from the staff above, one up from the staff below, far enough apart
    that neither's note is a false ledger read -- leave the middle of
    the gap between the staves untouched."""
    col = black[y0:y1 + 1, x]
    best = cur = 0
    for v in col:
        cur = 0 if v else cur + 1
        best = max(best, cur)
    return best


def _drop_stem_bars(out, black, staves, space):
    """A column can fill both staves solidly without being a bar line at
    all: two separate notes' stems, one in each staff, happening to line
    up at the same x. `barlines`' own full_ok rule accepts it regardless
    of the gap between the staves whenever that gap isn't reliably
    barred system-wide (rule 2's docstring; true of some real systems,
    but also of a system where ordinary print noise drops enough real
    bar lines' own gap fill below the threshold). Such a stem never
    carries a bar line's unbroken stroke through the middle of that gap,
    though, and only ever crowds its neighbours -- a bar a stem away
    from the next isn't a real measure -- so it's dropped exactly when
    both are true: still a coincidence otherwise, not a dropped bar."""
    if len(out) < 3 or len(staves) < 2:
        return out
    widths = [out[i + 1]["x"] - out[i]["x"] for i in range(len(out) - 1)]
    median_w = float(np.median(widths))
    if median_w <= 0:
        return out
    y0, y1 = int(staves[0]["lines"][-1]), int(staves[1]["lines"][0])
    keep = [True] * len(out)
    for i in range(1, len(out) - 1):
        gap_before = out[i]["x"] - out[i - 1]["x"]
        gap_after = out[i + 1]["x"] - out[i]["x"]
        if gap_before > 0.5 * median_w and gap_after > 0.5 * median_w:
            continue
        x = int(round(out[i]["x"]))
        if _longest_gap_run(black, y0, y1, x) > 1.0 * space:
            keep[i] = False
    return [b for b, k in zip(out, keep) if k]


def _best_connecting_column(black, staves, x0, x1):
    """The x in [x0, x1) whose column (one pixel of horizontal tolerance,
    the same wobble `_connected` allows) is blackest continuously across
    every staff and every inter-staff gap, with that fraction: the
    strongest single candidate for a connecting stroke -- the system's
    opening line -- in a narrow search band, for `barlines`' recovery
    when the normal per-column rule just misses it."""
    top, bot = staves[0]["lines"][0], staves[-1]["lines"][-1]
    y0, y1 = int(round(top)), int(round(bot))
    x0, x1 = max(0, int(x0)), min(black.shape[1], int(x1))
    if x1 <= x0 or y1 <= y0:
        return None, 0.0
    band = black[y0:y1 + 1, x0:x1]
    wob = band.copy()
    wob[:, 1:] |= band[:, :-1]
    wob[:, :-1] |= band[:, 1:]
    col = wob.mean(axis=0)
    i = int(np.argmax(col))
    return i + x0, float(col[i])


def _staff_in_band(black, y0, y1, expected_space, frac_thresh=0.15):
    """A second, more tolerant line search confined to one y-band: used
    only as `_recover_missing_staff`'s fallback, when a staff is
    suspected missing there. Returns the found staff closest in space to
    `expected_space`, or None when nothing within 20% of it turns up."""
    h, w = black.shape
    y0i, y1i = max(0, int(round(y0))), min(h, int(round(y1)))
    if y1i - y0i < 4:
        return None
    band = black[y0i:y1i]
    runs = vertical_run_lengths(band)
    rows = np.where(band.sum(1) > frac_thresh * w)[0]
    if len(rows) == 0:
        return None
    row_runs = runs[rows]
    row_black = band[rows]
    thick_candidates = row_runs[row_black]
    if thick_candidates.size == 0:
        return None
    t = int(np.bincount(thick_candidates).argmax())
    thin = band & (runs <= max(2, 2 * t + 1))
    cand = np.where(thin.sum(1) > frac_thresh * w)[0]
    if len(cand) == 0:
        return None
    lines_local = [dict(y=(g[0] + g[-1]) / 2 + y0i, thick=len(g), fill=int(band[g].any(axis=0).sum()))
                   for g in _runs(cand)]
    found = staves_from_lines(lines_local)
    if not found:
        return None
    found.sort(key=lambda s: abs(s["space"] - expected_space))
    best = found[0]
    if abs(best["space"] - expected_space) > 0.2 * expected_space:
        return None
    return best


def _recover_missing_staff(black, systems):
    """A system can show fewer staves than the page's own typical count
    when a staff's ink is suppressed below staff_lines' normal threshold
    by dense, unrelated content on the same rows (grace-note chords,
    ornaments crowding a trio's opening, for one measured case): a
    second, lower-threshold search confined to the gap a sibling
    system's own layout predicts recovers it, confirmed connected to the
    staff already found (the same opening-line/bar-line test
    systems_from_staves itself uses), rather than silently losing a
    whole staff's notes to detection."""
    counts = [len(s["staves"]) for s in systems]
    if not counts:
        return
    mode_count = max(set(counts), key=counts.count)
    if mode_count <= 1:
        return
    full = [s for s in systems if len(s["staves"]) == mode_count]
    if not full:
        return
    gaps, spaces = [], []
    for s in full:
        for a, b in zip(s["staves"], s["staves"][1:]):
            gaps.append(b["lines"][0] - a["lines"][-1])
        spaces.extend(st["space"] for st in s["staves"])
    if not gaps:
        return
    avg_gap = float(np.mean(gaps))
    avg_space = float(np.mean(spaces))

    for si, s in enumerate(systems):
        if mode_count - len(s["staves"]) != 1:
            continue
        prev_bottom = systems[si - 1]["bottom"] if si > 0 else 0
        next_top = systems[si + 1]["top"] if si + 1 < len(systems) else black.shape[0]

        # try above the system's existing (topmost) staff first -- the
        # overwhelmingly common case (a grand staff's right hand)
        top_st = s["staves"][0]
        pred_bottom = top_st["lines"][0] - avg_gap
        band0 = max(prev_bottom, pred_bottom - 6 * avg_space)
        found = _staff_in_band(black, band0, pred_bottom + 2 * avg_space, avg_space)
        if found and found["lines"][-1] < top_st["lines"][0] and _connected(black, found, top_st):
            s["staves"].insert(0, found)
            s["top"] = found["lines"][0]
            continue

        # otherwise, below the system's existing (bottommost) staff
        bot_st = s["staves"][-1]
        pred_top = bot_st["lines"][-1] + avg_gap
        band1 = min(next_top, pred_top + 6 * avg_space)
        found2 = _staff_in_band(black, pred_top - 2 * avg_space, band1, avg_space)
        if found2 and found2["lines"][0] > bot_st["lines"][-1] and _connected(black, bot_st, found2):
            s["staves"].append(found2)
            s["bottom"] = found2["lines"][-1]


def from_black(black):
    """Staves and systems only (no bar lines yet: see module docstring),
    from an already-thresholded/preprocessed boolean ink mask."""
    lines = staff_lines(black)
    staves = staves_from_lines(lines)
    systems = systems_from_staves(black, staves)
    for sys_ in systems:
        sys_["top"] = sys_["staves"][0]["lines"][0]
        sys_["bottom"] = sys_["staves"][-1]["lines"][-1]
    _recover_missing_staff(black, systems)
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
        no_opening = bars and not bars[0]["is_full"] and (
            len(bars) <= 1  # a system that found at most its own final bar
            # (a multi-bar rest's printed bar has no notehead to detect,
            # so the head-based signal below never fires for it, yet a
            # detected system is never truly empty of a measure) needs no
            # further evidence: there's nothing left to mistake it for.
            or _real_content_before(heads_in_system, bars[0]["x0"], space))
        if no_opening:
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
