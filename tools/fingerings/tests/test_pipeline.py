"""End-to-end tests against the committed synthetic fixture
(tests/fixture/): the required tests from the plan's Tests section."""
import json
import shutil
import zipfile
from pathlib import Path

from conftest import FIXTURE_DIR, GOLDEN_DIR, compare_or_update, make_run_dir, run_cli

GOLDEN_FILES = ("out.musicxml", "layer.json", "report.md", "sheets/p1.json", "sheets/p2.json")


def _run(run_dir, seed=1):
    p = run_cli(["run", str(run_dir)], pythonhashseed=seed)
    return p


def test_golden(tmp_path, update_goldens):
    run_dir = make_run_dir(tmp_path)
    p = _run(run_dir, seed=1)
    assert p.returncode == 0, p.stdout + p.stderr
    for name in GOLDEN_FILES:
        compare_or_update(GOLDEN_DIR / name, (run_dir / name).read_bytes(), update_goldens)
    report = json.loads((run_dir / "report.json").read_text())
    report.pop("seconds", None)
    actual = (json.dumps(report, indent=1, sort_keys=False) + "\n").encode("utf-8")
    compare_or_update(GOLDEN_DIR / "report.json", actual, update_goldens)


def test_answer_key(fixture_run, expected):
    p = _run(fixture_run)
    assert p.returncode == 0, p.stdout + p.stderr
    report = json.loads((fixture_run / "report.json").read_text())

    got_placements = {(pl["measure"], pl["staff"], pl["onset"], pl["pitch"], pl["digits"], pl["placement"])
                       for pl in report["placements"]
                       if not any(s["mark"] == pl["mark"] and s.get("text") == pl["digits"] for s in report["skipped"])}
    want_placements = {(pl["measure"], pl["staff"], pl["onset"], pl["pitch"], pl["finger"], pl["placement"])
                        for pl in expected["placements"]}
    assert got_placements == want_placements

    for want in expected["skips"]:
        matches = [s for s in report["skipped"] if _page_of(s["mark"]) == want["page"] and s.get("text") == want["text"]
                   and (s.get("why") or "").startswith(want["reason_prefix"])]
        assert matches, f"no skip matching {want} in {report['skipped']}"
    assert len(report["skipped"]) == len(expected["skips"])
    assert len(report["other"]) == expected["other_count"]

    # no placement comes from an "other" or "ambiguous" mark
    other_and_ambiguous_marks = {o["mark"] for o in report["other"]} | \
        {s["mark"] for s in report["skipped"] if "tentative" in (s.get("why") or "")}
    assert not ({pl["mark"] for pl in report["placements"]} & other_and_ambiguous_marks)


def _page_of(mark_id):
    return int(mark_id[1:].split("-")[0])


def test_insertion_only(fixture_run):
    p = _run(fixture_run)
    assert p.returncode == 0, p.stdout + p.stderr
    src_lines = (fixture_run / "inputs" / "score.musicxml").read_text(encoding="utf-8").split("\n")
    out_lines = (fixture_run / "out.musicxml").read_text(encoding="utf-8").split("\n")
    i = 0
    extra = []
    for line in out_lines:
        if i < len(src_lines) and line == src_lines[i]:
            i += 1
        else:
            extra.append(line)
    assert i == len(src_lines), "the source isn't a subsequence of the output"
    import re
    allowed = re.compile(r'^(?:<notations>|</notations>|<technical>|</technical>'
                          r'|<fingering(?: substitution="yes")?(?: placement="(?:above|below)")?>[1-5]</fingering>)$')
    bad = [l for l in extra if not allowed.match(l.strip())]
    assert not bad, bad

    from fingerings import score
    src_rows = score.note_table(score.load(fixture_run / "inputs" / "score.musicxml"))
    out_rows = score.note_table(score.load(fixture_run / "out.musicxml"))
    from fingerings.verify import note_key
    assert [note_key(r) for r in src_rows] == [note_key(r) for r in out_rows]


def test_idempotent_same_dir(tmp_path):
    run_dir = make_run_dir(tmp_path)
    p1 = _run(run_dir, seed=1)
    assert p1.returncode == 0, p1.stdout + p1.stderr
    saved = {name: (run_dir / name).read_bytes() for name in GOLDEN_FILES}
    p2 = _run(run_dir, seed=2)
    assert p2.returncode == 0, p2.stdout + p2.stderr
    for name in GOLDEN_FILES:
        assert (run_dir / name).read_bytes() == saved[name], name


