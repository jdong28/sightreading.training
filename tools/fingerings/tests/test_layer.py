"""Unit tests for layer.py: build() and apply_to_text()."""
from fractions import Fraction

from fingerings import layer, score

HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n  <part id="P1">\n    <measure number="1">\n'
FOOTER = "    </measure>\n  </part>\n</score-partwise>\n"


def _note(step, octave, voice=None, dur=4, extra=""):
    voice_xml = f"      <voice>{voice}</voice>\n" if voice else ""
    return (
        "      <note>\n"
        "        <pitch>\n"
        f"          <step>{step}</step>\n"
        f"          <octave>{octave}</octave>\n"
        "        </pitch>\n"
        f"        <duration>{dur}</duration>\n"
        f"{voice_xml}"
        f"{extra}"
        "      </note>\n"
    )


def _doc(notes):
    return HEADER + "".join(notes) + FOOTER


def test_substitution_is_one_entry():
    text = _doc([_note("C", 4)])
    root = score.load_text(text)
    rows = score.note_table(root)
    row = rows[0]
    kept = [dict(measure=row["measure"], staff=row["staff"], beat=row["beat"], pitch="C4",
                 digits="2-3", placement="above", mark="p1-01", voice=row["voice"])]
    lay = layer.build("piece", "sha1", {}, "extractor", rows, kept)
    assert len(lay["entries"]) == 1
    assert lay["entries"][0]["finger"] == "2-3"


def test_voice_only_for_a_unison():
    # two notes, same measure/staff/beat/pitch, different voices: a unison
    text = _doc([_note("C", 4, voice="1"), "      <backup><duration>4</duration></backup>\n", _note("C", 4, voice="2")])
    root = score.load_text(text)
    rows = score.note_table(root)
    kept = [dict(measure=rows[0]["measure"], staff=rows[0]["staff"], beat=rows[0]["beat"], pitch="C4",
                 digits="3", placement=None, mark="p1-01", voice=rows[0]["voice"])]
    lay = layer.build("piece", "sha1", {}, "extractor", rows, kept)
    assert lay["entries"][0]["voice"] == "1"

    # a lone note (no unison partner) gets no voice key
    text2 = _doc([_note("D", 4, voice="1")])
    root2 = score.load_text(text2)
    rows2 = score.note_table(root2)
    kept2 = [dict(measure=rows2[0]["measure"], staff=rows2[0]["staff"], beat=rows2[0]["beat"], pitch="D4",
                  digits="3", placement=None, mark="p1-02", voice=rows2[0]["voice"])]
    lay2 = layer.build("piece", "sha1", {}, "extractor", rows2, kept2)
    assert "voice" not in lay2["entries"][0]


def test_appendix_c_shaped_layer_applies():
    text = _doc([_note("C", 4), _note("D", 4)])
    root = score.load_text(text)
    lay = dict(entries=[dict(measure=1, staff=1, beat=0.0, pitch="C4", finger="3", placement="above", mark="x")])
    result = layer.apply_to_text(lay, text, root)
    assert result["ok"]
    assert result["applied"] == 1
    assert "<fingering placement=\"above\">3</fingering>" in result["text"]


def test_wrong_pitch_unmatched_writes_nothing():
    text = _doc([_note("C", 4)])
    root = score.load_text(text)
    lay = dict(entries=[dict(measure=1, staff=1, beat=0.0, pitch="D4", finger="3", placement=None, mark="x")])
    result = layer.apply_to_text(lay, text, root)
    assert not result["ok"]
    assert result["text"] is None
    assert len(result["unmatched"]) == 1


def test_two_entries_on_one_note_is_a_conflict():
    text = _doc([_note("C", 4)])
    root = score.load_text(text)
    lay = dict(entries=[
        dict(measure=1, staff=1, beat=0.0, pitch="C4", finger="3", placement=None, mark="x"),
        dict(measure=1, staff=1, beat=0.0, pitch="C4", finger="4", placement=None, mark="y"),
    ])
    result = layer.apply_to_text(lay, text, root)
    assert not result["ok"]
    assert result["text"] is None
    assert result["conflicts"]
