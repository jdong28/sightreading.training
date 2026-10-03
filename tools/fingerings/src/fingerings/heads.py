"""Stage 4: noteheads of a scanned page, with their staff positions.

Staff lines are erased (keeping pixels that continue above and below a
line), hollow heads are filled, and an opening with a disc a little over
half a staff space wide keeps the heads while stems, beams, slurs, ledger
lines and most text fall away. A blob taller than one head is a stack of
heads a third apart (a chord) and is split at whole staff spaces."""
import numpy as np
from scipy import ndimage


def erase_staff_lines(black, systems):
    """Erase the vertical runs no taller than a staff line that lie on one:
    a head, stem or bar line crossing the line is a taller run and stays."""
    out = black.copy()
    h = black.shape[0]
    for sys_ in systems:
        for st in sys_["staves"]:
            space = st["space"]
            limit = max(3, int(round(0.22 * space)))
            top, bot = st["lines"][0], st["lines"][-1]
            # the five lines, then where ledger lines would lie (a run no
            # taller than a line is erased there whether or not one is drawn)
            rows = list(st["lines"]) + [top - k * space for k in range(1, 7)] + [bot + k * space for k in range(1, 7)]
            for y in rows:
                if y - 0.25 * space - limit < 0 or y + 0.25 * space + limit >= h:
                    continue
                y0, y1 = int(y - 0.25 * space), int(y + 0.25 * space) + 1
                band = black[max(0, y0 - limit):min(h, y1 + limit)]
                # run length of the black run through each pixel, per column
                up = np.zeros(band.shape, int)
                down = np.zeros(band.shape, int)
                for r in range(band.shape[0]):
                    up[r] = np.where(band[r], (up[r - 1] if r else 0) + 1, 0)
                for r in range(band.shape[0] - 1, -1, -1):
                    down[r] = np.where(band[r], (down[r + 1] if r < band.shape[0] - 1 else 0) + 1, 0)
                run = up + down - 1
                thin = band & (run <= limit)
                lo = y0 - max(0, y0 - limit)
                seg = out[y0:y1]
                seg &= ~thin[lo:lo + seg.shape[0]]
    return out


def fill_small_holes(black, clean, space):
    """Fill the holes of hollow heads, found in the print before the staff
    lines are erased (a head in a space has its ring's top and bottom on the
    lines). A hole between two lines and two stems is a near rectangle and
    as tall as a space; a head's hole is a smaller ellipse."""
    keep = np.zeros_like(black)
    # a head in a space closes its hole with the lines above and below it
    # (look in the print); a head on a line has the line across its hole
    # (look once the lines are erased)
    for ink in (black, clean):
        keep |= _head_holes(ink, space)
    # restore the ring's top and bottom, which lay on staff lines; only
    # vertically, so an accidental beside the head stays a separate blob
    r = max(1, int(0.25 * space))
    ring = ndimage.binary_dilation(keep, structure=np.ones((2 * r + 1, 1), bool)) & black
    return clean | keep | ring


def _head_holes(ink, space):
    holes = ndimage.binary_fill_holes(ink) & ~ink
    labels, n = ndimage.label(holes)
    keep = np.zeros_like(ink)
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (0.15 * space <= hh <= 0.95 * space and 0.25 * space <= ww <= 1.3 * space):
            continue
        sub = labels[sl] == i
        ratio = sub.sum() / float(hh * ww)
        # a head's hole narrows to its ends; a gap closed by staff lines ends
        # in a straight edge as wide as itself
        rows = sub.sum(axis=1)
        ends = max(rows[0], rows[-1]) / rows.max()
        if 0.38 <= ratio <= 0.85 and ends <= 0.6:
            keep[sl] |= sub
    return keep

