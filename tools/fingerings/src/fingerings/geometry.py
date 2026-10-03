"""Steps 3-4 of one page: staves/systems, heads (needed before bar lines),
bar lines, staff mapping (a system showing fewer staves than the score),
measure alignment and the head-match gate. `run.py` and the `geometry`
subcommand both build on this, so a piece's geometry is detected exactly
once either way."""
from collections import defaultdict

from . import align, heads as heads_mod, staves


def analyze_page(gray):
    """Staves, systems, placed heads and bar lines for one page. Returns
    (page geometry dict, placed heads, detected staff space in px)."""
    G = staves.page_geometry(gray)
    raw_heads, space = heads_mod.noteheads(G["black"], G["systems"])
    placed = heads_mod.place(raw_heads, G["systems"])
    staves.assign_bars(G["black"], G["systems"], placed)
    return G, placed, space


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

    return dict(heads=heads, shifts=shifts, matched_ids=matched_rate_ids, n_matched=n_matched, n_total=n_total,
                rate=rate, clef_shifts=clef_shifts, checks=checks)
