# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Frontend-only workflow: `npm run dev` (see `dev/serve.mjs`, README "Frontend development"). The jasmine specs run in the browser at `/dev/specs.html` on that server; there is no node test runner. The production build uses tup (`static/Tupfile`). `npm run dev` writes generated, untracked files (`static/js/st/song_parser_peg.js`, `static/js/st/staff_assets.jsx`, `static/guides/*.json`); never commit them.
- Lint JS with `make lint_js` (some pre-existing quote and unreachable-code errors exist in untouched files).
- Staff mode generators live in the `GENERATORS` registry in `static/js/st/data.jsx`; the settings panel renders their declarative `inputs` (`static/js/st/components/sight_reading/settings_panel.jsx`).

## Sharp edges

- Note names use the app's own octave numbering: middle C is `"C5"` (`parseNote("C5") == MIDDLE_C_PITCH` in `static/js/st/music.js`), one octave above MIDI/scientific numbering. Converters from external formats must add one to the octave.
- Song beats are quarter notes everywhere (`beatsPerMeasure` for 6/8 is 3). `static/js/st/song_parser.js` is the reference for how notation becomes the `MultiTrackSong` model.
- On macOS the checkout shows six `static/music/interval_melodies/*.lml` files as modified because of a case-insensitive filename collision; leave them alone.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
