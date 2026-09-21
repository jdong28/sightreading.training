import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import SightReadingPage, {
  formatElapsed, accuracyPercent, romanNumeral, MIN_FIT_SCALE, PLATE_STAFF_SCALE
} from "st/components/pages/sight_reading_page"
import ScorePage, {SCORE_PROGRAMME} from "st/components/pages/score_page"
import {GStaff} from "st/components/staves"
import NoteList from "st/note_list"
import {
  fitNoteWidth, fitStaffScale, minNoteWidth, GROUP_OFFSET
} from "st/components/staff_notes"
import staffStyles from "st/components/staff.module.css"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"
import {setAppStore} from "st/storage"
import {importMusicXMLPiece, addPiece} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {STAVES, GENERATORS, SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, WHOLE_SECTION} from "st/data"
import {MAX_MEASURES_PER_CARD, RANDOM_ORDER, MeasureCardGenerator, cardColumns} from "st/measure_cards"
import {DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY, SheetMusicGenerator} from "st/generators"
import {scopeEvent} from "st/events"
import NoteStats from "st/note_stats"
import {KeySignature} from "st/music"
import {openTestStore, noteXML, reverieOpening, keyChangeScore, clefChangeScore} from "spec/helpers"

// a two staff 3/4 piece, measures 1 and 2
let minuetXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Salon Minuet</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><staff>1</staff></note>
      <backup><duration>3</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>3</duration><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><staff>1</staff></note>
      <backup><duration>3</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

// a two staff 3/4 piece of eight measures, each a treble and a bass note
let octetXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Salon Octet</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${Array.from({length: 8}, (_, idx) => `
    <measure number="${idx + 1}">
      ${idx == 0 ? `<attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>` : ""}
      ${noteXML("CDEFGAB"[idx % 7], 5, 3, 1)}
      <backup><duration>3</duration></backup>
      ${noteXML("CDEFGAB"[idx % 7], 3, 3, 2)}
    </measure>`).join("")}
  </part>
</score-partwise>`

// a two staff 3/4 piece of eight measures, each a treble E4 (with the F4 above
// it as a stacked second when second) over a bass C3, then a treble G#4
let secondsXML = (title, second) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${Array.from({length: 8}, (_, idx) => `
    <measure number="${idx + 1}">
      ${idx == 0 ? `<attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>` : ""}
      ${noteXML("E", 4, 1, 1)}
      ${second ? noteXML("F", 4, 1, 1, "<chord/>") : ""}
      <note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
      <backup><duration>3</duration></backup>
      ${noteXML("C", 3, 3, 2)}
    </measure>`).join("")}
  </part>
</score-partwise>`

