import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {PassagePane} from "st/components/sight_reading/passage_pane"
import {ReviewPane} from "st/components/sight_reading/review_pane"
import {importMusicXMLPiece, importFlagsFile, exportFlagsFile, songToJSON, decideFlags} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {setAppStore} from "st/storage"
import {loadScoreEngines} from "st/score_render/load"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, RIGHT_HAND, FREE_PRACTICE, PROGRAMME_PRACTICE, WHOLE_SECTION} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {SCORE_VIEW_NO_SOURCE, SCORE_VIEW_FAILED} from "st/components/sight_reading/score_view"
import viewStyles from "st/components/sight_reading/score_view.module.css"
import setupStyles from "st/components/sight_reading/setup_pane.module.css"
import {SELF_GRADE_DWELL_MS, SELF_GRADE_FLASH_MS} from "st/srs/self_grade"
import {learnedness} from "st/bar_progress"
import reviewStyles from "st/components/sight_reading/review_pane.module.css"
import barStripStyles from "st/components/bar_strip.module.css"
import sheetStyles from "st/components/score_sheet.module.css"

import {flagsInForce} from "st/difficulty/records"
import {withDecisions, dismissDecision, reviewFlags, acceptDecision} from "st/difficulty/decisions"

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

    let renderFixture = async (settings={}, xml=null) => {
      let musicXML = xml || await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
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

    // an even stepwise piece (every bar a different walk by step) whose one
    // fifth is bar `leapAt`'s upper hand; `leap` is that bar's notes
    let stepwiseScore = leap => {
      let scale = ["C", "D", "E", "F", "G", "A", "B"]
      let walks = [[0, 1, 2, 1], [2, 1, 0, 1], [0, 1, 0, 1], [3, 2, 1, 2], [1, 2, 3, 2]]
      let bar = (i, octave) => walks[i % 5].map(step => ({name: `${scale[((i % 4) + step) % 7]}${octave}`}))
      let bars = Array.from({length: 16}, (_, i) => ({upper: bar(i, 4), lower: bar(i + 2, 3)}))
      bars[8] = {upper: leap.map(name => ({name})), lower: bar(10, 3)}
      return pianoScore({title: "Stepwise", bars})
    }

    // The setup pane's groups (Piece, Session, Tonight's study, Cards,
    // Tempo): each a full-width toggle that opens and closes its body, the
    // closed ones kept on this device and summarised on the toggle
    describe("the setup groups", function() {
      let pane = el => el.querySelector(`.${viewStyles.setup_column}`)
      let toggles = el => [...pane(el).querySelectorAll("button[aria-expanded]")]
      let nameOf = toggle => toggle.children[0].textContent
      let names = el => toggles(el).map(nameOf)
      let toggleNamed = (el, name) => toggles(el).find(toggle => nameOf(toggle) == name)
      let isOpen = (el, name) => toggleNamed(el, name).getAttribute("aria-expanded") == "true"
      let summaryOf = (el, name) => toggleNamed(el, name).children[1].textContent
      let closedNames = el => toggles(el).filter(toggle => toggle.getAttribute("aria-expanded") == "false").map(nameOf)
      let setClosed = (el, name, closed) => {
        if (isOpen(el, name) == closed) { click(toggleNamed(el, name)) }
      }
      let storedClosed = () => JSON.parse(window.localStorage.getItem(SCORE_DRILL_STORAGE_KEY) || "{}").closedGroups
      let storeDrill = update => window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY,
        JSON.stringify({...JSON.parse(window.localStorage.getItem(SCORE_DRILL_STORAGE_KEY) || "{}"), ...update}))

      // one control of each group's body, found by what it is
      let controls = {
        Piece: el => pane(el).querySelector("select"),
        Session: el => buttonNamed(pane(el), "Free practice"),
        "Tonight's study": el => buttonNamed(pane(el), "Skip it"),
        Cards: el => buttonNamed(pane(el), "Right hand"),
        Tempo: el => pane(el).querySelector('input[aria-label="Speed"]'),
      }
      let ALL = Object.keys(controls)
      let bodyIn = (el, name) => !!controls[name](el)

      let mountAgain = async (props={}) => {
        flushSync(() => root.unmount())
        container.remove()
        container = document.createElement("div")
        container.style.width = "1440px"
        document.body.appendChild(container)
        root = createRoot(container)
        flushSync(() => {
          root.render(React.createElement(MemoryRouter, {},
            React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240, ...props})))
        })
        flushSync(() => {})
        await waitFor(() => container.querySelectorAll('button[aria-label^="Bar "]').length > 0,
          {message: "the score to draw"})
        return container
      }

      let setSelect = (select, value) => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value)
        flushSync(() => select.dispatchEvent(new Event("change", {bubbles: true})))
      }

      // the programme's own Begin line, the one under the groups
      let beginLine = el => pane(el).querySelector("p").textContent

      let QUIET_PIECE = () => pianoScore({title: "Quiet", bars: Array.from({length: 8}, () =>
        ({upper: QUIET.upper.map(name => ({name})), lower: QUIET.lower.map(name => ({name}))}))})

      it("offers a toggle for each group, all open, with the controls of every one", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})

        expect(names(el)).toEqual(["Piece", "Session", "Tonight's study", "Cards", "Tempo"])
        for (let toggle of toggles(el)) {
          expect(toggle.tagName).toEqual("BUTTON")
          expect(toggle.getAttribute("type")).toEqual("button")
          expect(toggle.getAttribute("aria-expanded")).withContext(nameOf(toggle)).toEqual("true")
        }
        for (let name of ALL) { expect(bodyIn(el, name)).withContext(name).toBe(true) }
        expect(closedNames(el)).toEqual([])
      })

      it("closes Piece alone: its body goes, the toggle reads the piece, the others stay open", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})

        click(toggleNamed(el, "Piece"))
        expect(isOpen(el, "Piece")).toBe(false)
        expect(controls.Piece(el)).toBe(null)
        expect(toggleNamed(el, "Piece").textContent).toContain("Fixture")
        expect(closedNames(el)).toEqual(["Piece"])
        for (let name of ALL.filter(name => name != "Piece")) {
          expect(isOpen(el, name)).withContext(name).toBe(true)
          expect(bodyIn(el, name)).withContext(name).toBe(true)
        }

        click(toggleNamed(el, "Piece"))
        expect(isOpen(el, "Piece")).toBe(true)
        expect(controls.Piece(el)).toBeTruthy()
      })

      it("builds each toggle on the one before when several land in one batch", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})

        flushSync(() => { for (let name of ["Piece", "Cards", "Tempo"]) { toggleNamed(el, name).click() } })
        expect(closedNames(el)).toEqual(["Piece", "Cards", "Tempo"])
        expect(storedClosed()).toEqual(["piece", "cards", "tempo"])
      })

      it("closes each group alone, then all five, then reopens them", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})

        for (let name of ALL) {
          click(toggleNamed(el, name))
          expect(closedNames(el)).withContext(`${name} alone`).toEqual([name])
          for (let other of ALL) { expect(bodyIn(el, other)).withContext(`${name}: ${other}`).toBe(other != name) }
          click(toggleNamed(el, name))
          expect(closedNames(el)).withContext(`${name} reopened`).toEqual([])
        }

        for (let name of ALL) { click(toggleNamed(el, name)) }
        expect(closedNames(el)).toEqual(ALL)
        for (let name of ALL) { expect(bodyIn(el, name)).withContext(name).toBe(false) }
        // only the toggles and the footer are left of the pane
        expect(buttonNamed(pane(el), "Begin")).toBeTruthy()

        for (let name of ALL) { click(toggleNamed(el, name)) }
        expect(closedNames(el)).toEqual([])
        for (let name of ALL) { expect(bodyIn(el, name)).withContext(name).toBe(true) }
      })

      it("summarises the Session group, in the programme and in free practice", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE, introduce: "read first"})
        let closed = () => { setClosed(el, "Session", true); return summaryOf(el, "Session") }
        let opened = () => setClosed(el, "Session", false)

        expect(closed()).toEqual("Today's programme · read through · 20 min")
        opened()
        click(buttonNamed(el, "30 min"))
        // the length is stored, then the pane draws it
        await waitFor(() => store.practiceSettings().sessionMinutes == 30, {message: "the length to be stored"})
        await new Promise(resolve => setTimeout(resolve, 0))
        click(buttonNamed(el, "Hardest first"))
        expect(closed()).toEqual("Today's programme · hardest first · 30 min")
        opened()
        click(buttonNamed(el, "Free practice"))
        // the section the page opened with: the whole piece
        expect(closed()).toEqual("Free practice · bars 1–16")
      })

      it("summarises Session for a free section of several bars and one bar, and of a piece with no flagged passage", async function() {
        let {container: el} = await renderFixture({startMeasure: 5, endMeasure: 9})
        setClosed(el, "Session", true)
        expect(summaryOf(el, "Session")).toEqual("Free practice · bars 5–9")

        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          ...JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)), startMeasure: 5, endMeasure: 5,
        }))
        el = await mountAgain()
        setClosed(el, "Session", true)
        expect(summaryOf(el, "Session")).toEqual("Free practice · bar 5")

        // a piece with no flagged passage has no order to name
        let quiet = await importMusicXMLPiece("quiet.musicxml", QUIET_PIECE(), store)
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: quiet.piece.id, hand: BOTH_HANDS, measuresPerCard: WHOLE_SECTION, practice: PROGRAMME_PRACTICE,
        }))
        window.localStorage.removeItem(SCORE_DRILL_STORAGE_KEY)
        el = await mountAgain()
        setClosed(el, "Session", true)
        expect(summaryOf(el, "Session")).toEqual("Today's programme · 20 min")
      })

      it("summarises Tonight's study: the read-through, the passage and its stage, and a learned piece", async function() {
        let {container: el, piece} = await renderFixture({practice: PROGRAMME_PRACTICE, introduce: "read first"})
        setClosed(el, "Tonight's study", true)
        expect(summaryOf(el, "Tonight's study")).toEqual("Read-through first · 16 bars left")

        setClosed(el, "Tonight's study", false)
        click(buttonNamed(el, "Skip it"))
        await page.state.notes.generator.studying
        flushSync(() => {})
        setClosed(el, "Tonight's study", true)
        let skipped = summaryOf(el, "Tonight's study")
        expect(skipped).toEqual("Bars 5–7 · next")

        await store.putStudy({
          pieceId: piece.id, status: "maintaining", startedAt: 1,
          plan: {
            createdAt: 1, known: [], learnedAt: 4,
            passages: [[1, 4], [5, 8], [9, 12], [13, 16]].map(([start, end]) =>
              ({start, end, from: "score", openedAt: 1, stage: 4, stageAt: 2, flowedAt: 3})),
          },
        })
        el = await mountAgain()
        expect(isOpen(el, "Tonight's study")).toBe(false)
        expect(summaryOf(el, "Tonight's study")).toEqual("Learned ❖")
      })

      it("summarises Tonight's study at a passage in progress as its heading and I of IV", async function() {
        let {container: el, piece} = await renderFixture({practice: PROGRAMME_PRACTICE})
        await store.putStudy({
          pieceId: piece.id, status: "learning", startedAt: 1, readThrough: "skipped",
          plan: {createdAt: 1, known: [], passages: [{start: 5, end: 7, from: "score", openedAt: 1, stage: 1, stageAt: 1}]},
        })
        el = await mountAgain()

        setClosed(el, "Tonight's study", true)
        let summary = summaryOf(el, "Tonight's study")
        expect(summary).toEqual("Bars 5–7 · I of IV")
        expect(summary).not.toContain("next")
      })

      it("summarises Cards with the Begin line's own count of bars a card", async function() {
        let cases = [
          {settings: {practice: PROGRAMME_PRACTICE}, words: "Both hands · 2 bars a card"},
          {settings: {startMeasure: 5, endMeasure: 9}, words: "Both hands · 5 bars a card"},
          {settings: {hand: RIGHT_HAND, measuresPerCard: 1}, words: "Right hand · 1 bar a card"},
        ]

        for (let {settings, words} of cases) {
          window.localStorage.removeItem(SCORE_DRILL_STORAGE_KEY)
          let el
          if (!container) {
            ({container: el} = await renderFixture(settings))
          } else {
            window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
              ...JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)),
              practice: FREE_PRACTICE, startMeasure: 1, endMeasure: 16, hand: BOTH_HANDS, measuresPerCard: WHOLE_SECTION,
              ...settings,
            }))
            el = await mountAgain()
          }

          setClosed(el, "Cards", true)
          expect(summaryOf(el, "Cards")).withContext(words).toEqual(words)
          // the Begin line says the same count of bars a card
          expect(beginLine(el)).withContext(words).toContain(words.split(" · ")[1])
        }
      })

      it("summarises Tempo: waiting, scrolling with keep tempo, and acoustic", async function() {
        let {container: el} = await renderFixture()
        setClosed(el, "Tempo", true)
        expect(summaryOf(el, "Tempo")).toEqual("Wait · speed 100")

        storeDrill({mode: "scroll", speed: 120, tempo: true})
        el = await mountAgain()
        expect(isOpen(el, "Tempo")).toBe(false)
        expect(summaryOf(el, "Tempo")).toEqual("Scroll · speed 120 · keep tempo")

        storeDrill({tempo: false})
        el = await mountAgain()
        expect(summaryOf(el, "Tempo")).toEqual("Scroll · speed 120")

        el = await mountAgain({acoustic: true})
        expect(summaryOf(el, "Tempo")).toEqual("Acoustic · graded by you")
      })

      it("summarises Piece by title, and Pasted notation for a pasted song", async function() {
        let {container: el} = await renderFixture()
        setClosed(el, "Piece", true)
        expect(summaryOf(el, "Piece")).toEqual("Fixture")

        setClosed(el, "Piece", false)
        setSelect(controls.Piece(el), "")
        setClosed(el, "Piece", true)
        expect(summaryOf(el, "Piece")).toEqual("Pasted notation")
      })

      it("keeps a closed group's summary up to date as another group changes", async function() {
        let {container: el} = await renderFixture({startMeasure: 1, endMeasure: 16})
        setClosed(el, "Cards", true)
        expect(summaryOf(el, "Cards")).toEqual("Both hands · 16 bars a card")

        // picking the difficult passage in Session sets the section, which the cards follow
        let passage = [...pane(el).querySelectorAll('[aria-label="Difficult passages"] button')][0]
        click(passage)
        expect(summaryOf(el, "Cards")).toEqual("Both hands · 5 bars a card")
        expect(beginLine(el)).toContain("5 bars a card")

        // and Session's own, when another piece is picked in Piece
        let other = await importMusicXMLPiece("other.musicxml", QUIET_PIECE(), store)
        setClosed(el, "Session", true)
        expect(summaryOf(el, "Session")).toEqual("Free practice · bars 5–9")
        setSelect(controls.Piece(el), other.piece.id)
        expect(el.querySelector("h1").textContent).toContain("Quiet")
        // the new piece opens in its programme, which has no flagged passage to order by
        expect(summaryOf(el, "Session")).toEqual("Today's programme · 20 min")
      })

      it("shows the speed beside the Tempo toggle while open and the summary alone when closed", async function() {
        storeDrill({speed: 140})
        let {container: el} = await renderFixture()
        let tempoValue = () => toggleNamed(el, "Tempo").querySelector(`.${setupStyles.tempo_value}`)

        expect(tempoValue().textContent).toEqual("140")
        expect(summaryOf(el, "Tempo")).toEqual("")

        click(toggleNamed(el, "Tempo"))
        expect(tempoValue()).toBe(null)
        expect(summaryOf(el, "Tempo")).toEqual("Wait · speed 140")

        click(toggleNamed(el, "Tempo"))
        expect(tempoValue().textContent).toEqual("140")
      })

      it("remembers the closed groups across Begin and End session, a remount and another piece", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})
        let other = await importMusicXMLPiece("other.musicxml", QUIET_PIECE(), store)

        click(toggleNamed(el, "Piece"))
        click(toggleNamed(el, "Tempo"))
        expect(storedClosed()).toEqual(["piece", "tempo"])

        click(buttonNamed(el, "Begin"))
        expect(el.querySelector(`.${viewStyles.setup_column}`)).toBe(null)
        click(buttonNamed(el, "End session"))
        await waitFor(() => toggles(container).length, {message: "the setup pane"})
        expect(closedNames(container)).toEqual(["Piece", "Tempo"])

        el = await mountAgain()
        expect(closedNames(el)).toEqual(["Piece", "Tempo"])

        // picking another piece in the open Piece group leaves the others as they were
        click(toggleNamed(el, "Piece"))
        expect(closedNames(el)).toEqual(["Tempo"])
        setSelect(controls.Piece(el), other.piece.id)
        expect(el.querySelector("h1").textContent).toContain("Quiet")
        expect(closedNames(el)).toEqual(["Tempo"])
        click(toggleNamed(el, "Piece"))
        expect(closedNames(el)).toEqual(["Piece", "Tempo"])
        expect(summaryOf(el, "Piece")).toEqual("Quiet")

        // and a page that opens on it
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          ...JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)), piece: other.piece.id,
        }))
        el = await mountAgain()
        expect(el.querySelector("h1").textContent).toContain("Quiet")
        expect(closedNames(el)).toEqual(["Piece", "Tempo"])
        expect(storedClosed()).toEqual(["piece", "tempo"])
      })

      it("keeps the other drill settings the groups share the record with", async function() {
        storeDrill({mode: "scroll", speed: 130})
        let {container: el} = await renderFixture()

        click(toggleNamed(el, "Cards"))
        let stored = JSON.parse(window.localStorage.getItem(SCORE_DRILL_STORAGE_KEY))
        expect(stored).toEqual(jasmine.objectContaining({mode: "scroll", speed: 130, closedGroups: ["cards"]}))
      })

      it("reads a stored list that is not groups as all open", async function() {
        for (let stored of [["x"], "piece", 7, {piece: true}, [null]]) {
          window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({closedGroups: stored}))
          let {container: el} = container ? {container: await mountAgain()} : await renderFixture()
          expect(closedNames(el)).withContext(JSON.stringify(stored)).toEqual([])
        }

        // a stored mix keeps the groups it knows, in the pane's order
        window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({closedGroups: ["tempo", "x", "piece"]}))
        let el = await mountAgain()
        expect(closedNames(el)).toEqual(["Piece", "Tempo"])
      })

      it("offers no Tonight's study group in free practice or with one hand, even with it stored closed", async function() {
        storeDrill({closedGroups: ["study"]})
        let {container: el} = await renderFixture()
        expect(names(el)).toEqual(["Piece", "Session", "Cards", "Tempo"])
        expect(closedNames(el)).toEqual([])

        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          ...JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)),
          practice: PROGRAMME_PRACTICE, hand: RIGHT_HAND,
        }))
        el = await mountAgain()
        expect(names(el)).toEqual(["Piece", "Session", "Cards", "Tempo"])

        // and back to both hands: the stored closed study group is closed
        click(buttonNamed(el, "Both hands"))
        expect(names(el)).toEqual(["Piece", "Session", "Tonight's study", "Cards", "Tempo"])
        expect(closedNames(el)).toEqual(["Tonight's study"])
      })

      it("offers only the Piece group with no piece and no pasted song, and Begin disabled", function() {
        let el = renderScorePage()

        expect(names(el)).toEqual(["Piece"])
        expect(buttonNamed(el, "Begin").disabled).toBe(true)
      })

      it("has no horizontal overflow at 390px wide with every group closed, and cuts a long title short", async function() {
        let title = "Variations on a Theme of Considerable Length for Piano Solos"
        expect(title.length).toEqual(60)
        let long = pianoScore({title, bars: Array.from({length: 4}, () =>
          ({upper: QUIET.upper.map(name => ({name})), lower: QUIET.lower.map(name => ({name}))}))})
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE}, long)
        el.style.width = "390px"
        flushSync(() => {})
        for (let name of names(el)) { setClosed(el, name, true) }
        flushSync(() => {})

        expect(closedNames(el).length).toEqual(names(el).length)
        expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1)
        let summary = toggleNamed(el, "Piece").children[1]
        expect(summary.textContent).toEqual(title)
        expect(summary.scrollWidth).toBeGreaterThan(summary.clientWidth)
        expect(getComputedStyle(summary).textOverflow).toEqual("ellipsis")
      })

      it("lays a closed toggle across the pane, at least 36px tall, a chevron turned on the right", async function() {
        let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})
        let box = toggle => toggle.getBoundingClientRect()
        let group = toggle => toggle.parentElement.getBoundingClientRect()

        for (let state of ["open", "closed"]) {
          for (let toggle of toggles(el)) {
            let chevron = toggle.lastElementChild
            expect(box(toggle).width).withContext(`${nameOf(toggle)} ${state}`).toBeCloseTo(group(toggle).width, 0)
            expect(box(toggle).height).withContext(`${nameOf(toggle)} ${state}`).toBeGreaterThanOrEqual(35.5)
            expect(chevron.getAttribute("aria-hidden")).toEqual("true")
            expect(chevron.classList.contains(setupStyles.chevron_closed)).withContext(nameOf(toggle)).toBe(state == "closed")
            expect(box(chevron).right).withContext(`${nameOf(toggle)} ${state}`).toBeLessThanOrEqual(box(toggle).right + 0.5)
            expect(box(chevron).left).toBeGreaterThan(box(toggle).left + box(toggle).width / 2)
          }
          if (state == "open") { for (let name of names(el)) { setClosed(el, name, true) } }
        }

        // all closed: the pane is a column of toggles and the footer, with Begin inside it
        let begin = buttonNamed(pane(el), "Begin").getBoundingClientRect()
        let plate = pane(el).firstElementChild.getBoundingClientRect()
        expect(begin.bottom).toBeLessThanOrEqual(plate.bottom)
        expect(plate.height).toBeLessThan(700)
      })
    })

    it("titles a weak leap by where it stands in the piece, on the page's passage pane", async function() {
      let {container: el, piece} = await renderFixture({}, stepwiseScore(["C4", "G4", "E4", "D4"]))
      let flags = flagsInForce(store.annotation(piece.id))
      let leap = flags.find(f => f.kinds[0] == "leaps")
      expect(leap).toBeTruthy()
      expect(leap.start).toBeLessThanOrEqual(9)
      expect(leap.end).toBeGreaterThanOrEqual(9)

      click(el.querySelector(`.${sheetStyles.bar_tag}`))
      let pane = el.querySelector('aside[aria-label="Passage"]')
      expect(pane.textContent).toContain("leaps a fifth")
      expect(pane.textContent).toContain("The widest leaps in the right hand")
      expect(pane.textContent).not.toMatch(/\bwide leaps\b/i)
    })

    it("keeps Wide leaps for an octave leap on the same piece", async function() {
      let {container: el} = await renderFixture({}, stepwiseScore(["C4", "C5", "E4", "D4"]))

      click(el.querySelector(`.${sheetStyles.bar_tag}`))
      let pane = el.querySelector('aside[aria-label="Passage"]')
      expect(pane.textContent).toContain("leaps an octave")
      expect(pane.textContent).toContain("Wide leaps in the right hand")
    })

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
      // a page holds two systems at the least, so the piece's last bar, alone on
      // its system, is never on the first
      expect(el.querySelector('button[aria-label="Bar 16"]')).toBeFalsy()

      click(buttonNamed(el, "Next page ›"))
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

    // a stored study plan with the passages given flowed, [start, end] each
    let flowedPlan = (piece, passages) => store.putStudy({
      pieceId: piece.id, status: "learning", startedAt: 1,
      plan: {
        createdAt: 1, known: [],
        passages: passages.map(([start, end]) =>
          ({start, end, from: "score", openedAt: 1, stage: 4, stageAt: 2, flowedAt: 3})),
      },
    })

    // the overlay of a bar on the page shown, paging on until it is found
    let barOverlay = (el, measure) => {
      while (!buttonNamed(el, "‹ Previous page").disabled) { click(buttonNamed(el, "‹ Previous page")) }
      for (;;) {
        let overlay = buttonLabelled(el, `Bar ${measure}`)
        if (overlay || buttonNamed(el, "Next page ›").disabled) { return overlay }
        click(buttonNamed(el, "Next page ›"))
      }
    }

    it("outlines tonight's study in oxblood, with a tag, and the passages that flow in gilt", async function() {
      let {container: el} = await renderFixture({practice: PROGRAMME_PRACTICE})
      // the fixture's flagged passage, bars 5-9, is the hardest: laid out first, in runs of at most four
      expect(el.textContent).toContain("Tonight's study · bars 5–7")

      for (let measure of [5, 6, 7]) {
        let overlay = barOverlay(el, measure)
        expect(overlay.style.borderTopWidth).withContext(`bar ${measure}`).toEqual("4px")
        expect(overlay.style.borderTopColor).withContext(`bar ${measure}`).toEqual("var(--salon-oxblood)")
      }
      for (let measure of [8, 3]) {
        expect(barOverlay(el, measure).style.borderTopWidth).withContext(`bar ${measure}`).toEqual("")
      }
    })

    it("outlines a passage that flows in gilt beside the one in progress, and not under the difficulty shade", async function() {
      let piece = await (async () => {
        let musicXML = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
        return (await importMusicXMLPiece("fixture.musicxml", musicXML, store)).piece
      })()
      await flowedPlan(piece, [[1, 4]])
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, hand: BOTH_HANDS, measuresPerCard: WHOLE_SECTION, practice: PROGRAMME_PRACTICE,
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
      let el = container

      for (let measure of [1, 2, 3, 4]) {
        let overlay = barOverlay(el, measure)
        expect(overlay.style.borderTopColor).withContext(`bar ${measure}`).toEqual("var(--salon-gilt)")
      }
      click(buttonNamed(el, "Score difficulty"))
      expect(barOverlay(el, 2).style.borderTopWidth).toEqual("")
      expect(el.textContent).not.toContain("Tonight's study · bars")
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

    it("leaves a waiting Claude proposal out of the bar pop-up until a person accepts it", async function() {
      let {container: el, piece} = await renderFixture()
      let proposal = {
        id: "claude:2-3:0badf00d", source: "claude", start: 2, end: 3, startIndex: 1, endIndex: 2,
        hand: "both", level: 2, kinds: ["reading"], title: "Claude's pick", reason: "A crossing.",
        reasons: ["A crossing."], tip: "Slowly.",
      }
      await store.updateAnnotation(piece.id, record => ({...record, proposals: [...record.proposals, proposal]}))
      flushSync(() => page.forceUpdate())

      click(buttonLabelled(el, "Bar 2"))
      expect(dialog(el).textContent).not.toContain("Passage")
      click(buttonLabelled(dialog(el), "Close bar stats"))

      let flag = reviewFlags(store.annotation(piece.id)).find(f => f.id == proposal.id)
      await store.updateAnnotation(piece.id, record =>
        withDecisions(record, [acceptDecision({record, flag, at: 5})]))
      flushSync(() => page.forceUpdate())

      click(buttonLabelled(el, "Bar 2"))
      expect(dialog(el).textContent).toContain("Passage")
      expect(dialog(el).textContent).toContain("Hard")
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

    // The score scale (st/score_render/score_pages SCORE_SCALE): the score is
    // engraved again at a width of 100 / scale times the column's, so bars to
    // a system and page, the page count and every overlay follow it. The
    // puppeteer window paginates against 600 px (SightReadingPage never
    // hands ScoreView a viewportHeight), so these test how pages relate to
    // one another, never an exact split
    describe("the scale control", function() {
      let widths
      // the bar pop-up's own margin above and below (bar_popup.module.css)
      const POPUP_MARGIN = 6

      // the real engines, their renderCard recording the width it is asked for
      let spyEngines = async () => {
        let bundle = await loadScoreEngines()
        return {
          ...bundle,
          ENGINES: {
            ...bundle.ENGINES,
            osmd: {...bundle.ENGINES.osmd, renderCard: async opts => {
              widths.push(opts.width)
              return bundle.ENGINES.osmd.renderCard(opts)
            }},
          },
        }
      }

      let mountScale = async ({settings={}, xml=null, width=1440, stored=null, props={}}={}) => {
        widths = []
        let musicXML = xml || await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
        let {piece} = await importMusicXMLPiece("fixture.musicxml", musicXML, store)
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: piece.id, hand: BOTH_HANDS, measuresPerCard: WHOLE_SECTION,
          practice: FREE_PRACTICE, startMeasure: 1, endMeasure: 16, ...settings,
        }))
        if (stored) { window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify(stored)) }
        await drawScale({width, props})
        return piece
      }

      // the page drawn afresh, as a visit or End session does, over what the
      // store and the settings hold
      let drawScale = async ({width=1440, props={}}={}) => {
        container = document.createElement("div")
        container.style.width = `${width}px`
        document.body.appendChild(container)
        root = createRoot(container)
        flushSync(() => {
          root.render(React.createElement(MemoryRouter, {},
            React.createElement(ScorePage, {
              ref: p => page = p, viewportHeight: 1240, loadEngines: spyEngines, ...props,
            })))
        })
        flushSync(() => {})
        await waitFor(() => container.querySelectorAll('button[aria-label^="Bar "]').length > 0,
          {message: "the fixture's bars to draw"})
        await quiet()
        return container
      }

      let quiet = () => new Promise(resolve => setTimeout(resolve, 80))

      let group = () => container.querySelector('[role="group"][aria-label="Score scale"]')
      let slider = () => group().querySelector('input[type="range"]')
      let smaller = () => buttonLabelled(group(), "Smaller score")
      let larger = () => buttonLabelled(group(), "Larger score")
      let reset = () => buttonNamed(group(), "Reset")
      let value = () => group().querySelector(`.${viewStyles.scale_value}`).textContent
      let barButtons = () => [...container.querySelectorAll('button[aria-label^="Bar "]')]
      let barNumbers = () => barButtons().map(b => +b.getAttribute("aria-label").slice(4))
      let bar = number => container.querySelector(`button[aria-label="Bar ${number}"]`)
      let next = () => buttonNamed(container, "Next page ›")
      let previous = () => buttonNamed(container, "‹ Previous page")

      // what the header and pager say, and the bars on the page shown
      let pageNow = () => {
        let label = container.querySelector(`.${viewStyles.page_label}`).textContent
        let found = /^Page (\d+) of (\d+) · bars? (\d+)(?:–(\d+))?$/.exec(label)
        expect(found).withContext(`the page label "${label}"`).toBeTruthy()
        let pager = container.querySelector(`.${viewStyles.pager_label}`).textContent
        let numbers = barNumbers()
        return {
          page: +found[1], pages: +found[2], first: +found[3], last: +(found[4] || found[3]), pager, numbers,
        }
      }

      // sets the slider as a drag does: the native value setter and an input event
      let setSlider = percent => {
        let input = slider()
        let set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
        set.call(input, String(percent))
        flushSync(() => input.dispatchEvent(new Event("input", {bubbles: true})))
      }

      // acts, then waits for the score to be engraved again and paginated
      let engraved = async act => {
        let sheet = container.querySelector("[data-score-sheet]")
        let svg = sheet.querySelector("svg")
        act()
        await waitFor(() => {
          let now = container.querySelector("[data-score-sheet] svg")
          return now && now !== svg && container.querySelector("[data-score-sheet]").getAttribute("aria-busy") == "false"
        }, {message: "the score to be engraved again"})
        await quiet()
      }

      // pages on until the bar is shown
      let showBar = number => {
        while (!previous().disabled) { click(previous()) }
        for (let turns = 0; !bar(number) && !next().disabled && turns < 40; turns++) { click(next()) }
        expect(bar(number)).withContext(`bar ${number} on a page`).toBeTruthy()
        return bar(number)
      }

      let near = (actual, expected, px, what) => {
        expect(Math.abs(actual - expected)).withContext(`${what}: ${actual} against ${expected}`).toBeLessThanOrEqual(px)
      }

      it("sits in the toolbar after the page label and before Shade, at 100%, with Reset off", async function() {
        await mountScale()

        let toolbar = container.querySelector(`.${viewStyles.toolbar}`)
        let children = [...toolbar.children]
        let label = children.find(el => el.classList.contains(viewStyles.page_label))
        let shade = children.find(el => el.getAttribute("aria-label") == "Shade bars by")
        expect(children.indexOf(group())).toEqual(children.indexOf(label) + 1)
        expect(children.indexOf(shade)).toEqual(children.indexOf(group()) + 1)

        expect(group().textContent).toContain("Scale")
        expect(value()).toEqual("100%")
        expect(slider().value).toEqual("100")
        expect([slider().min, slider().max, slider().step]).toEqual(["60", "150", "10"])
        expect(slider().getAttribute("aria-label")).toEqual("Score scale, percent")
        expect(reset().disabled).toBe(true)
        expect(smaller().disabled).toBe(false)
        expect(larger().disabled).toBe(false)
        expect(widths[widths.length - 1]).toEqual(644)
      })

      it("fits more bars on fewer pages at 60%, the header and the first bar and last bar shown agreeing", async function() {
        await mountScale()
        let before = pageNow()

        await engraved(() => { for (let i = 0; i < 4; i++) { click(smaller()) } })
        expect(value()).toEqual("60%")
        expect(smaller().disabled).toBe(true)
        expect(slider().value).toEqual("60")
        expect(reset().disabled).toBe(false)
        expect(widths[widths.length - 1]).toEqual(1073)

        let now = pageNow()
        expect(now.pages).toBeLessThanOrEqual(before.pages)
        expect(now.numbers.length).toBeGreaterThanOrEqual(before.numbers.length)
        expect(now.page).toEqual(1)
        expect([now.first, now.last]).toEqual([now.numbers[0], now.numbers[now.numbers.length - 1]])
        expect(now.pager).toEqual(`Page 1 of ${now.pages}`)
      })

      it("fits fewer bars on more pages up to 150%, to a last page holding bar 16", async function() {
        await mountScale()
        let at100 = pageNow()

        await engraved(() => { for (let i = 0; i < 5; i++) { click(larger()) } })
        expect(value()).toEqual("150%")
        expect(larger().disabled).toBe(true)
        expect(widths[widths.length - 1]).toEqual(429)

        let now = pageNow()
        expect(now.pages).toBeGreaterThan(at100.pages)
        expect(now.numbers.length).toBeLessThan(at100.numbers.length)
        expect(now.pager).toEqual(`Page 1 of ${now.pages}`)
        expect(previous().disabled).toBe(true)

        let seen = new Set(now.numbers)
        for (let turns = 0; !next().disabled && turns < 40; turns++) {
          click(next())
          let shown = pageNow()
          expect(shown.pager).toEqual(`Page ${shown.page} of ${now.pages}`)
          expect([shown.first, shown.last]).toEqual([shown.numbers[0], shown.numbers[shown.numbers.length - 1]])
          shown.numbers.forEach(number => seen.add(number))
        }
        expect(bar(16)).toBeTruthy()
        expect(pageNow().page).toEqual(now.pages)
        // every bar of the piece is on one page or another
        expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({length: 16}, (_, i) => i + 1))
      })

      it("takes the slider as a native range, and Reset back to 100%", async function() {
        await mountScale()
        let at100 = pageNow()

        await engraved(() => setSlider(120))
        expect(value()).toEqual("120%")
        expect(slider().value).toEqual("120")
        expect(reset().disabled).toBe(false)
        expect(pageNow().pages).toBeGreaterThanOrEqual(at100.pages)
        expect(widths[widths.length - 1]).toEqual(536)

        await engraved(() => click(reset()))
        expect(value()).toEqual("100%")
        expect(slider().value).toEqual("100")
        expect(reset().disabled).toBe(true)
        let again = pageNow()
        expect(again.pages).toEqual(at100.pages)
        expect(again.numbers).toEqual(at100.numbers)
      })

      it("re-engraves at each step of a drag, drawing nothing for a step to the same scale", async function() {
        await mountScale()
        let draws = widths.length

        await engraved(() => setSlider(110))
        expect(widths.length).toEqual(draws + 1)
        setSlider(110)
        await quiet()
        expect(widths.length).toEqual(draws + 1)
      })

      it("keeps the bar's pop-up open on the page holding its bar, re-anchored to it, through every scale", async function() {
        await mountScale()
        click(showBar(16))
        expect(dialog(container)).toBeTruthy()

        let anchored = scale => {
          let button = bar(16)
          expect(button).withContext(`${scale}%: bar 16 on the page shown`).toBeTruthy()
          let pop = dialog(container)
          expect(pop).withContext(`${scale}%: the pop-up still open`).toBeTruthy()
          expect(pop.getAttribute("aria-label")).toEqual("Bar 16 stats")

          let rect = button.getBoundingClientRect()
          let box = pop.getBoundingClientRect()
          expect(box.left).withContext(`${scale}%: pop-up overlaps the bar`).toBeLessThan(rect.right)
          expect(box.right).toBeGreaterThan(rect.left)
          // below the bar, or above it on a page's last system, with the
          // pop-up's own 6 px margin between
          let below = Math.abs(box.top - rect.bottom - POPUP_MARGIN) <= 2
          let above = Math.abs(rect.top - box.bottom - POPUP_MARGIN) <= 2
          expect(below || above).withContext(`${scale}%: pop-up ${box.top}-${box.bottom} against bar ${rect.top}-${rect.bottom}`).toBe(true)
        }

        anchored(100)
        await engraved(() => setSlider(150))
        anchored(150)
        await engraved(() => setSlider(60))
        anchored(60)
        await engraved(() => click(larger()))
        anchored(70)
      })

      it("keeps the pop-up of a bar on an earlier page, anchored there, when the scale goes up", async function() {
        await mountScale()
        click(bar(3))
        expect(dialog(container)).toBeTruthy()

        await engraved(() => setSlider(150))
        expect(bar(3)).toBeTruthy()
        expect(dialog(container).getAttribute("aria-label")).toEqual("Bar 3 stats")
        near(dialog(container).getBoundingClientRect().top, bar(3).getBoundingClientRect().bottom + POPUP_MARGIN, 2,
          "the pop-up under bar 3")
      })

      // the grand-staff lines on the page shown: the distinct tops of its bars
      let systemsShown = () => new Set(barButtons().map(b => Math.round(b.getBoundingClientRect().top))).size

      it("shows at least two grand-staff lines on every page but the last, at every scale", async function() {
        // puppeteer's 600 px window gives a page the least budget there is
        await mountScale()

        for (let scale of [150, 100, 120, 60, 80]) {
          await engraved(() => setSlider(scale))
          let {pages} = pageNow()
          while (!previous().disabled) { click(previous()) }

          for (let page = 1; page <= pages; page++) {
            let shown = pageNow()
            expect(shown.page).toEqual(page)
            if (page < pages) {
              expect(systemsShown()).withContext(`${scale}%: page ${page} of ${pages}`).toBeGreaterThanOrEqual(2)
            } else {
              expect(systemsShown()).toBeGreaterThanOrEqual(1)
            }
            if (!next().disabled) { click(next()) }
          }
        }
      }, 60000)

      it("fits at least as many lines on a page at a smaller scale", async function() {
        await mountScale()
        let lines = {}
        for (let scale of [150, 100, 60]) {
          await engraved(() => setSlider(scale))
          lines[scale] = systemsShown()
        }
        expect(lines[100]).toBeGreaterThanOrEqual(lines[150])
        expect(lines[60]).toBeGreaterThanOrEqual(lines[100])
        expect(lines[150]).toBeGreaterThanOrEqual(2)
      })

      it("applies the same page rule when the window re-engraves the score at another width", async function() {
        await mountScale()
        click(showBar(16))

        let svg = container.querySelector("svg")
        let column = container.querySelector('section[aria-label="The score"]')
        column.style.maxWidth = "560px"
        column.style.flex = "none"
        await waitFor(() => container.querySelector("svg") !== svg, {message: "the re-engraving"})
        await quiet()

        expect(bar(16)).toBeTruthy()
        expect(dialog(container).getAttribute("aria-label")).toEqual("Bar 16 stats")
      })

      it("shows the page holding the first bar it showed when no bar is open", async function() {
        await mountScale()
        await engraved(() => setSlider(150))
        click(next())
        let first = pageNow().first
        expect(first).toBeGreaterThan(1)

        await engraved(() => click(smaller()))
        expect(bar(first)).withContext(`bar ${first} after the step to 140%`).toBeTruthy()

        // and when the scale goes up and the page holding it is one further on
        await engraved(() => setSlider(100))
        expect(bar(first)).withContext(`bar ${first} after the step to 100%`).toBeTruthy()
      })

      it("starts on page 1 when nothing has been shown before", async function() {
        await mountScale({stored: {scale: 150}})
        expect(pageNow().page).toEqual(1)
        expect(pageNow().first).toEqual(1)
      })

      it("keeps tonight's study's tag on its first bar and the outline on its bars, at every scale", async function() {
        await mountScale({settings: {practice: PROGRAMME_PRACTICE}})

        let check = scale => {
          let tag = [...container.querySelectorAll(`.${sheetStyles.bar_tag}`)]
            .find(el => el.textContent == "Tonight's study · bars 5–7")
          // the tag is drawn on the page holding bar 5, so page to it
          if (!tag) {
            showBar(5)
            tag = [...container.querySelectorAll(`.${sheetStyles.bar_tag}`)]
              .find(el => el.textContent == "Tonight's study · bars 5–7")
          }
          expect(tag).withContext(`${scale}%: the study's tag`).toBeTruthy()
          near(tag.getBoundingClientRect().left, bar(5).getBoundingClientRect().left, 1, `${scale}%: tag against bar 5`)

          // the outlined bars on this page are bars 5-7 and no others
          for (let number of barNumbers()) {
            let overlay = bar(number)
            let outlined = overlay.style.borderTopColor == "var(--salon-oxblood)"
            expect(outlined).withContext(`${scale}%: bar ${number}`).toEqual(number >= 5 && number <= 7)
            if (outlined) { expect(overlay.style.borderTopWidth).toEqual("4px") }
          }
        }

        check(100)
        await engraved(() => setSlider(60))
        check(60)
        await engraved(() => setSlider(150))
        check(150)
      })

      it("keeps the passage tag at its first bar and the heat on the same bars under Score difficulty", async function() {
        await mountScale()
        click(buttonNamed(container, "Score difficulty"))

        let heat = () => {
          let found = new Set()
          // every page's heated bars, as page 1 on
          while (!previous().disabled) { click(previous()) }
          for (let turns = 0; turns < 40; turns++) {
            for (let button of barButtons()) {
              if (button.style.background && button.style.background != "transparent") {
                found.add(+button.getAttribute("aria-label").slice(4))
              }
            }
            if (next().disabled) { break }
            click(next())
          }
          return [...found].sort((a, b) => a - b)
        }
        let tagLeft = () => {
          showBar(5)
          let tag = [...container.querySelectorAll(`.${sheetStyles.bar_tag}`)].find(el => el.textContent.includes("bars 5–9"))
          expect(tag).toBeTruthy()
          near(tag.getBoundingClientRect().left, bar(5).getBoundingClientRect().left, 1, "the passage tag against bar 5")
        }

        let at100 = heat()
        expect(at100.length).toBeGreaterThan(0)
        tagLeft()

        for (let scale of [60, 150]) {
          await engraved(() => setSlider(scale))
          expect(heat()).withContext(`${scale}%: the bars carrying a heat fill`).toEqual(at100)
          tagLeft()
        }
      })

      it("keeps the scale through a session, and puts each bar's session label on its bar at the old and new scale", async function() {
        await mountScale({settings: {startMeasure: 3, endMeasure: 3, measuresPerCard: 1}})
        await engraved(() => setSlider(120))
        expect(value()).toEqual("120%")

        click(buttonNamed(container, "Begin"))
        playCard()
        await page.state.notes.generator.finishing
        click(buttonNamed(container, "End session"))
        await waitFor(() => buttonNamed(container, "Done"), {message: "the ended strip"})
        await waitFor(() => container.querySelector('button[aria-label^="Bar "]'), {message: "the score back"})
        await quiet()

        expect(container.textContent).toContain("Session ended")
        expect(value()).toEqual("120%")
        expect(slider().value).toEqual("120")
        expect(widths[widths.length - 1]).toEqual(536)

        let labelOnBar = scale => {
          let labels = [...container.querySelectorAll(`.${viewStyles.label}`)]
          expect(labels.length).withContext(`${scale}%: the played bar's label`).toBeGreaterThan(0)
          let button = bar(3)
          expect(button).withContext(`${scale}%: bar 3 on the page`).toBeTruthy()
          let barRect = button.getBoundingClientRect()
          for (let label of labels) {
            let rect = label.getBoundingClientRect()
            near(rect.left, barRect.left, 2, `${scale}%: label left`)
            near(rect.bottom, barRect.top, rect.height + 2, `${scale}%: label above its bar`)
          }
        }

        labelOnBar(120)
        await engraved(() => setSlider(80))
        expect(value()).toEqual("80%")
        labelOnBar(80)
      })

      it("is remembered across visits for every piece, on its steps and in its range", async function() {
        await mountScale()
        await engraved(() => setSlider(80))
        expect(JSON.parse(window.localStorage.getItem(SCORE_DRILL_STORAGE_KEY)).scale).toEqual(80)

        flushSync(() => root.unmount())
        container.remove()
        widths = []
        await drawScale()
        expect(value()).toEqual("80%")
        expect(slider().value).toEqual("80")
        expect(widths).toEqual([805])

        for (let [stored, shown] of [[55, "60%"], ["big", "100%"], [155, "150%"], [null, "100%"], [104, "100%"]]) {
          flushSync(() => root.unmount())
          container.remove()
          window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({scale: stored}))
          await drawScale()
          expect(value()).withContext(`stored ${JSON.stringify(stored)}`).toEqual(shown)
        }
      })

      it("keeps the scale beside the other drill settings it is stored with", async function() {
        await mountScale({stored: {mode: "scroll", speed: 120}})
        await engraved(() => setSlider(90))
        let stored = JSON.parse(window.localStorage.getItem(SCORE_DRILL_STORAGE_KEY))
        expect(stored).toEqual(jasmine.objectContaining({mode: "scroll", speed: 120, scale: 90}))
      })

      it("has no scale control for a piece drawn as a grid of bars", async function() {
        let song = parseMusicXML(workhorseScore())
        let piece = await store.putPiece({id: "old", title: "Workhorse", importedAt: 1000, song: songToJSON(song)})
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
        }))

        let el = renderScorePage()
        await waitFor(() => page.state.engineSource?.status == "missing", {message: "the missing source"})
        await waitFor(() => el.querySelector('[aria-label^="Bar "]'), {message: "the grid"})

        expect(el.querySelector('[aria-label="Score scale"]')).toBe(null)
        expect(el.querySelector('input[type="range"][aria-label="Score scale, percent"]')).toBe(null)
      })

      it("has no scale control for a piece the engine fails to draw", async function() {
        await drillPiece(workhorseScore())
        let el = renderScorePage({loadEngines: () => Promise.reject(new Error("offline"))})
        await waitFor(() => el.textContent.includes(SCORE_VIEW_FAILED), {message: "the failed-engine note"})

        expect(el.querySelector('[aria-label="Score scale"]')).toBe(null)
      })

      it("has no scale control without a piece", function() {
        let el = renderScorePage()
        expect(el.querySelector('[aria-label="Score scale"]')).toBe(null)
      })

      it("has no horizontal overflow at 390px wide, at 150% and at 60%", async function() {
        for (let scale of [150, 60]) {
          await mountScale({width: 390, stored: {scale}})
          expect(value()).toEqual(`${scale}%`)
          expect(container.scrollWidth).withContext(`${scale}%`).toBeLessThanOrEqual(container.clientWidth + 1)

          // the controls themselves fit the plate they are in
          let plate = container.querySelector(`.${viewStyles.score_plate}`).getBoundingClientRect()
          let rect = group().getBoundingClientRect()
          expect(rect.right).withContext(`${scale}%: the group in the plate`).toBeLessThanOrEqual(plate.right + 1)
          expect(rect.left).toBeGreaterThanOrEqual(plate.left - 1)

          flushSync(() => root.unmount())
          container.remove()
          root = container = null
        }
      })

      it("keeps its controls on one line, inside the plate", async function() {
        await mountScale()
        let middles = [...group().children].map(el => {
          let rect = el.getBoundingClientRect()
          return rect.top + rect.height / 2
        })
        expect(middles.length).toEqual(6)
        expect(Math.max(...middles) - Math.min(...middles)).withContext("the group's controls on one line").toBeLessThanOrEqual(4)

        let plate = container.querySelector(`.${viewStyles.score_plate}`).getBoundingClientRect()
        let rect = group().getBoundingClientRect()
        expect(rect.left).toBeGreaterThanOrEqual(plate.left)
        expect(rect.right).toBeLessThanOrEqual(plate.right)
      })

      it("takes steps pressed one after another in a single tick, each counting", async function() {
        await mountScale()
        await engraved(() => flushSync(() => { for (let i = 0; i < 3; i++) { smaller().click() } }))
        expect(value()).toEqual("70%")
        expect(JSON.parse(window.localStorage.getItem(SCORE_DRILL_STORAGE_KEY)).scale).toEqual(70)
      })
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

      // the groups that apply to it, with Pasted notation for the piece
      let toggles = [...pane.querySelectorAll("button[aria-expanded]")]
      expect(toggles.map(toggle => toggle.children[0].textContent)).toEqual(["Piece", "Session", "Cards", "Tempo"])
      click(toggles[0])
      expect(toggles[0].children[1].textContent).toEqual("Pasted notation")
      expect(pane.querySelector('textarea[aria-label="song notation"]')).toBe(null)
      click(toggles[0])
      expect(pane.querySelector('textarea[aria-label="song notation"]')).toBeTruthy()

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
  // the setup pane's "Section has N columns" counts what the session will
  // draw and judge: every onset while the engine draws the piece, only those
  // on the app staff while its fallback does
  describe("the section's column hint", function() {
    // a treble-only piece, 4 onsets a bar over bars 1-2, two below the
    // treble staff's A3
    let lowTreble = () => pianoScore({title: "Low treble", bars: [
      {upper: ["C4", "G3", "E4", "G4"].map(name => ({name}))},
      {upper: ["F3", "D4", "E4", "C4"].map(name => ({name}))},
    ]})

    let hint = el => [...el.querySelectorAll("div")]
      .find(div => div.children.length == 0 && /^Marked in gilt/.test(div.textContent)).textContent

    it("counts every onset while the engine draws the piece", async function() {
      await drillPiece(lowTreble(), {startMeasure: 1, endMeasure: 2})
      let el = renderScorePage()
      await waitFor(() => el.querySelectorAll('button[aria-label^="Bar "]').length > 0, {message: "the score to draw"})

      expect(page.engineCards()).toBe(true)
      expect(hint(el)).toContain("Section has 8 columns")
      // and it is what the session judges
      expect(page.currentCard().card.columns.length).toBe(8)
    })

    it("counts what the app staff keeps while it draws in the engine's place", async function() {
      let xml = lowTreble()
      let song = parseMusicXML(xml)
      let piece = await store.putPiece({id: "old", title: "Low treble", importedAt: 1000, song: songToJSON(song)})
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
        startMeasure: 1, endMeasure: 2,
      }))

      let el = renderScorePage()
      await waitFor(() => page.state.engineSource?.status == "missing", {message: "the missing source"})

      expect(page.engineCards()).toBe(false)
      expect(hint(el)).toContain("Section has 6 columns")
    })
  })

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

    it("draws the study's outlines on the grid of bars too", async function() {
      let song = parseMusicXML(workhorseScore())
      let piece = await store.putPiece({id: "old", title: "Workhorse", importedAt: 1000, song: songToJSON(song)})
      await store.putStudy({
        pieceId: piece.id, status: "learning", startedAt: 1,
        plan: {
          createdAt: 1, known: [],
          passages: [{start: 1, end: 4, from: "score", openedAt: 1, stage: 4, stageAt: 2, flowedAt: 3}],
        },
      })
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: PROGRAMME_PRACTICE,
      }))

      let el = renderScorePage()
      await waitFor(() => page.state.engineSource?.status == "missing", {message: "the missing source"})
      await waitFor(() => el.querySelector('[aria-label="Bar 5"]'), {message: "the grid"})

      let cell = number => el.querySelector(`[aria-label="Bar ${number}"]`)
      expect(cell(2).style.borderTopColor).toEqual("var(--salon-gilt)")
      expect(cell(2).style.borderTopWidth).toEqual("4px")
      // bars 5-8, or the flag's own passage, are the one in progress
      let outlined = [...el.querySelectorAll('[aria-label^="Bar "]')]
        .filter(bar => bar.style.borderTopColor == "var(--salon-oxblood)")
      expect(outlined.length).toBeGreaterThan(0)
      expect(outlined.every(bar => bar.style.borderTopWidth == "4px")).toBe(true)
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

  it("marks a Claude passage's reason with a Claude chip", async function() {
    let piece = await drillPiece(workhorseScore())
    let proposal = {
      id: "claude:3-4:0badf00d", source: "claude", start: 3, end: 4, startIndex: 2, endIndex: 3,
      hand: "both", level: 2, kinds: ["reading"], title: "Claude's pick", reason: "A crossing.",
      reasons: ["A crossing."], tip: "Slowly.",
    }
    await store.updateAnnotation(piece.id, record => ({...record, proposals: [...record.proposals, proposal]}))
    await store.updateAnnotation(piece.id, record => withDecisions(record, [
      acceptDecision({record, flag: reviewFlags(record).find(f => f.id == proposal.id), at: 5}),
    ]))

    let flags = flagsInForce(store.annotation(piece.id))
    let claude = flags.find(f => f.id == proposal.id)
    mountPane(flags, {settings: {piece: piece.id, hand: BOTH_HANDS}})
    clickRow(pane(), claude)

    let line = [...pane().querySelectorAll("li")].find(li => li.textContent.includes("A crossing."))
    expect(line.textContent).toContain("Claude")
    expect(line.textContent).not.toContain("Score")
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

  // a drag across the strip's cells, as a real one captures the pointer on
  // the cell it started in
  let dragStrip = (fromIdx, toIdx) => {
    let cells = [...reviewPane().querySelectorAll(`.${barStripStyles.cell}`)]
    let from = cells[fromIdx]
    let to = cells[toIdx]
    let middle = cell => {
      let rect = cell.getBoundingClientRect()
      return rect.left + rect.width / 2
    }
    let drag = (type, clientX) => flushSync(() => from.dispatchEvent(
      new PointerEvent(type, {bubbles: true, pointerId: 1, clientX})))

    drag("pointerdown", middle(from))
    drag("pointermove", middle(to))
    drag("pointerup", middle(to))
  }

  let queueCard = text => [...reviewPane().querySelectorAll(`.${reviewStyles.queue_card}`)]
    .find(card => card.textContent.includes(text))

  it("dragging the strip after 'Add a passage' keeps what was already typed, changing only the bars", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    clickButton(reviewPane(), "Add a passage")
    let nameInput = await waitFor(() => reviewPane().querySelector('input[type="text"]'), {message: "the name field"})
    changeValue(nameInput, "Typed name")
    let textareas = () => [...reviewPane().querySelectorAll("textarea")]
    let setTextarea = (idx, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textareas()[idx], value)
      flushSync(() => textareas()[idx].dispatchEvent(new Event("input", {bubbles: true})))
    }
    setTextarea(0, "Typed reason")
    clickButton(reviewPane(), "Left")
    clickButton(reviewPane(), "Hard")
    clickButton(reviewPane(), "leaps")

    dragStrip(0, 3)

    let startBar = reviewPane().querySelector('input[aria-label="start bar"]')
    let endBar = reviewPane().querySelector('input[aria-label="end bar"]')
    expect([startBar.value, endBar.value]).toEqual(["1", "4"])
    expect(reviewPane().querySelector('input[type="text"]').value).toEqual("Typed name")
    expect(textareas()[0].value).toEqual("Typed reason")

    clickButton(reviewPane(), "Save")
    let added = await waitFor(() =>
      flagsInForce(store.annotation(piece.id)).find(flag => flag.sources.includes("teacher")),
      {message: "the teacher's added flag"})
    expect([added.start, added.end, added.title, added.hand, added.level, added.kinds])
      .toEqual([1, 4, "Typed name", "lower", 2, ["leaps"]])
    expect(added.lines[0].text).toEqual("Typed reason")
  })

  it("a flag the teacher added and then renames shows no analysis name, and the editor keeps its name", async function() {
    let piece = await drillPiece(workhorseScore())
    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    clickButton(reviewPane(), "Add a passage")
    let nameInput = await waitFor(() => reviewPane().querySelector('input[type="text"]'), {message: "the name field"})
    changeValue(nameInput, "Mind the pedal")
    clickButton(reviewPane(), "Save")
    await waitFor(() => queueCard("Mind the pedal"), {message: "the added flag's card"})

    clickButton(queueCard("Mind the pedal"), "Edit")
    nameInput = await waitFor(() => reviewPane().querySelector('input[type="text"]'), {message: "the editor"})
    expect(nameInput.value).toEqual("Mind the pedal")
    changeValue(nameInput, "Pedal first")
    clickButton(reviewPane(), "Save")

    await waitFor(() => queueCard("Pedal first"), {message: "the renamed card"})
    expect(queueCard("Pedal first").textContent).not.toContain("the analysis called it")
    expect(queueCard("Pedal first").textContent).not.toContain("Mind the pedal")

    // and the editor still opens on the name it has, with no analysis name to go back to
    clickButton(queueCard("Pedal first"), "Edit")
    expect(reviewPane().querySelector('input[type="text"]').value).toEqual("Pedal first")
    expect(reviewPane().textContent).not.toContain("Named by the analysis")
    clickButton(reviewPane(), "Save")
    await waitFor(() => flagsInForce(store.annotation(piece.id)).some(flag => flag.title == "Pedal first"),
      {message: "the name kept through a second save"})
  })

  it("the tally never counts a dismissed flag as waiting, however its bars have changed", async function() {
    let piece = await drillPiece(workhorseScore())
    let record = store.annotation(piece.id)
    let flag = flagsInForce(record)[0]
    await decideFlags(piece.id, [dismissDecision({record, flag, by: "Ms Laurent", at: Date.now()})], store)

    // the dismissed flag's bars have since changed: its place reads "check"
    await store.updateAnnotation(piece.id, current => ({
      ...current,
      fingerprint: {
        ...current.fingerprint,
        bars: current.fingerprint.bars.map((hash, idx) =>
          idx >= flag.startIndex && idx <= flag.endIndex ? `${hash}x` : hash),
      },
    }))
    expect(reviewFlags(store.annotation(piece.id)).find(f => f.id == flag.id))
      .toEqual(jasmine.objectContaining({status: "dismissed", place: "check"}))

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    let tally = label => {
      let labelEl = [...reviewPane().querySelectorAll(`.${reviewStyles.tally} div`)]
        .find(el => el.textContent == label)
      return labelEl.nextSibling.textContent
    }
    expect(tally("Waiting for you")).toEqual("0")
    expect(tally("Dismissed")).toEqual("1")
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

  // a hand alone played once and passed, as the programme writes it for the
  // hand scaffold (no mark) or at a flag's request (requested)
  let recordHandBar = async (piece, measure, extra={}) => {
    let now = Date.now()
    let barId = `${piece.id}:lower:${measure}-${measure}`
    await store.recordAttempt({
      item: {
        id: barId, pieceId: piece.id, hand: "lower", startMeasure: measure, endMeasure: measure,
        level: "bar", state: "learning", step: 0, due: now, last: now, s: 1, d: 5,
        reps: 1, lapses: 0, streak: 1, lastGrade: 3, hits: 3, misses: 0, attempts: 1,
        lastPracticed: now, elapsedMs: 3000, algo: 1, createdAt: now - 1000,
        recent: [[now, 3, 3, 3]], ...extra,
      },
      review: {
        itemId: barId, pieceId: piece.id, at: now, kind: "attempt", grade: 3, was: "learning",
        columns: 3, clean: 3, misses: 0, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 1,
      },
    })
  }

  it("a hand a flag's tick asked for is not read as the bar needing hands apart, but the scaffold's is", async function() {
    let piece = await drillPiece(workhorseScore())
    let flag = flagsInForce(store.annotation(piece.id))[0]

    // the flagged bar's left hand was asked for; bar 2's too; bar 4's was the scaffold's
    await recordHandBar(piece, flag.start, {requested: true})
    await recordHandBar(piece, 2, {requested: true})
    await recordHandBar(piece, 4)

    mountReview(piece)
    await waitFor(() => reviewPane(), {message: "the review pane"})

    let plate = await waitFor(() => reviewPane().querySelector(`.${reviewStyles.trouble_plate}`),
      {message: "the trouble spots"})
    let spots = [...plate.querySelectorAll(`.${reviewStyles.trouble_item}`)].map(item => item.textContent)
    expect(spots.length).toEqual(1)
    expect(spots[0]).toContain("Bar 4")
    expect(spots[0]).toContain("Needed hands apart last time")

    // the flag's own card says nothing of its hand the flag asked for
    expect(reviewPane().querySelector(`.${reviewStyles.trouble_line}`)).toBe(null)
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


  // Claude's proposals (the offline command, tools/claude-flags): waiting
  // for a person, outside what shapes practice until one decides
  describe("Claude's proposals", function() {
    let claudeProposal = (start, end, over={}) => ({
      id: `claude:${start}-${end}:0badf00d`, source: "claude",
      start, end, startIndex: start - 1, endIndex: end - 1,
      hand: "both", level: 2, kinds: ["reading"],
      title: `Claude's ${start}`, reason: `The crossing in bar ${start}.`,
      reasons: [`The crossing in bar ${start}.`], tip: "Left hand alone first.",
      evidence: [{bar: start, index: start - 1, hand: "lower", notes: ["C3"], what: "the climb"}],
      citations: [
        {url: "https://example.com/one", title: "One page", says: "It is hard.", quote: "", sourceBars: "", verified: false},
        {url: "https://example.com/two", title: "Two page", says: "A famous trap.", quote: "", sourceBars: "", verified: false},
      ],
      claude: {confidence: "high", analysis: "agrees", analysisNote: "Same bars."},
      ...over,
    })

    let seedClaude = async (piece, proposals) => {
      await store.updateAnnotation(piece.id, record => ({...record, proposals: [...record.proposals, ...proposals]}))
    }

    // the queue card named by its title
    let card = title => {
      let pane = reviewPane()
      return pane && [...pane.querySelectorAll("li")].find(li => {
        let heading = li.querySelector(`.${reviewStyles.queue_card_title}`)
        return heading && heading.textContent == title
      })
    }

    let claudeFlags = () => reviewFlags(store.annotation(currentPiece.id)).filter(f => f.proposalSource == "claude")
    let currentPiece

    let setUp = async (proposals=[claudeProposal(3, 4), claudeProposal(13, 14)]) => {
      currentPiece = await drillPiece(workhorseScore())
      await seedClaude(currentPiece, proposals)
      mountReview(currentPiece)
      await waitFor(() => reviewPane() && card("Claude's 3"), {message: "Claude's cards"})
      return currentPiece
    }

    it("shows a card with the Claude chip, its reason, the agreement and sources not yet verified", async function() {
      await setUp()
      let first = card("Claude's 3")

      expect(first.querySelector(`.${reviewStyles.source_chip_claude}`).textContent.trim()).toEqual("Claude")
      expect(first.textContent).toContain("The crossing in bar 3.")
      expect(first.textContent).toContain("Score analysis agrees · Same bars.")
      expect(first.textContent).toContain("not yet verified")
      expect(first.textContent).toContain("Waiting for you")

      let links = [...first.querySelectorAll("a")]
      expect(links.map(a => a.getAttribute("href"))).toEqual(["https://example.com/one", "https://example.com/two"])
      expect(links.every(a => a.target == "_blank" && a.rel == "noopener noreferrer")).toBe(true)
      expect(reviewPane().querySelector("button a")).toBe(null)

      // each waiting card counts in the tally, but nothing in force changes
      let waiting = reviewPane().querySelector(`.${reviewStyles.tally}`).textContent
      expect(waiting).toMatch(/Waiting for you\s*3/)
      expect(flagsInForce(store.annotation(currentPiece.id)).some(f => f.proposalSource == "claude")).toBe(false)
    })

    it("accepting puts it in force with a Claude line chip; editing, dismissing and restoring follow", async function() {
      await setUp()

      clickButton(card("Claude's 3"), "Accept")
      await waitFor(() => card("Claude's 3").textContent.includes("❖ Accepted"), {message: "accepted"})
      let inForce = flagsInForce(store.annotation(currentPiece.id)).find(f => f.title == "Claude's 3")
      expect(inForce.status).toEqual("accepted")
      expect(inForce.lines[0]).toEqual({source: "claude", text: "The crossing in bar 3."})

      // edit: Hardest, and a name of the teacher's own
      clickButton(card("Claude's 3"), "Edit")
      let nameInput = await waitFor(() => reviewPane().querySelector('input[type="text"]'), {message: "the name field"})
      changeValue(nameInput, "The crossing")
      clickButton(reviewPane(), "Hardest")
      clickButton(reviewPane(), "Save")
      await waitFor(() => flagsInForce(store.annotation(currentPiece.id)).some(f => f.title == "The crossing"),
        {message: "edited"})
      let edited = flagsInForce(store.annotation(currentPiece.id)).find(f => f.title == "The crossing")
      expect(edited.level).toEqual(3)
      expect(card("The crossing").textContent).toContain("Renamed; the analysis called it “Claude's 3”")

      clickButton(card("The crossing"), "Dismiss")
      await waitFor(() => !flagsInForce(store.annotation(currentPiece.id)).some(f => f.title == "The crossing"),
        {message: "dismissed"})

      clickButton(card("The crossing"), "Restore")
      await waitFor(() => flagsInForce(store.annotation(currentPiece.id)).some(f => f.title == "The crossing"),
        {message: "restored in force as edited"})
      expect(claudeFlags().find(f => f.title == "The crossing").level).toEqual(3)
    })

    it("dismissing a waiting proposal and restoring it leaves it waiting, out of force", async function() {
      await setUp()

      clickButton(card("Claude's 13"), "Dismiss")
      await waitFor(() => card("Claude's 13").textContent.includes("Restore"), {message: "dismissed"})
      expect(claudeFlags().find(f => f.start == 13).status).toEqual("dismissed")

      clickButton(card("Claude's 13"), "Restore")
      await waitFor(() => card("Claude's 13").textContent.includes("Waiting for you"), {message: "waiting again"})
      expect(claudeFlags().find(f => f.start == 13).status).toEqual("waiting")
      expect(flagsInForce(store.annotation(currentPiece.id)).some(f => f.start == 13 && f.proposalSource == "claude")).toBe(false)
    })

    let flagsFileInput = () => reviewPane().querySelector('input[type="file"]')
    let openFile = async (text, name="x.flags.json") => {
      let input = flagsFileInput()
      Object.defineProperty(input, "files", {value: [new File([text], name)], configurable: true})
      flushSync(() => input.dispatchEvent(new Event("change", {bubbles: true})))
    }

    it("opens a version 2 file through the pane's input, and its cards appear without a reload", async function() {
      let piece = await drillPiece(workhorseScore())
      mountReview(piece)
      await waitFor(() => reviewPane(), {message: "the review pane"})
      expect(card("Claude's 3")).toBeFalsy()

      let exported = JSON.parse((await exportFlagsFile(piece.id, {by: "Claude"}, store)).text)
      let file = {
        ...exported, version: 2, decisions: [], proposals: [claudeProposal(3, 4), claudeProposal(13, 14)],
        run: {source: "claude", model: "claude-opus-5-5", effort: "high", web: true,
          promptVersion: 1, schemaVersion: 1, compactVersion: 1, cli: "2.1.296", at: 1},
      }
      await openFile(JSON.stringify(file))

      await waitFor(() => card("Claude's 3") && card("Claude's 13"), {message: "the cards"})
      expect(reviewPane().textContent).toContain("Opened Claude’s proposals for “Workhorse”: 2 passages to review")
    })

    it("exports a version 1 file after accepting, which another install opens with its reason and chip", async function() {
      await setUp()
      clickButton(card("Claude's 3"), "Accept")
      await waitFor(() => card("Claude's 3").textContent.includes("❖ Accepted"), {message: "accepted"})

      let created = []
      let originalCreate = URL.createObjectURL
      spyOn(URL, "createObjectURL").and.callFake(blob => { created.push(blob); return originalCreate(blob) })
      spyOn(URL, "revokeObjectURL")
      spyOn(HTMLAnchorElement.prototype, "click")
      clickButton(reviewPane(), "Export flags file")
      await waitFor(() => created.length > 0, {message: "the download"})

      let text = await created[0].text()
      let data = JSON.parse(text)
      expect(data.version).toEqual(1)
      expect(data.proposals).toBeUndefined()
      let decision = data.decisions.find(d => d.action == "accept")
      expect(decision.of.source).toEqual("claude")
      expect(decision.given.reasons).toEqual(["The crossing in bar 3."])

      // a second install holds the same piece, with no Claude proposals
      flushSync(() => root.unmount())
      container.remove()
      let other = await openTestStore()
      let {piece: theirs} = await importMusicXMLPiece("piece.musicxml", workhorseScore(), other)
      let result = await importFlagsFile(text, other, {pieceId: theirs.id})
      expect(result.error).toBeUndefined()

      let arrived = flagsInForce(other.annotation(theirs.id)).find(f => f.title == "Claude's 3")
      expect(arrived.status).toEqual("accepted")
      expect(arrived.lines[0]).toEqual({source: "claude", text: "The crossing in bar 3."})

      setAppStore(other)
      mountReview(theirs, {store: other})
      await waitFor(() => card("Claude's 3"), {message: "the card on the second install"})
      expect(card("Claude's 3").querySelector(`.${reviewStyles.source_chip_claude}`).textContent.trim()).toEqual("Claude")
      await other.close()
    }, 20000)

    it("says where a shifted proposal's notes were found, and draws no horizontal overflow at 380px with a long link", async function() {
      let longUrl = "https://example.com/" + "a-very-long-path-segment/".repeat(8) + "end"
      await setUp([
        claudeProposal(3, 4, {
          claude: {confidence: "medium", analysis: "new", analysisNote: "", shift: 1, claimed: {start: 2, end: 3}},
          citations: [{url: longUrl, title: "A long page title ".repeat(6), says: "x".repeat(200), quote: "", sourceBars: "", verified: false}],
        }),
      ])

      let first = card("Claude's 3")
      expect(first.textContent).toContain("Claude named bars 2–3; the notes it quoted are in bars 3–4")
      expect(first.textContent).toContain("New to the score analysis")

      container.style.width = "380px"
      let pane = reviewPane()
      let wide = el => el.scrollWidth > el.clientWidth + 1
      expect(wide(pane)).toBe(false)
      expect(wide(first)).toBe(false)
      expect([...first.querySelectorAll("*")].filter(wide)).toEqual([])
    })

    it("never draws a link that isn't http or https, nor markup in Claude's words", async function() {
      let unsafe = claudeProposal(3, 4, {
        title: "<img src=x onerror=alert(1)>",
        citations: [{url: "javascript:alert(1)", title: "Bad", says: "", quote: "", sourceBars: "", verified: false}],
      })
      await seedClaude(await drillPiece(workhorseScore()), [])
      currentPiece = await drillPiece(workhorseScore())
      await store.updateAnnotation(currentPiece.id, record => ({...record, proposals: [...record.proposals, unsafe]}))
      mountReview(currentPiece)
      await waitFor(() => reviewPane() && reviewPane().textContent.includes("<img src=x"), {message: "the card"})

      expect(reviewPane().querySelector("a")).toBe(null)
      expect(reviewPane().querySelector("img")).toBe(null)
    })
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
