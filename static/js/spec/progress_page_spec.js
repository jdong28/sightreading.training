import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route} from "react-router-dom"

import ProgressPage from "st/components/pages/progress_page"
import StatsPage, {statsPageFor} from "st/components/pages/stats"
import PracticeRecordPage from "st/components/pages/practice_record_page"
import styles from "st/components/pages/progress_page.module.css"
import salonStyles from "st/components/salon.module.css"
import {setAppStore} from "st/storage"
import {localDay, dayStart} from "st/srs/schedule"
import {PROGRESS_DAYS} from "st/progress"
import {openTestStore} from "spec/helpers"

const HOUR = 60 * 60 * 1000

// the clock every spec here runs on, a fixed local evening: the page reads
// Date.now() itself at mount, so without pinning it a session seeded at a
// time of its 4am day (st/srs/schedule) can fall after the real now and
// drop out of the window for the hours before it. It goes on once the test
// store is open, which never settles under a mocked clock
const PINNED_NOW = new Date(2026, 8, 14, 20)

// the real timer: a wait still runs even where a spec mocks the clock
const realSetTimeout = window.setTimeout.bind(window)

let waitFor = async (fn, message) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) { return }
    await new Promise(resolve => realSetTimeout(resolve, 10))
  }
  fail(`timed out waiting for ${message}`)
}

