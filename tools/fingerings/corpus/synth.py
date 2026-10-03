#!/usr/bin/env python3
"""Deterministic synthetic scores covering the geometry categories the
report's section 8 step 2 names: 8va/15ma starting and stopping mid-bar,
multi-bar rests, cross-staff, a one-staff melody, a one-part three-staff
piano score, a two-staff score with hidden empty staves, grace notes, a
pickup plus repeats and voltas, two voices sharing a staff with a mid-bar
clef change, and a ledger-heavy right hand with beams lying on staff
lines. Each is an original work (not a transcription of anyone else's
edition), so there is no rights question: CC0.

These are music21 Score objects; `fetch.py` renders each with MuseScore
and keeps the re-export as that piece's MusicXML (MuseScore's own layout
is the run's truth, same as for a real engraving)."""
from music21 import bar, chord, clef, duration, layout, meter, note, spanner, stream


def _measure(num, elements, new_system=False):
    m = stream.Measure(number=num)
    if new_system:
        m.insert(0, layout.SystemLayout(isNew=True))
    for el in elements:
        m.append(el)
    return m


def _n(pitch, ql=1.0):
    return note.Note(pitch, quarterLength=ql)


def _part(clef_obj, time_sig="4/4"):
    p = stream.Part()
    p.append(clef_obj)
    if time_sig:
        p.append(meter.TimeSignature(time_sig))
    return p


def ottava_mid_bar():
    """8va starting on beat 3 of bar 1 and stopping on beat 2 of bar 2;
    15ma on bar 3 similarly. Covers an octave-shift line that starts and
    stops mid-bar (a whole-bar 8va is already handled by CLEF_SHIFTS)."""
    p = _part(clef.TrebleClef())
    notes = []
    for pitch in ("C5", "D5", "E5", "F5"):
        notes.append(_n(pitch))
    m1 = _measure(1, notes)
    p.append(m1)
    notes2 = [_n(p_) for p_ in ("G5", "A5", "B5", "C6")]
    m2 = _measure(2, notes2)
    p.append(m2)
    ott8 = spanner.Ottava(notes[2], notes2[1], type="8va")
    p.insert(0, ott8)

    notes3 = [_n(p_) for p_ in ("C5", "D5", "E5", "F5")]
    m3 = _measure(3, notes3, new_system=True)
    p.append(m3)
    notes4 = [_n(p_) for p_ in ("G5", "A5", "B5", "C6")]
    m4 = _measure(4, notes4)
    p.append(m4)
    ott15 = spanner.Ottava(notes3[2], notes4[1], type="15ma")
    p.insert(0, ott15)

    sc = stream.Score()
    sc.insert(0, p)
    return sc


def ottava_bass_clef():
    """15mb (an octave-and-a-bit... no: 8vb) on the bass-clef staff,
    starting mid-bar and stopping mid-bar of the next: a second 8va-class
    instance, on the other staff and the other direction (printed higher
    than it sounds) from ottava_mid_bar's 8va."""
    p = _part(clef.BassClef())
    notes = [_n(pp) for pp in ("C3", "B2", "A2", "G2")]
    m1 = _measure(1, notes, new_system=True)
    p.append(m1)
    notes2 = [_n(pp) for pp in ("F2", "E2", "D2", "C2")]
    m2 = _measure(2, notes2)
    p.append(m2)
    ott = spanner.Ottava(notes[2], notes2[1], type="8vb")
    p.insert(0, ott)
    sc = stream.Score()
    sc.insert(0, p)
    return sc


def multirest():
    """A 16-bar line with a 4-bar multi-bar rest (bars 5-8), printed as
    one bar standing for four measure elements."""
    p = _part(clef.TrebleClef())
    for i in range(1, 5):
        p.append(_measure(i, [_n(pp) for pp in ("C5", "D5", "E5", "F5")], new_system=(i == 1)))
    for i in range(5, 9):
        m = stream.Measure(number=i)
        m.append(note.Rest(quarterLength=4.0))
        p.append(m)
    for i in range(9, 13):
        p.append(_measure(i, [_n(pp) for pp in ("G5", "A5", "B5", "C6")], new_system=(i == 9)))
    sc = stream.Score()
    sc.insert(0, p)
    return sc


