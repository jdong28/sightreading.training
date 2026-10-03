"""Unit tests for staves.py on synthetic rasters: thin-run staff-line
centres, the two-tier bar-line rule, one-staff and voice-plus-piano
systems, and the system header before a start-repeat."""
import numpy as np

from fingerings import staves

SPACE = 24
THICK = 3
W, H = 2000, 900


def _canvas():
    return np.zeros((H, W), dtype=bool)


def _draw_line(black, y, x0=0, x1=None, thickness=THICK):
    x1 = black.shape[1] if x1 is None else x1
    y0 = int(round(y - thickness / 2))
    black[y0:y0 + thickness, x0:x1] = True


def _draw_staff(black, top_y, space=SPACE, x0=0, x1=None, thickness=THICK):
    ys = [top_y + i * space for i in range(5)]
    for y in ys:
        _draw_line(black, y, x0, x1, thickness)
    return ys


def _draw_head(black, x, y, space=SPACE):
    r = int(round(space * 0.32))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disc = xx * xx + yy * yy <= r * r
    cy, cx = int(round(y)), int(round(x))
    black[cy - r:cy + r + 1, cx - r:cx + r + 1] |= disc


def test_beam_on_line():
    black = _canvas()
    ys_a = _draw_staff(black, 100)
    ys_b = _draw_staff(black, 400)
    # a 12-px-thick beam lying on line 4 (index 3) of the upper staff,
    # across 40% of the width
    _draw_line(black, ys_a[3], x0=0, x1=int(0.4 * W), thickness=12)

    lines = staves.staff_lines(black)
    sts = staves.staves_from_lines(lines)
    assert len(sts) == 2
    for st, drawn_ys in zip(sts, (ys_a, ys_b)):
        for found_y, drawn_y in zip(st["lines"], drawn_ys):
            assert abs(found_y - drawn_y) <= 1.0


def test_ledger_rows_not_a_staff():
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    # three rows of ledger dashes at whole spaces above the staff, each a
    # run of short dashes across half the width
    top = ys[0]
    for k in (1, 2, 3):
        y = top - k * space
        x = 0
        while x < 0.5 * W:
            _draw_line(black, y, x0=x, x1=min(int(0.5 * W), x + 40), thickness=THICK)
            x += 40 + 30

    lines = staves.staff_lines(black)
    sts = staves.staves_from_lines(lines)
    assert len(sts) == 1
    assert abs(sts[0]["lines"][0] - ys[0]) <= 1.0


def test_line_thickness_ignores_beams():
    black = _canvas()
    _draw_staff(black, 300)
    # a canvas dominated by very thick beams elsewhere: the thickness
    # estimate must still land on the staff lines' own 3 px, not a
    # page-wide mode skewed by the beams
    for x0 in range(0, W, 200):
        _draw_line(black, 700, x0=x0, x1=x0 + 150, thickness=16)
    runs = staves.vertical_run_lengths(black)
    rows = np.where(black.sum(1) > 0.25 * W)[0]
    thickness = int(np.bincount(runs[rows][black[rows]]).argmax())
    assert thickness == THICK


def _one_system(staves_lines):
    return dict(staves=[dict(lines=lines, space=float(np.mean(np.diff(lines)))) for lines in staves_lines])


def test_bars_aligned_stems():
    black = _canvas()
    ys_a = _draw_staff(black, 100)
    ys_b = _draw_staff(black, 300)
    space = SPACE
    gap_y0, gap_y1 = ys_a[-1], ys_b[0]
    sys_ = _one_system([ys_a, ys_b])
    # the opening line, full height through both staves and the gap
    black[int(ys_a[0]):int(ys_b[-1]) + 1, 10:10 + THICK] = True

    # an upper-staff stem-down (its head to the right, at the stem's
    # right edge) and a lower-staff stem-up (its head to the left), in
    # one column at x=300, each staff individually full-height but the
    # gap only 60% filled: not a bar line
    sx = 300
    gap_h = gap_y1 - gap_y0
    black[int(ys_a[0]):int(ys_a[-1]) + 1, sx:sx + 2] = True
    black[int(gap_y0):int(gap_y0 + 0.6 * gap_h), sx:sx + 2] = True
    black[int(ys_b[0]):int(ys_b[-1]) + 1, sx:sx + 2] = True
    heads_in_system = [
        dict(x=sx + space / 2, y=ys_a[-1] - space, w=space, system=0, staff=1),
        dict(x=sx - space / 2, y=ys_b[0] + space, w=space, system=0, staff=2),
    ]

    # a true bar line at x=600: fills the whole gap but interrupted by 1
    # space in the middle (text), with no head touching it
    bx = 600
    black[int(ys_a[0]):int(ys_b[-1]) + 1, bx:bx + 2] = True
    black[int((ys_a[-1] + ys_b[0]) / 2 - 0.5 * space):int((ys_a[-1] + ys_b[0]) / 2 + 0.5 * space), bx:bx + 2] = False

    # a bar line at x=900 filling the whole gap, with a head 2 px to its
    # right: still a bar line (rule 2 needs no head check once the gap is
    # fully filled)
    cx = 900
    black[int(ys_a[0]):int(ys_b[-1]) + 1, cx:cx + 2] = True
    heads_in_system.append(dict(x=cx + 2 + space * 0.4, y=ys_a[2], w=space, system=0, staff=1))

    bars = staves.barlines(black, sys_, heads_in_system=heads_in_system)
    xs = sorted(round(b["x"]) for b in bars)
    assert sx not in xs
    assert any(abs(x - bx) <= 2 for x in xs)
    assert any(abs(x - cx) <= 2 for x in xs)


