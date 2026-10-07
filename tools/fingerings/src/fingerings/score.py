"""MusicXML note table: one row per printed note, with the keys the
pipeline aligns on (measure number, staff, onset in quarter beats, pitch).

`measure` on each row is the score's printed bar number as the app counts
it (`app_numbers`, a port of the app's `measureNumbersFor`), not the raw
XML `number` attribute: an implicit measure (a leading pickup, or the
second half of a bar split around a repeat) doesn't advance the count, and
a non-numeric `number` (Finale writes "X1") never reaches `int()`.
`beat` is the onset in quarter notes from the start of the first measure
element carrying that bar number, so the second half of a split bar
continues the beat count instead of restarting at 0.

A score may hold several `<part>`s (voice plus piano, for example); staves
are numbered globally in score order, part 1's staves first, and each row
keeps its part id alongside that global `staff` index. At most 3 staves in
all are supported; more is refused. A clef change or an octave-shift line
applies by *time* (the chronological position its direction reaches in its
own staff's voice), not by document order, so a second voice written after
a `<backup>` isn't fooled by a change that comes later in the document but
earlier in time."""
from fractions import Fraction
from lxml import etree

STEPS = "CDEFGAB"
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
OCTAVE_SHIFT_SIZE = {8: 1, 15: 2}


def diatonic(step, octave):
    """Diatonic index: C4 = 28."""
    return int(octave) * 7 + STEPS.index(step)


def name(step, alter, octave):
    acc = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "x"}[int(alter)]
    return f"{step}{acc}{octave}"


def _parser():
    return etree.XMLParser(remove_blank_text=False, resolve_entities=False, no_network=True)


def load(path):
    """The score's root <score-partwise> element, parsed from a file."""
    return etree.parse(str(path), _parser()).getroot()


def load_text(text):
    """The score's root <score-partwise> element, parsed from a string (the
    text already read from a plain .musicxml file or extracted from a
    .mxl's root member)."""
    return etree.fromstring(text.encode("utf-8"), _parser())


def app_numbers(measure_els):
    """Port of static/js/st/measure_numbers.js:measureNumbersFor. One app
    bar number per measure element, in document order."""
    numbers = []
    number = 0
    for i, el in enumerate(measure_els):
        number_attr = (el.get("number") or "").strip()
        implicit = el.get("implicit") == "yes" or (i == 0 and number_attr == "0")
        if not implicit:
            number += 1
        numbers.append(number)
    return numbers


def _parts(root):
    parts = root.findall("part")
    if not parts:
        raise ValueError("no <part> found")
    return parts


def _staff_count(part):
    staves_el = part.find(".//attributes/staves")
    if staves_el is not None and staves_el.text:
        return int(staves_el.text)
    max_staff = 1
    for note in part.iter("note"):
        s = note.findtext("staff")
        if s:
            max_staff = max(max_staff, int(s))
    return max_staff


def part_staff_counts(root):
    """[(part id, staff count)], in document order."""
    return [(p.get("id"), _staff_count(p)) for p in _parts(root)]


def _validate_staff_total(parts):
    counts = [_staff_count(p) for p in parts]
    total = sum(counts)
    if total > 3:
        raise ValueError(f"at most 3 staves in all expected; found {total} across {len(parts)} part(s)")
    return counts


def measures(root):
    """The first part's measure elements, in document order (every part is
    expected to share the same bar structure, so bar numbering is read from
    the first one)."""
    parts = _parts(root)
    _validate_staff_total(parts)
    return parts[0].findall("measure")


def multirest_spans(measure_els):
    """{measure index: N} for each measure element that starts a printed
    multi-bar rest of N measures (`<attributes><measure-style>
    <multiple-rest>N</multiple-rest></measure-style></attributes>`,
    N > 1)."""
    spans = {}
    for i, m in enumerate(measure_els):
        for ms in m.findall("attributes/measure-style/multiple-rest"):
            if ms.text is None:
                continue
            n = int(ms.text)
            if n > 1:
                spans[i] = n
    return spans


def _octave_shift_delta(size, typ):
    octaves = OCTAVE_SHIFT_SIZE.get(size, size / 8.0)
    return -octaves if typ == "down" else octaves


def _octave_intervals(events):
    """events: [(gonset, docidx, type, size, number)] for one staff, any
    order. -> [(start, end_or_None, shift)]."""
    open_by_number = {}
    intervals = []
    for onset, docidx, typ, size, number in sorted(events, key=lambda e: (e[0], e[1])):
        if typ == "stop":
            if number in open_by_number:
                start_onset, shift = open_by_number.pop(number)
                intervals.append((start_onset, onset, shift))
        else:
            open_by_number[number] = (onset, _octave_shift_delta(size, typ))
    for start_onset, shift in open_by_number.values():
        intervals.append((start_onset, None, shift))
    return intervals


def _shift_at(intervals, gonset):
    for start, end, shift in intervals:
        if start <= gonset and (end is None or gonset < end):
            return shift
    return 0


def _clef_at(events, gonset):
    """events: [(gonset, docidx, (sign, line))] for one staff. The event
    with the greatest (onset, docidx) at or before gonset, or None."""
    best = None
    for onset, docidx, clef in events:
        if onset <= gonset and (best is None or (onset, docidx) > (best[0], best[1])):
            best = (onset, docidx, clef)
    return best[2] if best else None


