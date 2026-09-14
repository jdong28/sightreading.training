# Handoff: Sight Reading Trainer — "Salon de Chopin" UX facelift

(Verbatim copy of the design handoff README from the Claude Design project, 2026-09-14.)

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
  `StaffTwo` component at `height: 150`, `maxScale: .3`, `min-height: 150px` reserved.
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
  component, `C4`–`C7`.

**Feedback states (new, "gentle"):**
- *Correct note:* a gilt wash over the plate — `radial-gradient(70% 60% at 50% 45%,
  rgba(168,130,74,.24), transparent 72%)` inset 1px, opacity 0 → 1 → 0, `.42s ease` in,
  held 300ms. Cursor advances to the next column; the expected note is highlighted on the keyboard.
- *Wrong note:* an **ink smudge** on the plate at the cursor's horizontal position —
  78×78px `radial-gradient(42% 38% at 50% 50%, rgba(36,31,24,.4), rgba(36,31,24,.14) 56%,
  transparent 78%)`, `filter: blur(1.5px)`, fades over `.55s`, cleared after 900ms. The cursor does
  **not** advance, no sound penalty, streak resets to 0, miss count increments. Nothing else changes.
- Reaching the end of a passage regenerates a new one after 280ms.

**State:** `notes` (NoteList), `keySignature`, `held` (map), `clef`, `tempo`, `session` (bool),
`cursor` (index into columns), `readCount`, `misses`, `streak`, `best`, `secs`.
Session is **endless** — it runs until the user presses Rest; there is no note or time target.
`accuracy = readCount / (readCount + misses)`.

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

## Interactions & behaviour

| Interaction | Behaviour |
| --- | --- |
| Programme button | opens left drawer, `.32s cubic-bezier(.22,.61,.36,1)`; scrim `.3s ease` |
| Scrim / × / "Take your seat" | closes drawer; the apply button also regenerates the passage |
| Tempo track click | sets bpm from click position across a 40–200 range; fill + knob move to `(bpm-40)/160`; the term label (Largo/Adagio/Andante/Moderato/Allegro/Presto) and `♩ = n` update live |
| Begin / Rest | toggles the endless session and the elapsed clock (1s tick); label swaps |
| MIDI note-on | judged against the expected column note; correct → gilt pulse + advance; wrong → ink smudge + streak reset |
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
