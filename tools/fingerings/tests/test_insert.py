"""Unit tests for insert.py: tiny inline MusicXML strings, MuseScore style
(one element per line)."""
import pytest

from fingerings import insert, score

HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n  <part id="P1">\n    <measure number="1">\n'
FOOTER = "    </measure>\n  </part>\n</score-partwise>\n"


def _doc(note_lines):
    return HEADER + note_lines + FOOTER


def _notes(text):
    root = score.load_text(text)
    return list(root.iter("note"))


PLAIN_NOTE = (
    "      <note>\n"
    "        <pitch>\n"
    "          <step>C</step>\n"
    "          <octave>4</octave>\n"
    "        </pitch>\n"
    "        <duration>4</duration>\n"
    "        <type>quarter</type>\n"
    "      </note>\n"
)


def test_new_notations_before_closing_note():
    text = _doc(PLAIN_NOTE)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    lines = new_text.split("\n")
    assert "<notations>" in lines[-4] or any("<notations>" in l for l in lines)
    assert new_text.index("<notations>") < new_text.index("</note>")
    assert "<fingering>3</fingering>" in new_text


def test_new_notations_before_lyric():
    note_src = (
        "      <note>\n"
        "        <pitch>\n"
        "          <step>C</step>\n"
        "          <octave>4</octave>\n"
        "        </pitch>\n"
        "        <duration>4</duration>\n"
        "        <type>quarter</type>\n"
        "        <lyric>\n"
        "          <text>la</text>\n"
        "        </lyric>\n"
        "      </note>\n"
    )
    text = _doc(note_src)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    assert new_text.index("<notations>") < new_text.index("<lyric>")


def test_reuses_notations_without_technical():
    note_src = (
        "      <note>\n"
        "        <pitch>\n"
        "          <step>C</step>\n"
        "          <octave>4</octave>\n"
        "        </pitch>\n"
        "        <duration>4</duration>\n"
        "        <type>quarter</type>\n"
        "        <notations>\n"
        "          <slur type=\"start\"/>\n"
        "        </notations>\n"
        "      </note>\n"
    )
    text = _doc(note_src)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    assert new_text.count("<notations>") == 1
    assert "<technical>" in new_text
    assert new_text.index("<slur") < new_text.index("<technical>")


def test_reuses_technical():
    note_src = (
        "      <note>\n"
        "        <pitch>\n"
        "          <step>C</step>\n"
        "          <octave>4</octave>\n"
        "        </pitch>\n"
        "        <duration>4</duration>\n"
        "        <type>quarter</type>\n"
        "        <notations>\n"
        "          <technical>\n"
        "            <up-bow/>\n"
        "          </technical>\n"
        "        </notations>\n"
        "      </note>\n"
    )
    text = _doc(note_src)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    assert new_text.count("<technical>") == 1
    assert new_text.count("<notations>") == 1
    assert "<up-bow/>" in new_text
    assert "<fingering>3</fingering>" in new_text


def test_same_leaves_text_unchanged():
    note_src = (
        "      <note>\n"
        "        <pitch>\n"
        "          <step>C</step>\n"
        "          <octave>4</octave>\n"
        "        </pitch>\n"
        "        <duration>4</duration>\n"
        "        <type>quarter</type>\n"
        "        <notations>\n"
        "          <technical>\n"
        "            <fingering>3</fingering>\n"
        "          </technical>\n"
        "        </notations>\n"
        "      </note>\n"
    )
    text = _doc(note_src)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["same"]
    assert new_text == text


def test_conflict_leaves_text_unchanged():
    note_src = (
        "      <note>\n"
        "        <pitch>\n"
        "          <step>C</step>\n"
        "          <octave>4</octave>\n"
        "        </pitch>\n"
        "        <duration>4</duration>\n"
        "        <type>quarter</type>\n"
        "        <notations>\n"
        "          <technical>\n"
        "            <fingering>2</fingering>\n"
        "          </technical>\n"
        "        </notations>\n"
        "      </note>\n"
    )
    text = _doc(note_src)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["conflict (has 2)"]
    assert new_text == text


def test_substitution_two_elements():
    text = _doc(PLAIN_NOTE)
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "2-3", "above")])
    assert results == ["added"]
    assert '<fingering placement="above">2</fingering>' in new_text
    assert '<fingering substitution="yes" placement="above">3</fingering>' in new_text


def test_crlf_source_preserved():
    text = _doc(PLAIN_NOTE).replace("\n", "\r\n")
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    # every original byte survives, as an exact subsequence of lines
    src_lines = text.split("\n")
    out_lines = new_text.split("\n")
    i = 0
    inserted = []
    for line in out_lines:
        if i < len(src_lines) and line == src_lines[i]:
            i += 1
        else:
            inserted.append(line)
    assert i == len(src_lines)
    assert inserted  # something was inserted
    for line in inserted:
        if line.strip():
            assert line.endswith("\r")


def test_note_past_line_65535():
    padding = "<!-- pad -->\n" * 70000
    text = HEADER + padding + PLAIN_NOTE + FOOTER
    note = _notes(text)[0]
    note_line = text[:text.index("<note>")].count("\n") + 1
    assert note_line > 65535
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    assert "<fingering>3</fingering>" in new_text
    # the fingering lands inside *this* note's block, not some other one
    note_block_start = new_text.index("<note>")
    note_block_end = new_text.index("</note>", note_block_start)
    assert note_block_start < new_text.index("<fingering>3</fingering>") < note_block_end


def test_single_line_note_raises():
    note_src = "      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>\n"
    text = _doc(note_src)
    note = _notes(text)[0]
    with pytest.raises(ValueError, match="not one element per line"):
        insert.splice(text, [(note, "3", None)])


def test_single_line_notations_raises():
    note_src = (
        "      <note>\n"
        "        <pitch>\n"
        "          <step>C</step>\n"
        "          <octave>4</octave>\n"
        "        </pitch>\n"
        "        <duration>4</duration>\n"
        "        <notations><technical><up-bow/></technical></notations>\n"
        "      </note>\n"
    )
    text = _doc(note_src)
    note = _notes(text)[0]
    with pytest.raises(ValueError, match="not one element per line"):
        insert.splice(text, [(note, "3", None)])


def test_indentation_follows_note_children():
    # 2-space indentation already covered by PLAIN_NOTE (used throughout);
    # check tab indentation is picked up instead of being hard-coded
    note_src = (
        "\t<note>\n"
        "\t\t<pitch>\n"
        "\t\t\t<step>C</step>\n"
        "\t\t\t<octave>4</octave>\n"
        "\t\t</pitch>\n"
        "\t\t<duration>4</duration>\n"
        "\t</note>\n"
    )
    text = HEADER + note_src + FOOTER
    note = _notes(text)[0]
    new_text, results = insert.splice(text, [(note, "3", None)])
    assert results == ["added"]
    assert "\t\t<notations>" in new_text
    assert "\t\t\t<technical>" in new_text
    assert "\t\t\t\t<fingering>3</fingering>" in new_text