def test_bars_one_staff():
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    sys_ = _one_system([ys])
    top, bot = ys[0], ys[-1]
    # the opening line
    black[int(top):int(bot) + 1, 10:10 + THICK] = True
    # a chord's stem (stem-up: the head sits just left of it, its right
    # edge against the stem) through the whole staff at x=300: not a bar
    # line without the opening-line exemption
    sx = 300
    black[int(top):int(bot) + 1, sx:sx + 2] = True
    head_x = sx - space / 2
    _draw_head(black, head_x, (top + bot) / 2)
    # a true bar line at x=600
    bx = 600
    black[int(top):int(bot) + 1, bx:bx + 2] = True

    heads_in_system = [dict(x=head_x, y=(top + bot) / 2, w=space, system=0, staff=1)]
    bars = staves.barlines(black, sys_, heads_in_system=heads_in_system)
    xs = sorted(round(b["x"]) for b in bars)
    assert sx not in xs
    assert any(abs(x - bx) <= 2 for x in xs)
    assert any(abs(x - 10) <= 2 for x in xs)  # the opening line is kept


def test_bars_voice_piano():
    black = _canvas()
    ys_v = _draw_staff(black, 100)   # voice staff
    ys_p1 = _draw_staff(black, 300)  # piano RH
    ys_p2 = _draw_staff(black, 500)  # piano LH
    sys_ = _one_system([ys_v, ys_p1, ys_p2])
    top, bot = ys_v[0], ys_p2[-1]
    # the opening line joins all three staves
    black[int(top):int(bot) + 1, 10:10 + THICK] = True
    # bar lines cross the piano pair's gap but stop at the voice-piano gap
    for bx in (500, 900):
        black[int(ys_p1[0]):int(ys_p2[-1]) + 1, bx:bx + 2] = True
        black[int(ys_v[-1]):int(ys_v[-1]) + int((ys_p1[0] - ys_v[-1])) + 1, bx:bx + 2] = False

    bars = staves.barlines(black, sys_, heads_in_system=[])
    assert len(bars) == 1
    assert abs(bars[0]["x"] - 10) <= 2  # only the opening line: the two
    # mid-piece columns don't fill the voice-piano gap, so without the
    # barred-gap exemption they'd never qualify either -- they are still
    # found as piano-only bars via the barred-gap logic:
    bars2 = staves.barlines(black, dict(staves=[dict(lines=ys_p1, space=SPACE), dict(lines=ys_p2, space=SPACE)]),
                             heads_in_system=[])
    xs2 = sorted(round(b["x"]) for b in bars2)
    assert any(abs(x - 500) <= 2 for x in xs2) and any(abs(x - 900) <= 2 for x in xs2)


