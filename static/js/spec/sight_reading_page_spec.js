import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import SightReadingPage, {
  formatElapsed, accuracyPercent, romanNumeral, MISSING_ENGINE_SOURCE, FAILED_ENGINE_SOURCE
} from "st/components/pages/sight_reading_page"
import ScorePage, {SCORE_PROGRAMME} from "st/components/pages/score_page"
import NoteList from "st/note_list"
import staffStyles from "st/components/staff.module.css"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"
import {setAppStore} from "st/storage"
import {importMusicXMLPiece, addPiece} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {
  GENERATORS, SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, RIGHT_HAND, WHOLE_SECTION, FREE_PRACTICE
} from "st/data"
import {PlanGenerator} from "st/plan_cards"
import {AGAIN, GOOD, EASY} from "st/srs/grade"
import {IN_ORDER, RANDOM_ORDER, MeasureCardGenerator} from "st/measure_cards"
import {DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {scopeEvent} from "st/events"
import NoteStats, {addNoteListener} from "st/note_stats"
import {parseNote} from "st/music"
import {openTestStore, noteXML, reverieOpening, keyChangeScore} from "spec/helpers"

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

// a two staff 4/4 bar the right hand opens on a G5 held for three beats,
// the left hand playing a quarter under it on each beat, closing on F5 over C3
let heldTrebleXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Held Treble</work-title></work>
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
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      ${["C", "G", "E", "C"].map(step =>
        `<note><pitch><step>${step}</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>`).join("")}
    </measure>
  </part>
</score-partwise>`

// a two staff piece, one measure, whose column is [C#3, C#6]: C#6 is outside
// the grand staff's usual C2-C6 range (as in the Nocturne's bar 7, see
// sr-note-detection-l3), C#3 within it
let wideRangeXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Wide Range</work-title></work>
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
      <note><pitch><step>C</step><alter>1</alter><octave>6</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><alter>1</alter><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

// a two staff piece, one measure of two columns: a bass octave G#1+G#2 under
// E4, then C3 under E4. G#1 is below the grand staff's usual C2-C6 range (as
// in the Nocturne's bass), so the app staff drops it from the first column
let splitOctaveXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Split Octave</work-title></work>
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
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><alter>1</alter><octave>1</octave></pitch><duration>2</duration><staff>2</staff></note>
      <note><chord/><pitch><step>G</step><alter>1</alter><octave>2</octave></pitch><duration>2</duration><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

// two measures on two staves: bar 1 ends on a bass octave G#1+G#2 under E4,
// bar 2 is C3 under E4, with no G#1 anywhere in it
let barOctaveXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Bar Octave</work-title></work>
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
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><alter>1</alter><octave>1</octave></pitch><duration>4</duration><staff>2</staff></note>
      <note><chord/><pitch><step>G</step><alter>1</alter><octave>2</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
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
  // own staff (as when the engine can't draw it, or for a piece stored
  // without its score);
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

  it("shows the measure card on the staff and in the plate header", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "2",
    }))

    let el = renderScorePage()
    let plateLabel = () => el.querySelector("[aria-live]").previousElementSibling.textContent

    let upperNotes = () => el.querySelector(`.${staffStyles.staff_notes}`)
    let noteLefts = () => [...upperNotes().querySelectorAll(`.${staffStyles.note}`)]
      .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
    // the slide of the notes, see Staff#setOffset
    let offset = () => {
      let match = upperNotes().style.transform.match(/translate3d\(([-\d.]+)px/)
      return match ? parseFloat(match[1]) : 0
    }

    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–2 of 1–8")
    // plain whole notes a column apart, as the app's staff draws any drill
    expect([...el.querySelectorAll(`.${staffStyles.note}`)]
      .every(note => note.classList.contains(staffStyles.whole_note))).toBe(true)

    let [head, next] = noteLefts()
    let columnWidth = next - head
    expect(columnWidth).toBeGreaterThan(0)
    let nextOnStaff = next + offset()

    click(buttonNamed(el, "Begin"))
    play(page.state.notes.currentColumn())
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 1 · measures 1–2 of 1–8")

    // the second measure's column becomes the head exactly one column along,
    // so its note slides from where it was without a jump
    expect(noteLefts()[0]).toEqual(head)
    expect(Math.abs(offset() - columnWidth)).toBeLessThan(1)
    expect(Math.abs(noteLefts()[0] + offset() - nextOnStaff)).toBeLessThan(1)

    play(page.state.notes.currentColumn())
    expect(plateLabel()).toEqual("3 ♩ a bar · Card 2 · measures 3–4 of 1–8")

    // the whole section is one looping card however long it is, its start
    // coming round again after its last measure
    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, measuresPerCard: "all",
    }))
    expect(plateLabel()).toEqual("3 ♩ a bar · measures 1–8")
    for (let i = 0; i < 8; i++) {
      play(page.state.notes.currentColumn())
    }
    expect(plateLabel()).toEqual("3 ♩ a bar · measures 1–8")
    expect([...page.state.notes.currentColumn()]).toEqual(["C3", "C5"])
  })

  it("plays the whole section as the one looping card in both modes", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    renderScorePage()
    let wholeSection = [1, 2, 3, 4, 5, 6, 7, 8]

    expect(page.state.mode).toEqual("scroll")
    let drilling = page.state.notes.generator
    expect(drilling instanceof MeasureCardGenerator).toBe(true)
    expect(drilling.cards.map(card => card.measures)).toEqual([wholeSection])
    expect(page.currentCard().number).toBe(null)
    expect([...page.state.notes].some(column => !column.length)).toBe(false)

    // the mode leaves the drill be
    flushSync(() => page.setMode("wait"))
    expect(page.state.notes.generator).toBe(drilling)
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

    // a card takes up to the whole section, on the app's staff too
    typeNumber(drawer, "measures per card", "9")
    expect(page.state.currentGeneratorSettings.measuresPerCard).toEqual(5)
    expect(picker(drawer, "measures per card").getAttribute("aria-valuemax")).toEqual("5")
    expect(drawer.textContent).toContain("of 5")
    expect(drawer.textContent).not.toContain("Cards stop")
    expect(page.currentCard().card.measures).toEqual([3, 4, 5, 6, 7])

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
    // the one measure of the section left
    expect(page.currentCard().card.measures).toEqual([8])

    click(buttonLabelled(el, "Programme"))
    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    expect(["start measure", "end measure", "measures per card"].map(label => picker(drawer, label).value))
      .toEqual(["8", "8", "1"])
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

  it("opens the accuracy card's lightbox on Space without also skipping a note, unlike Space elsewhere", function() {
    let el = renderPage()
    click(buttonNamed(el, "Begin"))

    let lightboxes = 0
    container.addEventListener(scopeEvent("showLightbox"), () => lightboxes += 1)

    let accuracyCard = el.querySelector("[role=button]")
    flushSync(() => accuracyCard.focus())

    let notes = page.state.notes
    let space = () => new KeyboardEvent("keydown", {key: " ", keyCode: 32, bubbles: true})

    flushSync(() => accuracyCard.dispatchEvent(space()))
    expect(lightboxes).toEqual(1)
    expect(page.state.notes).toBe(notes)

    // Space anywhere else still skips the current note
    flushSync(() => el.dispatchEvent(space()))
    expect(page.state.notes).not.toBe(notes)
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

  it("keeps a rested session's own label and figures through a later staff change, on Begin and on unmount", async function() {
    let el = renderPage()
    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let openDrawer = () => { click(buttonLabelled(el, "Programme")); drawer = el.querySelector(`.${drawerStyles.drawer}`) }

    click(buttonNamed(el, "Begin"))
    play(page.state.notes.currentColumn())
    click(buttonNamed(el, "Rest"))

    await waitFor(() => store.recentSessions().length == 1, "the first saved session")
    expect(store.recentSessions()[0].staff).toEqual("treble")
    expect(store.recentSessions()[0].notesRead).toEqual(1)

    // changing the staff at rest must not relabel the session just recorded
    openDrawer()
    click(buttonNamed(drawer, "Bass"))
    expect(page.state.currentStaff.name).toEqual("bass")
    expect(store.recentSessions().length).toEqual(1)
    expect(store.recentSessions()[0].staff).toEqual("treble")
    expect(store.recentSessions()[0].notesRead).toEqual(1)

    // Begin starts a genuinely new session, recorded under the new staff
    click(buttonNamed(el, "Begin"))
    play(page.state.notes.currentColumn())
    click(buttonNamed(el, "Rest"))

    await waitFor(() => store.recentSessions().length == 2, "the second saved session")
    expect(store.recentSessions()[0].staff).toEqual("treble")
    expect(store.recentSessions()[1].staff).toEqual("bass")
    expect(store.recentSessions()[1].notesRead).toEqual(1)

    // changing the staff again at rest, then unmounting (as a closed tab
    // would), must not relabel the session either
    openDrawer()
    click(buttonNamed(drawer, "Treble"))
    flushSync(() => root.unmount())
    root = null

    expect(store.recentSessions().length).toEqual(2)
    expect(store.recentSessions()[1].staff).toEqual("bass")
    expect(store.recentSessions()[1].notesRead).toEqual(1)
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

  // A piece the engine can't draw, stored without its score or failing to be
  // engraved, is practised on the app's staff as plain note columns
  describe("a piece the engine can't draw", function() {
    let cases = {
      "stored without its score": [MISSING_ENGINE_SOURCE, {readSource: () => Promise.resolve(null)}],
      "whose score can't be engraved": [FAILED_ENGINE_SOURCE, {
        loadEngines: () => Promise.reject(new Error("offline")),
      }],
    }

    for (let [what, [note, props]] of Object.entries(cases)) {
      for (let mode of ["wait", "scroll"]) {
        it(`is played on the app's staff in ${mode} mode when ${what}`, async function() {
          spyOn(console, "warn")
          let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)
          window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode}))
          window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
            piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
          }))

          let el = renderPage(ScorePage, props)
          await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`) &&
            el.textContent.includes(note), "the app's staff")

          expect(page.state.mode).toEqual(mode)
          expect(el.querySelector("[data-score-card]")).toBe(null)
          let notes = [...el.querySelectorAll(`.${staffStyles.note}`)]
          expect(notes.length).toBeGreaterThan(0)
          expect(notes.every(head => head.classList.contains(staffStyles.whole_note))).toBe(true)

          // the whole section is still the one card, however many measures
          expect(page.currentCard().card.measures).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

          // and it is judged, counted and recorded as on the engine's card
          flushSync(() => page.beginSession())
          play([WRONG_NOTE])
          play(page.state.notes.currentColumn())
          expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 1])
          expect([...page.state.notes.currentColumn()]).toEqual(["D3", "D5"])
        })
      }
    }

    // D5(a): a note the fallback staff couldn't draw is dropped from the
    // column, and a press of it is ignored outright rather than a wrong key
    for (let [what, [note, props]] of Object.entries(cases)) {
      it(`ignores a press of a note it had to drop from range, ${what} (D5a)`, async function() {
        spyOn(console, "warn")
        let {piece} = await importMusicXMLPiece("wide_range.musicxml", wideRangeXML, store)
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: piece.id, startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS, measuresPerCard: "all",
        }))

        let el = renderPage(ScorePage, props)
        await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`) &&
          el.textContent.includes(note), "the app's staff")

        // the fallback staff drew only the in-range note; the column
        // doesn't require the dropped C#6
        expect([...page.state.notes.currentColumn()]).toEqual(["C#3"])

        flushSync(() => page.beginSession())
        play(["C#6"])
        expect([page.state.stats.hits, page.state.stats.misses]).toEqual([0, 0])

        play(["C#3"])
        expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 0])
      })

      it(`still counts a press outside the staff's range that the column never had a wrong key, ${what} (D5a)`, async function() {
        spyOn(console, "warn")
        let {piece} = await importMusicXMLPiece("wide_range.musicxml", wideRangeXML, store)
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: piece.id, startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS, measuresPerCard: "all",
        }))

        let el = renderPage(ScorePage, props)
        await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`) &&
          el.textContent.includes(note), "the app's staff")

        flushSync(() => page.beginSession())
        play(["A0"])
        expect([page.state.stats.hits, page.state.stats.misses]).toEqual([0, 1])

        play(["C#3"])
        expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 1])
      })

      it(`ignores a dropped note of the card pressed after its column was hit, ${what} (D5a)`, async function() {
        spyOn(console, "warn")
        let {piece} = await importMusicXMLPiece("split_octave.musicxml", splitOctaveXML, store)
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: piece.id, startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS, measuresPerCard: "all",
        }))

        let el = renderPage(ScorePage, props)
        await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`) &&
          el.textContent.includes(note), "the app's staff")

        expect([...page.state.notes.currentColumn()].sort()).toEqual(["E4", "G#2"])

        // the octave's two note-ons arrive apart: G#2 first hits the column,
        // and G#1, dropped from it, lands on the next column
        flushSync(() => page.beginSession())
        flushSync(() => page.pressNote("E4"))
        flushSync(() => page.pressNote("G#2"))
        expect([...page.state.notes.currentColumn()].sort()).toEqual(["C3", "E4"])

        flushSync(() => page.pressNote("G#1"))
        expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 0])
      })

      it(`ignores a dropped note pressed after its card's last column was hit, ${what} (D5a)`, async function() {
        spyOn(console, "warn")
        let {piece} = await importMusicXMLPiece("bar_octave.musicxml", barOctaveXML, store)
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: piece.id, startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS, measuresPerCard: "1",
          order: IN_ORDER,
        }))

        let el = renderPage(ScorePage, props)
        await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`) &&
          el.textContent.includes(note), "the app's staff")

        expect(page.currentCard().card.measures).toEqual([1])
        expect([...page.state.notes.currentColumn()].sort()).toEqual(["E4", "G#2"])

        // G#2 hits bar 1's last column and the deck moves on to bar 2 before
        // G#1, dropped from bar 1, arrives
        flushSync(() => page.beginSession())
        flushSync(() => page.pressNote("E4"))
        flushSync(() => page.pressNote("G#2"))
        expect(page.currentCard().card.measures).toEqual([2])

        flushSync(() => page.pressNote("G#1"))
        expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 0])
      })
    }
  })

  // T1: the engine draws a piece's whole source, so detection covers the
  // whole keyboard rather than the staff's own C2-C6 range
  describe("whole keyboard detection on the engine path (T1)", function() {
    it("keeps a note outside the grand staff's own range required, with no miss for it", async function() {
      let {piece} = await importMusicXMLPiece("wide_range.musicxml", wideRangeXML, store)
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS, measuresPerCard: "all",
      }))

      let el = renderPage(ScorePage)
      await waitFor(() => page.state.engineSource && page.state.engineSource.status == "ready",
        "the engine's source")
      await waitFor(() => [...page.state.notes.currentColumn()].includes("C#6"),
        "the whole-keyboard column")

      expect([...page.state.notes.currentColumn()].sort()).toEqual(["C#3", "C#6"])

      flushSync(() => page.beginSession())
      play(["C#3", "C#6"])
      expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 0])
    })
  })

  // each pass through a card is an attempt, graded and written as reviews
  describe("recording attempts", function() {
    let piece

    let renderSection = async (settings, drill) => {
      piece = (await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)).piece
      if (drill) {
        window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify(drill))
      }
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, ...settings,
      }))
      let el = renderScorePage()
      click(buttonNamed(el, "Begin"))
      return el
    }

    let playHead = () => play(page.state.notes.currentColumn())
    let finished = () => page.state.notes.generator.finishing
    let reviews = () => store.reviews({pieceId: piece.id})
    let stats = (start, end=start) =>
      store.sectionStats(piece.id).find(s => s.startMeasure == start && s.endMeasure == end)

    it("writes a clean card as a review of the card and of each measure, with its hand and counts", async function() {
      let el = await renderSection({measuresPerCard: "2"})
      playHead()
      playHead()
      await finished()

      let written = await reviews()
      expect(written.map(r => [r.itemId, r.kind, r.grade, r.columns, r.clean, r.misses, r.mode])).toEqual([
        [`${piece.id}:both:1-1`, "attempt", EASY, 1, 1, 0, "wait"],
        [`${piece.id}:both:1-2`, "attempt", EASY, 2, 2, 0, "wait"],
        [`${piece.id}:both:2-2`, "attempt", EASY, 1, 1, 0, "wait"],
      ])
      expect(written[1].bars.map(bar => bar.slice(0, 4))).toEqual([[1, 1, 1, 0], [2, 1, 1, 0]])
      expect(written.every(r => r.sessionId == page.state.stats.id)).toBe(true)
      expect([stats(1).hits, stats(2).hits, stats(1, 2).hits]).toEqual([1, 1, 2])

      // the session counts the notes read in each clef
      click(buttonNamed(el, "Rest"))
      await waitFor(() => store.recentSessions().length == 1, "the session to be saved")
      expect(store.recentSessions()[0].clefs).toEqual({g: {hits: 2, misses: 0}, f: {hits: 2, misses: 0}})
    })

    it("writes one hand's card under its hand", async function() {
      await renderSection({measuresPerCard: "1", hand: RIGHT_HAND})
      play([WRONG_NOTE])
      playHead()
      await finished()

      let [review] = await reviews()
      expect([review.itemId, review.grade, review.staffMisses]).toEqual([
        `${piece.id}:upper:1-1`, AGAIN, {upper: 1, lower: 0},
      ])
    })

    it("blames a hands-together miss on the staff of the note not held", async function() {
      await renderSection({measuresPerCard: "1"})
      let column = page.currentCard().card.columns[0]
      let noteOn = staff => column.find((note, idx) => column.staves[idx] == staff)
      let lower = noteOn("lower")
      expect(noteOn("upper")).toBeDefined()

      flushSync(() => page.pressNote(lower))
      flushSync(() => page.pressNote(WRONG_NOTE))
      flushSync(() => page.releaseNote(WRONG_NOTE))
      flushSync(() => page.releaseNote(lower))
      expect(page.state.stats.misses).toEqual(1)
      playHead()
      await finished()

      let [review] = await reviews()
      expect([review.itemId, review.staffMisses]).toEqual([`${piece.id}:both:1-1`, {upper: 1, lower: 0}])
    })

    it("counts one slip for a wrong try whose keys come up together", async function() {
      await renderSection({measuresPerCard: "1"})
      let column = page.currentCard().card.columns[0]
      let lower = column.find((note, idx) => column.staves[idx] == "lower")

      flushSync(() => page.pressNote(lower))
      flushSync(() => page.pressNote(WRONG_NOTE))
      flushSync(() => {
        page.releaseNote(WRONG_NOTE)
        page.releaseNote(lower)
      })
      playHead()
      await finished()

      let [review] = await reviews()
      expect([review.misses, review.staffMisses]).toEqual([1, {upper: 1, lower: 0}])
    })

    it("writes one review a lap of a looping card", async function() {
      await renderSection({endMeasure: 2, measuresPerCard: WHOLE_SECTION})
      for (let i = 0; i < 5; i++) {
        playHead()
      }
      await finished()

      let laps = (await reviews()).filter(r => r.itemId == `${piece.id}:both:1-2`)
      expect(laps.map(r => [r.was, r.grade])).toEqual([["new", EASY], ["tracked", jasmine.any(Number)]])
      expect([stats(1).hits, stats(2).hits, stats(1, 2).attempts]).toEqual([2, 2, 2])
    })

    it("writes no graded review for a card left at Rest, still adding its totals", async function() {
      let el = await renderSection({measuresPerCard: "2"})
      playHead()
      play([WRONG_NOTE])

      click(buttonNamed(el, "Rest"))
      await waitFor(() => store.recentSessions().length == 1, "the session to be saved")
      expect(await reviews()).toEqual([])
      expect([stats(1).hits, stats(1).misses, stats(2).misses, stats(1, 2).misses]).toEqual([1, 0, 1, 1])

      // the rest of the card isn't graded either, the next card is
      click(buttonNamed(el, "Begin"))
      playHead()
      await finished()
      expect(await reviews()).toEqual([])
      expect(stats(2).hits).toEqual(1)

      playHead()
      playHead()
      await finished()
      expect((await reviews()).map(r => r.itemId)).toEqual([
        `${piece.id}:both:3-3`, `${piece.id}:both:3-4`, `${piece.id}:both:4-4`,
      ])
    })

    it("doesn't grade a card whose column was skipped with Space at Rest", async function() {
      let el = await renderSection({measuresPerCard: "2"})
      click(buttonNamed(el, "Rest"))

      // Space skips a column even at rest, moving the card's pass along
      flushSync(() => el.dispatchEvent(new KeyboardEvent("keydown", {key: " ", keyCode: 32, bubbles: true})))
      expect(page.currentCard().card.measures).toEqual([1, 2])

      // Begin abandons that pass: the rest of the card isn't graded, the next card is
      click(buttonNamed(el, "Begin"))
      playHead()
      await finished()
      expect(await reviews()).toEqual([])

      playHead()
      playHead()
      await finished()
      expect((await reviews()).map(r => r.itemId)).toEqual([
        `${piece.id}:both:3-3`, `${piece.id}:both:3-4`, `${piece.id}:both:4-4`,
      ])
    })

    it("counts a section of one measure once", async function() {
      await renderSection({startMeasure: 3, endMeasure: 3})
      play([WRONG_NOTE])
      playHead()
      await finished()

      expect(store.sectionStats(piece.id)).toEqual([jasmine.objectContaining({
        startMeasure: 3, endMeasure: 3, hits: 1, misses: 1, attempts: 1,
      })])
      expect((await reviews()).map(r => [r.itemId, r.grade])).toEqual([[`${piece.id}:both:3-3`, AGAIN]])
    })

    it("never grades a pass in scroll mode easy", async function() {
      await renderSection({measuresPerCard: "2"}, {mode: "scroll"})
      expect(page.state.mode).toEqual("scroll")
      playHead()
      playHead()
      await finished()

      let written = await reviews()
      expect(written.map(r => [r.mode, r.speed, r.grade, r.hesitations])).toEqual(
        Array(3).fill(["scroll", page.state.scrollSpeed, GOOD, 0]))
    })

    // the scroll loop's own advance reaches the matcher as it is made, not
    // when React renders it, so a key that arrives before that render is
    // judged against the column the loop left on the line
    it("judges a key arriving before the loop's render against the column it left", async function() {
      await renderSection({measuresPerCard: "3"}, {mode: "scroll"})

      let scrolled = [...page.state.notes.currentColumn()]
      let onLine = [...page.state.notes[1]]
      expect(onLine).not.toEqual(scrolled)

      // the loop's render is still pending when the key goes down
      page.state.slider.onLoop()
      flushSync(() => scrolled.forEach(note => page.pressNote(note)))
      flushSync(() => scrolled.forEach(note => page.releaseNote(note)))

      // the column that scrolled past can't be played any more: the keys are
      // a wrong try at the one the loop left, not a hit on the one it took
      expect(page.state.stats.hits).toEqual(0)
    })

    // one press can both slip on the head column and complete it: the slip
    // is counted on the column played, before it is taken off the list, so
    // the column counts as hit and the one after it is charged nothing
    it("counts a press that both slips and completes a column on the column it played", async function() {
      await renderSection({measuresPerCard: "3"}, {mode: "scroll"})

      // the wrong key is still down as the column it slipped on scrolls past
      flushSync(() => page.pressNote(WRONG_NOTE))
      flushSync(() => page.state.slider.onLoop())

      let column = [...page.state.notes.currentColumn()]
      flushSync(() => column.forEach(note => page.pressNote(note)))
      flushSync(() => [WRONG_NOTE, ...column].forEach(note => page.releaseNote(note)))

      playHead()
      await finished()

      let written = await reviews()
      expect(written.map(r => [r.itemId, r.misses, r.clean, r.skipped])).toEqual([
        [`${piece.id}:both:1-1`, 2, 0, 0],
        [`${piece.id}:both:1-3`, 3, 1, 0],
        [`${piece.id}:both:2-2`, 1, 0, 0],
        [`${piece.id}:both:3-3`, 0, 1, 0],
      ])
    })
  })

  describe("today's programme", function() {
    let piece

    let renderProgramme = async ({study=true, settings={}}={}) => {
      piece = (await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)).piece
      if (study) {
        await store.putStudy({pieceId: piece.id, status: "learning", startedAt: Date.now()})
      }
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, startMeasure: 3, endMeasure: 4, hand: BOTH_HANDS, measuresPerCard: "2", ...settings,
      }))
      return renderScorePage()
    }

    let playHead = () => play(page.state.notes.currentColumn())
    let finished = async () => {
      await page.state.notes.generator.finishing
      await page.state.notes.generator.studying
      flushSync(() => page.forceUpdate())
    }
    let plate = el => [...el.querySelectorAll("span")].find(span =>
      span.children.length == 0 && span.textContent == "Tonight's programme")
    let caption = el => el.querySelector("[data-caption]")

    it("is the default for a piece in study, prefaced by tonight's programme at rest", async function() {
      let el = await renderProgramme()

      expect(page.state.notes.generator instanceof PlanGenerator).toBe(true)
      expect(el.querySelector("h1").textContent).toContain("today's programme, both hands")
      expect(plate(el)).toBeDefined()
      expect(el.textContent).toContain("New bars on offer8")
      expect(el.textContent).toContain("0 of 8 bars learned")
      expect(plateStatus(el)).toEqual("At rest")

      // the session length is a soft target the plate sets
      click(buttonNamed(el, "10 min"))
      await waitFor(() => store.practiceSettings().sessionMinutes == 10, "the target to be saved")

      click(buttonNamed(el, "Begin"))
      expect(plate(el)).toBeUndefined()
      expect(plateStatus(el)).toEqual("New · bar 1")
      expect(el.textContent).toContain("measures 1–2")
    })

    it("names each card and says when its measure comes back", async function() {
      let el = await renderProgramme()
      click(buttonNamed(el, "Begin"))
      expect(caption(el)).toBe(null)

      // a clean first sight of measures 1 and 2
      playHead()
      playHead()
      await finished()

      let anchor = store.item(`${piece.id}:both:1-1`)
      expect(anchor.state).not.toEqual("tracked")
      expect(caption(el).textContent).toMatch(/^(again in a moment|returns (tomorrow|in \d+ days))$/)
      expect(plateStatus(el)).toEqual("New · bar 3")

      // measure 3 slips: it comes straight back
      play([WRONG_NOTE])
      playHead()
      playHead()
      await finished()

      expect(caption(el).textContent).toEqual("again in a moment")
      expect(plateStatus(el)).toEqual("Once more · bar 3")
      expect(el.textContent).toContain("measures 3–4")
    })

    it("suggests the piece in study most overdue", async function() {
      let other = (await importMusicXMLPiece("minuet.musicxml", minuetXML, store)).piece
      await store.putStudy({pieceId: other.id, status: "maintaining", startedAt: 0})
      let past = Date.now() - 3 * 24 * 3600 * 1000
      await store.recordAttempt({
        item: {
          id: `${other.id}:both:1-1`, pieceId: other.id, hand: "both", startMeasure: 1, endMeasure: 1,
          level: "bar", state: "review", step: 0, due: past, last: past - 86400000, s: 1, d: 5,
          reps: 2, lapses: 0, streak: 2, lastGrade: GOOD, hits: 2, misses: 0, attempts: 2,
          lastPracticed: past - 86400000, recent: [], algo: 1, createdAt: 0,
        },
        review: {
          itemId: `${other.id}:both:1-1`, pieceId: other.id, at: past - 86400000, kind: "legacy",
          hits: 2, misses: 0, attempts: 2,
        },
      })

      let el = await renderProgramme()
      expect(el.textContent).toContain("Salon Minuet has the most bars due.")
      click(buttonNamed(el, "Practise it instead"))
      flushSync(() => {})

      expect(page.currentPieceSection().pieceId).toEqual(other.id)
      expect(page.state.notes.generator instanceof PlanGenerator).toBe(true)
      expect(el.textContent).not.toContain("has the most bars due")
    })

    it("leaves free practice as it was", async function() {
      let el = await renderProgramme({study: false})

      expect(page.state.notes.generator instanceof PlanGenerator).toBe(false)
      expect(plate(el)).toBeUndefined()
      expect(el.querySelector("h1").textContent).toContain("measures 3–4, both hands")
      click(buttonNamed(el, "Begin"))
      expect(plateStatus(el)).toMatch(/^Next · /)

      // in study, free practice is picked in the drawer
      await store.putStudy({pieceId: piece.id, status: "learning", startedAt: Date.now()})
      flushSync(() => page.setGenerator(page.state.currentGenerator, {
        ...page.state.currentGeneratorSettings, practice: FREE_PRACTICE,
      }))
      flushSync(() => {})
      expect(page.state.notes.generator instanceof PlanGenerator).toBe(false)
      expect(page.state.notes.generator.currentCard().measures).toEqual([3, 4])
    })
  })

  describe("on-screen keyboard", function() {
    it("starts hidden and the header toggle shows it", function() {
      let el = renderPage()
      expect(buttonNamed(el, "Hide keyboard")).toBeUndefined()
      expect(el.querySelector('[class*="keyboard_inner"]')).toBeNull()

      click(buttonNamed(el, "Show keyboard"))
      expect(el.querySelector('[class*="keyboard_inner"]')).not.toBeNull()
      expect(buttonNamed(el, "Hide keyboard")).toBeDefined()
    })
  })

  // the chord staff's drill, a ChordList of chords judged only on the
  // release of every key
  describe("chords mode", function() {
    let renderChords = () => {
      window.localStorage.setItem(DRILL_STORAGE_KEY,
        JSON.stringify({staff: "chord", generator: "random"}))
      let el = renderPage()
      click(buttonNamed(el, "Begin"))
      return el
    }

    it("hits a chord on the release of the keys that complete it", function() {
      renderChords()
      expect(page.state.currentGenerator.mode).toEqual("chords")

      let chord = page.state.notes[0]
      let keys = chord.getRange(4, 3)

      // a chord judges nothing until every key is up
      flushSync(() => keys.forEach(note => page.pressNote(note)))
      expect([page.state.stats.hits, page.state.stats.misses]).toEqual([0, 0])

      flushSync(() => keys.forEach(note => page.releaseNote(note)))
      expect([page.state.stats.hits, page.state.stats.misses]).toEqual([1, 0])
      expect(page.state.notes[0]).not.toBe(chord)
      expect(page.state.heldNotes).toEqual({})
    })

    it("misses a chord whose keys don't match on their release", function() {
      renderChords()
      let chord = page.state.notes[0]

      flushSync(() => page.pressNote(WRONG_NOTE))
      flushSync(() => page.releaseNote(WRONG_NOTE))
      expect([page.state.stats.hits, page.state.stats.misses]).toEqual([0, 1])
      expect(page.state.notes[0]).toBe(chord)
    })
  })

  describe("matching the notes played", function() {
    let press = note => flushSync(() => page.pressNote(note))
    let release = note => flushSync(() => page.releaseNote(note))
    // a note on through the page's own Web MIDI handler, as the device sends
    // it: several in one flushSync are one MIDI packet, delivered in one task
    let midiOn = (note, timeStamp=0) =>
      page.onMidiMessage({data: new Uint8Array([0x90, parseNote(note), 100]), timeStamp})
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

    it("counts a slip afresh once the stats start over on the same column", function() {
      let el = renderPage()
      click(buttonNamed(el, "Begin"))

      let column = head()
      play([WRONG_NOTE])
      expect(counts()).toEqual([0, 1])

      // Clear stats during a session
      flushSync(() => page.clearStats())
      expect(head()).toEqual(column)
      play([WRONG_NOTE])
      expect(counts()).toEqual([0, 1])

      // Rest, Clear stats at rest, then Begin
      click(buttonNamed(el, "Rest"))
      flushSync(() => page.clearStats())
      click(buttonNamed(el, "Begin"))
      expect(head()).toEqual(column)
      flushSync(() => {
        page.pressNote(WRONG_NOTE)
        column.forEach(note => page.pressNote(note))
      })
      expect(counts()).toEqual([1, 1])
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

    // The presses of one MIDI packet are judged one at a time against the
    // head each of them saw: a wrong key before the press that completes the
    // column slips on that column, and one after it is a miss on the column
    // the hit moved on to. Either order judges what the same presses spread
    // out in time do
    it("counts a slip batched with the completing press on the head that saw it", function() {
      let el = renderPage()
      click(buttonNamed(el, "Begin"))

      let judged = []
      let stopListening = addNoteListener(({type, notes, blamed}) =>
        judged.push([type, [...(blamed || notes)].sort()]))

      // one order played against the drill's own next column, as one MIDI
      // packet or spread out in time: what it judged, the columns it was
      // judged against and the head it left
      let playOrder = (wrongFirst, batched) => {
        judged.length = 0
        let column = head()
        let next = [...page.state.notes[1]]
        let keys = wrongFirst ? [WRONG_NOTE, ...column] : [...column, WRONG_NOTE]

        if (batched) {
          flushSync(() => keys.forEach(key => page.pressNote(key)))
        } else {
          keys.forEach(press)
        }
        for (let key of keys) { release(key) }

        return {judged: [...judged], column: column.sort(), next, head: head()}
      }

      try {
        for (let batched of [true, false]) {
          let wrongFirst = playOrder(true, batched)
          expect(wrongFirst.judged).toEqual([
            ["miss", wrongFirst.column], ["hit", wrongFirst.column],
          ])
          expect(wrongFirst.head).toEqual(wrongFirst.next)

          let wrongAfter = playOrder(false, batched)
          expect(wrongAfter.judged).toEqual([
            ["hit", wrongAfter.column], ["miss", [...wrongAfter.next].sort()],
          ])
          expect(wrongAfter.head).toEqual(wrongAfter.next)

          // the column that miss was counted on is played, so the next
          // order starts on one with no miss of its own yet
          play(head())
        }
      } finally {
        stopListening()
      }
    })

    it("counts nothing for keys pressed on an empty head column", function() {
      let el = renderPage()
      click(buttonNamed(el, "Begin"))

      flushSync(() => page.setState({notes: new NoteList([[], ["C4"]])}))
      play([WRONG_NOTE])
      press("C4")
      release("C4")
      expect(counts()).toEqual([0, 0])
      expect(page.state.noteShaking).toBe(false)
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

      let generator = page.state.notes.generator
      click(buttonNamed(container, "Rest"))
      await waitFor(() => store.recentSessions().length == 1, "the session to be saved")
      // the finished cards' measure stats are written after the session
      await generator.finishing

      let measureStats = measure =>
        store.sectionStats(piece.id).find(s => s.startMeasure == measure && s.endMeasure == measure)
      expect([measureStats(1).hits, measureStats(1).misses]).toEqual([1, 1])
      expect([measureStats(2).hits, measureStats(2).misses]).toEqual([1, 0])
    })

    it("completes a chord arriving one hand at a time around a held wrong key in the whole section", async function() {
      await renderPiece(octetXML, {measuresPerCard: "all"}, {mode: "scroll"})
      expect(page.state.notes.generator instanceof MeasureCardGenerator).toBe(true)
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

    it("completes a column after the other hand lets up its key over a key held across the hits", async function() {
      await renderPiece(heldTrebleXML, {endMeasure: 1})
      expect(head()).toEqual(["C3", "G5"])

      press("C3")
      press("G5")
      release("C3")
      expect(head()).toEqual(["G3"])
      play(["G3"])
      play(["E3"])
      expect(head()).toEqual(["C3", "F5"])

      // the G5 held since the first column is still down as the left hand
      // lets its C3 up before the right hand's F5 lands: some key stays
      // down, so the column is neither missed nor played afresh
      press("C3")
      release("C3")
      expect(counts()).toEqual([3, 0])
      press("F5")
      expect(counts()).toEqual([4, 0])
      expect(page.state.noteShaking).toBe(false)
      release("F5")
      release("G5")
      expect(counts()).toEqual([4, 0])
    })

    it("counts nothing when keys held across a hit are let up alone", async function() {
      await renderPiece(heldTrebleXML, {endMeasure: 1})

      press("C3")
      press("G5")
      expect(head()).toEqual(["G3"])
      expect(page.state.heldNotes).toEqual({C3: true, G5: true})

      // they played the column before: letting them up isn't a try at this one
      release("C3")
      release("G5")
      expect(page.state.heldNotes).toEqual({})
      expect(counts()).toEqual([1, 0])
      expect(page.state.noteShaking).toBe(false)
      expect(head()).toEqual(["G3"])

      play(["G3"])
      expect(counts()).toEqual([2, 0])
    })

    it("counts each wrong try with a key held across a hit as a further slip", async function() {
      await renderPiece(heldTrebleXML, {endMeasure: 1})
      let slipNotes = spyOn(page.state.stats, "slipNotes").and.callThrough()

      press("C3")
      press("G5")
      release("C3")
      expect(head()).toEqual(["G3"])

      // the G5 is still down through both tries, as no key would be
      press("E3")
      release("E3")
      press("D3")
      release("D3")
      expect(counts()).toEqual([1, 1])
      expect(slipNotes).toHaveBeenCalledTimes(1)

      play(["G3"])
      expect(counts()).toEqual([2, 1])
    })

    // M7 of the note detection report: two key-downs crossing a column
    // boundary in one MIDI packet used to be judged through setState
    // callbacks that all saw the same head, so the second one was a stray on
    // the column the first completed: a false slip, and the column it really
    // belonged to stalled. The matcher judges each press against the head it
    // actually saw, so the packet plays like the same presses spread out
    it("judges the presses of one MIDI packet against the head each saw (M7)", async function() {
      await renderPiece(leadRestXML, {endMeasure: 1})
      expect(head()).toEqual(["C3", "C5"])

      press("C3")
      flushSync(() => {
        midiOn("C5")
        midiOn("D5")
      })

      expect(counts()).toEqual([2, 0])
      expect(head()).toEqual(["E5"])
      expect(page.state.noteShaking).toBe(false)
    })
  })

})
