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

**Implementation note (sheet music page):** `/sheet-music` no longer uses this screen's own left
drawer, right rail or Begin/Rest transport at rest — see §6, "Sheet music, score first", for its
current design (the score itself replacing the trainer's grid at rest, a "Tonight's session" setup
pane in place of the drawer, Rest pausing in place rather than ending). This screen's trainer
(drawer, staff plate, transport, stat cards, right rail, feedback states, keyboard footer) still
describes `/sheet-music` once a session is running, and every other page that shares the trainer
(the exercises page above all).

### 4. Session summary — `screens/salon-summary/SalonSummary.dc.html` (retired: the rest strip)

**Purpose:** what the player is told when an endless session ends on the exercises page.

The full-screen summary pop-up this prototype drew (a native `<dialog>` with four stat cards, the
trouble rows and an insight sentence) was removed for being too intrusive: Rest no longer opens
anything. The summary is now **Today's practice** (§7), a tab the player goes to, never one that
opens by itself, and Rest leaves a quiet **rest strip** under the stat cards.

**Components:** the strip is `EndedStrip`
(`static/js/st/components/sight_reading/ended_strip.jsx`), the same strip the score page shows
above the score once a session ends (§6): eyebrow "Session ended", the session's accuracy in Bodoni
`30px` with "accuracy" in italic, a line of what it was ("1 minute · 47 notes read"), a line to
"Today's practice →" (`/stats`) with the day's minutes ("6 of 10 minutes today", or "15 minutes
today, goal 10 met"), and its actions: "Practise these notes" (ghost, only when a note missed is
weak, and never on a page whose generator can't take a seed or after a chord session) and "Done".

**Implementation:** `SightReadingPage#renderRestStrip`, from the `SessionRecord` Rest just wrote
(`NoteStats#sessionRecord`, kept in `state.rested`: Begin, Done and Clear stats take the strip
away). The minutes count the record by its id (`todayMinutes` in `st/practice_day.js`), as the cache
holds the record only once its write lands. "Practise these notes" switches the trainer to Random
notes focused on the weak notes (`troubleNotes` and `focusFromRows` in `st/session_summary.js`,
weak below 75%; `SightReadingPage#practiseNotes`), staying at rest. The "This evening" list in the
rail counts the same practice day as Today does (`localDay`, from 4 am).

### 5. Progress — `screens/salon-progress/SalonProgress.dc.html` (the practice record's "Last 14 days" tab)

**Purpose:** practice history. Statistics is the practice record (§7): this screen is its tab
**Last 14 days**, at `/stats/last-14-days`, under the same tabs as Today.

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
`statsPageFor` in `st/components/pages/stats.jsx`, which gives a local user the practice record
(`PracticeRecordPage`, whose `last-14-days` route is this screen).

