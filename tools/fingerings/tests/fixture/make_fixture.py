#!/usr/bin/env python3
"""Builds every committed fixture file under tests/fixture/. Run locally,
never in CI: needs MuseScore 4's command line ($MSCORE).

Pipeline:
1. Build the score (source.py) and write score.musicxml.
2. Render it with MuseScore: page PNGs (300 dpi, the scan route) and a
   vector PDF (the born-digital route).
3. Run this package's own staff/notehead detector on the rendered pages
   to find real pixel positions (empirically, from the actual engraving,
   rather than hand-computed tenths/mm anchor math) -- but the *expected*
   answer (measure, staff, beat, pitch) always comes straight from the
   MusicXML, independent of that detection, per the plan's "every answer
   is known" requirement.
4. Draw the ink items (ink.json) onto a 0.75x-resolution RGBA canvas (so
   resampling onto the scan grid is exercised, as on Reverie).
5. Build fixture.pdf (scan + ink, byte-golden route) and fixture-vector.pdf
   (vector print + ink, born-digital route) with pikepdf.
6. Run the tool's own stage 1 to get real mark ids, map each to the
   ink.json item whose drawn bbox contains it, and write
   readings/p1.json, p2.json.
7. Write expected.json, the hand-designed answer key.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
SRC = HERE.parent.parent / "src"
sys.path.insert(0, str(SRC))
sys.path.insert(0, str(HERE))

from fingerings import align, cluster, extract, geometry, readings, run as run_mod, score  # noqa: E402
import source  # noqa: E402

MSCORE = __import__("os").environ.get("MSCORE", "/Applications/MuseScore 4.app/Contents/MacOS/mscore")
SCAN_DPI = 300
INK_SCALE = 0.75
PAGE_W_PT, PAGE_H_PT = 612.0, 792.0  # Letter


def run_mscore(*args):
    # MuseScore's own child-process machinery (crashpad et al.) occasionally
    # aborts with a mutex error when launched from a multi-threaded Python
    # parent with its stdout/stderr piped (subprocess's capture_output);
    # discarding them avoids most of it, and a lone crash is worth one retry.
    import time
    last = None
    for attempt in range(6):
        p = subprocess.run([MSCORE, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if p.returncode == 0:
            return
        last = p.returncode
        time.sleep(1 + attempt)
    raise RuntimeError(f"mscore {args} failed (rc={last}) six times in a row")


def build_score_musicxml(out_dir):
    s = source.build()
    path = out_dir / "score.musicxml"
    s.write("musicxml", fp=str(path))
    return path


def render(score_path, out_dir):
    run_mscore("-r", str(SCAN_DPI), "-o", str(out_dir / "page.png"), str(score_path))
    run_mscore("-o", str(out_dir / "printed.pdf"), str(score_path))
    pages = sorted(out_dir.glob("page-*.png"))
    return pages


def detect_pages(page_pngs):
    """[(page number, gray array, geometry, placed heads, staff space)]"""
    out = []
    for i, p in enumerate(page_pngs, start=1):
        im = Image.open(p).convert("L")
        gray = np.asarray(im, dtype=np.uint8)
        G, hs, space = geometry.analyze_page(gray)
        for h in hs:
            h["page"] = i
        out.append((i, gray, G, hs, space))
    return out


def head_map(pages_detected, rows):
    """{(mindex, staff): [(x, y, step) in document/onset order]}, matching
    each bar+staff's real notes to detected heads by count (dropping
    leading clef/time-signature artifacts, which a system's first bar
    always has before any real note) and, within a chord, by y order
    against the chord's pitches high to low (document order for a chord
    built from an ascending pitch list is low to high)."""
    geoms = [(pno, G) for pno, _gray, G, _hs, _space in pages_detected]
    measures, _total = align.page_measures(geoms)
    by_mindex_staff = {}
    space_by_page = {pno: space for pno, _gray, _G, _hs, space in pages_detected}
    heads_by_page = {pno: hs for pno, _gray, _G, hs, _space in pages_detected}
    for m in measures:
        hs = heads_by_page[m["page"]]
        for staff in (1, 2):
            in_bar = sorted([h for h in hs if h["system"] == m["system"] and h["staff"] == staff
                              and m["x0"] - 4 <= h["x"] <= m["x1"] + 4], key=lambda h: h["x"])
            bar_rows = [r for r in rows if r["mindex"] == m["mindex"] and r["staff"] == staff and not r["rest"]]
            if not bar_rows:
                continue
            onsets = []
            for r in bar_rows:
                if not onsets or onsets[-1][0] != r["onset"]:
                    onsets.append((r["onset"], []))
                onsets[-1][1].append(r)
            expected = sum(len(g) for _, g in onsets)
            n_artifacts = len(in_bar) - expected
            if n_artifacts < 0:
                raise RuntimeError(f"mindex {m['mindex']} staff {staff}: detected {len(in_bar)} heads, "
                                    f"expected {expected} real notes (negative artifacts)")
            usable = in_bar[n_artifacts:]
            idx = 0
            mapped = []
            for _onset, group in onsets:
                k = len(group)
                chunk = sorted(usable[idx:idx + k], key=lambda h: h["y"])
                idx += k
                group_sorted = sorted(group, key=lambda r: -score.diatonic(r["step"], r["octave"]))
                for r, h in zip(group_sorted, chunk):
                    mapped.append((r, h))
            by_mindex_staff[(m["mindex"], staff)] = mapped
    return by_mindex_staff, space_by_page


def verify_positions(by_mindex_staff, rows):
    """Sanity check independent of the mapping itself: each mapped head's
    detected staff-position step must equal the expected position
    align.expected_pos computes from the row's own clef and pitch."""
    by_el = {}
    for (mindex, staff), pairs in by_mindex_staff.items():
        for r, h in pairs:
            expected_step = align.expected_pos(r)
            if expected_step is None or h["step"] != expected_step:
                raise RuntimeError(f"mindex {mindex} staff {staff} {r['step']}{r['octave']}: "
                                    f"detected step {h['step']} != expected {expected_step}")
            by_el[id(r["el"])] = (r, h)
    if len(by_el) != sum(1 for r in rows if not r["rest"]):
        raise RuntimeError(f"mapped {len(by_el)} notes, expected {sum(1 for r in rows if not r['rest'])}")
    return by_el