def test_system_header_before_start_repeat():
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    top, bot = ys[0], ys[-1]
    sys_ = _one_system([ys])
    # the opening line
    black[int(top):int(bot) + 1, 10:10 + THICK] = True
    # an empty interval (10 spaces), then a thick-plus-thin start-repeat
    # group (double line wider than 0.4 space)
    rx0 = 10 + 10 * space
    black[int(top):int(bot) + 1, rx0:rx0 + 2] = True
    black[int(top):int(bot) + 1, rx0 + int(0.5 * space):rx0 + int(0.5 * space) + 2] = True
    # two real bars with heads after it
    b1x = rx0 + int(0.5 * space) + 6 * space
    b2x = b1x + 6 * space
    for bx in (b1x, b2x):
        black[int(top):int(bot) + 1, bx:bx + 2] = True
    _draw_head(black, (rx0 + 0.5 * space + b1x) / 2, ys[2])
    _draw_head(black, (b1x + b2x) / 2, ys[2])
    heads_in_system = [
        dict(x=(rx0 + 0.5 * space + b1x) / 2, y=ys[2], w=space, system=0, staff=1),
        dict(x=(b1x + b2x) / 2, y=ys[2], w=space, system=0, staff=1),
    ]

    bars = staves.barlines(black, sys_, heads_in_system=heads_in_system)
    # the opening line is dropped (it was the header, not a bar): 3 bars
    # left (the repeat group, b1x, b2x), i.e. 2 measures
    assert len(bars) == 3
    measures = [dict(x0=bars[i]["x1"], x1=bars[i + 1]["x0"]) for i in range(len(bars) - 1)]
    assert len(measures) == 2


def test_assign_bars_no_opening_line():
    """A system with no drawn opening stroke (common for a single-staff
    part's continuation system): its first measure's notes sit before
    the first real bar line, which must not be lost."""
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    top, bot = ys[0], ys[-1]
    sys_ = _one_system([ys])
    systems = [sys_]

    n1x, n2x = 200, 600  # two notes of the "missing" first measure
    mid_x = 900  # the true bar line between the two measures
    final_x = 1400
    black[int(top):int(bot) + 1, mid_x:mid_x + 2] = True
    black[int(top):int(bot) + 1, final_x:final_x + 2] = True

    heads = [
        dict(x=n1x, y=ys[2], w=space, system=0, staff=1),
        dict(x=n2x, y=ys[2], w=space, system=0, staff=1),
        dict(x=1100, y=ys[2], w=space, system=0, staff=1),
    ]
    staves.assign_bars(black, systems, heads)
    bars = sys_["bars"]
    xs = sorted(round(b["x"]) for b in bars)
    assert any(abs(x - mid_x) <= 2 for x in xs)
    assert any(abs(x - final_x) <= 2 for x in xs)
    measures = sys_["measures"]
    assert len(measures) == 2  # the implicit first measure is not lost
    assert measures[0]["x0"] <= n1x <= measures[0]["x1"]
    assert measures[0]["x0"] <= n2x <= measures[0]["x1"]
    assert measures[1]["x0"] <= 1100 <= measures[1]["x1"]


def test_assign_bars_no_opening_line_stem_not_mistaken():
    """Without a drawn opening line, the first real candidate (which may
    just be an ordinary stem spanning the staff, not a bar line at all)
    is not exempted from the head-touch check merely for being first."""
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    top, bot = ys[0], ys[-1]
    sys_ = _one_system([ys])
    systems = [sys_]

    n1x, n2x = 200, 600
    stem_x = 900  # a stem-down note's stem spans the whole staff height
    black[int(top):int(bot) + 1, stem_x:stem_x + 2] = True
    stem_head_x = stem_x - space / 2
    final_x = 1400
    black[int(top):int(bot) + 1, final_x:final_x + 2] = True

    heads = [
        dict(x=n1x, y=ys[2], w=space, system=0, staff=1),
        dict(x=n2x, y=ys[2], w=space, system=0, staff=1),
        dict(x=stem_head_x, y=ys[2], w=space, system=0, staff=1),
    ]
    staves.assign_bars(black, systems, heads)
    xs = sorted(round(b["x"]) for b in sys_["bars"])
    assert stem_x not in xs
    assert any(abs(x - final_x) <= 2 for x in xs)


def test_assign_bars_clef_artifact_not_mistaken_for_missing_opening():
    """A single stray blob near the system's start (a clef loop's round
    bowl, read as a false notehead) must not be mistaken for "no opening
    line drawn": the real opening line is kept as the system's start."""
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    top, bot = ys[0], ys[-1]
    sys_ = _one_system([ys])
    systems = [sys_]

    opening_x = 100
    black[int(top):int(bot) + 1, opening_x:opening_x + 2] = True
    final_x = 900
    black[int(top):int(bot) + 1, final_x:final_x + 2] = True

    # one stray blob (the clef artifact), close to the opening line
    heads = [dict(x=opening_x - 10, y=ys[0] - space, w=space, system=0, staff=1)]
    staves.assign_bars(black, systems, heads)
    bars = sys_["bars"]
    xs = sorted(round(b["x"]) for b in bars)
    assert any(abs(x - opening_x) <= 2 for x in xs)
    assert len(sys_["measures"]) == 1
