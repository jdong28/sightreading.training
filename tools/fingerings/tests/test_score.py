"""Unit tests for score.py: app_numbers, note_table onsets/beats, name(),
and the one-part/<=2-staff guard."""
from fractions import Fraction

import pytest

from fingerings import score

NS = "<score-partwise version=\"4.0\">"


def _el(tag, **attrs):
    from lxml import etree
    e = etree.Element(tag)
    for k, v in attrs.items():
        e.set(k.replace("_", "-"), v)
    return e


def test_app_numbers_plain():
    els = [_el("measure", number=str(i)) for i in range(1, 6)]
    assert score.app_numbers(els) == [1, 2, 3, 4, 5]


def test_app_numbers_first_implicit_yes():
    els = [_el("measure", number="0", implicit="yes")] + [_el("measure", number=str(i)) for i in range(1, 4)]
    assert score.app_numbers(els) == [0, 1, 2, 3]


def test_app_numbers_first_number_zero_without_implicit_attr():
    els = [_el("measure", number="0")] + [_el("measure", number=str(i)) for i in range(1, 4)]
    assert score.app_numbers(els) == [0, 1, 2, 3]


def test_app_numbers_mid_piece_implicit_split_repeats():
    els = [_el("measure", number="1"), _el("measure", number="2"),
           _el("measure", number="2", implicit="yes"), _el("measure", number="3")]
    assert score.app_numbers(els) == [1, 2, 2, 3]


NOTE_NAMES = {
    ("B", -1, 3): "Bb3",
    ("C", 1, 6): "C#6",
    ("F", 2, 4): "Fx4",
    ("E", -2, 2): "Ebb2",
}


@pytest.mark.parametrize("key,want", list(NOTE_NAMES.items()))
def test_name(key, want):
    step, alter, octave = key
    assert score.name(step, alter, octave) == want


def _score_xml(measures_xml, staves=1):
    staves_el = f"<staves>{staves}</staves>" if staves > 1 else ""
    second_clef = '<clef number="2"><sign>F</sign><line>4</line></clef>' if staves > 1 else ""
    return f"""<?xml version="1.0"?>
{NS}
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        {staves_el}
        <clef number="1"><sign>G</sign><line>2</line></clef>
        {second_clef}
      </attributes>
      {measures_xml}
    </measure>
  </part>
</score-partwise>"""


def test_onsets_backup_forward_chord_grace():
    xml = _score_xml("""
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <backup><duration>8</duration></backup>
      <forward><duration>4</duration></forward>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice></note>
      <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice></note>
    """)
    root = score.load_text(xml)
    rows = score.note_table(root)
    by_pitch = {(r["step"], r["octave"]): r for r in rows}
    assert by_pitch[("C", 4)]["onset"] == Fraction(0)
    assert by_pitch[("D", 4)]["onset"] == Fraction(1)  # grace: at the position it precedes
    assert by_pitch[("D", 4)]["grace"] is True
    assert by_pitch[("E", 4)]["onset"] == Fraction(1)
    assert by_pitch[("G", 4)]["onset"] == Fraction(1)  # after backup 8 then forward 4 = pos 1
    assert by_pitch[("B", 4)]["onset"] == Fraction(1)  # chord: same onset as G4
    assert by_pitch[("B", 4)]["chord"] is True


def test_beat_continues_across_split_bar():
    xml = f"""<?xml version="1.0"?>
{NS}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration></note>
    </measure>
    <measure number="2" implicit="yes">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>"""
    root = score.load_text(xml)
    rows = score.note_table(root)
    c4, d4 = rows[0], rows[1]
    assert c4["measure"] == 1 and d4["measure"] == 1  # the implicit split shares bar 1
    assert c4["onset"] == Fraction(0) and c4["beat"] == Fraction(0)
    assert d4["onset"] == Fraction(0)  # its own measure element resets onset
    assert d4["beat"] == Fraction(2)  # but beat continues: bar 1's first half was 2 quarter notes


def test_two_part_guard():
    xml = f"""<?xml version="1.0"?>
{NS}
  <part id="P1">
    <measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>
  </part>
  <part id="P2">
    <measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>
  </part>
</score-partwise>"""
    root = score.load_text(xml)
    with pytest.raises(ValueError, match="one part"):
        score.note_table(root)


def test_three_staff_guard():
    xml = _score_xml("""
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><staff>3</staff></note>
    """, staves=3)
    root = score.load_text(xml)
    with pytest.raises(ValueError, match="one part"):
        score.note_table(root)


def test_two_staves_allowed():
    xml = _score_xml("""
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
    """, staves=2)
    root = score.load_text(xml)
    rows = score.note_table(root)
    assert {r["staff"] for r in rows} == {1, 2}
