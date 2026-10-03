#!/usr/bin/env python3
"""Runs `fingerings geometry` on every corpus piece (or a named subset),
grades each page's detected systems against truth (the scan's hand-counted
`systems`, or a MuseScore re-export's own `<print new-system/new-page>`
breaks), and writes a results JSON plus a Markdown table for the PR body.

Dev only; never run in CI. `uv run python corpus/run_corpus.py [--label
NAME] [--overlays] [piece-id ...]` and `uv run python corpus/run_corpus.py
--compare BEFORE AFTER`."""
import argparse
import json
import sys
from pathlib import Path

from lxml import etree

HERE = Path(__file__).parent
FILES = HERE / "files"
RUNS = FILES / "runs"
RESULTS = FILES / "results"
SRC = HERE.parent / "src"
sys.path.insert(0, str(SRC))

from fingerings import geometry  # noqa: E402


def layout_breaks_from_musicxml(path):
    """[[bars per system, ...], ...] per page, from the first part's
    <print new-system/new-page> markers in document order."""
    text = Path(path).read_text(encoding="utf-8")
    root = etree.fromstring(text.encode("utf-8"))
    part = root.find("part")
    measures = part.findall("measure")
    pages = [[]]
    current = 0
    started = False
    for m in measures:
        print_el = m.find("print")
        new_page = print_el is not None and print_el.get("new-page") == "yes"
        new_system = print_el is not None and print_el.get("new-system") == "yes"
        if not started:
            started = True
        elif new_page:
            pages[-1].append(current)
            pages.append([])
            current = 0
        elif new_system:
            pages[-1].append(current)
            current = 0
        current += 1
    pages[-1].append(current)
    return pages


def pdf_page_count(path):
    import pikepdf
    with pikepdf.open(path) as pdf:
        return len(pdf.pages)


def build_run_dir(piece, label):
    run_dir = RUNS / label / piece["id"]
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "inputs").mkdir(exist_ok=True)

    if piece["source"] == "scan":
        pdf_src = FILES / f"{piece['id']}.pdf"
        xml_src = FILES / f"{piece['id']}.mxl"
        pages = [1, 1]
        measures = piece.get("measures")
        truth = {1: piece["systems"][0]}
    else:
        pdf_src = FILES / f"{piece['id']}.pdf"
        xml_src = FILES / f"{piece['id']}.musicxml"
        n = pdf_page_count(pdf_src)
        pages = [1, n]
        measures = None
        breaks = layout_breaks_from_musicxml(xml_src)
        truth = {i + 1: breaks[i] if i < len(breaks) else [] for i in range(n)}

    import shutil
    pdf_dest = run_dir / "inputs" / pdf_src.name
    xml_dest = run_dir / "inputs" / xml_src.name
    shutil.copy(pdf_src, pdf_dest)
    shutil.copy(xml_src, xml_dest)

    man = dict(piece=piece["id"], pdf=f"inputs/{pdf_src.name}", musicxml=f"inputs/{xml_src.name}", pages=pages)
    if measures:
        man["measures"] = measures
    (run_dir / "manifest.json").write_text(json.dumps(man, indent=1))
    return run_dir, truth


def grade(geom_report, truth):
    """[{page, system, found, printed, ok}] comparing each page's
    detected per-system bar counts against truth."""
    out = []
    for p in geom_report["pages"]:
        pno = p["page"]
        want = truth.get(pno, [])
        got = [s["bars"] - 1 for s in p.get("systems", [])] if p.get("systems") else []
        for i in range(max(len(got), len(want))):
            g = got[i] if i < len(got) else None
            w = want[i] if i < len(want) else None
            out.append(dict(page=pno, system=i, found=g, printed=w, ok=(g == w)))
    return out


