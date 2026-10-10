import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, FREE_PRACTICE} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {openTestStore} from "spec/helpers"

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

describe("the ended strip survives a reload", function() {
  let container, root, page, store, previous
  afterEach(function() {
    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previous); store.close()
  })

  it("comes back after a remount with the same log and no Play on; Done clears it for good", async function() {
    store = await openTestStore()
    previous = setAppStore(store)
    window.localStorage.removeItem(SCORE_DRILL_STORAGE_KEY)
    let xml = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    let {piece} = await importMusicXMLPiece("fixture.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: 1, practice: FREE_PRACTICE, startMeasure: 1, endMeasure: 2,
    }))
    let mount = async () => {
      container = document.createElement("div")
      container.style.width = "1440px"
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240}))))
      await waitFor(() => container.querySelectorAll('button[aria-label^="Bar "]').length > 0, {message: "bars"})
    }
    let unmount = () => { flushSync(() => root.unmount()); root = null; container.remove(); container = null }
    let button = text => [...container.querySelectorAll("button")].find(b => b.textContent.trim() == text)
    let playCard = () => {
      let columns = page.currentCard().card.columns.length
      for (let i = 0; i < columns; i++) {
        let column = page.state.notes.currentColumn()
        for (let note of column) { flushSync(() => page.pressNote(note)) }
        for (let note of column) { flushSync(() => page.releaseNote(note)) }
      }
    }

    await mount()
    flushSync(() => button("Begin").click())
    playCard()
    playCard()
    await page.state.notes.generator.finishing
    let log = page.state.sessionLog
    flushSync(() => button("End session").click())
    await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
    let headline = container.textContent.match(/\d+%\s*accuracy/)[0]
    unmount()

    await mount()
    await waitFor(() => container.textContent.includes("Session ended"), {timeout: 3000, message: "the strip to come back"})
    expect(container.textContent).toContain(headline)
    expect(page.state.sessionLog).toEqual(log)
    expect(button("Play on")).toBeUndefined()
    flushSync(() => button("Done").click())
    unmount()

    await mount()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(container.textContent).not.toContain("Session ended")
  })
})
