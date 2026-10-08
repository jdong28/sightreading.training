# Handoff: Sight Reading Trainer — "Salon de Chopin" UX facelift

(Verbatim copy of the design handoff README from the Claude Design project, 2026-09-14,
except for the **Implementation** notes added under a screen as it lands.)

## Overview

An existing sight-reading practice web app is being inherited, extended, and given a visual/UX
facelift. This package covers five screens in a single visual direction ("Salon de Chopin" — an
1836 Paris salon: damask ivory wallpaper, Didone display type, engraved plates with double rules
and gilt corner lozenges, oxblood as the only action colour).

Scope of this handoff: the **onboarding**, **setup/programme**, **trainer** (the existing core
screen, restyled + new feedback states), **session summary**, and **progress** screens.

## About the design files

The files in `screens/` are **design references authored in HTML** — prototypes showing intended
look and behaviour. They are **not production code to copy**. The task is to recreate these
designs inside the existing app's environment, using its established component patterns, router,
state management, and build setup.

Two consequences worth stating plainly:

- The prototypes render inside a design-system harness (`support.js`, `ds-base.js`, a compiled
  design-system bundle). Opened in isolation they will not paint. Read them as specification —
  markup structure, exact values, copy — not as runnable files.
- The trainer prototype mounts the app's **real** staff and keyboard components
  (`SightReading.StaffTwo`, `SightReading.Keyboard`) from the existing codebase. That part is
  already proven against the real components; the surrounding chrome is what's new.

## Fidelity

**High-fidelity.** Colours, typography, spacing, borders, shadows and copy are final and should be
matched. Data values shown (246 notes read, 94%, the 14-day bar chart, the note-accuracy grid) are
**representative sample data** — wire them to real values. Layout and interaction are specified;
animation is limited and described below.

## Screens

### 1. Onboarding (first run) — `screens/salon-onboarding/SalonOnboarding.dc.html`

**Purpose:** first launch. Pair a MIDI instrument and set expectations before any practice.

**Layout:** full-viewport wallpaper ground, flex-centred. Single card, `max-width: 620px`,
`padding: 42px 46px 38px`, on paper `#fdfaf4` with a 1px `#cdbfa4` border, the engraved
double-inset shadow (below) and four 6×6px gilt lozenges rotated 45° pinned 8px from each corner.

**Components, top to bottom:**
- Eyebrow: `11px/700`, `letter-spacing: .26em`, uppercase, `#5a5243` — "Salon de Paris · 1836"
- Title: Bodoni Moda 400, `42px`, `line-height: 1.05`, `letter-spacing: -.01em`; the word
  "invitation" in italic
- Fleuron rule: two 88px gradient hairlines (`transparent → #c9b48c`) flanking a `❖` in `#a8824a`
- Lede: Bodoni Moda italic `16.5px/1.55`, `#4a4335`, `max-width: 430px`, centred
- `3px double #cdbfa4` divider
- Three steps, each a row: Roman numeral (Bodoni `19px`, `#7d2c2c`, `min-width: 28px`) + title
  (`13.5px/1.45`) + sub-line (`11.5px`, `#5a5243`); rows separated by `1px solid #e7dcc8`
- **Device status strip** — three exclusive states on `#f6efe1`, `padding: 14px 18px`:
  - `connected`: solid border `#ddd0b8`, 8px oxblood dot with a `0 0 0 3px rgba(125,44,44,.14)`
    ring, device name in uppercase tracking, "at the ready" italic right
  - `listening`: **dashed** `#cdbfa4` border, gilt dot, "Listening for an instrument" / "press any key"
  - `none`: hollow gilt-outlined dot, "No instrument found" / "check the cable"
- Actions: primary pill "Take your seat" → setup; ghost pill "Use the on-screen keys" → trainer

**State:** `deviceState: 'connected' | 'listening' | 'none'`, `deviceName: string`.

### 2. Setup / programme — `screens/salon-setup/SalonSetup.dc.html`

**Purpose:** choose what to practise, then begin.

**Layout:** header (wordmark + device/user status + horizontal nav) → centred title block → degree
cards row → two-column body `grid-template-columns: minmax(0,1fr) 300px`, `gap: 22px`,
`align-items: start`. Main column `max-width: 1060px`, `padding: 26px 34px 44px`.

