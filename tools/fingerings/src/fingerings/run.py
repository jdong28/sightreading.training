"""Orchestration: one piece, end to end (`fingerings run <run dir>`).

Stages write into the run directory; the reading step is a file the vision
pass fills in (readings/pN.json, one entry per mark id). Missing readings
stop the run after the contact sheets are made (exit 2), so a run is
resumable: make sheets, read them, run again. A gate or check failure
(exit 1) writes report.json/report.md but no out.*/layer.json, and any
stale out.*/layer.json an earlier, successful run left is deleted, so a run
directory never shows an output its latest report doesn't vouch for."""
import hashlib
import json
import time
from pathlib import Path

import pikepdf

from . import __version__, align, cluster, extract, heads, insert, layer, manifest, proof, readings, score, scoreio, sheet, staves, verify

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_NEEDS_READING = 2


def sha1(path):
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()


def _check(name, ok, detail):
    return dict(check=name, ok=bool(ok), detail=detail)


def _clean_stale(run):
    for name in ("out.musicxml", "out.mxl", "layer.json"):
        p = run / name
        if p.exists():
            p.unlink()


def _read_score_text(man):
    if scoreio.is_mxl(man["musicxml_path"]):
        root_name, text = scoreio.read_mxl_text(man["musicxml_path"])
        return text, root_name
    return scoreio.read_text(man["musicxml_path"]), None


def _write_score_text(man, text, root_name, out_path):
    if root_name is not None:
        scoreio.write_mxl(man["musicxml_path"], out_path, root_name, text)
    else:
        scoreio.write_text(out_path, text)


def _out_path(run, man):
    suffix = ".mxl" if scoreio.is_mxl(man["musicxml_path"]) else ".musicxml"
    return run / f"out{suffix}"