### 6. Sheet music, score first — Claude Design canvas "Score-First Sheet Music Page"
(`https://claude.ai/artifact/CXadj5P7neXEb6sFQ4WRNy`, version `1791445219-6dee`, "the settled
design")

**Purpose:** rebuild `/sheet-music` so the piece's own engraved score, not a drawer, is the page:
at rest the score replaces the trainer's grid entirely, beside a setup pane that replaces the old
Programme drawer and rail plates (§3's implementation note). In session the score gives way to the
usual card, transport and stat cards, with a session-progress rail in place of the default one.
Ending a session returns to the score with a strip marking what was just played. The canvas is four
artboards in flow order (`Main`, `BarStats`, `Session`, `SessionEnded`); the fixture piece is
`tools/fingerings/tests/fixture/score.musicxml` (16 bars, grand staff, C major), and every number
shown is sample data.

**Owner's build notes** (the canvas's own `notes.build` sticky, verbatim):
1. One layout throughout: score on the left, session setup pane always on the right.
2. Learnedness: a clean pass is 100% accuracy. Three clean passes in a row = learned; a miss resets
   the count. Bars are tinted in four gold steps (0, 1, 2, 3 clean passes) with a small label above
   each played bar. Unplayed bars have no tint.
3. Clicking a bar opens a pop-up anchored to that bar (latest, best, accuracy for each time played,
   progress to learned, Practise). The setup pane does not change.
4. In a session, Rest only pauses. End session is a separate button and returns to the score view.
5. After End session, a strip above the score shows the session accuracy, and each bar played is
   tinted and labelled with its accuracy. Done dismisses it back to the learnedness view. There is
   no full-screen summary.
6. Placeholders to confirm: the 80% line between "nearly" and "trouble", and every number shown.

**Score** (`Main.dc.html`, `components/score_sheet.jsx` + `components/sight_reading/score_view.jsx`):
an engraving engine (OSMD by default) draws the whole piece once at the plate's width, cut into
pages of whole systems that fit the viewport (`score_render/score_pages.ts`); Previous/Next page
buttons below. A bar overlay button sits over every printed measure for the tint, label and click.
The toolbar reads "Page *n* of *m* · bars *a*–*b*" and carries the shade group: Learnedness (the
default), Score difficulty, Off, plus This session once a session has ended (see SessionEnded
below). A legend beneath explains the active shade; under Score difficulty it also carries "Review
the passages", opening the `ReviewPane` the owner already reviews proposed difficulty flags in.
Without a stored source, or if the engine fails to draw, the plate falls back to a grid of one
44px-square button per bar, tinted and labelled the same way, with a note explaining why
(`SCORE_VIEW_NO_SOURCE` / `SCORE_VIEW_FAILED`).

**Learnedness** (build note 2): a bar's learnedness is its pass history under the setup pane's hand,
oldest first — the count of clean passes at the end of it, stopping at the first pass that isn't
clean, capped at 3 (`st/bar_progress.js`'s `learnedness`, read from `ItemRecord.passes`, independent
of the FSRS scheduler's own graduated state). 0/1/2 are labelled "0 of 3"/"1 of 3"/"2 of 3" in the
`--salon-learn-0/1/2` tints; 3 is "Learned" in `--salon-learn-3`. An unplayed bar gets neither tint
nor label.

**Bar pop-up** (`BarStats.dc.html`, `components/sight_reading/bar_popup.jsx`, build note 3):
clicking a bar selects it (an oxblood frame and `--salon-selected-tint` fill) and opens a pop-up
anchored to it — left or right of the bar by which half of the page it's in, below it or above it
when its system is the page's last of two or more — showing, one row per hand: how many times
played, when last, the recent-grades sentence, and accuracy or the acoustic "N of M clean"
equivalent, plus a "Practise bar *n*" pill that sets the section to that bar alone and begins. ×, a
click elsewhere, Escape or turning the page closes it. The setup pane is unchanged while it's open.

**Behind a bar's %** (Claude Design canvas "Practice Record",
`https://claude.ai/artifact/C5bEWXdKoWaNLz4nh3aviP`, artboards "1 · Click a bar" and "1 · A bar's %
counts right notes; timing strip beside it"; `st/bar_review.js`, the pop-up's second block and
`score_sheet.jsx`'s note marks): the pop-up only opens when a bar is clicked, 340px wide, and below
its accuracy chart, latest/best figures and pips it says what lies behind the %, read from the bar's
last five rows of the bar log (`barLog` store, one row a bar of each pass played through, written
with the reviews by `barLogRows`). The % is still right notes only; timing is beside it and never in
it. A paper-warm panel reads "Behind the 75%" (oxblood below 100%, else "Every note right" with
"· timing" when its strip shows), "Latest pass · 19:44" (or "Earlier pass" when the strip shows an
older one) and the worst beat in words ("Beat 2 went wrong in all 3 of your last passes, filled in
on the score."), the next two ("Also beat 4 and beat 1."), and the key pressed instead as "the black
key just above". No note name appears anywhere (the owner reads beats, not C3 and D5). On the score
the notes that went wrong in 2 or more of the last 5 passes (`HABIT_PASSES`) are filled oxblood, a
note wrong once is ringed, the key pressed instead is a grey head (`--salon-ghost-head`) beside it,
raised by its staff steps, a pause is a gilt ▾ over its column, and one or two tags
("wrong 3 of 3", "wrong once in 3", "2.7 s pause") sit at the bottom of the bar's band: all placed
in percent of the plate box on the heads the engine drew, found by pitch and onset, again at every
`showPage` and whenever the selected bar changes; they vanish with the pop-up. The timing strip is a
cell a note (a bordered grid with dashed dividers, 56px tall): the tick at the notated gap times the
pass's own pulse, the shading ±25% (`STEADY_BAND`) and the note's dot where it started, "»" or "«"
past 90% off; a hollow dot for the first note struck, words under the cells up to six notes
("on time", "2.0 s late", "after a slip", "skipped", "held"), and the caption naming the worst past
that. It shows only when a note fell outside the shading or paused, from the newest pass, or an older
one in the window that paused when the newest was steady. A bar with a fermata or a slowing word
(rit., rall., a piacere...) in it or the bar before is read from the stored MusicXML
(`st/score_give.js`) and its timing isn't judged: the strip keeps its dots but drops the shading,
the words and ▾. A bar played before the log began says its details start with the passes played
from now on; a bar graded by ear shows the player's own tags as chips ("You noted").

**Setup pane, "Tonight's session"** (`components/sight_reading/setup_pane.jsx`): replaces the old
Programme drawer and rail plates, always in the right column at rest (there is no drawer and no
Programme pill: `Drawer: null`). Groups, in order: Piece (the piece select, Remove, the import/
export/library/flags links, moved unchanged from the old drawer's deck handlers), Session (the
Today's programme / Free practice pills; the programme's Due/New/Learned figures and order picks,
or free practice's section and card-order picks), Cards (Hand, Bars per card) and Tempo (Wait/
Scroll, speed, Keep tempo); a footer states the session in one italic line and begins it. Settings
apply as they're picked; there is no separate apply step.

**Tonight's study** (programme, both hands, in the Session group): a "Tonight's study" sub-label, a
read-through row ("Read-through first · n bars left" with a ghost "Skip it" pill) while one is
pending, the passage line (the passage's bars in the display face, its origin, and "III of IV" or
"next" in the small-caps aside), the four stage rows in the onboarding page's numbered-row style
(the current stage's numeral and name in oxblood, `aria-current="step"`, passed stages ending in a
gilt ❖), the path of passages (the one in progress in oxblood, a flowed one with a gilt ❖) and a
"Bars per passage" number picker. Once learned, one line ("Learned ❖ · the programme keeps it from
here") replaces the rows. On the score the passage in progress takes a 4px oxblood top border with a
tag at its first bar, and each passage that flows a gilt one; the session rail's aside reads
"Tonight's study" and a ghost "Skip the read-through" pill sits under its clock while one is played.

**Session** (`Session.dc.html`, build note 4): Begin clears the strip and the session log and shows
the trainer's own card, transport and stat cards, with a `SessionRail` ("This session") beside it in
place of the default rail — the session's clock and progress through the piece, the programme's "Up
next" (or free practice's next few cards), and "This evening"'s last few passes. Rest pauses in
place rather than ending: the clock stops, the card waits where it is, and a banner offers Resume or
End session; Resume continues the same pass from the same point. Hotkeys Space and 1–4 are ignored
while the page shows the score (`state.view == "score"`), never while a session is paused or
running.

**Session ended** (`SessionEnded.dc.html`, build note 5): End session (running or paused) returns to
the score with a strip above it — the session's accuracy (or, for a sitting with nothing detected,
its clean-passes figure), a comparison with the last session on the same piece, and how long and how
many bars were played — plus Play on (resumes, the time since End session counted as paused) and
Done (dismisses the strip alone). Every bar played that session is tinted and labelled by its
accuracy under the This session shade (`--salon-mark-clean/near/trouble`; the 80% line between
"nearly" and "trouble" per build note 6's placeholder), which the toolbar offers only while `ended`
is set. There is no rest strip or summary dialog on this page (§4): a restPauses page like this one ends a
session to its own strip, the shared `EndedStrip`, which also links to Today's practice (§7) with the
day's minutes. The strip survives a reload: End session writes a
`scoreEnded` marker to the local store, and the page brings the strip back, its log rebuilt from
the bar log (`sessionLogOf`) with Done alone, while the marker's piece is the one drilled, its
session is a recent one and it ended on today's practice day; Begin, Play on and Done forget it.

**New tokens** (`static/js/st/global.css`, alongside the existing palette): `--salon-gilt-deep`,
`--salon-gilt-mid`, `--salon-pip-rule`, `--salon-gilt-ink` and `--salon-ink-faint` for the setup
pane and bar labels; `--salon-learn-0/1/2/3` for the learnedness tints and `--salon-mark-clean/
near/trouble` for the session shade, both described above; `--salon-heat-tint-1..4` for the Score
difficulty shade (reusing the existing heat ramp's steps as translucent fills over the engraving);
`--salon-selected-tint` for a clicked bar's fill; `--salon-ghost-head` for the key pressed instead
on a bar's note marks.

### 7. Practice record: Today — Claude Design canvas "Practice Record"
(`https://claude.ai/artifact/C5bEWXdKoWaNLz4nh3aviP`, Q4 A, Q5 A and Q11 A)

**Purpose:** a summary of today's practice, the whole practice day from 4 am (every session, every
piece), in place of the pop-up summary of §4. Statistics becomes the practice record, a row of tabs
each at its own route (`TabNav` in `salon.jsx`, `RECORD_TABS` in `record_tabs.jsx`): **Today**
(`/stats`, the index), **For my lesson** (§8, `/stats/for-my-lesson`) and **Last 14 days** (§5,
`/stats/last-14-days`). Today never opens by itself:
the score page's ended strip and the exercises page's rest strip link to it, as does the header's
Statistics entry.

**Layout:** `.today_page`, as the Progress screen (`max-width: 1060px`, `padding: 26px 34px 44px`):
title block "Today, *Monday 14 September*" (the practice day's date) → tabs → four stat cards → two
columns `minmax(0,1fr) 300px` (one column at 760px and below): "Sessions today" and a plate per piece
on the left, the rail on the right → a closing italic line.

**Components:** the cards are Minutes (against the goal, with a track whose dashed tick is the goal),
Sessions ("1 piece, 1 exercise"), Accuracy (accent, with the change on yesterday) and Bars learned
(the bars named, or "Three clean passes in a row learns a bar"). Each piece's plate has a cell for
each printed bar number, shaded by today's accuracy (`--salon-mark-clean/near/trouble`; unplayed
bars `--salon-paper` with `--salon-rule-light`), a ◆ (`--salon-gilt-deep`) on a bar learned today,
the trouble lines (the worst five, each told by beat, with "Open"), and the pills "Practise bars 3–9"
(primary: free practice of the span of the bars under 80%, one bar a card in Random order, so the weakest
come up most often; it sets the settings and goes to `/sheet-music` at rest, never beginning) and "Open
the score". A bar's cell opens the score at that bar's window (`/sheet-music?bar=N`, used once). The rail
has "Mistakes today" (wrong notes, skipped, hesitations, which are not in the %) and "Kept going wrong".
The empty states are "The bench is *waiting*" and "Today's practice *fills in as you play*".

**Implementation:** every figure is worked out in the pure module `st/practice_day.js`
(`practiceDay`, with the rule for each in its comments) from the sessions, the day's rows of the bar log
(`LocalStore#barLogSince`) and the bar items; `TodayPage`
(`static/js/st/components/pages/today_page.jsx`) only paints it. A bar's figure for the day is the
This-session rule (`barTotals` in `st/bar_progress.js`) over the day's rows, so the day and the ended strip
never disagree about a bar. A mistake is told by its beat (`beatLabel`, as the bar window does), never by a
note name. The first paint is from the cached sessions; the rows fill in the plates and rail once read.

### 8. Practice record: For my lesson — Claude Design canvas "Practice Record" (Q8 A, Q9 A)

**Purpose:** notes a student leaves for their next lesson, shown at the lesson. In practice they are quiet
marks, never a pop-up or a banner. Until teacher accounts exist the teacher reads the tab on the student's
screen, or the sheet "Print for the lesson" makes. Notes stay on the device (the `lessonNotes` store, in the
library file too, never on a server).

**Writing a note:** three ways in. "❧ Note for lesson" beside "Practise bar n" in a bar's pop-up swaps the
pop-up's body for the form (heading "Bar *3*" with "Note for your lesson"; the textarea "Your note",
placeholder "What do you want to ask?"; topic chips Notes, Rhythm, Fingering, Pedal, How to practise, Other,
one at a time and tapped again to clear; "Attach what happened: **75%**, beat 2 went wrong in all 3 of your
last passes", ticked by default and absent for a bar never played; "Save note" and "Cancel"). Escape closes
only the form. "❧ Flag for lesson" in the session rail's "This session" plate, beside "On the stand: bars
3–4", stores a note with no words and the evidence from the finished passes, and says "Flagged bars 3–4 for
your lesson. Add words later, at rest." for four seconds. "Add a note" on the tab writes a note on the
setup's piece or on any piece. Evidence is told by beat, never by a note name.

**Quiet marks:** a "❧ note" / "❧ 2 notes" pin in a bar's top-right corner on the score (the grid fallback
too), in `--salon-gilt-deep` on `--salon-paper` with a `--salon-gilt-mid` border; a "❧ 2 notes for your
lesson · Open" line above Begin in Tonight's session; in the rail, up to two lines for the bars on the stand:
"Your note · bar 3" and "Teacher, 2 Oct · bar 3" with the answer. Removing a piece with open notes asks
"Keep the notes", "Remove them too" or "Cancel".

**Tab:** `For my lesson` (`/stats/for-my-lesson`) between Today and Last 14 days, with a count of the open
notes. Layout as Today: title block "For my *lesson*" → tabs → two columns `minmax(0,1fr) 280px` (one column
at 760px and below, measured on the page's own width). One plate holds the open notes grouped by piece
(section label "Fixture · 2 open notes", the piece with the newest note first, "Any piece" last), each a
grid `200px minmax(0,1fr)` (stacked at 520px): the bar engraved by the same engine as the score page, or a
placeholder ("Whole piece", "Bar 3", "Any piece"); "Bar 3" with its label ("Fingering · both hands · 9 Oct",
"Flagged in a session · 9 Oct", "kept for next time"); the words in italic display type, or "No words yet."
with "Add words"; "Then: 75%, beat 2 went wrong…" with "Now: 75% latest, 0 of 3 towards learned." and
"Over time: 50 → 44 → 75."; and the actions "Discussed…" (primary; asks "The teacher's answer (optional)"),
"Keep for next time", "Drop" (with an "Undo" for the visit), "Open on the score" and "Edit". Under the open
notes, the discussed ones by lesson day ("Discussed · 2 October", the last three days, then "and N earlier"),
each with a "Teacher" box and "Since then: learned on 9 October." The right column has the "Since your last
lesson" card ("7 *days*", "52 minutes · 5 bars learned · 2 notes"; "Before your first lesson" before one),
"Print for the lesson" (primary, "Engraving the bars…" and disabled until every bar has drawn or failed),
"Add a note" and the quote "Bring the questions; leave with the answers." Empty: "Nothing to ask *yet*".

**Print:** a print stylesheet on the tab, no separate view. The header and its spacer are hidden
(`@media print` in `header.module.css` and `global.css`), as are the tabs, the actions, the right column and
the discussed notes (`data-print="hide"`); a print-only heading "For my lesson · Saturday 10 October", the
since line and, under each open note, a ruled "The teacher's answer" box of three lines
(`data-print="only"`) are added; each note keeps together on a page.

**Implementation:** every word and figure is worked out in the pure module `st/lesson_notes.js` (`lessonView`
for the tab, `evidenceOf`/`readEvidence` for the snapshot, `notesOnBars`/`answersOnBars`/`notePins` for the
marks); `LessonPage` (`components/pages/lesson_page.jsx`) and the shared `LessonNoteForm` only paint it and
write through `LocalStore#putLessonNote` and `updateLessonNote`. A dropped note stays stored with status
"dropped" so a library merge cannot bring it back.

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
summary → progress → setup. In the app the summary is the rest strip and Today's practice (§4, §7),
and progress is the practice record's Last 14 days tab.