def pack_1bit(gray):
    """A 1-bit DeviceGray row-packed buffer: bit 1 = white (the format's
    default Decode, no inversion needed), MSB first."""
    bits = (gray >= 128).astype(np.uint8)
    h, w = bits.shape
    pad = (-w) % 8
    if pad:
        bits = np.pad(bits, ((0, 0), (0, pad)), constant_values=1)
    packed = np.packbits(bits, axis=1, bitorder="big")
    return packed.tobytes(), w, h


def make_scan_xobject(pdf, gray):
    # no Filter here: make_stream stores exactly the bytes given, and
    # pikepdf compresses (and sets the matching Filter) on save
    data, w, h = pack_1bit(gray)
    return pdf.make_stream(data, pikepdf.Dictionary(
        Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=w, Height=h,
        BitsPerComponent=1, ColorSpace=pikepdf.Name.DeviceGray))


def make_ink_xobjects(pdf, rgba):
    """(rgb image xobject with an 8-bit SMask alpha xobject attached)."""
    h, w = rgba.shape[0], rgba.shape[1]
    rgb = rgba[:, :, :3].tobytes()
    alpha = rgba[:, :, 3].tobytes()
    smask = pdf.make_stream(alpha, pikepdf.Dictionary(
        Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceGray))
    img = pdf.make_stream(rgb, pikepdf.Dictionary(
        Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceRGB))
    img.SMask = smask
    return img


def add_full_page_image(pdf, page, xobj, name):
    resources = page.obj.get("/Resources")
    if resources is None:
        resources = pikepdf.Dictionary()
        page.obj.Resources = resources
    xobjects = resources.get("/XObject")
    if xobjects is None:
        xobjects = pikepdf.Dictionary()
        resources.XObject = xobjects
    xobjects["/" + name] = xobj
    stream = f"q {PAGE_W_PT} 0 0 {PAGE_H_PT} 0 0 cm /{name} Do Q\n".encode("ascii")
    contents = page.obj.get("/Contents")
    new_stream = pdf.make_stream(stream)
    if contents is None:
        page.obj.Contents = new_stream
    elif isinstance(contents, pikepdf.Array):
        contents.append(new_stream)
    else:
        page.obj.Contents = pikepdf.Array([contents, new_stream])


