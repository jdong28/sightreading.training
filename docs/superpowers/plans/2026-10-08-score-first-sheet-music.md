# Score-First Sheet Music Page Implementation Plan

> **For agentic workers:** This plan is executed in-session via test-driven-development, one task at a time, per the firstmate operational brief for task bench-score-first-1-sp. Native Task tools (TaskList/TaskCreate) are not available in this environment, so tasks are tracked as checkboxes in this file instead of native tasks.

**Goal:** Rebuild `/sheet-music` around the owner's settled score-first design: the page opens on the engraved score (paginated, bars shaded by learnedness/difficulty/session), with a "Tonight's session" setup pane always on the right; Begin replaces the view with the session; Rest pauses, End session returns to the score with an accuracy strip and per-bar marks.

**Architecture:** Five new programme fields (`ScoreView`, `SessionRail`, `restPauses`, `scoreLayout`, `Drawer: null`) on `SCORE_PROGRAMME` let `SightReadingPage` branch into the new score-first flow while the exercises page (`EXERCISES_PROGRAMME`) is untouched. Three new pure logic modules (`bar_progress.js`, `score_render/score_pages.ts`, rewritten `bar_stats.js`) carry all new business logic; new leaf components (`score_sheet.jsx`, `score_view.jsx`, `setup_pane.jsx`, `bar_popup.jsx`, `session_rail.jsx`, `passage_pane.jsx`) carry the rendering. One additive, optional data field (`ItemRecord.passes`) makes learnedness computable exactly.

**Tech Stack:** React (JSX, no TypeScript except `score_render/*.ts`), Jasmine specs run headless via puppeteer (`dev/run_specs.mjs`), esbuild (no type checking), IndexedDB (`st/storage.js`).

**Spec:** `/Users/johndong/AI Dev/firstmate/data/bench-score-first-1/plan.md` (the full settled plan, with its plan check resolving every open question) and `/Users/johndong/AI Dev/firstmate/data/bench-score-first-1/design/` (the four approved artboards + `canvas.json` build notes). This plan follows that plan's own "Build order inside the one PR" (§I) as its task list; every task below cites the exact section letters/numbers in that spec for the authoritative shapes, formulas and copy. This document does not restate code already fully specified there — it tells the executor exactly where to read it and what to verify.

## Global Constraints

- Keep the exercises page (`/`) byte-for-byte unchanged in behavior. Every new branch is gated behind `programme.ScoreView`, `programme.restPauses` or `programme.scoreLayout`, all unset on `EXERCISES_PROGRAMME`.
- Never touch scheduling: `applyGrade`, `replay`, `SCHEDULER_ALGO`, the planner's existing rules are unchanged. `passes` is read only by `bar_progress.js`, never by the scheduler or planner.
- No `DB_VERSION`, `LIBRARY_VERSION` or `SONG_FORMAT` bump.
- Use `--salon-*` tokens and `components/salon.jsx` primitives, never raw hex (AGENTS.md).
- Specs use `openTestStore`, never the real IndexedDB. Specs that play notes press Begin first.
- `make lint_js` lints only tracked files — `git add` new files before linting.
- One commit per task below, in order; all are one PR.
- `npm run dev` writes untracked generated files (`song_parser_peg.js`, `staff_assets.jsx`, `static/guides/*.json`) — never commit them.

**User decisions (already made):** all four of plan.md's "Open questions" are pre-answered in its "Plan check" section and MUST be built as specified there, not re-litigated: (1) `TROUBLE_BELOW = 80`; (2) "This evening" shows plain accuracy, not scheduler grade words; (3) acoustic mode exactly per §C4 (clean = Clean/Easy, only graded bars get an entry, "x of y clean" marks, "x of y passes clean" strip, grades never become percentages); (4) passage tags open a new passage pane, "Review the passages" link opens the existing Review pane, most-overdue suggestion stays as one line, pasted notation stays reachable as the piece select's first option, session-summary extras (per-note trouble, insight, "See all progress") are dropped on this page.

---

## Task 0: Baseline gate

**Goal:** Confirm the base commit is green before any change, per plan.md §Tests→Gate.

**Files:** none (verification only).

**Acceptance Criteria:**
- [ ] `npm test` passes with 0 failures at `HEAD` (base commit `d5749824`).
- [ ] `make lint_js` exits 0.

**Verify:** `npm test && make lint_js`

**Steps:**
- [ ] Step 1: Run `npm ci` (or `npm install`) if `node_modules` is absent.
- [ ] Step 2: Run `npm test`. Expect the same shape as plan.md's recorded baseline (1400 specs, 0 failures, 0 pending) — exact counts may drift slightly from new deps, but failures must be 0.
- [ ] Step 3: Run `make lint_js`. Expect exit 0.
- [ ] No commit (verification only).

---

## Task 1: `ItemRecord.passes` (plan.md §C6, §Files "Change": `srs/records.js`, `srs/attempt.js`, `measure_cards.js`, `storage.js`; §Tests "srs_records_spec.js / storage_spec.js" and "srs_attempt_spec.js / measure_cards_spec.js")

**Goal:** Add the optional, additive `passes` history field to single-bar items, written in exactly the three places plan.md §C6 lists, read with seeding from `recent` for items that don't have it yet.

**Files:**
- Modify: `static/js/st/srs/records.js` — add `PASS_HISTORY = 8`, the `passes` shape, `validItem` acceptance rule, `withPass(item, entry)`, `itemWithPractice` accepting `pass`.
- Modify: `static/js/st/srs/attempt.js` — `barPasses(pass)`; `passAttempts`/`selfAttempts` append to `passes` for single-bar ranges via `withPass`; `selfPractice` carries `pass` for ranges in `also`.
- Modify: `static/js/st/measure_cards.js` — `setOnPass(fn)`; `finishPass` calls it with `barPasses(pass)`; `passRecords` adds `pass: [columns, clean, grade|null]` to demoted single-bar stints; expose the `finishing` promise.
- Modify: `static/js/st/storage.js` — `practicedItem` passes `pass` through to `itemWithPractice`.
- Test: `static/js/spec/srs_records_spec.js`, `static/js/spec/storage_spec.js`, `static/js/spec/srs_attempt_spec.js`, `static/js/spec/measure_cards_spec.js`.

