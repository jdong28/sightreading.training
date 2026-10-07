"""Steps 3-4 of one page: staves/systems, heads (needed before bar lines),
bar lines, staff mapping (a system showing fewer staves than the score),
measure alignment and the head-match gate. `run.py` and the `geometry`
subcommand both build on this, so a piece's geometry is detected exactly
once either way."""
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pikepdf

from . import align, extract, heads as heads_mod, manifest, prep, score, scoreio, staves


def analyze_page(gray, scan_kind="image-1bit"):
    """Preprocessing (image-sourced pages only; a born-digital render gets
    none of it) then steps 3-4 for one page. Returns (page geometry dict,
    placed heads, detected staff space in px, prep metadata: dict(
    scan_kind, threshold, skew_deg, stop)). `stop` is set, and heads is
    [], when the page is out of reach (today: its resolution is below the
    floor)."""
    meta = dict(scan_kind=scan_kind, threshold=128, skew_deg=0.0, stop=None)
    if scan_kind == "render":
        black = gray < 128
    else:
        threshold = prep.grey_threshold(gray) if scan_kind == "image-gray" else 128
        meta["threshold"] = threshold
        black = prep.clear_border(gray < threshold)
        angle = prep.estimate_skew(black)
        meta["skew_deg"] = angle
        if abs(angle) >= 0.05:
            gray, _ = prep.deskew(gray, np.zeros_like(gray, dtype=np.uint8), angle)
            black = prep.clear_border(gray < threshold)

    G = staves.from_black(black)
    if G["systems"]:
        space_est = float(np.median([st["space"] for s in G["systems"] for st in s["staves"]]))
    else:
        space_est = prep.estimate_space_from_runs(black)
    if scan_kind != "render":
        reason = prep.resolution_floor_reason(space_est)
        if reason:
            meta["stop"] = reason
            return G, [], (space_est or 0.0), meta
        if scan_kind == "image-gray" and space_est:
            black = prep.pinhole_fill(black, space_est)
            G["black"] = black

    raw_heads, space = heads_mod.noteheads(G["black"], G["systems"])
    placed = heads_mod.place(raw_heads, G["systems"], black=G["black"])
    staves.assign_bars(G["black"], G["systems"], placed)
    return G, placed, space, meta


def resolve_staff_mapping(system_index, k, score_staff_count, heads_in_system, measures_for_system, by):
    """{local staff (1-indexed): global staff} for one system, or
    (None, reason) when it shows more staves than the score, or an exact
    tie leaves no way to tell which of the score's staves it shows."""
    candidates = align.staff_mapping_candidates(k, score_staff_count)
    if not candidates:
        return None, f"system {system_index}: {k} staves detected, the score has {score_staff_count}"
    if len(candidates) == 1:
        return candidates[0], None
    scored = []
    for cand in candidates:
        remapped = [{**h, "staff": cand[h["staff"]]} for h in heads_in_system]
        n_match = sum(1 for h in remapped
                      if align.head_match(h, h["page"], measures_for_system, by, remapped)[0] is not None)
        scored.append((n_match, cand))
    scored.sort(key=lambda t: -t[0])
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None, f"system {system_index}: can't tell which of the score's staves it shows"
    return scored[0][1], None


def apply_staff_mapping(pno, G, heads, measures_geo, by, score_staff_count):
    """Relabels every head's `staff` from system-local to the score's
    global numbering, system by system. Returns (heads, stop_reason);
    heads is [] and stop_reason is set when a system can't be mapped."""
    out = []
    for si, sys_ in enumerate(G["systems"]):
        k = len(sys_["staves"])
        in_system = [h for h in heads if h["system"] == si]
        measures_for_system = [m for m in measures_geo if m["page"] == pno and m["system"] == si]
        mapping, reason = resolve_staff_mapping(si, k, score_staff_count, in_system, measures_for_system, by)
        if mapping is None:
            return [], reason
        out += [{**h, "staff": mapping[h["staff"]]} for h in in_system]
    return out, None


