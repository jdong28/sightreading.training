# fingerings

Turns a marked-up PDF — handwritten fingerings over a piece's sheet music —
into the piece's MusicXML with `<fingering>` inserted, plus a fingering
layer, a report, and proof sheets for the instructor to check. Everything
is deterministic except reading the ink marks themselves, which is a
Claude Code worker's job in a session the owner runs: no API key is used
anywhere in this tool.

Instructors and students write their own fingerings here; this tool never
reads fingerings from a printed edition.

**Private inputs never go into this repo.** The repo is public. A run
directory — the PDF, the MusicXML, the reading tables, the output — always
lives outside `tools/fingerings/`, for example under a scratch folder or
alongside the edition library's own data. `.gitignore` here refuses `*.pdf`
outside `tests/fixture/`, as a safety net.

## The three stages

1. **Prepare** (script). Reads the PDF's markup ink and the print's staff
   geometry, checks the bar count against the MusicXML, matches noteheads,
   clusters the ink into marks, and writes numbered contact sheets.
2. **Read** (vision, manual). A contact sheet per page of marks; you (or a
   Claude Code worker) fill in one JSON reading per mark.
3. **Place and verify** (script). Attributes each reading to a note,
   splices `<fingering>` into the MusicXML as inserted lines only, verifies
   the result, and writes the report, the fingering layer, and proof
   sheets.

## Set up

```
cd tools/fingerings
uv sync
```

Python 3.12, a `uv` lockfile (`uv.lock`, committed). Dependencies: pikepdf
(image extraction), pypdfium2 (rendering a born-digital page), lxml,
numpy, scipy, Pillow, music21.

## A run directory

Outside the repo. `manifest.json` names the inputs and the run's settings;
every path in it is relative to the run directory, so the whole folder can
be moved.

```json
{"piece": "debussy-reverie", "pdf": "inputs/reverie.pdf", "musicxml": "inputs/reverie.musicxml",
 "pages": [1, 4], "read_pages": [1, 2]}
```

| Key | Required | What |
|---|---|---|
| `piece` | yes | An identifier for the piece, carried into `layer.json`. |
| `pdf` | yes | The marked-up PDF, relative to the run directory. |
| `musicxml` | yes | The piece's MusicXML (or `.mxl`), relative to the run directory. |
| `pages` | yes | `[first, last]`, the edition's pages in order, 1-indexed. A page outside the PDF is an error. |
| `read_pages` | no | Which of `pages` carry markup to read. Defaults to every page with ink. |
| `measures` | no | `[from, to]`, an app bar-number range, for a PDF that is only an excerpt of the piece. |
| `join_pt` | no | Default `1.0`. Strokes within this many points join one mark. |
| `render_scale` | no | Default `6` (px/pt). Only used to rasterise a born-digital page (one with no scan image). |
| `min_head_match` | no | Default `0.9`. The run stops if fewer than this share of a page's notes are matched to a detected notehead. |
| `xsd` | no | Path to a MusicXML 4.0 XSD, to check the output validates the same way the source does. Never commit one to this repo (see Development). |

Unknown keys are an error.

## Running a piece

```
uv run fingerings run <run dir>
```

Exit codes: `0` done, `2` waiting on readings, `1` a gate or check failed.
It prints each check's PASS/FAIL line and a summary.

Files in the run directory, after a run:

| File | What |
|---|---|
| `sheets/pN.json` | The page's clustered marks (box, centroid, pixel count) and a `sheet` fingerprint. |
| `sheets/pN-1.png`, `pN-2.png`, ... | Numbered contact sheets, the reading step's input (at most 20 marks each). |
| `sheets/pN-overview.png` | The whole page, every mark boxed and labelled, for context. |
| `readings/pN.template.json` | One empty entry per mark id; copy to `pN.json` and fill in. |
| `readings/pN.json` | Your readings. Required before stage 3 runs. |
| `out.musicxml` (or `.mxl`) | The source with `<fingering>` inserted, as inserted lines only. Only written when every check passes. |
| `layer.json` | This run's fingerings as the edition library's fingering layer. |
| `report.json` / `report.md` | Checks, page statistics, the per-bar table, items left for review, marks that aren't fingerings, and totals. `report.md` has no timing or absolute paths, so it's comparable run to run. |
| `proof/pN-1.png`, ... | Proof sheets: each item's mark and, for a placement, the notehead it was given, for the instructor to check. |

A run never leaves a stale `out.*`/`layer.json` from an earlier, successful
attempt lying around once the current one fails or is still waiting on
readings: it's deleted up front, so a run directory never shows an output
its latest `report.json` doesn't vouch for.