def test_idempotent_on_output(tmp_path):
    first = make_run_dir(tmp_path / "first")
    p1 = _run(first)
    assert p1.returncode == 0, p1.stdout + p1.stderr

    second = tmp_path / "second"
    second.mkdir()
    (second / "inputs").mkdir()
    shutil.copy(first / "inputs" / "fixture.pdf", second / "inputs" / "fixture.pdf")
    shutil.copy(first / "out.musicxml", second / "inputs" / "score.musicxml")
    shutil.copytree(first / "readings", second / "readings")
    manifest = json.loads((first / "manifest.json").read_text())
    (second / "manifest.json").write_text(json.dumps(manifest))

    p2 = _run(second)
    assert p2.returncode == 0, p2.stdout + p2.stderr
    assert (second / "out.musicxml").read_bytes() == (second / "inputs" / "score.musicxml").read_bytes()
    report = json.loads((second / "report.json").read_text())
    assert all(c["ok"] for c in report["checks"])
    assert report["inserted"] == {"same": len(report["placements"]) - sum(
        1 for pl in report["placements"] if any(s["mark"] == pl["mark"] and s.get("text") == pl["digits"]
                                                 for s in report["skipped"]))}


def test_idempotent_apply_layer(tmp_path):
    run_dir = make_run_dir(tmp_path)
    p = _run(run_dir)
    assert p.returncode == 0, p.stdout + p.stderr
    applied = tmp_path / "applied.musicxml"
    p2 = run_cli(["apply-layer", str(run_dir / "layer.json"), str(run_dir / "inputs" / "score.musicxml"), str(applied)])
    assert p2.returncode == 0, p2.stdout + p2.stderr
    assert applied.read_bytes() == (run_dir / "out.musicxml").read_bytes()

    applied2 = tmp_path / "applied2.musicxml"
    p3 = run_cli(["apply-layer", str(run_dir / "layer.json"), str(applied), str(applied2)])
    assert p3.returncode == 0, p3.stdout + p3.stderr
    assert applied2.read_bytes() == applied.read_bytes()


def test_bar_gate(tmp_path):
    text = (FIXTURE_DIR / "score.musicxml").read_text(encoding="utf-8")
    import re
    m = list(re.finditer(r'<measure implicit="no" number="16">.*?</measure>', text, re.S))[-1]
    cut = text[:m.start()] + text[m.end():]

    run_dir = make_run_dir(tmp_path)
    (run_dir / "inputs" / "score.musicxml").write_text(cut, encoding="utf-8")
    p = _run(run_dir)
    assert p.returncode == 1
    report = json.loads((run_dir / "report.json").read_text())
    gate = next(c for c in report["checks"] if c["check"].startswith("bar lines"))
    assert not gate["ok"]
    assert gate["detail"] == "16 on pages 1-2, 15 in the MusicXML"
    assert not (run_dir / "out.musicxml").exists()
    assert not (run_dir / "layer.json").exists()

    # a stale output from an earlier success is deleted
    good = make_run_dir(tmp_path / "good2")
    p_good = _run(good)
    assert p_good.returncode == 0
    shutil.copy(good / "out.musicxml", run_dir / "out.musicxml")
    shutil.copy(good / "layer.json", run_dir / "layer.json")
    p2 = _run(run_dir)
    assert p2.returncode == 1
    assert not (run_dir / "out.musicxml").exists()
    assert not (run_dir / "layer.json").exists()


def test_bar_gate_measures_offset(tmp_path):
    """The manifest's `measures` range can start after a nonzero app bar
    number (a PDF excerpt beginning partway through the piece, or here,
    just page 2 on its own): the bar-count gate must compare the measure
    elements actually covered, not the raw walked index, which carries
    the first one's offset."""
    run_dir = make_run_dir(tmp_path, manifest_overrides={"pages": [2, 2], "measures": [9, 16]})
    p = _run(run_dir)
    assert p.returncode == 0, p.stdout + p.stderr
    report = json.loads((run_dir / "report.json").read_text())
    gate = next(c for c in report["checks"] if c["check"].startswith("bar lines"))
    assert gate["ok"]
    assert gate["detail"] == "8 on pages 2-2, 8 in the MusicXML"


