"""`fingerings batch <dir>`: run every immediate subdirectory holding a
manifest.json, sorted by name, sequentially and in-process; write
summary.json/summary.md. Exits 1 if any run failed; a run still waiting on
its readings is not a failure."""
import json
import time
from pathlib import Path

from . import run as run_mod

EXIT_OK = 0
EXIT_FAILED = 1


def run_batch(batch_dir):
    batch = Path(batch_dir)
    run_dirs = sorted((p for p in batch.iterdir() if p.is_dir() and (p / "manifest.json").exists()),
                       key=lambda p: p.name)
    rows = []
    any_failed = False
    for run_dir in run_dirs:
        t0 = time.perf_counter()
        try:
            report, code = run_mod.run(run_dir)
        except Exception as e:  # noqa: BLE001
            rows.append(dict(piece=run_dir.name, pages=None, marks=None, digits_read=None, placed=None,
                              left_for_review={}, status=f"failed: {e}", seconds=round(time.perf_counter() - t0, 1)))
            any_failed = True
            continue
        if code == run_mod.EXIT_NEEDS_READING:
            missing = next((c["detail"] for c in report["checks"] if c["check"] == "readings present"), "")
            status = f"needs reading: {missing}"
        elif code == run_mod.EXIT_OK:
            status = "done"
        else:
            first_fail = next((c["check"] for c in report["checks"] if not c["ok"]), "check failed")
            status = f"failed: {first_fail}"
            any_failed = True
        left_for_review = {}
        for s in report.get("skipped", []):
            why = (s.get("why") or "unknown").split(":")[0].strip()
            left_for_review[why] = left_for_review.get(why, 0) + 1
        digits_read = sum((p.get("readings") or {}).get("finger", 0) for p in report.get("pages", []))
        rows.append(dict(piece=report.get("piece", run_dir.name), pages=len(report.get("pages", [])),
                          marks=sum(p.get("marks") or 0 for p in report.get("pages", [])),
                          digits_read=digits_read, placed=len(report.get("placements", [])),
                          left_for_review=left_for_review, status=status, seconds=report.get("seconds")))
    summary = dict(runs=rows)
    (batch / "summary.json").write_text(json.dumps(summary, indent=1, default=str) + "\n")
    (batch / "summary.md").write_text(_render(rows))
    return summary, (EXIT_FAILED if any_failed else EXIT_OK)


def _render(rows):
    lines = ["# Batch summary", "",
             "| Piece | Pages | Marks | Digits read | Placed | Left for review | Status | Seconds |",
             "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lfr = ", ".join(f"{k}: {v}" for k, v in sorted(r["left_for_review"].items())) if r["left_for_review"] else ""
        lines.append(f"| {r['piece']} | {r['pages']} | {r['marks']} | {r['digits_read']} | {r['placed']} | "
                      f"{lfr} | {r['status']} | {r['seconds']} |")
    return "\n".join(lines) + "\n"