**Acceptance Criteria:** exactly the bullets under plan.md's "`srs_records_spec.js` / `storage_spec.js`" and "`srs_attempt_spec.js` / `measure_cards_spec.js`" headings (lines 420-433), including: `withPass` seeds from `recent` on first write and caps at 8 (oldest dropped); `validItem` accepts `[[at,4,4,3],[at,4,3,null],[at,null,null,2]]` and rejects a 9th entry, `clean > columns`, a length-3 entry, and `[at,null,4,3]`; `practicedItem` with `pass` appends `[at,4,4,null]`, without it appends nothing; a library export/import round-trips `passes`; `replay` keeps `passes` untouched; a graded two-bar-card pass appends one entry per single-bar item and none to the range item; **the core case** — free practice, bar 5 as one looping card, three clean laps within 30s: 1 review in `reviews`, `item.passes` has 3 clean entries, `learnedness` (computed later in Task 2, so here just assert the raw `passes` array is 3 clean entries) is derivable as 3; an off-schedule lap with one slip graded *hard* appends a non-clean entry; an abandoned pass / continued remainder / mode-changed pass appends nothing; a skipped column (Space) makes the entry non-clean; a self-graded "Clean" two-bar card appends `[at,null,null,3]` to both bars, "Stumbled" with Where?=bar 5 appends only to bar 5; `setOnPass` receives one report per pass with per-bar `{measure, columns, clean, grade}` and `readThrough` set, not called for an abandoned pass.

**Verify:** `npm test -- --filter=srs_records,storage,srs_attempt,measure_cards` (or run the full `npm test`; these specs are bundled into `/dev/specs.html` and run by `dev/run_specs.mjs` with no filtering support — run the full suite and confirm the new spec files' `describe` blocks all pass).

**Steps:**
1. Read plan.md §C6 (lines 75-85) in full for the exact shape, seeding, reading-old-items and validation rules. Read `static/js/st/srs/records.js` end to end first (item shapes, `recent`, `validItem`, `itemWithPractice`, `RECENT_ATTEMPTS`) to match its existing style.
2. Write the failing specs in `srs_records_spec.js` / `storage_spec.js` first, from the Acceptance Criteria above, then implement `PASS_HISTORY`, `withPass`, the `validItem` branch and `itemWithPractice`'s `pass` parameter until they pass.
3. Read `static/js/st/srs/attempt.js` (`passAttempts`, `selfAttempts`, `selfPractice`, `AttemptPass`) end to end. Write the failing specs in `srs_attempt_spec.js` for `barPasses(pass)` and the single-bar append behavior, then implement.
4. Read `static/js/st/measure_cards.js` (`finishPass`, `passRecords`, `MeasureCardGenerator`) end to end. Write the failing specs in `measure_cards_spec.js` for `setOnPass`, the `pass` field on demoted stints, and the `finishing` promise, then implement.
5. Read `static/js/st/storage.js`'s `practicedItem` (cited at `storage.js:1187` by the spec plan) and wire `pass` through; add the one-line doc update plan.md asks for on `recordSectionPractice`.
6. Run the full spec suite; fix until green. Run `make lint_js` after `git add` of any new spec files.
7. Commit: `git add -A -- static/js/st/srs/records.js static/js/st/srs/attempt.js static/js/st/measure_cards.js static/js/st/storage.js static/js/spec/srs_records_spec.js static/js/spec/storage_spec.js static/js/spec/srs_attempt_spec.js static/js/spec/measure_cards_spec.js && git commit -m "srs: add optional per-bar pass history (ItemRecord.passes)"`.

---

## Task 2: `bar_progress.js` + rewritten `bar_stats.js` (plan.md §C1-C5, §D6, §Files "Add"/"Change", §Tests "bar_progress_spec.js" and "bar_stats_spec.js")

**Goal:** Pure modules computing learnedness, session marks, the ended-strip copy, and the bar pop-up's model — all from `ItemRecord.passes`/`recent`, never touching the scheduler.

**Files:**
- Add: `static/js/st/bar_progress.js` — `passHistory(item)`, `passAccuracy(entry)`, `isClean(entry)`, `learnedness(item)`, `learnedCount(items, measures, hand)`, `sessionMarks(log)`, `endedSummary({record, previous, log, acoustic})`, `TROUBLE_BELOW = 80`.
- Modify (rewrite): `static/js/st/bar_stats.js` — `barPopup({pieceId, measure, hand, items, flags, now})` per plan.md §D6; drop the old "From your playing" trouble sentence.
- Test: `static/js/spec/bar_progress_spec.js` (new), `static/js/spec/bar_stats_spec.js` (rewrite).

**Acceptance Criteria:** exactly the bullets under plan.md's "`bar_progress_spec.js`" and "`bar_stats_spec.js`" headings (lines 435-447): learnedness cases (no item→0 not played; attempts>0 no history→0 "Started"; `[c,c]`→2; `[c,m,c,c,c]`→3; `[c,c,c,m]`→0; six clean→3; self grades 3/4 clean, 1/2 not; mixed detected+self; zero-column entries ignored; only the setup hand's item read); `sessionMarks` Σclean/Σcolumns thresholds (100/89/71, exactly 80 near / 79 trouble boundary), self-only "x of y clean" share thresholds; `endedSummary` headline = `accuracyPercent(notesRead, misses)`, previous-session comparison (Up/Down/Level, only same piece, only earlier `startedAt`, only with `notesRead+misses>0`), minutes wording, bar-count wording, acoustic "4 of 6 passes clean" with no comparison; `barPopup` empty-bar case, history-plotting (latest/best/day-words/pips), clean-run wording ("2 of 3 clean passes in a row" / "Learned"), >8 entries plots only the last 8, self-entries render "Graded by ear: …" words with no percentage, passage tag ("Passage I · Hardest" inside a flag in force including `alsoAt`, else Learned/Learning/New), only the requested hand is read.