def run(run_dir):
    """Returns (report dict, exit code)."""
    run_path = Path(run_dir)
    man = manifest.load(run_path)
    t0 = time.perf_counter()
    _clean_stale(run_path)

    text, root_name = _read_score_text(man)
    root = score.load_text(text)
    rows = score.note_table(root)
    by = align.xml_by_measure(rows)
    measure_els = score.measures(root)
    numbers = score.app_numbers(measure_els)

    first_page, last_page = man["pages"]
    report = dict(
        piece=man["piece"],
        inputs=dict(pdf=dict(path=man["pdf"], sha1=sha1(man["pdf_path"])),
                    musicxml=dict(path=man["musicxml"], sha1=sha1(man["musicxml_path"]))),
        pages=[], placements=[], skipped=[], other=[], checks=[],
    )

    with pikepdf.open(man["pdf_path"]) as pdf:
        geoms, layers = [], {}
        for pno in range(first_page, last_page + 1):
            L = extract.page_layers(pdf, pno - 1, render_scale=man["render_scale"])
            layers[pno] = L
            geoms.append((pno, staves.page_geometry(L["scan"]["gray"])))

        if man["measures"]:
            want_from, want_to = man["measures"]
            first_index = next((i for i, n in enumerate(numbers) if n == want_from), None)
            if first_index is None:
                return _finish(run_path, report, t0,
                                extra_check=_check("bar lines: the pages' measures add up to the MusicXML's",
                                                    False, f"bar {want_from} (manifest measures) not found"))
            nmeas = sum(1 for n in numbers if want_from <= n <= want_to)
        else:
            first_index = 0
            nmeas = len(measure_els)

        measures_geo, total = align.page_measures(geoms, first_index=first_index)
        gate = total == nmeas
        report["checks"].append(_check(
            "bar lines: the pages' measures add up to the MusicXML's", gate,
            f"{total} on pages {first_page}-{last_page}, {nmeas} in the MusicXML"))
        if not gate:
            return _finish(run_path, report, t0)

        read_pages = man["read_pages"]
        ink_pages = []
        edits = []
        missing_readings = []
        (run_path / "sheets").mkdir(exist_ok=True)
        (run_path / "readings").mkdir(exist_ok=True)

        for pno, G in geoms:
            L = layers[pno]
            mask = extract.ink_mask(L["ink"])
            ink_px = int(mask.sum())
            page_mindices = [m["mindex"] for m in measures_geo if m["page"] == pno]
            page_stat = dict(page=pno, ink_sources=L["ink_sources"], ink_px=ink_px)
            if page_mindices:
                page_stat["bars"] = [numbers[page_mindices[0]], numbers[page_mindices[-1]]]
            else:
                page_stat["bars"] = None
            report["pages"].append(page_stat)
            if ink_px > 0:
                ink_pages.append(pno)
            if read_pages is not None and pno not in read_pages:
                page_stat["note"] = "ink present, outside read_pages" if ink_px else "outside read_pages"
                continue
            if ink_px == 0:
                if read_pages is not None:
                    report["checks"].append(_check(f"p{pno}: has markup ink", False, "no markup ink found"))
                continue

            hs, space = heads.noteheads(G["black"], G["systems"])
            hs = heads.place(hs, G["systems"])
            for h in hs:
                h["page"] = pno
            shifts = align.print_shifts(hs, measures_geo, by)
            matched = {id(n["el"]) for h in hs
                       for n in [align.head_match(h, pno, measures_geo, by, hs, shifts)[0]] if n is not None}
            xml_notes = [n for m in measures_geo if m["page"] == pno for st in (1, 2) for n in by.get((m["mindex"], st), [])]
            n_matched = sum(1 for n in xml_notes if id(n["el"]) in matched)
            rate = (n_matched / len(xml_notes)) if xml_notes else 1.0
            page_stat["heads_matched"] = f"{n_matched}/{len(xml_notes)}"
            page_stat["clef_shifts"] = sorted({(numbers[k[3]], k[2], v) for k, v in shifts.items() if k[0] == pno and v})
            report["checks"].append(_check(f"p{pno}: noteheads matched a MusicXML note", rate >= man["min_head_match"],
                                            f"{page_stat['heads_matched']} ({rate:.0%}, need {man['min_head_match']:.0%})"))

            marks = cluster.clusters(mask, L["px_per_pt"][0], join_pt=man["join_pt"])
            for i, c in enumerate(marks):
                c["id"] = f"p{pno}-{i + 1:02d}"
            page_stat["marks"] = len(marks)

            img = sheet.composite(L["scan"]["gray"], L["ink"])
            sheet_images = []
            for i, s in enumerate(sheet.contact_sheets(img, marks, space), start=1):
                name = f"p{pno}-{i}.png"
                s.save(run_path / "sheets" / name)
                sheet_images.append(name)
            sheet.overview(img, marks).save(run_path / "sheets" / f"p{pno}-overview.png")
            pdf_sha1 = report["inputs"]["pdf"]["sha1"]
            sheet_fp = readings.sheet_fingerprint(pno, pdf_sha1, man["join_pt"], marks)
            (run_path / "sheets" / f"p{pno}.json").write_text(json.dumps(
                dict(page=pno, sheet=sheet_fp, pdf_sha1=pdf_sha1, join_pt=man["join_pt"],
                     images=sheet_images,
                     marks=[{k: c[k] for k in ("id", "x0", "y0", "x1", "y1", "cx", "cy", "px")} for c in marks]),
                indent=1) + "\n")
            readings.write_template(run_path / "readings" / f"p{pno}.template.json", pno, sheet_fp, marks)

            rfile = run_path / "readings" / f"p{pno}.json"
            if not rfile.exists():
                missing_readings.append(pno)
                continue
            try:
                table = json.loads(rfile.read_text())
                readings.validate(table, pno, sheet_fp, [c["id"] for c in marks])
            except ValueError as e:
                report["checks"].append(_check(f"p{pno}: readings are valid", False, str(e)))
                continue
            R = table["marks"]
            by_kind = {}
            for c in marks:
                r = R[c["id"]]
                by_kind.setdefault(r["kind"], 0)
                by_kind[r["kind"]] += 1
                if r["kind"] == "ambiguous":
                    report["skipped"].append(dict(page=pno, mark=c["id"], text=r.get("text"),
                                                   why=r.get("why") or r.get("mark")))
                elif r["kind"] == "other":
                    report["other"].append(dict(page=pno, mark=c["id"], text=r.get("text"), mark_desc=r.get("mark")))
            page_stat["readings"] = by_kind
            report["checks"].append(_check(f"p{pno}: every mark has a reading", True, f"{len(marks)} marks"))

            merged_marks, merged_R = readings.merge_parts(marks, table)
            sts = align.stacks(merged_marks, merged_R, space)
            firsts = {}
            for i, st in enumerate(sts):
                if len(st["digits"]) == 1:
                    firsts[i] = align.attribute(st, pno, G, hs, measures_geo, by, space, shifts)
            row = align.rows_of_digits(sts, space)
            for i, a in firsts.items():
                if a.get("status") == "ok" and a["margin"] is not None and a["margin"] < 0.5:
                    mates = [firsts[j] for j in row if row[j] == row[i] and j != i and firsts[j].get("status") == "ok"
                             and (firsts[j]["margin"] is None or firsts[j]["margin"] >= 0.5)]
                    staffs = {(m["head"]["system"], m["head"]["staff"]) for m in mates}
                    if len(staffs) == 1 and (a["head"]["system"], a["head"]["staff"]) not in staffs:
                        only = [h for h in hs if (h["system"], h["staff"]) in staffs]
                        b = align.attribute(sts[i], pno, G, only, measures_geo, by, space, shifts)
                        if b.get("status") == "ok":
                            b["how"] += ", staff from its row"
                            b["margin"] = None
                            firsts[i] = b

            for i, st in enumerate(sts):
                if len(st["digits"]) == 1:
                    a = firsts[i]
                    if a["status"] != "ok":
                        report["skipped"].append(dict(page=pno, mark=st["ids"][0], text=st["digits"][0],
                                                       why=a.get("reason")))
                        continue
                    low = a["how"].startswith("proportional") or (a["margin"] is not None and a["margin"] < 0.5)
                    found = [dict(digit=st["digits"][0], placement=a["placement"], how=a["how"], note=a["note"],
                                  measure=a["measure"], staff=a["staff"], onset=a["onset"], pitch=a["pitch"],
                                  review=bool(low), head=a["head"])]
                else:
                    a = align.attribute_stack(st, pno, G, hs, measures_geo, by, space, shifts)
                    if a["status"] != "ok":
                        report["skipped"].append(dict(page=pno, mark="+".join(st["ids"]), text="/".join(st["digits"]),
                                                       why=a.get("reason")))
                        continue
                    found = [dict(n, review=False, stack="/".join(st["digits"])) for n in a["notes"]]
                mark_id = "+".join(st["ids"])
                for f in found:
                    report["placements"].append(dict(
                        mark=mark_id, digits=f["digit"], measure=f["measure"], staff=f["staff"],
                        onset=str(f["onset"]), pitch=f["pitch"], placement=f["placement"], how=f["how"],
                        review=f["review"], stack=f.get("stack"), head_x=f["head"]["x"], head_y=f["head"]["y"],
                        page=pno))
                    edits.append(dict(el=f["note"]["el"], digits=f["digit"], placement=f["placement"],
                                       measure=f["measure"], staff=f["staff"], onset=f["onset"],
                                       beat=f["note"]["beat"], pitch=f["pitch"], mark=mark_id,
                                       voice=f["note"]["voice"]))

        if missing_readings:
            report["checks"].append(_check("readings present", False,
                                            f"read sheets/p<N>.png for pages {missing_readings} into readings/"))
            return _finish(run_path, report, t0, waiting=True)

        # hand order: a thumb is the hand's inner end and a fifth finger its
        # outer end among notes struck together on that staff
        def midi(n):
            return (int(n["octave"]) + 1) * 12 + score.SEMI[n["step"]] + n["alter"]

        kept = []
        for e in edits:
            n = next(r for r in rows if r["el"] is e["el"])
            if e["digits"] in ("1", "5") and not n["grace"]:
                together = [r for r in rows if r["mindex"] == n["mindex"] and r["staff"] == n["staff"]
                            and r["onset"] == n["onset"] and not r["rest"] and not r["grace"] and r["step"]
                            and r["el"] is not e["el"]]
                lh = n["staff"] == 2
                inner_low = (e["digits"] == "1") != lh
                bad = [r for r in together if (midi(r) < midi(n)) == inner_low and midi(r) != midi(n)]
                if bad:
                    names = ", ".join(score.name(r["step"], r["alter"], r["octave"]) for r in bad)
                    mark = next(p["mark"] for p in report["placements"] if p["measure"] == e["measure"]
                                and p["staff"] == e["staff"] and p["onset"] == str(e["onset"]) and p["pitch"] == e["pitch"])
                    report["skipped"].append(dict(page=_page_of(mark),
                                                   mark=mark, text=e["digits"],
                                                   why=f"hand order: {'LH' if lh else 'RH'} {e['digits']} on "
                                                       f"{e['pitch']} with {names} struck with it"))
                    continue
            kept.append(e)
        report["checks"].append(_check("hand order of 1 and 5", True, f"{len(edits) - len(kept)} left for review"))
        edits = kept

        seen = {}
        for e in edits:
            seen.setdefault(id(e["el"]), []).append(e)
        clash = [v for v in seen.values() if len(v) > 1]
        report["checks"].append(_check("one fingering per note", not clash, f"{len(clash)} notes with two readings"))
        edits = [v[0] for v in seen.values() if len(v) == 1]

        new_text, results = insert.splice(text, [(e["el"], e["digits"], e["placement"]) for e in edits])
        report["inserted"] = {s: results.count(s) for s in sorted(set(results))}
        added = sum(len(e["digits"].split("-")) for e, r in zip(edits, results) if r == "added")

        out_path = _out_path(run_path, man)
        _write_score_text(man, new_text, root_name, out_path)
        out_text = new_text if root_name is None else scoreio.read_mxl_text(out_path)[1]
        planned = [(e["measure"], e["staff"], e["onset"], e["pitch"], e["digits"]) for e in edits]
        report["checks"] += verify.check(text, out_text, out_path, planned, added, xsd=man["xsd_path"])

        if all(c["ok"] for c in report["checks"]):
            out_root = score.load_text(out_text)
            out_rows = score.note_table(out_root)
            source = dict(kind="handwritten markup", pdf_sha1=report["inputs"]["pdf"]["sha1"],
                          pages=man["read_pages"] or ink_pages)
            lay = layer.build(man["piece"], report["inputs"]["musicxml"]["sha1"], source,
                               f"tools/fingerings {__version__}", out_rows, edits)
            (run_path / "layer.json").write_text(json.dumps(lay, indent=1, ensure_ascii=False) + "\n")
            _write_proof_sheets(run_path, report, layers)
        else:
            out_path.unlink(missing_ok=True)

    return _finish(run_path, report, t0)


