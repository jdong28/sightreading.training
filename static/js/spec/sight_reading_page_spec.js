import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import SightReadingPage, {
  formatElapsed, accuracyPercent, romanNumeral, MIN_FIT_SCALE, PLATE_STAFF_SCALE
} from "st/components/pages/sight_reading_page"
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
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS} from "st/data"
import {DRILL_STORAGE_KEY} from "st/generators"
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

  const STORAGE_KEYS = [DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

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

  let renderPage = () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      // the programme drawer links to the setup page
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(SightReadingPage, {ref: p => page = p})))
    })
    // the mount's own state updates
    flushSync(() => {})
    return container
  }

  let click = button => flushSync(() => button.click())

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

  it("fits a unit with a stacked second at the wider minimum column width", async function() {
    let {piece: seconds} = await importMusicXMLPiece("seconds.musicxml", secondsXML("Seconds", true), store)
    let {piece: singles} = await importMusicXMLPiece("singles.musicxml", secondsXML("Singles", false), store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "grand", generator: "sheet music"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: seconds.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    renderPage()
    // a plate too narrow for the section's columns at any allowed width
    flushSync(() => page.setState({staffWidth: 200}))

    let columnsOf = () => page.state.notes.generator.cards[0].columns
    let layout = page.staffLayout()
    let stackedWidth = minNoteWidth(columnsOf(), page.state.keySignature)

    expect([...page.state.notes.currentColumn()]).toEqual(["C3", "E4", "F4"])
    expect(layout.scale).toEqual(MIN_FIT_SCALE)
    expect(layout.noteWidth).toEqual(stackedWidth)

    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, piece: singles.id,
    }))

    layout = page.staffLayout()
    let singleWidth = minNoteWidth(columnsOf(), page.state.keySignature)

    expect([...page.state.notes.currentColumn()]).toEqual(["C3", "E4"])
    expect(layout.scale).toEqual(MIN_FIT_SCALE)
    expect(layout.noteWidth).toEqual(singleWidth)

    // the stacked second's column keeps the group offset's room as well
    expect(stackedWidth).toEqual(singleWidth + GROUP_OFFSET)
  })

  it("shows the measure card on the staff and in the plate header", async function() {
    let {piece} = await importMusicXMLPiece("salon_octet.musicxml", octetXML, store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "grand", generator: "sheet music"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 8, hand: BOTH_HANDS, measuresPerCard: "2",
    }))

    let el = renderPage()
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

    // the whole section loops without a card number, its start coming round
    // again after its last measure
    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, measuresPerCard: "all",
    }))
    expect(plateLabel()).toEqual("3 ♩ a bar · measures 1–8")
    expect(numberedBarLines()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "1", "2"])
  })

  it("keeps a score note below the staff inside the plate in both modes", async function() {
    // the score writes the left hand in treble clef, so its A3 hangs two
    // ledger lines below the lower staff
    let {piece} = await importMusicXMLPiece("treble_left.musicxml", clefChangeScore({
      clefs: [["G", 2], ["G", 2]],
      notes: [["A", 3], ["A", 3], ["A", 3], ["A", 3]],
    }), store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({
      staff: "grand", generator: "sheet music", mode: "scroll",
    }))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    let el = renderPage()
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

  it("draws a stored piece in the score's key signature, not the stored key", async function() {
    let {piece} = await importMusicXMLPiece("reverie.musicxml", reverieOpening(), store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "grand", generator: "sheet music", key: "C"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
    }))

    let el = renderPage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let keyPill = name => buttonNamed(drawer, name)

    // F major: Bb3 is drawn as the score spells it, without an accidental
    expect(page.state.keySignature.name()).toEqual("F")
    let flat = el.querySelector(`.${staffStyles.staff_notes} [data-note="Bb3"]`)
    expect(flat).not.toBe(null)
    expect(flat.classList).not.toContain(staffStyles.is_flat)
    expect(flat.classList).not.toContain(staffStyles.is_sharp)

    expect(keyPill("F").getAttribute("aria-pressed")).toEqual("true")
    expect(keyPill("F").disabled).toBe(true)
    expect(keyPill("C").disabled).toBe(true)
    expect(drawer.textContent).toContain("Set by the score")

    // the score's key isn't stored as the programme's
    expect(JSON.parse(window.localStorage.getItem(DRILL_STORAGE_KEY)).key).toEqual("C")
  })

  it("leaves the key alone for a piece stored without per-measure keys", async function() {
    let legacy = parseMusicXML(reverieOpening())
    delete legacy.metadata.measureKeySignatures
    let {piece} = await addPiece("Rêverie", legacy, store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "grand", generator: "sheet music", key: "D"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
    }))

    let el = renderPage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    expect(page.state.keySignature.name()).toEqual("D")
    expect(buttonNamed(drawer, "D").getAttribute("aria-pressed")).toEqual("true")
    expect(buttonNamed(drawer, "F").disabled).toBe(false)
    expect(drawer.textContent).toContain("Re-import to follow the score key")
    expect(drawer.textContent).not.toContain("Set by the score")

    click(buttonNamed(drawer, "F"))
    expect(page.state.keySignature.name()).toEqual("F")
  })

  it("follows the score's key as the piece and its start measure change", async function() {
    let {piece} = await importMusicXMLPiece("key_change.musicxml", keyChangeScore(), store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "treble", generator: "sheet music", key: "D"}))

    let el = renderPage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let keyPill = name => buttonNamed(drawer, name)
    let pickPiece = id => {
      let select = drawer.querySelector(`.${drawerStyles.exercise}.${drawerStyles.selected} select`)
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, id)
      flushSync(() => select.dispatchEvent(new Event("change", {bubbles: true})))
      flushSync(() => {})
    }

    // pasted notation keeps the programme's key
    expect(page.state.keySignature.name()).toEqual("D")
    expect(keyPill("D").disabled).toBe(false)

    pickPiece(piece.id)
    expect(page.state.keySignature.name()).toEqual("F")
    expect(keyPill("F").getAttribute("aria-pressed")).toEqual("true")
    expect(keyPill("D").disabled).toBe(true)

    // the E major section
    let startMeasure = [...drawer.querySelectorAll("input[type=number]")][0]
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(startMeasure, "3")
    flushSync(() => startMeasure.dispatchEvent(new Event("input", {bubbles: true})))
    flushSync(() => {})
    expect(page.state.keySignature.name()).toEqual("E")
    expect(keyPill("E").getAttribute("aria-pressed")).toEqual("true")

    expect(JSON.parse(window.localStorage.getItem(DRILL_STORAGE_KEY)).key).toEqual("D")

    // back to pasted notation, the programme's own key comes back
    pickPiece("")
    expect(page.state.keySignature.name()).toEqual("D")
    expect(keyPill("D").getAttribute("aria-pressed")).toEqual("true")
    expect(keyPill("D").disabled).toBe(false)
    expect(drawer.textContent).not.toContain("Set by the score")
    click(keyPill("A"))
    expect(page.state.keySignature.name()).toEqual("A")
  })

  it("keeps the programme's key for a score in a key the trainer lacks", async function() {
    let {piece} = await importMusicXMLPiece("f_sharp.musicxml", keyChangeScore({keys: [6]}), store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "treble", generator: "sheet music", key: "C"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
    }))

    let el = renderPage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    expect(page.state.keySignature.name()).toEqual("C")
    expect(buttonNamed(drawer, "C").disabled).toBe(false)

    // a picked key sticks even when it can't be stored
    spyOn(Storage.prototype, "setItem").and.throwError(new DOMException("blocked", "SecurityError"))
    click(buttonNamed(drawer, "D"))
    expect(page.state.keySignature.name()).toEqual("D")

    let endMeasure = [...drawer.querySelectorAll("input[type=number]")][1]
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(endMeasure, "3")
    flushSync(() => endMeasure.dispatchEvent(new Event("input", {bubbles: true})))
    expect(page.state.keySignature.name()).toEqual("D")
    Storage.prototype.setItem.and.callThrough()
  })

  it("keeps the sheet music deck, measure range and hand in the drawer", async function() {
    let {piece} = await importMusicXMLPiece("salon_minuet.musicxml", minuetXML, store)

    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "grand", generator: "sheet music"}))
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS,
    }))

    let el = renderPage()
    click(buttonLabelled(el, "Programme"))

    let drawer = el.querySelector(`.${drawerStyles.drawer}`)
    let selected = drawer.querySelector(`.${drawerStyles.exercise}.${drawerStyles.selected}`)
    expect(selected.textContent).toContain("Sheet music")

    let text = selected.textContent
    for (let label of ["piece", "start measure", "end measure", "hand"]) {
      expect(text).toContain(label)
    }
    expect(text).toContain("Salon Minuet")
    expect(text).toContain("both hands")
    expect(buttonNamed(selected, "Remove")).toBeDefined()
    expect(buttonNamed(selected, "Export library")).toBeDefined()
    expect(selected.querySelectorAll("input[type=file]").length).toEqual(2)
    expect([...selected.querySelectorAll("input[type=number]")].map(input => input.value)).toEqual(["1", "2"])

    expect(el.querySelector("h1").textContent).toEqual("Salon Minuet measures 1–2, both hands")
    expect(el.textContent).toContain("3 ♩ a bar · measures 1–2")
  })
})