describe("progress page", function() {
  let container, root, store, appStore

  beforeEach(async function() {
    store = await openTestStore()
    appStore = setAppStore(store)
    jasmine.clock().install()
    jasmine.clock().mockDate(PINNED_NOW)
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
  })

  let renderProgress = () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {initialEntries: ["/stats/last-14-days"]},
        React.createElement(Routes, {},
          React.createElement(Route, {path: "/stats/last-14-days", element: React.createElement(ProgressPage)}),
          React.createElement(Route, {path: "/setup", element: React.createElement("div", {id: "setup"}, "setup")}),
        )))
    })
    return container
  }

  let statCard = (el, label) =>
    [...el.querySelectorAll(`.${salonStyles.stat_label}`)].find(node => node.textContent == label).closest(`.${salonStyles.card}`)

  // the value text alone, apart from any suffix span beside it
  let statValue = (el, label) => {
    let valueNode = statCard(el, label).querySelector(`.${salonStyles.stat_value}`)
    return [...valueNode.childNodes]
      .filter(node => node.nodeType == Node.TEXT_NODE)
      .map(node => node.textContent)
      .join("")
  }

  it("sits under the practice record's tabs, Last 14 days the one marked", function() {
    let el = renderProgress()
    let tabs = [...el.querySelectorAll('nav[aria-label="Practice record"] a')]
    expect(tabs.map(a => a.textContent)).toEqual(["Today", "For my lesson", "Last 14 days"])
    expect(tabs.map(a => a.getAttribute("href"))).toEqual(["/stats", "/stats/for-my-lesson", "/stats/last-14-days"])
    expect(tabs.map(a => a.getAttribute("aria-current"))).toEqual([null, null, "page"])
    expect(el.querySelector("h1").textContent).toEqual("Your progress")
  })

  it("shows the headline cards, the chart, and By clef / By note from seeded sessions", async function() {
    let now = Date.now()
    let today = dayStart(localDay(now))
    let yesterday = dayStart(localDay(now) - 1)
    let fortnightAgo = dayStart(localDay(now) - 14)

    await store.putSession({
      id: "today", startedAt: today + 9 * HOUR, notesRead: 9, misses: 1, elapsedSeconds: 300,
      clefs: {g: {hits: 9, misses: 1}}, notes: {C: {hits: 9, misses: 1}},
    })
    await store.putSession({
      id: "yesterday", startedAt: yesterday + 9 * HOUR, notesRead: 3, misses: 7, elapsedSeconds: 300,
      clefs: {f: {hits: 3, misses: 7}}, notes: {D: {hits: 3, misses: 7}},
    })
    await store.putSession({
      id: "prev-window", startedAt: fortnightAgo + 9 * HOUR, notesRead: 5, misses: 5,
    })

    let el = renderProgress()

    expect(statValue(el, "Evenings kept")).toEqual("2")
    expect(statCard(el, "Evenings kept").textContent).toContain(`/ ${PROGRESS_DAYS}`)
    expect(statValue(el, "Notes read")).toEqual("12")
    expect(statValue(el, "Accuracy")).toEqual("60")
    expect(statCard(el, "Accuracy").textContent).toContain("▲ 10 on the fortnight before")
    expect(statValue(el, "Minutes")).toEqual("10")

    let bars = [...el.querySelectorAll(`.${styles.bar}`)]
    expect(bars.length).toEqual(PROGRESS_DAYS)
    expect(bars.filter(bar => bar.hasAttribute("data-today")).length).toEqual(1)
    expect(bars[bars.length - 1].hasAttribute("data-today")).toBe(true)
    expect(bars.filter(bar => bar.hasAttribute("data-missed")).length).toEqual(PROGRESS_DAYS - 2)

    expect(el.textContent).toContain("Goal 10")
    expect(el.querySelector(`.${styles.goal_line}`).style.bottom).toEqual("90px")

    let clefRows = [...el.querySelectorAll(`.${styles.clef_row}`)]
    expect(clefRows.map(row => row.querySelector(`.${styles.clef_label}`).textContent)).toEqual(["Treble", "Bass"])
    expect(clefRows[0].hasAttribute("data-weak")).toBe(false) // g: 90%
    expect(clefRows[1].hasAttribute("data-weak")).toBe(true) // f: 30%

    let tiles = [...el.querySelectorAll(`.${styles.note_tile}`)]
    expect(tiles.map(tile => tile.querySelector(`.${styles.note_name}`).textContent)).toEqual(["C", "D"])
    expect(tiles[0].hasAttribute("data-weak")).toBe(false) // C: 90%
    expect(tiles[1].hasAttribute("data-weak")).toBe(true) // D: 30%
  })

  it("reads the daily goal from practice settings", async function() {
    await store.putPracticeSettings({...store.practiceSettings(), dailyGoalMinutes: 20})
    let el = renderProgress()
    expect(el.textContent).toContain("Goal 20")
  })

  it("replaces the first paint once a just-ended session's write settles", async function() {
    // not awaited: the write is still queued when the page mounts, as when a
    // visit here follows right after Rest or page leave
    store.putSession({id: "s", startedAt: Date.now(), notesRead: 4, misses: 0, elapsedSeconds: 60})

    let el = renderProgress()
    expect(statValue(el, "Evenings kept")).toEqual("0")
    await waitFor(() => statValue(el, "Evenings kept") == "1", "the just-ended session")
  })

  it("keeps the first paint when the history read fails", async function() {
    await store.putSession({id: "s", startedAt: Date.now(), notesRead: 4, misses: 0, elapsedSeconds: 60})
    spyOn(store, "sessionsSince").and.returnValue(Promise.reject(new Error("database closed")))
    spyOn(console, "error")

    let el = renderProgress()
    expect(statValue(el, "Evenings kept")).toEqual("1")

    await waitFor(() => console.error.calls.any(), "the failed read to be logged")
    expect(console.error.calls.mostRecent().args[0]).toContain("practice history")
    // the cached first paint stands and nothing is thrown at the page
    expect(statValue(el, "Evenings kept")).toEqual("1")
    expect(statValue(el, "Notes read")).toEqual("4")
  })

  it("shows 14 missed days, no accuracy, and empty rail copy on an empty store", function() {
    let el = renderProgress()

    let bars = [...el.querySelectorAll(`.${styles.bar}`)]
    expect(bars.length).toEqual(PROGRESS_DAYS)
    expect(bars.every(bar => bar.hasAttribute("data-missed"))).toBe(true)

    expect(statValue(el, "Accuracy")).toEqual("—")
    expect(el.querySelectorAll(`.${styles.clef_row}`).length).toEqual(0)
    expect(el.querySelectorAll(`.${styles.note_tile}`).length).toEqual(0)
    expect([...el.querySelectorAll(`.${styles.rail_empty}`)].length).toEqual(2)
    expect(el.textContent).toContain("Nothing played yet")

    let pill = [...el.querySelectorAll("a")].find(a => a.textContent == "Tonight's programme")
    expect(pill.getAttribute("href")).toEqual("/setup")
  })

  describe("statsPageFor", function() {
    it("routes a local session to the practice record and an account to the backend stats page", function() {
      expect(statsPageFor(null).type).toBe(PracticeRecordPage)
      expect(statsPageFor({}).type).toBe(PracticeRecordPage)
      expect(statsPageFor({currentUser: {id: 1}}).type).toBe(StatsPage)
    })
  })
})
