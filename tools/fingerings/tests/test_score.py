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


def test_one_part_three_staves_allowed():
    """A single part may hold up to 3 staves (§7): a one-part, three-staff
    piano score geometry now supports fully."""
    xml = _score_xml("""
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><staff>3</staff></note>
    """, staves=3)
    root = score.load_text(xml)
    rows = score.note_table(root)
    assert {r["staff"] for r in rows} == {1, 2, 3}
    assert {r["part"] for r in rows} == {"P1"}


def test_two_staves_allowed():
    xml = _score_xml("""
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
    """, staves=2)
    root = score.load_text(xml)
    rows = score.note_table(root)
    assert {r["staff"] for r in rows} == {1, 2}


def test_multi_part_staves():
    """A voice part (1 staff) plus a piano part (2 staves) gives global
    staves 1, 2, 3, with `part`. Four staves in all are refused."""
    xml = f"""<?xml version="1.0"?>
{NS}
  <part id="voice">
    <measure number="1"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note></measure>
  </part>
  <part id="piano">
    <measure number="1">
      <attributes><divisions>4</divisions><staves>2</staves></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>"""
    root = score.load_text(xml)
    rows = score.note_table(root)
    by_pitch = {(r["step"], r["octave"]): r for r in rows}
    assert by_pitch[("C", 5)]["staff"] == 1 and by_pitch[("C", 5)]["part"] == "voice"
    assert by_pitch[("C", 4)]["staff"] == 2 and by_pitch[("C", 4)]["part"] == "piano"
    assert by_pitch[("C", 3)]["staff"] == 3 and by_pitch[("C", 3)]["part"] == "piano"

    xml4 = f"""<?xml version="1.0"?>
{NS}
  <part id="voice"><measure number="1"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note></measure></part>
  <part id="piano">
    <measure number="1">
      <attributes><divisions>4</divisions><staves>3</staves></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>"""
    root4 = score.load_text(xml4)
    with pytest.raises(ValueError, match="at most 3 staves"):
        score.note_table(root4)


def test_clef_by_onset():
    """Staff 1 voice 1 has quarter notes on beats 1-4 with a clef change to
    F before its beat-3 note; voice 2 (after <backup>) has a half note at
    beat 1. The voice-2 note keeps G; beats 3-4 of voice 1 get F."""
    xml = _score_xml("""
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>8</duration><voice>2</voice><staff>1</staff></note>
    """)
    root = score.load_text(xml)
    rows = score.note_table(root)
    by_pitch = {(r["step"], r["octave"]): r for r in rows}
    assert by_pitch[("C", 5)]["clef"] == ("G", 2)
    assert by_pitch[("D", 5)]["clef"] == ("G", 2)
    assert by_pitch[("E", 4)]["clef"] == ("F", 4)
    assert by_pitch[("F", 4)]["clef"] == ("F", 4)
    assert by_pitch[("G", 5)]["clef"] == ("G", 2)


def test_octave_shift_by_onset():
    def _xml(shift_type="down", size="8"):
        return f"""<?xml version="1.0"?>
{NS}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <direction><direction-type><octave-shift type="{shift_type}" size="{size}" number="1"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <direction><direction-type><octave-shift type="stop" size="{size}" number="1"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>"""
    xml = _xml()
    root = score.load_text(xml)
    rows = score.note_table(root)
    by_pitch = {(r["step"], r["octave"]): r for r in rows}
    assert by_pitch[("C", 5)]["octave_shift"] == 0
    assert by_pitch[("D", 5)]["octave_shift"] == 0
    assert by_pitch[("E", 5)]["octave_shift"] == -1
    assert by_pitch[("F", 5)]["octave_shift"] == -1
    assert by_pitch[("G", 5)]["octave_shift"] == 0

    root15 = score.load_text(_xml(size="15"))
    rows15 = score.note_table(root15)
    by_pitch15 = {(r["step"], r["octave"]): r for r in rows15}
    assert by_pitch15[("E", 5)]["octave_shift"] == -2

    rootup = score.load_text(_xml(shift_type="up"))
    rowsup = score.note_table(rootup)
    by_pitchup = {(r["step"], r["octave"]): r for r in rowsup}
    assert by_pitchup[("E", 5)]["octave_shift"] == 1


def test_hidden_notes_not_counted():
    xml = _score_xml("""
      <note print-object="no"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration></note>
    """)
    root = score.load_text(xml)
    rows = score.note_table(root)
    by_pitch = {(r["step"], r["octave"]): r for r in rows}
    assert by_pitch[("C", 5)]["printed"] is False
    assert by_pitch[("D", 5)]["printed"] is True


def test_multirest_spans():
    from lxml import etree
    els = []
    for i in range(1, 9):
        m = _el("measure", number=str(i))
        if i == 5:
            attrs = etree.SubElement(m, "attributes")
            ms = etree.SubElement(attrs, "measure-style")
            mr = etree.SubElement(ms, "multiple-rest")
            mr.text = "4"
        els.append(m)
    assert score.multirest_spans(els) == {4: 4}