**Verify:** full `npm test` green; `make lint_js` exits 0.

**Steps:**
1. Read plan.md §C1-C5 (lines 45-85) and §D6 (lines 148-164) completely, plus the "Not rendered" note (trend/trouble/streakHint stay unbuilt).
2. Read the current `static/js/st/bar_stats.js` and its spec `static/js/spec/bar_stats_spec.js` (PR 70's version) to know what's being replaced, and `srs/grade.js`'s `attemptCounts` (clean/columns), `srs/planner.js`'s `daysAgo`, and `difficulty`/`sections`'s `flagsInForce`/`alsoAt` for the tag logic.
3. Write `bar_progress_spec.js` from the Acceptance Criteria (learnedness, sessionMarks, endedSummary cases) before any implementation; confirm it fails.
4. Implement `bar_progress.js`. `learnedness(item)` walks `passHistory(item)` (= `item.passes` or, absent, `item.recent`) from the end backwards counting `isClean` entries, capped at 3, resetting to 0 at the first non-clean. `isClean` on a self entry (`columns==null`) is `grade >= GOOD` (reuse the existing self-grade constant from `srs/self_grade.js`, do not redefine it). `passAccuracy` is `round(100*clean/columns)` for detected entries. `sessionMarks(log)` groups the log's per-bar pass reports by measure and applies `TROUBLE_BELOW`.
5. Write `bar_stats_spec.js`'s new cases, confirm failing, then rewrite `bar_stats.js`'s `barPopup` to match §D6 exactly (object shape: tag, empty flag, latest/best/played, chart data points with day labels, self-passes line, streak pips + wording, no `trend`/`trouble`/`streakHint` keys).
6. Run full `npm test`; fix until green; `make lint_js`.
7. Commit: `git add -A -- static/js/st/bar_progress.js static/js/st/bar_stats.js static/js/spec/bar_progress_spec.js static/js/spec/bar_stats_spec.js && git commit -m "st: add bar_progress (learnedness, session marks, ended summary) and rewrite bar_stats as the pop-up model"`.

---

## Task 3: `score_render/score_pages.ts` + shared draw queue (plan.md §D5, §Files "Add": `score_render/score_pages.ts`; "Change": `components/score_card.jsx`, `score_render/card_shade.ts`; §Tests "score_pages_spec.js")

**Goal:** Pure pagination/hit-testing module over an engine's `CardResult.measures`, and an exported `enqueueDraw` so the new score sheet shares the one draw-at-a-time queue with `ScoreCard`.

**Files:**
- Add: `static/js/st/score_render/score_pages.ts` — `systemsOf` (moved from `card_shade.ts`), `systemBands`, `scorePages(measures, {height, budget})`, `barOverlays(page)`, `pageOfBar`, constants `ENGRAVE_MAX_WIDTH = 644`, `SPACE = 8`, `PAGE_CHROME_PX = 320`, `MIN_PAGE_PX = 280`.
- Modify: `static/js/st/score_render/card_shade.ts` — import `systemsOf` from `score_pages.ts` instead of defining it; no behavior change.
- Modify: `static/js/st/components/score_card.jsx` — export `enqueueDraw(stale, task, onError)` wrapping the existing module-level `drawing` chain; use it inside `draw()`.
- Test: `static/js/spec/score_pages_spec.js` (new).

**Acceptance Criteria:** exactly plan.md's "`score_pages_spec.js`" bullets (lines 449-456): `systemsOf` groups by y jump; bands pad 3 spaces above / 2 below; pages are greedy within budget, always ≥1 system, cut at system-gap midpoints, first page starts at 0, last page ends at full height; a system taller than the budget still gets its own page; overlay % boxes computed for a page; a split bar gives two overlays sharing one printed number; `pageOfBar` resolves a bar number to its page index; **the real-engine case** — the fixture (`tools/fingerings/tests/fixture/score.musicxml`) drawn by OSMD at width 644 gives systems `[1–5][6–10][11–15][16]`, and at an 812px budget (matching the 1440×1240 display measured in plan.md §A7) gives pages `bars 1–15` then `bar 16`.

**Verify:** full `npm test` green (score_pages_spec.js's real-engine case actually draws the fixture through the engine in headless Chromium, so it is slower — confirm it passes, not just that the file loads); `make lint_js`; `npx tsc --noEmit` is NOT run project-wide (AGENTS.md: esbuild compiles `score_render/` with no type checking) but visually re-read the new `.ts` file for obvious type errors.

**Steps:**
1. Read plan.md §D5 (lines 136-146) in full, and read today's `static/js/st/score_render/card_shade.ts` (for `systemsOf`'s current body and its callers) and `static/js/st/score_render/osmd.ts` (for `ZOOM`, `SPACE`'s derivation, and the detach-on-draw behavior at `osmd.ts:188-193`) and `static/js/st/components/score_card.jsx` (the `drawing` queue, `userUnitsPerPixel`) before writing any code.
2. Write `score_pages_spec.js`'s pure cases (systemsOf, bands, greedy pagination, overlays, pageOfBar, split-bar) against hand-built fixture measure arrays first; confirm they fail (module doesn't exist yet).
3. Implement `score_pages.ts`, moving `systemsOf`'s existing logic verbatim (so `card_shade.ts`'s own spec, `score_render_spec.js`, keeps passing after the import swap) and adding the new exports per plan.md's formulas (band = `[minY - 3*SPACE, maxY+height + 2*SPACE]`; cut at midpoint of consecutive bands; greedy fill while `nextCutNaturalHeight <= budgetPx`, always take ≥1 system).
4. Update `card_shade.ts` to import `systemsOf` from `score_pages.ts`; run `score_render_spec.js` to confirm no behavior change.
5. Add the real-engine spec case using the same pattern `score_card_spec.js` uses to draw the fixture through `ENGINES.osmd.renderCard` (load the fixture MusicXML, draw at width 644, feed `measures` into `scorePages`).
6. Add `enqueueDraw` to `score_card.jsx`: extract the existing `drawing = drawing.then(...)` chain-building logic (used in `draw()`) into an exported function taking a staleness check, the draw task, and an error callback, then call it from `draw()` unchanged in behavior. Confirm `score_card_spec.js` still passes.
7. Run full `npm test`; `make lint_js`.
8. Commit: `git add -A -- static/js/st/score_render/score_pages.ts static/js/st/score_render/card_shade.ts static/js/st/components/score_card.jsx static/js/spec/score_pages_spec.js && git commit -m "score_render: add score_pages pagination/hit-testing module and shared draw queue export"`.

