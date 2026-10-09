import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {PassagePane} from "st/components/sight_reading/passage_pane"
import {ReviewPane} from "st/components/sight_reading/review_pane"
import {importMusicXMLPiece, songToJSON} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, FREE_PRACTICE, WHOLE_SECTION} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {SCORE_VIEW_NO_SOURCE, SCORE_VIEW_FAILED} from "st/components/sight_reading/score_view"
import viewStyles from "st/components/sight_reading/score_view.module.css"
import {SELF_GRADE_DWELL_MS, SELF_GRADE_FLASH_MS} from "st/srs/self_grade"
import {learnedness} from "st/bar_progress"
import reviewStyles from "st/components/sight_reading/review_pane.module.css"
import barStripStyles from "st/components/bar_strip.module.css"

import {flagsInForce} from "st/difficulty/records"
import {withDecisions} from "st/difficulty/decisions"

import {openTestStore, pianoScore} from "spec/helpers"

const QUIET = {upper: ["C4", "D4", "E4", "F4"], lower: ["C3", "D3", "E3", "F3"]}

const DENSE = {
  upper: ["C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4", "C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4"],
  lower: ["C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3", "C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3"],
}

// a second dense run that is no repeat of DENSE, so the two are flagged as
// two passages rather than merged
const DENSE_HIGH = {
  upper: ["G5", "F5", "E5", "D5", "C5", "D5", "E5", "F5", "G5", "F5", "E5", "D5", "C5", "D5", "E5", "F5"],
  lower: ["G3", "F3", "E3", "D3", "C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3", "C3", "D3", "E3", "F3"],
}

function sixteenths(hand) {
  return {
    upper: hand.upper.map(name => ({name, duration: 0.25, type: "16th"})),
    lower: hand.lower.map(name => ({name, duration: 0.25, type: "16th"})),
  }
}

// a piece with a dense run of sixteenths at bars 9-11 (and optionally a
// second, different one), long enough for st/difficulty to flag passages
function workhorseScore({barCount=16, denseAt=[9, 10, 11], alsoDenseAt=[]}={}) {
  let bars = Array.from({length: barCount}, (_, i) => {
    let number = i + 1
    if (denseAt.includes(number)) { return sixteenths(DENSE) }
    if (alsoDenseAt.includes(number)) { return sixteenths(DENSE_HIGH) }
    return {upper: QUIET.upper.map(name => ({name})), lower: QUIET.lower.map(name => ({name}))}
  })
  return pianoScore({title: "Workhorse", bars})
}