// a two staff 4/4 bar both hands open on a quarter rest, the right hand then
// playing three even quarters over a note the left hand holds under them
let leadRestXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Lead Rest</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      ${["C", "D", "E"].map(step =>
        `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>4</duration></backup>
      <note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><dot/><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

// C#4 is outside C major, so never a random note in that key
const WRONG_NOTE = "C#4"

let buttonNamed = (el, text) =>
  [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)

let buttonLabelled = (el, label) => el.querySelector(`button[aria-label="${label}"]`)

let statValue = (el, label) => {
  let labelEl = [...el.querySelectorAll("div")].find(div =>
    div.children.length == 0 && div.textContent == label)
  return labelEl.nextElementSibling.textContent
}

let plateStatus = el => [...el.querySelectorAll("[aria-live]")][0].textContent

// the real timer, so waits still run under jasmine's mock clock, which keeps
// its mocked date and so the evening list's "today"
const realSetTimeout = window.setTimeout.bind(window)

let waitFor = async (fn, message) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) { return }
    await new Promise(resolve => realSetTimeout(resolve, 10))
  }
  fail(`timed out waiting for ${message}`)
}

describe("sight reading page", function() {
  let container, root, page, store, previousStore, savedStorage
  let clockInstalled = false

  const STORAGE_KEYS = [DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

  beforeEach(async function() {
    savedStorage = STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of STORAGE_KEYS) {
      window.localStorage.removeItem(key)
    }

    store = await openTestStore()
    previousStore = setAppStore(store)
  })

  afterEach(function() {
    if (root) {
      flushSync(() => root.unmount())
      root = null
    }
    if (container) {
      container.remove()
      container = null
    }

    if (clockInstalled) {
      jasmine.clock().uninstall()
      clockInstalled = false
    }

    setAppStore(previousStore)
    store.close()

    for (let [key, value] of savedStorage) {
      if (value == null) {
        window.localStorage.removeItem(key)
      } else {
        window.localStorage.setItem(key, value)
      }
    }
  })

  let renderPage = (component=SightReadingPage, props={}) => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      // the programme drawer links to the setup page
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(component, {ref: p => page = p, ...props})))
    })
    // the mount's own state updates
    flushSync(() => {})
    return container
  }

  // the trainer drilling an imported piece, as the score page, on the app's
  // own staff (as in scroll mode, or for a piece stored without its score);
  // the engine card has its own specs (see score_card_spec)
  let renderScorePage = () => renderPage(ScorePage, {programme: {...SCORE_PROGRAMME, engine: null}})

  let click = button => flushSync(() => button.click())

  // the number picker (st/components/number_picker) of the label in el
  let picker = (el, label) => el.querySelector(`[role="spinbutton"][aria-label="${label}"]`)

  // types text into the label's number picker and commits it with Enter
  let typeNumber = (el, label, text) => {
    let input = picker(el, label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, text)
    flushSync(() => input.dispatchEvent(new Event("input", {bubbles: true})))
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})))
    flushSync(() => {})
  }

  let play = notes => {
    for (let note of notes) {
      flushSync(() => page.pressNote(note))
    }
    for (let note of notes) {
      flushSync(() => page.releaseNote(note))
    }
  }

  it("formats the stat card figures", function() {
    expect(formatElapsed(0)).toEqual("0:00")
    expect(formatElapsed(65.9)).toEqual("1:05")
    expect(formatElapsed(3600)).toEqual("60:00")
    expect(accuracyPercent(0, 0)).toBe(null)
    expect(accuracyPercent(3, 1)).toEqual(75)
    expect(["I", "II", "III", "IV", "IX"]).toEqual([1, 2, 3, 4, 9].map(romanNumeral))
  })

  it("fits a card's columns to the staff width", function() {
    let opts = {scale: 0.8, maxWidth: 100, minWidth: 48}

    // 805 unscaled pixels, less the clef, the last note and a stacked second
    expect(fitNoteWidth(644, 10, opts)).toEqual(60)
    // a key signature takes room before the first column
    expect(fitNoteWidth(644, 10, {...opts, keySignature: new KeySignature(3)})).toEqual(52)
    // never wider than the default columns, nor narrower than the minimum
    expect(fitNoteWidth(644, 5, opts)).toEqual(100)
    expect(fitNoteWidth(644, 20, opts)).toEqual(48)
    // before the plate is measured, or for a single column
    expect(fitNoteWidth(null, 10, opts)).toEqual(100)
    expect(fitNoteWidth(644, 0, opts)).toEqual(100)

    // the staff shrinks when the columns don't fit at the minimum width
    let scaleOpts = {scale: 0.8, minWidth: 48, minScale: 0.5}
    expect(fitStaffScale(644, 10, scaleOpts)).toEqual(0.8)
    expect(fitStaffScale(644, 20, scaleOpts)).toBeCloseTo(0.555, 3)
    expect(fitStaffScale(644, 100, scaleOpts)).toEqual(0.5)
    expect(fitStaffScale(644, 20, {...scaleOpts, scale: 0.4})).toEqual(0.4)
  })

  it("keeps an accidental clear of the previous note head at the narrowest fitted columns", async function() {
    container = document.createElement("div")
    container.style.width = "800px"
    document.body.appendChild(container)
    root = createRoot(container)

    let cases = [
      [new KeySignature(-1), [["A4"], ["Eb4"]], staffStyles.flat],
      [new KeySignature(1), [["A4"], ["C#4"]], staffStyles.sharp],
      // the F4 of the second is pushed right of the E4
      [new KeySignature(0), [["E4", "F4"], ["G#4"]], staffStyles.sharp],
    ]

    for (let scale of [MIN_FIT_SCALE, PLATE_STAFF_SCALE]) {
      for (let [keySignature, columns, accidentalClass] of cases) {
        flushSync(() => root.render(React.createElement(GStaff, {
          notes: new NoteList(columns),
          heldNotes: {},
          keySignature,
          noteWidth: minNoteWidth(columns, keySignature),
          scale,
        })))

        await Promise.all([...container.querySelectorAll("img")].map(img => img.decode()))

        let notes = [...container.querySelectorAll(`.${staffStyles.note}`)]
        let next = notes.pop()
        let headsRight = Math.max(...notes.map(note =>
          note.querySelector(`.${staffStyles.primary}`).getBoundingClientRect().right))
        let accidental = next.querySelector(`.${accidentalClass}`).getBoundingClientRect()

        expect(accidental.width).toBeGreaterThan(0)
        expect(accidental.left).toBeGreaterThanOrEqual(headsRight)
      }
    }
  })

  it("titles the score page by what it drills", function() {
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({piece: "", song: ""}))
    let el = renderScorePage()
    expect(el.textContent).toContain("pick a piece in the programme")
    flushSync(() => root.unmount())
    container.remove()

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: "", song: "c4 d4 e4 f4 g4", startMeasure: 1, endMeasure: 2,
    }))
    el = renderScorePage()
    expect(el.textContent).toContain("Pasted song notation")
    expect(el.textContent).toContain("measures 1–2")
    expect(el.textContent).not.toContain("pick a piece in the programme")
  })

  it("slides a card by the room the staff draws its columns in", async function() {
    let {piece} = await importMusicXMLPiece("lead_rest.musicxml", leadRestXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    renderScorePage()
    // both hands on one treble staff, so no rest of either of them is drawn
    flushSync(() => page.setStaff(STAVES.find(staff => staff.name == "treble")))

    let {scale, noteWidth} = page.staffLayout()
    let drawn = Math.floor(noteWidth * scale)
    let heads = [...container.querySelectorAll(`.${staffStyles.note}`)]
      .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)

    expect(container.querySelectorAll(`.${staffStyles.rest}`).length).toEqual(0)
    // the bar's opening rest is never drawn, so its three even quarters are
    // drawn a column width apart, as a drill without the score's rhythm is
    expect(heads.length).toBeGreaterThan(1)
    expect(heads[1] - heads[0]).toEqual(drawn)

    // and the staff slides by that same room when a column is played, rather
    // than by a width that still counts the rest
    expect(page.columnAdvance(page.state.notes)).toEqual(1)
  })

  it("fits a unit with a stacked second at the wider minimum column width", async function() {
    let {piece: seconds} = await importMusicXMLPiece("seconds.musicxml", secondsXML("Seconds", true), store)
    let {piece: singles} = await importMusicXMLPiece("singles.musicxml", secondsXML("Singles", false), store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: seconds.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    renderScorePage()
    // a plate too narrow for the card's columns at any allowed width
    flushSync(() => page.setState({staffWidth: 120}))

    let columnsOf = () => page.state.notes.generator.cards[0].columns
    let layout = page.staffLayout()
    let stackedWidth = minNoteWidth(columnsOf(), page.state.keySignature)
    let stackedFitted = layout.noteWidth

    expect([...page.state.notes.currentColumn()]).toEqual(["C3", "E4", "F4"])
    expect(layout.scale).toEqual(MIN_FIT_SCALE)
    // the columns are spaced by their beats, so a column is fitted wider than
    // the narrowest room a head and its accidental need
    expect(stackedFitted).toBeGreaterThanOrEqual(stackedWidth)

    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, piece: singles.id,
    }))

    layout = page.staffLayout()
    let singleWidth = minNoteWidth(columnsOf(), page.state.keySignature)

    expect([...page.state.notes.currentColumn()]).toEqual(["C3", "E4"])
    expect(layout.scale).toEqual(MIN_FIT_SCALE)
    expect(layout.noteWidth).toBeGreaterThanOrEqual(singleWidth)

    // the stacked second's column keeps the group offset's room as well, in
    // the fitted width as in the minimum
    expect(stackedWidth).toEqual(singleWidth + GROUP_OFFSET)
    expect(stackedFitted - layout.noteWidth).toBeGreaterThanOrEqual(GROUP_OFFSET)
  })

  it("keeps an accidental clear of the previous head at the fitted columns", async function() {
    let {piece} = await importMusicXMLPiece("seconds.musicxml", secondsXML("Seconds", true), store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    let el = renderScorePage()
    // a plate narrow enough that the card is fitted at its narrowest columns
    flushSync(() => page.setState({staffWidth: 160}))
    expect(page.staffLayout().scale).toEqual(MIN_FIT_SCALE)

    await Promise.all([...el.querySelectorAll("img")].map(img => img.decode()))

    // the bar's G#4 is a beat after its E4, the narrowest gap of the card, so
    // its sharp is what has to clear the heads before it
    let notes = [...el.querySelector("[data-staff=\"upper\"]").querySelectorAll(`.${staffStyles.note}`)]
      .map(note => ({
        at: parseFloat(note.style.left),
        head: note.querySelector(`.${staffStyles.primary}`).getBoundingClientRect(),
        accidental: note.querySelector(`.${staffStyles.accidental}`),
      }))

    let sharps = notes.filter(note => note.accidental)
    expect(sharps.length).toBeGreaterThan(0)

    for (let note of sharps) {
      let before = notes.filter(other => other.at < note.at)
      if (!before.length) { continue }

      let accidental = note.accidental.getBoundingClientRect()
      expect(accidental.width).toBeGreaterThan(0)
      expect(accidental.left)
        .toBeGreaterThanOrEqual(Math.max(...before.map(other => other.head.right)))
    }
  })

  it("shrinks the staff to the legibility floor and no further", async function() {
    let {piece} = await importMusicXMLPiece("seconds.musicxml", secondsXML("Seconds", true), store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    renderScorePage()
    flushSync(() => page.setState({staffWidth: 160}))

    // the smallest staff still worth reading: a card that doesn't fit at it
    // runs past the plate's edge rather than shrinking further
    expect(MIN_FIT_SCALE).toEqual(0.25)
    expect(page.staffLayout().scale).toEqual(0.25)

    // and a plate with room for the card keeps the staff at its full size
    flushSync(() => page.setState({staffWidth: 1240}))
    expect(page.staffLayout().scale).toEqual(page.state.scale)
  })

  it("fits a card that overflowed at the old 0.35 floor", async function() {
    let {piece} = await importMusicXMLPiece("seconds.musicxml", secondsXML("Seconds", true), store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    let el = renderScorePage()
    // a plate narrow enough that the card needs a staff below the old 0.35
    // floor, which would have clamped there and run past the edge
    let wrapper = el.querySelector(`.${staffStyles.staff_wrapper}`)
    wrapper.style.width = "230px"
    flushSync(() => page.measureStaffWrapper())

    let scale = page.staffLayout().scale
    expect(scale).toBeGreaterThan(MIN_FIT_SCALE)
    expect(scale).toBeLessThan(0.35)

    await Promise.all([...el.querySelectorAll("img")].map(img => img.decode()))

    // and every head of it is drawn inside that plate
    let plate = wrapper.getBoundingClientRect()
    let heads = [...el.querySelectorAll(`.${staffStyles.note}`)]

    expect(heads.length).toBeGreaterThan(0)
    for (let head of heads) {
      expect(head.getBoundingClientRect().right).toBeLessThanOrEqual(plate.right)
    }
  })

  it("fits a capped card of the score's busiest bars inside the plate", async function() {
    let {piece} = await importMusicXMLPiece("reverie.musicxml", reverieOpening(), store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
      measuresPerCard: String(MAX_MEASURES_PER_CARD),
    }))

    let el = renderScorePage()
    expect(page.state.mode).toEqual("wait")

    // the busiest three bars of the score's opening, the most the cap shows,
    // the trailing one bar card opening on its own numbered bar line
    expect(page.state.notes.generator.cards.map(card => card.measures))
      .toEqual([[1, 2, 3], [4]])
    expect(cardColumns(page.state.notes.generator.cards[1])[0].measure).toEqual(4)
    expect(page.currentCard().card.measures).toEqual([1, 2, 3])

    // every head of the card, the ostinato's eighths and the heads their ties
    // run on to, is drawn inside the plate it was fitted to, above the floor
    // only the densest cards reach
    let expectHeadsInsidePlate = () => {
      let wrapper = el.querySelector(`.${staffStyles.staff_wrapper}`).getBoundingClientRect()
      let heads = [...el.querySelectorAll(`.${staffStyles.note}`)]

      expect(heads.length).toBeGreaterThan(15)
      for (let head of heads) {
        expect(head.getBoundingClientRect().right).toBeLessThanOrEqual(wrapper.right)
      }
    }

    expectHeadsInsidePlate()
    expect(page.staffLayout().scale).toBeGreaterThan(MIN_FIT_SCALE)

    // the whole section is capped to the same card, and fits the same way
    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, measuresPerCard: "all",
    }))
    expect(page.currentCard().card.measures).toEqual([1, 2, 3])
    expectHeadsInsidePlate()

    // and on a laptop's plate the same card fits without shrinking the staff
    flushSync(() => page.setState({staffWidth: 1240}))
    expect(page.staffLayout().scale).toEqual(page.state.scale)
  })

  it("shows the measure card on the staff and in the plate header", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "2",
    }))

    let el = renderScorePage()
    let plateLabel = () => el.querySelector("[aria-live]").previousElementSibling.textContent
    // bar lines with their numbers, on the upper staff of the grand staff
    let numberedBarLines = () =>
      [...el.querySelectorAll(`.${staffStyles.bar_line}[data-label]`)].map(line => line.dataset.label)

    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–2 of 1–8")
    expect(numberedBarLines()).toEqual(["1", "2"])
    expect(el.querySelectorAll(`.${staffStyles.bar_line}`).length).toEqual(4)

    let upperNotes = () => el.querySelector(`.${staffStyles.staff_notes}`)
    let noteLefts = () => [...upperNotes().querySelectorAll(`.${staffStyles.note}`)]
      .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
    let barLineLeft = measure =>
      parseFloat(upperNotes().querySelector(`.${staffStyles.bar_line}[data-measure="${measure}"]`).style.left)
    // the slide of the notes, see Staff#setOffset
    let offset = () => {
      let match = upperNotes().style.transform.match(/translate3d\(([-\d.]+)px/)
      return match ? parseFloat(match[1]) : 0
    }

    // evenly spaced columns, with the bar lines on their boundaries a column apart
    let [head, next] = noteLefts()
    let columnWidth = next - head
    expect(columnWidth).toBeGreaterThan(0)
    expect(barLineLeft(2) - barLineLeft(1)).toBeCloseTo(columnWidth, 3)
    let nextOnStaff = next + offset()
    let barLineOnStaff = barLineLeft(2) + offset()

    click(buttonNamed(el, "Begin"))
    play(page.state.notes.currentColumn())
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–2 of 1–8")

    // the second measure's column becomes the head exactly one column along,
    // so its note and bar line slide from where they were without a jump
    expect(noteLefts()[0]).toEqual(head)
    expect(Math.abs(offset() - columnWidth)).toBeLessThan(1)
    expect(Math.abs(noteLefts()[0] + offset() - nextOnStaff)).toBeLessThan(1)
    expect(Math.abs(barLineLeft(2) + offset() - barLineOnStaff)).toBeLessThan(1.5)

    play(page.state.notes.currentColumn())

    expect(plateLabel()).toEqual("3 ♩ a bar · Card 2 · measures 3–4 of 1–8")
    expect(numberedBarLines()).toEqual(["3", "4"])

    // the whole section is walked in capped cards too, so it never shows
    // more bars at once than a flashcard deck does
    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, measuresPerCard: "all",
    }))
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–3 of 1–8")
    expect(numberedBarLines()).toEqual(["1", "2", "3"])

    // the walk's trailing one bar card opens with its numbered bar line like
    // the cards before it
    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, measuresPerCard: "all", endMeasure: 7,
    }))
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–3 of 1–7")

    for (let i = 0; i < 6; i++) {
      play(page.state.notes.currentColumn())
    }

    expect(plateLabel()).toEqual("3 ♩ a bar · Card 3 · measure 7 of 1–7")
    expect(numberedBarLines()).toEqual(["7"])

    // a section the cap already fits loops without a card number, its start
    // coming round again after its last measure
    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, measuresPerCard: "all", endMeasure: 3,
    }))
    expect(plateLabel()).toEqual("3 ♩ a bar · measures 1–3")
    expect(numberedBarLines().slice(0, 4)).toEqual(["1", "2", "3", "1"])
  })

  it("scrolls the whole section as one card and walks it in capped cards while waiting", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    renderScorePage()
    let generator = () => page.state.notes.generator
    let wholeSection = [1, 2, 3, 4, 5, 6, 7, 8]

    // nothing is fitted to the plate while scrolling, so the section runs on
    // as one looping card, without the blank stretch between cards
    expect(page.state.mode).toEqual("scroll")
    expect(generator() instanceof SheetMusicGenerator).toBe(true)
    expect(page.currentCard().card.measures).toEqual(wholeSection)
    expect(page.currentCard().number).toBe(null)
    expect([...page.state.notes].some(column => !column.length)).toBe(false)

    // waiting fits the card to the plate, where the cap holds
    flushSync(() => page.setMode("wait"))
    expect(generator() instanceof MeasureCardGenerator).toBe(true)
    expect(generator().cards.map(card => card.measures)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]])
    expect(page.currentCard().card.measures).toEqual([1, 2, 3])

    flushSync(() => page.setMode("scroll"))
    expect(generator() instanceof SheetMusicGenerator).toBe(true)
    expect(page.currentCard().card.measures).toEqual(wholeSection)
  })

  it("keeps a card size drill on its card through a mode toggle", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "2",
    }))

    let el = renderScorePage()
    let plateLabel = () => el.querySelector("[aria-live]").previousElementSibling.textContent

    click(buttonNamed(el, "Begin"))
    let drilling = page.state.notes.generator
    play(page.state.notes.currentColumn())
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–2 of 1–8")

    // a card size plays the same either way, so the mode leaves the deck be
    flushSync(() => page.setMode("scroll"))
    flushSync(() => page.setMode("wait"))
    expect(page.state.notes.generator).toBe(drilling)

    // the card's last measure is still the one to play, so it is done with
    play(page.state.notes.currentColumn())
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 2 · measures 3–4 of 1–8")
  })

  it("draws no bar line for a section of a single measure", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 3, endMeasure: 3, hand: BOTH_HANDS, measuresPerCard: "2",
    }))

    let el = renderScorePage()
    let barLines = () => el.querySelectorAll(`.${staffStyles.bar_line}`).length

    expect(page.currentCard().card.measures).toEqual([3])
    expect(barLines()).toEqual(0)

    // the lone bar is drawn the same way at every card size
    for (let size of [String(MAX_MEASURES_PER_CARD), "1", "all"]) {
      flushSync(() => page.setGenerator(page.state.currentGenerator, {
        ...page.state.currentGeneratorSettings, measuresPerCard: size,
      }))
      expect(page.currentCard().card.measures).toEqual([3])
      expect(barLines()).toEqual(0)
    }
  })

  it("offers the order control only once a card size is picked", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS,
      measuresPerCard: "all", order: RANDOM_ORDER,
    }))

    let el = renderScorePage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let pills = label => drawer.querySelector(`[role="group"][aria-label="${label}"]`)

    // the whole section is always walked in order, so no order to pick
    expect(pills("measures per card presets")).not.toBe(null)
    expect(pills("order")).toBe(null)

    // and the stored random order is still there to apply to a card size
    typeNumber(drawer, "measures per card", "2")

    expect(pills("order")).not.toBe(null)
    expect(page.state.notes.generator.deck.order).toEqual(RANDOM_ORDER)
  })

  it("picks the section and card size with number pickers clamped to the piece", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 2, endMeasure: 5, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    let el = renderScorePage()
    click(buttonLabelled(el, "Programme"))
    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let values = () => ["start measure", "end measure"].map(label => picker(drawer, label).value)
    let section = () => {
      let {startMeasure, endMeasure} = page.state.currentGeneratorSettings
      return [startMeasure, endMeasure]
    }

    // the piece's measure count is beside each
    expect(picker(drawer, "end measure").getAttribute("aria-valuemax")).toEqual("8")
    expect(drawer.textContent).toContain("of 8")

    // a typed measure past the piece is its last
    typeNumber(drawer, "end measure", "40")
    expect(values()).toEqual(["2", "8"])
    expect(section()).toEqual([2, 8])

    // moving one end past the other drags it along
    typeNumber(drawer, "end measure", "6")
    typeNumber(drawer, "start measure", "7")
    expect(section()).toEqual([7, 7])
    typeNumber(drawer, "end measure", "3")
    expect(section()).toEqual([3, 3])

    // the step buttons and keys nudge it, never past the piece
    click(buttonLabelled(drawer, "Increase end measure"))
    expect(section()).toEqual([3, 4])
    let end = picker(drawer, "end measure")
    flushSync(() => end.dispatchEvent(new KeyboardEvent("keydown", {key: "End", bubbles: true})))
    expect(section()).toEqual([3, 8])
    expect(buttonLabelled(drawer, "Increase end measure").disabled).toBe(true)
    flushSync(() => end.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})))
    expect(section()).toEqual([3, 7])
    expect(el.querySelector("h1").textContent).toContain("measures 3–7")

    // on the app's staff a card stops at the cap, and says so
    typeNumber(drawer, "measures per card", "5")
    expect(page.state.currentGeneratorSettings.measuresPerCard).toEqual(MAX_MEASURES_PER_CARD)
    expect(picker(drawer, "measures per card").getAttribute("aria-valuemax")).toEqual(`${MAX_MEASURES_PER_CARD}`)
    expect(drawer.textContent).toContain(`max ${MAX_MEASURES_PER_CARD}`)
    expect(drawer.textContent).toContain(`Cards stop at ${MAX_MEASURES_PER_CARD} measures`)
    expect(page.currentCard().card.measures).toEqual([3, 4, 5])

    // and the whole section is a pill beside it
    click(buttonNamed(drawer, "all"))
    expect(page.state.currentGeneratorSettings.measuresPerCard).toEqual(WHOLE_SECTION)
    expect(picker(drawer, "measures per card").value).toEqual("")
  })

  it("keeps a stored section longer than a shorter piece inside it", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 12, endMeasure: 30, hand: BOTH_HANDS, measuresPerCard: "9",
    }))

    let el = renderScorePage()
    expect(el.querySelector("h1").textContent).toContain("measure 8")
    // capped to what the app's staff fits
    expect(page.currentCard().card.measures).toEqual([8])

    click(buttonLabelled(el, "Programme"))
    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    expect(["start measure", "end measure", "measures per card"].map(label => picker(drawer, label).value))
      .toEqual(["8", "8", "1"])
  })

  it("keeps a score note below the staff inside the plate in both modes", async function() {
    // the score writes the left hand in treble clef, so its A3 hangs two
    // ledger lines below the lower staff
    let {piece} = await importMusicXMLPiece("treble_left.musicxml", clefChangeScore({
      clefs: [["G", 2], ["G", 2]],
      notes: [["A", 3], ["A", 3], ["A", 3], ["A", 3]],
    }), store)

    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    let el = renderScorePage()
    expect(page.state.mode).toEqual("scroll")

    let lowerNotes = () => {
      let lower = el.querySelector("[data-staff=\"lower\"]")
      return [lower, [...lower.querySelectorAll(`.${staffStyles.note}`)]]
    }

    for (let mode of ["scroll", "wait"]) {
      flushSync(() => page.setMode(mode))
      expect(page.state.mode).toEqual(mode)

      let wrapper = el.querySelector(`.${staffStyles.staff_wrapper}`).getBoundingClientRect()
      let [lower, heads] = lowerNotes()
      let staff = lower.getBoundingClientRect()

      expect(heads.length).toBeGreaterThan(0)
      for (let head of heads) {
        let box = head.getBoundingClientRect()
        expect(+head.dataset.midiNote).toEqual(57)
        expect(box.bottom).toBeGreaterThan(staff.bottom)
        expect(box.bottom).toBeLessThanOrEqual(wrapper.bottom)
      }
    }
  })

  it("opens, closes and applies the programme drawer", function() {
    let el = renderPage()
    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let scrim = el.querySelector(`.${drawerStyles.scrim}`)
    let isOpen = () => drawer.classList.contains(drawerStyles.open)

    expect(isOpen()).toBe(false)
    expect(drawer.getAttribute("aria-hidden")).toEqual("true")

    click(buttonLabelled(el, "Programme"))
    expect(isOpen()).toBe(true)
    expect(scrim.classList.contains(drawerStyles.open)).toBe(true)
    expect(drawer.getAttribute("aria-hidden")).toEqual("false")

    click(buttonLabelled(el, "Close the programme"))
    expect(isOpen()).toBe(false)

    click(buttonLabelled(el, "Programme"))
    flushSync(() => scrim.click())
    expect(isOpen()).toBe(false)

    // the staves and the random exercise, with its inputs under it
    click(buttonLabelled(el, "Programme"))
    expect(["Treble", "Bass", "Grand", "Chord"].every(name => buttonNamed(drawer, name))).toBe(true)
    let selected = drawer.querySelector(`.${drawerStyles.exercise}.${drawerStyles.selected}`)
    expect(selected.textContent).toContain("Random notes")
    expect(selected.textContent).toContain("❖")
    expect(selected.querySelector(`.${drawerStyles.generator_inputs}`)).not.toBe(null)

    // settings apply as they are picked
    click(buttonNamed(drawer, "G"))
    expect(el.querySelector("h1").textContent).toEqual("Random notes in G major")
    click(buttonNamed(drawer, "B♭"))
    expect(el.querySelector("h1").textContent).toEqual("Random notes in B♭ major")
    click(buttonNamed(drawer, "Chromatic"))
    expect(el.querySelector("h1").textContent).toEqual("Random notes chromatic")

    click(buttonNamed(drawer, "Scroll"))
    expect(page.state.mode).toEqual("scroll")
    click(buttonNamed(drawer, "Wait"))
    expect(page.state.mode).toEqual("wait")

    spyOn(page, "refreshNoteList").and.callThrough()
    click(buttonNamed(drawer, "Take your seat"))
    expect(isOpen()).toBe(false)
    expect(page.refreshNoteList).toHaveBeenCalled()
  })

  it("toggles the session and the elapsed clock", function() {
    jasmine.clock().install()
    clockInstalled = true
    jasmine.clock().mockDate(new Date(2026, 8, 14, 20))

    let el = renderPage()
    let tick = ms => flushSync(() => jasmine.clock().tick(ms))

    expect(buttonNamed(el, "Begin")).toBeDefined()
    expect(plateStatus(el)).toEqual("At rest")
    expect(statValue(el, "Elapsed")).toEqual("0:00")

    // at rest, key presses aren't judged
    play([WRONG_NOTE])
    expect(page.state.stats.misses).toEqual(0)
    tick(2000)
    expect(statValue(el, "Elapsed")).toEqual("0:00")

    let restStats = page.state.stats
    click(buttonNamed(el, "Begin"))
    expect(buttonNamed(el, "Rest").getAttribute("aria-pressed")).toEqual("true")
    expect(page.state.stats).not.toBe(restStats)
    expect(plateStatus(el)).toMatch(/^Next · [A-G]/)

    tick(1000)
    expect(statValue(el, "Elapsed")).toEqual("0:01")
    tick(64000)
    expect(statValue(el, "Elapsed")).toEqual("1:05")

    click(buttonNamed(el, "Rest"))
    expect(buttonNamed(el, "Begin")).toBeDefined()
    expect(plateStatus(el)).toEqual("At rest")
    tick(5000)
    expect(statValue(el, "Elapsed")).toEqual("1:05")

    click(buttonNamed(el, "Begin"))
    expect(statValue(el, "Elapsed")).toEqual("0:00")
    tick(3000)
    expect(statValue(el, "Elapsed")).toEqual("0:03")
  })

  it("shows hits and misses on the stat cards and saves the session on rest", async function() {
    let el = renderPage()
    expect(el.textContent).toContain("Nothing played yet")

    click(buttonNamed(el, "Begin"))
    expect(statValue(el, "Accuracy")).toEqual("—")

    play(page.state.notes.currentColumn())
    expect(statValue(el, "Notes read")).toEqual("1")
    expect(statValue(el, "Accuracy")).toEqual("100%")
    expect(statValue(el, "Best streak")).toEqual("1")

    play(page.state.notes.currentColumn())
    expect(statValue(el, "Best streak")).toEqual("2")

    play([WRONG_NOTE])
    expect(statValue(el, "Notes read")).toEqual("2")
    expect(statValue(el, "Accuracy")).toEqual("67%")
    expect(statValue(el, "Best streak")).toEqual("2")

    // the accuracy card opens the session stats
    let lightboxes = 0
    container.addEventListener(scopeEvent("showLightbox"), () => lightboxes += 1)
    let accuracyCard = el.querySelector("[role=button]")
    flushSync(() => accuracyCard.click())
    expect(lightboxes).toEqual(1)

    click(buttonNamed(el, "Rest"))

    await waitFor(() => !el.textContent.includes("Nothing played yet"), "the saved session")
    let rows = [...el.querySelectorAll("ol li")].map(li => li.textContent)
    expect(rows).toEqual(["ITreble staff, Random notes67% accuracy"])
    expect(store.recentSessions().length).toEqual(1)
    expect(store.recentSessions()[0].notesRead).toEqual(2)
  })

  it("keeps one session running from Begin to Rest across a staff change and a long pause", async function() {
    jasmine.clock().install()
    clockInstalled = true
    jasmine.clock().mockDate(new Date(2026, 8, 14, 20))

    let el = renderPage()
    let tick = ms => flushSync(() => jasmine.clock().tick(ms))

    click(buttonNamed(el, "Begin"))
    let stats = page.state.stats

    play(page.state.notes.currentColumn())
    play([WRONG_NOTE])
    tick(90000)

    click(buttonLabelled(el, "Programme"))
    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    click(buttonNamed(drawer, "Bass"))
    expect(page.state.currentStaff.name).toEqual("bass")

    expect(page.state.stats).toBe(stats)
    expect(statValue(el, "Notes read")).toEqual("1")
    expect(statValue(el, "Accuracy")).toEqual("50%")
    expect(statValue(el, "Elapsed")).toEqual("1:30")

    tick(NoteStats.SESSION_GAP)
    play(page.state.notes.currentColumn())
    expect(page.state.stats).toBe(stats)
    expect(statValue(el, "Notes read")).toEqual("2")
    expect(statValue(el, "Best streak")).toEqual("1")

    click(buttonNamed(el, "Rest"))

    await waitFor(() => el.querySelectorAll("ol li").length == 1, "the saved session")
    let sessions = store.recentSessions()
    expect(sessions.length).toEqual(1)
    expect(sessions[0].staff).toEqual("bass")
    expect(sessions[0].notesRead).toEqual(2)
    expect(sessions[0].misses).toEqual(1)
  })

  it("restarts a running session, clock included, on clear stats", async function() {
    jasmine.clock().install()
    clockInstalled = true
    jasmine.clock().mockDate(new Date(2026, 8, 14, 20))

    let el = renderPage()
    let tick = ms => flushSync(() => jasmine.clock().tick(ms))

    let lightbox
    container.addEventListener(scopeEvent("showLightbox"), e => lightbox = e.detail[0])

    click(buttonNamed(el, "Begin"))
    play(page.state.notes.currentColumn())
    play(page.state.notes.currentColumn())
    tick(45000)
    expect(statValue(el, "Notes read")).toEqual("2")
    expect(statValue(el, "Elapsed")).toEqual("0:45")

    flushSync(() => el.querySelector("[role=button]").click())
    let lightboxContainer = document.createElement("div")
    document.body.appendChild(lightboxContainer)
    let lightboxRoot = createRoot(lightboxContainer)
    flushSync(() => lightboxRoot.render(lightbox))
    click(buttonNamed(lightboxContainer, "Clear stats"))
    flushSync(() => lightboxRoot.unmount())
    lightboxContainer.remove()

    expect(buttonNamed(el, "Rest")).toBeDefined()
    expect(statValue(el, "Notes read")).toEqual("0")
    expect(statValue(el, "Best streak")).toEqual("0")
    expect(statValue(el, "Elapsed")).toEqual("0:00")

    tick(3000)
    expect(statValue(el, "Elapsed")).toEqual("0:03")
    play(page.state.notes.currentColumn())
    expect(statValue(el, "Notes read")).toEqual("1")

    click(buttonNamed(el, "Rest"))
    expect(buttonNamed(el, "Begin")).toBeDefined()

    await waitFor(() => el.querySelectorAll("ol li").length == 2, "the saved sessions")
    expect(store.recentSessions().map(s => s.notesRead)).toEqual([2, 1])
  })

  it("lists only the sessions started today in the evening list", async function() {
    let session = (id, startedAt, staff) => ({
      id, startedAt, endedAt: startedAt + 60000, staff, generator: "random",
      notesRead: 3, misses: 1, bestStreak: 3, notes: {},
    })

    await store.putSession(session("yesterday", +new Date(2026, 8, 13, 21), "bass"))
    await store.putSession(session("today", +new Date(2026, 8, 14, 19), "treble"))

    jasmine.clock().install()
    clockInstalled = true
    jasmine.clock().mockDate(new Date(2026, 8, 14, 20))

    let el = renderPage()
    let rows = [...el.querySelectorAll("ol li")].map(li => li.textContent)
    expect(rows).toEqual(["ITreble staff, Random notes75% accuracy"])
  })

  it("shows nothing played yet when no session started today", async function() {
    await store.putSession({id: "yesterday", startedAt: +new Date(2026, 8, 13, 21), notesRead: 1, misses: 0})

    jasmine.clock().install()
    clockInstalled = true
    jasmine.clock().mockDate(new Date(2026, 8, 14, 20))

    let el = renderPage()
    expect(el.querySelector("ol")).toBe(null)
    expect(el.textContent).toContain("Nothing played yet")
  })

  it("draws a stored piece in the score's key signature, not the exercises' key", async function() {
    let {piece} = await importMusicXMLPiece("reverie.musicxml", reverieOpening(), store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "treble", generator: "random", key: "C"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
    }))

    let el = renderScorePage()

    // F major: Bb3 is drawn as the score spells it, without an accidental
    expect(page.state.keySignature.name()).toEqual("F")
    let flat = el.querySelector(`.${staffStyles.staff_notes} [data-note="Bb3"]`)
    expect(flat).not.toBe(null)
    expect(flat.classList).not.toContain(staffStyles.is_flat)
    expect(flat.classList).not.toContain(staffStyles.is_sharp)

    // the score's key and staff aren't stored as the exercises'
    expect(JSON.parse(window.localStorage.getItem(DRILL_STORAGE_KEY))).toEqual({staff: "treble", generator: "random", key: "C"})
  })

  it("draws a piece stored without per-measure keys in C major", async function() {
    let legacy = parseMusicXML(reverieOpening())
    delete legacy.metadata.measureKeySignatures
    let {piece} = await addPiece("Rêverie", legacy, store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({key: "D"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
    }))

    let el = renderScorePage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    expect(page.state.keySignature.name()).toEqual("C")
    expect(drawer.textContent).toContain("Re-import to follow the score key")
  })

  it("follows the score's key as the piece and its start measure change", async function() {
    let {piece} = await importMusicXMLPiece("key_change.musicxml", keyChangeScore(), store)

    let el = renderScorePage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let pickPiece = id => {
      let select = drawer.querySelector("select")
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, id)
      flushSync(() => select.dispatchEvent(new Event("change", {bubbles: true})))
      flushSync(() => {})
    }

    // pasted notation has no key of its own
    expect(page.state.keySignature.name()).toEqual("C")

    // the one staff of the score is its treble staff
    pickPiece(piece.id)
    expect(page.state.currentStaff.name).toEqual("treble")
    expect(page.state.keySignature.name()).toEqual("F")

    // the E major section
    typeNumber(drawer, "start measure", "3")
    expect(page.state.keySignature.name()).toEqual("E")

    pickPiece("")
    expect(page.state.currentStaff.name).toEqual("grand")
    expect(page.state.keySignature.name()).toEqual("C")
  })

  it("draws a score in a key the trainer lacks in C major", async function() {
    let {piece} = await importMusicXMLPiece("f_sharp.musicxml", keyChangeScore({keys: [6]}), store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
    }))

    renderScorePage()
    expect(page.state.keySignature.name()).toEqual("C")
  })

  it("keeps the sheet music deck, measure range and hand in the score page's drawer", async function() {
    let {piece} = await importMusicXMLPiece("salon_minuet.musicxml", minuetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS,
    }))

    let el = renderScorePage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let text = drawer.textContent
    for (let label of ["piece", "start measure", "end measure", "hand", "Tempo", "Wait", "Scroll"]) {
      expect(text).toContain(label)
    }
    expect(text).toContain("Salon Minuet")
    expect(text).toContain("both hands")
    expect(buttonNamed(drawer, "Remove")).toBeDefined()
    expect(buttonNamed(drawer, "Export library")).toBeDefined()
    expect(buttonNamed(drawer, "Take your seat")).toBeDefined()
    expect(drawer.querySelectorAll("input[type=file]").length).toEqual(2)
    expect(["start measure", "end measure"].map(label => picker(drawer, label).value)).toEqual(["1", "2"])

    // the score supplies the staves, clefs and key, so the drawer has none of
    // the exercises' clef, exercise or key settings
    expect(text).not.toContain("Clef")
    expect(text).not.toContain("Exercise")
    expect(text).not.toContain("Key")
    expect(text).not.toContain("note range")
    expect(buttonNamed(drawer, "Treble")).toBeUndefined()
    expect(buttonNamed(drawer, "Grand")).toBeUndefined()
    expect(buttonNamed(drawer, "B♭")).toBeUndefined()
    expect(drawer.querySelector(`.${drawerStyles.exercise_list}`)).toBe(null)
    expect(drawer.querySelector("a[href='/setup']")).toBe(null)

    expect(el.querySelector("h1").textContent).toEqual("Salon Minuet measures 1–2, both hands")
    expect(el.textContent).toContain("3 ♩ a bar · measures 1–2")
    expect(page.state.currentStaff.name).toEqual("grand")
  })

  it("keeps the exercises' clef, exercise and key settings on the exercises page, without sheet music", function() {
    let el = renderPage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let text = drawer.textContent
    for (let label of ["Clef", "Exercise", "Tempo", "Key"]) {
      expect(text).toContain(label)
    }
    expect(buttonNamed(drawer, "Treble")).toBeDefined()
    expect(buttonNamed(drawer, "B♭")).toBeDefined()

    let exercises = [...drawer.querySelectorAll(`.${drawerStyles.exercise_name}`)].map(name => name.textContent)
    expect(exercises.length).toBeGreaterThan(1)
    expect(exercises).not.toContain("Sheet music")
    expect(GENERATORS.map(g => g.name)).not.toContain("sheet music")
    expect(drawer.querySelector("input[type=file]")).toBe(null)
  })

  it("falls back to a default exercise when the stored one is sheet music", async function() {
    let {piece} = await importMusicXMLPiece("salon_minuet.musicxml", minuetXML, store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "grand", generator: "sheet music", key: "D"}))
    let sheetMusicSettings = JSON.stringify({piece: piece.id, startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS})
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, sheetMusicSettings)

    let el = renderPage()
    let notesExercises = GENERATORS.filter(g => g.mode == "notes")

    expect(page.state.currentStaff.name).toEqual("grand")
    expect(page.state.currentGenerator).toBe(notesExercises[0])
    expect(page.state.keySignature.name()).toEqual("D")
    expect(page.state.notes.length).toBeGreaterThan(0)
    expect(el.textContent).not.toContain("Salon Minuet")

    // the piece and its settings are left for the score page
    expect(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)).toEqual(sheetMusicSettings)
    flushSync(() => root.unmount())
    container.remove()
    root = null

    el = renderScorePage()
    expect(page.currentPieceSection()).toEqual({
      pieceId: piece.id, pieceTitle: "Salon Minuet", startMeasure: 1, endMeasure: 2,
    })
    expect(el.querySelector("h1").textContent).toEqual("Salon Minuet measures 1–2, both hands")
  })

  it("drills an imported piece picked on the score page and records its stats", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    let el = renderScorePage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let select = drawer.querySelector("select")
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, piece.id)
    flushSync(() => select.dispatchEvent(new Event("change", {bubbles: true})))
    flushSync(() => {})
    click(buttonNamed(drawer, "Take your seat"))

    // the opening four measures, both hands, on the grand staff
    expect(page.state.currentStaff.name).toEqual("grand")
    expect(el.querySelector("h1").textContent).toEqual("Salon Octet measures 1–4, both hands")
    expect([...page.state.notes.currentColumn()]).toEqual(["C3", "C5"])

    click(buttonNamed(el, "Begin"))
    play(page.state.notes.currentColumn())
    play([WRONG_NOTE])
    expect(statValue(el, "Notes read")).toEqual("1")

    click(buttonNamed(el, "Rest"))
    await waitFor(() => store.recentSessions().length == 1, "the session to be saved")

    let [session] = store.recentSessions()
    expect(session.generator).toEqual("sheet music")
    expect(session.settings.pieceTitle).toEqual("Salon Octet")
    expect(session.notesRead).toEqual(1)

    let stats = store.sectionStats(piece.id).find(s => s.startMeasure == 1 && s.endMeasure == 4)
    expect(stats && [stats.hits, stats.misses]).toEqual([1, 1])
  })

  describe("matching the notes played", function() {
    let press = note => flushSync(() => page.pressNote(note))
    let release = note => flushSync(() => page.releaseNote(note))
    let counts = () => [page.state.stats.hits, page.state.stats.misses]
    let head = () => [...page.state.notes.currentColumn()]

    let renderPiece = async (xml, settings, drill) => {
      let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
      if (drill) {
        window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify(drill))
      }
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, ...settings,
      }))
      let el = renderScorePage()
      click(buttonNamed(el, "Begin"))
      return piece
    }

    it("completes a note with a brushed neighbour still held, counting one miss", function() {
      let el = renderPage()
      click(buttonNamed(el, "Begin"))

      let [note] = head()
      press(WRONG_NOTE)
      expect(page.state.noteShaking).toBe(true)
      expect(head()).toEqual([note])
      expect(counts()).toEqual([0, 1])

      press(note)
      expect(page.state.notes.length).toBeGreaterThan(0)
      expect(counts()).toEqual([1, 1])
      expect(page.state.stats.noteHitStats[WRONG_NOTE]).toBeUndefined()

      // the keys let go after the column is done count for nothing
      release(WRONG_NOTE)
      release(note)
      expect(counts()).toEqual([1, 1])

      play(head())
      expect(counts()).toEqual([2, 1])
      expect(statValue(el, "Accuracy")).toEqual("67%")
    })

    it("counts a slip in the MIDI packet that completes the column, in either order", function() {
      let el = renderPage()
      click(buttonNamed(el, "Begin"))

      for (let wrongFirst of [true, false]) {
        let [note] = head()
        let keys = wrongFirst ? [WRONG_NOTE, note] : [note, WRONG_NOTE]
        flushSync(() => keys.forEach(key => page.pressNote(key)))
        keys.forEach(release)
      }

      expect(counts()).toEqual([2, 2])
    })

    it("counts a column missed once however many slips and releases it takes", function() {
      let el = renderPage()
      click(buttonNamed(el, "Begin"))

      let column = head()
      play([WRONG_NOTE])
      expect(counts()).toEqual([0, 1])
      expect(page.state.touchedNotes).toEqual({})
      expect(head()).toEqual(column)

      // nothing matched when every key is up: the column is played afresh
      play([WRONG_NOTE])
      press("A#4")
      release("A#4")
      expect(counts()).toEqual([0, 1])
      expect(head()).toEqual(column)

      play(column)
      expect(counts()).toEqual([1, 1])
    })

    it("completes a chord after a brushed neighbour on the measure cards", async function() {
      let piece = await renderPiece(octetXML, {measuresPerCard: "2"})
      expect(page.state.notes.generator instanceof MeasureCardGenerator).toBe(true)
      expect(head()).toEqual(["C3", "C5"])

      // a neighbour brushed and let go, then the chord
      press("D5")
      release("D5")
      expect(counts()).toEqual([0, 1])
      expect(head()).toEqual(["C3", "C5"])
      play(["C3", "C5"])
      expect(counts()).toEqual([1, 1])
      expect(head()).toEqual(["D3", "D5"])

      // a chord rolled one note at a time isn't a slip
      press("D3")
      press("D5")
      release("D3")
      release("D5")
      expect(counts()).toEqual([2, 1])

      // a neighbour brushed on the way, still down as the chord completes
      press("E3")
      press("F5")
      press("E5")
      expect(counts()).toEqual([3, 2])
      expect(head()).toEqual(["F3", "F5"])
      release("E3")
      release("F5")
      release("E5")

      click(buttonNamed(container, "Rest"))
      await waitFor(() => store.recentSessions().length == 1, "the session to be saved")

      let measureStats = measure =>
        store.sectionStats(piece.id).find(s => s.startMeasure == measure && s.endMeasure == measure)
      expect([measureStats(1).hits, measureStats(1).misses]).toEqual([1, 1])
      expect([measureStats(2).hits, measureStats(2).misses]).toEqual([1, 0])
    })

    it("completes a chord arriving one hand at a time around a held wrong key in the whole section", async function() {
      await renderPiece(octetXML, {measuresPerCard: "all"}, {mode: "scroll"})
      expect(page.state.notes.generator instanceof SheetMusicGenerator).toBe(true)
      expect(head()).toEqual(["C3", "C5"])

      press("C3")
      press("B4")
      expect(counts()).toEqual([0, 1])
      press("C5")
      expect(counts()).toEqual([1, 1])
      expect(head()).toEqual(["D3", "D5"])
    })

    it("completes the notes over a note held on from an earlier column", async function() {
      await renderPiece(leadRestXML, {endMeasure: 1})
      expect(head()).toEqual(["C3", "C5"])

      press("C3")
      press("C5")
      release("C5")
      expect(head()).toEqual(["D5"])

      // the held C3 isn't struck again, nor a slip, nor missed when let go
      play(["D5"])
      expect(head()).toEqual(["E5"])
      play(["E5"])
      release("C3")
      expect(counts()).toEqual([3, 0])
    })
  })

})
