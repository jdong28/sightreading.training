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

Then open <http://localhost:3000/>. The dev server bundles with esbuild,
watches for changes, and reloads the page automatically. Backend-only features
(login, stats, the play-along song library) will not function in this mode;
everything else works, including MIDI input and output.

The jasmine specs (`static/js/specs.js`) are bundled by the same dev server;
open <http://localhost:3000/dev/specs.html> to run them in the browser.

The full site build (backend + minified production assets) uses the
[tup](https://gittup.org/tup/) build system, see the Tupfiles in the repo.

