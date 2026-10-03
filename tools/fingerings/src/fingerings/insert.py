"""Stage 6: write <fingering> into the MusicXML as inserted lines only.

The source text is never re-serialised: new lines are spliced in at the
note's place, so a diff against the source shows insertions and nothing
else, by construction. A note's <notations> goes where MusicXML's sequence
puts it (after <beam>, before <lyric>/<play>/<listen>); an existing
<notations> or <technical> is reused. A note that already carries a
different fingering is a conflict, reported and left alone; the same
fingering again is a no-op, so a run can be repeated. Needs one element per
line (MuseScore, Finale, Sibelius and Dorico all write that); anything else
is refused.

Lines are matched by regex, never lxml's `sourceline`: it is off by one
past line 65,535 (verified on lxml 6.1.3 / libxml2 2.14.6, with and without
huge_tree), which would misplace fingerings in a large export."""
import re

AFTER_NOTATIONS = ("<lyric", "<play", "<listen")

# "note" must be followed by whitespace or '>', not by more letters: this
# excludes <note-size>, <notations> and <notehead>, which all start with
# "note" too.
NOTE_OPEN = re.compile(r"^[ \t]*<note(?:[ \t][^>]*)?>[ \t]*\r?$")
NOTE_CLOSE = re.compile(r"^[ \t]*</note>[ \t]*\r?$")


def _tag_open(tag):
    return re.compile(rf"^[ \t]*<{tag}(?:[ \t][^>]*)?>[ \t]*\r?$")


def _tag_close(tag):
    return re.compile(rf"^[ \t]*</{tag}>[ \t]*\r?$")


def _find_match(lines, start, end, pattern):
    for i in range(start, end + 1):
        if pattern.match(lines[i]):
            return i
    return None


def _note_line_map(lines, root):
    """{id(note element): line index of its opening <note> tag}, pairing the
    k-th <note>-only line with the k-th <note> element in document order
    (every <note> in the document, not just the ones being edited, since a
    line is only meaningful relative to the whole file)."""
    note_lines = [i for i, line in enumerate(lines) if NOTE_OPEN.match(line)]
    notes = list(root.iter("note"))
    if len(note_lines) != len(notes):
        raise ValueError(f"not one element per line: {len(note_lines)} <note> lines, {len(notes)} <note> elements")
    return dict(zip((id(n) for n in notes), note_lines))


def plan(note, digits, placement=None):
    """Lines to add for one note: ("added"|"same"|"conflict (...)", [text lines])."""
    existing = [f.text for f in note.iterfind("notations/technical/fingering")]
    parts = digits.split("-")
    if existing:
        return ("same" if existing == parts else f"conflict (has {'-'.join(existing)})"), []
    attrs = f' placement="{placement}"' if placement else ""
    fing = [f'<fingering{attrs}>{parts[0]}</fingering>'] + \
           [f'<fingering substitution="yes"{attrs}>{d}</fingering>' for d in parts[1:]]
    return "added", fing


def splice(text, edits):
    """edits: [(note element, digits, placement)] -> (new text, results).
    Never re-serialises: the source's lines are an exact subsequence of the
    result's."""
    crlf = "\r\n" in text
    eol = "\r" if crlf else ""
    lines = text.split("\n")
    note_line = {}
    if edits:
        root = edits[0][0].getroottree().getroot()
        note_line = _note_line_map(lines, root)
    inserts = []  # (line index, lines)
    results = []
    for note, digits, placement in edits:
        status, fing = plan(note, digits, placement)
        results.append(status)
        if not fing:
            continue
        start = note_line[id(note)]
        end = _find_match(lines, start, len(lines) - 1, NOTE_CLOSE)
        if end is None:
            raise ValueError(f"not one element per line: no closing </note> found for the note at line {start + 1}")
        # the note's first child gives the children's indent (MuseScore
        # indents closing tags like children, so </note> can't be used)
        indent = re.match(r"[ \t]*", lines[start]).group(0)
        child = re.match(r"[ \t]*", lines[start + 1]).group(0)
        step = child[len(indent):] or "  "
        nt = note.find("notations")
        if nt is not None:
            nstart = _find_match(lines, start, end, _tag_open("notations"))
            nend = _find_match(lines, start, end, _tag_close("notations"))
            if nstart is None or nend is None:
                raise ValueError(f"not one element per line: <notations> of the note at line {start + 1}")
            tech = nt.find("technical")
            if tech is not None:
                tstart = _find_match(lines, nstart, nend, _tag_open("technical"))
                tend = _find_match(lines, nstart, nend, _tag_close("technical"))
                if tstart is None or tend is None:
                    raise ValueError(f"not one element per line: <technical> of the note at line {start + 1}")
                inserts.append((tend, [child + step * 2 + f + eol for f in fing]))
            else:
                inserts.append((nend, [child + step + "<technical>" + eol] + [child + step * 2 + f + eol for f in fing]
                                + [child + step + "</technical>" + eol]))
        else:
            at = next((i for i in range(start, end) if lines[i].lstrip().startswith(AFTER_NOTATIONS)), end)
            inserts.append((at, [child + "<notations>" + eol, child + step + "<technical>" + eol]
                            + [child + step * 2 + f + eol for f in fing]
                            + [child + step + "</technical>" + eol, child + "</notations>" + eol]))
    for at, new in sorted(inserts, key=lambda t: t[0], reverse=True):
        lines[at:at] = new
    return "\n".join(lines), results
