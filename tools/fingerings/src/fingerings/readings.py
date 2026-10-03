"""The reading table: the vision step's input and output.

Stage 1 writes `sheets/pN.json` (the marks) and `readings/pN.template.json`
(one empty entry per mark id); the reader fills in `readings/pN.json`.
Every error lists the offending ids, so a misread sheet is quick to find."""
import hashlib
import json
import re

_SINGLE = re.compile(r"^[1-5]$")
_STACK = re.compile(r"^[1-5](?:/[1-5])+$")
_SUBSTITUTION = re.compile(r"^[1-5](?:-[1-5])+$")

ALLOWED_KEYS = {"kind", "text", "mark", "why", "of"}
ALLOWED_KINDS = {"finger", "other", "ambiguous", "part"}


def sheet_fingerprint(page, pdf_sha1, join_pt, marks):
    """The SHA-1 of the canonical JSON of the sheet's identity: page, the
    PDF's hash, the clustering parameter and the marks themselves (ids and
    boxes), so a reading table re-read after a clustering change is loud
    rather than silently misattributed."""
    canon = json.dumps(
        dict(page=page, pdf_sha1=pdf_sha1, join_pt=join_pt,
             marks=[{k: c[k] for k in ("id", "x0", "y0", "x1", "y1", "cx", "cy", "px")} for c in marks]),
        sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(canon.encode("utf-8")).hexdigest()[:12]


def write_template(path, page, sheet, marks):
    template = dict(page=page, sheet=sheet, reader="",
                     marks={c["id"]: {"kind": "", "text": ""} for c in marks})
    path.write_text(json.dumps(template, indent=1) + "\n")


def _err(errors, msg):
    errors.append(msg)


def validate(table, page, sheet, mark_ids):
    """table: the parsed readings/pN.json. page/sheet: the current page
    number and sheet fingerprint. mark_ids: the sheet's own mark ids.
    Raises ValueError (every offending id named) or returns nothing."""
    errors = []
    if not isinstance(table, dict):
        raise ValueError("the reading table must be a JSON object")
    if table.get("page") != page:
        _err(errors, f"page {table.get('page')!r} doesn't match this file's page {page}")
    if table.get("sheet") != sheet:
        _err(errors, "readings are for another version of this page's marks: re-read")
    if not table.get("reader"):
        _err(errors, "reader must be a non-empty string")
    marks = table.get("marks")
    if not isinstance(marks, dict):
        raise ValueError("marks must be a JSON object" + ("; " + "; ".join(errors) if errors else ""))
    unknown_ids = sorted(set(marks) - set(mark_ids))
    if unknown_ids:
        _err(errors, f"ids not on this page's sheet: {unknown_ids}")
    missing = sorted(set(mark_ids) - set(marks))
    if missing:
        _err(errors, f"missing a reading for: {missing}")
    for mid, r in marks.items():
        if not isinstance(r, dict):
            _err(errors, f"{mid}: a reading must be a JSON object")
            continue
        extra_keys = sorted(set(r) - ALLOWED_KEYS)
        if extra_keys:
            _err(errors, f"{mid}: unknown key(s) {extra_keys}")
        kind = r.get("kind")
        if kind not in ALLOWED_KINDS:
            _err(errors, f"{mid}: unknown kind {kind!r}")
            continue
        if kind == "finger":
            text = r.get("text", "")
            if not (_SINGLE.match(text) or _STACK.match(text) or _SUBSTITUTION.match(text)):
                _err(errors, f"{mid}: finger text {text!r} isn't a single digit 1-5, a stack (2/3), "
                              "or a substitution (2-3); a mix such as 2-3/4 is ambiguous")
        elif kind == "ambiguous":
            if not r.get("why"):
                _err(errors, f"{mid}: ambiguous needs a non-empty why")
        elif kind == "part":
            of = r.get("of")
            if not of or of not in marks:
                _err(errors, f"{mid}: part 'of' {of!r} doesn't name another mark on this page")
            elif marks[of].get("kind") == "part":
                _err(errors, f"{mid}: part 'of' {of!r} is itself a part")
            elif marks[of].get("kind") not in ("finger", "other", "ambiguous"):
                _err(errors, f"{mid}: part 'of' {of!r} has no kind yet")
    if errors:
        raise ValueError("; ".join(errors))


def merge_parts(marks, table):
    """Merge each lead mark with its `part`s (the spec's "2-3 drawn as
    three marks" and digits split across two clusters): the box is the
    union, cx/cy the pixel-weighted centroid, px the sum, and the item id
    joins the sorted mark numbers with "+". The lead's own reading (a
    merged finger "2-3" is one item whose digit string is already "2-3")
    carries over unchanged under the merged id. Returns (merged marks,
    {merged id: reading}), ready for align.stacks."""
    by_id = {c["id"]: c for c in marks}
    readings = table["marks"]
    parts_of = {}
    for mid, r in readings.items():
        if r.get("kind") == "part":
            parts_of.setdefault(r["of"], []).append(mid)
    merged = []
    merged_readings = {}
    for c in marks:
        mid = c["id"]
        r = readings[mid]
        if r.get("kind") == "part":
            continue
        group_ids = sorted([mid] + parts_of.get(mid, []), key=_mark_sort_key)
        new_id = "+".join(group_ids)
        if len(group_ids) == 1:
            merged.append(c)
        else:
            group = [by_id[i] for i in group_ids]
            x0 = min(g["x0"] for g in group)
            y0 = min(g["y0"] for g in group)
            x1 = max(g["x1"] for g in group)
            y1 = max(g["y1"] for g in group)
            px = sum(g["px"] for g in group)
            cx = sum(g["cx"] * g["px"] for g in group) / px
            cy = sum(g["cy"] * g["px"] for g in group) / px
            merged.append(dict(id=new_id, x0=x0, y0=y0, x1=x1, y1=y1, cx=cx, cy=cy, px=px))
        merged_readings[new_id] = r
    return merged, merged_readings


def _mark_sort_key(mark_id):
    # "p1-30" -> (1, 30); sorts numerically, not lexicographically
    page, num = mark_id[1:].split("-")
    return int(page), int(num)