**Components:**
- **Degree cards** (I–V): `repeat(auto-fit, minmax(150px,1fr))`, `gap: 12px`. Card = paper,
  `1px solid #e7dcc8` with a `3px double #cdbfa4` **top** border, `padding: 15px 16px 17px`.
  Roman numeral Bodoni `22px` `#a8824a`; name Bodoni `16px`; description `11px/1.4` `#5a5243`.
  Selected card inverts: `#7d2c2c` ground, `#e8c99a` numeral, `#fdfaf4` name, `#f0dcc4` description,
  `3px double #c58f8f` top border, `0 3px 10px -3px rgba(36,31,24,.4)`. Locked card: `opacity: .62`.
- **Choice panel** (left): clef pills, key-signature pills, exercise list, tempo slider.
  - Pills: `border-radius: 999px`, `padding: 9px 18px`, `12px/700`. Unselected: transparent with
    `1px solid #ddd0b8`, `#4a4335`. Selected: `#7d2c2c` ground, `#fdfaf4` text, no border,
    `0 1px 2px rgba(36,31,24,.22)`.
  - Key pills use Bodoni `15px`, `padding: 7px 15px` (glyphs, not labels).
  - Exercise rows: Bodoni `16px`, `12px 0`, `1px solid #e7dcc8` separators; selected row shows a
    `❖` in `#a8824a`, others a right-aligned `11px` uppercase qualifier.
  - Tempo slider: 4px `#e7dcc8` track, `#a8824a` fill, 16px knob (`#fdfaf4`, `1px solid #a8824a`,
    `0 1px 4px rgba(36,31,24,.28)`), Largo/Andante/Presto legend beneath.
- **Programme summary plate** (right): engraved treatment with 5px lozenges, "Your programme"
  header over a double rule, "Degree *III*" Bodoni `26px`, italic subtitle, three label/value rows,
  full-width primary pill "Begin reading" → trainer.
- Pull quote beneath, Bodoni italic `15.5px/1.5`, centred.

**State:** `degree`, `clef`, `keySignature`, `exercise`, `tempo`, `range`. `showDegrees: boolean`
hides the degree row for a reduced variant.

### 3. Trainer — `screens/salon-chopin/SalonChopin.dc.html`

**Purpose:** the practice loop. This is the existing screen, restyled, plus feedback states.

**Layout:** left settings drawer (overlay) + header + main + fixed-height keyboard footer.
Main: `max-width: 1060px`, `grid-template-columns: minmax(0,1fr) 260px`, `gap: 22px`.

**Components:**
- **Programme drawer:** `position: fixed`, `width: 312px`, left-anchored, `#fdfaf4`,
  `border-right: 1px solid #cdbfa4`, `box-shadow: 26px 0 54px -30px rgba(36,31,24,.45)`.
  Transform `translateX(-100%)` → `translateX(0)` over `.32s cubic-bezier(.22,.61,.36,1)`.
  Scrim `rgba(36,31,24,.32)`, opacity `.3s ease`, click-to-dismiss. Contents: clef, exercise,
  tempo (live `♩ = n`), key, and a "Take your seat" apply button that closes and regenerates.
- **Staff plate:** engraved figure (paper, `1px solid #cdbfa4`, the double-inset shadow, four
  lozenges), header row `4/4 · ♩ = n` left and status right in `#7d2c2c`, then the real
  `StaffTwo` component at `height: 150`, `maxScale: .3`, `min-height: 150px` reserved. The
  implementation draws both staff renderers smaller on the plate (`PLATE_STAFF_SCALE` in
  `sight_reading_page.jsx`).
- **Transport row:** primary pill toggling **Begin / Rest**; ghost pill "New passage"; right-aligned
  tempo term + bpm in Bodoni `16px`.
- **Live stat cards:** four cards, `repeat(auto-fit, minmax(130px,1fr))`, `gap: 14px`, same
  double-top-border treatment — Elapsed (`m:ss`), Accuracy (oxblood), Notes read, Best streak.
  Values Bodoni `26px/1`.
- **Right rail:** framed engraving slot (`190px` tall inside a `1px solid #e7dcc8` mat, 10px paper
  border, italic caption), "This evening" list with Roman numerals, pull quote.
