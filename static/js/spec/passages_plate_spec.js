import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {importMusicXMLPiece, songToJSON} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"

import {openTestStore, pianoScore} from "spec/helpers"

// a piece with a dense run of sixteenths at bars 9-11, long enough for
// st/difficulty to flag passages
function workhorseScore({barCount=16}={}) {
  let quiet = {upper: ["C4", "D4", "E4", "F4"], lower: ["C3", "D3", "E3", "F3"]}
  let dense = {
    upper: ["C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4", "C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4"],
    lower: ["C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3", "C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3"],
  }
  let bars = Array.from({length: barCount}, (_, i) => i >= 8 && i <= 10 ?
    {upper: dense.upper.map(name => ({name, duration: 0.25, type: "16th"})),
      lower: dense.lower.map(name => ({name, duration: 0.25, type: "16th"}))} :
    {upper: quiet.upper.map(name => ({name})), lower: quiet.lower.map(name => ({name}))})
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
    await drillPiece(workhorseScore())
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate"})

    let brackets = [...plate().querySelectorAll("button[aria-label^='Passage']")]
    expect(brackets.length).toBeGreaterThan(0)

    let rows = [...plate().querySelectorAll("li button")].filter(b => /–/.test(b.textContent))
    expect(rows.length).toBeGreaterThan(0)
    let other = rows.find(b => !b.closest("li").className.includes("on"))
    if (other) {
      flushSync(() => other.dispatchEvent(new MouseEvent("click", {bubbles: true})))
      expect(other.closest("li").className).toContain("on")
    }
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
    let song = parseMusicXML(workhorseScore())
    let piece = await store.putPiece({id: "old", title: "Workhorse", importedAt: 1000, song: songToJSON(song)})
    expect(store.annotation(piece.id)).toBe(null)

    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: "both hands", measuresPerCard: "all", practice: "free practice",
    }))
    renderScorePage()
    await waitFor(() => plate(), {message: "the passages plate, once analysed on open"})
  })

  it("shows nothing for a piece without passages", async function() {
    await drillPiece(pianoScore({bars: [{upper: [{name: "C4"}]}]}))
    renderScorePage()
    await waitFor(() => container.querySelector("[data-score-card]"), {message: "the page to settle"})
    expect(plate()).toBe(null)
  })
})