def match_page(pno, heads, measures_geo, by, numbers, min_head_match=0.9):
    """Matches a page's heads to MusicXML notes (staff already global).
    Drops small (grace-size) heads that matched no grace note, so a stray
    small blob never reaches attribution. Returns a dict: heads (filtered),
    shifts, matched_ids (unison-aware, for the rate), n_matched, n_total,
    rate, clef_shifts, per_system (per_system_floor's output), checks
    ([{check, ok, detail}, ...] -- the page rate check plus any
    per-system-floor failures)."""
    shifts = align.print_shifts(heads, measures_geo, by)
    pairs = [(h, align.head_match(h, pno, measures_geo, by, heads, shifts)[0]) for h in heads]
    heads = [h for h, note in pairs if not h.get("small") or note is not None]
    matched = {id(note["el"]) for _h, note in pairs if note is not None}

    xml_notes = []
    by_system = defaultdict(list)
    for m in measures_geo:
        if m["page"] != pno:
            continue
        for st in sorted({h["staff"] for h in heads} | {s for (_mi, s) in by if _mi == m["mindex"]}):
            for n in by.get((m["mindex"], st), []):
                row = {**n, "_system": m["system"]}
                xml_notes.append(row)
                by_system[m["system"]].append(row)

    matched_rate_ids = align.unison_matched_ids(xml_notes, matched)
    n_matched = sum(1 for n in xml_notes if id(n["el"]) in matched_rate_ids)
    n_total = len(xml_notes)
    rate = (n_matched / n_total) if n_total else 1.0
    clef_shifts = sorted({(numbers[k[3]], k[2], v) for k, v in shifts.items() if k[0] == pno and v})

    checks = [dict(check=f"p{pno}: noteheads matched a MusicXML note", ok=rate >= min_head_match,
                   detail=f"{n_matched}/{n_total} ({rate:.0%}, need {min_head_match:.0%})")]
    for si, bar_range, sys_matched, sys_total in align.per_system_floor(by_system, matched, numbers):
        checks.append(dict(
            check=f"p{pno} system {si} (bars {bar_range[0]}-{bar_range[1]}): noteheads matched",
            ok=False, detail=f"{sys_matched}/{sys_total} noteheads matched: bars misaligned"))

    head_matches = [(h, note is not None) for h, note in pairs if not h.get("small") or note is not None]

    return dict(heads=heads, shifts=shifts, matched_ids=matched_rate_ids, n_matched=n_matched, n_total=n_total,
                rate=rate, clef_shifts=clef_shifts, checks=checks, head_matches=head_matches)


def _read_score_text(man):
    if scoreio.is_mxl(man["musicxml_path"]):
        _root_name, text = scoreio.read_mxl_text(man["musicxml_path"])
        return text
    return scoreio.read_text(man["musicxml_path"])


def _render_geometry_md(report):
    lines = [f"# {report['piece']}: geometry", "", "## Checks"]
    for c in report["checks"]:
        lines.append(f"{'PASS' if c['ok'] else 'FAIL'} {c['check']} - {c['detail']}")
    lines.append("")
    lines.append("## Pages")
    lines.append("| Page | Scan | Skew | Bars | Space | Heads matched | Rate |")
    lines.append("|---|---|---|---|---|---|---|")
    for p in report["pages"]:
        if p.get("stop"):
            lines.append(f"| {p['page']} | {p.get('scan_kind', '')} | | | | | STOP: {p['stop']} |")
            continue
        bars = "-".join(str(b) for b in p["bars"]) if p.get("bars") else ""
        lines.append(f"| {p['page']} | {p.get('scan_kind', '')} | {p.get('skew_deg', 0):.2f} | {bars} | "
                      f"{p.get('staff_space', 0):.1f} | {p.get('heads_matched', '')} | {p.get('rate', 0):.1%} |")
    lines.append("")
    return "\n".join(lines) + "\n"


_OVERLAY_COLORS = dict(line=(190, 190, 255), bar=(0, 110, 255), matched=(0, 160, 0), unmatched=(220, 0, 0))


def _write_overlay(path, gray, G, head_matches):
    """Draws staff lines, system boxes, bar lines, and heads (matched
    green, unmatched red) onto the page's scan, for diagnosis."""
    from PIL import Image, ImageDraw
    rgb = np.stack([gray] * 3, axis=-1).astype(np.uint8)
    img = Image.fromarray(rgb).convert("RGB")
    d = ImageDraw.Draw(img)
    w = img.width
    for sys_ in G["systems"]:
        for st in sys_["staves"]:
            for y in st["lines"]:
                d.line([(0, y), (w, y)], fill=_OVERLAY_COLORS["line"], width=1)
        d.rectangle([0, sys_["top"], w - 1, sys_["bottom"]], outline=_OVERLAY_COLORS["line"], width=1)
        for b in sys_.get("bars", []):
            d.line([(b["x"], sys_["top"] - 10), (b["x"], sys_["bottom"] + 10)], fill=_OVERLAY_COLORS["bar"], width=2)
    for h, matched in head_matches:
        r = h.get("w", 10) / 2
        color = _OVERLAY_COLORS["matched"] if matched else _OVERLAY_COLORS["unmatched"]
        d.ellipse([h["x"] - r, h["y"] - r, h["x"] + r, h["y"] + r], outline=color, width=2)
    img.save(path)