- **Keyboard footer:** `#ece3d2` band with a 10px rosewood piano-lid gradient
  (`#4a2c1c → #2f1b11`, `box-shadow: 0 1px 0 #a8824a`) above a 116px keyboard well
  (`1px solid #cdbfa4`, `inset 0 2px 5px rgba(36,31,24,.18)`) holding the real `Keyboard`
  component, `C3`–`C6`.

**Feedback states (new, "gentle"):**
- *Correct note:* a gilt wash over the plate — `radial-gradient(70% 60% at 50% 45%,
  rgba(168,130,74,.24), transparent 72%)` inset 1px, opacity 0 → 1 → 0, `.42s ease` in,
  held 300ms. Cursor advances to the next column; the expected note is highlighted on the keyboard.
  **Not shipped**: the owner reviewed it on the trainer and asked for it to be removed, so a correct
  note advances the cursor with no plate effect. Only the ink smudge below ships.
- *Wrong note:* an **ink smudge** on the plate at the cursor's horizontal position —
  78×78px `radial-gradient(42% 38% at 50% 50%, rgba(36,31,24,.4), rgba(36,31,24,.14) 56%,
  transparent 78%)`, `filter: blur(1.5px)`, fades over `.55s`, cleared after 900ms. The cursor does
  **not** advance, no sound penalty, streak resets to 0, miss count increments. Nothing else changes.
- Reaching the end of a passage regenerates a new one after 280ms.
- The ink smudge is implemented by `PlateFeedback`
  (`static/js/st/components/sight_reading/plate_feedback.jsx`), which owns its hold and placement:
  the page bumps one counter per judgement, so a wrong chord inks as a single wrong note does, and
  every wrong key inks whether or not the stats counted it. The implementation centres the smudge on
  the drawn heads of the head column vertically as well as horizontally, clamped inside the plate,
  and falls back to the centre of the staff when no head is drawn. Not drawn in acoustic mode, where
  nothing is detected to react to.

**State:** `notes` (NoteList), `keySignature`, `held` (map), `clef`, `tempo`, `session` (bool),
`cursor` (index into columns), `readCount`, `misses`, `streak`, `best`, `secs`.
Session is **endless** — it runs until the user presses Rest; there is no note or time target.
`accuracy = readCount / (readCount + misses)`.

**Implementation note (sheet music page):** `/sheet-music` no longer shares this screen's drawer,
rail or rail plates. It is its own screen now, §6 below: the piece's own engraved score at rest
(shaded, paginated, with a bar pop-up and a passage pane in place of the shaded-score pane this
paragraph used to describe), and a session rail of its own in session. "Review the passages" still
holds the instructor's review (accept, edit, dismiss, restore, mark a passage, the hands-separately
tick, trouble spots, and the flags file), opened from the difficulty shade's legend rather than a
plate.

### 4. Session summary — `screens/salon-summary/SalonSummary.dc.html`

**Purpose:** shown when the user ends an endless session.

**Layout:** centred card, `max-width: 740px`, `padding: 40px 44px 36px`, engraved treatment.

**Components:** eyebrow (programme description) → "The session is *ended*" Bodoni `40px` →
fleuron rule → four stat cards on `#f6efe1` (`minmax(128px,1fr)`) → "Notes that gave trouble":
rows of note name (Bodoni `19px`, `min-width: 44px`), context label (`12px` `#5a5243`,
`min-width: 96px`), a 5px accuracy rule on `#eee3cf` filled oxblood below ~75% and gilt above,
and the percentage right-aligned → one italic insight sentence → actions: "Practise these notes"
(primary, seeds the trainer with the weak notes), "New programme" (ghost), "See all progress →".

**State:** `showTrouble: boolean`, `tone: 'encouraging' | 'plain'` (suppresses the insight line).

