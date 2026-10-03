"""Stage 2: split the ink into marks (connected clusters of strokes)."""
import numpy as np
from scipy import ndimage


def clusters(mask, px_per_pt, join_pt=1.0, min_px=12):
    """Strokes closer than join_pt points join one mark (the two strokes of
    a hand-written 4, a digit's serif); specks under min_px pixels are noise."""
    r = max(1, int(round(join_pt * px_per_pt / 2)))
    grown = ndimage.binary_dilation(mask, structure=np.ones((2 * r + 1, 2 * r + 1), bool))
    labels, n = ndimage.label(grown, structure=np.ones((3, 3), bool))
    labels = labels * mask  # keep only real ink pixels in each label
    out = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        sub = labels[sl] == i
        npx = int(sub.sum())
        if npx < min_px:
            continue
        ys, xs = np.nonzero(sub)
        out.append(dict(y0=sl[0].start, y1=sl[0].stop, x0=sl[1].start, x1=sl[1].stop,
                        cx=float(xs.mean() + sl[1].start), cy=float(ys.mean() + sl[0].start), px=npx))
    # a total order: ties in (y0, x0) (e.g. two marks sharing a bounding-box
    # corner) are broken by the centroid, so mark ids are reproducible
    out.sort(key=lambda c: (c["y0"], c["x0"], c["cx"]))
    return out
