"""Unit tests for prep.py: the grey threshold rule, border clearing,
deskew (estimate and undo), and pinhole fill."""
import numpy as np
from scipy import ndimage

from fingerings import prep

SPACE = 24


def _two_staves():
    """Two separate single staves, well apart, nothing drawn between
    them, for the border test."""
    h, w = 900, 1600
    black = np.zeros((h, w), dtype=bool)
    for top in (100, 400):
        for i in range(5):
            y = top + i * SPACE
            black[y - 1:y + 2, 50:w - 50] = True
    return black


def test_threshold_rule():
    gray = np.zeros((20, 20), dtype=np.uint8)
    gray[:10] = 205  # paper
    gray[10:] = 60  # ink
    t = prep.grey_threshold(gray)
    assert 147 <= t <= 157


def test_border_cleared():
    from fingerings import staves

    black = _two_staves()
    h, w = black.shape
    framed = black.copy()
    framed[:25, :] = True
    framed[-25:, :] = True
    framed[:, :25] = True
    framed[:, -25:] = True

    # uncleared, the border's own ink at the image edges spans the gap
    # between the two staves, wrongly joining them into one system
    lines_bordered = staves.staff_lines(framed)
    sts_bordered = staves.staves_from_lines(lines_bordered)
    systems_bordered = staves.systems_from_staves(framed, sts_bordered)
    assert len(systems_bordered) == 1
    assert len(systems_bordered[0]["staves"]) == 2

    cleared = prep.clear_border(framed)
    assert not cleared[:25, :].any()
    assert not cleared[-25:, :].any()
    assert not cleared[:, :25].any()
    assert not cleared[:, -25:].any()
    # cleared, the two staves are separate systems again
    lines = staves.staff_lines(cleared)
    sts = staves.staves_from_lines(lines)
    systems = staves.systems_from_staves(cleared, sts)
    assert len(systems) == 2
    assert all(len(s["staves"]) == 1 for s in systems)


def test_skew_estimated_and_undone():
    black = _two_staves()
    assert abs(prep.estimate_skew(black)) <= 0.03

    gray = np.where(black, 0, 255).astype(np.uint8)
    ink = np.zeros_like(gray, dtype=np.uint8)
    ink[300, 700] = 255  # one marked pixel

    angle = 0.30
    rotated_gray = np.clip(prep._rotate(gray, -angle, fill=255, order=1), 0, 255).astype(np.uint8)
    rotated_black = rotated_gray < 128
    est = prep.estimate_skew(rotated_black)
    assert abs(est - angle) <= 0.03

    rotated_ink = np.clip(prep._rotate(ink, -angle, fill=0, order=0), 0, 255).astype(np.uint8)
    new_gray, new_ink = prep.deskew(rotated_gray, rotated_ink, est)
    ys, xs = np.nonzero(new_ink > 128)
    assert len(ys) >= 1
    assert abs(float(ys.mean()) - 300) <= 1 and abs(float(xs.mean()) - 700) <= 1

    # the unrotated page estimates exactly 0.0, and prep returns the same
    # array (or one equal byte for byte) when the angle is below threshold
    same_gray, same_ink = prep.deskew(gray, ink, 0.0)
    assert np.array_equal(same_gray, gray) and np.array_equal(same_ink, ink)


def test_pinhole_fill():
    black = np.zeros((60, 60), dtype=bool)
    space = SPACE
    # a filled head drawn with 2x2 white speckles inside it
    r = int(round(space * 0.32))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disc = xx * xx + yy * yy <= r * r
    cy, cx = 30, 20
    black[cy - r:cy + r + 1, cx - r:cx + r + 1] |= disc
    black[cy - 1:cy + 1, cx - 1:cx + 1] = False  # a 2x2 speckle hole

    filled = prep.pinhole_fill(black, space)
    assert filled[cy, cx]

    # a hollow head's hole (about 0.4 x 0.25 space) stays open
    hollow = np.zeros((60, 60), dtype=bool)
    hcy, hcx = 30, 20
    hh, hw = int(0.25 * space), int(0.4 * space)
    hollow[hcy - r:hcy + r + 1, hcx - r:hcx + r + 1] |= disc
    hollow[hcy - hh // 2:hcy + hh // 2, hcx - hw // 2:hcx + hw // 2] = False
    filled_hollow = prep.pinhole_fill(hollow, space)
    assert not filled_hollow[hcy, hcx]


def test_resolution_floor():
    assert prep.resolution_floor_reason(8.0) is not None
    assert "8.0 px" in prep.resolution_floor_reason(8.0)
    assert prep.resolution_floor_reason(20.0) is None
    assert prep.resolution_floor_reason(prep.MIN_SPACE_PX) is None