# --- ink items -------------------------------------------------------

BOX_W, BOX_H = 34, 26  # scan-pixel box size for a single-digit mark: small
# enough that a 0.5-space clearance from a note mid-staff still lands the
# box's midpoint inside the staff's own y-range (align.sides' "inside"),
# rather than straddling the "below the staff" boundary ambiguously
STACK_GAP = 10  # scan px edge-to-edge gap between separately boxed stack digits


def _box(cx, cy, w=BOX_W, h=BOX_H):
    return dict(x0=cx - w / 2, y0=cy - h / 2, x1=cx + w / 2, y1=cy + h / 2)


def build_ink_items(by_el, space_by_page, pages_detected):
    """[{id, page, kind, text, mark, why, of, box: {x0,y0,x1,y1}}], scan
    (300 dpi) pixel coordinates. `id` is this script's own bookkeeping id,
    unrelated to the tool's mark ids (p1-01, ...), assigned later by
    matching each drawn box's centre against the tool's own clustering."""
    # by_el maps id(el) -> (row, head); build a lookup by (mindex, staff, step, octave)
    lookup = {}
    for row, h in by_el.values():
        lookup[(row["mindex"], row["staff"], row["step"], row["octave"])] = (row, h)

    def head(mindex, staff, pitch):
        step = pitch[0]
        octave = int(pitch[-1])
        return lookup[(mindex, staff, step, octave)]

    space1 = space_by_page[1]
    space2 = space_by_page[2]
    items = []

    def add(id_, page, kind, cx, cy, box_w=BOX_W, box_h=BOX_H, **kw):
        items.append(dict(id=id_, page=page, kind=kind, box=_box(cx, cy, box_w, box_h), **kw))

    def above_cy(note_y, space, box_h=BOX_H, clear=0.5):
        """Centre y for a box of height box_h whose bottom edge clears a
        note at note_y by `clear` staff spaces (never overlaps the head,
        regardless of box size)."""
        return note_y - clear * space - box_h / 2

    def below_cy(note_y, space, box_h=BOX_H, clear=0.5):
        return note_y + clear * space + box_h / 2

    def stack_above(cx, note_y, space, n, box_h=BOX_H, clear=0.5, gap=STACK_GAP):
        """n box centres, nearest-to-farthest from the note, stacked
        upward with `gap` clearance between consecutive boxes."""
        out = []
        edge = note_y - clear * space  # bottom edge of the nearest box
        for _ in range(n):
            out.append(edge - box_h / 2)
            edge -= box_h + gap
        return out

    # --- bar 2 (mindex 1): repeated G5, rule 7 ---
    # both G5 rows share one pitch, so fetch them from by_el directly and
    # order by onset (left to right)
    g5s = [(r, h) for r, h in by_el.values() if r["mindex"] == 1 and r["staff"] == 1 and r["step"] == "G" and r["octave"] == 5]
    g5s.sort(key=lambda rh: rh[0]["onset"])
    (r_a, h_a), (r_b, h_b) = g5s
    add("rh_bar2_g5a", 1, "finger", h_a["x"], above_cy(h_a["y"], space1), text="1")
    add("rh_bar2_g5b", 1, "finger", h_b["x"], above_cy(h_b["y"], space1), text="2")

    # --- bar 5 (mindex 4): RH chord, 5/3/1 stack as three separate boxes,
    # nearest-the-chord to farthest: "5" (closest, for the top note G5),
    # then "3", then "1" (farthest) ---
    _r, h_g5 = head(4, 1, "G5")
    _r, h_e5 = head(4, 1, "E5")
    _r, h_c5 = head(4, 1, "C5")
    cx = h_g5["x"]
    # align.stacks() reads a vertical stack top-mark-first and pairs it
    # with the chord's top note: stack_above's *farthest* (topmost, drawn
    # first going up) box must be "5" so G5 (the chord's top note) gets
    # it; "1" (for the bottom note, C5) goes nearest the chord.
    cy_near, cy_mid, cy_far = stack_above(cx, h_g5["y"], space1, 3)
    add("rh_bar5_1", 1, "finger", cx, cy_near, text="1")
    add("rh_bar5_3", 1, "finger", cx, cy_mid, text="3")
    add("rh_bar5_5", 1, "finger", cx, cy_far, text="5")

    # --- bar 6 (mindex 5): RH dyad, "2/4" in one box, above the higher
    # note (E5) so the box clears both heads ---
    _r, h_c5b = head(5, 1, "C5")
    _r, h_e5b = head(5, 1, "E5")
    top_note_y = min(h_c5b["y"], h_e5b["y"])
    add("rh_bar6_dyad", 1, "finger", h_c5b["x"], above_cy(top_note_y, space1), text="2/4")

    # --- bar 7 (mindex 6): RH long note, "2-3" substitution, lead + 2
    # parts stacked directly above it at the *same x* (so the merged
    # centroid stays over the note) ---
    _r, h_g5c = head(6, 1, "G5")
    lead_cy, part1_cy, part2_cy = stack_above(h_g5c["x"], h_g5c["y"], space1, 3, box_h=BOX_H * 0.6, gap=20)
    add("rh_bar7_lead", 1, "finger", h_g5c["x"], lead_cy, text="2-3")
    add("rh_bar7_part1", 1, "part", h_g5c["x"], part1_cy, box_h=BOX_H * 0.6, of="rh_bar7_lead")
    add("rh_bar7_part2", 1, "part", h_g5c["x"], part2_cy, box_h=BOX_H * 0.6, of="rh_bar7_lead")

    # --- bar 3 (mindex 2): LH single digits below two notes ---
    _r, h_c3 = head(2, 2, "C3")
    _r, h_e3 = head(2, 2, "E3")
    add("lh_bar3_c3", 1, "finger", h_c3["x"], below_cy(h_c3["y"], space1), text="5")
    add("lh_bar3_e3", 1, "finger", h_e3["x"], below_cy(h_e3["y"], space1), text="3")

    # --- bar 9 (mindex 8): LH chord, "1" below -> bottom note, hand order ---
    _r, h_g3 = head(8, 2, "G3")
    add("lh_bar9_1", 2, "finger", h_g3["x"], below_cy(h_g3["y"], space2), text="1")

    # --- a margin digit with no notehead near it (skip: no head) ---
    # placed in the blank gap between page 2's two systems, comfortably
    # away from both so align.sides() finds no staff it could belong to
    page2_geom = next(G for pno, _gray, G, _hs, _space in pages_detected if pno == 2)
    sys0_bottom = page2_geom["systems"][0]["bottom"]
    sys1_top = page2_geom["systems"][1]["top"]
    margin_y = (sys0_bottom + sys1_top) / 2
    add("margin", 2, "finger", 400.0, margin_y, text="3")

    # --- "other" marks and one "ambiguous" mark, page 2, blank area below
    # the last system ---
    below_y = page2_geom["systems"][1]["bottom"] + 8 * space2
    add("other_uc", 2, "other", 400.0, below_y, text="C", mark_desc="UC (una corda)")
    add("other_circle", 2, "other", 700.0, below_y, mark_desc="circle round a note")
    add("other_rit", 2, "other", 1000.0, below_y, mark_desc="rit.")
    add("ambiguous_try4", 2, "ambiguous", 1300.0, below_y, text="4", why="tentative, marked 'try'")

    return items