def run_piece(piece, label, overlays=False):
    run_dir, truth = build_run_dir(piece, label)
    report, code = geometry.run_geometry(run_dir, overlays=overlays)
    grading = grade(report, truth)
    bar_gate = next(c for c in report["checks"] if c["check"].startswith("bar lines"))
    rows = []
    for p in report["pages"]:
        pno = p["page"]
        page_grading = [g for g in grading if g["page"] == pno]
        systems_desc = "; ".join(f"s{g['system'] + 1} {g['found']}/{g['printed']}"
                                  + ("" if g["ok"] else " WRONG") for g in page_grading)
        rows.append(dict(
            piece=piece["id"], page=pno, categories=piece["categories"],
            stop=p.get("stop"), bars=p.get("bars"), systems=systems_desc,
            systems_ok=all(g["ok"] for g in page_grading) if page_grading else (not p.get("stop")),
            heads_matched=p.get("heads_matched"), rate=p.get("rate"),
            bar_gate_ok=bar_gate["ok"],
        ))
    return dict(piece=piece["id"], label=label, ok=report["ok"], checks=report["checks"], rows=rows)


def render_markdown(results):
    lines = ["| Piece | Page | Categories | Systems found/printed | Head match | Gate | Note |",
             "|---|---|---|---|---|---|---|"]
    for r in results:
        for row in r["rows"]:
            gate = "PASS" if (row["bar_gate_ok"] and row["systems_ok"] and
                               (row["rate"] is None or row["rate"] >= 0.9) and not row["stop"]) else "FAIL"
            note = row["stop"] or ""
            hm = f"{row['heads_matched']} ({row['rate']:.1%})" if row.get("rate") is not None else ""
            lines.append(f"| {row['piece']} | {row['page']} | {', '.join(row['categories'])} | "
                          f"{row['systems']} | {hm} | {gate} | {note} |")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("piece_ids", nargs="*")
    ap.add_argument("--label", default="after")
    ap.add_argument("--overlays", action="store_true")
    ap.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"))
    args = ap.parse_args()

    RESULTS.mkdir(parents=True, exist_ok=True)

    if args.compare:
        before, after = args.compare
        b = json.loads((RESULTS / f"{before}.json").read_text())
        a = json.loads((RESULTS / f"{after}.json").read_text())
        b_by = {r["piece"]: r for r in b}
        lines = ["| Piece | Page | Categories | Before | After |", "|---|---|---|---|---|"]
        for r in a:
            br = b_by.get(r["piece"])
            for i, row in enumerate(r["rows"]):
                before_row = br["rows"][i] if br and i < len(br["rows"]) else None
                before_desc = (f"{before_row['systems']} {before_row.get('heads_matched', '')}"
                                if before_row else "(not run)")
                after_desc = f"{row['systems']} {row.get('heads_matched', '')}"
                lines.append(f"| {row['piece']} | {row['page']} | {', '.join(row['categories'])} | "
                              f"{before_desc} | {after_desc} |")
        print("\n".join(lines))
        return

    corpus = json.loads((HERE / "corpus.json").read_text())
    pieces = corpus["pieces"]
    if args.piece_ids:
        wanted = set(args.piece_ids)
        pieces = [p for p in pieces if p["id"] in wanted]

    results = []
    for piece in pieces:
        print(f"=== {piece['id']} ===")
        try:
            r = run_piece(piece, args.label, overlays=args.overlays)
        except Exception as e:  # noqa: BLE001
            print(f"  CRASHED: {e!r}")
            results.append(dict(piece=piece["id"], label=args.label, ok=False,
                                 checks=[], rows=[dict(piece=piece["id"], page=None, categories=piece["categories"],
                                                        stop=f"crashed: {e!r}", bars=None, systems="", systems_ok=False,
                                                        heads_matched=None, rate=None, bar_gate_ok=False)]))
            continue
        results.append(r)
        for row in r["rows"]:
            print(f"  p{row['page']}: systems={row['systems']} heads={row.get('heads_matched')} "
                  f"rate={row.get('rate')} stop={row.get('stop')}")

    (RESULTS / f"{args.label}.json").write_text(json.dumps(results, indent=1, default=str))
    (RESULTS / f"{args.label}.md").write_text(render_markdown(results))
    print(f"\nwrote {RESULTS / f'{args.label}.json'}, {RESULTS / f'{args.label}.md'}")


if __name__ == "__main__":
    main()