**Implementation:** the card is `SessionSummary`
(`static/js/st/components/sight_reading/session_summary.jsx`), a native `<dialog>` the trainer
opens at Rest from the `SessionRecord` it just wrote (`NoteStats#sessionRecord`), through the pure
derivations of `static/js/st/session_summary.js` (which the four stat cards, the trouble rows, the
weak-below-75% rule and the insight sentence all come from). The four stat cards are the live
Elapsed/Accuracy/Notes read/Best streak, or, for a sitting with nothing detected (acoustic
self-graded practice), the three live acoustic cards Elapsed/Passes/Clean. The context label next
to each trouble row is its miss count. "Practise these notes" switches the trainer to Random
notes focused on the weak rows alone, the ones drawn in oxblood
(`SightReadingPage#practiseNotes`), and is hidden when nothing shown is weak or on a page whose
generator can't take a seed (the sheet music generator, so the score page never shows it). "New
programme" is a link to `/setup` on the exercises page, and on the score page closes the card and
opens its own drawer instead. "See all progress →" links to `/stats` until the progress screen
(a later step) replaces it.

### 5. Progress — `screens/salon-progress/SalonProgress.dc.html`

**Purpose:** practice history.

**Layout:** header + nav → title block → four headline cards → two columns
`minmax(0,1fr) 300px`.

**Components:**
- **Bar chart**, 14 days: engraved plate, header "Minutes at the bench" with "Goal 10" in oxblood.
  `grid-template-columns: repeat(14,1fr)`, `gap: 7px`, `align-items: end`, `height: 150px`.
  Bars `#e0cfae` with a `2px solid #a8824a` cap; today's bar `#7d2c2c` with `#571d1d` cap; missed
  days are zero-height `#eee3cf` with a `#ddd0b8` cap. A `1px dashed #cdbfa4` goal line crosses the
  plot. Day numbers `11px/700` beneath, today in oxblood.
  **Scale: 1 minute ≈ 9px of bar height** in the sample (10 min goal sits at the dashed line).
- **By clef:** three rows, name + 5px rule + percentage; oxblood below 80%, gilt above.
- **By note:** 4-column grid of 8 tiles (C–B plus accidentals). Normal tile `#f6efe1` /
  `1px solid #e7dcc8` / `#5a5243` figure; weak tile (< 75%) `#f3e2df` / `1px solid #dcc3bf` /
  `#7d2c2c` figure.
- Primary pill "Tonight's programme" → setup.

**State:** `range` (14 days shown), `showNoteGrid: boolean`.

**Implementation:** `ProgressPage` (`static/js/st/components/pages/progress_page.jsx`) renders what
it's handed by the pure module `st/progress.js`, which folds the session records the trainer
already writes at Rest (`SessionRecord`, see `NoteStats#sessionRecord`); nothing here re-measures
anything. A practice day is the scheduler's local day (`localDay`, 4 am rollover), not midnight, so
a late evening is never split across two bars. A session's minutes are its `elapsedSeconds` (the
Begin-to-Rest clock PR 53 added), falling back to the older `activeSeconds` for a record written
before it. The goal line reads `practiceSettings().dailyGoalMinutes` (default 10), read-only here;
the plot's scale keeps the goal line at or under 60% of the 150px plot, shrinking to fit a longer
day's bar. By clef sums each session's own `clefs` counts, falling back to a clefless session's
`treble`/`bass` staff for the ones that can be split after the fact (`grand` and `chord` can't). By
note merges every spelling of a pitch class (`parseNoteOffset`) before taking a percentage, since a
hit and a miss of the same note can arrive under different spellings. A backend account
(`currentUser`) still sees the existing "Daily stats" page, unchanged; the route choice is
`statsPageFor` in `st/components/pages/stats.jsx`.

### 6. Sheet music, score first — `Main.dc.html`, `BarStats.dc.html`, `Session.dc.html`, `SessionEnded.dc.html`

**Purpose:** rebuilds `/sheet-music` around the piece's own engraved score rather than a settings
drawer and rail plates: the page opens on the score, Begin replaces it with the session, Rest
pauses instead of ending it, and every bar played is tinted with its own accuracy or learnedness.
Added after the original five-screen handoff above; it is its own package, read separately from
the rest of this file. Design of record: the four artboards named above plus their `canvas.json`
build notes and `assets/`, supplied with this build's plan rather than copied into this repo (they
reference `/_blob` assets and a design-system runtime not in this folder). `BarStats.dc.html` and
`SessionEnded.dc.html` are byte-identical to `Main.dc.html` except their default props
(`selectedBar` 5; `view` "session"), so `Main.dc.html`'s own layout covers all three; `Session.dc.html`
is the fourth, separate screen (`view` "session" with a card showing).

