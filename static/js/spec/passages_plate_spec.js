import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {PassagesPlate} from "st/components/sight_reading/passages_plate"
import {ProgrammePlate} from "st/components/sight_reading/programme_plate"
import {importMusicXMLPiece, songToJSON} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {loadScoreEngines} from "st/score_render/load"
import scoreCardStyles from "st/components/score_card.module.css"
import pageStyles from "st/components/pages/sight_reading_page.module.css"
import passagesStyles from "st/components/sight_reading/passages_plate.module.css"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"

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

  // wraps the real engines so overviewCalls records each overview render
  // (st/components/score_card draws a real engine card, never a fake
  // bundle): [fromMeasure, toMeasure] per call
  let countOverviewDraws = () => {
    let overviewCalls = []
    let loadEngines = () => loadScoreEngines().then(bundle => ({...bundle, ENGINES: {...bundle.ENGINES,
      osmd: {...bundle.ENGINES.osmd, renderCard: args => {
        overviewCalls.push([args.fromMeasure, args.toMeasure])
        return bundle.ENGINES.osmd.renderCard(args)
      }}}}))
    return {overviewCalls, loadEngines}
  }

  let openScorePane = () => {
    let button = [...plate().querySelectorAll("button")]
      .find(b => b.textContent.trim() == "Show the score")
    flushSync(() => button.dispatchEvent(new MouseEvent("click", {bubbles: true})))
  }

  let scorePane = () => container.querySelector('aside[aria-label="The score"]')

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

    // it lives in the trainer's rail (an aside), not the main column
    expect(plate().closest("aside")).toBeTruthy()

    flushSync(() => page.beginSession())
    expect(plate()).toBe(null)

    flushSync(() => page.restSession())
    await waitFor(() => plate(), {message: "the passages plate again"})
  })

  it("draws the shaded score only once its pane is open", async function() {
    let {overviewCalls, loadEngines} = countOverviewDraws()

    await drillPiece(workhorseScore())
    renderScorePage({loadEngines})
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    let drewOverview = () => overviewCalls.some(([from, to]) => from == 1 && to == 16)

    expect(plate().querySelector("[data-score-overview]")).toBe(null)
    expect(drewOverview()).toBe(false)

    // selecting another passage, and a Begin/Rest cycle, still draws nothing
    let rows = [...plate().querySelectorAll('[class*="flag_list"] li button')]
    let other = rows.find(b => !b.closest("li").className.includes("on"))
    if (other) { flushSync(() => other.dispatchEvent(new MouseEvent("click", {bubbles: true}))) }

    flushSync(() => page.beginSession())
    expect(plate()).toBe(null)
    flushSync(() => page.restSession())
    await waitFor(() => plate(), {message: "the passages plate again"})

    expect(container.querySelector("[data-score-overview]")).toBe(null)
    expect(drewOverview()).toBe(false)

    openScorePane()
    let pane = await waitFor(() => scorePane(), {message: "the score pane"})
    expect(pane.getAttribute("aria-hidden")).not.toEqual("true")

    let overview = await waitFor(() => pane.querySelector("[data-score-overview]"), {message: "the drawn overview"})
    await waitFor(() => overview.getAttribute("aria-busy") == "false", {message: "the overview to settle"})

    expect(overview.querySelectorAll("rect[data-shade]").length).toBeGreaterThan(0)
    expect(overviewCalls.filter(([from, to]) => from == 1 && to == 16).length).toEqual(1)

    flushSync(() => pane.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})))
    expect(container.querySelector("[data-score-overview]")).toBe(null)
  })

  it("reads why a shaded passage is hard from the score pane", async function() {
    await drillPiece(workhorseScore({barCount: 24, denseAt: [5, 6, 7], alsoDenseAt: [17, 18, 19]}))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    openScorePane()
    let pane = await waitFor(() => scorePane(), {message: "the score pane"})
    let overview = await waitFor(() => pane.querySelector("[data-score-overview]"), {message: "the drawn overview"})
    await waitFor(() => overview.getAttribute("aria-busy") == "false", {message: "the overview to settle"})

    let before = pane.querySelector("h3").textContent

    let selected = overview.querySelector(`rect[data-shade].${scoreCardStyles.on}`)
    expect(selected).toBeTruthy()
    let otherId = [...overview.querySelectorAll("rect[data-shade]")]
      .map(el => el.getAttribute("data-shade"))
      .find(id => id != selected.getAttribute("data-shade"))
    expect(otherId).toBeTruthy()

    flushSync(() => overview.querySelector(`rect[data-shade="${otherId}"]`)
      .dispatchEvent(new MouseEvent("click", {bubbles: true})))

    expect(pane.querySelector("h3").textContent).not.toEqual(before)
    // the rail's own detail plate reads the same selection
    expect(plate().querySelector("h3").textContent).toEqual(pane.querySelector("h3").textContent)
  })

  // the pane's own layout: the score is the tall thing in the pane's single
  // scroller, so the passage detail — which carries the tap legend as its
  // last line — stays with the reader rather than scrolling away with the
  // score (see .pane_detail, sticky once there is room for the two columns)
  it("keeps the passage detail and its legend out of the pane's scrolling score", async function() {
    await drillPiece(workhorseScore({barCount: 48, denseAt: [5, 6, 7], alsoDenseAt: [40, 41, 42]}))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    openScorePane()
    let pane = await waitFor(() => scorePane(), {message: "the score pane"})
    let overview = await waitFor(() => pane.querySelector("[data-score-overview]"), {message: "the drawn overview"})
    await waitFor(() => overview.getAttribute("aria-busy") == "false", {message: "the overview to settle"})

    let top = el => el.getBoundingClientRect().top
    let bottom = el => el.getBoundingClientRect().bottom
    let detail = pane.querySelector(`.${passagesStyles.pane_detail}`)
    let score = pane.querySelector(`.${passagesStyles.pane_score}`)
    let legend = pane.querySelector(`.${passagesStyles.legend}`)
    expect(detail).toBeTruthy()
    expect(legend.textContent).toContain("Tap a shaded passage")

    // the legend reads under the detail, in the detail's column, so the score
    // is the only thing the pane scrolls
    expect(detail.contains(legend)).toBe(true)
    expect(score.contains(legend)).toBe(false)
    expect(top(legend)).not.toBeLessThan(top(detail))

    // and the detail is never below the score, stacked or side by side
    expect(top(detail)).not.toBeGreaterThan(top(score))

    // with room for the two columns the detail is sticky, so scrolling the
    // score down to a late passage leaves it and its legend on screen, clear
    // of the pane's own pinned header. The spec window may be narrower than
    // that layout's 900px, where the detail is simply first and scrolls with
    // the rest
    if (window.matchMedia("(min-width: 900px)").matches) {
      expect(getComputedStyle(detail).position).toEqual("sticky")
      pane.scrollTop = pane.scrollHeight
      await waitFor(() => pane.scrollTop > 0, {message: "the pane to scroll"})
      expect(top(detail)).not.toBeLessThan(bottom(pane.querySelector(`.${drawerStyles.drawer_header}`)))
      expect(bottom(legend)).not.toBeGreaterThan(bottom(pane))
    }
  })

  // the pane is the scroller and the piece it holds is long, so its header —
  // the only way out of it, with no scrim to click on a window no wider than
  // the pane — stays pinned at the top however far the score has scrolled
  it("keeps the score pane's close button on screen as the score scrolls", async function() {
    await drillPiece(workhorseScore({barCount: 48, denseAt: [5, 6, 7], alsoDenseAt: [40, 41, 42]}))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    openScorePane()
    let pane = await waitFor(() => scorePane(), {message: "the score pane"})
    let overview = await waitFor(() => pane.querySelector("[data-score-overview]"), {message: "the drawn overview"})
    await waitFor(() => overview.getAttribute("aria-busy") == "false", {message: "the overview to settle"})

    let close = pane.querySelector('[aria-label="Close the score"]')
    expect(close).toBeTruthy()

    // the score is taller than the pane, so there is somewhere to scroll to
    expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight + 200)
    pane.scrollTop = pane.scrollHeight
    await waitFor(() => pane.scrollTop > 200, {message: "the pane to scroll down"})

    let paneBox = pane.getBoundingClientRect()
    let closeBox = close.getBoundingClientRect()
    expect(closeBox.top).not.toBeLessThan(paneBox.top)
    expect(closeBox.bottom).not.toBeGreaterThan(paneBox.bottom)

    // and it still closes the pane from there
    flushSync(() => close.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    expect(pane.getAttribute("aria-hidden")).toEqual("true")
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

  it("practises a passage from the score pane", async function() {
    let piece = await drillPiece(workhorseScore())
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    openScorePane()
    let pane = await waitFor(() => scorePane(), {message: "the score pane"})
    await waitFor(() => {
      let overview = pane.querySelector("[data-score-overview]")
      return overview && overview.getAttribute("aria-busy") == "false"
    }, {message: "the drawn overview"})

    let practise = [...pane.querySelectorAll("button")].find(b => b.textContent.startsWith("Practise bars"))
    expect(practise).toBeTruthy()
    let [, from, to] = practise.textContent.match(/Practise bars (\d+)–(\d+)/)

    flushSync(() => practise.dispatchEvent(new MouseEvent("click", {bubbles: true})))

    let stored = JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY))
    expect(stored.piece).toEqual(piece.id)
    expect(stored.practice).toEqual("free practice")
    expect(stored.startMeasure).toEqual(+from)
    expect(stored.endMeasure).toEqual(+to)
    expect(stored.measuresPerCard).toEqual("all")

    expect(pane.getAttribute("aria-hidden")).toEqual("true")
  })

  // the overview only begins drawing once the pane has measured its own
  // column, so the scroll waits on the drawing itself: an engine that takes
  // longer than a second (a long import's first engraving does) must still
  // scroll the pane to the chosen band, not give up on a fixed budget
  it("opens the score pane at the passage shown, scrolled to it", async function() {
    // the overview alone draws slowly, well past the second a fixed retry
    // budget allowed: the trainer's own cards (any range but the whole
    // piece) are left as they are
    let slowOverview = () => loadScoreEngines().then(bundle => ({...bundle, ENGINES: {...bundle.ENGINES,
      osmd: {...bundle.ENGINES.osmd, renderCard: args =>
        (args.fromMeasure == 1 && args.toMeasure == 24 ?
          new Promise(resolve => setTimeout(resolve, 2500)) : Promise.resolve())
          .then(() => bundle.ENGINES.osmd.renderCard(args))}}}))

    await drillPiece(workhorseScore({barCount: 24, denseAt: [5, 6, 7], alsoDenseAt: [17, 18, 19]}))
    renderScorePage({loadEngines: slowOverview})
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    // select a passage other than the default (hardest) one
    let rows = [...plate().querySelectorAll('[class*="flag_list"] li button')]
    let other = rows.find(b => !b.closest("li").className.includes("on"))
    expect(other).toBeTruthy()
    flushSync(() => other.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    let wantedBars = plate().querySelector("h3").textContent

    // the pane's own scrolling element, whose scrolls are recorded
    let scrolls = []
    let pane = scorePane()
    expect(pane).toBeTruthy()
    pane.scrollTo = options => scrolls.push(options)

    openScorePane()
    expect(pane.querySelector("h3").textContent).toEqual(wantedBars)

    let overview = await waitFor(() => pane.querySelector("[data-score-overview]"), {message: "the drawn overview"})
    await waitFor(() => overview.getAttribute("aria-busy") == "false", {message: "the overview to settle"})

    let band = await waitFor(() => overview.querySelector(`rect[data-shade].${scoreCardStyles.on}`),
      {message: "the selected band"})
    await waitFor(() => scrolls.length > 0, {message: "the pane to scroll to the selected band"})

    // it scrolled to where that band is drawn (nothing moved: the scroll was
    // recorded, not performed), a little above it
    let wantedTop = Math.max(0,
      band.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24)
    expect(Math.abs(scrolls[scrolls.length - 1].top - wantedTop)).toBeLessThan(2)
  }, 20000)

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
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    // the pane measures its own column once it opens: without that, the
    // overview never draws
    await waitFor(() => [...plate().querySelectorAll("button")].find(b => b.textContent.trim() == "Show the score"),
      {message: "the Show the score control"})
    openScorePane()

    await waitFor(() => container.querySelector('aside[aria-label="The score"] [data-score-overview]'),
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
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    expect(plate().querySelector("h3").textContent).toEqual("Bar 12")
    expect(plate().textContent).toContain("Practise bar 12")

    openScorePane()
    let pane = await waitFor(() => scorePane(), {message: "the score pane"})
    await waitFor(() => {
      let overview = pane.querySelector("[data-score-overview]")
      return overview && overview.getAttribute("aria-busy") == "false"
    }, {message: "the drawn overview"})
    expect(pane.textContent).toContain("Bar 12")
    expect(pane.textContent).not.toContain("Bars 12–12")

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

    await waitFor(() => plate(), {message: "the passages plate"})
    let showScore = () => [...plate().querySelectorAll("button")].find(b => b.textContent.trim() == "Show the score")
    await waitFor(() => showScore(), {message: "the Show the score control"})
    openScorePane()

    let overview = await waitFor(() => container.querySelector("[data-score-overview]"),
      {message: "the overview to go up"})
    expect(overview.getAttribute("aria-busy")).toEqual("true")

    await waitFor(() => !container.querySelector("[data-score-overview]"),
      {message: "the overview to come down"})
    expect(showScore()).toBeUndefined()
    expect(plate().textContent).toContain("The piece at a glance")

    // the failure note stands alone: no legend telling the reader to tap
    // bands that were never drawn
    let pane = scorePane()
    expect(pane.textContent).toContain("The score couldn't be engraved.")
    expect(pane.textContent).not.toContain("Tap a shaded passage")
  })

  it("offers no score pane without a stored source", async function() {
    let piece = await drillPiece(workhorseScore())

    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(PassagesPlate, {
        settings: {piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice"},
        setSettings: () => {},
        source: {status: "missing"},
        store,
      }))
    })

    await waitFor(() => plate(), {message: "the passages plate"})
    expect([...plate().querySelectorAll("button")].find(b => b.textContent.trim() == "Show the score"))
      .toBeUndefined()
  })

  it("shows nothing for a piece without passages", async function() {
    await drillPiece(pianoScore({bars: [{upper: [{name: "C4"}]}]}))
    renderScorePage()
    await waitFor(() => container.querySelector("[data-score-card]"), {message: "the page to settle"})
    expect(plate()).toBe(null)
  })

  // the rail's plates stand in for its engraving only while they show
  // something: in free practice there is no programme plate, so a piece with
  // no flagged passages leaves the rail as it has always been
  it("keeps the rail's engraving while the rail's plates show nothing", async function() {
    let engravingShown = () => {
      let img = container.querySelector(`.${pageStyles.rail} .${pageStyles.engraving} img`)
      return !!img && img.getClientRects().length > 0
    }

    await drillPiece(pianoScore({bars: [{upper: [{name: "C4"}]}]}))
    renderScorePage()
    await waitFor(() => container.querySelector("[data-score-card]"), {message: "the page to settle"})

    expect(plate()).toBe(null)
    expect(engravingShown()).toBe(true)

    flushSync(() => root.unmount())
    container.remove()

    // the same page with a flagged piece: its plate takes the slot
    await drillPiece(workhorseScore())
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    expect(engravingShown()).toBe(false)
  })

  // the sheet-music UI polish: the glance plate's header and counts row, and
  // the programme plate's figures, both fit a rail column (clamp(260px,
  // 26vw, 340px), see docs/design/salon-de-chopin.md) without overflowing it
  it("fits a narrow rail column without horizontal overflow", async function() {
    let xml = workhorseScore({barCount: 101, denseAt: [9, 10, 11], alsoDenseAt: [53, 54]})
    let piece = await drillPiece(xml)

    let overflowing = el => [...el.querySelectorAll('[class*="plate"]')]
      .filter(plateEl => plateEl.scrollWidth > plateEl.clientWidth + 1)

    for (let width of [260, 340]) {
      let div = document.createElement("div")
      div.style.width = `${width}px`
      document.body.appendChild(div)
      let r = createRoot(div)
      flushSync(() => r.render(React.createElement(PassagesPlate, {
        settings: {piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice"},
        setSettings: () => {},
        // a piece whose score the app still keeps, so the counts row carries
        // both of its controls, as it does at rest in the app
        source: {status: "ready", musicXML: xml},
        store,
      })))
      await waitFor(() => div.querySelector("[data-passages-plate]"), {message: `the plate at ${width}px`})

      let labels = [...div.querySelectorAll("button")].map(b => b.textContent.trim())
      expect(labels).toContain("Show the score")
      expect(labels).toContain("Hide the passages")

      expect(overflowing(div)).toEqual([])

      flushSync(() => r.unmount())
      div.remove()
    }
  })

  it("fits a narrow rail column without horizontal overflow (the programme plate)", function() {
    let generator = {
      summary: () => ({due: 2, dueMinutes: 4, newMeasures: 3, targetMinutes: 20, learned: 4, measures: 8}),
    }

    let overflowing = el => [...el.querySelectorAll('[class*="plate"]')]
      .filter(plateEl => plateEl.scrollWidth > plateEl.clientWidth + 1)

    let div = document.createElement("div")
    div.style.width = "260px"
    document.body.appendChild(div)
    let r = createRoot(div)
    flushSync(() => r.render(React.createElement(ProgrammePlate, {
      generator, settings: {piece: "x"}, setSettings: () => {}, store,
    })))

    expect(overflowing(div)).toEqual([])

    flushSync(() => r.unmount())
    div.remove()
  })
})
