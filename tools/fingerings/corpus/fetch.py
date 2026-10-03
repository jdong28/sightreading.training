#!/usr/bin/env python3
"""Fetches/builds every corpus piece named in corpus.json into
corpus/files/ (gitignored; never committed). Three kinds:
- scan: downloads the LoC JP2 master (verifying its sha256), wraps it
  into a one-page PDF without re-encoding (the JPXDecode/DCTDecode bytes
  are embedded as-is), at the recorded dpi, saved with deterministic_id.
- musescore: copies the named MusicXML from the *installed* music21
  package (never committed; see corpus.json's licence note) and renders
  it with MuseScore: the re-export MusicXML (MuseScore's own layout) and
  a PDF.
- synthetic: builds the score with synth.py and renders it the same way.

Run offline-unfriendly; not run in CI. `uv run python corpus/fetch.py
[piece-id ...]` (default: every piece)."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
FILES = HERE / "files"
SRC = HERE.parent / "src"
sys.path.insert(0, str(SRC))
sys.path.insert(0, str(HERE))

import synth  # noqa: E402

MSCORE = os.environ.get("MSCORE", "/Applications/MuseScore 4.app/Contents/MacOS/mscore")
USER_AGENT = "fingerings-corpus/1.0 (public-domain sheet music research tool)"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                dest.write_bytes(resp.read())
            return
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + attempt * 2)
    raise RuntimeError(f"{url}: failed after retries: {last}")


def _verify(path, want_sha256, what):
    got = sha256(path)
    if got != want_sha256:
        raise RuntimeError(f"{what}: sha256 mismatch: got {got}, want {want_sha256} ({path})")


def fetch_scan_pdf(piece):
    scan = piece["scan"]
    jp2_path = FILES / f"{piece['id']}.jp2"
    if not jp2_path.exists():
        print(f"  downloading {scan['url']}")
        _download(scan["url"], jp2_path)
    _verify(jp2_path, scan["sha256"], f"{piece['id']} scan")

    import pikepdf
    from pikepdf import Name
    from PIL import Image

    pdf_path = FILES / f"{piece['id']}.pdf"
    data = jp2_path.read_bytes()
    im = Image.open(jp2_path)
    w, h = im.size
    dpi = scan["dpi"]
    page_w, page_h = w / dpi * 72.0, h / dpi * 72.0
    filt = Name.DCTDecode if im.format == "JPEG" else Name.JPXDecode
    colorspace = Name.DeviceGray if im.mode == "L" else Name.DeviceRGB

    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=(page_w, page_h))
    xobj = pdf.make_stream(data, pikepdf.Dictionary(
        Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=colorspace, Filter=filt))
    resources = pikepdf.Dictionary()
    xobjects = pikepdf.Dictionary()
    xobjects["/Im0"] = xobj
    resources.XObject = xobjects
    page.obj.Resources = resources
    stream_bytes = f"q {page_w} 0 0 {page_h} 0 0 cm /Im0 Do Q\n".encode("ascii")
    page.obj.Contents = pdf.make_stream(stream_bytes)
    pdf.save(pdf_path, deterministic_id=True)
    pdf.close()
    print(f"  wrote {pdf_path.name} ({sha256(pdf_path)[:12]})")

    xml_dest = copy_music21_musicxml(piece, FILES / f"{piece['id']}.mxl")
    print(f"  copied {xml_dest.name} (local only, never committed)")
    return pdf_path, xml_dest


def copy_music21_musicxml(piece, dest=None):
    from music21 import corpus as m21corpus
    xml = piece["musicxml"]
    src_path = Path(m21corpus.getWork(xml["corpus_path"]))
    if not src_path.exists():
        raise RuntimeError(f"music21 corpus file not found: {xml['corpus_path']} (resolved {src_path})")
    _verify(src_path, xml["sha256"], f"{piece['id']} music21 corpus source")
    dest = dest or (FILES / f"{piece['id']}.src.mxl")
    shutil.copy(src_path, dest)
    return dest


def run_mscore(out_path, *args):
    # MuseScore 4.7.2 exits 134 (its crashpad machinery aborts with a
    # mutex error, launched from a piped-stdout parent) *after* writing
    # its output; check the output exists, not the return code. A lone
    # crash before writing anything is worth one retry.
    out_path = Path(out_path)
    last = None
    for attempt in range(6):
        out_path.unlink(missing_ok=True)
        p = subprocess.run([MSCORE, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if out_path.exists():
            return
        last = p.returncode
        time.sleep(1 + attempt)
    raise RuntimeError(f"mscore {args} produced no {out_path.name} (rc={last}) six times in a row")


def render_with_mscore(src_musicxml, out_id):
    """-> (musicxml re-export path, pdf path). One mscore invocation per
    piece (batch -j jobs don't reliably propagate a distinct export
    format per job across mscore 4.7.2's CLI); each piece is small."""
    xml_out = FILES / f"{out_id}.musicxml"
    pdf_out = FILES / f"{out_id}.pdf"
    run_mscore(xml_out, "-o", str(xml_out), str(src_musicxml))
    run_mscore(pdf_out, "-o", str(pdf_out), str(src_musicxml))
    return xml_out, pdf_out


def fetch_musescore_piece(piece):
    src = copy_music21_musicxml(piece)
    xml_out, pdf_out = render_with_mscore(src, piece["id"])
    print(f"  rendered {xml_out.name}, {pdf_out.name} (re-export sha {sha256(xml_out)[:12]}, info only)")


def fetch_synthetic_piece(piece):
    fn_name = piece["source_url"].split(":")[-1]
    src = FILES / f"{piece['id']}.src.musicxml"
    synth.build(fn_name).write("musicxml", fp=str(src))
    xml_out, pdf_out = render_with_mscore(src, piece["id"])
    print(f"  rendered {xml_out.name}, {pdf_out.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("piece_ids", nargs="*", help="only fetch these piece ids (default: all)")
    args = ap.parse_args()

    FILES.mkdir(exist_ok=True)
    corpus = json.loads((HERE / "corpus.json").read_text())
    pieces = corpus["pieces"]
    if args.piece_ids:
        wanted = set(args.piece_ids)
        pieces = [p for p in pieces if p["id"] in wanted]

    for piece in pieces:
        print(f"{piece['id']} ({piece['source']})")
        if piece["source"] == "scan":
            fetch_scan_pdf(piece)
        elif piece["source"] == "musescore":
            fetch_musescore_piece(piece)
        elif piece["source"] == "synthetic":
            fetch_synthetic_piece(piece)
        else:
            raise ValueError(f"{piece['id']}: unknown source {piece['source']!r}")


if __name__ == "__main__":
    main()
