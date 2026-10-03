"""The fingering layer: the edition library's interface, (measure, staff,
beat, pitch[, voice]) -> finger, with provenance; and applying one back
onto a MusicXML file as inserted lines (ported from Appendix D)."""
from fractions import Fraction

from . import insert, score


def build(piece, musicxml_sha1, source, extractor, rows, kept):
    """rows: score.note_table of the (already fingered) output, to tell a
    unison's two voices apart. kept: this run's kept edits, each
    {measure, staff, beat, pitch, digits, placement, mark[, voice]}, in
    document order. A substitution is one entry whose finger is "2-3" (the
    digits string as marked), not one entry per inserted <fingering>."""
    key = lambda r: (r["measure"], r["staff"], r["beat"], score.name(r["step"], r["alter"], r["octave"]))
    count = {}
    for r in rows:
        if r["step"] and not r["rest"]:
            count[key(r)] = count.get(key(r), 0) + 1
    entries = []
    for e in kept:
        k = (e["measure"], e["staff"], e["beat"], e["pitch"])
        entry = dict(measure=e["measure"], staff=e["staff"], beat=float(e["beat"]), pitch=e["pitch"],
                     finger=e["digits"], placement=e.get("placement"), mark=e["mark"])
        if count.get(k, 0) > 1:
            entry["voice"] = e["voice"]
        entries.append(entry)
    return dict(piece=piece, musicxml_sha1=musicxml_sha1, source=source,
                extractor=extractor, barMap={}, entries=entries)


def apply_to_text(layer, text, root):
    """Apply a fingering layer to a MusicXML file as inserted lines.
    Strict: an entry that matches no note, more than one note, or collides
    with another entry on the same note, stops the whole application
    (ok=False, text=None) rather than writing a partial result."""
    rows = score.note_table(root)
    index = {}
    for r in rows:
        if r["step"] and not r["rest"]:
            k = (r["measure"], r["staff"], r["beat"], score.name(r["step"], r["alter"], r["octave"]))
            index.setdefault(k, []).append(r)
    by_note = {}
    unmatched = []
    conflicts = []
    for e in layer["entries"]:
        k = (e["measure"], e["staff"], Fraction(e["beat"]).limit_denominator(96), e["pitch"])
        hits = index.get(k, [])
        if "voice" in e:
            hits = [r for r in hits if r["voice"] == str(e["voice"])]
        if len(hits) != 1:
            unmatched.append(e)
            continue
        el = hits[0]["el"]
        if id(el) in by_note:
            conflicts.append(f"measure {e['measure']} staff {e['staff']} {e['pitch']}: "
                              "two layer entries on one note")
            continue
        by_note[id(el)] = (el, e["finger"], e.get("placement"))
    new_text, results = insert.splice(text, list(by_note.values()))
    conflicts += [r for r in results if r.startswith("conflict")]
    ok = not unmatched and not conflicts
    return dict(text=new_text if ok else None, applied=results.count("added"),
                same=results.count("same"), conflicts=conflicts, unmatched=unmatched, ok=ok)