def disc(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _small_heads(filled, clean, core, space):
    """A second pass over what the normal opening left behind: grace and
    cue-size heads, too small for the normal disc to keep whole. Opened
    with a smaller disc over the remainder (filled minus the normal
    heads' own footprint, dilated so a grace head touching a normal one
    isn't claimed twice); kept only at a cue head's size."""
    margin = max(1, int(round(space * 0.15)))
    remainder = filled & ~ndimage.binary_dilation(core, structure=disc(margin))
    small_core = ndimage.binary_opening(remainder, structure=disc(max(1, int(round(space * 0.22)))))
    labels, n = ndimage.label(small_core)
    out = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        sub = labels[sl] == i
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if not (0.5 * space <= w <= 1.0 * space and 0.4 * space <= h <= 0.85 * space):
            continue
        hollow = (filled[sl] & ~clean[sl] & sub).sum() > 0.15 * sub.sum()
        ys, xs = np.nonzero(sub)
        out.append(dict(x=float(xs.mean() + sl[1].start), y=float(ys.mean() + sl[0].start), w=w, h=h,
                        hollow=bool(hollow), stacked=1, small=True))
    return out


def noteheads(black, systems):
    space = float(np.median([st["space"] for s in systems for st in s["staves"]]))
    clean = erase_staff_lines(black, systems)
    filled = fill_small_holes(black, clean, space)
    core = ndimage.binary_opening(filled, structure=disc(int(round(space * 0.32))))
    labels, n = ndimage.label(core)
    heads = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        sub = labels[sl] == i
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if w < 0.8 * space or w > 2.0 * space or h < 0.6 * space:
            continue
        hollow = (filled[sl] & ~clean[sl] & sub).sum() > 0.15 * sub.sum()
        k = max(1, int(round(h / space)))
        if k > 1 and h > 1.3 * space:
            # split a stack at whole spaces (heads a third apart touch)
            for j in range(k):
                cy = sl[0].start + (j + 0.5) * h / k
                heads.append(dict(x=float(sl[1].start + w / 2), y=float(cy), w=w, h=h / k, hollow=bool(hollow), stacked=k))
        else:
            ys, xs = np.nonzero(sub)
            heads.append(dict(x=float(xs.mean() + sl[1].start), y=float(ys.mean() + sl[0].start), w=w, h=h, hollow=bool(hollow), stacked=1))
    heads += _small_heads(filled, clean, core, space)
    return heads, space


def staff_position(st, y):
    """Half-space steps above the staff's bottom line (bottom line = 0)."""
    return (st["lines"][-1] - y) / (st["space"] / 2)


def _ledger_positions(pos):
    """The even half-space positions (ledger lines) a note at `pos` needs,
    by notation convention: one at every whole space beyond the staff up
    to and including `pos` itself if it sits on one (a note in the gap
    just past the staff, pos 9 or -1, needs none at all)."""
    out = []
    if pos > 8:
        p = 10
        while p <= pos:
            out.append(p)
            p += 2
    elif pos < 0:
        p = -2
        while p >= pos:
            out.append(p)
            p -= 2
    return out


def _ledger_line_present(black, x, space, y):
    """A short horizontal run of ink near (x, y), the width a ledger line
    actually is (a little over a notehead's own width): real notation
    always draws one at every position _ledger_positions names, so its
    absence marks the blob as something else -- text, an artifact --
    rather than a genuine ledger-line note."""
    half = max(2, int(round(0.65 * space)))
    y0, y1 = int(round(y - 0.18 * space)), int(round(y + 0.18 * space)) + 1
    x0, x1 = max(0, int(round(x - half))), min(black.shape[1], int(round(x + half)) + 1)
    if y0 < 0 or y1 > black.shape[0] or x1 <= x0:
        return False
    band = black[y0:y1, x0:x1]
    return bool(band.any(axis=0).mean() >= 0.6)


def place(heads, systems, black=None, max_ledger=7):
    """Give every head its system, staff and staff position; heads outside
    every staff's reach (text, clef dots far away) are dropped. A head
    that would sit on a ledger line is kept only if the page actually
    draws one there (when `black` is given): a measure number or other
    system-start text can otherwise read as a plausible high note, since
    its digits alone are an ordinary notehead's size and shape."""
    out = []
    for hd in heads:
        best = None
        for si, sys_ in enumerate(systems):
            for k, st in enumerate(sys_["staves"]):
                pos = staff_position(st, hd["y"])
                if -max_ledger * 2 <= pos <= 8 + max_ledger * 2:
                    dist = 0 if 0 <= pos <= 8 else min(abs(pos), abs(pos - 8))
                    if best is None or dist < best[0]:
                        best = (dist, si, k, pos, st)
        if best is None:
            continue
        _, si, k, pos, st = best
        if black is not None and (pos < 0 or pos > 8):
            space = st["space"]
            bot_y = st["lines"][-1]
            needed = _ledger_positions(pos)
            if needed and not all(_ledger_line_present(black, hd["x"], space, bot_y - p * (space / 2))
                                   for p in needed):
                continue
        out.append({**hd, "system": si, "staff": k + 1, "pos": pos, "step": int(round(pos))})
    return out