def test_missing_readings(tmp_path):
    run_dir = make_run_dir(tmp_path, readings=False)
    p = _run(run_dir)
    assert p.returncode == 2, p.stdout + p.stderr
    for pno in (1, 2):
        assert (run_dir / "sheets" / f"p{pno}-overview.png").exists()
        assert (run_dir / "sheets" / f"p{pno}.json").exists()
        assert list((run_dir / "sheets").glob(f"p{pno}-*.png"))
        assert (run_dir / "readings" / f"p{pno}.template.json").exists()
    assert not (run_dir / "out.musicxml").exists()
    report = json.loads((run_dir / "report.json").read_text())
    missing = next(c for c in report["checks"] if c["check"] == "readings present")
    assert "1" in missing["detail"] and "2" in missing["detail"]


def test_markup_gate(tmp_path):
    import pikepdf
    with pikepdf.open(FIXTURE_DIR / "fixture.pdf") as pdf:
        for page in pdf.pages:
            content = pikepdf.parse_content_stream(page.obj)
            kept = [instr for instr in content if str(instr.operator) != "Do" or str(instr.operands[0]) != "/Ink"]
            page.obj.Contents = pdf.make_stream(pikepdf.unparse_content_stream(kept))
        run_dir = make_run_dir(tmp_path, readings=False)
        pdf.save(run_dir / "inputs" / "fixture.pdf")
    p = _run(run_dir)
    assert p.returncode == 1, p.stdout + p.stderr
    report = json.loads((run_dir / "report.json").read_text())
    assert any("no markup ink" in c["detail"] and not c["ok"] for c in report["checks"])
    assert not (run_dir / "out.musicxml").exists()


def test_reading_errors(tmp_path):
    run_dir = make_run_dir(tmp_path, readings=False)
    p1 = _run(run_dir)
    assert p1.returncode == 2

    stale = json.loads((FIXTURE_DIR / "readings" / "p1.json").read_text())
    stale["sheet"] = "0" * 12
    (run_dir / "readings" / "p1.json").write_text(json.dumps(stale))
    (run_dir / "readings" / "p2.json").write_text((FIXTURE_DIR / "readings" / "p2.json").read_text())
    p2 = _run(run_dir)
    assert p2.returncode == 1
    report = json.loads((run_dir / "report.json").read_text())
    bad = next(c for c in report["checks"] if c["check"] == "p1: readings are valid")
    assert not bad["ok"] and "re-read" in bad["detail"]
    assert not (run_dir / "out.musicxml").exists()

    missing_id = json.loads((FIXTURE_DIR / "readings" / "p1.json").read_text())
    first_id = next(iter(missing_id["marks"]))
    del missing_id["marks"][first_id]
    (run_dir / "readings" / "p1.json").write_text(json.dumps(missing_id))
    p3 = _run(run_dir)
    assert p3.returncode == 1
    report3 = json.loads((run_dir / "report.json").read_text())
    bad3 = next(c for c in report3["checks"] if c["check"] == "p1: readings are valid")
    assert first_id in bad3["detail"]
    assert not (run_dir / "out.musicxml").exists()


def test_mxl(tmp_path):
    run_dir = make_run_dir(tmp_path)
    mxl_path = run_dir / "inputs" / "score.mxl"
    with zipfile.ZipFile(mxl_path, "w") as z:
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
                   '<rootfile full-path="score.musicxml"/></rootfiles></container>')
        with open(run_dir / "inputs" / "score.musicxml", encoding="utf-8", newline="") as f:
            z.writestr("score.musicxml", f.read())
    manifest = json.loads((run_dir / "manifest.json").read_text())
    manifest["musicxml"] = "inputs/score.mxl"
    (run_dir / "manifest.json").write_text(json.dumps(manifest))

    p = _run(run_dir)
    assert p.returncode == 0, p.stdout + p.stderr
    with zipfile.ZipFile(run_dir / "out.mxl") as z:
        names = z.namelist()
        out_text = z.read("score.musicxml").decode("utf-8")
        container = z.read("META-INF/container.xml")
    assert set(names) == {"META-INF/container.xml", "score.musicxml"}
    with zipfile.ZipFile(mxl_path) as src:
        assert container == src.read("META-INF/container.xml")

    plain_run = make_run_dir(tmp_path / "plain")
    p_plain = _run(plain_run)
    assert p_plain.returncode == 0
    assert out_text == plain_run.joinpath("out.musicxml").read_text(encoding="utf-8")