---

## Task 4: Trainer view/pause/end/log + programme fields (plan.md §B, §D10, §Files "Change": `score_page.jsx`, `sight_reading_page.jsx`, `.module.css`; §Pitfalls "Trainer behaviour to preserve"; §Tests "sight_reading_page_spec.js" exercises-unchanged cases)

**Goal:** Add the five programme fields and the pause/end/session-log state machine to `SightReadingPage`, strictly behind `programme.restPauses`/`ScoreView`/`scoreLayout`, with the exercises page provably unchanged.

**Files:**
- Modify: `static/js/st/components/pages/score_page.jsx` — `SCORE_PROGRAMME` gains `Drawer: null`, `ScoreView`, `SessionRail`, `restPauses: true`, `scoreLayout: true`; remove `Rail`/`wideRail`/`ScoreRail`; `idleTitle` becomes `{title: "Sheet music", italic: "import a piece to begin"}`; keep `programmeOf`; update the header comment.
- Modify: `static/js/st/components/pages/sight_reading_page.jsx` — new state (`view`, `paused`, `ended`, `sessionLog`, `pausedMs`, `pausedAt`); `begin`, `pauseSession`, `resumeSession`, `endSession`, `playOn`, `dismissEnded`; `toggleSession` branches on `restPauses`; `elapsedSeconds()`/`recordSession()` subtract paused time; `this.lastRecord`; `setOnPass` wiring in `refreshNoteList`; gate `keyMap` in the score view; remove `selectedBar`/`selectBar`/`closeBar`/`selectedBarMeasure`/`onBar` from `engineCard()` and the `Rail`/`wideRail` render paths; update the `EXERCISES_PROGRAMME` doc comment.
- Modify: `static/js/st/components/pages/sight_reading_page.module.css` — `.score_layout` frame rules (plan.md §D1), paused-card dim, paused banner, End-session pill, oxblood status, title row with right note.
- Test: `static/js/spec/sight_reading_page_spec.js` (the "Exercises page unchanged" bullet only in this task — the migrated score-page cases move in Task 8 once the new components exist).