def _page_of(mark_id):
    return int(mark_id[1:].split("-")[0])


def _proof_items(report):
    """The combined, ordered list the "#i" numbering and the proof sheets
    share: left for review first (skips), then placements flagged review,
    then every other placement, then marks that aren't fingerings."""
    skips = sorted(report["skipped"], key=lambda s: (_page_of(s["mark"]), s["mark"]))
    review = [p for p in report["placements"] if p["review"]]
    rest = [p for p in report["placements"] if not p["review"]]
    other = report["other"]
    items = []
    i = 0
    for s in skips:
        i += 1
        s["proof"] = i
        items.append(dict(proof=i, page=_page_of(s["mark"]), mark=s["mark"], kind="skip",
                           label=f"{s['mark']} '{s.get('text')}' SKIPPED", sub=(s.get("why") or "")))
    for p in review + rest:
        i += 1
        p["proof"] = i
        label = f"m.{p['measure']} {'RH' if p['staff'] == 1 else 'LH'} {p['pitch']} <- {p['digits']}"
        sub = f"{p['mark']} beat {p['onset']} {p['placement']}" + (" REVIEW" if p["review"] else "")
        items.append(dict(proof=i, page=p["page"], mark=p["mark"], kind="placement", label=label, sub=sub,
                           box=None, head=(p["head_x"], p["head_y"])))
    for o in other:
        i += 1
        o["proof"] = i
        items.append(dict(proof=i, page=o["page"], mark=o["mark"], kind="other",
                           label=f"{o['mark']} not a fingering", sub=(o.get("mark_desc") or o.get("text") or "")))
    return items


