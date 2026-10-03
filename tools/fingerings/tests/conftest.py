"""Session fixtures: a run directory built from the committed synthetic
fixture (tests/fixture/), a CLI subprocess runner (subprocess, so
PYTHONHASHSEED can be controlled for the byte-identity tests), and
--update-goldens."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent / "fixture"
GOLDEN_DIR = Path(__file__).parent / "golden"


def pytest_addoption(parser):
    parser.addoption("--update-goldens", action="store_true", default=False,
                      help="overwrite tests/golden/ with this run's output instead of comparing against it")


@pytest.fixture
def update_goldens(request):
    return request.config.getoption("--update-goldens")


def run_cli(args, cwd=None, env=None, pythonhashseed=None):
    """Run the fingerings CLI in a subprocess. Returns a
    subprocess.CompletedProcess (returncode, stdout, stderr)."""
    full_env = dict(os.environ)
    if env:
        full_env.update(env)
    if pythonhashseed is not None:
        full_env["PYTHONHASHSEED"] = str(pythonhashseed)
    return subprocess.run([sys.executable, "-m", "fingerings.cli", *args],
                           cwd=cwd, env=full_env, capture_output=True, text=True)


def make_run_dir(base_dir, pdf="fixture.pdf", musicxml="score.musicxml", readings=True,
                  manifest_overrides=None):
    """A run directory under base_dir, with the committed fixture's PDF and
    MusicXML copied in under inputs/, and (unless readings=False) the
    committed readings/ copied in too, ready to run."""
    run_dir = Path(base_dir)
    (run_dir / "inputs").mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURE_DIR / pdf, run_dir / "inputs" / pdf)
    shutil.copy(FIXTURE_DIR / musicxml, run_dir / "inputs" / musicxml)
    if readings:
        (run_dir / "readings").mkdir(exist_ok=True)
        for p in (FIXTURE_DIR / "readings").glob("*.json"):
            shutil.copy(p, run_dir / "readings" / p.name)
    manifest = dict(piece="fixture", pdf=f"inputs/{pdf}", musicxml=f"inputs/{musicxml}", pages=[1, 2])
    if manifest_overrides:
        manifest.update(manifest_overrides)
    (run_dir / "manifest.json").write_text(json.dumps(manifest))
    return run_dir


@pytest.fixture
def fixture_run(tmp_path):
    """A fresh run directory, PDF/MusicXML/readings already in place."""
    return make_run_dir(tmp_path)


@pytest.fixture(scope="session")
def expected():
    return json.loads((FIXTURE_DIR / "expected.json").read_text())


def compare_or_update(path, actual_bytes, update):
    """path: a tests/golden/ file. update: the --update-goldens flag.
    Writes and passes when updating; otherwise asserts byte-identity."""
    if update:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(actual_bytes)
        return
    assert path.exists(), f"no golden file at {path} (run with --update-goldens to create it)"
    expected_bytes = path.read_bytes()
    assert actual_bytes == expected_bytes, f"{path} is not byte-identical to the run's output"
