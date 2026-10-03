#!/usr/bin/env python3
"""Crops a small, committed PNG fixture for test_geometry.py out of a full
corpus scan page: the corpus's own files (corpus/files/, fetched by
corpus/fetch.py) are gitignored and dev-only, so this is how a specific,
already-diagnosed scan passage becomes something CI can actually run
against. Crops from the page's own thresholded ink (`black`, from
geometry.analyze_page on the *whole* page, which is the one pass whose
preprocessing -- skew, threshold estimation, pinhole fill -- is calibrated
on full-page statistics) rather than re-deriving a threshold on the crop
alone, which a crop this small can't support. Pads the crop with a white
margin before saving: `prep.clear_border` whitens any ink touching the
image's edge (meant for a scanner's dark surround), and every staff and
bar line in an unpadded crop touches an edge by construction.

Run offline-unfriendly (needs corpus/files/ already fetched); not run in
CI. `uv run python tests/make_geometry_fixtures.py` regenerates every
fixture named in FIXTURES below; add a new entry to crop another one (then
hand-encode its MusicXML to match, as the existing fixtures' own header
comments describe)."""
import sys
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image

HERE = Path(__file__).parent
CORPUS = HERE.parent / "corpus"
SRC = HERE.parent / "src"
sys.path.insert(0, str(SRC))

from fingerings import extract, geometry  # noqa: E402

MARGIN = 40

FIXTURES = [
    dict(
        out="loc_maple_leaf_p3_trio_seconds_chord.png",
        pdf=CORPUS / "files" / "maple-leaf-rag-loc-p3.pdf",
        render_scale=6,
        # system 5 (0-indexed), one measure: the four-note chord (two
        # noteheads a second apart stacked on two more) heads.py's
        # wide-cluster split exists for
        y0=3250, y1=3610, x0=1260, x1=1615,
    ),
]


def make_fixture(out, pdf, render_scale, y0, y1, x0, x1):
    with pikepdf.open(pdf) as doc:
        L = extract.page_layers(doc, 0, render_scale=render_scale)
        G, _heads, _space, _meta = geometry.analyze_page(L["scan"]["gray"], scan_kind=L["scan"]["kind"])
    black = G["black"][y0:y1, x0:x1]
    h, w = black.shape
    padded = np.zeros((h + 2 * MARGIN, w + 2 * MARGIN), dtype=bool)
    padded[MARGIN:MARGIN + h, MARGIN:MARGIN + w] = black
    gray = np.where(padded, 0, 255).astype(np.uint8)
    out_path = HERE / "fixture" / "geometry" / out
    Image.fromarray(gray, mode="L").save(out_path)
    print(f"wrote {out_path} ({gray.shape[1]}x{gray.shape[0]})")


def main():
    for spec in FIXTURES:
        make_fixture(**spec)


if __name__ == "__main__":
    main()
