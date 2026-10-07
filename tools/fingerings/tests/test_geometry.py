"""Integration tests for stages 3-4 (geometry.py) against small, committed
fixtures -- unlike corpus/ (dev-only, gitignored, never run in CI), these
run in CI and so are what actually guards the geometry pipeline against a
regression. tests/fixture/geometry/ holds the committed inputs:
make_geometry_fixtures.py documents (and can regenerate) how each PNG was
cropped from a corpus scan."""
import json
from pathlib import Path

from PIL import Image

from fingerings import geometry

FIXTURE_DIR = Path(__file__).parent / "fixture" / "geometry"


def _run_dir_from_png(tmp_path, png_name, musicxml_name, measures):
    """A run directory built from a committed PNG crop (wrapped in a
    single-page PDF, the only container geometry.run_geometry reads) and
    its matching hand-encoded MusicXML. `measures` is the manifest's app
    bar number range (the fixture's own measure numbers, both ends
    inclusive)."""
    run_dir = tmp_path
    (run_dir / "inputs").mkdir(parents=True, exist_ok=True)
    pdf_path = run_dir / "inputs" / "page.pdf"
    Image.open(FIXTURE_DIR / png_name).convert("L").save(pdf_path, "PDF", resolution=72.0)
    xml_path = run_dir / "inputs" / musicxml_name
    xml_path.write_bytes((FIXTURE_DIR / musicxml_name).read_bytes())
    manifest = dict(piece="geometry-fixture", pdf="inputs/page.pdf", musicxml=f"inputs/{musicxml_name}",
                     pages=[1, 1], measures=list(measures), render_scale=1)
    (run_dir / "manifest.json").write_text(json.dumps(manifest))
    return run_dir


def test_loc_trio_seconds_chord(tmp_path):
    """A real Library of Congress scan crop (public domain; see the
    MusicXML's own header comment for provenance and how its pitches were
    verified): one measure whose left hand is the four-note chord
    heads.py's wide-cluster split exists for -- two notes a second apart
    on top, two more a second apart underneath -- engraved on a staff
    whose opening bar line and whose stem-vs-bar-line ambiguities are
    exercised elsewhere in this corpus/session, so this fixture's job is
    narrower: confirm notehead geometry on an unmodified real scan crop,
    noise and all, not a synthetic raster, reaches the same 90% head-match
    gate run_geometry enforces on a full page."""
    run_dir = _run_dir_from_png(tmp_path, "loc_maple_leaf_p3_trio_seconds_chord.png",
                                 "loc_maple_leaf_p3_trio_seconds_chord.musicxml", measures=(1, 1))
    report, code = geometry.run_geometry(run_dir)
    assert code == 0, report["checks"]
    assert report["ok"]
    rate_check = next(c for c in report["checks"] if c["check"].startswith("p1:"))
    assert rate_check["ok"], rate_check["detail"]