def multirest_bass():
    """A second multi-bar rest instance: in the bass-clef staff of a
    two-staff piece (the right hand keeps playing through it), and a
    different span (8 bars) from multirest's 4."""
    rh = _part(clef.TrebleClef())
    lh = _part(clef.BassClef())
    for i in range(1, 4):
        rh.append(_measure(i, [_n(pp) for pp in ("C5", "D5", "E5", "F5")], new_system=(i == 1)))
        lh.append(_measure(i, [_n(pp) for pp in ("C3", "D3", "E3", "F3")], new_system=(i == 1)))
    for i in range(4, 12):
        rh.append(_measure(i, [_n(pp) for pp in ("G5", "A5", "B5", "C6")]))
        m = stream.Measure(number=i)
        m.append(note.Rest(quarterLength=4.0))
        lh.append(m)
    for i in range(12, 15):
        rh.append(_measure(i, [_n(pp) for pp in ("C5", "D5", "E5", "F5")]))
        lh.append(_measure(i, [_n(pp) for pp in ("C3", "D3", "E3", "F3")]))
    grp = layout.StaffGroup([rh, lh], symbol="brace", barTogether=True)
    sc = stream.Score()
    sc.insert(0, rh)
    sc.insert(0, lh)
    sc.insert(0, grp)
    return sc


def cross_staff_print_only():
    """A beamed run whose notes are encoded on the right-hand's own staff
    (staff 1) but printed, by the grand-staff layout, reaching down near
    the left-hand staff: the geometry test's cross-staff probe reads the
    *detected heads*, which land on whichever staff the print actually
    shows, against this staff-1-only encoding."""
    rh = _part(clef.TrebleClef())
    lh = _part(clef.BassClef())
    rh.append(_measure(1, [_n(pp, 0.5) for pp in ("C4", "B3", "A3", "G3", "F3", "E3", "D3", "C3")], new_system=True))
    rh.append(_measure(2, [_n(pp) for pp in ("C5", "D5", "E5", "F5")]))
    lh.append(_measure(1, [note.Rest(quarterLength=4.0)]))
    lh.append(_measure(2, [_n(pp) for pp in ("C3", "D3", "E3", "F3")]))
    grp = layout.StaffGroup([rh, lh], symbol="brace", barTogether=True)
    sc = stream.Score()
    sc.insert(0, rh)
    sc.insert(0, lh)
    sc.insert(0, grp)
    return sc


def cross_staff_lh_into_rh():
    """A second cross-staff instance: left-hand notes encoded on staff 2
    (bass clef) but high enough that, printed, they sit on or above the
    right-hand's staff -- the opposite direction from
    cross_staff_print_only's right-hand-encoded run."""
    rh = _part(clef.TrebleClef())
    lh = _part(clef.BassClef())
    rh.append(_measure(1, [note.Rest(quarterLength=4.0)], new_system=True))
    rh.append(_measure(2, [_n(pp) for pp in ("C5", "D5", "E5", "F5")]))
    lh.append(_measure(1, [_n(pp, 0.5) for pp in ("C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5")]))
    lh.append(_measure(2, [_n(pp) for pp in ("C3", "D3", "E3", "F3")]))
    grp = layout.StaffGroup([rh, lh], symbol="brace", barTogether=True)
    sc = stream.Score()
    sc.insert(0, rh)
    sc.insert(0, lh)
    sc.insert(0, grp)
    return sc


def one_staff():
    """A one-staff melody, several bars."""
    p = _part(clef.TrebleClef())
    bars = [
        ("C5", "D5", "E5", "F5"), ("G5", "A5", "B5", "C6"),
        ("C5", "E5", "G5", "C6"), ("B4", "A4", "G4", "F4"),
    ]
    for i, pitches in enumerate(bars, start=1):
        p.append(_measure(i, [_n(pp) for pp in pitches], new_system=(i == 1)))
    sc = stream.Score()
    sc.insert(0, p)
    return sc


def three_staff_piano():
    """One part, three staves (a wide piano reduction): staff 1 treble,
    staff 2 alto/treble middle voice, staff 3 bass. Three PartStaff
    siblings under one StaffGroup: music21 exports that as one <part>
    with <staves>3</staves>, which is what geometry's staff model (up to
    3 staves in one part) expects."""
    top = stream.PartStaff()
    top.append(clef.TrebleClef())
    top.append(meter.TimeSignature("4/4"))
    mid = stream.PartStaff()
    mid.append(clef.TrebleClef())
    mid.append(meter.TimeSignature("4/4"))
    bot = stream.PartStaff()
    bot.append(clef.BassClef())
    bot.append(meter.TimeSignature("4/4"))
    bars_top = [("C5", "D5", "E5", "F5"), ("G5", "A5", "B5", "C6"), ("C5", "D5", "E5", "F5")]
    bars_mid = [("C4", "D4", "E4", "F4"), ("G4", "A4", "B4", "C5"), ("C4", "D4", "E4", "F4")]
    bars_bot = [("C3", "D3", "E3", "F3"), ("G3", "A3", "B3", "C4"), ("C3", "D3", "E3", "F3")]
    for i in range(3):
        top.append(_measure(i + 1, [_n(pp) for pp in bars_top[i]], new_system=(i == 0)))
        mid.append(_measure(i + 1, [_n(pp) for pp in bars_mid[i]]))
        bot.append(_measure(i + 1, [_n(pp) for pp in bars_bot[i]]))
    grp = layout.StaffGroup([top, mid, bot], symbol="brace", barTogether=True)
    sc = stream.Score()
    sc.insert(0, top)
    sc.insert(0, mid)
    sc.insert(0, bot)
    sc.insert(0, grp)
    return sc


