"""Unit tests for readings.py: table validation, the completeness gate,
and the part-group merge."""
import pytest

from fingerings import readings


def _marks(ids_boxes):
    """ids_boxes: {id: (x0,y0,x1,y1,px)}."""
    out = []
    for mid, (x0, y0, x1, y1, px) in ids_boxes.items():
        out.append(dict(id=mid, x0=x0, y0=y0, x1=x1, y1=y1, cx=(x0 + x1) / 2, cy=(y0 + y1) / 2, px=px))
    return out


BASIC_BOXES = {"p1-01": (0, 0, 10, 10, 100), "p1-02": (20, 0, 30, 10, 100)}


def _table(marks_dict, page=1, sheet="abc", reader="me"):
    return dict(page=page, sheet=sheet, reader=reader, marks=marks_dict)


def test_valid_table_passes():
    table = _table({"p1-01": {"kind": "finger", "text": "3"}, "p1-02": {"kind": "other", "mark": "UC"}})
    readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01", "p1-02"])  # no raise


@pytest.mark.parametrize("text", ["6", "3a", "", "2-3/4"])
def test_bad_finger_text_errors(text):
    table = _table({"p1-01": {"kind": "finger", "text": text}})
    with pytest.raises(ValueError, match="p1-01"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_unknown_kind_errors():
    table = _table({"p1-01": {"kind": "circle", "text": "3"}})
    with pytest.raises(ValueError, match="p1-01"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_ambiguous_without_why_errors():
    table = _table({"p1-01": {"kind": "ambiguous", "text": "3"}})
    with pytest.raises(ValueError, match="why"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_ambiguous_with_why_passes():
    table = _table({"p1-01": {"kind": "ambiguous", "text": "3", "why": "tentative"}})
    readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


@pytest.mark.parametrize("of_value,reason", [
    (None, "p1-02"),       # missing
    ("p1-99", "p1-02"),    # self/unknown: names a mark that doesn't exist
])
def test_part_bad_of_errors(of_value, reason):
    marks = {"p1-01": {"kind": "finger", "text": "3"}, "p1-02": {"kind": "part"}}
    if of_value is not None:
        marks["p1-02"]["of"] = of_value
    table = _table(marks)
    with pytest.raises(ValueError, match="p1-02"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01", "p1-02"])


def test_part_of_self_errors():
    table = _table({"p1-01": {"kind": "part", "of": "p1-01"}})
    with pytest.raises(ValueError, match="p1-01"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_part_chained_of_errors():
    table = _table({
        "p1-01": {"kind": "finger", "text": "3"},
        "p1-02": {"kind": "part", "of": "p1-01"},
        "p1-03": {"kind": "part", "of": "p1-02"},  # chained: of a part
    })
    with pytest.raises(ValueError, match="p1-03"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01", "p1-02", "p1-03"])


def test_unknown_id_errors():
    table = _table({"p1-01": {"kind": "finger", "text": "3"}, "p1-99": {"kind": "finger", "text": "2"}})
    with pytest.raises(ValueError, match="p1-99"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_unknown_key_errors():
    table = _table({"p1-01": {"kind": "finger", "text": "3", "oops": True}})
    with pytest.raises(ValueError, match="oops"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_page_mismatch_errors():
    table = _table({"p1-01": {"kind": "finger", "text": "3"}}, page=2)
    with pytest.raises(ValueError, match="page"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01"])


def test_completeness_gate_lists_missing_ids():
    table = _table({"p1-01": {"kind": "finger", "text": "3"}})
    with pytest.raises(ValueError, match=r"p1-02.*p1-03|p1-03.*p1-02"):
        readings.validate(table, page=1, sheet="abc", mark_ids=["p1-01", "p1-02", "p1-03"])


def test_part_merge_union_box_weighted_centroid_and_id():
    marks = _marks({
        "p1-30": (100, 100, 120, 120, 100),
        "p1-31": (100, 60, 120, 98, 50),
        "p1-32": (100, 122, 120, 150, 150),
    })
    table = _table({
        "p1-30": {"kind": "finger", "text": "2-3"},
        "p1-31": {"kind": "part", "of": "p1-30"},
        "p1-32": {"kind": "part", "of": "p1-30"},
    })
    merged, merged_readings = readings.merge_parts(marks, table)
    assert len(merged) == 1
    m = merged[0]
    assert m["id"] == "p1-30+p1-31+p1-32"
    assert m["x0"] == 100 and m["x1"] == 120
    assert m["y0"] == 60 and m["y1"] == 150
    total_px = 100 + 50 + 150
    expected_cy = (110 * 100 + 79 * 50 + 136 * 150) / total_px
    assert abs(m["cy"] - expected_cy) < 1e-9
    assert m["px"] == total_px
    assert merged_readings["p1-30+p1-31+p1-32"]["text"] == "2-3"


def test_merge_leaves_non_grouped_marks_alone():
    marks = _marks(BASIC_BOXES)
    table = _table({"p1-01": {"kind": "finger", "text": "3"}, "p1-02": {"kind": "other", "mark": "UC"}})
    merged, merged_readings = readings.merge_parts(marks, table)
    ids = {m["id"] for m in merged}
    assert ids == {"p1-01", "p1-02"}
    assert merged_readings["p1-01"]["text"] == "3"
