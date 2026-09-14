# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Frontend-only workflow: `npm run dev` (`PORT=` picks another port; see `dev/serve.mjs`, README "Frontend development"). The jasmine specs run in the browser at `/dev/specs.html` on that server; there is no node test runner. The production build uses tup (`static/Tupfile`). `npm run dev` writes generated, untracked files (`static/js/st/song_parser_peg.js`, `static/js/st/staff_assets.jsx`, `static/guides/*.json`); never commit them.
- Lint JS with `make lint_js` (some pre-existing quote and unreachable-code errors exist in untouched files).
- Browser data (imported pieces, per-section stats, practice sessions) lives in the IndexedDB local store `static/js/st/storage.js`; `initStorage()` runs in `static/js/st/app.jsx` before the app renders. Reads are synchronous over its cache (generators and settings inputs read on every render); mutations are async and write the database before the cache. Specs use `openTestStore` from `static/js/spec/helpers.js`, never the real database.
- Staff mode generators live in the `GENERATORS` registry in `static/js/st/data.jsx`; the settings panel renders their declarative `inputs` (`static/js/st/components/sight_reading/settings_panel.jsx`).

## Sharp edges

- Note names use the app's own octave numbering: middle C is `"C5"` (`parseNote("C5") == MIDDLE_C_PITCH` in `static/js/st/music.js`), one octave above MIDI/scientific numbering. Converters from external formats must add one to the octave.
- Measures of imported MusicXML use the score's printed bar numbers (`metadata.measureNumbers`; a leading pickup is measure 0), while notation-text songs number from 1; go through `measureBeatRange`/`measureNumberRange` in `static/js/st/song_sections.js` rather than indexing `measureStarts`.
- The old localStorage deck (`st:sheet_music_pieces:v1`) is migrated into the pieces store once; the `legacyDeckMigrated` record in the `meta` store stops it re-running, and the old key is left in place. Schema changes bump `DB_VERSION` with a new `upgradeSchema` step.
- Song beats are quarter notes everywhere (`beatsPerMeasure` for 6/8 is 3). `static/js/st/song_parser.js` is the reference for how notation becomes the `MultiTrackSong` model.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
