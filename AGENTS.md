# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Frontend-only workflow: `npm run dev` (`PORT=<n>` picks a private port; see `dev/serve.mjs`, README "Frontend development"). The production build uses tup (`static/Tupfile`). `npm run dev` writes generated, untracked files (`static/js/st/song_parser_peg.js`, `static/js/st/staff_assets.jsx`, `static/guides/*.json`); never commit them.
- `npm test` (`dev/run_specs.mjs`) runs the Jasmine specs bundled at `/dev/specs.html` headlessly via puppeteer and exits non-zero on any failure; CI's `node` job in `.github/workflows/test.yml` runs `make lint_js`, `npm run build_assets`, then `npm test` alongside the existing Docker Lua job.
- Lint JS with `make lint_js` (some pre-existing quote and unreachable-code errors exist in untouched files).
- Browser data (imported pieces, per-section stats, practice sessions) lives in the IndexedDB local store `static/js/st/storage.js`; `initStorage()` runs in `static/js/st/app.jsx` before the app renders. Reads are synchronous over its cache (generators and settings inputs read on every render); mutations are async and write the database before the cache. Specs use `openTestStore` from `static/js/spec/helpers.js`, never the real database.
- The UI follows the "Salon de Chopin" design spec in `docs/design/salon-de-chopin.md`: use the `--salon-*` and `--font-display` tokens in `static/js/st/global.css` and the primitives in `static/js/st/components/salon.jsx` rather than raw values. The header is fixed; offset content with `var(--header-height)`, never a hard-coded height.
- Staff mode generators live in the `GENERATORS` registry in `static/js/st/data.jsx`; the trainer's programme drawer (`ProgrammeDrawer` in `static/js/st/components/sight_reading/settings_panel.jsx`) renders their declarative `inputs`. The trainer's programme (staff, generator, key, mode, scroll speed) is stored under `DRILL_STORAGE_KEY` through the helpers in `static/js/st/generators.js`: the `/setup` page (`setup_page.jsx`) writes it and the trainer reads it at mount, so add new programme fields there, not in component state alone. Page actions that belong in the fixed header's top row portal into `HEADER_ACTIONS_ID` (`static/js/st/components/header.jsx`).
- The Staff page (`static/js/st/components/pages/sight_reading_page.jsx`) judges notes only between Begin and Rest; specs that play notes must press Begin (or call `beginSession()`) first. `/` renders the legacy staves (`STAVES[].render`), `/staff2` renders `StaffTwo`, which lacks ledger lines and whose scrolling notes miss the scroll-mode hit zone, so it is not ready for `/`.

## Sharp edges

- Note names use the app's own octave numbering: middle C is `"C5"` (`parseNote("C5") == MIDDLE_C_PITCH` in `static/js/st/music.js`), one octave above MIDI/scientific numbering. Converters from external formats must add one to the octave.
- Measures of imported MusicXML use the score's printed bar numbers (`metadata.measureNumbers`; a leading pickup is measure 0), while notation-text songs number from 1; go through `measureBeatRange`/`measureNumberRange` in `static/js/st/song_sections.js` rather than indexing `measureStarts`.
- The old localStorage deck (`st:sheet_music_pieces:v1`) is migrated into the pieces store once; the `legacyDeckMigrated` record in the `meta` store stops it re-running, and the old key is left in place. Schema changes bump `DB_VERSION` with a new `upgradeSchema` step.
- Song beats are quarter notes everywhere (`beatsPerMeasure` for 6/8 is 3). `static/js/st/song_parser.js` is the reference for how notation becomes the `MultiTrackSong` model.
- Diatonic (7-step) scale notes are spelled by letter (`letterNoteName` in `static/js/st/music.js`), not by `noteName`'s pitch-based enharmonic guess, so each letter name appears exactly once (e.g. Gb major's degree is Cb, not B). Chords and the chromatic scale still use pitch-based spelling.
- `StaffTwo` (`static/js/st/components/staff_two.jsx`) paints its Two.js scene via `flush()`, gated by `this.flushChanges`. That flag is normally set by memoized watcher components (`RefreshNotes`/`RefreshStaves`) that only re-run on a prop *change* — so any code path that needs a repaint without a subsequent prop change (e.g. the post-mount flush in `componentDidMount`) must set `this.flushChanges` and call `this.flush()` directly. Don't assume asset refs or `state.two` exist yet: `renderStaves()` waits on `assetsReady()`, and `componentWillUnmount()` tolerates an unset `state.two`.
- First launch is gated behind `/welcome` (`static/js/st/components/pages/onboarding_page.jsx`): `HomeGate` in `static/js/st/components/app.jsx` redirects `/` there until the `st:onboarded:v1` localStorage flag (`static/js/st/onboarding.js`) is set, which both onboarding actions do. "Take your seat" currently also targets `/` because `/setup` doesn't exist yet — repoint it once the setup route lands.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
