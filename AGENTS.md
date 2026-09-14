# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Frontend-only workflow: `npm run dev` (see `dev/serve.mjs`, README "Frontend development"). The production build uses tup (`static/Tupfile`). `npm run dev` writes generated, untracked files (`static/js/st/song_parser_peg.js`, `static/js/st/staff_assets.jsx`, `static/guides/*.json`); never commit them.
- `npm test` (`dev/run_specs.mjs`) runs the Jasmine specs bundled at `/dev/specs.html` headlessly via puppeteer and exits non-zero on any failure; CI's `node` job in `.github/workflows/test.yml` runs `make lint_js`, `npm run build_assets`, then `npm test` alongside the existing Docker Lua job.
- Lint JS with `make lint_js` (some pre-existing quote and unreachable-code errors exist in untouched files).
- Staff mode generators live in the `GENERATORS` registry in `static/js/st/data.jsx`; the settings panel renders their declarative `inputs` (`static/js/st/components/sight_reading/settings_panel.jsx`).

## Sharp edges

- Note names use the app's own octave numbering: middle C is `"C5"` (`parseNote("C5") == MIDDLE_C_PITCH` in `static/js/st/music.js`), one octave above MIDI/scientific numbering. Converters from external formats must add one to the octave.
- Measures of imported MusicXML use the score's printed bar numbers (`metadata.measureNumbers`; a leading pickup is measure 0), while notation-text songs number from 1; go through `measureBeatRange`/`measureNumberRange` in `static/js/st/song_sections.js` rather than indexing `measureStarts`.
- Song beats are quarter notes everywhere (`beatsPerMeasure` for 6/8 is 3). `static/js/st/song_parser.js` is the reference for how notation becomes the `MultiTrackSong` model.
- Diatonic (7-step) scale notes are spelled by letter (`letterNoteName` in `static/js/st/music.js`), not by `noteName`'s pitch-based enharmonic guess, so each letter name appears exactly once (e.g. Gb major's degree is Cb, not B). Chords and the chromatic scale still use pitch-based spelling.
- `StaffTwo` (`static/js/st/components/staff_two.jsx`) paints its Two.js scene via `flush()`, gated by `this.flushChanges`. That flag is normally set by memoized watcher components (`RefreshNotes`/`RefreshStaves`) that only re-run on a prop *change* — so any code path that needs a repaint without a subsequent prop change (e.g. the post-mount flush in `componentDidMount`) must set `this.flushChanges` and call `this.flush()` directly. `renderStaves()` also gates on `assetsReady()` (every ref in `this.assets` attached) rather than assuming asset refs exist on first paint, and `componentWillUnmount()` guards on `this._unmounted`/`this.state.two` rather than assuming setup has completed.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