## The contact sheet

Each cell of a contact sheet (`sheets/pN-k.png`) is one mark: the scan
faded, the ink in red, the mark boxed in blue, labelled with its id
(`p1-07`). `sheets/pN-overview.png` shows the whole page with every box and
id, for marks that need more context (a chord stack, a margin note).

## The reading prompt

Paste this into a Claude Code session you run yourself (no API key, no
automation — you read the sheets and type the answers):

> Open `sheets/pN-overview.png`, then every `sheets/pN-k.png` for this
> page. Copy `readings/pN.template.json` to `readings/pN.json` and fill in
> every mark id with one of these kinds:
>
> - `finger`: a digit 1-5. `a/b` for digits stacked inside one box, top
>   first (a chord's fingering written as one mark). `a-b` for a
>   substitution written inside one box (`2-3`).
> - `other`: not a fingering digit at all. Give `mark`, a short
>   description (`"UC (una corda)"`, `"circle round a note"`).
> - `ambiguous`: give `why` — what makes it unclear.
> - `part`: this mark is part of another one (a substitution or a chord's
>   fingering drawn as separate boxes). Give `of`, the id of the box that
>   carries the whole reading (the first piece in reading order, reading
>   top to bottom or left to right).
>
> Separately boxed digits stacked one above another (a chord's fingering)
> are read one per box, each its own `finger` entry — they are not
> `part`s of each other; the pipeline groups them itself.
>
> Never decide which note a digit belongs to; that's the pipeline's job.
> Never guess — mark anything unclear as `ambiguous` with a reason.
>
> Set `reader` to your name (or "Claude Code") and today's date, then
> re-run `uv run fingerings run <run dir>`.

## The reading table

```json
{"page": 1, "sheet": "<copied from the template, unchanged>", "reader": "who/when",
 "marks": {
  "p1-01": {"kind": "finger", "text": "5"},
  "p1-03": {"kind": "other", "text": "C", "mark": "UC (una corda)"},
  "p1-30": {"kind": "finger", "text": "2-3"},
  "p1-31": {"kind": "part", "of": "p1-30"},
  "p1-32": {"kind": "part", "of": "p1-30"},
  "p1-39": {"kind": "ambiguous", "text": "5", "why": "marked 'try'"}
 }}
```

- `page` must equal the file's page and `sheet` must equal the sheet's
  current fingerprint — a stale `sheet` (the marks changed since this
  table was written, usually because `join_pt` or the PDF changed) is
  refused with "re-read".
- Every id on the sheet needs a reading, and an id not on the sheet is an
  error (the completeness gate).
- `finger` text: `^[1-5]$`, `^[1-5](/[1-5])+$` (a stack inside one box,
  top first), or `^[1-5](-[1-5])+$` (a substitution inside one box). A mix
  such as `2-3/4` is an error — mark it `ambiguous` instead.
- `ambiguous` needs a non-empty `why`.
- `part` needs `of`, naming another mark on the same page that is itself
  `finger`, `other` or `ambiguous` (never another `part`).
- Any key besides `kind`, `text`, `mark`, `why`, `of` is an error — this
  catches typos.

Every error names the offending mark id(s).

## What to flag as `ambiguous`

- A tentative digit ("try 4", a "?", "maybe").
- A crossed-out or overwritten digit.
- Alternatives in parentheses or joined with "or".
- A digit that could be either of two (a messy 3/5, or 1/7-like strokes).
- A digit joined to other writing, so the box mixes a digit with prose.
- Anything outside 1-5.

## What's `other` (not a fingering)

Pedal marks and words (UC, TC, Ped., rit.); chord names (Dm, C# aug);
circles, brackets, slurs, arrows, lines; breath and comma marks; dynamics;
counting numbers ("1 + 2 +"); bar numbers; metronome marks.

## Running a batch

```
uv run fingerings batch <batch dir>
```

Runs every immediate subdirectory of `<batch dir>` that has a
`manifest.json`, sorted by name. Writes `<batch dir>/summary.json` and
`summary.md`: one row per piece, with pages, marks, digits read, placed,
left for review (by reason), status (`done` / `needs reading: ...` /
`failed: ...`), and seconds. A run still waiting on its readings isn't a
batch failure; exit code is 1 only if some run actually failed.

## The instructor's proof-sheet review

Each `proof/pN-k.png` cell is one item: the mark boxed in blue and, for a
placement, the notehead it was given ringed in green, labelled
`m.12 RH D5 <- 3` with a second line naming the mark, the beat, above or
below, and `REVIEW` when the match was close. Items are ordered left for
review first (with the reason), then placements the pipeline flagged for a
closer look, then every other placement, then marks that turned out not to
be fingerings (so a digit misread as "other" is caught). The `#i` numbers
are shared with `report.md`'s per-bar table, so you can look a placement
up either way.

To correct something:

- **A misread digit** (or a digit wrongly marked `other`/`ambiguous`): fix
  it in `readings/pN.json` and re-run.
- **The right digit on the wrong note, or a review item you've settled
  by ear:** fix it by hand in MuseScore once you've imported `out.musicxml`
  (below) — this tool doesn't carry a second, instructor-facing edit file;
  if hand fixes turn out to be painful in practice, a write-back step can
  follow later.

Once `report.md` is clean (every check PASS, nothing left to decide):
import `out.musicxml` (or `out.mxl`) into the app with *Import MusicXML*.
Importing under the piece's existing title replaces the piece in place —
the same id, stats and schedule — and keeps `layer.json` alongside the
edition's master so it can be re-applied later.

## `apply-layer`

```
uv run fingerings apply-layer layer.json in.musicxml out.musicxml
```

Applies a fingering layer (matching entries by bar, staff, beat and pitch,
and `voice` when given) as inserted lines, the same way `run` does, and
runs the same verification checks on the result. Strict: if any entry
matches no note, more than one note, or collides with another entry on the
same note, it writes nothing and exits 1. Prints
`{"applied", "same", "conflicts", "unmatched"}`.

## Checking a piece's geometry

```
uv run fingerings geometry <run dir> [--overlays]
```

Runs steps 1-4 (ink/scan extraction, staves and bar lines, noteheads and
clefs, the head-match check) on every page the manifest names, ink or
not, and applies the head-match gate to every page — it needs no
fingerings, since the head-match rate checks itself. Lets an owner check
that an edition's geometry works with the tool before an instructor
writes on it. Writes into the run directory:

| File | What |
|---|---|
| `geometry.json` / `geometry.md` | Checks, and per page: scan kind, size, skew, threshold, bar range, staff space, systems (staff count and bar count), heads found/matched and the rate, and print clef shifts; a stopped page names why. |
| `geometry/pN.png` | With `--overlays`: staff lines, system boxes, bar lines, and heads boxed matched (green) or unmatched (red), for diagnosis. |

Exit codes: `0` every gate passes, `1` otherwise.

## Known limits (build step 2's job)

Refused with a clear error rather than mis-read, and are follow-up work:
a rotated page or a skewed image placement (deskew handles a skewed scan
*inside* an upright image only); a score with more than 3 staves in all;
a filter pikepdf can't decode (JBIG2 without `jbig2dec`, for example;
real IMSLP-style scans are mostly JBIG2, so a render fallback for it, like
the one a stacked-image/mixed-raster PDF already needs, is a natural
follow-up); a scan below about 300 dpi (the resolution floor is measured
and recorded per page in `geometry.json`; swept against a real passing
scan downsampled to 20/18/16/14/12/10px staff spaces, every page at or
above the 16px floor still runs — head match holds in the high 80s/low
90s%, with some resampling-dependent noise rather than a smooth decline
— and every page below it stops cleanly with the floor's own message
rather than running anyway; see the PR for the full table). The
geometry/head-match
pipeline (`fingerings geometry`, and `run`'s own gates) fully supports a
voice-plus-piano or other multi-part score and a one-part score of up to
3 staves; *placing* fingerings (`run`'s stage 3) is still the two-hand
model only (one part, at most 2 staves) and stops cleanly, after the
geometry gates, on a score outside it. Not yet handled, and not refused
outright: a printed multirest the MusicXML doesn't mark; a print clef
that changes mid-bar where the transcription's doesn't, beyond what the
per-bar print-clef-shift search already explains; grace-note fingerings
in the reading/placement step (geometry detects and matches grace heads,
but placement still targets only a non-grace note); a part-per-hand
score; and a fingering on a tie's continuation (never applied, per the
edition library's design). The ink/mark-clustering pipeline (contact
sheets, readings, proof sheets) reads a page's original, un-deskewed
raster: the geometry/head-match pipeline runs on the corrected grid, but
reading handwritten marks on a skewed real scan needs that pipeline
corrected too, which is follow-up work for whenever a real scan actually
carries handwritten markup to read.

Every corpus system/bar count is now correct (the dense-passage
miscounts a prior pass of this work left open — the MuseScore Maple Leaf
Rag's trio, and the real 1899 LoC scan's own three pages — are root-caused
and fixed below); the three LoC pages still fail only the head-match
gate, by under a point each. Measured gaps the corpus run (below) still
shows, not yet closed:
- The real 1899 LoC scan's three pages (89.3%, 89.2%, 89.8% head match;
  every bar/system count on all three is correct) stay just under the
  90% floor. The shortfall is a handful of notes per page (3, 5 and 1
  respectively) whose detected centre lands within about half a staff
  space of the integer position the gate needs exactly, which 125-year-
  old letterpress and a 380dpi scan explain well enough on their own:
  the deltas are centred on zero with no systematic bias (confirmed by
  comparing every matched head's measured position against its
  MusicXML-expected one), so nudging the match tolerance to close the
  gap would be fitting noise, not fixing a bug. See the PR's per-page
  table and known-gaps section for the investigation.
- Genuine engraved cross-staff notation (a print that deliberately shows
  a note in the other staff's clef position, as a "r.h./l.h." edited
  passage does) has no synthetic corpus coverage: synthesising it needs
  MusicXML surgery past what music21 exposes. The committed synthetic
  cross-staff fixtures (now passing at 100%, after this pass's chord-
  geometry fixes) instead exercise heads.place's extreme-ledger
  staff-proximity assignment, a related but different case.

## Development

```
uv sync
uv run pytest -q
```

Tests are offline and deterministic (`PYTHONHASHSEED` is fixed per test
where byte-identity matters) and use only committed fixtures: the main
synthetic one under `tests/fixture/` — a public-domain piece, generated
with music21 and engraved by MuseScore, with a drawn-on ink layer whose
every answer is known (`tests/fixture/ink.json`, `expected.json`) — and
`tests/fixture/geometry/`'s small, hand-encoded crops for
`test_geometry.py` (`make_geometry_fixtures.py` documents how each was
cropped, including the one real public-domain scan crop among them).
Never commit a real scan, a teacher's PDF, or any other private input —
the LoC scan crop is small, licensed public domain, and square with
`corpus.json`'s own recorded provenance for that source.

Golden files live under `tests/golden/`. If a test's output changed on
purpose, regenerate them:

```
uv run pytest -q --update-goldens
```

### Corpus

`corpus/` is a wider, local-only check of the geometry/head-match
pipeline across more engravings than the committed fixture covers:
public-domain scans, MuseScore renders of public-domain and CC0
MusicXML, and synthetic scores. `corpus/corpus.json` names each piece;
`corpus/files/` (gitignored, never committed) holds what gets fetched or
built there. Needs network access, MuseScore 4's command line, and the
`music21` dependency's own corpus install; never run in CI.

```
MSCORE="/Applications/MuseScore 4.app/Contents/MacOS/mscore" uv run python corpus/fetch.py
uv run python corpus/run_corpus.py --label after
uv run python corpus/run_corpus.py --compare before after   # a saved earlier --label
```

`fetch.py` downloads each scan's page image (verifying its sha256) and
wraps it into a PDF without re-encoding; copies each MuseScore piece's
MusicXML from the installed `music21` package (local use only, per its
`corpus/license.txt` — never committed, and `corpus/files/` stays
gitignored); and renders both the MuseScore and the synthetic
(`corpus/synth.py`) pieces, keeping MuseScore's own re-export as that
piece's MusicXML and layout truth. `run_corpus.py` runs `fingerings
geometry` on every piece, grades each page's detected systems against
truth (a scan's hand-counted `systems` in corpus.json, or a MuseScore
re-export's own `<print new-system/new-page>` breaks), and writes
`corpus/files/results/<label>.{json,md}`.
`resolution_sweep.py [piece-id] [--spaces 16 14 12 10]` downsamples one
corpus scan to a series of target staff spaces and runs geometry (and,
at every resolution that doesn't stop, the real head-match gate) at
each, to check the resolution floor against a real scan rather than
just the unit test.

Rebuilding the fixture itself (`tests/fixture/score.musicxml`,
`fixture.pdf`, `fixture-vector.pdf`, `readings/*.json`) needs MuseScore 4's
command line and isn't run in CI:

```
MSCORE="/Applications/MuseScore 4.app/Contents/MacOS/mscore" uv run python tests/fixture/make_fixture.py
```

To check the output against a MusicXML 4.0 schema, fetch it yourself
(`w3c/musicxml`, tag `v4.0`) and make its `xlink.xsd`/`xml.xsd` imports
local; pass its path as the manifest's `xsd`. Never commit the XSD here.

### Licences

No AGPL dependency. pikepdf is MPL-2.0; pypdfium2 (PDFium) is BSD-3/
Apache-2.0; lxml, numpy, scipy, Pillow and music21 are BSD-style.