def test_born_digital(tmp_path):
    run_dir = make_run_dir(tmp_path, pdf="fixture-vector.pdf", readings=False,
                            manifest_overrides={"render_scale": 300 / 72})
    p1 = _run(run_dir)
    assert p1.returncode == 2, p1.stdout + p1.stderr
    for pno in (1, 2):
        sheet = json.loads((run_dir / "sheets" / f"p{pno}.json").read_text())["sheet"]
        reading = json.loads((FIXTURE_DIR / "readings" / f"p{pno}.json").read_text())
        reading["sheet"] = sheet
        (run_dir / "readings" / f"p{pno}.json").write_text(json.dumps(reading))

    p2 = _run(run_dir)
    assert p2.returncode == 0, p2.stdout + p2.stderr
    report = json.loads((run_dir / "report.json").read_text())
    expected = json.loads((FIXTURE_DIR / "expected.json").read_text())
    got = {(pl["measure"], pl["staff"], pl["onset"], pl["pitch"], pl["digits"], pl["placement"])
           for pl in report["placements"]
           if not any(s["mark"] == pl["mark"] and s.get("text") == pl["digits"] for s in report["skipped"])}
    want = {(pl["measure"], pl["staff"], pl["onset"], pl["pitch"], pl["finger"], pl["placement"])
            for pl in expected["placements"]}
    assert got == want


def test_batch(tmp_path):
    batch_dir = tmp_path / "batch"
    batch_dir.mkdir()
    done = make_run_dir(batch_dir / "a-done")
    needs_reading = make_run_dir(batch_dir / "b-needs-reading", readings=False)
    cut_text = (FIXTURE_DIR / "score.musicxml").read_text(encoding="utf-8")
    import re
    m = list(re.finditer(r'<measure implicit="no" number="16">.*?</measure>', cut_text, re.S))[-1]
    cut_text = cut_text[:m.start()] + cut_text[m.end():]
    failed = make_run_dir(batch_dir / "c-failed")
    (failed / "inputs" / "score.musicxml").write_text(cut_text, encoding="utf-8")

    p = run_cli(["batch", str(batch_dir)], pythonhashseed=1)
    assert p.returncode == 1, p.stdout + p.stderr
    assert (done / "out.musicxml").exists()
    assert not (needs_reading / "out.musicxml").exists()
    assert not (failed / "out.musicxml").exists()

    summary = json.loads((batch_dir / "summary.json").read_text())
    assert len(summary["runs"]) == 3
    # batch sorts run directories by name: a-done, b-needs-reading, c-failed
    statuses = [r["status"] for r in summary["runs"]]
    assert statuses[0] == "done"
    assert statuses[1].startswith("needs reading")
    assert statuses[2].startswith("failed")

    md = (batch_dir / "summary.md").read_text()
    assert "Batch summary" in md


PERMISSIVE_XSD = """<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="score-partwise">
    <xs:complexType>
      <xs:sequence>
        <xs:any processContents="skip" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
      <xs:anyAttribute processContents="skip"/>
    </xs:complexType>
  </xs:element>
</xs:schema>
"""


def test_schema(tmp_path):
    run_dir = make_run_dir(tmp_path)
    xsd_path = run_dir / "permissive.xsd"
    xsd_path.write_text(PERMISSIVE_XSD)
    manifest = json.loads((run_dir / "manifest.json").read_text())
    manifest["xsd"] = "permissive.xsd"
    (run_dir / "manifest.json").write_text(json.dumps(manifest))

    p = _run(run_dir)
    assert p.returncode == 0, p.stdout + p.stderr
    report = json.loads((run_dir / "report.json").read_text())
    check = next(c for c in report["checks"] if c["check"].startswith("MusicXML 4.0 schema"))
    assert check["ok"] and "skipped" not in check["detail"]

    no_xsd_run = make_run_dir(tmp_path / "no_xsd")
    p2 = _run(no_xsd_run)
    assert p2.returncode == 0
    report2 = json.loads((no_xsd_run / "report.json").read_text())
    check2 = next(c for c in report2["checks"] if c["check"].startswith("MusicXML 4.0 schema"))
    assert check2["ok"] and "skipped" in check2["detail"]