def _write_proof_sheets(run_path, report, layers):
    items = _proof_items(report)
    (run_path / "proof").mkdir(exist_ok=True)
    marks_by_page = {}
    for pno, L in layers.items():
        p = run_path / "sheets" / f"p{pno}.json"
        if p.exists():
            marks_by_page[pno] = {m["id"]: m for m in json.loads(p.read_text())["marks"]}
    for pno, L in layers.items():
        marks = marks_by_page.get(pno)
        if not marks:
            continue
        page_items = []
        for it in items:
            if it["page"] != pno:
                continue
            ids = it["mark"].split("+")
            boxes = [marks[i] for i in ids if i in marks]
            if not boxes:
                continue
            x0 = min(b["x0"] for b in boxes)
            y0 = min(b["y0"] for b in boxes)
            x1 = max(b["x1"] for b in boxes)
            y1 = max(b["y1"] for b in boxes)
            page_items.append(dict(proof=it["proof"], box=(x0, y0, x1, y1), head=it.get("head"),
                                    label=it["label"], sub=it["sub"]))
        if not page_items:
            continue
        img = sheet.composite(L["scan"]["gray"], L["ink"])
        for i, s in enumerate(proof.sheets_for_page(img, page_items), start=1):
            s.save(run_path / "proof" / f"p{pno}-{i}.png")


