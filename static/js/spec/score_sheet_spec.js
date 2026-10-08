import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {ScoreSheet} from "st/components/score_sheet"
import {loadScoreEngines} from "st/score_render/load"
import {ENGRAVE_MAX_WIDTH} from "st/score_render/score_pages"
import sheetStyles from "st/components/score_sheet.module.css"

import {dynamicsOpening} from "spec/helpers"

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

// A bar's learnedness/session-mark label badge (score_sheet.jsx's
// renderOverlays) must sit just above its own bar, not reach up the page
// (sr-score-sheet-label-box): its span used to be given the bar's own full
// box (left/top/width/height) before transform: translateY(-100%) lifted
// it clear off the bar, so the badge rendered as tall as the bar itself and
// the lift carried it up by that whole height instead of its own small one.
// Reproduced on a realistic piece (title, key signature, dynamics, slurs,
// a pickup bar), not only a minimal fixture, since the real engine's own
// box geometry is what the bug depends on.
describe("ScoreSheet's bar labels (sr-score-sheet-label-box)", function() {
  let container, root

  afterEach(function() {
    if (root) { flushSync(() => root.unmount()) }
    if (container) { container.remove() }
  })

  let render = async labels => {
    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)

    let barInfo = new Map([[1, {fill: "rgba(0,0,0,.1)"}], [2, {fill: "rgba(0,0,0,.1)"}]])

    flushSync(() => {
      root.render(React.createElement(ScoreSheet, {
        musicXML: dynamicsOpening(), fromMeasure: 0, toMeasure: 6, hand: "both",
        engine: "osmd", loadEngines: loadScoreEngines, viewportHeight: 1240,
        barInfo, labels,
      }))
    })

    await waitFor(() => container.querySelectorAll("button[aria-label^=\"Bar \"]").length > 0,
      {message: "the overlay buttons to draw"})
    return container
  }

  it("keeps a bar's label just above its own bar, never reaching up the page", async function() {
    let labels = new Map([[1, {text: "0 of 3"}]])
    let el = await render(labels)

    let bar1 = [...el.querySelectorAll("button[aria-label=\"Bar 1\"]")][0]
    let label = [...el.querySelectorAll("span")].find(span => span.textContent == "0 of 3")
    let barRect = bar1.getBoundingClientRect()
    let labelRect = label.getBoundingClientRect()

    // the bug put the label's bottom a whole bar's height above the bar
    // (and its top further still); fixed, it sits snug above it instead
    expect(labelRect.height).toBeLessThan(barRect.height / 2)
    expect(Math.abs(labelRect.bottom - barRect.top)).toBeLessThan(labelRect.height + 2)
    expect(labelRect.top).toBeGreaterThan(barRect.top - barRect.height)
  })

  it("keeps a page's every label within its own page box, not above the toolbar", async function() {
    let labels = new Map([[1, {text: "0 of 3"}], [2, {text: "Learned"}]])
    let el = await render(labels)

    let plateBox = el.querySelector(`.${sheetStyles.plate_box}`)
    let plateTop = plateBox.getBoundingClientRect().top
    let labelSpans = [...el.querySelectorAll("span")].filter(span => ["0 of 3", "Learned"].includes(span.textContent))
    expect(labelSpans.length).toEqual(2)

    for (let span of labelSpans) {
      // SPACE above a system's own measures (st/score_render/score_pages)
      // is 3 staff spaces at most; a label a little above that is still
      // nowhere near a whole system's height above the plate
      expect(span.getBoundingClientRect().top).toBeGreaterThan(plateTop - 60)
    }
  })
})
