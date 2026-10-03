# Sight Reading Trainer

## <https://sightreading.training>

[![test](https://github.com/jdong28/sightreading.training/actions/workflows/test.yml/badge.svg)](https://github.com/jdong28/sightreading.training/actions/workflows/test.yml)

[![Twitch Link](http://leafo.net/dump/twitch-banner.svg)](https://www.twitch.tv/moonscript)

A tool for practicing sight reading, learning songs, and training other musical skills in your browser. The successor to <https://github.com/leafo/mursic>, originally created by [leafo](https://github.com/leafo). Learn more on [the guide](https://sightreading.training/about).

![screenshot](http://leafo.net/shotsnb/2016-05-14_16-30-55.png)

This is a fork of [leafo/sightreading.training](https://github.com/leafo/sightreading.training) that adds a sheet-music practice mode with real MusicXML import, a spaced-repetition practice scheduler, and a redesigned front end. See [What this fork adds](#what-this-fork-adds-over-upstream) below for the full list.

## Requirements

- Node.js 20+ (CI runs Node 22; developed and verified here on Node 24). `npm` comes with it.
- A MIDI keyboard/controller for the actual practice (optional for just browsing the UI) via Web MIDI. Sheet-music practice can also be played on an acoustic piano: pick *Acoustic piano* as the instrument in the device setup and grade each card yourself instead, with no MIDI at all (see [`static/guides/generators.md`](static/guides/generators.md)).
- The full backend (Lua/[Lapis](https://leafo.net/lapis/), PostgreSQL, the [tup](https://gittup.org/tup/) build) is only needed for the legacy backend stats page; everything else, including this fork's sheet-music practice and spaced repetition, runs entirely in the browser.

## Install

```bash
npm install
```

## Run it locally

The frontend is a React app that runs standalone, without the Lua/PostgreSQL backend:

```bash
npm run dev
```

Then open <http://localhost:3000/> (set `PORT` to serve on another port, e.g. `PORT=3001 npm run dev`). The dev server bundles with esbuild, watches for changes, and reloads the page automatically. Backend-only features (the legacy stats page) will not function in this mode; everything else works, including MIDI input and output, sheet-music import, and practice history (kept locally in the browser's IndexedDB).

Stop it with `Ctrl+C` in the terminal running `npm run dev`.

Verified locally: Node v24.13.1 / npm 11.8.0, fresh `npm install` (~6s), `PORT=3417 npm run dev`, and `curl http://localhost:3417/` returned `200 OK` with the expected page title before the server was stopped.

## Tests and lint

```bash
npm test        # headless Jasmine specs (static/js/specs.js) via puppeteer
make lint_js     # eslint over static/js
```

Both are run in CI (`.github/workflows/test.yml`) alongside the existing Lua/Docker test job. `npm test` builds and runs the frontend specs headlessly and exits non-zero on any failure; the run prints the spec count. `npm run build_assets` produces the production JS bundle that CI also builds before testing.

## Importing sheet music

Import a MusicXML file (`.xml` or compressed `.mxl`) with *Import MusicXML* to practice it as sheet music, with your progress tracked per measure.

The app reads MusicXML, not PDFs: no tool tried could turn a PDF into notes accurately enough to practise uncorrected. Picking a PDF in *Import MusicXML* shows this route instead:

1. Search first for a MusicXML version of the piece. If there is none, convert the PDF with [Audiveris](https://audiveris.github.io/audiveris/) (free, local; best for digitally engraved PDFs), or try [homr](https://github.com/liebharc/homr) or [Soundslice](https://www.soundslice.com/sheet-music-scanner/) for old scans.
2. Open the result in [MuseScore Studio](https://musescore.org/en/download) and fix the wrong bars: the bar count, parts and clefs first, then the notes. Export it as MusicXML (`.mxl`).
3. Import the `.mxl` with *Import MusicXML*. Importing a corrected file again replaces the piece and keeps its stats only while its title, parts and printed bar numbers stay the same, so set the piece's title in MuseScore before the first import and notes can then be fixed section by section.

## What this fork adds over upstream

This fork started from upstream [`leafo/sightreading.training`](https://github.com/leafo/sightreading.training) at [`24219ac`](https://github.com/leafo/sightreading.training/commit/24219ac29061b437204763a150b834f928dfb550) ("make the code aware of front-end only build mode") and has since added, across 59 merged PRs:

- **Sheet-music import.** Import real scores as MusicXML (including compressed `.mxl`), with the original source kept so a piece can be re-imported without losing its stats, and guidance for converting a PDF first. ([#1](https://github.com/jdong28/sightreading.training/pull/1), [#3](https://github.com/jdong28/sightreading.training/pull/3), [#17](https://github.com/jdong28/sightreading.training/pull/17), [#36](https://github.com/jdong28/sightreading.training/pull/36))
- **A dedicated sheet-music practice page** (`/sheet-music`) that draws the imported score itself — via OpenSheetMusicDisplay or Verovio, comparable side by side at `/score-engines` — rather than a plain generated staff, including the score's own key signature, clefs, note values, ties, ornaments (grace notes, trills, turns, mordents), and a scrolling mode. ([#18](https://github.com/jdong28/sightreading.training/pull/18), [#20](https://github.com/jdong28/sightreading.training/pull/20), [#21](https://github.com/jdong28/sightreading.training/pull/21), [#24](https://github.com/jdong28/sightreading.training/pull/24), [#25](https://github.com/jdong28/sightreading.training/pull/25), [#39](https://github.com/jdong28/sightreading.training/pull/39))
- **More accurate note detection and timing.** A rewritten, pure note-matcher judges every MIDI event (not just batched renders), correctly handles held/sustained notes, early key presses, quick re-strikes, chords, and a score's ornaments independent of the head column, and fixed a string of related edge cases; scroll mode can optionally "keep tempo," missing notes you don't catch before they cross the line. ([#23](https://github.com/jdong28/sightreading.training/pull/23), [#31](https://github.com/jdong28/sightreading.training/pull/31)–[#35](https://github.com/jdong28/sightreading.training/pull/35), [#38](https://github.com/jdong28/sightreading.training/pull/38), [#41](https://github.com/jdong28/sightreading.training/pull/41), [#43](https://github.com/jdong28/sightreading.training/pull/43), [#45](https://github.com/jdong28/sightreading.training/pull/45), [#57](https://github.com/jdong28/sightreading.training/pull/57), [#59](https://github.com/jdong28/sightreading.training/pull/59))
- **Spaced-repetition practice.** Practice attempts are graded and scheduled per measure with an FSRS-6-based scheduler, surfaced as "today's programme" — a generated practice session across your imported pieces that picks weak measures first and will offer a hand alone when only one hand is missing it, in scroll mode too. ([#26](https://github.com/jdong28/sightreading.training/pull/26), [#28](https://github.com/jdong28/sightreading.training/pull/28)–[#30](https://github.com/jdong28/sightreading.training/pull/30), [#37](https://github.com/jdong28/sightreading.training/pull/37), [#42](https://github.com/jdong28/sightreading.training/pull/42), [#52](https://github.com/jdong28/sightreading.training/pull/52))
- **A developer metrics panel** (`?devMetrics=1`) showing live note-matcher measurements, pass pace, and grading detail for debugging the detection and scheduling logic. ([#40](https://github.com/jdong28/sightreading.training/pull/40), [#44](https://github.com/jdong28/sightreading.training/pull/44))
- **Acoustic self-graded practice.** Sheet music can be practised on an acoustic piano instead of MIDI: play the card on the screen, then grade the pass yourself (Fell apart, Stumbled, Clean, Easy) and optionally tag what slipped, with a receipt line confirming what each pass recorded, feeding the same per-measure spaced-repetition records and FSRS schedule as detected practice. ([#47](https://github.com/jdong28/sightreading.training/pull/47), [#54](https://github.com/jdong28/sightreading.training/pull/54))
- **The hard passages of a piece, found from its score.** Every imported piece is analysed at import — free, offline and with no account — and the sheet music page shows what it found at rest: a bar-by-bar difficulty strip, the flagged passages shaded on your own engraved score, why each one is hard and how to practise it, with a pill that drills the passage (or one hand of it) straight away. Flagged passages also become quick picks for the section in the free-practice drawer. ([#56](https://github.com/jdong28/sightreading.training/pull/56))
- **A fingerings tool** (`tools/fingerings/`). A standalone Python tool turns a PDF of handwritten fingerings into the piece's MusicXML with `<fingering>` elements inserted, reading each mark via a Claude Code worker, for building an edition's fingering layer in bulk. ([#55](https://github.com/jdong28/sightreading.training/pull/55))
- **A visual redesign** ("Salon de Chopin"): a new header/nav, setup screen, first-run onboarding flow, a restyled trainer screen (now with an ink smudge on a wrong note, a recorded session length, and the exercises staff redrawn with ledger lines by StaffTwo), and a *Statistics* page that now shows your own practice history with no account at all — evenings kept, notes read, accuracy against the fortnight before, a 14-day minutes chart against a daily goal, and your accuracy by clef and by note, all read from the sessions kept in the browser. ([#5](https://github.com/jdong28/sightreading.training/pull/5), [#8](https://github.com/jdong28/sightreading.training/pull/8)–[#10](https://github.com/jdong28/sightreading.training/pull/10), [#53](https://github.com/jdong28/sightreading.training/pull/53), [#58](https://github.com/jdong28/sightreading.training/pull/58), [#64](https://github.com/jdong28/sightreading.training/pull/64))

The full commit and PR history is on GitHub: [commits since the fork point](https://github.com/jdong28/sightreading.training/compare/24219ac29061b437204763a150b834f928dfb550...master) and the [pull request list](https://github.com/jdong28/sightreading.training/pulls?q=is%3Apr+is%3Amerged).

### Changed or removed versus upstream

- **No backend needed for practice.** Imported pieces, practice records, and practice sessions are kept entirely in the browser (IndexedDB), not the Lua/PostgreSQL backend, so the whole sheet-music and spaced-repetition experience works in frontend-only mode. ([#7](https://github.com/jdong28/sightreading.training/pull/7))
- **The server-side song library (`/songs`) is no longer used by the frontend.** Nothing lists, loads, or saves server songs anymore; the play-along editor keeps only a local draft. The library itself hasn't been removed server-side yet.
- Middle C is now named `"C4"` (matching MusicXML/MIDI convention) instead of upstream's `"C5"`; older locally-stored data is migrated automatically. ([#14](https://github.com/jdong28/sightreading.training/pull/14))

## Contributing

Project-specific architecture, build, and testing notes for agents and contributors live in [`AGENTS.md`](AGENTS.md).