**Layout:** `max-width: 1400px`, `padding: 22px 34px 48px` (≤600px: `20px 16px 24px`). At rest and
in session alike: `display: flex; flex-wrap: wrap; gap: 22px`, main column `flex: 999 1 640px`,
right column `flex: 1 1 340px; max-width: 420px`, wrapping below the main column on phone. The
title row (no fleuron rule) sits above both: eyebrow `11px/700/.26em` uppercase, h1 Bodoni `38px/
400` (`30px` ≤600px) with an italic span, a right-aligned italic note at rest only. Fullscreen and
the keyboard footer behave as in the Trainer screen (§3), with the footer shown only in session.

**At rest (`Main.dc.html`):**
- **Score plate:** a toolbar (page indicator left; a "Shade bars by" pill group right —
  Learnedness/Score difficulty/Off, plus This session once a session has ended) over the piece's
  own engraving, paginated into whole systems and cropped by `viewBox` rather than redrawn per
  page (`score_render/score_pages.ts`). Each bar is an absolutely-positioned overlay button over
  its engraved position: tinted by the active shade, labelled at its top-left with the shade's own
  reading ("2 of 3", "71%"), and bordered in oxblood with `--salon-selected-tint` when selected — a
  free-practice section additionally carries a 4px gilt top border in every shade. In Score
  difficulty, one tag per flagged passage ("I · Hardest · bars 5–9", coloured oxblood/gilt/
  ink-muted by level) sits over its first bar on the page and opens the passage pane; in any other
  shade a free-practice section gets its own plain "Section · bars 5–9" tag in gilt-ink, one row
  higher so the two tags never collide. A legend below names the active shade's tints, with a
  "Review the passages" link in Score difficulty. A Previous/Next pager always shows, even for one
  page.
- **The bar pop-up:** opens beside the clicked bar (above it only on a page's last system), a
  300px paper plate with an oxblood border — header tag (passage name, or Learned/Learning/New),
  Latest/Best figures, an 8-point accuracy chart (or, acoustically graded, "Graded by ear: Stumbled
  → Clean → Easy"), a 3-pip learnedness streak, and a full-width "Practise bar N" pill that sets
  free practice on that bar alone and begins at once.
- **The passage pane:** a right-hand pane titled "Passage I of N", opened by a difficulty tag —
  the flagged passage's reasons, "How to practise it", Practise/hands-separately/Edit (all
  beginning the session at once, like the pop-up), beside the "Flagged passages" list.
- **"Tonight's session" (the setup pane, always on the right, no drawer):** piece picker and
  library actions; Session pills (today's programme / free practice) with Due/New/Learned figures,
  Order, Length for the programme, or Section/difficult-passage picks/Card order for free
  practice; Hand and Bars-per-card; Tempo (mode, speed, Keep tempo); a begin line summarising the
  picked settings, then Begin. Settings apply as picked — there is no separate "take your seat"
  step.

**In session (`Session.dc.html`):** the card plate (status line in oxblood; dims to `.55` opacity
while paused), a paused banner ("the clock is stopped and the card waits here"; Resume/End
session) in place of the card when paused, the unchanged transport row plus Rest (toggles to
Resume) and a separate End session pill, the four live stat cards, and the keyboard footer. The
right column becomes **"This session"**: the elapsed clock against the session target with a gilt
progress bar (free practice shows only the elapsed time and its bar range, no bar), a
piece-position grid (one cell a bar — Played/On the stand/Coming up) with tick labels at the first
bar, the hardest flag's bounds and the last bar, and up to three "Up next" rows (`PlanGenerator
#upNext(3)`, over the pure `planUpcoming`, for the programme; the next free-practice cards in
order; none in random order or a single whole-section card). Below it, **"This evening"** lists
the session's own last five passes (not the day's other sessions), each with its accuracy or, for
a self-graded pass, its grade word, oxblood under 80% or on Fell apart/Stumbled.

**Ended (`SessionEnded.dc.html`):** a strip above the score plate at rest — "Session ended", a
headline (accuracy, or acoustic "x of y passes clean"), a comparison with the piece's last session
on it, a second line ("N minutes · K bars played · each bar's accuracy is marked on the score"),
and Play on / Done. Every bar the session touched is tinted by its own session accuracy until Done,
after which the shade reverts to Learnedness.