def run_geometry(run_dir, overlays=False):
    """`fingerings geometry <run dir>`: steps 1-4 on every page, ink or
    not, with the head-match gate applied to every page (no fingerings
    needed: the head-match rate checks itself). Writes geometry.json/
    geometry.md (and geometry/pN.png overlays, with `--overlays`) into
    the run directory. Returns (report dict, exit code): 0 when every
    gate passes, 1 otherwise."""
    run_path = Path(run_dir)
    man = manifest.load(run_path)
    text = _read_score_text(man)
    root = score.load_text(text)
    rows = score.note_table(root)
    by = align.xml_by_measure(rows)
    measure_els = score.measures(root)
    numbers = score.app_numbers(measure_els)
    multirest = score.multirest_spans(measure_els)
    part_counts = score.part_staff_counts(root)
    score_staff_count = sum(c for _p, c in part_counts)

    first_page, last_page = man["pages"]
    report = dict(piece=man["piece"], pages=[], checks=[])

    if man["measures"]:
        want_from, want_to = man["measures"]
        first_index = next((i for i, n in enumerate(numbers) if n == want_from), None)
        if first_index is None:
            report["checks"].append(dict(check="bar lines: the pages' measures add up to the MusicXML's",
                                          ok=False, detail=f"bar {want_from} (manifest measures) not found"))
            report["ok"] = False
            (run_path / "geometry.json").write_text(json.dumps(report, indent=1, default=str) + "\n")
            (run_path / "geometry.md").write_text(_render_geometry_md(report))
            return report, 1
        nmeas = sum(1 for n in numbers if want_from <= n <= want_to)
    else:
        first_index = 0
        nmeas = len(measure_els)

    with pikepdf.open(man["pdf_path"]) as pdf:
        geoms, page_data = [], {}
        for pno in range(first_page, last_page + 1):
            L = extract.page_layers(pdf, pno - 1, render_scale=man["render_scale"])
            G, hs, space, prep_meta = analyze_page(L["scan"]["gray"], scan_kind=L["scan"]["kind"])
            for h in hs:
                h["page"] = pno
            geoms.append((pno, G))
            page_data[pno] = dict(L=L, hs=hs, space=space, prep_meta=prep_meta)

        measures_geo, total = align.page_measures(geoms, first_index=first_index, multirest=multirest)
        covered = total - first_index
        gate = covered == nmeas
        n_spans = sum(1 for idx in multirest if first_index <= idx < first_index + nmeas)
        if n_spans:
            expected_printed = align.expected_printed_count(nmeas, multirest, first_index)
            detail = (f"{len(measures_geo)} on pages {first_page}-{last_page}, {expected_printed} printed "
                      f"({nmeas} measures, {n_spans} multi-bar rests)")
        else:
            detail = f"{covered} on pages {first_page}-{last_page}, {nmeas} in the MusicXML"
        report["checks"].append(dict(check="bar lines: the pages' measures add up to the MusicXML's",
                                      ok=gate, detail=detail))
        # a page can still be worth diagnosing when the overall bar count
        # is wrong (geometry runs on every page regardless), but an
        # over-detected system's mindex can run past the piece's own
        # measure count; drop those before matching so a wrong count
        # fails the gate cleanly instead of crashing
        measures_geo = [m for m in measures_geo if m["mindex"] < len(numbers)]

        if overlays:
            (run_path / "geometry").mkdir(exist_ok=True)

        for pno, G in geoms:
            data = page_data[pno]
            prep_meta = data["prep_meta"]
            page_stat = dict(page=pno, scan_kind=prep_meta["scan_kind"], threshold=prep_meta["threshold"],
                              skew_deg=prep_meta["skew_deg"],
                              size=[int(data["L"]["scan"]["w"]), int(data["L"]["scan"]["h"])])
            if prep_meta["stop"]:
                page_stat["stop"] = prep_meta["stop"]
                report["checks"].append(dict(check=f"p{pno}: scan geometry", ok=False,
                                              detail=f"p{pno}: {prep_meta['stop']}"))
                report["pages"].append(page_stat)
                continue

            hs = data["hs"]
            hs, stop_reason = apply_staff_mapping(pno, G, hs, measures_geo, by, score_staff_count)
            if stop_reason:
                page_stat["stop"] = stop_reason
                report["checks"].append(dict(check=f"p{pno}: staff mapping", ok=False, detail=stop_reason))
                report["pages"].append(page_stat)
                continue

            result = match_page(pno, hs, measures_geo, by, numbers, man["min_head_match"])
            page_mindices = [m["mindex"] for m in measures_geo if m["page"] == pno]
            page_stat["bars"] = [numbers[page_mindices[0]], numbers[page_mindices[-1]]] if page_mindices else None
            page_stat["staff_space"] = round(data["space"], 1)
            page_stat["systems"] = [dict(staves=len(sys_["staves"]), bars=len(sys_.get("bars", [])))
                                     for sys_ in G["systems"]]
            page_stat["heads_found"] = len(result["heads"])
            page_stat["heads_matched"] = f"{result['n_matched']}/{result['n_total']}"
            page_stat["rate"] = round(result["rate"], 4)
            page_stat["clef_shifts"] = result["clef_shifts"]
            report["pages"].append(page_stat)
            report["checks"] += result["checks"]

            if overlays:
                _write_overlay(run_path / "geometry" / f"p{pno}.png", data["L"]["scan"]["gray"], G,
                                result["head_matches"])

    report["ok"] = all(c["ok"] for c in report["checks"])
    (run_path / "geometry.json").write_text(json.dumps(report, indent=1, default=str) + "\n")
    (run_path / "geometry.md").write_text(_render_geometry_md(report))
    for c in report["checks"]:
        print("PASS" if c["ok"] else "FAIL", c["check"], "-", c["detail"])
    return report, (0 if report["ok"] else 1)
