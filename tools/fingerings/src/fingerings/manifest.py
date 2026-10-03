"""The run's manifest: one piece, one PDF, one MusicXML, with run-only
settings. Paths are relative to the run directory, so a batch folder can be
moved. Validated strictly: unknown keys, a missing file, or `pages` beyond
the PDF are errors."""
import json
from pathlib import Path

import pikepdf

ALLOWED_KEYS = {"piece", "pdf", "musicxml", "pages", "read_pages", "measures",
                "join_pt", "render_scale", "min_head_match", "xsd"}
REQUIRED_KEYS = {"piece", "pdf", "musicxml", "pages"}
DEFAULTS = dict(read_pages=None, measures=None, join_pt=1.0, render_scale=6,
                min_head_match=0.9, xsd=None)


class ManifestError(ValueError):
    pass


def load(run_dir):
    run_dir = Path(run_dir)
    path = run_dir / "manifest.json"
    if not path.exists():
        raise ManifestError(f"{path}: no manifest.json")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise ManifestError(f"{path}: invalid JSON: {e}") from e
    return validate(data, run_dir)


def validate(data, run_dir):
    run_dir = Path(run_dir)
    if not isinstance(data, dict):
        raise ManifestError("the manifest must be a JSON object")
    unknown = sorted(set(data) - ALLOWED_KEYS)
    if unknown:
        raise ManifestError(f"unknown manifest key(s): {unknown}")
    missing = sorted(REQUIRED_KEYS - set(data))
    if missing:
        raise ManifestError(f"missing manifest key(s): {missing}")
    if not isinstance(data["piece"], str) or not data["piece"]:
        raise ManifestError("piece must be a non-empty string")

    pages = data["pages"]
    if not (isinstance(pages, list) and len(pages) == 2 and all(isinstance(p, int) and not isinstance(p, bool) for p in pages)
            and pages[0] >= 1 and pages[1] >= pages[0]):
        raise ManifestError("pages must be [first, last], 1-indexed integers with first <= last")

    man = dict(DEFAULTS)
    man.update(data)
    man["pages"] = (pages[0], pages[1])

    if man["read_pages"] is not None:
        rp = man["read_pages"]
        if not (isinstance(rp, list) and rp and all(isinstance(p, int) and not isinstance(p, bool) for p in rp)):
            raise ManifestError("read_pages must be a non-empty list of page numbers")
        bad = [p for p in rp if not (pages[0] <= p <= pages[1])]
        if bad:
            raise ManifestError(f"read_pages outside pages {list(pages)}: {bad}")
        man["read_pages"] = sorted(set(rp))

    if man["measures"] is not None:
        m = man["measures"]
        if not (isinstance(m, list) and len(m) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in m)
                and m[0] <= m[1]):
            raise ManifestError("measures must be [from, to], an app bar number range")
        man["measures"] = (m[0], m[1])

    if isinstance(man["join_pt"], bool) or not isinstance(man["join_pt"], (int, float)) or man["join_pt"] <= 0:
        raise ManifestError("join_pt must be a positive number")
    if isinstance(man["render_scale"], bool) or not isinstance(man["render_scale"], (int, float)) or man["render_scale"] <= 0:
        raise ManifestError("render_scale must be a positive number")
    mhm = man["min_head_match"]
    if isinstance(mhm, bool) or not isinstance(mhm, (int, float)) or not (0 <= mhm <= 1):
        raise ManifestError("min_head_match must be a number between 0 and 1")

    pdf_path = (run_dir / data["pdf"]).resolve()
    xml_path = (run_dir / data["musicxml"]).resolve()
    if not pdf_path.is_file():
        raise ManifestError(f"pdf not found: {data['pdf']}")
    if not xml_path.is_file():
        raise ManifestError(f"musicxml not found: {data['musicxml']}")
    man["pdf_path"] = pdf_path
    man["musicxml_path"] = xml_path

    with pikepdf.open(pdf_path) as pdf:
        n = len(pdf.pages)
    if pages[1] > n:
        raise ManifestError(f"pages {list(pages)} go past the PDF's {n} page(s)")

    if man["xsd"] is not None:
        xsd_path = (run_dir / man["xsd"]).resolve()
        if not xsd_path.is_file():
            raise ManifestError(f"xsd not found: {man['xsd']}")
        man["xsd_path"] = xsd_path
    else:
        man["xsd_path"] = None

    return man
