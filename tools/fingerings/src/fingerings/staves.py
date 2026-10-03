"""Stage 3: staff lines, staves, systems and bar lines of a scanned page."""
import numpy as np


def _runs(idx, gap=1):
    out = []
    for i in idx:
        if out and i - out[-1][-1] <= gap:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def staff_lines(black):
    h, w = black.shape
    rows = black.sum(1)
    cand = np.where(rows > 0.25 * w)[0]
    lines = [dict(y=(g[0] + g[-1]) / 2, thick=len(g), fill=int(rows[g].max())) for g in _runs(cand)]
    return lines


def staves_from_lines(lines):
    """Group lines into 5-line staves with even spacing; spurious lines (a beam
    lying along a line) are dropped by preferring the evenest set of five."""
    ys = [l["y"] for l in lines]
    fills = [l["fill"] for l in lines]
    staves = []
    i = 0
    while i + 4 < len(ys):
        best = None
        # try the next up-to-7 lines for the evenest 5 starting at ys[i]
        window = ys[i:i + 8]
        from itertools import combinations
        for combo in combinations(range(1, len(window)), 4):
            pick = [window[0]] + [window[c] for c in combo]
            gaps = np.diff(pick)
            if gaps.min() <= 0:
                continue
            # a short line lying evenly above or below a staff (ledger lines
            # of a run of chords) is far shorter than the staff's own lines
            f = [fills[i]] + [fills[i + c] for c in combo]
            if min(f) < 0.6 * np.median(f):
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


def barlines(black, system, min_fill=0.9, min_gap_fill=0.5):
    """x positions of lines that fill every staff of the system from its top
    line to its bottom line and most of each gap between staves (text such
    as a dynamic may interrupt a bar line in the gap; a stem never fills two
    staves)."""
    staves = system["staves"]
    space = np.mean([s["space"] for s in staves])
    ok = np.ones(black.shape[1], dtype=bool)
    for st in staves:
        ok &= _column_fill(black, st["lines"][0], st["lines"][-1]) >= min_fill
    for a, b in zip(staves, staves[1:]):
        ok &= _column_fill(black, a["lines"][-1], b["lines"][0]) >= min_gap_fill
    # a bar line stops at the outer staff lines; a stem that happens to
    # fill both staves carries its notehead past one of them
    top, bot = staves[0]["lines"][0], staves[-1]["lines"][-1]
    ok &= _column_fill(black, top - 1.0 * space, top - 0.3 * space) < 0.5
    ok &= _column_fill(black, bot + 0.3 * space, bot + 1.0 * space) < 0.5
    xs = np.where(ok)[0]
    groups = _runs(xs, gap=int(space * 0.9))  # a double/final bar line counts once
    out = []
    for g in groups:
        width = g[-1] - g[0] + 1
        if width > 2 * space:
            continue  # a filled block, not a line
        out.append(dict(x0=int(g[0]), x1=int(g[-1]), x=float(np.mean(g))))
    return out

def page_geometry(gray):
    black = gray < 128
    lines = staff_lines(black)
    staves = staves_from_lines(lines)
    systems = systems_from_staves(black, staves)
    for sys_ in systems:
        bars = barlines(black, sys_)
        sys_["bars"] = bars
        sys_["measures"] = [dict(x0=bars[i]["x1"], x1=bars[i + 1]["x0"]) for i in range(len(bars) - 1)]
        sys_["top"] = sys_["staves"][0]["lines"][0]
        sys_["bottom"] = sys_["staves"][-1]["lines"][-1]
    return dict(black=black, systems=systems)
