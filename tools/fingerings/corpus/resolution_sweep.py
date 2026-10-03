#!/usr/bin/env python3
"""Resolution-floor sweep: downsamples a passing corpus scan to a series
of target staff spaces (in px) and runs the full geometry+match pipeline
at each, to confirm the floor (prep.MIN_SPACE_PX, 16px) does what it's
for -- every page at or above it is usable, and every page below it stops
cleanly (prep.resolution_floor_reason), rather than running anyway and
silently misreading the page.

Dev only (needs corpus/files/ already fetched); never run in CI. `uv run
python corpus/resolution_sweep.py [piece-id] [--spaces 16 14 12 10]`."""
import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image

HERE = Path(__file__).parent
FILES = HERE / "files"
SRC = HERE.parent / "src"
sys.path.insert(0, str(SRC))

from fingerings import extract, geometry  # noqa: E402

DEFAULT_SPACES = (20, 18, 16, 14, 12, 10)


def _piece(piece_id):
    pieces = json.loads((HERE / "corpus.json").read_text())["pieces"]
    return next(p for p in pieces if p["id"] == piece_id)


def run_dir_at(gray, piece, tmp_root):
    """A manifest.json + a single-page PDF wrapping `gray`, pointed at the
    piece's own real MusicXML: the same head-match gate run_corpus.py
    checks, at this resolution."""
    run_dir = Path(tmp_root)
    (run_dir / "inputs").mkdir(parents=True, exist_ok=True)
    pdf_path = run_dir / "inputs" / "page.pdf"
    Image.fromarray(gray, mode="L").save(pdf_path, "PDF", resolution=72.0)
    xml_src = FILES / f"{piece['id']}.mxl"
    xml_dest = run_dir / "inputs" / xml_src.name
    shutil.copy(xml_src, xml_dest)
    man = dict(piece=piece["id"], pdf="inputs/page.pdf", musicxml=f"inputs/{xml_src.name}",
               pages=[1, 1], render_scale=1)
    if piece.get("measures"):
        man["measures"] = piece["measures"]
    (run_dir / "manifest.json").write_text(json.dumps(man, indent=1))
    return run_dir


def native_gray(pdf_path, render_scale=6):
    with pikepdf.open(pdf_path) as pdf:
        L = extract.page_layers(pdf, 0, render_scale=render_scale)
    return L["scan"]["gray"], L["scan"]["kind"]


def downsample_to_space(gray, native_space, target_space):
    """A grayscale page resampled so its staff space becomes
    `target_space` px, by the same ratio applied to both dimensions
    (LANCZOS, the resampling a real lower-DPI scan's own anti-aliasing is
    closest to)."""
    if target_space >= native_space:
        return gray
    scale = target_space / native_space
    h, w = gray.shape
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    im = Image.fromarray(gray, mode="L").resize((new_w, new_h), Image.LANCZOS)
    return np.array(im)


def sweep(piece_id, spaces, pdf_path=None):
    piece = _piece(piece_id)
    pdf_path = pdf_path or (FILES / f"{piece_id}.pdf")
    gray0, kind = native_gray(pdf_path)
    G0, heads0, native_space, meta0 = geometry.analyze_page(gray0, scan_kind=kind)
    print(f"=== {piece_id}: native space {native_space:.1f}px, kind {kind} ===")
    print(f"{'target px':>9}  {'measured px':>11}  {'result':<60}  {'head match':>12}")

    rows = []
    for target in spaces:
        gray = downsample_to_space(gray0, native_space, target)
        # a downsampled page is no longer the scan's own raw levels, but
        # it is still image-sourced (anti-aliased, non-1bit): analyze_page
        # re-estimates its own threshold exactly as a real lower-DPI scan
        # would give it.
        scan_kind = "image-gray" if kind != "render" else "render"
        G, heads, space, meta = geometry.analyze_page(gray, scan_kind=scan_kind)
        stop = meta.get("stop")
        n_systems = len(G["systems"])

        rate = None
        if not stop:
            with tempfile.TemporaryDirectory() as tmp:
                run_dir = run_dir_at(gray, piece, tmp)
                report, _code = geometry.run_geometry(run_dir)
                rate_check = next((c for c in report["checks"] if c["check"].startswith("p1:")), None)
                if rate_check:
                    rate = rate_check["detail"]

        rows.append(dict(target_space=target, measured_space=round(space, 1) if space else None,
                          stop=stop, n_systems=n_systems, n_heads=len(heads), head_match=rate))
        result = f"STOP: {stop}" if stop else f"ran: {n_systems} systems, {len(heads)} heads"
        ms = "n/a" if space is None else f"{space:.1f}"
        print(f"{target:>9}  {ms:>11}  {result:<60}  {rate or '':>12}")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("piece", nargs="?", default="maple-leaf-rag-loc-p4")
    ap.add_argument("--spaces", type=int, nargs="+", default=list(DEFAULT_SPACES))
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()

    rows = sweep(args.piece, args.spaces)
    if args.json:
        args.json.write_text(json.dumps(rows, indent=1) + "\n")
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()