**New tokens** (added to the palette in §Design tokens, this build only):

| Token | Value | Use |
| --- | --- | --- |
| `--salon-learn-0..3` | gilt at 7/17/29/44% alpha | learnedness tint, 0–2 clean passes in a row |
| `--salon-gilt-deep` | `#7a5326` | learnedness tint and border, 3 clean in a row ("Learned") |
| `--salon-mark-clean/near/trouble` | gilt-light / track / weak-ground, at low alpha | this-session tint, ≥100% / ≥80% / <80% |
| `--salon-heat-tint-1..4` | the heat ramp (§Design tokens) at low alpha | difficulty shading over the engraving |
| `--salon-selected-tint` | oxblood at 10% alpha | the selected bar's own fill, over any shade |
| `--salon-gilt-mid` | `#b89a63` | mid learnedness pip |
| `--salon-gilt-ink` | `#8a6a36` | the free-practice section tag |
| `--salon-pip-rule` | `#a8956f` | the pop-up streak's empty pips |
| `--salon-ink-faint` | `#8f8676` | the pager's disabled state |
| `--salon-track` | `#eee3cf` | the session clock's progress track |

**State:** `view: "score" | "session"`, `paused`, `ended` (the strip's model, or `null`), and
`sessionLog` (every pass since Begin, through pauses), on `SightReadingPage` itself
(`programme.restPauses`); the score view's own `shade`, `page` and `selectedBar`.

**Implementation:** `SightReadingPage` renders `programme.ScoreView` in place of its own grid at
rest and `programme.SessionRail` in place of the default rail in session
(`static/js/st/components/pages/score_page.jsx`'s `SCORE_PROGRAMME`); the exercises page sets
neither field and is unchanged. The score view, its setup pane, the passage pane and the bar
pop-up are `static/js/st/components/sight_reading/score_view.jsx`, `setup_pane.jsx`,
`passage_pane.jsx` and `bar_popup.jsx` (backed by `st/bar_stats.js`'s `barPopup`); the session rail
is `session_rail.jsx`, over the pure `planUpcoming`/`upNextWords` (`st/srs/planner.js`). Learnedness,
session marks and the ended strip's words are the pure `st/bar_progress.js`, read from an optional
per-bar pass history (`ItemRecord#passes`, written wherever a complete pass is written, never read
by the scheduler or planner). Pagination and the bar overlay boxes are the pure
`st/score_render/score_pages.ts`, over an engine's own `CardResult.measures`. The build notes,
every sample figure's source and the owner's settled design questions are in the plan this screen
was built from, not repeated here.

## Interactions & behaviour

| Interaction | Behaviour |
| --- | --- |
| Programme button | opens left drawer, `.32s cubic-bezier(.22,.61,.36,1)`; scrim `.3s ease` |
| Scrim / × / "Take your seat" | closes drawer; the apply button also regenerates the passage |
| Tempo track click | sets bpm from click position across a 40–200 range; fill + knob move to `(bpm-40)/160`; the term label (Largo/Adagio/Andante/Moderato/Allegro/Presto) and `♩ = n` update live |
| Begin / Rest | toggles the endless session and the elapsed clock (1s tick); label swaps |
| MIDI note-on | judged against the expected column note; correct → advances the cursor; wrong → ink smudge + streak reset |
| New passage | regenerates 8 columns, ~20% of which are two-note intervals; cursor resets |
| End of passage | auto-regenerates after 280ms; counters persist |
| Hover, primary pills | `#7d2c2c` → `#571d1d` |

Tempo terms: `<60` Largo, `<76` Adagio, `<108` Andante, `<120` Moderato, `<168` Allegro, else Presto.

**Input:** MIDI is the intended input path (Web MIDI: enumerate inputs, listen for note-on/off,
surface the device name in the header dot and in onboarding). The on-screen keyboard remains as a
fallback and for testing.

## Design tokens

**Colour**

| Token | Value | Use |
| --- | --- | --- |
| Ground | `#f3ece0` | page, behind wallpaper pattern |
| Paper | `#fdfaf4` | plates, cards, drawer |
| Paper warm | `#f6efe1` | inset stat cards, status strips |
| Band | `#ece3d2` | keyboard footer |
| Rule light | `#e7dcc8` | hairline separators, card borders |
| Rule | `#ddd0b8` | ghost-pill borders, nav underline |
| Rule strong | `#cdbfa4` | plate borders, all double rules |
| Gilt | `#a8824a` | ornament, lozenges, slider fill, chart caps |
| Gilt light | `#c9b48c` | fleuron gradient hairlines |
| Bar fill | `#e0cfae` | chart bars |
| Track | `#eee3cf` | accuracy rule tracks |
| Ink | `#241f18` | body text |
| Ink soft | `#4a4335` | quotes, secondary body |
| Ink muted | `#5a5243` | all uppercase labels (minimum contrast floor — do not lighten) |
| Oxblood | `#7d2c2c` | primary action, active nav, emphasis figures |
| Oxblood dark | `#571d1d` | primary hover |
| Piano lid | `#4a2c1c → #2f1b11` | rosewood band above keyboard |
| Heat ramp | `#f1e8d8 → #7d2c2c` (5 steps) | difficulty strip cells, score overview shading |

**Wallpaper** (page background, repeated on every screen):

```css
background-color: #f3ece0;
background-image:
  radial-gradient(circle at 16px 16px, rgba(150,112,58,.12) 0 3px, transparent 4px),
  radial-gradient(circle at 48px 48px, rgba(150,112,58,.09) 0 2px, transparent 3px),
  repeating-linear-gradient(90deg, rgba(120,90,50,.055) 0 1px, transparent 1px 22px);
background-size: 64px 64px, 64px 64px, auto;
```

**Engraved plate** (the signature surface):

```css
background: #fdfaf4;
border: 1px solid #cdbfa4;
box-shadow:
  inset 0 0 0 1px #fdfaf4,
  inset 0 0 0 2px #e7dcc8,
  0 2px 3px rgba(36,31,24,.06),
  0 20px 38px -24px rgba(36,31,24,.35);
```
Plus four 6×6px `#a8824a` squares, `transform: rotate(45deg)`, 8px from each corner.

**Typography**

- Display: **Bodoni Moda** (400, 500, 400 italic) — titles, figures, note names, list items.
  Sizes in use: 40–44px (page titles), 26–28px (figures), 19px (numerals), 15–16.5px (body italic).
  Titles carry `letter-spacing: -.01em`, `line-height: 1.02–1.05`.
- UI: **Raleway** — labels, pills, table text. `11px/700` with `letter-spacing: .14em–.26em` and
  uppercase for every label; `12–13.5px` for body UI text.
- **11px is the floor.** Nothing smaller anywhere.

**Spacing:** 4px base. Common: card padding `14–17px`, plate padding `20–26px`, grid gaps
`7 / 12 / 14 / 22px`, main padding `26px 34px`.

**Radii:** `999px` on pills and knobs only. Everything else is **square** — plates, cards and
inputs have no radius. This is deliberate; rounding them breaks the period feel.

**Rules:** `3px double #cdbfa4` is the section-header and card-top rule. `1px solid #e7dcc8` is the
list separator. Both appear on every screen.

## Assets

- **Fonts:** Bodoni Moda via Google Fonts (`ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400`);
  Raleway is already in the app.
- **Ornaments:** text glyphs only — `❧`, `❖`, `·`, `▲`. No icon font, no SVG.
- **Engraving image** (trainer right rail): a placeholder slot in the prototype. Needs one
  period engraving of a Paris salon, c. 1836 — public-domain source, `object-fit: cover`,
  ~260×190. Caption: "Soirée at the Hôtel Lambert".
- **Piano lid, chart bars, smudge, gilt pulse:** pure CSS, no assets.

## Known upstream issue to carry over

The existing `StaffTwo` component has a mount/unmount race: `componentWillUnmount` dereferences
`state.two`, which `setupTwo` assigns asynchronously, and first paint can reach `getAsset` before
asset refs exist. Both throw into the React error boundary. The prototype patches the prototype
methods defensively (guard the unmount path; retry `renderStaves` on the next tick after clearing
`assetCache`/`staves`). **Fix this properly in the component** rather than porting the patch —
see the `patchStaffTwo` method in the trainer prototype for the exact failure modes.

## Navigation

Navigation between the prototypes follows the intended flow: onboarding → setup → trainer →
summary → progress → setup.
