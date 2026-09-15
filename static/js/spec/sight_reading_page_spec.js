import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import SightReadingPage, {
  formatElapsed, accuracyPercent, romanNumeral
} from "st/components/pages/sight_reading_page"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"
import {setAppStore} from "st/storage"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS} from "st/data"
import {DRILL_STORAGE_KEY} from "st/generators"
import {scopeEvent} from "st/events"
import NoteStats from "st/note_stats"
import {openTestStore} from "spec/helpers"

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

// C#5 is outside C major, so never a random note in that key
const WRONG_NOTE = "C#5"

let buttonNamed = (el, text) =>
  [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)

let buttonLabelled = (el, label) => el.querySelector(`button[aria-label="${label}"]`)

let statValue = (el, label) => {
  let labelEl = [...el.querySelectorAll("div")].find(div =>
    div.children.length == 0 && div.textContent == label)
  return labelEl.nextElementSibling.textContent
}

let plateStatus = el => [...el.querySelectorAll("[aria-live]")][0].textContent

let waitFor = async (fn, message) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) { return }
    await new Promise(resolve => setTimeout(resolve, 10))
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

    jasmine.clock().uninstall()
    clockInstalled = false

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

    jasmine.clock().uninstall()
    clockInstalled = false

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
