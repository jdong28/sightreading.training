import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {ScoreSheet, TROUBLE_CLASS} from "st/components/score_sheet"
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

// A bar's note marks (st/bar_review) over the engraving: the class on the
// heads that tend to go wrong, and a layer of rings, ghost heads, ▾ and tags
// in percent of the plate, each checked against the head it sits on, on the
// real engine and a realistic piece (title, key signature, dynamics, slurs,
// a pickup bar) as well as the fixture
describe("ScoreSheet's note marks", function() {
  let container, root, sheet

  afterEach(function() {
    if (root) { flushSync(() => root.unmount()) }
    if (container) { container.remove() }
    root = container = sheet = null
  })

  let mount = async (musicXML, {width=1100, ...props}={}) => {
    container = document.createElement("div")
    container.style.width = `${width}px`
    document.body.appendChild(container)
    root = createRoot(container)
    let render = extra => flushSync(() => {
      root.render(React.createElement(ScoreSheet, {
        ref: instance => { sheet = instance },
        musicXML, fromMeasure: props.fromMeasure ?? 1, toMeasure: props.toMeasure ?? 16, engine: "osmd",
        loadEngines: loadScoreEngines, viewportHeight: 1240, ...props, ...extra,
      }))
    })
    render()
    await waitFor(() => container.querySelectorAll("button[aria-label^=\"Bar \"]").length > 0, {message: "the bars to draw"})
    return render
  }

  let head = (beat, pitch) => sheet.result.notes.find(note =>
    note.pitch == pitch && Math.abs(note.onsetBeats - beat) < 0.01)
  let box = el => el.getBoundingClientRect()
  let layer = kind => [...container.querySelectorAll(`[data-mark="${kind}"]`)]
  let center = rect => [rect.left + rect.width / 2, rect.top + rect.height / 2]
  // actual within px of expected, said with what it is when it isn't
  let near = (actual, expected, px=2, what="the value") => {
    expect(Math.abs(actual - expected)).withContext(`${what}: ${actual} against ${expected}`).toBeLessThanOrEqual(px)
  }

  let marks = {
    measure: 3,
    heads: [{beat: 9, pitch: 74, kind: "habit"}, {beat: 9, pitch: 50, kind: "habit"}, {beat: 10, pitch: 76, kind: "once"}],
    ghosts: [{beat: 9, pitch: 50, played: 51, steps: 0}, {beat: 9, pitch: 74, played: 76, steps: 1}],
    pauses: [{beat: 11}],
    tags: [{beat: 9, pitch: 50, tone: "oxblood", text: "wrong 3 of 3"}, {beat: 11, pitch: null, tone: "gilt", text: "2.5 s pause"}],
  }

  let fixture = async () => (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()

  // every mark sits where its head does
  let expectMarksOnHeads = () => {
    let sized = head(9, 50)
    let size = box(sized.el)
    expect(size.width).toBeGreaterThan(5)

    for (let [beat, pitch] of [[9, 74], [9, 50]]) {
      expect(head(beat, pitch).el.classList.contains(TROUBLE_CLASS)).toBe(true)
    }
    // only those two heads of the whole piece
    expect(container.querySelectorAll(`.${TROUBLE_CLASS}`).length).toEqual(2)
    expect(head(10, 76).el.classList.contains(TROUBLE_CLASS)).toBe(false)

    // a ring is a circle round the head it rings
    let [ring] = layer("ring")
    let [ringX, ringY] = center(box(ring))
    let [headX, headY] = center(box(head(10, 76).el))
    near(ringX, headX, 2, "ringX, headX")
    near(ringY, headY, 2, "ringY, headY")
    expect(box(ring).width).toBeGreaterThan(box(head(10, 76).el).width)
    near(box(ring).width, box(ring).height, 2, "box(ring).width, box(ring).height")

    // a ghost head the size of its head, a quarter of a head right of it,
    // raised by its steps
    let ghosts = layer("ghost")
    expect(ghosts.length).toEqual(2)
    for (let [ghost, {beat, pitch, steps}] of ghosts.map((el, idx) => [el, marks.ghosts[idx]])) {
      let h = box(head(beat, pitch).el)
      let g = box(ghost)
      near(g.width, h.width, 2, "g.width, h.width")
      near(g.height, h.height, 2, "g.height, h.height")
      near(g.left, h.right + h.width * 0.25, 2, "g.left, h.right + h.width * 0.25")
      near(g.top, h.top - steps * h.height / 2, 2, "g.top, h.top - steps * h.height / 2")
    }

    // the pause mark over the top head of its column, the tags under the band
    let [pause] = layer("pause")
    let column = sheet.result.notes.filter(note => Math.abs(note.onsetBeats - 11) < 0.01)
    let top = column.map(note => box(note.el)).reduce((best, rect) => rect.top < best.top ? rect : best)
    near(center(box(pause))[0], center(top)[0], 2, "center(box(pause))[0], center(top)[0], 2")
    expect(box(pause).bottom).toBeLessThan(top.top)
    expect(top.top - box(pause).bottom).toBeLessThan(top.height * 3)

    let tags = layer("tag")
    expect(tags.map(tag => tag.textContent)).toEqual(["wrong 3 of 3", "2.5 s pause"])
    let bar = container.querySelector("button[aria-label=\"Bar 3\"]")
    let [first, second] = tags.map(box)
    // inside the bar's band at its bottom, the second riding above the first
    // where the two would overlap
    near(first.bottom, box(bar).bottom, 2, "the first tag's bottom")
    let overlaps = Math.abs(center(first)[0] - center(second)[0]) < (first.width + second.width) / 2
    near(second.bottom, overlaps ? first.top : box(bar).bottom, 2, "the second tag's bottom")
    expect(first.right <= second.left || second.right <= first.left || second.bottom <= first.top + 1).toBe(true)
    near(center(box(tags[0]))[0], center(box(head(9, 50).el))[0], 3, "center(box(tags[0]))[0], center(box(head(9, 50).el))[0], 3")
    near(center(box(tags[1]))[0], center(top)[0], 3, "center(box(tags[1]))[0], center(top)[0], 3")
  }

  it("marks the heads at the beat and pitch given, each mark on its own head, and nothing else", async function() {
    let render = await mount(await fixture(), {noteMarks: null, measureStarts: null})
    expect(container.querySelectorAll(`.${TROUBLE_CLASS}`).length).toEqual(0)
    expect(layer("ring").length + layer("ghost").length + layer("pause").length + layer("tag").length).toEqual(0)

    render({noteMarks: marks})
    expectMarksOnHeads()
  })

  it("draws no mark at all once the marks go, nor on a page where the bar isn't", async function() {
    let render = await mount(await fixture(), {noteMarks: marks})
    expectMarksOnHeads()

    render({noteMarks: null})
    expect(container.querySelectorAll(`.${TROUBLE_CLASS}`).length).toEqual(0)
    expect(container.querySelectorAll("[data-mark]").length).toEqual(0)

    // back, then on the other page, where those heads aren't
    render({noteMarks: marks})
    expectMarksOnHeads()
    await waitFor(() => sheet.state.pages.length > 1, {message: "two pages"})
    render({noteMarks: marks, page: 1})
    expect(container.querySelectorAll("[data-mark]").length).toEqual(0)
    expect(container.querySelectorAll(`.${TROUBLE_CLASS}`).length).toEqual(0)
    render({noteMarks: marks, page: 0})
    expectMarksOnHeads()
  })

  it("puts the marks back on the new heads after the plate is engraved again at another width", async function() {
    let render = await mount(await fixture(), {noteMarks: marks, width: 1100})
    expectMarksOnHeads()

    let before = sheet.result
    container.style.width = "560px"
    await waitFor(() => sheet.result !== before && !sheet.state.drawing, {message: "the re-engraving"})
    await waitFor(() => container.querySelectorAll(`.${TROUBLE_CLASS}`).length == 2, {message: "the marks again"})
    expectMarksOnHeads()

    // and a resize that only scales the same engraving
    container.style.width = "430px"
    await waitFor(() => Math.round(box(container.querySelector("svg")).width) <= 432, {message: "the resize"})
    expectMarksOnHeads()
    render({noteMarks: null})
    expect(container.querySelectorAll("[data-mark]").length).toEqual(0)
  })

  it("stacks a tag above another that would overlap it, never over its own head", async function() {
    let close = {
      ...marks,
      pauses: [],
      tags: [{beat: 9, pitch: 50, tone: "oxblood", text: "wrong 3 of 3"}, {beat: 10, pitch: null, tone: "gilt", text: "2.5 s pause"}],
    }
    await mount(await fixture(), {noteMarks: close})
    await waitFor(() => layer("tag").length == 2, {message: "the tags"})

    let [first, second] = layer("tag").map(box)
    near(first.bottom, box(container.querySelector("button[aria-label=\"Bar 3\"]")).bottom, 2, "the first tag's bottom")
    // the second rides on the first rather than over it
    expect(second.bottom).toBeLessThanOrEqual(first.top + 1)
    expect(Math.abs(first.bottom - second.bottom)).toBeLessThan(first.height * 2 + 2)
  })

  it("marks a realistic piece alike: a title, key signature, dynamics, slurs and a pickup bar", async function() {
    // bar 2 of the expressive study starts on the fifth beat (a one beat pickup, then bar 1);
    // its second beat is G4 over F3 under the key's sharps: A4 (69) over F3 (53)
    let study = {
      measure: 2,
      heads: [{beat: 6, pitch: 69, kind: "habit"}, {beat: 6, pitch: 53, kind: "once"}],
      ghosts: [{beat: 6, pitch: 53, played: 54, steps: 0}],
      pauses: [{beat: 7}],
      tags: [{beat: 6, pitch: 53, tone: "oxblood", text: "wrong 2 of 2"}],
    }
    await mount(dynamicsOpening(), {fromMeasure: 0, toMeasure: 6, noteMarks: study})
    await waitFor(() => container.querySelectorAll(`.${TROUBLE_CLASS}`).length == 1, {message: "the mark"})

    let marked = container.querySelector(`.${TROUBLE_CLASS}`)
    expect(marked).toBe(head(6, 69).el)
    let h = box(head(6, 53).el)
    let [ring] = layer("ring")
    near(center(box(ring))[0], center(h)[0], 2, "center(box(ring))[0], center(h)[0]")
    near(center(box(ring))[1], center(h)[1], 2, "center(box(ring))[1], center(h)[1]")

    let [ghost] = layer("ghost")
    near(box(ghost).left, h.right + h.width * 0.25, 2, "box(ghost).left, h.right + h.width * 0.25")
    near(box(ghost).top, h.top, 2, "box(ghost).top, h.top")

    let [pause] = layer("pause")
    let column = sheet.result.notes.filter(note => Math.abs(note.onsetBeats - 7) < 0.01)
    let top = Math.min(...column.map(note => box(note.el).top))
    expect(box(pause).bottom).toBeLessThan(top)

    // the dynamics under the treble staff and the slur don't move a mark off its head
    let [tag] = layer("tag")
    let bar = container.querySelector("button[aria-label=\"Bar 2\"]")
    near(box(tag).bottom, box(bar).bottom, 2, "box(tag).bottom, box(bar).bottom, 2")
    near(center(box(tag))[0], center(h)[0], 3, "center(box(tag))[0], center(h)[0], 3")
  })
})