def voice_piano():
    """A voice part (1 staff) plus a piano part (2 staves): 1 + 2 = 3
    staves in all, across two parts."""
    voice = stream.Part(id="voice")
    voice.partName = "Voice"
    voice.append(clef.TrebleClef())
    voice.append(meter.TimeSignature("4/4"))
    rh = stream.PartStaff()
    rh.append(clef.TrebleClef())
    rh.append(meter.TimeSignature("4/4"))
    lh = stream.PartStaff()
    lh.append(clef.BassClef())
    lh.append(meter.TimeSignature("4/4"))
    bars_voice = [("C5", "D5", "E5", "F5"), ("G5", "A5", "B5", "C6"), ("C5", "D5", "E5", "F5")]
    bars_rh = [("E5", "F5", "G5", "A5"), ("B5", "C6", "D6", "E6"), ("E5", "F5", "G5", "A5")]
    bars_lh = [("C3", "D3", "E3", "F3"), ("G3", "A3", "B3", "C4"), ("C3", "D3", "E3", "F3")]
    for i in range(3):
        voice.append(_measure(i + 1, [_n(pp) for pp in bars_voice[i]], new_system=(i == 0)))
        rh.append(_measure(i + 1, [_n(pp) for pp in bars_rh[i]]))
        lh.append(_measure(i + 1, [_n(pp) for pp in bars_lh[i]]))
    grp = layout.StaffGroup([rh, lh], symbol="brace", barTogether=True)
    sc = stream.Score()
    sc.insert(0, voice)
    sc.insert(0, rh)
    sc.insert(0, lh)
    sc.insert(0, grp)
    return sc


def hidden_empty_staff():
    """A two-staff piano score where one system's left hand has nothing
    to play (a bar of rests): MuseScore's "hide empty staves" prints that
    system with its bottom staff hidden, so the system shows one staff
    inside a two-staff score."""
    rh = stream.PartStaff()
    rh.append(clef.TrebleClef())
    rh.append(meter.TimeSignature("4/4"))
    lh = stream.PartStaff()
    lh.append(clef.BassClef())
    lh.append(meter.TimeSignature("4/4"))
    bars_rh = [("C5", "D5", "E5", "F5"), ("G5", "A5", "B5", "C6"), ("C5", "D5", "E5", "F5")]
    for i in range(3):
        rh.append(_measure(i + 1, [_n(pp) for pp in bars_rh[i]], new_system=(i == 1)))
        m = stream.Measure(number=i + 1)
        if i == 0:
            m.append(note.Rest(quarterLength=4.0))
        else:
            for pp in ("C3", "D3", "E3", "F3"):
                m.append(_n(pp))
        lh.append(m)
    grp = layout.StaffGroup([rh, lh], symbol="brace", barTogether=True)
    sc = stream.Score()
    sc.insert(0, rh)
    sc.insert(0, lh)
    sc.insert(0, grp)
    return sc


def grace_notes():
    """Slashed (acciaccatura) and unslashed (appoggiatura) grace notes
    before chords, plus a bare grace note before a single note."""
    p = _part(clef.TrebleClef())
    m1 = stream.Measure(number=1)
    m1.insert(0, layout.SystemLayout(isNew=True))
    g1 = note.Note("D5", quarterLength=0.5)
    g1.duration = duration.GraceDuration()
    g1.duration.slash = True
    m1.append(g1)
    m1.append(_n("C5"))
    g2 = note.Note("B4", quarterLength=0.5)
    g2.duration = duration.GraceDuration()
    g2.duration.slash = False
    m1.append(g2)
    m1.append(chord.Chord(["C5", "E5", "G5"], quarterLength=1))
    m1.append(_n("G5", 2.0))
    p.append(m1)

    m2 = stream.Measure(number=2)
    g3 = note.Note("F5", quarterLength=0.5)
    g3.duration = duration.GraceDuration()
    g3.duration.slash = True
    m2.append(g3)
    m2.append(_n("E5", 2.0))
    m2.append(_n("D5"))
    m2.append(_n("C5"))
    p.append(m2)
    sc = stream.Score()
    sc.insert(0, p)
    return sc


