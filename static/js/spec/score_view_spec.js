import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {MISSING_ENGINE_SOURCE, FAILED_ENGINE_SOURCE} from "st/components/sight_reading/score_view"
import scoreViewStyles from "st/components/sight_reading/score_view.module.css"
import scoreSheetStyles from "st/components/score_sheet.module.css"
import sessionRailStyles from "st/components/sight_reading/session_rail.module.css"
import reviewStyles from "st/components/sight_reading/review_pane.module.css"
import {importMusicXMLPiece, addPiece} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {GOOD} from "st/srs/grade"
import {SELF_GRADE_DWELL_MS, SELF_GRADE_FLASH_MS} from "st/srs/self_grade"
import {openTestStore} from "spec/helpers"

// captured before any spec installs jasmine's mock clock, so waits still
// run in real time under it (see the acoustic mode describe below)
const realSetTimeout = window.setTimeout.bind(window)
const realNow = Date.now.bind(Date)

describe("score view (the score-first page at rest)", function() {
  let container, root, page, store, previousStore, savedStorage, fixtureXML
  const STORAGE_KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

  beforeAll(async function() {
    let response = await fetch("/tools/fingerings/tests/fixture/score.musicxml")
    fixtureXML = await response.text()
  })

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

    setAppStore(previousStore)
    store.close()

    for (let [key, value] of savedStorage) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  // the score-first page, at a 1440-wide container (the artboards' size);
  // viewportHeight is given directly, as a spec would, in place of window's
  let renderScorePage = (props={}, width=1440) => {
    container = document.createElement("div")
    container.style.width = `${width}px`
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240, ...props})))
    })
    flushSync(() => {})
    return container
  }

  // imports the fixture ("Fixture", 16 bars, grand staff, C major, one
  // flagged passage bars 5-9, see tools/fingerings/tests/fixture/score.
  // musicxml) and stores the sheet music settings it is drilled under
  let importFixture = async (settings={}) => {
    let {piece} = await importMusicXMLPiece("score.musicxml", fixtureXML, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS, ...settings,
    }))
    return piece
  }

  let waitFor = async (test, message="the condition") => {
    let start = realNow()
    for (;;) {
      let value = test()
      if (value) { return value }
      if (realNow() - start > 15000) { throw new Error(`Timed out waiting for ${message}`) }
      await new Promise(resolve => realSetTimeout(resolve, 20))
    }
  }

  let click = el => flushSync(() => el.click())
  let buttonNamed = (el, text) => [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)
  let buttonLabelled = (el, label) => el.querySelector(`button[aria-label="${label}"]`)
  let setupPane = el => el.querySelector("[data-setup-pane]")
  let sessionRail = el => el.querySelector(`.${sessionRailStyles.session_rail}`)
  let scorePlate = el => el.querySelector(`.${scoreViewStyles.score_plate}`)
  let barButtons = el => [...el.querySelectorAll('button[aria-label^="Bar "]')]
  let pageLabel = el => el.querySelector(`.${scoreViewStyles.page_label}`).textContent
  let pagerLabel = el => el.querySelector(`.${scoreViewStyles.pager_label}`).textContent
  let shadePill = (el, label) => {
    let group = el.querySelector('[role="group"][aria-label="Shade bars by"]')
    return [...group.querySelectorAll("button")].find(b => b.textContent.trim() == label)
  }
  let dialog = el => el.querySelector('[role="dialog"]')
  let statValue = (el, label) => {
    let labelEl = [...el.querySelectorAll("div")].find(div => div.children.length == 0 && div.textContent == label)
    return labelEl.nextElementSibling.textContent
  }

  let awaitEngraved = async el => {
    await waitFor(() => scorePlate(el), "the score plate")
    await waitFor(() => barButtons(el).length > 0, "the engraved bars")
  }

  // presses columns of the current card one at a time until the generator
  // reports the pass finishing (see AGENTS.md's measure_cards bullet),
  // never assuming how many columns the real fixture's bar has
  let playWholeCard = async () => {
    for (let i = 0; i < 50; i++) {
      let column = page.state.notes.currentColumn()
      if (!column || !column.length) { break }
      for (let note of column) { flushSync(() => page.pressNote(note)) }
      if (page.state.notes.generator.finishing) { break }
    }
    await page.state.notes.generator.finishing
  }

  describe("at mount", function() {
    it("shows the score at rest, paginated, with no engine card and no Programme pill", async function() {
      await importFixture()
      // a shorter viewport than the artboards' 1240, whose budget leaves
      // room for only the fixture's first two systems (bars 1-10)
      let el = renderScorePage({viewportHeight: 900})
      await awaitEngraved(el)

      expect(el.querySelector("[data-score-card]")).toBe(null)
      expect(buttonLabelled(el, "Programme")).toBe(null)

      let pane = setupPane(el)
      expect(pane).not.toBe(null)
      expect(pane.textContent).toContain("Tonight's")
      expect(pane.textContent).toContain("At rest")

      let h1 = el.querySelector("h1")
      expect(h1.textContent).toContain("Fixture")
      expect(h1.textContent).toContain("the score")

      expect(pageLabel(el)).toEqual("Page 1 of 2 · bars 1–10")
      expect(barButtons(el).length).toEqual(10)

      expect(buttonNamed(el, "‹ Previous page").disabled).toBe(true)
      expect(pagerLabel(el)).toEqual("Page 1 of 2 · bars 1–10")

      click(buttonNamed(el, "Next page ›"))
      expect(pagerLabel(el)).toEqual("Page 2 of 2 · bars 11–16")
      expect(barButtons(el).length).toEqual(6)
    })
  })

  describe("shade pills", function() {
    it("switches the tint and legend with the shade", async function() {
      await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      expect(shadePill(el, "This session")).toBeUndefined()
      expect(el.querySelector(`.${scoreViewStyles.legend}`).textContent).toContain("Not played yet")

      click(shadePill(el, "Score difficulty"))
      expect(el.querySelector(`.${scoreViewStyles.legend}`).textContent).toContain("Review the passages")

      click(shadePill(el, "Off"))
      expect(el.querySelector(`.${scoreViewStyles.legend}`)).toBe(null)

      click(shadePill(el, "Learnedness"))
      expect(el.querySelector(`.${scoreViewStyles.legend}`).textContent).toContain("Learned, 3 in a row at 100%")
    })
  })

  describe("the bar pop-up", function() {
    it("opens a clicked bar's stats, closes on Escape and ×, and Practise begins free practice on it", async function() {
      let piece = await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      click(shadePill(el, "Score difficulty"))
      click(buttonLabelled(el, "Bar 5"))

      let dlg = dialog(el)
      expect(dlg.getAttribute("aria-label")).toEqual("Bar 5 stats")
      expect(dlg.textContent).toContain("Passage I · Hardest")

      flushSync(() => document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})))
      expect(dialog(el)).toBe(null)

      click(buttonLabelled(el, "Bar 5"))
      click(buttonLabelled(el, "Close bar stats"))
      expect(dialog(el)).toBe(null)

      click(buttonLabelled(el, "Bar 5"))
      click(buttonNamed(el, "Practise bar 5"))

      expect(dialog(el)).toBe(null)
      expect(sessionRail(el)).not.toBe(null)
      expect(setupPane(el)).toBe(null)
      expect(el.textContent).toContain("measure 5")

      let settings = JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY))
      expect([settings.startMeasure, settings.endMeasure, settings.measuresPerCard]).toEqual([5, 5, "all"])
      expect(settings.piece).toEqual(piece.id)
    })
  })

  describe("Begin, Rest, Resume, End session and Play on", function() {
    it("Begin opens the session view; Rest pauses it; Resume continues it", async function() {
      await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      click(buttonNamed(el, "Begin"))
      expect(el.querySelector("[data-score-card]")).not.toBe(null)
      expect(setupPane(el)).toBe(null)
      expect(sessionRail(el)).not.toBe(null)
      expect(el.textContent).toContain("This session")

      let eyebrow = [...el.querySelectorAll("div")].find(div => div.textContent == "In session · Fixture")
      expect(eyebrow).toBeDefined()

      let statsId = page.state.stats.id

      click(buttonNamed(el, "Rest"))
      expect(el.textContent).toContain("At rest. The clock is stopped")
      expect(dialog(el)).toBe(null)
      expect(page.state.stats.id).toEqual(statsId)

      click(buttonNamed(el, "Resume"))
      expect(el.textContent).not.toContain("At rest. The clock is stopped")
      expect(page.state.stats.id).toEqual(statsId)
    })

    it("End session, running or paused, shows the strip with bar marks and the session shade; Done returns to Learnedness", async function() {
      await importFixture({startMeasure: 1, endMeasure: 1, measuresPerCard: "all"})
      let el = renderScorePage()
      await awaitEngraved(el)

      click(buttonNamed(el, "Begin"))
      await playWholeCard()
      let accuracy = String(parseInt(statValue(el, "Accuracy"), 10))

      click(buttonNamed(el, "End session"))

      await waitFor(() => el.querySelector(`.${scoreViewStyles.ended_strip}`), "the ended strip")
      let strip = el.querySelector(`.${scoreViewStyles.ended_strip}`)
      expect(strip.textContent).toContain(accuracy)
      expect(shadePill(el, "This session").getAttribute("aria-pressed")).toEqual("true")

      click(buttonNamed(el, "Done"))
      expect(el.querySelector(`.${scoreViewStyles.ended_strip}`)).toBe(null)
      expect(shadePill(el, "Learnedness").getAttribute("aria-pressed")).toEqual("true")
    })

    it("Play on dismisses the strip and resumes the same session", async function() {
      await importFixture({startMeasure: 1, endMeasure: 1, measuresPerCard: "all"})
      let el = renderScorePage()
      await awaitEngraved(el)

      click(buttonNamed(el, "Begin"))
      let statsId = page.state.stats.id
      await playWholeCard()

      click(buttonNamed(el, "End session"))
      await waitFor(() => el.querySelector(`.${scoreViewStyles.ended_strip}`), "the ended strip")

      click(buttonNamed(el, "Play on"))
      expect(el.querySelector("[data-score-card]")).not.toBe(null)
      expect(page.state.stats.id).toEqual(statsId)
    })

    it("End session with nothing played shows no strip", async function() {
      await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      click(buttonNamed(el, "Begin"))
      click(buttonNamed(el, "End session"))

      expect(el.querySelector(`.${scoreViewStyles.ended_strip}`)).toBe(null)
    })
  })

  describe("learnedness", function() {
    it("marks a bar Learned on the score after three clean passes in a row", async function() {
      let piece = await importFixture({startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS})
      await store.putStudy({pieceId: piece.id, status: "learning", startedAt: Date.now()})

      let at = Date.now() - 1000
      let id = `${piece.id}:both:1-1`
      await store.recordAttempt({
        item: {
          id, pieceId: piece.id, hand: "both", startMeasure: 1, endMeasure: 1,
          level: "bar", state: "learning", step: 0, due: at, last: at, s: 1, d: 5,
          reps: 3, lapses: 0, streak: 3, lastGrade: GOOD, hits: 12, misses: 0, attempts: 3,
          lastPracticed: at, algo: 1, createdAt: at - 1000,
          recent: [0, 1, 2].map(n => [at - n * 1000, 4, 4, GOOD]),
          passes: [0, 1, 2].map(n => [at - n * 1000, 4, 4, GOOD]),
        },
        review: {
          itemId: id, pieceId: piece.id, at, kind: "attempt", grade: GOOD, was: "learning",
          columns: 4, clean: 4, misses: 0, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 1,
        },
      })

      let el = renderScorePage()
      await awaitEngraved(el)

      await waitFor(() => [...el.querySelectorAll(`.${scoreSheetStyles.bar_label}`)]
        .some(label => label.textContent == "Learned"), "bar 1 learned")

      let figureLabel = [...setupPane(el).querySelectorAll("div")]
        .find(div => div.children.length == 0 && div.textContent == "Learned")
      expect(figureLabel.nextElementSibling.textContent).toEqual("1 /16")
    })
  })

  describe("acoustic mode", function() {
    let tick = ms => flushSync(() => jasmine.clock().tick(ms))
    let played = (ms=SELF_GRADE_DWELL_MS) => tick(ms)
    let flash = () => tick(SELF_GRADE_FLASH_MS)
    let buttonLike = (el, text) => [...el.querySelectorAll("button")].find(b => b.textContent.includes(text))

    beforeEach(function() {
      jasmine.clock().install()
      jasmine.clock().mockDate(new Date(2026, 8, 14, 20))
    })

    afterEach(function() {
      jasmine.clock().uninstall()
    })

    it("shows the acoustic note in Tempo, and grading Clean three times marks the bar Learned", async function() {
      await importFixture({startMeasure: 1, endMeasure: 1, measuresPerCard: "all"})
      let el = renderScorePage({acoustic: true})
      await awaitEngraved(el)

      expect(setupPane(el).textContent).toContain("Acoustic piano: each card waits for your grade")

      click(buttonNamed(el, "Begin"))
      for (let i = 0; i < 3; i++) {
        played()
        click(buttonLike(el, "Clean"))
        flash()
        await page.state.notes.generator.finishing
      }

      click(buttonNamed(el, "End session"))
      await waitFor(() => el.querySelector(`.${scoreViewStyles.ended_strip}`), "the ended strip")

      let label = await waitFor(() => [...el.querySelectorAll(`.${scoreSheetStyles.bar_label}`)]
        .find(l => l.textContent.includes("clean")), "the session mark")
      expect(label.textContent).toEqual("3 of 3 clean")

      click(buttonNamed(el, "Done"))
      let learned = await waitFor(() => [...el.querySelectorAll(`.${scoreSheetStyles.bar_label}`)]
        .find(l => l.textContent == "Learned"), "bar 1 learned")
      expect(learned).toBeDefined()
    })
  })

  describe("without an engraved score", function() {
    it("shows the bar grid and a notice for a piece without a stored source", async function() {
      let legacy = parseMusicXML(fixtureXML)
      let {piece} = await addPiece("No Source", legacy, store)
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: piece.id, startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS,
      }))

      let el = renderScorePage()
      await waitFor(() => el.querySelector(`.${scoreViewStyles.fallback_note}`), "the fallback note")
      expect(el.querySelector(`.${scoreViewStyles.grid_plate}`)).not.toBe(null)
      expect(el.querySelector(`.${scoreViewStyles.fallback_note}`).textContent).toEqual(MISSING_ENGINE_SOURCE)
    })

    it("shows the bar grid and a notice when the engine fails to load", async function() {
      await importFixture()
      let el = renderScorePage({loadEngines: () => Promise.reject(new Error("boom"))})

      await waitFor(() => el.querySelector(`.${scoreViewStyles.fallback_note}`), "the fallback note")
      expect(el.querySelector(`.${scoreViewStyles.grid_plate}`)).not.toBe(null)
      expect(el.querySelector(`.${scoreViewStyles.fallback_note}`).textContent).toEqual(FAILED_ENGINE_SOURCE)
    })
  })

  it("has no horizontal overflow at 390px wide", async function() {
    await importFixture()
    let el = renderScorePage({}, 390)
    await awaitEngraved(el)

    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth + 1)
  })

  describe("the review pane", function() {
    // the passage pane embeds its own (always-closed, until its own Edit
    // is clicked) ReviewPane too, so "Review the passages" is ambiguous:
    // find the instance that is actually open
    let openReviewPane = el => [...el.querySelectorAll('aside[aria-label="Review the passages"]')]
      .find(aside => aside.getAttribute("aria-hidden") != "true")

    let openReview = el => {
      click(shadePill(el, "Score difficulty"))
      click(buttonNamed(el, "Review the passages"))
    }

    it("opens from 'Review the passages' and closes on ×", async function() {
      await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      openReview(el)
      let pane = await waitFor(() => openReviewPane(el), "the review pane")
      expect(pane.getAttribute("aria-hidden")).not.toEqual("true")

      click(buttonLabelled(pane, "Close the review"))
      expect(openReviewPane(el)).toBeUndefined()
    })

    it("accept, dismiss and restore update the tally", async function() {
      await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      openReview(el)
      let pane = await waitFor(() => openReviewPane(el), "the review pane")
      await waitFor(() => pane.textContent.includes("Waiting for you"), "the flag queue")

      click(buttonNamed(pane, "Accept"))
      await waitFor(() => pane.textContent.includes("❖ Accepted"), "accepted status")
      expect(pane.querySelector(`.${reviewStyles.tally}`).textContent).toContain("Accepted")

      click(buttonNamed(pane, "Dismiss"))
      await waitFor(() => pane.textContent.includes("Restore"), "dismissed")

      click(buttonNamed(pane, "Restore"))
      await waitFor(() => pane.textContent.includes("Waiting for you"), "restored")
    })

    it("exports a flags file as a download, carrying the name typed in", async function() {
      await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      openReview(el)
      let pane = await waitFor(() => openReviewPane(el), "the review pane")
      await waitFor(() => pane.textContent.includes("Waiting for you"), "the flag queue")
      click(buttonNamed(pane, "Accept"))
      await waitFor(() => pane.textContent.includes("❖ Accepted"), "accepted status")

      let nameInput = [...pane.querySelectorAll('input[type="text"]')]
        .find(input => input.closest(`.${reviewStyles.send_plate}`))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(nameInput, "Ms Laurent")
      flushSync(() => nameInput.dispatchEvent(new Event("input", {bubbles: true})))

      let created = []
      let originalCreate = URL.createObjectURL
      spyOn(URL, "createObjectURL").and.callFake(blob => { created.push(blob); return originalCreate(blob) })
      spyOn(URL, "revokeObjectURL")
      let clicked = null
      spyOn(HTMLAnchorElement.prototype, "click").and.callFake(function() { clicked = this })

      click(buttonNamed(pane, "Export flags file"))
      await waitFor(() => created.length > 0, "the download")

      expect(clicked.download).toContain(".flags.json")
      let text = await created[0].text()
      let data = JSON.parse(text)
      expect(data.format).toEqual("sightreading-flags")
      expect(data.by).toEqual("Ms Laurent")
      expect(data.decisions.length).toBeGreaterThan(0)
    })
  })

  describe("the passage pane", function() {
    it("opens 'Passage I of I' from the difficulty tag; Practise sets free practice on its bars", async function() {
      let piece = await importFixture()
      let el = renderScorePage()
      await awaitEngraved(el)

      click(shadePill(el, "Score difficulty"))
      let tag = await waitFor(() => buttonNamed(el, "I · Hardest · bars 5–9"), "the difficulty tag")
      click(tag)

      let pane = await waitFor(() => el.querySelector('aside[aria-label="Passage detail"]'), "the passage pane")
      expect(pane.textContent).toContain("Passage I of I")

      click(buttonNamed(pane, "Practise bars 5–9"))

      expect(el.querySelector('aside[aria-label="Passage detail"]').getAttribute("aria-hidden")).toEqual("true")
      let settings = JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY))
      expect([settings.startMeasure, settings.endMeasure]).toEqual([5, 9])
      expect(settings.piece).toEqual(piece.id)
    })
  })
})
