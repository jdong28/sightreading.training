import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage, {SCORE_PROGRAMME} from "st/components/pages/score_page"
import {SCORE_VIEW_NO_SOURCE, SCORE_VIEW_FAILED} from "st/components/sight_reading/score_view"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS} from "st/data"

import {openTestStore, reverieOpening} from "spec/helpers"

describe("ScoreView (the score-first page's at-rest view)", function() {
  let container, root, page, store, previousStore, savedStorage
  const STORAGE_KEYS = [SHEET_MUSIC_STORAGE_KEY]

  beforeEach(async function() {
    savedStorage = STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of STORAGE_KEYS) { window.localStorage.removeItem(key) }

    store = await openTestStore()
    previousStore = setAppStore(store)
  })

  afterEach(async function() {
    if (root) {
      flushSync(() => root.unmount())
      root = null
    }
    if (container) {
      container.remove()
      container = null
    }

    setAppStore(previousStore)
    await store.close()

    for (let [key, value] of savedStorage) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let renderScorePage = (props = {}, width = 1440) => {
    container = document.createElement("div")
    container.style.width = `${width}px`
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {
          ref: p => page = p, programme: SCORE_PROGRAMME, viewportHeight: 1240, ...props,
        })))
    })
    flushSync(() => {})
    return container
  }

  let drillPiece = async (xml, settings = {}) => {
    let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: "all", practice: "free practice", ...settings,
    }))
    return piece
  }

  let popup = () => container.querySelector("[role=dialog]")
  let barButton = number => container.querySelector(`button[aria-label="Bar ${number}"]`)
  let waitFor = async (fn, {timeout = 2000, step = 10} = {}) => {
    let elapsed = 0
    while (!fn() && elapsed < timeout) {
      await new Promise(resolve => setTimeout(resolve, step))
      elapsed += step
    }
    return fn()
  }

  it("opens on the score view with the setup pane, no piece picked", function() {
    let el = renderScorePage()
    expect(el.querySelector("[data-score-view]")).not.toBe(null)
    expect(el.textContent).toContain("Tonight's")
    expect(el.textContent).toContain("At rest")
    expect(el.textContent).toContain("import a piece to begin")
    expect(el.querySelector("[data-score-card]")).toBe(null)
    expect(el.querySelector('button[aria-label="Programme"]')).toBe(null)
  })

  it("titles the view with the piece and 'the score', and shows the eyebrow's bar count", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage()
    await waitFor(() => barButton(1))

    expect(el.querySelector("h1").textContent).toContain("Rêverie")
    expect(el.querySelector("h1").textContent).toContain("the score")
    expect(el.textContent).toContain("4 bars")
  })

  it("clicking a bar opens its pop-up; the close button dismisses it", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage()

    expect(popup()).toBe(null)

    let button = await waitFor(() => barButton(2))
    expect(button).toBeTruthy()
    flushSync(() => button.click())

    expect(popup()).not.toBe(null)
    expect(popup().getAttribute("aria-label")).toEqual("Bar 2 stats")
    expect(popup().textContent).toContain("No practice recorded for bar 2 yet.")

    flushSync(() => el.querySelector('button[aria-label="Close bar stats"]').click())
    expect(popup()).toBe(null)
  })

  it("moves the pop-up to another bar on a second click", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage()
    await waitFor(() => barButton(2))

    flushSync(() => barButton(2).click())
    expect(popup().getAttribute("aria-label")).toEqual("Bar 2 stats")

    flushSync(() => barButton(3).click())
    expect(popup().getAttribute("aria-label")).toEqual("Bar 3 stats")
    expect(el.querySelectorAll("[role=dialog]").length).toEqual(1)
  })

  it("Practise bar sets free practice on that bar alone and begins the session", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    renderScorePage()
    await waitFor(() => barButton(2))

    flushSync(() => barButton(2).click())
    let practise = [...container.querySelectorAll("button")].find(b => b.textContent.trim() == "Practise bar 2")
    flushSync(() => practise.click())

    expect(page.state.currentGeneratorSettings.startMeasure).toEqual(2)
    expect(page.state.currentGeneratorSettings.endMeasure).toEqual(2)
    expect(page.state.view).toEqual("session")
    expect(page.state.session).toBe(true)
  })

  it("switches the Shade pills, with This session absent before a session has ended", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage()
    await waitFor(() => barButton(1))

    let shadeButtons = () => [...el.querySelectorAll("button")].filter(b =>
      ["This session", "Learnedness", "Score difficulty", "Off"].includes(b.textContent.trim()))

    expect(shadeButtons().map(b => b.textContent.trim())).toEqual(["Learnedness", "Score difficulty", "Off"])

    let difficulty = shadeButtons().find(b => b.textContent.trim() == "Score difficulty")
    flushSync(() => difficulty.click())
    expect(el.textContent).toContain("Easier")
  })

  it("shows a bar grid, not the engraved score, for a piece without a stored source", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage({readSource: () => Promise.resolve(null)})

    await waitFor(() => el.textContent.includes(SCORE_VIEW_NO_SOURCE))
    expect(el.textContent).toContain(SCORE_VIEW_NO_SOURCE)
    expect(barButton(2)).toBeTruthy()
  })

  it("shows the same grid note when the engine fails to draw the score", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage({loadEngines: () => Promise.reject(new Error("offline"))})

    await waitFor(() => el.textContent.includes(SCORE_VIEW_FAILED))
    expect(el.textContent).toContain(SCORE_VIEW_FAILED)
  })

  it("has no horizontal overflow at 390px wide", async function() {
    await drillPiece(reverieOpening())
    let el = renderScorePage({}, 390)
    await waitFor(() => barButton(1))
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1)
  })
})
