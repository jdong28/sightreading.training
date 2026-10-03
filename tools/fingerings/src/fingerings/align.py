"""Stage 5: tie the page to the MusicXML, then each digit to one note.

Measures are numbered by counting bar lines from the first page (the
MusicXML's measure order); the page totals must add up to the MusicXML's
measure count or the run stops. A note's expected staff position comes from
its pitch and the clef in force, so a detected head is matched to a note by
measure, staff and position, and repeated positions in a measure by their
left-to-right order."""
from collections import defaultdict
from fractions import Fraction
from . import score

CLEF_REF = {"G": ("G", 4), "F": ("F", 3), "C": ("C", 4)}


def expected_pos(row):
    """Half-space steps above the bottom line of the staff the note is on."""
    sign, line = row["clef"] or ("G", 2)
    if sign not in CLEF_REF:
        return None
    rs, ro = CLEF_REF[sign]
    return score.diatonic(row["step"], row["octave"]) - score.diatonic(rs, ro) + (line - 1) * 2 + 7 * row.get("octave_shift", 0)


def page_measures(pages_geom, first_index=0):
    """[(page, system index, measure x-range, xml measure index)]"""
    out = []
    idx = first_index
    for page, geom in pages_geom:
        for si, sys_ in enumerate(geom["systems"]):
            for m in sys_["measures"]:
                out.append(dict(page=page, system=si, x0=m["x0"], x1=m["x1"], mindex=idx))
                idx += 1
    return out, idx


def xml_by_measure(rows):
    by = defaultdict(list)
    for r in rows:
        if r["rest"] or r["step"] is None:
            continue
        by[(r["mindex"], r["staff"])].append({**r, "pos": expected_pos(r)})
    return by


def measure_of(measures, page, system, x):
    for m in measures:
        if m["page"] == page and m["system"] == system and m["x0"] - 4 <= x <= m["x1"] + 4:
            return m
    return None


# the print's clef may differ from the transcription's (Rêverie's left hand
# is in treble clef until the end of m. 8 in the Henle print, bass from m. 7
# in the MuseScore file); a different clef or an 8va line shifts every
# position of the bar by the same number of steps
CLEF_SHIFTS = [0, 12, -12, 7, -7, 14, -14, 6, -6, 5, -5, 8, -8]


def print_shifts(heads, measures, by):
    """{(page, system, staff, mindex): shift} such that a head at staff
    position p is the note the MusicXML puts at p - shift: the shift that
    explains the most heads of the bar, the previous bar's on a tie (a clef
    lasts until the next one)."""
    from collections import Counter
    shifts = {}
    prev = {}
    for m in measures:
        for staff in sorted({h["staff"] for h in heads}):
            hs = [h for h in heads if h["page"] == m["page"] and h["system"] == m["system"] and h["staff"] == staff
                  and m["x0"] - 4 <= h["x"] <= m["x1"] + 4]
            pos = Counter(n["pos"] for n in by.get((m["mindex"], staff), []))
            last = prev.get(staff, 0)
            def score(k):
                c = Counter(h["step"] - k for h in hs)
                return sum(min(c[p], pos[p]) for p in c)
            best = max(CLEF_SHIFTS, key=lambda k: (score(k), k == last, k == 0))
            if score(best) == score(last):
                best = last
            shifts[(m["page"], m["system"], staff, m["mindex"])] = best
            prev[staff] = best
    return shifts


def head_match(head, page, measures, by, heads_on_page, shifts=None):
    """The MusicXML note a detected head is, or (None, reason)."""
    m = measure_of(measures, page, head["system"], head["x"])
    if m is None:
        return None, "outside every measure"
    k = (shifts or {}).get((page, head["system"], head["staff"], m["mindex"]), 0)
    notes = [n for n in by.get((m["mindex"], head["staff"]), []) if n["pos"] == head["step"] - k]
    if not notes:
        return None, f"no note at staff position {head['step']} on staff {head['staff']} of measure index {m['mindex']}"
    if len(notes) == 1:
        return notes[0], "unique" + (f", print clef shift {k:+d}" if k else "")
    # repeated position in the bar: match by left-to-right order
    same = sorted([h for h in heads_on_page if h["system"] == head["system"] and h["staff"] == head["staff"]
                   and h["step"] == head["step"] and m["x0"] - 4 <= h["x"] <= m["x1"] + 4], key=lambda h: h["x"])
    # one head per distinct onset (a unison of two voices is one head)
    onsets = sorted({n["onset"] for n in notes})
    if len(same) == len(onsets):
        rank = [round(h["x"]) for h in same].index(round(head["x"]))
        pick = [n for n in notes if n["onset"] == onsets[rank]]
        return pick[0], f"rank {rank + 1} of {len(onsets)}" + (f", print clef shift {k:+d}" if k else "")
    # fall back to the onset's share of the bar, and say so
    length = max(n["onset"] + n["dur"] for n in by.get((m["mindex"], head["staff"]), notes)) or Fraction(4)
    frac = (head["x"] - m["x0"]) / max(1.0, (m["x1"] - m["x0"]))
    pick = min(notes, key=lambda n: abs(float(n["onset"] / length) - frac))
    return pick, f"proportional ({len(same)} heads for {len(onsets)} onsets)"