def _render_markdown(report):
    lines = [f"# {report['piece']}", ""]
    lines.append("## Checks")
    for c in report["checks"]:
        lines.append(f"{'PASS' if c['ok'] else 'FAIL'} {c['check']} - {c['detail']}")
    lines.append("")
    lines.append("## Pages")
    lines.append("| Page | Bars | Ink px | Marks | Heads matched |")
    lines.append("|---|---|---|---|---|")
    for p in report["pages"]:
        bars = "-".join(str(b) for b in p["bars"]) if p.get("bars") else ""
        lines.append(f"| {p['page']} | {bars} | {p['ink_px']} | {p.get('marks', '')} | {p.get('heads_matched', '')} |")
    lines.append("")
    by_bar = {}
    for p in report["placements"]:
        key = (p["measure"], "RH" if p["staff"] == 1 else "LH")
        by_bar.setdefault(key, []).append(p)
    lines.append("## Per bar")
    lines.append("| Bar | Hand | Notes <- finger |")
    lines.append("|---|---|---|")
    for (bar, hand), plist in sorted(by_bar.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        notes = " · ".join(f"{p['pitch']} (b.{p['onset']}) <- {p['digits']}"
                                 + (" R" if p["review"] else "") + f" #{p.get('proof', '?')}" for p in plist)
        lines.append(f"| {bar} | {hand} | {notes} |")
    lines.append("")
    lines.append("## Left for review")
    for s in sorted(report["skipped"], key=lambda s: s.get("proof", 0)):
        lines.append(f"- #{s.get('proof', '?')} {s['mark']} '{s.get('text')}': {s.get('why')}")
    lines.append("")
    lines.append("## Not fingerings")
    for o in sorted(report["other"], key=lambda o: o.get("proof", 0)):
        lines.append(f"- #{o.get('proof', '?')} {o['mark']}: {o.get('mark_desc') or o.get('text') or ''}")
    lines.append("")
    lines.append(f"{len(report['placements'])} placed, {len(report['skipped'])} skipped, {report['seconds']} s")
    return "\n".join(lines) + "\n"


def _finish(run_path, report, t0, extra_check=None, waiting=False):
    if extra_check:
        report["checks"].append(extra_check)
    report["seconds"] = round(time.perf_counter() - t0, 1)
    report["ok"] = (not waiting) and all(c["ok"] for c in report["checks"])
    if not report["ok"]:
        _clean_stale(run_path)
    (run_path / "report.json").write_text(json.dumps(report, indent=1, default=str) + "\n")
    (run_path / "report.md").write_text(_render_markdown(report))
    for c in report["checks"]:
        print("PASS" if c["ok"] else "FAIL", c["check"], "-", c["detail"])
    print(f"{len(report['placements'])} placed, {len(report['skipped'])} skipped, {report['seconds']} s")
    if waiting:
        return report, EXIT_NEEDS_READING
    return report, (EXIT_OK if report["ok"] else EXIT_FAILED)
