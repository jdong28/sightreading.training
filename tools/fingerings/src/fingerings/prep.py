"""Scan preprocessing, applied before staff/head detection: a grey
threshold tuned to the page's own ink and paper tone, clearing a dark
scanner border, deskewing, and filling small binarisation speckles once
the staff space is known. Image-sourced pages only: a born-digital render
(no scan image at all) has no skew, border or speckle by construction and
gets none of this. A 1-bit scan keeps the fixed 128 threshold (equivalent
for an already-binary image) and only gets border clearing and deskew."""
import numpy as np
from scipy import ndimage

MIN_SPACE_PX = 16


def grey_threshold(gray):
    """ink + 0.6 * (paper - ink), clamped to [128, 200]: paper is the 90th
    percentile grey level, ink the 5th percentile."""
    paper = float(np.percentile(gray, 90))
    ink = float(np.percentile(gray, 5))
    t = ink + 0.6 * (paper - ink)
    return int(round(min(200, max(128, t))))


def clear_border(black):
    """Whitens black components that touch the image's edge: a scanner's
    dark surround, left uncleared, joins every staff into one system."""
    labels, n = ndimage.label(black, structure=np.ones((3, 3), bool))
    if n == 0:
        return black
    h, w = black.shape
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border_labels.discard(0)
    if not border_labels:
        return black
    out = black.copy()
    out[np.isin(labels, list(border_labels))] = False
    return out


def _row_energy(mask, angle_deg):
    """Sum of squared row-counts after rotating the mask's coordinates
    (not the raster) by angle_deg: a sharper energy means the black rows
    line up better with the horizontal, i.e. less skew."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return 0.0
    theta = np.deg2rad(angle_deg)
    rotated_y = ys * np.cos(theta) - xs * np.sin(theta)
    h = mask.shape[0]
    bins = np.clip(np.round(rotated_y).astype(int), 0, h - 1)
    counts = np.bincount(bins, minlength=h)
    return float(np.sum(counts.astype(np.int64) ** 2))


def estimate_skew(black, coarse_step=0.1, coarse_range=3.0, fine_range=0.15, fine_step=0.01):
    """The rotation (degrees) that maximises the black-pixel row profile's
    energy, coarse (on a x4-downsampled mask) then fine, over pixel
    coordinates rather than per-angle image rotation."""
    small = black[::4, ::4]
    coarse_angles = np.arange(-coarse_range, coarse_range + 1e-9, coarse_step)
    best_coarse = max(coarse_angles, key=lambda a: _row_energy(small, a))
    fine_angles = np.arange(best_coarse - fine_range, best_coarse + fine_range + 1e-9, fine_step)
    best = max(fine_angles, key=lambda a: _row_energy(black, a))
    return round(float(best), 2)


def _rotate(arr, angle_deg, fill, order):
    return ndimage.rotate(arr.astype(np.float32), -angle_deg, reshape=False, order=order,
                           mode="constant", cval=fill)


def deskew(gray, ink, angle_deg, threshold=0.05):
    """Rotates the grey scan (bilinear, white fill) and the ink layer
    (nearest-neighbour, fill 0) by the same angle about the same centre,
    so everything downstream lives on the deskewed grid. A no-op (same
    array) when the estimated angle is below `threshold`."""
    if abs(angle_deg) < threshold:
        return gray, ink
    new_gray = np.clip(_rotate(gray, angle_deg, fill=255, order=1), 0, 255).astype(np.uint8)
    new_ink = (_rotate(ink.astype(np.float32), angle_deg, fill=0, order=0) > 0.5).astype(ink.dtype) \
        if ink.dtype == bool else np.clip(_rotate(ink, angle_deg, fill=0, order=0), 0, 255).astype(ink.dtype)
    return new_gray, new_ink


def pinhole_fill(black, space):
    """Fills small enclosed white specks (binarisation noise in solid
    ink) up to max(4, round(0.03 * space^2)) px; a hollow head's own hole
    (about 0.4 x 0.25 space, far larger) stays open."""
    holes = ndimage.binary_fill_holes(black) & ~black
    labels, n = ndimage.label(holes)
    if n == 0:
        return black
    max_area = max(4, round(0.03 * space * space))
    keep = np.zeros_like(black)
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        sub = labels[sl] == i
        if sub.sum() <= max_area:
            keep[sl] |= sub
    return black | keep


def resolution_floor_reason(space, min_space_px=MIN_SPACE_PX):
    """None when the detected (or, with no staff found at all, the
    run-length-estimated) staff space clears the floor; otherwise the
    stop message naming it."""
    if space is None or space >= min_space_px:
        return None
    dpi = round(space / 0.08)  # a staff space is about 8% of an inch at concert pitch engraving
    return (f"scan resolution too low: staff space {space:.1f} px (about {dpi} dpi), "
            f"need >= {min_space_px} px; use a scan of at least 300 dpi")


def estimate_space_from_runs(black):
    """When no staff is found at all: the most common white run plus the
    most common black run, in a representative column-free sense (the
    page's vertical run-length histogram), as a fallback space estimate."""
    from .staves import vertical_run_lengths
    runs_black = vertical_run_lengths(black)
    runs_white = vertical_run_lengths(~black)
    black_vals = runs_black[black]
    white_vals = runs_white[~black]
    if black_vals.size == 0 or white_vals.size == 0:
        return None
    common_black = int(np.bincount(black_vals).argmax())
    common_white = int(np.bincount(white_vals).argmax())
    return float(common_black + common_white)
