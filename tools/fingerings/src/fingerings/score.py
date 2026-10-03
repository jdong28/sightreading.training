"""MusicXML note table: one row per printed note, with the keys the
pipeline aligns on (measure number, staff, onset in quarter beats, pitch).

`measure` on each row is the score's printed bar number as the app counts
it (`app_numbers`, a port of the app's `measureNumbersFor`), not the raw
XML `number` attribute: an implicit measure (a leading pickup, or the
second half of a bar split around a repeat) doesn't advance the count, and
a non-numeric `number` (Finale writes "X1") never reaches `int()`.
`beat` is the onset in quarter notes from the start of the first measure
element carrying that bar number, so the second half of a split bar
continues the beat count instead of restarting at 0."""
from fractions import Fraction
from lxml import etree

STEPS = "CDEFGAB"
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


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


def _single_part(root):
    parts = root.findall("part")
    if len(parts) != 1:
        raise ValueError("one part with one or two staves expected")
    return parts[0]


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


def measures(root):
    """The single part's measure elements, in document order."""
    part = _single_part(root)
    if _staff_count(part) > 2:
        raise ValueError("one part with one or two staves expected")
    return part.findall("measure")


def note_table(root):
    """Rows: dict(el, measure, mindex, beat, staff, voice, onset, dur, step,
    alter, octave, chord, grace, rest, clef) in document order; onset is a
    Fraction of quarter beats from the start of the measure element, beat a
    Fraction from the start of the measure element group sharing its app
    bar number (see module docstring). `root` is a score's root element, as
    `load`/`load_text` return."""
    part = _single_part(root)
    if _staff_count(part) > 2:
        raise ValueError("one part with one or two staves expected")
    measure_els = part.findall("measure")
    numbers = app_numbers(measure_els)
    rows = []
    divisions = 1
    clefs = {}
    lengths = []
    for mindex, measure in enumerate(measure_els):
        pos = Fraction(0)
        last_onset = Fraction(0)
        for el in measure:
            tag = el.tag
            if tag == "attributes":
                d = el.find("divisions")
                if d is not None:
                    divisions = int(d.text)
                for clef in el.findall("clef"):
                    clefs[int(clef.get("number", "1"))] = (clef.findtext("sign"), int(clef.findtext("line") or 0))
            elif tag == "backup":
                pos -= Fraction(int(el.findtext("duration")), divisions)
            elif tag == "forward":
                pos += Fraction(int(el.findtext("duration")), divisions)
            elif tag == "note":
                chord = el.find("chord") is not None
                grace = el.find("grace") is not None
                dur = Fraction(int(el.findtext("duration") or 0), divisions)
                onset = last_onset if chord else pos
                staff = int(el.findtext("staff") or 1)
                p = el.find("pitch")
                row = dict(el=el, mindex=mindex, staff=staff,
                           voice=el.findtext("voice"), onset=onset, dur=dur, chord=chord, grace=grace,
                           rest=el.find("rest") is not None, clef=clefs.get(staff),
                           step=None, alter=0, octave=None)
                if p is not None:
                    row.update(step=p.findtext("step"), alter=int(float(p.findtext("alter") or 0)),
                               octave=int(p.findtext("octave")))
                rows.append(row)
                if not chord and not grace:
                    last_onset = pos
                    pos += dur
                elif not chord:
                    last_onset = pos
        lengths.append(pos)
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
    for row in rows:
        mindex = row["mindex"]
        row["measure"] = numbers[mindex]
        row["beat"] = abs_start[mindex] - abs_start[group_start[mindex]] + row["onset"]
    return rows


def fingerings(rows):
    out = []
    for r in rows:
        for f in r["el"].iterfind("notations/technical/fingering"):
            out.append(dict(measure=r["measure"], staff=r["staff"], onset=r["onset"],
                            pitch=name(r["step"], r["alter"], r["octave"]), finger=f.text,
                            placement=f.get("placement"), substitution=f.get("substitution")))
    return out
