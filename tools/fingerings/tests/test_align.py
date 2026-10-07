"""Unit tests for align.py: multirest-aware measure walking, the unison
rate, the cross-staff fallback, grace-only small heads, the per-system
floor and staff-mapping candidates."""
from fractions import Fraction

from fingerings import align


def _geom_one_system(n_bars, page=1):
    """A minimal page geometry: one system, n_bars measures with x-ranges
    10 px apart, enough for page_measures to walk."""
    measures = [dict(x0=i * 10, x1=(i + 1) * 10) for i in range(n_bars)]
    return page, dict(systems=[dict(measures=measures)])


def test_page_measures_multirest():
    geoms = [_geom_one_system(3)]  # 3 detected printed bars
    multirest = {1: 4}  # the 2nd detected bar (mindex 1) covers 4 measure elements
    measures_geo, total = align.page_measures(geoms, multirest=multirest)
    assert [m["mindex"] for m in measures_geo] == [0, 1, 5]
    assert total == 6  # 0, then +4 at mindex 1, then +1 at mindex 5 -> 6
    assert align.expected_printed_count(6, multirest) == 3


def test_expected_printed_count_no_multirest():
    assert align.expected_printed_count(16, {}) == 16


def _row(el, mindex, staff, onset, step, octave, clef=("G", 2), grace=False, voice="1"):
    return dict(el=el, mindex=mindex, staff=staff, onset=Fraction(onset), dur=Fraction(1), voice=voice,
                step=step, alter=0, octave=octave, chord=False, grace=grace, rest=False, printed=True,
                clef=clef, octave_shift=0, measure=mindex + 1, beat=Fraction(onset), part="P1")


class _El:
    """A stand-in for an lxml element: identity is all head_match/the
    unison rate need."""


def test_unison_rate():
    e1, e2 = _El(), _El()
    r1 = _row(e1, 0, 1, 0, "C", 5)
    r2 = _row(e2, 0, 1, 0, "C", 5, voice="2")
    by = align.xml_by_measure([r1, r2])
    notes = by[(0, 1)]
    assert len(notes) == 2
    matched = {id(e1)}
    out = align.unison_matched_ids(notes, matched)
    assert id(e1) in out and id(e2) in out


def test_cross_staff_fallback():
    """A head on staff 2 at the position a staff-1 note would have in
    staff 2's clef, with no staff-2 note in the bar, matches it with
    how == 'cross-staff'. A second, later bar's staff-2 note anchors
    staff 2's clef (the realistic case: the staff has notes somewhere in
    the piece, just not in this crossed-away bar)."""
    e1, e_anchor = _El(), _El()
    # staff 1 (treble): C5 is 2 half-spaces above the bottom line
    r1 = _row(e1, 0, 1, 0, "C", 5, clef=("G", 2))
    r_anchor = _row(e_anchor, 1, 2, 0, "C", 3, clef=("F", 3))
    by = align.xml_by_measure([r1, r_anchor])
    measures = [dict(page=1, system=0, x0=0, x1=10, mindex=0)]
    # the head is detected on staff 2 (bass clef) at the position C5 would
    # have if printed in staff 2's own clef
    pos_in_staff2 = align.expected_pos(dict(step="C", octave=5, alter=0, clef=("F", 3), octave_shift=0))
    head = dict(x=5, system=0, staff=2, step=pos_in_staff2)
    note, how = align.head_match(head, 1, measures, by, [head])
    assert note["el"] is e1
    assert how == "cross-staff"


def test_small_heads_only_grace():
    e_grace, e_main = _El(), _El()
    r_grace = _row(e_grace, 0, 1, 0, "C", 5, grace=True)
    r_main = _row(e_main, 0, 1, 0, "C", 5, grace=False)
    by = align.xml_by_measure([r_grace, r_main])
    measures = [dict(page=1, system=0, x0=0, x1=10, mindex=0)]
    pos = align.expected_pos(r_grace)

    small_head = dict(x=5, system=0, staff=1, step=pos, small=True)
    note, how = align.head_match(small_head, 1, measures, by, [small_head])
    assert note["el"] is e_grace

    normal_head = dict(x=5, system=0, staff=1, step=pos)
    note2, how2 = align.head_match(normal_head, 1, measures, by, [normal_head])
    assert note2["el"] is e_main


def test_per_system_floor():
    raw = [_row(_El(), i, 1, 0, "C", 5) for i in range(10)]
    notes = align.xml_by_measure(raw)
    notes = [n for mi in range(10) for n in notes[(mi, 1)]]
    xml_notes_by_system = {0: notes}
    matched_ids = {id(notes[0]["el"]), id(notes[1]["el"])}  # 2 of 10: 20% < 50%
    numbers = list(range(1, 11))
    out = align.per_system_floor(xml_notes_by_system, matched_ids, numbers)
    assert len(out) == 1
    si, (first, last), matched, total = out[0]
    assert si == 0 and matched == 2 and total == 10


def test_per_system_floor_below_min_notes_ignored():
    raw = [_row(_El(), i, 1, 0, "C", 5) for i in range(5)]
    notes = align.xml_by_measure(raw)
    notes = [n for mi in range(5) for n in notes[(mi, 1)]]
    out = align.per_system_floor({0: notes}, set(), list(range(1, 6)))
    assert out == []


def test_staff_mapping_candidates_identity():
    assert align.staff_mapping_candidates(2, 2) == [{1: 1, 2: 2}]


def test_staff_mapping_candidates_hidden_staff():
    cands = align.staff_mapping_candidates(1, 2)
    assert cands == [{1: 1}, {1: 2}]


def test_staff_mapping_candidates_too_many_staves():
    assert align.staff_mapping_candidates(3, 2) == []