let waitFor = async (test, {timeout=15000, message="the condition"}={}) => {
  let start = Date.now()
  for (;;) {
    let value = test()
    if (value) { return value }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe("the score view at rest (st/components/sight_reading/score_view)", function() {
  let container, root, page, store, previousStore, savedStorage
  let clockInstalled = false
  const STORAGE_KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

  beforeEach(async function() {
    savedStorage = STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of STORAGE_KEYS) { window.localStorage.removeItem(key) }

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
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let drillPiece = async (xml, settings={}) => {
    let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice", ...settings,
    }))
    return piece
  }

  let renderScorePage = (props={}) => {
    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, ...props})))
    })
    flushSync(() => {})
    return container
  }

  // the real fixture (tools/fingerings/tests/fixture/score.musicxml, the
  // artboards' own piece: 16 bars, grand staff, C major, one flagged
  // passage "bars 5-9 - Hardest"), mounted through the real ScorePage end
  // to end: pagination, the bar pop-up, shade switching, the Begin/Rest/
  // Resume/End session/Play on/Done state machine, learnedness and
  // acoustic grading
  describe("the fixture, mounted", function() {
    let buttonNamed = (el, text) =>
      [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)
    let buttonLabelled = (el, label) => el.querySelector(`button[aria-label="${label}"]`)
    let click = button => flushSync(() => button.click())
    let statValue = (el, label) => {
      let labelEl = [...el.querySelectorAll("div")].find(div =>
        div.children.length == 0 && div.textContent == label)
      return labelEl.nextElementSibling.textContent
    }
    let dialog = el => el.querySelector('[role="dialog"]')

    let renderFixture = async (settings={}) => {
      let musicXML = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
      let {piece} = await importMusicXMLPiece("fixture.musicxml", musicXML, store)
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, hand: BOTH_HANDS, measuresPerCard: WHOLE_SECTION,
        practice: FREE_PRACTICE, startMeasure: 1, endMeasure: 16, ...settings,
      }))

      container = document.createElement("div")
      container.style.width = "1440px"
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => {
        root.render(React.createElement(MemoryRouter, {},
          React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240})))
      })
      flushSync(() => {})

      await waitFor(() => container.querySelectorAll('button[aria-label^="Bar "]').length > 0,
        {message: "the fixture's bars to draw"})
      return {container, piece}
    }

    let playHead = () => {
      for (let note of page.state.notes.currentColumn()) { flushSync(() => page.pressNote(note)) }
      for (let note of page.state.notes.currentColumn()) { flushSync(() => page.releaseNote(note)) }
    }

    // a full, clean lap of the current card: one playHead per column, so
    // the pass actually finishes and gets graded (one playHead alone only
    // advances a single column)
    let playCard = () => {
      let columns = page.currentCard().card.columns.length
      for (let i = 0; i < columns; i++) { playHead() }
    }

    it("shows the score view at mount: no engine card, no Programme pill, the setup pane, the title and page 1", async function() {
      let {container: el} = await renderFixture()

      expect(el.querySelector("[data-score-card]")).toBe(null)
      expect(buttonLabelled(el, "Programme")).toBeFalsy()
      expect(el.textContent).toContain("Tonight's")
      expect(el.textContent).toContain("At rest")
      expect(el.querySelector("h1").textContent).toEqual("Fixture the score")

      // paginated into whole systems, the first page first, the last to
      // bar 16 (the exact split is score_pages_spec.js's own, pixel-precise
      // test; this only checks the component wires pagination up correctly)
      let pageLabel = el.querySelector(`.${viewStyles.page_label}`).textContent
      expect(pageLabel).toMatch(/^Page 1 of \d+ · bars? 1(–\d+)?$/)
      let barsOnPage1 = el.querySelectorAll('button[aria-label^="Bar "]').length
      expect(barsOnPage1).toBeGreaterThan(0)
      expect(barsOnPage1).toBeLessThan(16)
      expect(buttonNamed(el, "‹ Previous page").disabled).toBe(true)

      click(buttonNamed(el, "Next page ›"))
      expect(el.querySelector('button[aria-label="Bar 16"]')).toBeFalsy()
      // keep clicking through to the last page, which always ends on bar 16
      while (!buttonNamed(el, "Next page ›").disabled) { click(buttonNamed(el, "Next page ›")) }
      expect(el.querySelector('button[aria-label="Bar 16"]')).toBeTruthy()
    })

    it("switches the shade's tints and legend, and offers This session only once a session has ended", async function() {
      let {container: el} = await renderFixture()
      let legend = () => el.querySelector(`.${viewStyles.legend}`)

      expect(buttonNamed(el, "This session")).toBeUndefined()
      expect(legend().textContent).toContain("Not played yet")

      click(buttonNamed(el, "Score difficulty"))
      expect(legend().textContent).toContain("Easier")
      expect(legend().textContent).toContain("harder, from the score analysis")
      expect(legend().textContent).toContain("Review the passages")

      click(buttonNamed(el, "Off"))
      expect(legend()).toBe(null)
    })

    it("opens a clicked bar's pop-up, names its flagged passage, and closes with Escape or ×", async function() {
      let {container: el} = await renderFixture()

      click(buttonLabelled(el, "Bar 5"))
      let pop = dialog(el)
      expect(pop.getAttribute("aria-label")).toEqual("Bar 5 stats")
      expect(pop.textContent).toContain("Passage I · Hardest")

      flushSync(() => document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})))
      expect(dialog(el)).toBe(null)

      click(buttonLabelled(el, "Bar 5"))
      click(buttonLabelled(dialog(el), "Close bar stats"))
      expect(dialog(el)).toBe(null)
    })

    it("Practise bar N sets free practice on that bar alone and begins", async function() {
      let {container: el} = await renderFixture()

      click(buttonLabelled(el, "Bar 5"))
      click(buttonNamed(dialog(el), "Practise bar 5"))

      expect(page.state.currentGeneratorSettings).toEqual(jasmine.objectContaining({
        practice: FREE_PRACTICE, startMeasure: 5, endMeasure: 5, measuresPerCard: WHOLE_SECTION,
      }))
      expect(el.textContent).toContain("measure 5")
    })

    it("Begin replaces the score with the session", async function() {
      let {container: el} = await renderFixture()
      click(buttonNamed(el, "Begin"))

      expect(el.querySelector("[data-score-card]")).not.toBe(null)
      expect(el.textContent).not.toContain("Tonight's")
      expect(el.textContent).toContain("This session")
      expect(el.textContent).toContain("In session · Fixture")
    })

    it("Rest pauses in place; Resume keeps the same session going", async function() {
      let {container: el} = await renderFixture()
      click(buttonNamed(el, "Begin"))
      let statsId = page.state.stats.id
      playHead()
      let notesBefore = statValue(el, "Notes read")

      click(buttonNamed(el, "Rest"))
      expect(el.textContent).toContain("At rest")
      expect(dialog(el)).toBe(null)

      flushSync(() => el.dispatchEvent(new KeyboardEvent("keydown", {key: " ", keyCode: 32, bubbles: true})))
      expect(statValue(el, "Notes read")).toEqual(notesBefore)

      click(buttonNamed(el, "Resume"))
      expect(page.state.stats.id).toEqual(statsId)
      playHead()
      expect(Number(statValue(el, "Notes read"))).toBeGreaterThan(Number(notesBefore))
    })

    it("End session, running or paused, shows the strip with the last Accuracy and marks the bars played; Done clears it", async function() {
      let {container: el} = await renderFixture()
      click(buttonNamed(el, "Begin"))
      playCard()
      await page.state.notes.generator.finishing
      let accuracy = statValue(el, "Accuracy")

      click(buttonNamed(el, "End session"))
      await waitFor(() => el.textContent.includes("Session ended"), {message: "the ended strip"})
      expect(el.textContent).toContain(accuracy)
      expect(buttonNamed(el, "This session").getAttribute("aria-pressed")).toEqual("true")
      // a re-render along the way can briefly reload the engraving; wait
      // for the score (and its tints) to be showing again
      await waitFor(() => el.querySelector('button[aria-label^="Bar "]'), {message: "the score to redraw"})
      expect(el.querySelectorAll(`.${viewStyles.label}`).length).toBeGreaterThan(0)

      click(buttonNamed(el, "Done"))
      expect(el.textContent).not.toContain("Session ended")
      expect(buttonNamed(el, "Learnedness").getAttribute("aria-pressed")).toEqual("true")
    })

    it("End session from a pause also shows the strip", async function() {
      let {container: el} = await renderFixture()
      click(buttonNamed(el, "Begin"))
      playHead()
      click(buttonNamed(el, "Rest"))

      click(buttonNamed(el, "End session"))
      await waitFor(() => el.textContent.includes("Session ended"), {message: "the ended strip"})
    })

    it("Play on resumes the same session into view", async function() {
      let {container: el} = await renderFixture()
      click(buttonNamed(el, "Begin"))
      let statsId = page.state.stats.id
      playHead()
      click(buttonNamed(el, "End session"))
      await waitFor(() => buttonNamed(el, "Play on"), {message: "the ended strip"})

      click(buttonNamed(el, "Play on"))
      expect(el.querySelector("[data-score-card]")).not.toBe(null)
      expect(page.state.stats.id).toEqual(statsId)
    })

    it("End session with nothing played shows no strip", async function() {
      let {container: el} = await renderFixture()
      click(buttonNamed(el, "Begin"))
      click(buttonNamed(el, "End session"))

      expect(el.textContent).not.toContain("Session ended")
    })

    it("labels a bar Learned after three clean passes, and counts it in Learned N /16", async function() {
      let {container: el, piece} = await renderFixture({startMeasure: 1, endMeasure: 1})
      click(buttonNamed(el, "Begin"))

      for (let i = 0; i < 3; i++) {
        playCard()
        await page.state.notes.generator.finishing
      }
      click(buttonNamed(el, "End session"))
      await waitFor(() => buttonNamed(el, "Done"), {message: "the ended strip"})
      click(buttonNamed(el, "Done"))

      expect(learnedness(store.item(`${piece.id}:both:1-1`))).toEqual(3)
      // Done's shade reset (and any engine-source reload a re-render along
      // the way triggers) settles asynchronously; wait for the score to be
      // showing again rather than assert on a frame still mid-redraw
      await waitFor(() => el.querySelector('button[aria-label^="Bar "]'), {message: "the score to redraw"})
      let label = [...el.querySelectorAll(`.${viewStyles.label}`)].find(e => e.textContent == "Learned")
      expect(label).toBeTruthy()

      // "Learned N /16" is one of the programme figures, not shown in free
      // practice: switch to see it counted there
      click(buttonNamed(el, "Today's programme"))
      expect(statValue(el, "Learned")).toEqual("1 /16")
    })

    // real time (three real SELF_GRADE_DWELL_MS + SELF_GRADE_FLASH_MS waits,
    // 500ms each): past the default 5s test timeout, so it gets its own
    it("acoustic: the Tempo group shows the acoustic note; grading Clean three times learns the bar", async function() {
      let {container: el, piece} = await renderFixture({startMeasure: 1, endMeasure: 1})
      flushSync(() => root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240, acoustic: true}))))
      flushSync(() => {})

      expect(el.textContent).toContain("Acoustic piano: each card waits for your grade.")

      click(buttonNamed(el, "Begin"))
      let clean = () => [...el.querySelectorAll("button")].find(b => b.textContent.includes("Clean"))
      // real time, not a fake clock: SelfGradeRow reads Date.now() against
      // its own mount time (shownAt) for the dwell, and ScoreView needs a
      // real engine draw (renderFixture's own wait polls with a real
      // setTimeout, which a fake clock installed from the start never fires)
      let wait = ms => new Promise(resolve => setTimeout(resolve, ms))

      for (let i = 0; i < 3; i++) {
        await wait(SELF_GRADE_DWELL_MS)
        click(clean())
        await wait(SELF_GRADE_FLASH_MS)
        await page.state.notes.generator.finishing
        await page.state.notes.generator.studying
      }

      click(buttonNamed(el, "End session"))
      await waitFor(() => buttonNamed(el, "Done"), {message: "the ended strip"})
      expect(el.textContent).toMatch(/\d+ of \d+ passes clean/)
      click(buttonNamed(el, "Done"))

      expect(learnedness(store.item(`${piece.id}:both:1-1`))).toEqual(3)
      // a re-render along the way can briefly reload the engraving; wait
      // for the score to be showing again
      await waitFor(() => el.querySelector('button[aria-label^="Bar "]'), {message: "the score to redraw"})
      expect(el.textContent).toContain("Learned")
    }, 15000)

    it("has no horizontal overflow at 390px wide", async function() {
      let {container: el} = await renderFixture()
      el.style.width = "390px"
      flushSync(() => {})

      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1)
    })
  })

  // Pasted song notation, the piece select's first option (open question
  // 4d): no engraved score, free practice only, but otherwise drills like
  // any imported piece
  describe("pasted song notation", function() {
    let buttonNamed = (el, text) =>
      [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)
    let click = button => flushSync(() => button.click())

    it("picking it shows the notation box, and typing a song replaces the import message and title", async function() {
      let el = renderScorePage()
      let pane = el.querySelector("aside")
      let select = pane.querySelector("select")

      expect(el.textContent).toContain("Import a MusicXML file in Tonight's session to see its score here.")

      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "")
      flushSync(() => select.dispatchEvent(new Event("change", {bubbles: true})))

      let textarea = pane.querySelector('textarea[aria-label="song notation"]')
      expect(textarea).toBeTruthy()
      expect(el.querySelector("h1").textContent).toContain("import a piece to begin")

      let setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
      setValue.call(textarea, "c4 d4 e4 f4")
      flushSync(() => textarea.dispatchEvent(new Event("input", {bubbles: true})))

      expect(el.querySelector("h1").textContent).toEqual("Pasted song notation")
      expect(el.textContent).toContain(
        "Pasted notation has no engraved score; it is drawn on the trainer's staff once you begin.")
      // free practice only: no programme toggle, no "Due/New/Learned" figures
      expect(el.textContent).not.toContain("Today's programme")
      expect(el.textContent).not.toContain("Learned")

      expect(buttonNamed(el, "Begin").disabled).toBe(false)
      click(buttonNamed(el, "Begin"))
      expect(el.querySelector("[data-score-card]")).toBe(null)
      expect(page.state.notes.currentColumn()).toEqual(["C4"])
    })
  })

  // the score-first grid fallback (SCORE_VIEW_NO_SOURCE/FAILED): a piece
  // without a stored source, or an engraving failure, falls back to a bar
  // grid rather than the paginated engraving, at rest same as in session
  // (st/components/pages/sight_reading_page, AGENTS.md)
  describe("fallback states", function() {
    it("shows a grid of bars with no stored source", async function() {
      let xml = workhorseScore()
      let song = parseMusicXML(xml)
      let piece = await store.putPiece({id: "old", title: "Workhorse", importedAt: 1000, song: songToJSON(song)})
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
      }))

      let el = renderScorePage()
      await waitFor(() => page.state.engineSource?.status == "missing", {message: "the missing source"})

      expect(el.textContent).toContain(SCORE_VIEW_NO_SOURCE)
      expect(el.querySelectorAll('[aria-label^="Bar "]').length).toBeGreaterThan(0)
      // the shade group still works over the grid
      let shadePill = [...el.querySelectorAll("button")].find(b => b.textContent.trim() == "Score difficulty")
      expect(shadePill).toBeTruthy()
    })

    it("shows a grid of bars when the engine can't draw the piece", async function() {
      await drillPiece(workhorseScore())
      let el = renderScorePage({loadEngines: () => Promise.reject(new Error("offline"))})
      await waitFor(() => el.textContent.includes(SCORE_VIEW_FAILED), {message: "the failed-engine note"})

      expect(el.querySelectorAll('[aria-label^="Bar "]').length).toBeGreaterThan(0)
    })
  })
})