**Note:** This task deliberately does NOT render `ScoreView`/`SessionRail` yet (they don't exist until Task 5/6) — render a trivial placeholder (e.g. `<div>score view</div>`) behind `view=="score"` for now so the state machine is tested in isolation, then Task 5/6/8 wire in the real components. This keeps the task bounded to the trainer's own logic.

**Acceptance Criteria:**
- [ ] `EXERCISES_PROGRAMME` is untouched; `sight_reading_page_spec.js`'s existing exercises-page cases (Rest opens the summary dialog, Begin/Rest pill, Programme pill+drawer present, no score view) still pass unmodified.
- [ ] With `programme.restPauses` set: Begin clears `ended`/`sessionLog`, sets `view:"session"`, calls `beginSession()`.
- [ ] Rest while running calls `recordSession()` BEFORE `session:false` is set (per plan.md's pitfall, `sight_reading_page.jsx:1715`), stops the clock, sets `pausedAt`, clears the matcher, sets `paused:true`, never opens the summary dialog.
- [ ] Resume adds the pause duration to `pausedMs`, keeps the same NoteStats/record id, restarts the clock, replans.
- [ ] End session (from running or paused) does the pause-write step first if running, builds `ended` from the last record + session log + `recentSessions()`, sets `view:"score"`, and produces no strip when nothing was recorded.
- [ ] `elapsedSeconds()` excludes `pausedMs` and any in-progress pause.
- [ ] Space/1-4 hotkeys are inert while `view=="score"`.
- [ ] Page leave / unmount still calls `recordSession()` exactly as today.

**Verify:** full `npm test` green; `make lint_js`.

**Steps:**
1. Read plan.md §B (lines 24-34), §D10 (lines 239-263) and the "Trainer behaviour to preserve" pitfalls (lines 522-528) completely. Then read today's `sight_reading_page.jsx` in full for `toggleSession`, `restSession` (line ~1092), `beginSession` (line ~1045), `restartSession`/`closeSession`, `openSummary` (line ~1121), `recordSession` (line ~1699), `elapsedSeconds`, `refreshNoteList`, `engineCard()`'s `onBar` wiring, and the `renderRail`/header Programme-pill code (lines ~1885, ~2305) you are about to remove or gate.
2. Write the new `sight_reading_page_spec.js` cases from the Acceptance Criteria above (pause/resume/end/log state machine) against a minimal test programme (`{...SCORE_PROGRAMME, ScoreView: () => <div>score view</div>, SessionRail: () => <div>session rail</div>}` or similar), confirm they fail.
3. Implement the state and methods in `sight_reading_page.jsx`, keeping every new code path behind `programme.restPauses`/`programme.ScoreView`/`programme.scoreLayout` so `toggleSession`'s existing branch (today's Rest→summary behavior) is reached unchanged when those are unset.
4. Update `score_page.jsx`'s `SCORE_PROGRAMME` and remove `Rail`/`wideRail`/`ScoreRail` (grep for other callers first — there should be none outside this file and the trainer).
5. Add the `.module.css` rules for `.score_layout`, the paused banner/dim, and title row, per plan.md §D1/§D3/§D8 (visual polish is checked in Task 9's screenshots, not here — just get the classes and structure in place).
6. Run the full exercises-page spec cases to confirm zero behavior change; run the new cases; `make lint_js`.
7. Commit: `git add -A -- static/js/st/components/pages/score_page.jsx static/js/st/components/pages/sight_reading_page.jsx static/js/st/components/pages/sight_reading_page.module.css static/js/spec/sight_reading_page_spec.js && git commit -m "sight_reading_page: add score-first view/pause/end state machine behind new programme fields"`.

---

## Task 5: `ScoreSheet`, `ScoreView`, the setup pane and the pop-up (plan.md §D1-D7, §D11, §Files "Add": `score_sheet.jsx`, `score_view.jsx`, `setup_pane.jsx`, `bar_popup.jsx`; §Tests "score_view_spec.js" — all cases except the session-view and acoustic ones, which land in Task 6/8)

**Goal:** Build the at-rest score-first screen: the paginated engraved score with shaded, clickable bar overlays and the bar pop-up, beside the "Tonight's session" setup pane — and wire it into `SightReadingPage` from Task 4.

**Files:**
- Add: `static/js/st/components/score_sheet.jsx` + `.module.css` (draws via `enqueueDraw`/`loadScoreEngines`, measures its box, paginates via `scorePages`, crops the one svg per plan.md §D5 "Showing page p", renders overlay buttons/labels/tags/pop-up slot).
- Add: `static/js/st/components/sight_reading/score_view.jsx` + `.module.css` (title row, ended strip, score plate with toolbar/shade pills/legend/pager, grid fallback per §D11, mounts `ScoreSheet`, `BarPopup`, `SetupPane`; `ensureAnnotation` on mount/piece change).
- Add: `static/js/st/components/sight_reading/setup_pane.jsx` + `.module.css` (plan.md §D7, moving `renderDeck`/`renderPassages`/handlers from `settings_panel.jsx`).
- Add: `static/js/st/components/sight_reading/bar_popup.jsx` + `.module.css` (plan.md §D6, using `barPopup()` from Task 2).
- Modify: `static/js/st/components/pages/score_page.jsx` — set `ScoreView` to the real component (replacing Task 4's placeholder).
- Modify: `static/js/st/global.css` — the new tokens table in plan.md §D (`--salon-gilt-deep`, `--salon-gilt-mid`, `--salon-pip-rule`, `--salon-gilt-ink`, `--salon-ink-faint`, `--salon-learn-0..3`, `--salon-mark-clean/near/trouble`, `--salon-heat-tint-1..4`, `--salon-selected-tint`).
- Test: `static/js/spec/score_view_spec.js` (new) — the at-rest cases.

**Acceptance Criteria:** from plan.md's `score_view_spec.js` bullets (lines 462-475), the at-rest subset: mount shows the score view (no `[data-score-card]`, no "Programme" pill, "Tonight's session"/"At rest", title "Fixture the score", "Page 1 of 2 · bars 1–15" at 1440×`viewportHeight=1240`, 15 bar buttons, disabled "Previous page", "Next page" shows bar 16); shade pills switch tints/legends and "This session" is absent pre-session; clicking "Bar 5" opens the dialog "Bar 5 stats" with "Passage I · Hardest", Escape/× close it, "Practise bar 5" sets free practice 5–5 "all" (verify the settings write only here — the "begins the session" half of that acceptance criterion is checked in Task 8 once Begin→session is wired through `ScoreView`); learnedness after three clean passes of bar 1 shows "Learned" and "Learned 1 /16" in the programme figures; no piece → "Sheet music, import a piece to begin" and the Piece-only setup pane; no source / engine failure → the bar grid with `SCORE_VIEW_NO_SOURCE`/`SCORE_VIEW_FAILED`; no horizontal overflow at 390px; review-pane and passage-pane cases moved/added per plan.md (review pane wiring can open the existing `review_pane.jsx` unchanged — passage pane is built fully in Task 7, so here just confirm the difficulty tag is a button that calls through to an `onTag` prop the real passage pane will consume next).

**Verify:** full `npm test` green; `make lint_js`; `PORT=<n> npm run dev`, open `/sheet-music`, import the fixture, screenshot at 1440×1240 and 390×844 and compare against plan.md's "Visual acceptance" item 1 and 2 (lines 489-504).

**Steps:**
1. Read plan.md §D1-D7 and §D11 (lines 103-275) completely, and the design artboards `Main.dc.html` and `BarStats.dc.html` (read the actual files under the design folder, not just canvas.json, for exact markup/classes/copy) before writing any JSX.
2. Read today's `static/js/st/components/score_card.jsx`, `score_render/load.js` (`loadScoreEngines`), `data.jsx`'s `scoreStaff`/`keyLabel`/`measureNumberList`/`sheetMusicSection`/`sheetMusicPassages`/`passageSettings`/`pulledPassage`/`programmePassages`/`scoreEnginesPath`, `difficulty/sections`'s `flagsInForce`, and `settings_panel.jsx`'s `renderDeck`/`renderPassages`/`importPiece`/`exportLibrary`/`importLibrary`/`importFlags`/`pickPiece` (lines ~774-971) before moving them.
3. Write `score_view_spec.js`'s at-rest cases from the Acceptance Criteria first (mount `ScorePage` with `openTestStore`, import the fixture via `importMusicXMLPiece`, 1440-wide container, `viewportHeight={1240}` prop); confirm they fail.
4. Build `score_sheet.jsx` first (pagination/overlay plumbing, no shade logic yet — pure rendering of whatever `shade`/`selected` props it's given), verified against `score_pages_spec.js`'s already-correct math.
5. Build `setup_pane.jsx`, moving the cited handlers from `settings_panel.jsx` unchanged (delete them there once moved, per plan.md's Files table — but only after Task 5 fully compiles, to avoid a half-moved intermediate state within this task's single commit).
6. Build `bar_popup.jsx` from `barPopup()`'s model (Task 2).
7. Build `score_view.jsx` tying `score_sheet.jsx` + `setup_pane.jsx` + `bar_popup.jsx` together: title row, ended strip (render only — End session wiring lands fully once Task 4's state machine is connected here), toolbar/shade pills/legend/pager, §D11 fallbacks.
8. Add the `global.css` tokens table verbatim from plan.md §D.
9. Wire `score_page.jsx`'s `ScoreView` to the real component; confirm Task 4's placeholder is gone.
10. Run full `npm test`; fix until green; `make lint_js`. Then `PORT=3791 npm run dev` (or any free port), screenshot both viewport sizes, and compare against the design folder's artboards and assets per plan.md's Visual acceptance items 1-2.
11. Commit: `git add -A -- static/js/st/components/score_sheet.jsx static/js/st/components/score_sheet.module.css static/js/st/components/sight_reading/score_view.jsx static/js/st/components/sight_reading/score_view.module.css static/js/st/components/sight_reading/setup_pane.jsx static/js/st/components/sight_reading/setup_pane.module.css static/js/st/components/sight_reading/bar_popup.jsx static/js/st/components/sight_reading/bar_popup.module.css static/js/st/components/pages/score_page.jsx static/js/st/global.css static/js/spec/score_view_spec.js && git commit -m "st: build the score-first at-rest view (ScoreSheet, ScoreView, setup pane, bar pop-up)"`.

---

## Task 6: Session rail and `planUpcoming` (plan.md §D8-D9, §Files "Add": `session_rail.jsx`; "Change": `plan_cards.js`, `srs/planner.js`; §Tests "srs_planner_spec.js" and the session-view parts of `score_view_spec.js`)

**Goal:** Build the in-session right rail ("This session" progress/grid/Up next, "This evening") and wire Begin/Rest/Resume/End session through `ScoreView ↔ session view` fully, completing the Task 4 state machine's connection to real UI.

**Files:**
- Add: `static/js/st/components/sight_reading/session_rail.jsx` + `.module.css` (plan.md §D9).
- Modify: `static/js/st/srs/planner.js` — export `planUpcoming(input, count)` (candidates minus the entry on the stand, deduped by measure, first `count`, pure, doc-commented as a preview) and `upNextWords(entry, passage)`. No rule changes.
- Modify: `static/js/st/plan_cards.js` — `upNext(count)` over `planUpcoming(this.deck.planInput(), count)` with `passageOf`; the read-through flag reaches the pass report (ties into Task 1's `barPasses`).
- Modify: `static/js/st/components/pages/score_page.jsx` — set `SessionRail` to the real component.
- Modify: `static/js/st/components/pages/sight_reading_page.jsx` — render `SessionRail` as the rail in session view; the keyboard footer renders only in the session view on this page (plan.md §D1).
- Test: `static/js/spec/srs_planner_spec.js` (new cases), `static/js/spec/score_view_spec.js` (session-view cases).

**Acceptance Criteria:** plan.md's `srs_planner_spec.js` bullets (lines 458-460): `planUpcoming` returns `planNext`'s entry order without the on-the-stand entry, deduped, never mutating input; `upNextWords` covers every reason (`NEW`/`RETRY`/`LADDER`/`WAIT`/`REVIEW`/`EARLY`/`RUN_THROUGH`/`READ_THROUGH`) and passage role per plan.md §D9's wording table (lines 229-230). Plus `score_view_spec.js`'s session-view bullets (lines 466-468): Begin → session view (`[data-score-card]` present, setup pane gone, "This session" present, eyebrow "In session · Fixture"); Rest → "At rest" banner, no `<dialog>`, a keypress counts nothing, clock stays put; Resume → same stats id, Notes read keeps counting; End session (running or paused) → strip whose percentage equals the last Accuracy card, bar marks on played bars, shade switches to "This session"; Done → no strip, shade back to Learnedness; Play on → session view, same session id; End session with nothing played → no strip.

**Verify:** full `npm test` green; `make lint_js`; dev-server screenshot of the session view at 1440×1240 and 390×844 against plan.md's Visual acceptance item 3 (lines 505-512).

**Steps:**
1. Read plan.md §D8-D9 (lines 208-237) completely, plus `Session.dc.html` for exact markup/copy, and today's `srs/planner.js` (`candidates`, `planNext`, `daysAgo`) and `plan_cards.js` (`PlanGenerator`/`PlanDeck`) before writing code.
2. Write the `srs_planner_spec.js` new cases first; confirm failing; implement `planUpcoming`/`upNextWords` as pure additions (no change to any existing exported behavior — grep every existing caller of `planner.js` exports to confirm none are touched).
3. Implement `plan_cards.js`'s `upNext(count)`.
4. Write `score_view_spec.js`'s session-view cases; confirm failing.
5. Build `session_rail.jsx` (clock/progress bar, the piece-position grid with tick labels, Up next rows, "This evening" rows reading the session log from Task 4's `state.sessionLog`).
6. Wire `SessionRail` into `score_page.jsx` and the trainer's render (`sight_reading_page.jsx`): rail swaps between the default rail (exercises) and `SessionRail` while `view=="session"`; keyboard footer only renders in session view on this page.
7. Confirm the full Begin→session→Rest→Resume→End session→score round trip now passes in `score_view_spec.js`.
8. Run full `npm test`; `make lint_js`; dev-server screenshots.
9. Commit: `git add -A -- static/js/st/components/sight_reading/session_rail.jsx static/js/st/components/sight_reading/session_rail.module.css static/js/st/srs/planner.js static/js/st/plan_cards.js static/js/st/components/pages/score_page.jsx static/js/st/components/pages/sight_reading_page.jsx static/js/spec/srs_planner_spec.js static/js/spec/score_view_spec.js && git commit -m "st: build the session rail, planUpcoming preview, and complete the score-first session round trip"`.

---

## Task 7: Passage pane and the Review link (plan.md §D4 "tags", §F passage-detail row, §Files "Add": `passage_pane.jsx`; §Tests "score_view_spec.js" passage/review cases; §Open question 4a/4b)

**Goal:** Move the passage detail view and flagged-passage list into a right `SidePane` opened by the score's difficulty tags, and wire "Review the passages" in the Score-difficulty legend to the existing Review pane.

**Files:**
- Add: `static/js/st/components/sight_reading/passage_pane.jsx` + `.module.css` (moved from `passages_plate.jsx:376-466`: detail — reasons, tip, Practise, hand pill, Edit — and the flagged list).
- Modify: `static/js/st/components/sight_reading/score_view.jsx` — mount `PassagePane` in a `SidePane`, opened by a difficulty tag click (`onTag`); mount the existing `review_pane.jsx`'s `ReviewPane`, opened by "Review the passages" in the Score-difficulty legend.
- Test: `static/js/spec/score_view_spec.js` (passage pane + review pane cases, migrated from `passages_plate_spec.js`).

**Acceptance Criteria:** plan.md's remaining `score_view_spec.js` bullets on this topic (lines 474-475): Review pane opens from "Review the passages"; accept/dismiss/export work as before (cases moved from `passages_plate_spec.js`); a difficulty tag opens "Passage I of I"; Practise begins on bars 5–9 at once (hand pill included, per plan.md §F's passage-detail row and Open question 4a).

**Verify:** full `npm test` green; `make lint_js`.

**Steps:**
1. Read plan.md's Open questions 4a/4b (lines 572-573) and §F's row for the passage detail plate and "Your trouble spots"/Review (lines 317-319), plus today's `passages_plate.jsx:376-466` and `review_pane.jsx` end to end before moving anything.
2. Write the migrated/new spec cases in `score_view_spec.js` first (reading the equivalents out of `passages_plate_spec.js` and adapting their assertions to the new pane), confirm failing.
3. Build `passage_pane.jsx` with the moved detail+list code, Practise beginning the session at once exactly like the bar pop-up's Practise (reuse the same settings-then-begin path from Task 5/6, not a new one).
4. Wire it into `score_view.jsx` behind the difficulty tag buttons from Task 5's `score_sheet.jsx` `onTag` prop, and wire the Review pane open from the Score-difficulty legend's link.
5. Run full `npm test`; `make lint_js`.
6. Commit: `git add -A -- static/js/st/components/sight_reading/passage_pane.jsx static/js/st/components/sight_reading/passage_pane.module.css static/js/st/components/sight_reading/score_view.jsx static/js/spec/score_view_spec.js && git commit -m "st: move passage detail into a side pane opened from the score, wire the Review link"`.

---

## Task 8: Remove old plates/drawer, migrate specs (plan.md §Files "Delete"; §Files "Change" `settings_panel.jsx` deletion of `ScoreDrawer`; §Tests "sight_reading_page_spec.js" migration bullet)

**Goal:** Delete everything plan.md's §F table marks "Removed" with no remaining caller, and migrate/rewrite every existing spec case plan.md names so the exercises page is provably unaffected and the score page's old-drawer/old-rail/old-summary assertions become setup-pane/strip assertions.

**Files:**
- Delete: `static/js/st/components/sight_reading/programme_plate.jsx` + `.module.css`; `passages_plate.jsx` + `.module.css`; `bar_stats_plate.jsx` + `.module.css`; `static/js/spec/passages_plate_spec.js` (cases already moved in Task 5/7).
- Modify: `static/js/st/components/sight_reading/settings_panel.jsx` — delete `ScoreDrawer` (confirm no remaining import anywhere first); keep `SidePane`, `SettingsDrawer`, `ProgrammeDrawer`, `TempoSettings`, `GeneratorSettings` for the exercises page and `/setup`.
- Modify: `static/js/spec/sight_reading_page_spec.js` — migrate/rewrite exactly the named cases in plan.md lines 479 ("opens, closes and applies the programme drawer", "keeps the sheet music deck, measure range and hand in the score page's drawer", "carries the programme's plates in the rail", "suggests the piece in study most overdue", "offers today's programme order on the plate and in the drawer", "on the score page, hides Practise these notes and opens the drawer from New programme", "lists an acoustic session in the rail as passes graded after Rest", "opens the summary with the three acoustic cards…", "keeps its own rail, unlike the score page's wider one"), each re-pointed at the setup pane / strip / session rail as appropriate, with any case that only tests the exercises page left untouched.
- Test: as above (spec files are the deliverable here, no production spec file is new).

**Acceptance Criteria:**
- [ ] `grep -rl 'ScoreDrawer\|ScoreRail\|programme_plate\|passages_plate\|bar_stats_plate' static/js` returns only this task's own diff removing them (i.e., zero remaining references after the commit).
- [ ] Every named spec case above exists, migrated, and passes.
- [ ] The exercises-page-only cases in `sight_reading_page_spec.js` are bit-for-bit unchanged from base commit `d5749824` (`git diff d5749824 -- static/js/spec/sight_reading_page_spec.js` shows only the named cases touched).

**Verify:** `npm test` green; `make lint_js`; `git diff d5749824ad80d33c8d01ce7f9bc4eccbd06c583a -- static/js/spec/sight_reading_page_spec.js | grep -c '^[+-]'` sanity-checked against only the named cases changing.

**Steps:**
1. Grep every current importer of `ScoreDrawer`, `ScoreRail`, `programme_plate.jsx`, `passages_plate.jsx`, `bar_stats_plate.jsx` across `static/js` to confirm each is dead after Tasks 4-7's moves, before deleting.
2. Delete the files and their specs.
3. Migrate each named `sight_reading_page_spec.js` case one at a time: read its current assertion, decide its score-page equivalent per plan.md §F's disposition table, rewrite, run it, move to the next.
4. Remove `ScoreDrawer` from `settings_panel.jsx`.
5. Run full `npm test`; `make lint_js`.
6. Commit: `git rm` the deleted files, `git add -A -- static/js/st/components/sight_reading/settings_panel.jsx static/js/spec/sight_reading_page_spec.js && git commit -m "st: remove the old drawer/rail plates and migrate their specs onto the score-first view"`.

---

## Task 9: Tokens/docs/AGENTS.md, full visual acceptance pass, owner-check dry run (plan.md §D tokens table already added in Task 5 — this task is the docs + final visual/owner-check gate; §Files "Change": `docs/design/salon-de-chopin.md`, `AGENTS.md`; §Visual acceptance all 4 items; §Owner check)

**Goal:** Document the shipped design, correct AGENTS.md's now-stale sentences, and run the full visual-acceptance and owner-check scripts end to end as the final gate before review.

**Files:**
- Modify: `docs/design/salon-de-chopin.md` — add screen section "6. Sheet music, score first" (plan.md line 396: cover the four screens, the build notes, the new tokens; point to the canvas URL, do not copy the artboards into the repo).
- Modify: `AGENTS.md` — rewrite only the "Imported sheet music…" bullet's rail/plates sentences around `ScoreView`/`SessionRail`/`restPauses`, the spec pattern `{...SCORE_PROGRAMME, ScoreView: null}`; add `passes` to the practice-records bullet ("read by `st/bar_progress` only; never by the scheduler or planner"). Per the project-memory rule in the operational brief: correct only text this change makes wrong, add nothing else, keep it concise.

**Acceptance Criteria:**
- [ ] All 4 "Visual acceptance" items in plan.md (lines 489-519) hold, checked by this builder's own screenshots at 1440×1240 and 390×844 on the running dev server with the fixture imported.
- [ ] The "Owner check" script in plan.md (lines 578-593) runs clean end to end on this branch (steps 1-7), substituting this task's own port for 3791.
- [ ] `npm test` and `make lint_js` both green at the final head.
- [ ] `npm run build_assets` succeeds.
- [ ] AGENTS.md's edited bullet contains no sentence now false, and no new knowledge beyond correcting the drawer/rail/plates/spec-pattern text and the one `passes` clause.

**Verify:** `npm test && make lint_js && npm run build_assets`; manual visual walkthrough per plan.md's Owner check steps 1-7, screenshots attached to the PR description in Task 10.

**Steps:**
1. Re-read plan.md's full §D "Visual acceptance" (lines 485-519) and "Owner check" (lines 578-593) sections.
2. Run `PORT=<n> npm run dev`; open `/sheet-music`; import the fixture (`tools/fingerings/tests/fixture/score.musicxml`) into a clean browser profile (or clear the IndexedDB store first) so the "no prior history" owner-check path applies.
3. Walk Owner-check steps 1-7 exactly, taking a screenshot at each major state (score view learnedness/difficulty shades, bar pop-up, session view, paused banner, ended strip, phone width) at 1440×1240 then 390×844.
4. Compare every screenshot against the cited artboard/asset file in the design folder; note and fix any visible mismatch before moving on (do not defer visual bugs to code review).
5. Write the `docs/design/salon-de-chopin.md` section and the `AGENTS.md` correction.
6. Run `npm test && make lint_js && npm run build_assets`; fix until all three are clean.
7. Commit: `git add -A -- docs/design/salon-de-chopin.md AGENTS.md && git commit -m "docs: document the score-first sheet music design and correct AGENTS.md"`.

---

## Task 10: Verification, review, and PR (superpowers-extended-cc:verification-before-completion → requesting-code-review → finishing-a-development-branch)

**Goal:** Run the full verification suite one more time at the final head, request and act on a code review, then open the PR per the operational brief's Definition of done.

**Files:** none (process only).

**Acceptance Criteria:**
- [ ] `make lint_js`, `npm run build_assets`, `npm test` all pass at the final commit.
- [ ] Code review findings (via `/code-review`) are triaged and acted on (fixed or explicitly deferred with reasoning) before pushing.
- [ ] PR opened via `gh-axi`, not a draft (`gh-axi pr view <n>` prints `draft: no`).
- [ ] Owner preview server started per the brief (port 4186 for this task, `bench-score-first-1-sp`), confirmed answering 200 at `/sheet-music`.

**Verify:** `gh-axi pr view <number>` shows `draft: no` and all CI checks green.

**Steps:**
1. Invoke `superpowers-extended-cc:verification-before-completion`; run every command it asks for; do not claim success without captured command output.
2. Invoke `superpowers-extended-cc:requesting-code-review`; run `/code-review` (or the review path that skill resolves to) over the branch's diff against `d5749824ad80d33c8d01ce7f9bc4eccbd06c583a`; act on every finding (fix, or note in the PR description why not).
3. Invoke `superpowers-extended-cc:finishing-a-development-branch`, choosing "open a PR".
4. Push `fm/bench-score-first-1-sp`; open the PR with `gh-axi`; confirm it is not a draft (mark ready if needed).
5. Write `/tmp/bench-score-first-1-sp-preview.mjs` importing this copy's `dev/serve.mjs`; start it with `PORT=4186 nohup node /tmp/bench-score-first-1-sp-preview.mjs > /tmp/bench-score-first-1-sp-preview.log 2>&1 &`; confirm `http://localhost:4186/sheet-music` answers 200.
6. Wait for CI to go green on the PR (poll `gh-axi pr checks`); only then append the `done:` status line with the PR URL and preview pid, per the operational brief.

---
