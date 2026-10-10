import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route, useLocation} from "react-router-dom"

import PracticeRecordPage from "st/components/pages/practice_record_page"
import StatsPage, {statsPageFor} from "st/components/pages/stats"
import ScorePage, {SCORE_PROGRAMME} from "st/components/pages/score_page"
import styles from "st/components/pages/today_page.module.css"
import salonStyles from "st/components/salon.module.css"
import {setAppStore} from "st/storage"
import {importMusicXMLPiece, pieceSong} from "st/sheet_music_deck"
import {measureBeatRange} from "st/song_sections"
import {SHEET_MUSIC_STORAGE_KEY, FREE_PRACTICE, PROGRAMME_PRACTICE} from "st/data"
import {SCORE_DRILL_STORAGE_KEY, DRILL_STORAGE_KEY} from "st/generators"
import {RANDOM_ORDER} from "st/measure_cards"
import {openTestStore} from "spec/helpers"

// the clock every spec here runs on: Monday 14 September 2026, 8 pm
const NOW = new Date(2026, 8, 14, 20)
const at = (hour, minute=0, day=14) => +new Date(2026, 8, day, hour, minute)

// the real timer: a wait still runs under the mocked clock
const realSetTimeout = window.setTimeout.bind(window)

let waitFor = async (fn, message) => {
  for (let i = 0; i < 300; i++) {
    if (fn()) { return }
    await new Promise(resolve => realSetTimeout(resolve, 10))
  }
  fail(`timed out waiting for ${message}`)
}

