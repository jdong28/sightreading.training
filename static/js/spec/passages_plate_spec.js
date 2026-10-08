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
import reviewStyles from "st/components/sight_reading/review_pane.module.css"
import barStripStyles from "st/components/bar_strip.module.css"

import {flagsInForce} from "st/difficulty/records"
import {reviewFlags, withDecisions, dismissDecision} from "st/difficulty/decisions"

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

  // Pending: the score page's trainer no longer renders a Rail (removed
  // with ScoreRail/ProgrammePlate/PassagesPlate, see score_page.jsx), so
  // PassagesPlate is unreachable through ScorePage any more. These cases
  // are re-pointed at the score-first page's Score difficulty shade and
  // passage pane once they exist (score-first sheet music plan, builds 5-7),
  // per plan.md's Files: "its review-pane cases move to score_view_spec.js
  // ... the passage cases move to the pane." The review pane describe below
  // mounts PassagesPlate/ProgrammePlate directly and is unaffected.
  xit("shows the piece at a glance at rest, and hides for Begin/Rest", async function() {
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

  xit("draws the shaded score only once its pane is open", async function() {
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

  xit("reads why a shaded passage is hard from the score pane", async function() {
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
  xit("keeps the passage detail and its legend out of the pane's scrolling score", async function() {
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
  xit("keeps the score pane's close button on screen as the score scrolls", async function() {
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

    // the pinned header is exactly as tall as the offset everything inside
    // the drawer clears it by (the sticky detail, and the scroll to a band)
    let header = pane.querySelector(`.${drawerStyles.drawer_header}`)
    let offset = parseFloat(getComputedStyle(pane).getPropertyValue("--drawer-header-height"))
    expect(offset).toBeGreaterThan(0)
    expect(Math.abs(header.getBoundingClientRect().height - offset)).toBeLessThan(1)

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

  xit("selects a passage from a bracket or a list row", async function() {
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

  xit("practises exactly the selected passage's bars as one card", async function() {
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

  xit("practises a passage from the score pane", async function() {
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
  xit("opens the score pane at the passage shown, scrolled to it", async function() {
    // the overview alone draws slowly, well past the second a fixed retry
    // budget allowed: the trainer's own cards (any range but the whole
    // piece) are left as they are
    let slowOverview = () => loadScoreEngines().then(bundle => ({...bundle, ENGINES: {...bundle.ENGINES,
      osmd: {...bundle.ENGINES.osmd, renderCard: args =>
        (args.fromMeasure == 1 && args.toMeasure == 60 ?
          new Promise(resolve => setTimeout(resolve, 2500)) : Promise.resolve())
          .then(() => bundle.ENGINES.osmd.renderCard(args))}}}))

    await drillPiece(workhorseScore({barCount: 60, denseAt: [5, 6, 7], alsoDenseAt: [28, 29, 30]}))
    renderScorePage({loadEngines: slowOverview})
    await waitFor(() => plate(), {message: "the passages plate"})
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the engine source"})

    // select the piece's latest passage: far enough down the engraving that
    // the pane has to scroll to reach it, with enough piece left below it
    // that the scroll is never cut short by the end of the content
    let rows = [...plate().querySelectorAll('[class*="flag_list"] li button')]
    let startBar = row => +row.querySelector('[class*="list_bars"]').textContent.match(/(\d+)/)[1]
    let latest = rows.reduce((a, row) => startBar(row) > startBar(a) ? row : a)
    expect(startBar(latest)).toBeGreaterThan(20)
    flushSync(() => latest.dispatchEvent(new MouseEvent("click", {bubbles: true})))
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

    // the position it asked for (the scroll was recorded, not performed, so
    // nothing has moved yet) puts the band just below the pane's pinned
    // header rather than behind it
    pane.scrollTop = scrolls[scrolls.length - 1].top
    expect(pane.scrollTop).toBeGreaterThan(0)

    let headerBottom = pane.querySelector(`.${drawerStyles.drawer_header}`).getBoundingClientRect().bottom
    let bandTop = band.getBoundingClientRect().top
    expect(bandTop).not.toBeLessThan(headerBottom)
    expect(bandTop).toBeLessThan(headerBottom + 40)
  }, 20000)

  xit("analyses a piece added without an annotation on first open", async function() {
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

  xit("names a one-bar passage in the singular", async function() {
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
  xit("keeps the engraving when a passage already drilled in scroll mode is picked again", async function() {
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

  xit("hides the score plate when the engine can't draw the piece", async function() {
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

  xit("offers no score pane without a stored source", async function() {
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

  xit("shows nothing for a piece without passages", async function() {
    await drillPiece(pianoScore({bars: [{upper: [{name: "C4"}]}]}))
    renderScorePage()
    await waitFor(() => container.querySelector("[data-score-card]"), {message: "the page to settle"})
    expect(plate()).toBe(null)
  })

  // the rail's plates stand in for its engraving only while they show
  // something: in free practice there is no programme plate, so a piece with
  // no flagged passages leaves the rail as it has always been
  xit("keeps the rail's engraving while the rail's plates show nothing", async function() {
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
  xit("fits a narrow rail column without horizontal overflow", async function() {
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

  it("names a pulled passage on the order row only while one is flagged hard", async function() {
    let piece = await drillPiece(workhorseScore(), {practice: "programme"})
    let settings = {piece: piece.id, hand: "both hands", practice: "programme"}
    let generator = {
      summary: () => ({due: 0, dueMinutes: 0, newMeasures: 3, toRead: 0, targetMinutes: 20, learned: 4, measures: 16}),
    }

    let flag = level => ({
      id: `score:9-11:level-${level}`, source: "score", start: 9, end: 11, startIndex: 9, endIndex: 11,
      hand: "both", level, kinds: ["density"], title: "Test passage",
      reason: "test", reasons: ["test"], tip: "test",
    })

    let div = document.createElement("div")
    document.body.appendChild(div)
    let r = createRoot(div)

    let describeOrder = async (level, introduce) => {
      await store.putAnnotation({
        pieceId: piece.id, fingerprint: {bars: []}, decisions: [], runs: {}, proposals: [flag(level)],
      })
      flushSync(() => r.render(React.createElement(ProgrammePlate, {
        generator, settings: {...settings, introduce}, setSettings: () => {}, store,
      })))
      // the order row is offered either way: the read-through still applies
      expect([...div.querySelectorAll("button")].map(b => b.textContent.trim()))
        .toContain("Hardest first")
      return div.querySelector("[class*='order_description']").textContent
    }

    // a passage flagged hard is named, with its bars, in both pulling orders
    expect(await describeOrder(3, "read through"))
      .toBe("Read the piece through once, then bars 9\u201311, the hardest passage; the rest in score order.")
    expect(await describeOrder(2, "hardest first"))
      .toBe("Starts on bars 9\u201311, the hard passage; the rest in score order.")

    // worth a look alone: nothing is pulled, and neither line claims one is
    let readFirst = await describeOrder(1, "read through")
    expect(readFirst).toContain("None of this piece's passages is flagged hard")
    expect(readFirst).toContain("read through once")
    expect(readFirst).not.toContain("bars 9\u201311")

    let hardestFirst = await describeOrder(1, "hardest first")
    expect(hardestFirst).toContain("starts at the beginning")
    expect(hardestFirst).not.toContain("bars 9\u201311")

    expect(await describeOrder(1, "in score order"))
      .toBe("New bars arrive in score order, flagged passages included.")

    flushSync(() => r.unmount())
    div.remove()
  })

  it("fits a narrow rail column without horizontal overflow (the programme plate)", async function() {
    // a piece in the programme with a flag in force, so the Order row and
    // its description line show too
    let piece = await drillPiece(workhorseScore(), {practice: "programme"})
    await store.putAnnotation({
      pieceId: piece.id, fingerprint: {bars: []}, decisions: [], runs: {},
      proposals: [{
        id: "score:9-11:order-test", source: "score", start: 9, end: 11, startIndex: 9, endIndex: 11,
        hand: "both", level: 3, kinds: ["density"], title: "Test passage",
        reason: "test", reasons: ["test"], tip: "test",
      }],
    })

    let generator = {
      summary: () => ({due: 2, dueMinutes: 4, newMeasures: 3, toRead: 5, targetMinutes: 20, learned: 4, measures: 16}),
    }

    let overflowing = el => [...el.querySelectorAll('[class*="plate"]')]
      .filter(plateEl => plateEl.scrollWidth > plateEl.clientWidth + 1)

    for (let width of [260, 340]) {
      let div = document.createElement("div")
      div.style.width = `${width}px`
      document.body.appendChild(div)
      let r = createRoot(div)
      flushSync(() => r.render(React.createElement(ProgrammePlate, {
        generator, settings: {piece: piece.id, hand: "both hands", practice: "programme"},
        setSettings: () => {}, store,
      })))

      let labels = [...div.querySelectorAll("button")].map(b => b.textContent.trim())
      expect(labels).toContain("Read through")
      expect(labels).toContain("Hardest first")
      expect(labels).toContain("In score order")
      expect(div.textContent).toContain("To read through")

      expect(overflowing(div)).toEqual([])

      flushSync(() => r.unmount())
      div.remove()
    }
  })

  describe("the review pane", function() {
    // renders PassagesPlate directly (the narrow-rail test's pattern),
    // with setSettings wired to re-render with the merged settings, the
    // same way the real page's state update does
    let mountPlate = (piece, extra={}) => {
      container = document.createElement("div")
      container.style.width = "1100px"
      document.body.appendChild(container)
      root = createRoot(container)

      let renderWith = settings => flushSync(() => root.render(React.createElement(PassagesPlate, {
        settings,
        setSettings: next => renderWith({...settings, ...next}),
        store,
        ...extra,
      })))
      renderWith({piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice"})
      flushSync(() => {})
      return container
    }

    let reviewPane = () => container.querySelector('aside[aria-label="Review the passages"]')

    let openReview = () => {
      let button = [...plate().querySelectorAll("button")].find(b => b.textContent.trim() == "Review")
      flushSync(() => button.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    }

    let clickButton = (root, label) => {
      let button = [...root.querySelectorAll("button")].find(b => b.textContent.trim() == label)
      flushSync(() => button.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    }

    let changeValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value)
      flushSync(() => input.dispatchEvent(new Event("input", {bubbles: true})))
    }

    it("opens a right pane titled 'Review the passages'; the trainer's staff plate stays mounted; it closes the score pane and the other way round", async function() {
      let xml = workhorseScore()
      let piece = await drillPiece(xml)
      mountPlate(piece, {source: {status: "ready", musicXML: xml}})
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      expect(pane.getAttribute("aria-hidden")).not.toEqual("true")
      expect(plate()).toBeTruthy()

      openScorePane()
      let score = await waitFor(() => scorePane(), {message: "the score pane"})
      expect(score.getAttribute("aria-hidden")).not.toEqual("true")
      expect(reviewPane().getAttribute("aria-hidden")).toEqual("true")

      openReview()
      await waitFor(() => reviewPane().getAttribute("aria-hidden") != "true", {message: "the review pane again"})
      expect(scorePane().getAttribute("aria-hidden")).toEqual("true")
    })

    it("accept, dismiss and restore update the tally; the plate stays up with Review when every flag is dismissed", async function() {
      let piece = await drillPiece(workhorseScore())
      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      expect(pane.textContent).toContain("Waiting for you")

      clickButton(pane, "Accept")
      await waitFor(() => reviewPane().textContent.includes("❖ Accepted"), {message: "accepted status"})
      let tally = () => reviewPane().querySelector(`.${reviewStyles.tally}`).textContent
      expect(tally()).toContain("Accepted")

      clickButton(reviewPane(), "Dismiss")
      await waitFor(() => reviewPane().textContent.includes("Restore"), {message: "dismissed"})

      expect(plate()).toBeTruthy()
      expect(plate().textContent).toContain("No passages flagged")
      expect(plate().textContent).toContain("Review")

      clickButton(reviewPane(), "Restore")
      await waitFor(() => plate().textContent.match(/1 passage/), {message: "restored"})
      expect(flagsInForce(store.annotation(piece.id)).length).toEqual(1)
    })

    it("renames a passage; the queue shows the analysis's name, and Use that name restores it", async function() {
      let piece = await drillPiece(workhorseScore())
      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      let originalTitle = plate().querySelector(`.${passagesStyles.flag_sub}`).textContent

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      clickButton(pane, "Edit")

      let nameInput = await waitFor(() => reviewPane().querySelector('input[type="text"]'), {message: "the name field"})
      changeValue(nameInput, "My name for it")
      clickButton(reviewPane(), "Save")

      await waitFor(() =>
        plate().querySelector(`.${passagesStyles.flag_sub}`).textContent == "My name for it",
        {message: "renamed on the rail"})
      expect(reviewPane().textContent).toContain("the analysis called it")

      clickButton(reviewPane(), "Edit")
      clickButton(reviewPane(), "Use that name")
      clickButton(reviewPane(), "Save")

      await waitFor(() =>
        plate().querySelector(`.${passagesStyles.flag_sub}`).textContent == originalTitle,
        {message: "reverted to the analysis's name"})
    })

    it("marks a passage from a strip drag, and Save adds a flag with a Teacher chip", async function() {
      let piece = await drillPiece(workhorseScore())
      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      clickButton(pane, "Add a passage")

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
      expect(plate().textContent).toContain("Teacher")
    })

    it("ticking 'Start this passage hands separately' saves apart; the preview line shows", async function() {
      let piece = await drillPiece(workhorseScore())
      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      clickButton(pane, "Edit")

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
      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      clickButton(pane, "Accept")
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

    it("shows trouble spots and flags them from the rail and the review", async function() {
      let piece = await drillPiece(workhorseScore())
      await recordTroubleBar(piece)

      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})
      expect(plate().textContent).toContain("Your trouble spots")

      clickButton(plate(), "Flag these bars")
      await waitFor(() => flagsInForce(store.annotation(piece.id)).some(flag => flag.sources.includes("player")),
        {message: "the promoted trouble spot"})

      openReview()
      await waitFor(() => reviewPane(), {message: "the review pane"})
      expect(reviewPane().textContent).toContain("Waiting for you")
    })

    it("keeps the trouble spots out of the passages fold, so they stay reachable", async function() {
      let piece = await drillPiece(workhorseScore())
      await recordTroubleBar(piece)

      // the player folded the passages on some other piece: the fold is
      // remembered for every piece, not per piece
      window.localStorage.setItem("st:passages_folded:v1", "1")

      // and every flag of this one is dismissed, so there is no fold toggle
      let record = store.annotation(piece.id)
      await store.updateAnnotation(piece.id, current => withDecisions(current,
        reviewFlags(record).map((flag, idx) =>
          dismissDecision({record, flag, by: "", at: 100 + idx}))))
      expect(flagsInForce(store.annotation(piece.id)).length).toEqual(0)

      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      expect([...plate().querySelectorAll("button")].map(b => b.textContent.trim()))
        .not.toContain("Show the passages")

      // the rail's own list, not the review pane's (which the plate mounts
      // inside itself, open or not)
      let railList = plate().querySelector(`.${passagesStyles.trouble_list}`)
      expect(railList).toBeTruthy()
      expect([...railList.querySelectorAll("button")].map(b => b.textContent.trim()))
        .toContain("Flag these bars")
    })

    it("a queue card shows the player's own evidence for a bar the teacher has already flagged", async function() {
      let piece = await drillPiece(workhorseScore())
      let flag = flagsInForce(store.annotation(piece.id))[0]
      await recordTroubleBar(piece, flag.start)

      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      // the suggestions leave the bar out, since it is flagged already
      expect(plate().textContent).not.toContain("Your trouble spots")

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      let line = await waitFor(() => pane.querySelector(`.${reviewStyles.trouble_line}`),
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

      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      expect(pane.textContent).toContain("Couldn't find these bars in your copy")

      clickButton(pane, "Place it")
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

    it("names the bars a re-anchored flag moved from once, in the review and on the rail", async function() {
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

      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      expect(pane.textContent).toContain("Moved from bars 3–5 in Mme Dupont’s copy")

      // the rail's detail plate, once the moved passage is the one selected
      let row = [...plate().querySelectorAll("li button")].find(b => b.textContent.includes("Bars 2–4"))
      expect(row).toBeTruthy()
      flushSync(() => row.dispatchEvent(new MouseEvent("click", {bubbles: true})))
      let note = await waitFor(() => plate().querySelector(`.${passagesStyles.moved_note}`),
        {message: "the rail's moved note"})
      expect(note.textContent).toEqual("Moved from bars 3–5 in Mme Dupont’s copy")
    })

    it("the review's own writes analyse the piece first, so a decision isn't lost", async function() {
      // a piece in the deck whose analysis hasn't landed: the plate stays up
      // for the player's trouble spot alone
      let xml = workhorseScore()
      let piece = await store.putPiece({
        id: "unanalysed", title: "Workhorse", song: songToJSON(parseMusicXML(xml)), importedAt: Date.now(),
      }, {source: xml})
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
      }))
      await recordTroubleBar(piece)
      expect(store.annotation(piece.id)).toBe(null)

      // the plate's own analysis is still in flight through the store's write
      // queue, so the review's write is the one that has to ensure it
      mountPlate(piece)
      expect(plate()).toBeTruthy()
      openReview()
      clickButton(reviewPane(), "Flag these bars")
      expect(store.annotation(piece.id)).toBe(null)

      let promoted = await waitFor(() =>
        flagsInForce(store.annotation(piece.id)).find(f => f.sources.includes("player")),
        {message: "the promoted trouble spot"})
      expect(promoted.status).toEqual("waiting")
      expect(reviewPane().querySelector(`.${reviewStyles.message}`)).toBe(null)
    })

    it("says so on the rail when a trouble spot can't be flagged", async function() {
      let piece = await drillPiece(workhorseScore())
      await recordTroubleBar(piece)

      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})
      expect(plate().textContent).toContain("Your trouble spots")

      spyOn(store, "updateAnnotation").and.callFake(() => Promise.reject(new Error("the disk is full")))

      clickButton(plate(), "Flag these bars")
      await waitFor(() => plate().querySelector(`.${passagesStyles.trouble_error}`),
        {message: "the error on the rail"})
      expect(plate().querySelector(`.${passagesStyles.trouble_error}`).textContent)
        .toContain("Couldn't save your decision")
      expect(flagsInForce(store.annotation(piece.id)).some(flag => flag.sources.includes("player"))).toBe(false)
    })

    // at the test harness's default (narrower than 900px) viewport, the
    // pane's own width stays under the side-by-side breakpoint, so this
    // also exercises the stacked layout without overflowing it
    it("has no horizontal overflow in the review pane, stacked below 900px of its own width", async function() {
      let piece = await drillPiece(workhorseScore())
      mountPlate(piece)
      await waitFor(() => plate(), {message: "the plate"})

      openReview()
      let pane = await waitFor(() => reviewPane(), {message: "the review pane"})
      await waitFor(() => pane.querySelector(`.${reviewStyles.columns}`), {message: "the columns"})

      expect(pane.querySelector(`.${reviewStyles.columns}`).className).not.toContain(reviewStyles.side_by_side)

      let overflowing = el => [...el.querySelectorAll('[class*="plate"]')]
        .filter(plateEl => plateEl.scrollWidth > plateEl.clientWidth + 1)
      expect(overflowing(pane)).toEqual([])
    })
  })
})
