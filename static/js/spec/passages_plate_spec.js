import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {PassagesPlate} from "st/components/sight_reading/passages_plate"
import {importMusicXMLPiece, songToJSON} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"

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

describe("the passages view (st/difficulty)", function() {
  let container, root, page, store, previousStore, savedStorage
  const STORAGE_KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

  beforeEach(async function() {
    savedStorage = STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of STORAGE_KEYS) { window.localStorage.removeItem(key) }
    window.localStorage.removeItem("st:passages_folded:v1")

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

    setAppStore(previousStore)
    store.close()

    for (let [key, value] of savedStorage) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let renderScorePage = () => {
    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p})))
    })
    flushSync(() => {})
    return container
  }

  let drillPiece = async (xml, settings={}) => {
    let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice", ...settings,
    }))
    return piece
  }

  let plate = () => container.querySelector("[data-passages-plate]")

  it("shows the piece at a glance at rest, and hides for Begin/Rest", async function() {
    await drillPiece(workhorseScore())
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    expect(plate().textContent).toContain("The piece at a glance")
    expect(plate().textContent).toMatch(/\d+ passages? · \d+ of 16 bars/)
    expect(plate().textContent).toMatch(/Passage I of [A-Z]+/)
    expect(plate().textContent).toContain("Bars 9–11")
    expect(plate().textContent).toContain("How to practise it")
    expect([...plate().querySelectorAll("li")].some(li => li.textContent.includes("Score"))).toBe(true)

    flushSync(() => page.beginSession())
    expect(plate()).toBe(null)

    flushSync(() => page.restSession())
    await waitFor(() => plate(), {message: "the passages plate again"})
  })

  it("selects a passage from a bracket or a list row", async function() {
    await drillPiece(workhorseScore({barCount: 24, denseAt: [5, 6, 7], alsoDenseAt: [17, 18, 19]}))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    // the bars the detail plate is showing, and the bars a bracket names
    let shownBars = () => plate().querySelector("h3").textContent
    let bracketBars = el => {
      let [, start, end] = el.getAttribute("aria-label").match(/bars? (\d+)(?:–(\d+))?/)
      return end ? `Bars ${start}–${end}` : `Bar ${start}`
    }

    let brackets = [...plate().querySelectorAll("button[aria-label^='Passage']")]
    expect(brackets.length).toBeGreaterThan(1)

    let bracket = brackets.find(b => bracketBars(b) != shownBars())
    expect(bracket).toBeTruthy()
    let wanted = bracketBars(bracket)
    flushSync(() => bracket.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    expect(shownBars()).toEqual(wanted)

    let rows = [...plate().querySelectorAll("li button")].filter(b => /–/.test(b.textContent))
    expect(rows.length).toBeGreaterThan(1)
    let other = rows.find(b => !b.closest("li").className.includes("on"))
    expect(other).toBeTruthy()
    flushSync(() => other.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    expect(other.closest("li").className).toContain("on")
    expect(shownBars()).toContain(other.textContent.match(/(\d+)–(\d+)/)[0])
  })

  it("practises exactly the selected passage's bars as one card", async function() {
    let piece = await drillPiece(workhorseScore())
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    let practise = [...plate().querySelectorAll("button")].find(b => b.textContent.startsWith("Practise bars"))
    expect(practise).toBeTruthy()
    let [, from, to] = practise.textContent.match(/Practise bars (\d+)–(\d+)/)

    flushSync(() => practise.dispatchEvent(new MouseEvent("click", {bubbles: true})))

    let stored = JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY))
    expect(stored.piece).toEqual(piece.id)
    expect(stored.practice).toEqual("free practice")
    expect(stored.startMeasure).toEqual(+from)
    expect(stored.endMeasure).toEqual(+to)
    expect(stored.measuresPerCard).toEqual("all")
  })

  it("analyses a piece added without an annotation on first open", async function() {
    // stored directly, as a piece imported before this change would be:
    // addPiece always annotates a freshly imported piece
    let xml = workhorseScore()
    let song = parseMusicXML(xml)
    let piece = await store.putPiece({id: "old", title: "Workhorse", importedAt: 1000, song: songToJSON(song)})
    await store.putPieceSource(piece.id, xml)
    expect(store.annotation(piece.id)).toBe(null)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
    }))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate, once analysed on open"})

    // the column only enters the tree once the annotation has loaded, so its
    // width is measured then: without it the score plate never draws and the
    // detail and list plates never sit side by side
    await waitFor(() => plate().querySelector("[class*=\"side_by_side\"]"),
      {message: "the plate column to be measured"})
    await waitFor(() => plate().querySelector("[class*=\"score_plate\"]"),
      {message: "the shaded engraving"})
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

    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    expect(plate().querySelector("h3").textContent).toEqual("Bar 12")
    expect(plate().textContent).toContain("Practise bar 12")

    let score = await waitFor(() => plate().querySelector("[class*=\"score_plate\"]"),
      {message: "the score plate"})
    expect(score.textContent).toContain("Bar 12")
    expect(score.textContent).not.toContain("Bars 12–12")

    // and the Flagged passages list row for the same passage
    expect(plate().querySelector("[class*=\"flag_list\"] [class*=\"list_bars\"]").textContent)
      .toEqual("Bar 12")
    expect(plate().textContent).not.toContain("12–12")

    // and the drawer's quick pick for the same passage
    let programme = [...container.querySelectorAll("button")]
      .find(b => b.textContent.trim() == "Programme")
    expect(programme).toBeTruthy()
    flushSync(() => programme.dispatchEvent(new MouseEvent("click", {bubbles: true})))

    let picks = container.querySelector('[role="group"][aria-label="difficult passages"]')
    expect(picks).toBeTruthy()
    expect([...picks.querySelectorAll("button")].map(b => b.textContent))
      .toContain("Bar 12 · Hardest")
  })

  // The whole live scenario the quick picks opened up: a section change moves
  // the drawn range on a render before the drill's columns follow it, and in
  // scroll mode the passage drilled first comes back from the kept system
  // (see systemCache in st/components/score_card)
  it("keeps the engraving when a passage already drilled in scroll mode is picked again", async function() {
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    await drillPiece(workhorseScore({barCount: 24, denseAt: [5, 6, 7], alsoDenseAt: [17, 18, 19]}))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    let programme = [...container.querySelectorAll("button")]
      .find(b => b.textContent.trim() == "Programme")
    flushSync(() => programme.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    let picks = () => [...container.querySelectorAll('[role="group"][aria-label="difficult passages"] button')]
    expect(picks().length).toEqual(2)

    // the drawn heads of the system the pick put up, once the page has
    // settled on it: 0 where it fell back to the trainer's own staff
    let engrave = async which => {
      flushSync(() => picks()[which].dispatchEvent(new MouseEvent("click", {bubbles: true})))
      await waitFor(() => {
        let drawn = container.querySelector("[data-score-card]")
        return (drawn && drawn.getAttribute("aria-busy") == "false") ||
          page.state.engineSource?.status == "failed"
      }, {timeout: 1500, message: "the picked passage's system"})
      let svg = container.querySelector("[data-score-card] svg")
      return svg ? svg.querySelectorAll("path").length : 0
    }

    expect(await engrave(0)).toBeGreaterThan(0)
    expect(await engrave(1)).toBeGreaterThan(0)
    // back to the first passage, from the system kept for it
    expect(await engrave(0)).toBeGreaterThan(0)
    expect(page.state.engineSource.status).toEqual("ready")
    expect(container.textContent).not.toContain("couldn't be engraved")
  })

  it("hides the score plate when the engine can't draw the piece", async function() {
    let xml = workhorseScore()
    let piece = await drillPiece(xml)

    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(PassagesPlate, {
        settings: {piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice"},
        setSettings: () => {},
        source: {status: "ready", musicXML: xml},
        engine: "osmd",
        // the engine module never arrives, as a failed load or a throwing
        // engine leaves the overview: ScoreCard reports it through onError
        loadEngines: () => new Promise((resolve, reject) =>
          setTimeout(() => reject(new Error("no engines here")), 100)),
        store,
      }))
    })

    let score = await waitFor(() => plate() && plate().querySelector("[class*=\"score_plate\"]"),
      {message: "the score plate to go up"})
    expect(score.querySelector("[aria-busy=\"true\"]")).toBeTruthy()

    await waitFor(() => !plate().querySelector("[class*=\"score_plate\"]"),
      {message: "the score plate to come down"})
    expect(plate().textContent).toContain("The piece at a glance")
  })

  it("shows nothing for a piece without passages", async function() {
    await drillPiece(pianoScore({bars: [{upper: [{name: "C4"}]}]}))
    renderScorePage()
    await waitFor(() => container.querySelector("[data-score-card]"), {message: "the page to settle"})
    expect(plate()).toBe(null)
  })
})