// PassagePane (score-first design, moved from the old "piece at a glance"
// rail plate): a flagged passage's detail and the flagged list, in a right
// SidePane. Mounted directly here (not through ScoreView), since its own
// rendering and selection logic don't need a drawn score.
describe("PassagePane", function() {
  let container, root, store, previousStore

  beforeEach(async function() {
    store = await openTestStore()
    previousStore = setAppStore(store)
  })

  afterEach(function() {
    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previousStore)
    store.close()
  })

  let drillPiece = async (xml, settings={}) => {
    let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice", ...settings,
    }))
    return piece
  }

  let mountPane = (flags, {settings, onBegin=jasmine.createSpy("onBegin"), onEdit=jasmine.createSpy("onEdit")}={}) => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    let setSettings = jasmine.createSpy("setSettings")
    flushSync(() => root.render(React.createElement(PassagePane, {
      flags, settings, setSettings, onBegin, onEdit, open: true, close: () => {},
    })))
    return {container, setSettings, onBegin, onEdit}
  }

  let pane = () => container.querySelector('aside[aria-label="Passage"]')
  let clickButton = (el, label) => {
    let button = [...el.querySelectorAll("button")].find(b => b.textContent.trim() == label)
    flushSync(() => button.dispatchEvent(new MouseEvent("click", {bubbles: true})))
  }

  // a flagged-list row, found by the bars it names (its button's own text
  // is the roman numeral, the title and the bars run together with no
  // separator, see PassagePane#renderList)
  let clickRow = (el, flag) => {
    let bars = flag.start == flag.end ? `Bar ${flag.start}` : `Bars ${flag.start}–${flag.end}`
    let button = [...el.querySelectorAll("li button")].find(b => b.textContent.includes(bars))
    flushSync(() => button.dispatchEvent(new MouseEvent("click", {bubbles: true})))
  }

  it("renders nothing without a flagged passage", function() {
    mountPane([], {settings: {piece: "", hand: BOTH_HANDS}})
    expect(container.querySelector("aside")).toBe(null)
  })

  it("shows the selected passage's detail and the flagged list", async function() {
    let piece = await drillPiece(workhorseScore())
    let flags = flagsInForce(store.annotation(piece.id))
    expect(flags.length).toEqual(1)

    let settings = {piece: piece.id, hand: BOTH_HANDS}
    mountPane(flags, {settings})

    expect(pane().querySelector("h3").textContent).toEqual("Bars 9–11")
    expect(pane().textContent).toContain(flags[0].title)
    expect(pane().textContent).toContain("How to practise it")
    expect(pane().textContent).toContain(flags[0].tip)
    expect(pane().textContent).toContain("Flagged passages")
    expect(pane().textContent).toContain("Bars 9–11")
  })

  it("selecting a list row updates the detail", async function() {
    let xml = workhorseScore({barCount: 24, denseAt: [5, 6, 7], alsoDenseAt: [17, 18, 19]})
    let piece = await drillPiece(xml)
    let flags = flagsInForce(store.annotation(piece.id))
    expect(flags.length).toEqual(2)

    mountPane(flags, {settings: {piece: piece.id, hand: BOTH_HANDS}})
    let shown = () => pane().querySelector("h3").textContent

    let other = flags.find(f => `Bars ${f.start}–${f.end}` != shown())
    expect(other).toBeTruthy()
    clickRow(pane(), other)
    expect(shown()).toEqual(`Bars ${other.start}–${other.end}`)
  })

  it("Practise bars N–M applies the passage's section and begins", async function() {
    let piece = await drillPiece(workhorseScore())
    let flags = flagsInForce(store.annotation(piece.id))
    let settings = {piece: piece.id, hand: BOTH_HANDS, startMeasure: 1, endMeasure: 1}

    let {setSettings, onBegin} = mountPane(flags, {settings})
    clickButton(pane(), "Practise bars 9–11")

    expect(setSettings).toHaveBeenCalledWith(jasmine.objectContaining({
      practice: FREE_PRACTICE, startMeasure: 9, endMeasure: 11, measuresPerCard: WHOLE_SECTION,
    }))
    expect(onBegin).toHaveBeenCalled()
  })

  it("the hand pill practises the passage hands separately and begins", async function() {
    let piece = await drillPiece(workhorseScore())
    let flags = flagsInForce(store.annotation(piece.id))
    let settings = {piece: piece.id, hand: BOTH_HANDS, startMeasure: 1, endMeasure: 1}

    let {setSettings, onBegin} = mountPane(flags, {settings})
    expect(flags[0].hand).toEqual("both")
    clickButton(pane(), "Hands separately")

    expect(setSettings).toHaveBeenCalledWith(jasmine.objectContaining({
      startMeasure: 9, endMeasure: 11, hand: jasmine.stringMatching(/right hand/),
    }))
    expect(onBegin).toHaveBeenCalled()
  })

  it("names a one-bar passage in the singular", async function() {
    let piece = await drillPiece(workhorseScore())
    let record = store.annotation(piece.id)
    let [hardest, ...rest] = record.proposals
    await store.putAnnotation({
      ...record,
      proposals: [
        {...hardest, start: 12, end: 12, startIndex: 11, endIndex: 11, level: 3, strength: 99},
        ...rest,
      ],
    })

    let flags = flagsInForce(store.annotation(piece.id))
    mountPane(flags, {settings: {piece: piece.id, hand: BOTH_HANDS}})

    expect(pane().querySelector("h3").textContent).toEqual("Bar 12")
    expect(pane().textContent).toContain("Practise bar 12")
    expect(pane().textContent).not.toContain("Bars 12–12")
  })

  it("Edit calls onEdit with the selected flag's id", async function() {
    let piece = await drillPiece(workhorseScore())
    let flags = flagsInForce(store.annotation(piece.id))

    let {onEdit} = mountPane(flags, {settings: {piece: piece.id, hand: BOTH_HANDS}})
    clickButton(pane(), "Edit")

    expect(onEdit).toHaveBeenCalledWith(flags[0].id)
  })

  it("shows a moved flag's note", async function() {
    let piece = await drillPiece(workhorseScore())
    let moved = {
      flagId: "teacher:moved", action: "add", at: 1, by: "Mme Dupont", source: "teacher",
      anchor: {bars: []},
      flag: {
        start: 2, end: 4, startIndex: 1, endIndex: 3, hand: "both", level: 2, kinds: [],
        title: "Moved passage", reason: "", tip: "", apart: false,
      },
      moved: {start: 3, end: 5, by: "Mme Dupont"},
    }
    await store.updateAnnotation(piece.id, current => withDecisions(current, [moved]))
    let flags = flagsInForce(store.annotation(piece.id))
    let movedFlag = flags.find(f => f.id == "teacher:moved")
    expect(movedFlag).toBeTruthy()

    mountPane(flags, {settings: {piece: piece.id, hand: BOTH_HANDS, startMeasure: 2, endMeasure: 4}})
    clickRow(pane(), movedFlag)

    expect(pane().textContent).toContain("Moved from bars 3–5 in Mme Dupont’s copy")
  })
})

