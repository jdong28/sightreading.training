# claude-flags: where is each piece hard, according to Claude

A local command, outside the app bundle, that asks Claude (Opus 5.5, through
**your own Claude Code sign-in**) where a piece is hard and writes a flags file
of proposals for each piece. You open the file in the app's review pane
("Open a flags file"); every passage waits there until you accept, edit or
dismiss it. Nothing here runs in the app, and the app holds no API key.

```
npm run claude-flags -- [options] <score.musicxml | folder | library.json>...
```

## What you need

- Claude Code (`claude`) signed in with a **Claude account** (`claude auth status`
  says `claude.ai`). The command refuses to start on an API key unless you pass
  `--allow-api-key`, and it strips `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`
  from what it runs, so a run is never billed to an API account by accident.
- The repo's `npm install` (esbuild and puppeteer, the same as `npm test`).

## What goes out

For each piece: its title, composer (from the file), file name, its notes in a
compact text form, its tempo, key and metre, any words, dynamics and pedal
marks, and the app's own score analysis of it. From a library export only each
piece and its source are read: **never** your practice items, reviews or
sessions. The system prompt is `prompt/flags-v1.md`; the exact text sent for a
piece is written beside its flags file as `<piece>.prompt.md`.

With web search on (the default), Claude Code searches and fetches a few pages
about the piece. Claude Code runs those tools through a smaller model and hands
Opus a *summary*, so a quote can't be trusted as verbatim: the answer carries a
paraphrase and, only when Claude saw the page's own words, a quote. The app
shows every citation as "not yet verified". `--no-web` sends the score alone.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--out <dir>` | `./claude-flags-out/<date-time>` | Where files go. The same dir resumes a run. |
| `--piece <id or title>` | all | From a library export, only these pieces (repeatable). |
| `--limit <n>` | all | Stop after n pieces. `--limit 1` prices one before the rest. |
| `--no-web` | web on | The score alone: no search, no citations. |
| `--model`, `--effort` | `claude-opus-5-5`, `high` | Recorded in every file. |
| `--piece-budget <usd>` | 2.00 | Passed to Claude Code as `--max-budget-usd`. It is checked between turns, so a piece can overshoot by one. |
| `--run-budget <usd>` | 10.00 | No new piece starts once *this invocation* has spent this much. |
| `--timeout <min>` | 15 | Per piece; the child is stopped. |
| `--dry-run` | off | Writes the prompts and an estimate to `dry-run.json`; calls nothing. |
| `--force` | off | Asks again for pieces already done in `--out`. |
| `--claude-bin <path>` | `claude` | |
| `--allow-api-key` | off | Run even when Claude Code isn't signed in with claude.ai. |

Exit code 0: every piece finished. 1: some piece failed or was skipped.
2: couldn't start (sign-in, options, nothing to read). 130: interrupted.

## What it writes (in `--out`)

- `run.json`, rewritten after every piece: the model, effort, web setting,
  prompt/schema/compact versions, budgets, per piece its status (`ok`,
  `empty`, `failed`, `interrupted`, `skipped`, `pending`), flags kept and
  rejected (with reasons), turns, time, and token usage and cost **summed over
  every model** (the web tools run on Haiku). Your email and organisation are
  never recorded.
- `system-prompt.md` and `schema.json`: exactly what was sent.
- Per piece: `<piece>.prompt.md`, `<piece>.result.json` (Claude Code's raw
  JSON), `<piece>.report.json` (what was kept and rejected, shifted bars,
  trimmed text) and `<piece>.flags.json`, the file to open in the app.

A piece is skipped as done when its flags file exists and `run.json` holds the
same score, model, web setting and versions. A failed piece is tried again.
Ctrl+C stops Claude's child process, marks the piece `interrupted`, and the
same `--out` picks up from there.

## What the command checks before it writes anything

Claude's answer is untrusted text. Code checks, in order:

1. The shape (types, enums, required fields, no extra keys). A wrong shape
   fails the piece as `invalid output`.
2. Text limits: over-long fields are cut at a word with "…" (recorded as `trimmed`).
3. Each flag's bars exist, in order, and span at most 8 bars.
4. Each flag's **evidence notes are found in the score**, by pitch (never
   spelling), in the claimed bars and hand, counting notes held over from an
   earlier bar. Notes found a bar or two away shift the flag's range (recorded
   as "Claude named bars 20–22; the notes it quoted are in bars 21–23"); notes
   found nowhere drop the flag.
5. Citations: at most 3, `http`/`https` only, none verified.
6. Duplicates, then a budget: at most 10 flags, 8 of them hard or hardest, and
   40% of the bars.
7. The finished file must read back whole through the app's own `readFlagsFile`
   and place on the piece's own bars unmoved.

## In the app

Opening the file puts the proposals in the review pane as cards with a gilt
**Claude** chip, Claude's view of the score analysis, and its sources marked
"not yet verified". A Claude passage **waits**: it doesn't shape practice (the
plan, the bar strip, the drawer's quick picks) until a person accepts or edits
it. Opening a newer file replaces the last Claude proposals for that piece;
your decisions stay. The file is version 2 of the flags file; the app reads
both versions and exports version 1.

## What it costs

Priced at the API's list rates, a piece of 60–100 bars with web on is about
$0.50 (about $2.50 for five pieces, in 4–6 minutes each). On a subscription
that counts against your plan's usage and is not billed. The run reports what
it actually used. Price one piece first with `--limit 1`.

## The first five pieces (the pilot)

```
npm run claude-flags -- --out ~/claude-flags/pilot --run-budget 10 \
  "$HOME/Downloads/Debussy Rêverie (Piano solo) - fingered.musicxml" \
  "$HOME/Downloads/Opus 27 No 2 Moonlight Sonata 1st movement.musicxml" \
  "$HOME/Downloads/Claude Debussy - La fille aux cheveux de lin.musicxml" \
  "$HOME/Downloads/Nocturne_No._20_in_C_Minor.mxl" \
  "$HOME/AI Dev/firstmate/data/sr-hard-sections-s1-analysis/maple_leaf_rag.mxl"
```

## Changing it

The prompt (`prompt/flags-v1.md`), the output schema (`bridge/schema.js`) and
the compact format (`bridge/compact.js`) each carry a version in
`lib/versions.mjs`, and `test/versions.test.mjs` pins the sha256 of the first
two: an edit without a new version fails CI. Files record the versions that
made them.

```
npm run test:claude-flags   # the specs, against a stub `claude`; they spend nothing
npm run lint:claude-flags
```

The specs never run the real `claude`. They drive `test/fixtures/fake-claude.mjs`.