describe("the practice record, Today", function() {
  let container, root, store, appStore, piece, saved, page, location
  const KEYS = [SHEET_MUSIC_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY, DRILL_STORAGE_KEY]

  beforeEach(async function() {
    saved = KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of KEYS) { window.localStorage.removeItem(key) }

    store = await openTestStore()
    appStore = setAppStore(store)
    let xml = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    piece = (await importMusicXMLPiece("fixture.musicxml", xml, store)).piece

    // on once the test store is open, which never settles under a mocked clock
    jasmine.clock().install()
    jasmine.clock().mockDate(NOW)
  })

  afterEach(async function() {
    if (root) {
      flushSync(() => root.unmount())
      container.remove()
      root = null
    }
    setAppStore(appStore)
    await store.close()
    jasmine.clock().uninstall()

    for (let [key, value] of saved) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let Probe = () => {
    location = useLocation()
    return null
  }

  let mount = (path="/stats") => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
        React.createElement(Probe),
        React.createElement(Routes, {},
          React.createElement(Route, {path: "/stats/*", element: statsPageFor(null)}),
          React.createElement(Route, {path: "/setup", element: React.createElement("div", {id: "setup"}, "setup")}),
          React.createElement(Route, {path: "/sheet-music", element: React.createElement(ScorePage, {
            ref: p => { page = p },
            programme: {...SCORE_PROGRAMME, engine: null},
          })}),
        )))
    })
    return container
  }

  let statCard = (el, label) =>
    [...el.querySelectorAll(`.${salonStyles.stat_label}`)].find(node => node.textContent == label).closest(`.${salonStyles.card}`)

  // the value text alone, apart from the suffix span beside it
  let statValue = (el, label) => {
    let valueNode = statCard(el, label).querySelector(`.${salonStyles.stat_value}`)
    return [...valueNode.childNodes].filter(node => node.nodeType == Node.TEXT_NODE).map(node => node.textContent).join("")
  }

  let statSuffix = (el, label) => {
    let suffix = statCard(el, label).querySelector(`.${salonStyles.stat_suffix}`)
    return suffix && suffix.textContent
  }

  let click = node => flushSync(() => node.click())
  let button = (el, text) => [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)
  let link = (el, text) => [...el.querySelectorAll("a")].find(a => a.textContent.trim().includes(text))
  let texts = (el, selector) => [...el.querySelectorAll(selector)].map(node => node.textContent)
  let cell = (el, label) => el.querySelector(`button[aria-label="${label}"]`)

  let session = (id, startedAt, fields={}) => ({
    id, startedAt, endedAt: startedAt + 60000, staff: "treble", generator: "random",
    notesRead: 9, misses: 1, bestStreak: 3, elapsedSeconds: 600, notes: {}, settings: {}, ...fields,
  })

  let barStart = measure => measureBeatRange(pieceSong(piece), measure, measure)[0]

  // a bar's detected row for a pass: wrong keys by column index, a column
  // skipped, and a hesitation (which isn't in the %)
  let row = (measure, time, sessionId, {columns=4, wrong=[], skipped=[], hesitated=[]}={}) => {
    let start = barStart(measure)
    let marks = [
      ...wrong.map(idx => [idx, "wrong", [`C${3 + idx % 2}`], ["D4"], 1, null]),
      ...skipped.map(idx => [idx, "skipped", ["G4"], [], 1, null]),
      ...hesitated.map(idx => [idx, "hesitated", ["F4"], [], 0, 1800]),
    ]

    return {
      itemId: `${piece.id}:both:${measure}-${measure}`, at: time, pieceId: piece.id, hand: "both", measure, sessionId,
      mode: "wait", card: [measure, measure], cardGrade: 3, columns, clean: columns - wrong.length - skipped.length, grade: 3,
      reviewed: true,
      beats: Array.from({length: columns}, (_, i) => start + i), gaps: Array.from({length: columns}, (_, i) => i ? 1 : null),
      iois: Array.from({length: columns}, (_, i) => i ? 500 : null), pulse: 500, marks,
    }
  }

  // an evening: an exercise, a free practice of bars 1-8 two a card for three
  // laps, and today's programme taking bars 9 to 11, with yesterday's session
  // to compare with
  let seedFullDay = async () => {
    await store.putSession(session("y1", at(18, 0, 13), {notesRead: 80, misses: 20, elapsedSeconds: 300}))
    await store.putSession(session("e1", at(18), {notesRead: 91, misses: 9, elapsedSeconds: 600}))
    await store.putSession(session("s2", at(18, 30), {
      generator: "sheet music", staff: "grand", notesRead: 74, misses: 26, elapsedSeconds: 900,
      settings: {piece: piece.id, pieceTitle: "Fixture", practice: FREE_PRACTICE, startMeasure: 1, endMeasure: 8, measuresPerCard: 2},
    }))
    await store.putSession(session("s3", at(19, 30), {
      generator: "sheet music", staff: "grand", notesRead: 90, misses: 10, elapsedSeconds: 540,
      settings: {piece: piece.id, pieceTitle: "Fixture", practice: PROGRAMME_PRACTICE},
    }))

    let rows = []
    for (let lap = 0; lap < 3; lap++) {
      for (let card = 0; card < 4; card++) {
        let time = at(18, 31 + lap * 4 + card)
        for (let measure of [2 * card + 1, 2 * card + 2]) {
          rows.push(row(measure, time, "s2", {
            wrong: measure == 3 ? [1] : measure == 6 && lap == 0 ? [0] : [],
            hesitated: measure == 6 && lap == 1 ? [3] : [],
          }))
        }
      }
    }
    rows.push(row(9, at(19, 31), "s3", {columns: 7, wrong: [2], skipped: [4]}))
    rows.push(row(10, at(19, 32), "s3"), row(11, at(19, 33), "s3"))
    for (let r of rows) { await store.recordBarLog([r]) }

    // bar 1 learned today, and the left hand's bar 6
    for (let minute of [31, 35, 39]) {
      await store.recordSectionPractice({pieceId: piece.id, startMeasure: 1, endMeasure: 1, hits: 4, misses: 0, at: at(18, minute), pass: [4, 4, 3]})
      await store.recordSectionPractice({pieceId: piece.id, hand: "lower", startMeasure: 6, endMeasure: 6, hits: 4, misses: 0, at: at(18, minute), pass: [4, 4, 3]})
    }
  }

  let loaded = el => waitFor(() => el.querySelector(`.${styles.bars}`), "the day's bars")

  it("opens the tabs on Today, Last 14 days beside it showing the Progress screen unchanged", async function() {
    let el = mount()

    let nav = el.querySelector('nav[aria-label="Practice record"]')
    let tabs = [...nav.querySelectorAll("a")]
    expect(tabs.map(a => a.textContent)).toEqual(["Today", "For my lesson", "Last 14 days"])
    expect(tabs.map(a => a.getAttribute("href"))).toEqual(["/stats", "/stats/for-my-lesson", "/stats/last-14-days"])
    expect(tabs.map(a => a.getAttribute("aria-current"))).toEqual(["page", null, null])
    expect(el.querySelector("h1").textContent).toEqual("Today, Monday 14 September")

    click(tabs[2])
    expect(location.pathname).toEqual("/stats/last-14-days")
    expect(el.querySelector("h1").textContent).toEqual("Your progress")
    expect(statCard(el, "Evenings kept")).not.toBe(null)
    expect([...el.querySelectorAll("nav[aria-label='Practice record'] a")].map(a => a.getAttribute("aria-current")))
      .toEqual([null, null, "page"])

    click(link(el, "Today"))
    expect(location.pathname).toEqual("/stats")
    expect(el.querySelector("h1").textContent).toEqual("Today, Monday 14 September")
  })

  it("sends a path under /stats it doesn't know back to Today", async function() {
    let el = mount("/stats/nowhere")
    await waitFor(() => location.pathname == "/stats", "the redirect")
    expect(el.querySelector("h1").textContent).toContain("Today,")
  })

  it("says what it fills in with, at first use, and takes the player to the setup", async function() {
    let el = mount()
    await waitFor(() => el.textContent.includes("fills in as you play"), "the first use words")

    expect(el.textContent).toContain("Each session you end appears here, with the bars you played and what went wrong in them.")
    expect(el.querySelector(`.${salonStyles.card}`)).toBe(null)

    click(link(el, "Take your seat"))
    expect(location.pathname).toEqual("/setup")
  })

  it("says the bench is waiting, with yesterday's evening, when nothing is played today", async function() {
    await store.putSession(session("y1", at(18, 0, 13), {
      generator: "sheet music", staff: "grand", notesRead: 90, misses: 10, elapsedSeconds: 300,
      settings: {piece: piece.id, pieceTitle: "Fixture", practice: FREE_PRACTICE},
    }))
    let el = mount()
    await waitFor(() => el.textContent.includes("waiting"), "the empty day")

    expect(el.textContent).toContain("The bench is waiting")
    expect(el.textContent).toContain("Nothing played yet today.")
    expect(el.textContent).toContain("Yesterday: 5 minutes, Fixture, 90%.")
    expect(el.querySelector(`.${salonStyles.card}`)).toBe(null)

    click(link(el, "Tonight's programme"))
    expect(location.pathname).toEqual("/setup")
  })

  it("says when it was last at the bench, when yesterday was missed", async function() {
    await store.putSession(session("old", at(18, 0, 11)))
    let el = mount()
    await waitFor(() => el.textContent.includes("waiting"), "the empty day")
    expect(el.textContent).toContain("Last at the bench 3 days ago.")
  })

  describe("a full day", function() {
    beforeEach(seedFullDay)

    it("shows the four cards", async function() {
      let el = mount()
      await loaded(el)

      expect(statValue(el, "Minutes")).toEqual("34")
      expect(statSuffix(el, "Minutes")).toEqual("of 10")
      let track = statCard(el, "Minutes").querySelector('[role="img"]')
      expect(track.getAttribute("aria-label")).toEqual("34 of 10 minutes")
      expect(track.firstChild.style.width).toEqual("100%")
      expect(parseFloat(track.lastChild.style.left)).toBeCloseTo(100 * 10 / 34, 3)

      expect(statValue(el, "Sessions")).toEqual("3")
      expect(statCard(el, "Sessions").textContent).toContain("1 piece, 1 exercise")

      expect(statValue(el, "Accuracy")).toEqual("85")
      expect(statSuffix(el, "Accuracy")).toEqual("%")
      expect(statCard(el, "Accuracy").textContent).toContain("▲ 5 on yesterday")

      expect(statValue(el, "Bars learned")).toEqual("2")
      expect(statCard(el, "Bars learned").textContent).toContain("Fixture bar 1; Fixture bar 6, left hand")
    })

    it("lists the sessions oldest first, each told by what was played", async function() {
      let el = mount()
      await loaded(el)

      let rows = [...el.querySelectorAll(`.${styles.session_row}`)]
      expect(rows.length).toEqual(3)

      let words = row => ({
        time: row.querySelector(`.${styles.session_time}`).textContent,
        title: row.querySelector(`.${styles.session_title}`).textContent,
        italic: row.querySelector(`.${styles.session_italic}`).textContent,
        small: row.querySelector(`.${styles.session_small}`).textContent,
        minutes: row.querySelector(`.${styles.session_minutes}`).textContent,
        figure: row.querySelector(`.${styles.session_figure}`).textContent,
      })

      expect(words(rows[0])).toEqual({
        time: "18:00", title: "Sight reading", italic: "Treble staff", small: "Exercises · Random notes",
        minutes: "10 min", figure: "91%",
      })
      expect(words(rows[1])).toEqual({
        time: "18:30", title: "Fixture", italic: "bars 1–8", small: "Free practice · 2 bars a card",
        minutes: "15 min", figure: "74%",
      })
      expect(rows[1].querySelector(`.${styles.session_figure}`).classList.contains(styles.weak)).toBe(true)
      expect(words(rows[2])).toEqual({
        time: "19:30", title: "Fixture", italic: "today's programme", small: "3 passes",
        minutes: "9 min", figure: "90%",
      })
    })

    it("shades each bar of the piece by today's accuracy, with the learned bars marked", async function() {
      let el = mount()
      await loaded(el)

      let plate = el.querySelector(`.${styles.piece_plate}`)
      expect(plate.textContent).toContain("Fixture bars played today")
      expect(plate.textContent).toContain("11 of 16 bars")

      let cells = [...plate.querySelectorAll(`.${styles.bar_cell}`)]
      expect(cells.length).toEqual(16)

      let kind = number => {
        let c = cells[number - 1]
        return ["clean", "near", "trouble"].find(k => c.classList.contains(styles[k])) || "unplayed"
      }
      expect(cells.map((_, i) => kind(i + 1))).toEqual([
        "clean", "clean", "trouble", "clean", "clean", "near", "clean", "clean", "trouble", "clean", "clean",
        "unplayed", "unplayed", "unplayed", "unplayed", "unplayed",
      ])

      expect(cells[2].getAttribute("aria-label")).toEqual("Bar 3, 75% today")
      expect(cells[8].getAttribute("aria-label")).toEqual("Bar 9, 71% today")
      expect(cells[0].getAttribute("aria-label")).toEqual("Bar 1, 100% today, learned today")
      expect(cells[11].getAttribute("aria-label")).toEqual("Bar 12, not played today")

      let diamonds = cells.filter(c => c.querySelector(`.${styles.learned_mark}`)).map(c => c.textContent)
      expect(diamonds).toEqual(["1◆", "6◆"])
      expect(cells[0].querySelector(`.${styles.learned_mark}`).getAttribute("aria-hidden")).toEqual("true")
    })

    it("draws a cell for each bar inside the plate, none overflowing it", async function() {
      let el = mount()
      await loaded(el)

      let plate = el.querySelector(`.${styles.piece_plate}`).getBoundingClientRect()
      for (let c of el.querySelectorAll(`.${styles.bar_cell}`)) {
        let box = c.getBoundingClientRect()
        expect(box.width).toBeGreaterThan(20)
        expect(box.left).toBeGreaterThanOrEqual(plate.left)
        expect(box.right).toBeLessThanOrEqual(plate.right)
      }
    })

    it("draws a learned bar's diamond inside its cell, and the goal's tick inside its track", async function() {
      let el = mount()
      await loaded(el)

      for (let diamond of el.querySelectorAll(`.${styles.learned_mark}`)) {
        let cellBox = diamond.closest("button").getBoundingClientRect()
        let box = diamond.getBoundingClientRect()
        expect(box.width).toBeGreaterThan(0)
        expect(box.left).toBeGreaterThanOrEqual(cellBox.left)
        expect(box.right).toBeLessThanOrEqual(cellBox.right)
        expect(box.top).toBeGreaterThanOrEqual(cellBox.top)
        expect(box.bottom).toBeLessThanOrEqual(cellBox.bottom)
      }

      let track = statCard(el, "Minutes").querySelector('[role="img"]')
      let trackBox = track.getBoundingClientRect()
      let tick = track.lastChild.getBoundingClientRect()
      expect(trackBox.width).toBeGreaterThan(40)
      expect(tick.left).toBeGreaterThanOrEqual(trackBox.left)
      expect(tick.right).toBeLessThanOrEqual(trackBox.right + 1)
      expect(track.firstChild.getBoundingClientRect().right).toBeLessThanOrEqual(trackBox.right + 1)
    })

    it("tells the trouble bars by beat, worst first, never by a note name", async function() {
      let el = mount()
      await loaded(el)

      let rows = [...el.querySelectorAll(`.${styles.trouble_row}`)]
      expect(rows.map(r => [
        r.querySelector(`.${styles.trouble_bar}`).textContent,
        r.querySelector(`.${styles.trouble_label}`).textContent,
        r.querySelector(`.${styles.trouble_text}`).textContent,
      ])).toEqual([
        ["Bar 9", "71%", "Beat 3 went wrong in your only pass; also beat 5"],
        ["Bar 3", "75%", "Beat 2 went wrong in all 3 passes"],
        ["Bar 6", "92%", "Beat 1 went wrong once in 3 passes · 1 hesitation, not in the %"],
      ])
      expect(el.querySelector(`.${styles.piece_plate}`).textContent).not.toMatch(/\b[A-G][♯♭#b]?\d\b/)
    })

    it("offers to practise the span of the trouble bars, with a line saying how", async function() {
      let el = mount()
      await loaded(el)

      expect(button(el, "Practise bars 3–9")).toBeDefined()
      expect(el.textContent).toContain("One bar a card, the weakest most often.")
      expect(button(el, "Open the score")).toBeDefined()
    })

    it("counts the mistakes by kind and names the places that kept going wrong", async function() {
      let el = mount()
      await loaded(el)

      let mistakes = [...el.querySelectorAll(`.${styles.mistake_row}`)].map(r => [
        r.querySelector(`.${styles.mistake_label}`).textContent,
        r.querySelector(`.${styles.mistake_count}`).textContent,
        r.querySelector(`.${styles.mistake_fill}`).style.width,
      ])
      expect(mistakes).toEqual([
        ["Wrong notes", "5", "71%"], ["Skipped", "1", "14%"], ["Hesitations (not in the %)", "1", "14%"],
      ])

      expect(texts(el, `.${styles.habit_row}`)).toEqual(["Bar 3, beat 23 times"])
    })

    it("closes with the minutes and the bars learned", async function() {
      let el = mount()
      await loaded(el)

      expect(el.querySelector(`.${styles.closing}`).textContent)
        .toEqual("34 minutes, and 2 bars learned. A good evening at the bench.")
    })

    it("sets free practice of bars 3 to 9 and opens the score at rest, which Practise never begins", async function() {
      let el = mount()
      await loaded(el)
      let sessionsBefore = store.recentSessions().length

      click(button(el, "Practise bars 3–9"))

      expect(location.pathname).toEqual("/sheet-music")
      let stored = JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY))
      expect(stored.piece).toEqual(piece.id)
      expect(stored.practice).toEqual(FREE_PRACTICE)
      expect([stored.startMeasure, stored.endMeasure]).toEqual([3, 9])
      expect(stored.measuresPerCard).toEqual(1)
      expect(stored.order).toEqual(RANDOM_ORDER)

      await waitFor(() => page && container.querySelector('[role="group"][aria-label="Card order"]'), "the setup pane")
      expect(page.state.session).toBe(false)
      expect(page.state.view).toEqual("score")

      let pressed = group => [...container.querySelector(`[role="group"][aria-label="${group}"]`).querySelectorAll("button")]
        .filter(b => b.getAttribute("aria-pressed") == "true").map(b => b.textContent)
      expect(pressed("Session")).toEqual(["Free practice"])
      expect(pressed("Card order")).toEqual(["Random"])
      let number = label => container.querySelector(`[role="spinbutton"][aria-label="${label}"]`).value
      expect([number("start bar"), number("end bar"), number("bars per card")]).toEqual(["3", "9", "1"])
      expect(button(container, "End session")).toBeUndefined()
      expect(store.recentSessions().length).toEqual(sessionsBefore)
    })

    it("opens the score on a bar's own page from a cell, the piece stored", async function() {
      let el = mount()
      await loaded(el)

      click(cell(el, "Bar 9, 71% today"))

      expect(location.pathname).toEqual("/sheet-music")
      expect(location.search).toEqual("?bar=9")
      expect(JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)).piece).toEqual(piece.id)
    })

    it("opens the score on a trouble bar from its Open, and plainly from Open the score", async function() {
      let el = mount()
      await loaded(el)

      click(button(el, "Open"))
      expect(location.search).toEqual("?bar=9")
    })

    it("opens the score without a bar from Open the score", async function() {
      let el = mount()
      await loaded(el)

      click(button(el, "Open the score"))
      expect(location.pathname).toEqual("/sheet-music")
      expect(location.search).toEqual("")
    })

    it("draws the sessions and cards before the day's rows are read, and the plates once they are", async function() {
      let release
      let gate = new Promise(resolve => { release = resolve })
      let barLogSince = store.barLogSince.bind(store)
      spyOn(store, "barLogSince").and.callFake(async since => { await gate; return barLogSince(since) })

      let el = mount()
      await waitFor(() => el.querySelector(`.${styles.session_row}`), "the first paint")
      expect(statValue(el, "Sessions")).toEqual("3")
      expect(el.querySelector(`.${styles.piece_plate}`)).toBe(null)
      expect(el.querySelector(`.${styles.rail}`)).toBe(null)

      release()
      await loaded(el)
      expect(el.querySelector(`.${styles.piece_plate}`)).not.toBe(null)
      expect(el.querySelector(`.${styles.rail}`)).not.toBe(null)
    })

    it("keeps the first paint when the day's rows can't be read, and says so in the console", async function() {
      spyOn(store, "barLogSince").and.returnValue(Promise.reject(new Error("refused")))
      spyOn(console, "error")

      let el = mount()
      await waitFor(() => console.error.calls.count() > 0, "the failed read")

      expect(console.error.calls.argsFor(0)[0]).toEqual("Couldn't read today's practice")
      expect(statValue(el, "Sessions")).toEqual("3")
      expect(el.querySelectorAll(`.${styles.session_row}`).length).toEqual(3)
      expect(el.querySelector(`.${styles.piece_plate}`)).toBe(null)
    })

    it("counts the day from 4 am: half past midnight is still that evening's practice", async function() {
      jasmine.clock().mockDate(new Date(2026, 8, 15, 0, 30))
      let el = mount()
      await loaded(el)

      expect(el.querySelector("h1").textContent).toEqual("Today, Monday 14 September")
      expect(statValue(el, "Sessions")).toEqual("3")
    })
  })

  describe("statsPageFor", function() {
    it("gives a local user the practice record and an account the backend page", function() {
      expect(statsPageFor(null).type).toBe(PracticeRecordPage)
      expect(statsPageFor({}).type).toBe(PracticeRecordPage)
      expect(statsPageFor({currentUser: {id: 1}}).type).toBe(StatsPage)
    })
  })
})
