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

  describe("difficulty tags and the passage pane", function() {
    // the real analysis has already run and stamped its own fingerprint by
    // the time a bar button is drawn; overriding only its proposals (not
    // the fingerprint) keeps ensureAnnotation from recomputing it away
    let flagPiece = async (piece, start, end, level=3) => {
      let record = await waitFor(() => store.annotation(piece.id), {timeout: 10000})
      await store.putAnnotation({
        ...record,
        proposals: [{
          id: `score:${start}-${end}:test`, source: "score", start, end, startIndex: start - 1, endIndex: end - 1,
          hand: "both", level, kinds: ["density"], title: "Test passage",
          reason: "test", reasons: ["test"], tip: "test",
        }],
      })
    }

    let clickShade = (el, name) => {
      let button = [...el.querySelectorAll("button")].find(b => b.textContent.trim() == name)
      flushSync(() => button.click())
    }

    let pane = (el, label) => el.querySelector(`aside[aria-label="${label}"]`)

    it("shows a difficulty tag per flagged passage, opening the passage pane", async function() {
      let piece = await drillPiece(reverieOpening())
      let el = renderScorePage()
      await waitFor(() => barButton(1))
      await flagPiece(piece, 2, 3)

      clickShade(el, "Score difficulty")
      let tag = await waitFor(() => [...el.querySelectorAll("button")].find(b => b.textContent.includes("Hardest")))
      expect(tag.textContent).toContain("bars 2–3")

      expect(pane(el, "Passage detail").getAttribute("aria-hidden")).toEqual("true")
      flushSync(() => tag.click())
      expect(pane(el, "Passage detail").getAttribute("aria-hidden")).toEqual("false")
      expect(el.textContent).toContain("Passage I of I")
    })

    it("Practise in the passage pane sets free practice on it and begins at once", async function() {
      let piece = await drillPiece(reverieOpening())
      let el = renderScorePage()
      await waitFor(() => barButton(1))
      await flagPiece(piece, 2, 3)

      clickShade(el, "Score difficulty")
      let tag = await waitFor(() => [...el.querySelectorAll("button")].find(b => b.textContent.includes("Hardest")))
      flushSync(() => tag.click())

      let practise = [...pane(el, "Passage detail").querySelectorAll("button")]
        .find(b => b.textContent.trim() == "Practise bars 2–3")
      flushSync(() => practise.click())

      expect(page.state.currentGeneratorSettings.startMeasure).toEqual(2)
      expect(page.state.currentGeneratorSettings.endMeasure).toEqual(3)
      expect(page.state.view).toEqual("session")
      expect(page.state.session).toBe(true)
    })

    it("opens the review pane from the difficulty legend's Review the passages link", async function() {
      let piece = await drillPiece(reverieOpening())
      let el = renderScorePage()
      await waitFor(() => barButton(1))
      await flagPiece(piece, 2, 3)

      clickShade(el, "Score difficulty")
      let link = await waitFor(() =>
        [...el.querySelectorAll("button, a")].find(b => b.textContent.trim() == "Review the passages"))

      expect(pane(el, "Review the passages").getAttribute("aria-hidden")).toEqual("true")
      flushSync(() => link.click())
      expect(pane(el, "Review the passages").getAttribute("aria-hidden")).toEqual("false")
    })

    it("marks the section in free practice outside the difficulty shade, never inside it", async function() {
      await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 3})
      let el = renderScorePage()
      await waitFor(() => barButton(1))

      expect(el.textContent).toContain("Section · bars 2–3")

      clickShade(el, "Score difficulty")
      expect(el.textContent).not.toContain("Section · bars 2–3")
    })

    it("keeps a selected bar's own tint over the shade's fill", async function() {
      let piece = await drillPiece(reverieOpening())
      let id = `${piece.id}:both:2-2`
      await store.recordAttempt({
        item: {
          id, pieceId: piece.id, hand: "both", startMeasure: 2, endMeasure: 2,
          level: "bar", state: "tracked", step: 0, reps: 1, lapses: 0, streak: 0, lastGrade: 3,
          hits: 4, misses: 0, attempts: 1, lastPracticed: Date.now(), elapsedMs: 2000, algo: 1,
          createdAt: Date.now(), recent: [[Date.now(), 4, 4, 3]],
        },
        review: {
          itemId: id, pieceId: piece.id, at: Date.now(), kind: "attempt", grade: 3, was: "new",
          columns: 4, clean: 4, misses: 0, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 1,
        },
      })

      let el = renderScorePage()
      let button = await waitFor(() => barButton(2))
      flushSync(() => button.click())

      expect(button.getAttribute("aria-pressed")).toEqual("true")
      // the learnedness fill would otherwise win as an inline style, hiding
      // the CSS rule's selected tint and border behind it
      expect(button.style.background).toBeFalsy()
    })
  })
})
