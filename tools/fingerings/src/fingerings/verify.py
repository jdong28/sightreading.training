"""Stage 7: check a fingered MusicXML against its source and the plan.

Uses lxml instead of an xmllint subprocess (same libxml2, one fewer CI
dependency) and a greedy subsequence test instead of difflib's
SequenceMatcher, which doesn't guarantee an LCS and can report a false
"replace" when inserted lines duplicate nearby ones."""
import re
from lxml import etree
from . import score

ALLOWED_INSERT = re.compile(
    r'^(?:<notations>|</notations>|<technical>|</technical>'
    r'|<fingering(?: substitution="yes")?(?: placement="(?:above|below)")?>[1-5]</fingering>)$'
)


def note_key(r):
    return (r["measure"], r["staff"], r["voice"], str(r["onset"]), str(r["dur"]),
            r["step"], r["alter"], r["octave"], r["chord"], r["grace"], r["rest"])


def _well_formed(text):
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    try:
        etree.fromstring(text.encode("utf-8"), parser)
        return True, ""
    except etree.XMLSyntaxError as e:
        return False, str(e)[:200]


def _schema_ok(text, xsd):
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    doc = etree.fromstring(text.encode("utf-8"), parser)
    schema = etree.XMLSchema(etree.parse(str(xsd)))
    return bool(schema.validate(doc))


def _insertions_only(src_text, out_text):
    """(ok, detail). The source's lines must be a subsequence of the
    output's (greedy: never fails to extend when a line matches, which is
    exactly the subsequence question); every line the output adds beyond
    that must be one of the lines insert.py is allowed to write."""
    src_lines = src_text.split("\n")
    out_lines = out_text.split("\n")
    i = 0
    extra = []
    for line in out_lines:
        if i < len(src_lines) and line == src_lines[i]:
            i += 1
        else:
            extra.append(line)
    is_subsequence = i == len(src_lines)
    bad = [l for l in extra if not ALLOWED_INSERT.match(l.strip())]
    inserted = len(out_lines) - len(src_lines)
    detail = f"{inserted} lines inserted"
    if not is_subsequence:
        detail += "; the source is not a subsequence of the output"
    if bad:
        detail += f"; not an allowed inserted line: {bad[:3]}"
    return is_subsequence and not bad, detail


def check(src_text, out_text, out_path, planned, added, xsd=None):
    """src_text/out_text: the score's text before and after this run's
    edits (the .musicxml text, or a .mxl's extracted root member).
    out_path: the written output file, for music21 (it needs a real path).
    planned: [(measure, staff, onset, pitch, digits)] expected to be on
    their note, whether added this run or already there from an earlier
    one. added: count of individual fingering digits newly inserted this
    run (not "same" or "conflict"). Returns [(check, passed, detail)]."""
    res = []
    ok, detail = _well_formed(out_text)
    res.append(("well-formed", ok, detail))
    if xsd:
        out_ok = _schema_ok(out_text, xsd)
        src_ok = _schema_ok(src_text, xsd)
        res.append(("MusicXML 4.0 schema (same verdict as the source)", out_ok == src_ok,
                    f"source {'PASS' if src_ok else 'FAIL'}, output {'PASS' if out_ok else 'FAIL'}"))
    else:
        res.append(("MusicXML 4.0 schema (same verdict as the source)", True, "skipped: no xsd in the manifest"))
    ok, detail = _insertions_only(src_text, out_text)
    res.append(("diff: insertions only", ok, detail))
    src_rows = score.note_table(score.load_text(src_text))
    out_rows = score.note_table(score.load_text(out_text))
    res.append(("notes unchanged", [note_key(r) for r in src_rows] == [note_key(r) for r in out_rows],
                f"{len(src_rows)} notes before, {len(out_rows)} after"))
    got = {}
    for f in score.fingerings(out_rows):
        got.setdefault((f["measure"], f["staff"], f["onset"], f["pitch"]), []).append(f["finger"])
    before = len(score.fingerings(src_rows))
    missing = [pl for pl in planned if got.get(pl[:4]) != pl[4].split("-")]
    res.append(("every planned fingering on its note", not missing,
                f"{len(planned) - len(missing)}/{len(planned)}" + (f"; missing {missing[:5]}" if missing else "")))
    total = sum(len(v) for v in got.values())
    want = before + added
    res.append(("no other fingering added", total == want, f"{total} fingerings, expected {want}"))
    try:
        import music21
        s = music21.converter.parse(str(out_path), forceSource=True)
        n = sum(1 for nn in s.recurse().notes for art in nn.articulations if isinstance(art, music21.articulations.Fingering))
        res.append(("music21 parses", n == total, f"{n} fingerings, {len(s.parts[0].getElementsByClass('Measure'))} measures"))
    except Exception as e:  # noqa: BLE001
        res.append(("music21 parses", False, repr(e)[:200]))
    return res
