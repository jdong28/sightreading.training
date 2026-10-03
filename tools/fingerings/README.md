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

## Known limits (build step 2's job)

Geometry is tuned on Rêverie and the synthetic fixture; the following are
refused with a clear error rather than mis-read, and are follow-up work:
a rotated page or a skewed image placement; a score with more than one
`<part>` or a part with more than two staves; a filter pikepdf can't
decode (JBIG2 without `jbig2dec`, for example). Not yet handled, and not
refused outright: repeats and voltas, multi-bar rests, 8va lines,
grace-note fingerings, cross-staff notes, one- or three-staff systems, a
part-per-hand score, and a fingering on a tie's continuation (never
applied, per the edition library's design).

## Development

```
uv sync
uv run pytest -q
```

Tests are offline and deterministic (`PYTHONHASHSEED` is fixed per test
where byte-identity matters) and use only the committed synthetic fixture
under `tests/fixture/` — a public-domain piece, generated with music21 and
engraved by MuseScore, with a drawn-on ink layer whose every answer is
known (`tests/fixture/ink.json`, `expected.json`). Never commit a real
scan, a teacher's PDF, or any other private input.

Golden files live under `tests/golden/`. If a test's output changed on
purpose, regenerate them:

```
uv run pytest -q --update-goldens
```

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
