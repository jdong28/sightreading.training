"""Builds the fixture score: an original, public-domain two-staff piano
piece, 16 bars of 4/4, two systems of four bars per page, a page break
after bar 8. music21 already exports a piano StaffGroup as one <part>
with <staves>2</staves> (not two separate parts), which is what the
pipeline requires (one part, up to two staves).

Covers (see the plan's Tests section 1):
- a right-hand melody with a repeated pitch in a bar (bar 2: rule 7, rank
  ordering by left-to-right position);
- a right-hand 3-note chord (bar 5), fingered with a 5/3/1 stack drawn as
  three separate marks (rule 5, align.stacks' own grouping);
- a right-hand dyad (bar 6), fingered "2/4" in one mark (a stack inside
  one box);
- a right-hand note (bar 7) fingered with a "2-3" substitution, drawn as
  a lead mark plus two `part` marks (readings.merge_parts);
- left-hand single digits below two notes (bar 3, rule 3);
- a left-hand 3-note chord (bar 9) with a single "1" below it, which goes
  to the bottom note and is left for review (hand order);
- a margin digit with no notehead near it (skip: no head);
- "other" marks (UC, a circle, "rit.") and one "ambiguous" ("try 4").

The clef-shift case (a bar printed in one clef but transcribed in another)
is not built: MuseScore's automatic layout of a bar-by-bar clef change on
a short, otherwise plain piece didn't give geometry the stave/head
detector could rely on in a quick check, and hardening that detector
belongs to the follow-up task (sr-fingering-geometry-f2), not here.
"""
from music21 import chord, clef, layout, meter, metadata, note, stream

TITLE = "Fixture"


def build():
    score = stream.Score()
    score.metadata = metadata.Metadata(title=TITLE)

    rh = stream.PartStaff()
    rh.append(clef.TrebleClef())
    rh.append(meter.TimeSignature("4/4"))
    lh = stream.PartStaff()
    lh.append(clef.BassClef())
    lh.append(meter.TimeSignature("4/4"))

    rh_measures = _rh_measures()
    lh_measures = _lh_measures()
    assert len(rh_measures) == 16 and len(lh_measures) == 16

    for i in range(16):
        m_rh = stream.Measure(number=i + 1)
        if i in (4, 8, 12):
            m_rh.insert(0, layout.SystemLayout(isNew=True))
        if i == 8:
            m_rh.insert(0, layout.PageLayout(isNew=True))
        for el in rh_measures[i]:
            m_rh.append(el)
        rh.append(m_rh)

        m_lh = stream.Measure(number=i + 1)
        for el in lh_measures[i]:
            m_lh.append(el)
        lh.append(m_lh)

    grp = layout.StaffGroup([rh, lh], symbol="brace", barTogether=True)
    score.insert(0, rh)
    score.insert(0, lh)
    score.insert(0, grp)
    return score


def _n(pitch, ql=1.0):
    return note.Note(pitch, quarterLength=ql)


def _c(pitches, ql=1.0):
    return chord.Chord(pitches, quarterLength=ql)


def _rh_measures():
    m = []
    m.append([_n("C5"), _n("D5"), _n("E5"), _n("F5")])  # bar 1: plain
    m.append([_n("G5"), _n("G5"), _n("A5"), _n("B5")])  # bar 2: repeated G5
    m.append([_n("C5"), _n("D5"), _n("E5"), _n("F5")])  # bar 3: plain
    m.append([_n("G5"), _n("A5"), _n("B5"), _n("C6")])  # bar 4: plain
    m.append([_c(["C5", "E5", "G5"], 2.0), _n("D5"), _n("E5")])  # bar 5: RH chord (5/3/1 stack)
    m.append([_c(["C5", "E5"], 1.0), _n("G5"), _n("A5"), _n("B5")])  # bar 6: RH dyad ("2/4")
    m.append([_n("G5", 2.0), _n("A5"), _n("B5")])  # bar 7: RH long note ("2-3" substitution)
    m.append([_n("C5"), _n("D5"), _n("E5"), _n("F5")])  # bar 8: plain
    for p in (["G5", "A5", "B5", "C6"], ["C5", "D5", "E5", "F5"], ["G5", "A5", "B5", "C6"], ["C5", "D5", "E5", "F5"],
              ["G5", "A5", "B5", "C6"], ["C5", "D5", "E5", "F5"], ["G5", "A5", "B5", "C6"], ["C5", "D5", "E5", "F5"]):
        m.append([_n(p[0]), _n(p[1]), _n(p[2]), _n(p[3])])
    return m


def _lh_measures():
    m = []
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 1: plain
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 2: plain
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 3: single digits below (C3, E3)
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 4: plain
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 5: plain
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 6: plain
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 7: plain
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 8: plain
    m.append([_c(["G3", "B3", "D4"], 2.0), _n("E3"), _n("F3")])  # bar 9: LH chord, "1" below (hand order)
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 10: plain (margin digit nearby)
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 11: plain
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 12: plain
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 13: plain ("other"/"ambiguous" nearby)
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 14: plain
    m.append([_n("C3"), _n("D3"), _n("E3"), _n("F3")])  # bar 15: plain
    m.append([_n("G3"), _n("A3"), _n("B3"), _n("C4")])  # bar 16: plain
    return m


if __name__ == "__main__":
    import sys
    s = build()
    s.write("musicxml", fp=sys.argv[1] if len(sys.argv) > 1 else "score_m21.musicxml")