def columns_near(heads, system, x, tol):
    return [h for h in heads if h["system"] == system and abs(h["x"] - x) <= tol]


def sides(systems, y0, y1):
    """(system, staff, side) a mark between rows y0..y1 may belong to: the
    staff just below it (side "above"), the staff just above it ("below"),
    or the staff it is written inside; never a staff with another between."""
    flat = [(si, k + 1, st) for si, s in enumerate(systems) for k, st in enumerate(s["staves"])]
    out = []
    for i, (si, k, st) in enumerate(flat):
        top, bot = st["lines"][0], st["lines"][-1]
        prev_bot = flat[i - 1][2]["lines"][-1] if i else float("-inf")
        next_top = flat[i + 1][2]["lines"][0] if i + 1 < len(flat) else float("inf")
        if prev_bot <= y0 and y1 <= top + 0.5 * st["space"]:
            out.append((si, k, "above"))
        elif bot - 0.5 * st["space"] <= y0 and y1 <= next_top:
            out.append((si, k, "below"))
        elif top <= (y0 + y1) / 2 <= bot:
            out.append((si, k, "inside"))
    return out


def attribute(mark, page, geom, heads, measures, by, space, shifts=None):
    """Pick the head a digit belongs to: the nearest head column across on a
    staff the digit may belong to, then the outer head of that column on
    the digit's side (a chord's top note takes a digit above it)."""
    cy, cx = mark["cy"], mark["cx"]
    allowed = {(si, k): side for si, k, side in sides(geom["systems"], mark["y0"], mark["y1"])}

    def facing(h):
        # a digit written above its staff sits above its note, one below
        # sits below it (a dynamic under the digit is not its note)
        side = allowed[(h["system"], h["staff"])]
        return side == "inside" or (h["y"] >= cy - 0.5 * space if side == "above" else h["y"] <= cy + 0.5 * space)
    # a single digit belongs to the system nearer it (a stack, whose chord
    # must match, may reach across: see attribute_stack)
    def edge(si):
        s = geom["systems"][si]
        return 0 if s["top"] <= cy <= s["bottom"] else min(abs(cy - s["top"]), abs(cy - s["bottom"]))
    if not allowed:
        return dict(status="no-head", reason="not beside any staff")
    nearest = min({si for si, _ in allowed}, key=edge)
    cand = [h for h in heads if (h["system"], h["staff"]) in allowed and h["system"] == nearest
            and abs(h["x"] - cx) <= 1.6 * space and facing(h)]
    if not cand:
        return dict(status="no-head", reason="no notehead of a staff the digit may belong to within 1.6 spaces across")

    sys_ = geom["systems"]

    def cost(h):
        # a digit is written near its note or near its staff (a high note's
        # digit sits under the staff, far from the head)
        st = sys_[h["system"]]["staves"][h["staff"] - 1]
        to_staff = 0 if st["lines"][0] <= cy <= st["lines"][-1] else min(abs(cy - st["lines"][0]), abs(cy - st["lines"][-1]))
        return abs(h["x"] - cx) / space + 0.35 * min(abs(h["y"] - cy), to_staff) / space

    ranked = sorted(cand, key=cost)
    best = ranked[0]
    col = [h for h in cand if h["system"] == best["system"] and h["staff"] == best["staff"]
           and abs(h["x"] - best["x"]) <= 0.6 * space]
    best = min(col, key=lambda h: h["y"]) if cy < best["y"] else max(col, key=lambda h: h["y"])
    alt = next((h for h in ranked if abs(h["x"] - best["x"]) > 0.6 * space or h["staff"] != best["staff"]
                or h["system"] != best["system"]), None)
    margin = (cost(alt) - cost(best)) if alt else None
    note, how = head_match(best, page, measures, by, heads, shifts)
    out = dict(head=dict(x=round(best["x"], 1), y=round(best["y"], 1), staff=best["staff"], step=best["step"],
                         system=best["system"]),
               placement="above" if cy < best["y"] else "below", how=how,
               margin=None if margin is None else round(margin, 2),
               alt=None if alt is None else dict(system=alt["system"], staff=alt["staff"]))
    if note is None:
        out.update(status="no-note", reason=how)
        return out
    out.update(status="ok", measure=note["measure"], staff=note["staff"], onset=note["onset"],
               pitch=score.name(note["step"], note["alter"], note["octave"]), note=note)
    return out