def draw_ink_canvas(items_for_page, scan_w, scan_h):
    # drawn hard-edged (no supersample/blur): a few small ink items sit
    # close together (the stacked-digit and part-merge cases), and blurring
    # closed their gaps enough for cluster.clusters to merge them
    ink_w, ink_h = round(scan_w * INK_SCALE), round(scan_h * INK_SCALE)
    canvas = Image.new("RGBA", (ink_w, ink_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    for it in items_for_page:
        b = it["box"]
        x0, y0, x1, y1 = (v * INK_SCALE for v in (b["x0"], b["y0"], b["x1"], b["y1"]))
        d.ellipse([x0, y0, x1, y1], fill=(220, 0, 0, 255))
    return np.asarray(canvas, dtype=np.uint8)


def match_marks_to_items(marks, page_items):
    """{tool mark id: our ink item}, by nearest centroid (each of our
    boxes is drawn as its own connected blob, so this is a near-exact
    match; asserts the counts agree and every item is claimed)."""
    if len(marks) != len(page_items):
        raise RuntimeError(f"page has {len(marks)} detected marks but {len(page_items)} drawn ink items")
    remaining = list(page_items)
    out = {}
    for m in marks:
        def dist2(it, m=m):
            bx = (it["box"]["x0"] + it["box"]["x1"]) / 2
            by = (it["box"]["y0"] + it["box"]["y1"]) / 2
            return (bx - m["cx"]) ** 2 + (by - m["cy"]) ** 2
        best = min(remaining, key=dist2)
        out[m["id"]] = best
        remaining.remove(best)
    return out


def main():
    import tempfile

    with tempfile.TemporaryDirectory() as tmpd:
        tmp = Path(tmpd)
        score_path = build_score_musicxml(tmp)
        committed_score = HERE / "score.musicxml"
        shutil.copy(score_path, committed_score)

        pages = render(score_path, tmp)
        detected = detect_pages(pages)
        rows = score.note_table(score.load(score_path))
        by_mindex_staff, space_by_page = head_map(detected, rows)
        by_el = verify_positions(by_mindex_staff, rows)
        items = build_ink_items(by_el, space_by_page, detected)
        print(f"built {len(items)} ink items")

        # --- fixture.pdf: scan (1-bit, from the MuseScore render) + ink ---
        pdf = pikepdf.Pdf.new()
        ink_by_page = {}
        for pno, gray, _G, _hs, _space in detected:
            page = pdf.add_blank_page(page_size=(PAGE_W_PT, PAGE_H_PT))
            add_full_page_image(pdf, page, make_scan_xobject(pdf, gray), "Scan")
            page_items = [it for it in items if it["page"] == pno]
            ink_rgba = draw_ink_canvas(page_items, gray.shape[1], gray.shape[0])
            ink_by_page[pno] = ink_rgba
            add_full_page_image(pdf, page, make_ink_xobjects(pdf, ink_rgba), "Ink")
        pdf.save(HERE / "fixture.pdf", deterministic_id=True)
        pdf.close()

        # --- fixture-vector.pdf: MuseScore's own vector print + the same
        # ink, overlaid with Page.add_overlay (never a hand-written content
        # stream appended to an existing page: MuseScore's own content
        # leaves the CTM in a non-identity state outside any q/Q, which a
        # naive appended "cm ... Do" composes with silently) ---
        vec = pikepdf.open(tmp / "printed.pdf")
        for pno, gray, _G, _hs, _space in detected:
            ink_pdf = pikepdf.Pdf.new()
            ink_page = ink_pdf.add_blank_page(page_size=(PAGE_W_PT, PAGE_H_PT))
            add_full_page_image(ink_pdf, ink_page, make_ink_xobjects(ink_pdf, ink_by_page[pno]), "Ink")
            vec.pages[pno - 1].add_overlay(ink_pdf.pages[0])
        vec.save(HERE / "fixture-vector.pdf", deterministic_id=True)
        vec.close()

        # --- run the tool's own stage-1 clustering on fixture.pdf to get
        # real mark ids, and build readings/pN.json from our ink items ---
        pdf_sha1 = __import__("hashlib").sha1(Path(HERE / "fixture.pdf").read_bytes()).hexdigest()
        item_to_markid = {}
        page_sheets = {}
        with pikepdf.open(HERE / "fixture.pdf") as pdf2:
            for pno, gray, _G, _hs, _space in detected:
                L = extract.page_layers(pdf2, pno - 1)
                mask = extract.ink_mask(L["ink"])
                marks = cluster.clusters(mask, L["px_per_pt"][0], join_pt=1.0)
                for i, c in enumerate(marks):
                    c["id"] = f"p{pno}-{i + 1:02d}"
                page_items = [it for it in items if it["page"] == pno]
                mapping = match_marks_to_items(marks, page_items)
                for mark_id, item in mapping.items():
                    item_to_markid[item["id"]] = mark_id
                sheet_fp = readings.sheet_fingerprint(pno, pdf_sha1, 1.0, marks)
                page_sheets[pno] = sheet_fp

        for pno in (1, 2):
            page_items = [it for it in items if it["page"] == pno]
            marks_table = {}
            for it in page_items:
                mark_id = item_to_markid[it["id"]]
                entry = dict(kind=it["kind"])
                if it["kind"] == "finger":
                    entry["text"] = it["text"]
                elif it["kind"] == "other":
                    if "text" in it:
                        entry["text"] = it["text"]
                    entry["mark"] = it["mark_desc"]
                elif it["kind"] == "ambiguous":
                    if "text" in it:
                        entry["text"] = it["text"]
                    entry["why"] = it["why"]
                elif it["kind"] == "part":
                    entry["of"] = item_to_markid[it["of"]]
                marks_table[mark_id] = entry
            table = dict(page=pno, sheet=page_sheets[pno], reader="make_fixture.py", marks=marks_table)
            (HERE / "readings" / f"p{pno}.json").write_text(json.dumps(table, indent=1, sort_keys=True) + "\n")

        # --- expected.json: the hand-designed answer key ---
        def onset_str(mindex, staff, letter_octave, occurrence=0):
            r = find_row(rows, mindex, staff, letter_octave, occurrence)
            return str(r["onset"])

        placements = [
            dict(measure=2, staff=1, onset=onset_str(1, 1, "G5", 0), pitch="G5", finger="1", placement="above"),
            dict(measure=2, staff=1, onset=onset_str(1, 1, "G5", 1), pitch="G5", finger="2", placement="above"),
            dict(measure=5, staff=1, onset=onset_str(4, 1, "G5"), pitch="G5", finger="5", placement="above"),
            dict(measure=5, staff=1, onset=onset_str(4, 1, "E5"), pitch="E5", finger="3", placement="above"),
            dict(measure=5, staff=1, onset=onset_str(4, 1, "C5"), pitch="C5", finger="1", placement="above"),
            dict(measure=6, staff=1, onset=onset_str(5, 1, "E5"), pitch="E5", finger="2", placement="above"),
            dict(measure=6, staff=1, onset=onset_str(5, 1, "C5"), pitch="C5", finger="4", placement="above"),
            dict(measure=7, staff=1, onset=onset_str(6, 1, "G5"), pitch="G5", finger="2-3", placement="above"),
            dict(measure=3, staff=2, onset=onset_str(2, 2, "C3"), pitch="C3", finger="5", placement="below"),
            dict(measure=3, staff=2, onset=onset_str(2, 2, "E3"), pitch="E3", finger="3", placement="below"),
        ]
        skips = [
            dict(page=2, text="1", reason_prefix="hand order"),
            dict(page=2, text="3", reason_prefix="no notehead of a staff"),
            dict(page=2, text="4", reason_prefix="tentative"),
        ]
        expected = dict(placements=placements, skips=skips, other_count=3)
        (HERE / "expected.json").write_text(json.dumps(expected, indent=1) + "\n")
        print("wrote score.musicxml, fixture.pdf, fixture-vector.pdf, readings/p1.json, readings/p2.json, expected.json")


def find_row(rows, mindex, staff, letter_octave, occurrence=0):
    step, octave = letter_octave[0], int(letter_octave[-1])
    matches = [r for r in rows if r["mindex"] == mindex and r["staff"] == staff and not r["rest"]
               and r["step"] == step and r["octave"] == octave]
    matches.sort(key=lambda r: r["onset"])
    return matches[occurrence]


def lookup_el(rows, mindex, staff, letter_octave):
    return find_row(rows, mindex, staff, letter_octave)["el"]


if __name__ == "__main__":
    main()