// ReviewPane (score-first design): the instructor's review of a piece's
// flagged passages, opened from a difficulty-shade tag or the rail's own
// trouble spots. Its logic is unchanged from before the score-first
// redesign (only its host changed, from the old passages plate to
// ScoreView), so it is mounted directly here.
describe("ReviewPane", function() {
  let container, root, store, previousStore

  beforeEach(async function() {
    store = await openTestStore()
    previousStore = setAppStore(store)
  })

  afterEach(function() {
    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previousStore)
    store.close()
  })

  let drillPiece = async (xml, settings={}) => {
    let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice", ...settings,
    }))
    return piece
  }

  // re-renders with the merged settings, the same way the real page's state
  // update does
  let mountReview = (piece, extra={}) => {
    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)

    let renderWith = settings => flushSync(() => root.render(React.createElement(ReviewPane, {
      settings, setSettings: next => renderWith({...settings, ...next}),
      store, open: true, close: () => {}, ...extra,
    })))
    renderWith({piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice"})
    flushSync(() => {})
    return container
  }

  let reviewPane = () => container.querySelector('aside[aria-label="Review the passages"]')

  let clickButton = (el, label) => {
    let button = [...el.querySelectorAll("button")].find(b => b.textContent.trim() == label)
    flushSync(() => button.dispatchEvent(new MouseEvent("click", {bubbles: true})))
  }

  let changeValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value)
    flushSync(() => input.dispatchEvent(new Event("input", {bubbles: true})))
  }

  it("titles the pane 'Review the passages' and closes with Escape or the close button", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    expect(reviewPane().getAttribute("aria-hidden")).not.toEqual("true")
    expect(reviewPane().querySelector('[aria-label="Close the review"]')).toBeTruthy()
  })

  it("accept, dismiss and restore update the tally", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    expect(reviewPane().textContent).toContain("Waiting for you")

    clickButton(reviewPane(), "Accept")
    await waitFor(() => reviewPane().textContent.includes("❖ Accepted"), {message: "accepted status"})
    let tally = () => reviewPane().querySelector(`.${reviewStyles.tally}`).textContent
    expect(tally()).toContain("Accepted")

    clickButton(reviewPane(), "Dismiss")
    await waitFor(() => reviewPane().textContent.includes("Restore"), {message: "dismissed"})
    expect(flagsInForce(store.annotation(piece.id)).length).toEqual(0)

    clickButton(reviewPane(), "Restore")
    await waitFor(() => flagsInForce(store.annotation(piece.id)).length == 1, {message: "restored"})
  })

  it("renames a passage; Use that name restores the analysis's name", async function() {
    let piece = await drillPiece(workhorseScore())
    let originalTitle = flagsInForce(store.annotation(piece.id))[0].title
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    clickButton(reviewPane(), "Edit")
    let nameInput = await waitFor(() => reviewPane().querySelector('input[type="text"]'), {message: "the name field"})
    changeValue(nameInput, "My name for it")
    clickButton(reviewPane(), "Save")

    await waitFor(() => flagsInForce(store.annotation(piece.id))[0].title == "My name for it",
      {message: "renamed"})
    expect(reviewPane().textContent).toContain("the analysis called it")

    clickButton(reviewPane(), "Edit")
    clickButton(reviewPane(), "Use that name")
    clickButton(reviewPane(), "Save")

    await waitFor(() => flagsInForce(store.annotation(piece.id))[0].title == originalTitle,
      {message: "reverted to the analysis's name"})
  })

  it("marks a passage from a strip drag, and Save adds a flag with a Teacher chip", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    clickButton(reviewPane(), "Add a passage")

    let cells = () => [...reviewPane().querySelectorAll(`.${barStripStyles.cell}`)]
    let from = cells()[0]
    let to = cells()[3]
    let middle = cell => {
      let rect = cell.getBoundingClientRect()
      return rect.left + rect.width / 2
    }

    // a real drag captures the pointer on the cell it started in, so the
    // browser retargets every move and up to that cell: the strip must read
    // the cell under the pointer from the coordinates, not from the handler
    let drag = (type, clientX) => flushSync(() => from.dispatchEvent(
      new PointerEvent(type, {bubbles: true, pointerId: 1, clientX})))

    drag("pointerdown", middle(from))
    drag("pointermove", middle(to))
    drag("pointerup", middle(to))

    clickButton(reviewPane(), "Save")

    let added = await waitFor(() =>
      flagsInForce(store.annotation(piece.id)).find(flag => flag.sources.includes("teacher")),
      {message: "the teacher's added flag"})
    // the bars the drag drew, not the single bar the editor opened on
    expect([added.start, added.end]).toEqual([1, 4])
    await waitFor(() => reviewPane().textContent.includes("Teacher"), {message: "the Teacher chip"})
  })

  it("ticking 'Start this passage hands separately' saves apart; the preview line shows", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    clickButton(reviewPane(), "Edit")
    let checkbox = await waitFor(() => reviewPane().querySelector('input[type="checkbox"]'),
      {message: "the hands-separately checkbox"})
    flushSync(() => checkbox.dispatchEvent(new MouseEvent("click", {bubbles: true})))

    expect(reviewPane().textContent).toContain("Starts hands separately in today's programme")

    clickButton(reviewPane(), "Save")
    await waitFor(() => flagsInForce(store.annotation(piece.id)).some(flag => flag.apart),
      {message: "the saved apart flag"})
  })

  it("exports a flags file as a download, carrying the decisions and the name typed in", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    clickButton(reviewPane(), "Accept")
    await waitFor(() => reviewPane().textContent.includes("❖ Accepted"), {message: "accepted"})

    let nameInput = [...reviewPane().querySelectorAll('input[type="text"]')]
      .find(input => input.closest(`.${reviewStyles.send_plate}`))
    changeValue(nameInput, "Ms Laurent")

    let created = []
    let originalCreate = URL.createObjectURL
    spyOn(URL, "createObjectURL").and.callFake(blob => { created.push(blob); return originalCreate(blob) })
    spyOn(URL, "revokeObjectURL")
    let clicked = null
    spyOn(HTMLAnchorElement.prototype, "click").and.callFake(function() { clicked = this })

    clickButton(reviewPane(), "Export flags file")
    await waitFor(() => created.length > 0, {message: "the download"})

    expect(clicked.download).toContain(".flags.json")
    let text = await created[0].text()
    let data = JSON.parse(text)
    expect(data.format).toEqual("sightreading-flags")
    expect(data.by).toEqual("Ms Laurent")
    expect(data.decisions.length).toBeGreaterThan(0)
  })

  // a bar practised badly enough for st/difficulty/trouble to read it as
  // trouble: three agains and two lapses
  let recordTroubleBar = async (piece, measure = 1) => {
    let now = Date.now()
    let barId = `${piece.id}:both:${measure}-${measure}`
    await store.recordAttempt({
      item: {
        id: barId, pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure,
        level: "bar", state: "learning", step: 0, due: now, last: now, s: 1, d: 5,
        reps: 3, lapses: 2, streak: 0, lastGrade: 1, hits: 1, misses: 3, attempts: 3,
        lastPracticed: now, elapsedMs: 3000, algo: 1, createdAt: now - 1000,
        recent: [0, 1, 2].map(n => [now - n * 1000, 3, 0, 1]),
      },
      review: {
        itemId: barId, pieceId: piece.id, at: now, kind: "attempt", grade: 1, was: "learning",
        columns: 3, clean: 0, misses: 3, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 1,
      },
    })
  }

  it("flags a trouble spot the player struggled with", async function() {
    let piece = await drillPiece(workhorseScore())
    await recordTroubleBar(piece)

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})
    expect(reviewPane().textContent).toContain("Your trouble spots")

    clickButton(reviewPane(), "Flag these bars")
    await waitFor(() => flagsInForce(store.annotation(piece.id)).some(flag => flag.sources.includes("player")),
      {message: "the promoted trouble spot"})
    expect(reviewPane().textContent).toContain("Waiting for you")
  })

  it("a queue card shows the player's own evidence for a bar the teacher has already flagged", async function() {
    let piece = await drillPiece(workhorseScore())
    let flag = flagsInForce(store.annotation(piece.id))[0]
    await recordTroubleBar(piece, flag.start)

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    // the suggestions leave the bar out, since it is flagged already
    expect(reviewPane().textContent).not.toContain("Your trouble spots")

    let line = await waitFor(() => reviewPane().querySelector(`.${reviewStyles.trouble_line}`),
      {message: "the evidence line"})
    expect(line.textContent).toContain("From your playing:")
    expect(line.textContent).toContain("slipped back 2 times")
  })

  it("the editor places an unplaced flag at the bars it shows, not the exporting copy's", async function() {
    let piece = await drillPiece(workhorseScore())

    // a teacher's flag the import couldn't place: its bars are their copy's,
    // well past this 16-bar one
    let far = {
      flagId: "teacher:far", action: "add", at: 1, by: "Ms Laurent", source: "teacher",
      anchor: {bars: []},
      flag: {
        start: 40, end: 42, startIndex: 39, endIndex: 41, hand: "both", level: 2, kinds: [],
        title: "Far passage", reason: "", tip: "", apart: false,
      },
      unplaced: {start: 40, end: 42},
    }
    await store.updateAnnotation(piece.id, current => withDecisions(current, [far]))

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})
    expect(reviewPane().textContent).toContain("Couldn't find these bars in your copy")

    clickButton(reviewPane(), "Place it")
    let startBar = await waitFor(() => reviewPane().querySelector('input[aria-label="start bar"]'),
      {message: "the editor"})
    let endBar = reviewPane().querySelector('input[aria-label="end bar"]')

    // the editor shows bars this copy has...
    expect([startBar.value, endBar.value]).toEqual(["16", "16"])

    clickButton(reviewPane(), "Save")

    // ...and Save writes exactly those
    let placed = await waitFor(() =>
      flagsInForce(store.annotation(piece.id)).find(f => f.id == "teacher:far"),
      {message: "the placed flag"})
    expect([placed.start, placed.end]).toEqual([16, 16])
  })

  it("names the bars a re-anchored flag moved from once", async function() {
    let piece = await drillPiece(workhorseScore())

    // a teacher's flag the import re-anchored: bars 3–5 of their copy are
    // bars 2–4 of this one
    let moved = {
      flagId: "teacher:moved", action: "add", at: 1, by: "Mme Dupont", source: "teacher",
      anchor: {bars: []},
      flag: {
        start: 2, end: 4, startIndex: 1, endIndex: 3, hand: "both", level: 2, kinds: [],
        title: "Moved passage", reason: "", tip: "", apart: false,
      },
      moved: {start: 3, end: 5, by: "Mme Dupont"},
    }
    await store.updateAnnotation(piece.id, current => withDecisions(current, [moved]))

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})
    expect(reviewPane().textContent).toContain("Moved from bars 3–5 in Mme Dupont’s copy")
  })

  it("the review's own writes analyse the piece first, so a decision isn't lost", async function() {
    // a piece in the deck whose analysis hasn't landed: the review's
    // trouble-spot write has to ensure it
    let xml = workhorseScore()
    let piece = await store.putPiece({
      id: "unanalysed", title: "Workhorse", song: songToJSON(parseMusicXML(xml)), importedAt: Date.now(),
    }, {source: xml})
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
    }))
    await recordTroubleBar(piece)
    expect(store.annotation(piece.id)).toBe(null)

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})
    clickButton(reviewPane(), "Flag these bars")
    expect(store.annotation(piece.id)).toBe(null)

    let promoted = await waitFor(() =>
      flagsInForce(store.annotation(piece.id)).find(f => f.sources.includes("player")),
      {message: "the promoted trouble spot"})
    expect(promoted.status).toEqual("waiting")
  })

  // at the test harness's default (narrower than 900px) viewport, the
  // pane's own width stays under the side-by-side breakpoint, so this also
  // exercises the stacked layout without overflowing it
  it("has no horizontal overflow in the review pane, stacked below 900px of its own width", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})
    await waitFor(() => reviewPane().querySelector(`.${reviewStyles.columns}`), {message: "the columns"})

    expect(reviewPane().querySelector(`.${reviewStyles.columns}`).className).not.toContain(reviewStyles.side_by_side)

    let overflowing = el => [...el.querySelectorAll('[class*="plate"]')]
      .filter(plateEl => plateEl.scrollWidth > plateEl.clientWidth + 1)
    expect(overflowing(reviewPane())).toEqual([])
  })
})
