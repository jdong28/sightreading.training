# Sight Reading Trainer

## <https://sightreading.training>

![test](https://github.com/leafo/sightreading.training/workflows/test/badge.svg)

[![Twitch Link](http://leafo.net/dump/twitch-banner.svg)](https://www.twitch.tv/moonscript)

A tool for practicing sight reading, learning songs, and training other musical skills in your browser. The successor to <https://github.com/leafo/mursic>.

Learn more on [the guide](https://sightreading.training/about).

![screenshot](http://leafo.net/shotsnb/2016-05-14_16-30-55.png)

## Frontend development

The frontend is a React app that can be developed without the backend (Lua,
PostgreSQL, tup). All you need is Node:

```bash
npm install
npm run dev
```

Then open <http://localhost:3000/> (set `PORT` to serve on another port, e.g.
`PORT=3001 npm run dev`). The dev server bundles with esbuild,
watches for changes, and reloads the page automatically. Backend-only features
(stats) will not function in this mode;
everything else works, including MIDI input and output.

The jasmine specs (`static/js/specs.js`) are bundled by the same dev server;
open <http://localhost:3000/dev/specs.html> to run them in the browser.

The full site build (backend + minified production assets) uses the
[tup](https://gittup.org/tup/) build system, see the Tupfiles in the repo.

## From a PDF

The app reads MusicXML, not PDFs: no tool tried could turn a PDF into notes
accurately enough to practise uncorrected. Picking a PDF in *Import MusicXML*
shows this route instead:

1. Search first for a MusicXML version of the piece. If there is none, convert
   the PDF with [Audiveris](https://audiveris.github.io/audiveris/) (free,
   local; best for digitally engraved PDFs), or try
   [homr](https://github.com/liebharc/homr) or
   [Soundslice](https://www.soundslice.com/sheet-music-scanner/) for old scans.
2. Open the result in [MuseScore Studio](https://musescore.org/en/download) and
   fix the wrong bars: the bar count, parts and clefs first, then the notes.
   Export it as MusicXML (`.mxl`).
3. Import the `.mxl` with *Import MusicXML*. Importing a corrected file again
   replaces the piece and keeps its stats only while its title, parts and
   printed bar numbers stay the same, so set the piece's title in MuseScore
   before the first import and notes can then be fixed section by section.