def _part_rows(measure_els, numbers, part_id, staff_offset):
    """Rows for one part's measure elements, with clefs and octave shifts
    resolved by chronological position rather than document order."""
    rows = []
    divisions = 1
    clef_events = {}  # local staff -> [(gonset, docidx, (sign, line))]
    oct_events = {}  # local staff -> [(gonset, docidx, type, size, number)]
    lengths = []
    docidx = 0
    abs_measure_start = Fraction(0)
    for mindex, measure in enumerate(measure_els):
        pos = Fraction(0)
        last_onset = Fraction(0)
        for el in measure:
            tag = el.tag
            gonset = abs_measure_start + pos
            if tag == "attributes":
                d = el.find("divisions")
                if d is not None:
                    divisions = int(d.text)
                for clef in el.findall("clef"):
                    staff = int(clef.get("number", "1"))
                    clef_events.setdefault(staff, []).append(
                        (gonset, docidx, (clef.findtext("sign"), int(clef.findtext("line") or 0))))
                    docidx += 1
            elif tag == "direction":
                staff = int(el.findtext("staff") or 1)
                for shift in el.iterfind("direction-type/octave-shift"):
                    typ = shift.get("type")
                    size = int(shift.get("size") or 8)
                    number = int(shift.get("number") or 1)
                    oct_events.setdefault(staff, []).append((gonset, docidx, typ, size, number))
                    docidx += 1
            elif tag == "backup":
                pos -= Fraction(int(el.findtext("duration")), divisions)
            elif tag == "forward":
                pos += Fraction(int(el.findtext("duration")), divisions)
            elif tag == "note":
                chord = el.find("chord") is not None
                grace = el.find("grace") is not None
                dur = Fraction(int(el.findtext("duration") or 0), divisions)
                onset = last_onset if chord else pos
                local_staff = int(el.findtext("staff") or 1)
                printed = el.get("print-object") != "no"
                p = el.find("pitch")
                row = dict(el=el, part=part_id, mindex=mindex, staff=local_staff + staff_offset,
                           voice=el.findtext("voice"), onset=onset, dur=dur, chord=chord, grace=grace,
                           rest=el.find("rest") is not None, printed=printed,
                           step=None, alter=0, octave=None,
                           _local_staff=local_staff, _gonset=abs_measure_start + onset)
                if p is not None:
                    row.update(step=p.findtext("step"), alter=int(float(p.findtext("alter") or 0)),
                               octave=int(p.findtext("octave")))
                rows.append(row)
                docidx += 1
                if not chord and not grace:
                    last_onset = pos
                    pos += dur
                elif not chord:
                    last_onset = pos
        lengths.append(pos)
        abs_measure_start += pos
    # group consecutive measure elements sharing one app bar number (an
    # implicit split around a repeat), and the absolute beat each starts at
    group_start = [0] * len(measure_els)
    abs_start = [Fraction(0)] * len(measure_els)
    for i in range(len(measure_els)):
        if i and numbers[i] == numbers[i - 1]:
            group_start[i] = group_start[i - 1]
        else:
            group_start[i] = i
        abs_start[i] = (abs_start[i - 1] + lengths[i - 1]) if i else Fraction(0)
    intervals_by_staff = {s: _octave_intervals(evs) for s, evs in oct_events.items()}
    for row in rows:
        mindex = row["mindex"]
        row["measure"] = numbers[mindex]
        row["beat"] = abs_start[mindex] - abs_start[group_start[mindex]] + row["onset"]
        local_staff = row.pop("_local_staff")
        gonset = row.pop("_gonset")
        row["clef"] = _clef_at(clef_events.get(local_staff, []), gonset)
        row["octave_shift"] = _shift_at(intervals_by_staff.get(local_staff, []), gonset)
    return rows


def note_table(root):
    """Rows: dict(el, part, measure, mindex, beat, staff, voice, onset, dur,
    step, alter, octave, chord, grace, rest, printed, clef, octave_shift) in
    document order (grouped by part, part 1 first); onset is a Fraction of
    quarter beats from the start of the measure element, beat a Fraction
    from the start of the measure element group sharing its app bar number
    (see module docstring). `root` is a score's root element, as
    `load`/`load_text` return. `staff` is the global staff index (part 1's
    staves first); `clef`/`octave_shift` are resolved by chronological
    position in that staff's own voice, not document order."""
    parts = _parts(root)
    counts = _validate_staff_total(parts)
    measure_els0 = parts[0].findall("measure")
    numbers = app_numbers(measure_els0)
    n_measures = len(measure_els0)

    rows = []
    staff_offset = 0
    for part, count in zip(parts, counts):
        measure_els = part.findall("measure")
        if len(measure_els) != n_measures:
            raise ValueError(f"part {part.get('id')}: {len(measure_els)} measures, "
                              f"expected {n_measures} (part 1's count)")
        rows += _part_rows(measure_els, numbers, part.get("id"), staff_offset)
        staff_offset += count
    return rows


def fingerings(rows):
    out = []
    for r in rows:
        for f in r["el"].iterfind("notations/technical/fingering"):
            out.append(dict(measure=r["measure"], staff=r["staff"], onset=r["onset"],
                            pitch=name(r["step"], r["alter"], r["octave"]), finger=f.text,
                            placement=f.get("placement"), substitution=f.get("substitution")))
    return out
