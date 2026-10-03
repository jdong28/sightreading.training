"""Unit tests for heads.py on synthetic rasters: a ledger-line note is
kept only when the page actually draws the ledger lines a note that far
from the staff needs."""
import numpy as np

from fingerings import heads

SPACE = 24
THICK = 3
W, H = 800, 600


def _canvas():
    return np.zeros((H, W), dtype=bool)


def _draw_line(black, y, x0, x1, thickness=THICK):
    y0 = int(round(y - thickness / 2))
    black[y0:y0 + thickness, x0:x1] = True


def _draw_staff(black, top_y, space=SPACE, x0=0, x1=None):
    x1 = black.shape[1] if x1 is None else x1
    ys = [top_y + i * space for i in range(5)]
    for y in ys:
        _draw_line(black, y, x0, x1)
    return ys


def _draw_head(black, x, y, space=SPACE):
    r = int(round(space * 0.32))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disc = xx * xx + yy * yy <= r * r
    cy, cx = int(round(y)), int(round(x))
    black[cy - r:cy + r + 1, cx - r:cx + r + 1] |= disc


def _system(ys, space=SPACE):
    return dict(staves=[dict(lines=ys, space=space)], top=ys[0], bottom=ys[-1])


def test_place_keeps_real_ledger_note():
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    bot = ys[-1]
    x = 400
    # a note 2 ledger lines above the top line (pos 12): draw both
    for p in (10, 12):
        y = bot - p * (space / 2)
        _draw_line(black, y, int(x - 0.6 * space), int(x + 0.6 * space) + 1)
    _draw_head(black, x, bot - 12 * (space / 2))
    heads_raw = [dict(x=float(x), y=float(bot - 12 * (space / 2)), w=space * 0.8, h=space * 0.7)]
    placed = heads.place(heads_raw, [_system(ys)], black=black)
    assert len(placed) == 1
    assert placed[0]["step"] == 12


def test_place_drops_text_at_ledger_position_with_no_ledger_lines():
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    bot = ys[-1]
    x = 400
    # a notehead-sized, notehead-shaped blob at the same height, but with
    # no ledger lines drawn anywhere near it (text, a measure number, an
    # accidental -- not a real ledger-line note)
    _draw_head(black, x, bot - 12 * (space / 2))
    heads_raw = [dict(x=float(x), y=float(bot - 12 * (space / 2)), w=space * 0.8, h=space * 0.7)]
    placed = heads.place(heads_raw, [_system(ys)], black=black)
    assert placed == []


def test_place_keeps_note_in_gap_just_past_staff_no_ledger_needed():
    black = _canvas()
    ys = _draw_staff(black, 300)
    space = SPACE
    bot = ys[-1]
    x = 400
    # a note one half-space above the top line (pos 9): sits in the gap
    # just past the staff, no ledger line is ever drawn for it
    _draw_head(black, x, bot - 9 * (space / 2))
    heads_raw = [dict(x=float(x), y=float(bot - 9 * (space / 2)), w=space * 0.8, h=space * 0.7)]
    placed = heads.place(heads_raw, [_system(ys)], black=black)
    assert len(placed) == 1
    assert placed[0]["step"] == 9


def test_place_without_black_skips_ledger_check():
    """Backward compatible: when black isn't given (as in a few
    diagnostic/test call sites), every head within max_ledger is kept,
    same as before this check existed."""
    ys = [300.0, 324.0, 348.0, 372.0, 396.0]
    bot = ys[-1]
    space = SPACE
    heads_raw = [dict(x=400.0, y=bot - 12 * (space / 2), w=space * 0.8, h=space * 0.7)]
    placed = heads.place(heads_raw, [_system(ys)])
    assert len(placed) == 1