def pickup_repeat_voltas():
    """A one-beat pickup, a start-repeat right after the pickup, then two
    endings (voltas 1 and 2)."""
    p = _part(clef.TrebleClef())
    pickup = stream.Measure(number=0)
    pickup.insert(0, layout.SystemLayout(isNew=True))
    pickup.append(_n("G4", 1.0))
    pickup.paddingLeft = 3.0
    p.append(pickup)

    m1 = _measure(1, [_n(pp) for pp in ("C5", "D5", "E5", "F5")])
    m1.leftBarline = bar.Repeat(direction="start")
    p.append(m1)
    m2 = _measure(2, [_n(pp) for pp in ("G5", "A5", "B5", "C6")])
    p.append(m2)

    m3 = _measure(3, [_n(pp) for pp in ("C5", "D5", "E5", "F5")])
    m3.rightBarline = bar.Repeat(direction="end")
    p.append(m3)
    m4 = _measure(4, [_n(pp) for pp in ("G4", "A4", "B4", "C5")])
    p.append(m4)

    p.append(_measure(5, [_n(pp) for pp in ("C5", "D5", "E5", "F5")], new_system=True))

    rb1 = spanner.RepeatBracket([m3, m4], number=1)
    p.insert(0, rb1)

    m3b = _measure(6, [_n(pp) for pp in ("C5", "D5", "E5", "F5")])
    m4b = _measure(7, [_n(pp) for pp in ("D5", "E5", "F5", "G5")])
    p.append(m3b)
    p.append(m4b)
    rb2 = spanner.RepeatBracket([m3b, m4b], number=2)
    p.insert(0, rb2)

    sc = stream.Score()
    sc.insert(0, p)
    return sc


def clef_mid_bar_two_voices():
    """Two voices sharing one staff: voice 1 changes clef mid-bar (treble
    to bass), voice 2 stays in treble throughout, so a clef lookup by
    document order (rather than by each voice's own chronological
    position) would wrongly apply voice 1's later clef to voice 2."""
    p = stream.Part()
    p.append(clef.TrebleClef())
    p.append(meter.TimeSignature("4/4"))
    m1 = stream.Measure(number=1)
    m1.insert(0, layout.SystemLayout(isNew=True))
    v1 = stream.Voice()
    v1.id = 1
    v1.append(_n("C5", 1))
    v1.append(_n("D5", 1))
    v1.append(clef.BassClef())
    v1.append(_n("E3", 1))
    v1.append(_n("F3", 1))
    v2 = stream.Voice()
    v2.id = 2
    v2.append(_n("G5", 4))
    m1.insert(0, v1)
    m1.insert(0, v2)
    p.append(m1)

    m2 = stream.Measure(number=2)
    v1b = stream.Voice()
    v1b.id = 1
    for pp in ("C3", "D3", "E3", "F3"):
        v1b.append(_n(pp, 1))
    v2b = stream.Voice()
    v2b.id = 2
    v2b.append(_n("A5", 4))
    m2.insert(0, v1b)
    m2.insert(0, v2b)
    p.append(m2)

    sc = stream.Score()
    sc.insert(0, p)
    return sc


def ledger_beam_on_line():
    """A ledger-heavy right hand: beamed eighth-note runs well above the
    staff, whose beams are likely to lie along a staff line at some point
    across the run (the class of bug a thin-run line centre fixes)."""
    p = _part(clef.TrebleClef())
    runs = [
        ("F5", "F5", "G5", "G5", "A5", "A5", "B5", "B5"),
        ("C6", "C6", "B5", "B5", "A5", "A5", "G5", "G5"),
        ("F5", "F5", "G5", "G5", "A5", "A5", "B5", "B5"),
        ("C6", "C6", "B5", "B5", "A5", "A5", "G5", "G5"),
    ]
    for i, pitches in enumerate(runs, start=1):
        p.append(_measure(i, [_n(pp, 0.5) for pp in pitches], new_system=(i == 1)))
    p.makeBeams(inPlace=True)
    sc = stream.Score()
    sc.insert(0, p)
    return sc


SCORES = {
    "ottava_mid_bar": ottava_mid_bar,
    "ottava_bass_clef": ottava_bass_clef,
    "multirest": multirest,
    "multirest_bass": multirest_bass,
    "cross_staff_print_only": cross_staff_print_only,
    "cross_staff_lh_into_rh": cross_staff_lh_into_rh,
    "one_staff": one_staff,
    "three_staff_piano": three_staff_piano,
    "voice_piano": voice_piano,
    "hidden_empty_staff": hidden_empty_staff,
    "grace_notes": grace_notes,
    "pickup_repeat_voltas": pickup_repeat_voltas,
    "clef_mid_bar_two_voices": clef_mid_bar_two_voices,
    "ledger_beam_on_line": ledger_beam_on_line,
}


def build(name):
    return SCORES[name]()


if __name__ == "__main__":
    import sys
    name = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else f"{name}.musicxml"
    build(name).write("musicxml", fp=out)
    print(f"wrote {out}")