def rows_of_digits(stacks_, space):
    """Single digits written in one row (same height, side by side) belong
    to one staff; returns {stack index: row id}."""
    singles = sorted([i for i, s in enumerate(stacks_) if len(s["digits"]) == 1], key=lambda i: stacks_[i]["cx"])
    row, rid = {}, 0
    for i in singles:
        for j in list(row):
            a, b = stacks_[i], stacks_[j]
            if abs(a["cy"] - b["cy"]) < 0.6 * space and abs(a["cx"] - b["cx"]) < 3.5 * space:
                row[i] = row[j]
                break
        else:
            row[i] = rid
            rid += 1
    return row


def stacks(marks, readings, space):
    """Group digit marks stacked one above another (a chord's fingering, top
    digit for the top note) into one stack; '/' in a reading separates
    digits stacked inside one mark. Marks side by side stay apart."""
    fm = [c for c in marks if readings[c["id"]]["kind"] == "finger"]
    parent = {c["id"]: c["id"] for c in fm}

    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i
    for i, a in enumerate(fm):
        for b in fm[i + 1:]:
            gap = max(b["y0"] - a["y1"], a["y0"] - b["y1"])
            if abs(a["cx"] - b["cx"]) < 0.8 * space and gap < 1.0 * space:
                parent[root(a["id"])] = root(b["id"])
    groups = {}
    for c in fm:
        groups.setdefault(root(c["id"]), []).append(c)
    out = []
    for g in groups.values():
        g.sort(key=lambda c: c["cy"])
        digits = [d for c in g for d in readings[c["id"]]["text"].split("/")]
        box = dict(x0=min(c["x0"] for c in g), x1=max(c["x1"] for c in g), y0=min(c["y0"] for c in g),
                   y1=max(c["y1"] for c in g))
        box.update(cx=sum(c["cx"] for c in g) / len(g), cy=(box["y0"] + box["y1"]) / 2)
        out.append(dict(ids=[c["id"] for c in g], digits=digits, **box))
    out.sort(key=lambda s: (s["y0"], s["x0"]))
    return out


def attribute_stack(st, page, geom, heads, measures, by, space, shifts=None):
    """A stack of k digits goes to the nearest chord of exactly k heads on
    the side the stack is written (from either system it lies between),
    top digit to top note; no such chord is left for a person."""
    k = len(st["digits"])
    cols = []
    for si, staff, _ in sides(geom["systems"], st["y0"], st["y1"]):
        hs = sorted([h for h in heads if h["system"] == si and h["staff"] == staff
                     and abs(h["x"] - st["cx"]) <= 1.6 * space], key=lambda h: h["x"])
        # columns: heads within 0.9 space across (a second's offset head joins)
        col = []
        for h in hs:
            if col and h["x"] - col[0]["x"] > 0.9 * space:
                cols.append(col)
                col = []
            col.append(h)
        if col:
            cols.append(col)
    best = None
    for col in cols:
        steps = {h["step"] for h in col}
        if len(steps) != k:
            continue
        top, bot = min(h["y"] for h in col), max(h["y"] for h in col)
        if st["y1"] <= top:
            side, dy = "above", top - st["y1"]
        elif st["y0"] >= bot:
            side, dy = "below", st["y0"] - bot
        else:
            continue
        dx = abs(sum(h["x"] for h in col) / len(col) - st["cx"])
        stf = geom["systems"][col[0]["system"]]["staves"][col[0]["staff"] - 1]
        to_staff = max(0, stf["lines"][0] - st["y1"]) if side == "above" else max(0, st["y0"] - stf["lines"][-1])
        cost = dx / space + 0.35 * min(dy, to_staff) / space
        if best is None or cost < best[0]:
            best = (cost, col, side)
    if best is None:
        return dict(status="no-chord", reason=f"stack of {k} digits with no chord of {k} notes beside it")
    _, col, side = best
    col = sorted({h["step"]: h for h in col}.values(), key=lambda h: h["y"])
    out = []
    for d, h in zip(st["digits"], col):
        note, how = head_match(h, page, measures, by, heads, shifts)
        if note is None:
            return dict(status="no-note", reason=how)
        out.append(dict(digit=d, placement=side, how=how, note=note, measure=note["measure"], staff=note["staff"],
                        onset=note["onset"], pitch=score.name(note["step"], note["alter"], note["octave"]),
                        head=dict(x=round(h["x"], 1), y=round(h["y"], 1))))
    return dict(status="ok", notes=out)
