import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {loadScoreEngines, enginesURL} from "st/score_render/load"
import {
  ScoreEnginesPage, MISSING_SOURCE_MESSAGE, ENGINE_ORDER,
} from "st/components/pages/score_engines_page"
import {scoreEnginesPath} from "st/score_render/route"
import {RIGHT_HAND, LEFT_HAND} from "st/data"
import {noteXML} from "spec/helpers"

// A 4/4 piano score opening with a one beat pickup (measure 0) and then
// measures 1 to count, numbered like a score. Every measure n has on the
// upper staff the quarters C5 D5 E5 F5 and on the lower staff a whole C3
// with an E3 on the upper staff above it in the same chord (a chord across
// the staves, led from the lower one), then in measure 1 a half G2 in a
// second voice
function twoStaffScore(count=12) {
  let measures = []
  for (let n = 1; n <= count; n++) {
    measures.push(`
    <measure number="${n}">
      ${noteXML("C", 5, 1, 1, "<voice>1</voice>")}
      ${noteXML("D", 5, 1, 1, "<voice>1</voice>")}
      ${noteXML("E", 5, 1, 1, "<voice>1</voice>")}
      ${noteXML("F", 5, 1, 1, "<voice>1</voice>")}
      <backup><duration>4</duration></backup>
      ${noteXML("C", 3, 4, 2, "<voice>5</voice>")}
      ${noteXML("E", 3, 4, 1, "<voice>5</voice><chord/>")}
      ${n == 1 ? `<backup><duration>4</duration></backup>${noteXML("G", 2, 2, 2, "<voice>6</voice>")}` : ""}
    </measure>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Engine Etude</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      ${noteXML("B", 4, 1, 1, "<voice>1</voice>")}
      <backup><duration>1</duration></backup>
      <forward><duration>1</duration><voice>5</voice><staff>2</staff></forward>
    </measure>
    ${measures.join("")}
  </part>
</score-partwise>`
}

// [pitch, onset, staff, voice] of every note the fixture has in the printed
// measures from to to (measure n starts at beat 1 + 4 * (n - 1))
function fixtureNotes(from, to, hand="both") {
  let notes = []
  if (from <= 0) {
    notes.push([71, 0, 1, 1])
  }
  for (let n = Math.max(from, 1); n <= to; n++) {
    let start = 1 + 4 * (n - 1)
    notes.push([72, start, 1, 1], [74, start + 1, 1, 1], [76, start + 2, 1, 1], [77, start + 3, 1, 1])
    notes.push([48, start, 2, 5], [52, start, 1, 5])
    if (n == 1) {
      notes.push([43, start, 2, 6])
    }
  }
  let keep = hand == "upper" ? 1 : hand == "lower" ? 2 : null
  return notes.filter(([, , staff]) => keep == null || staff == keep)
}

let noteKey = note => [note.pitch, note.onsetBeats, note.staff, note.voice]
let byOrder = (a, b) => a[1] - b[1] || a[0] - b[0]
let sortedKeys = notes => notes.map(noteKey).sort(byOrder)

describe("score render", function() {
  let bundle

  beforeAll(async function() {
    bundle = await loadScoreEngines()
    await bundle.enginesReady()
  }, 60000)

  describe("enginesURL", function() {
    it("finds the engines bundle beside the app bundle", function() {
      expect(enginesURL("http://localhost:3000/dev/out/main.js"))
        .toEqual("http://localhost:3000/dev/out/score_engines.js")
      expect(enginesURL("https://example.com/static/main.min.js?abc123"))
        .toEqual("https://example.com/static/score_engines.min.js?abc123")
    })
  })

  describe("card source", function() {
    let parse = xml => new DOMParser().parseFromString(xml, "application/xml")

    it("finds a range's measures by their printed numbers past a pickup", function() {
      let doc = parse(twoStaffScore(4))
      expect(bundle.measurePositions(doc, 2, 3)).toEqual([2, 3])
      expect(bundle.measurePositions(doc, 0, 1)).toEqual([0, 1])
      expect(bundle.measurePositions(doc, 3, 99)).toEqual([3, 4])
      expect(bundle.measurePositions(doc, 7, 9)).toBe(null)
    })

    describe("numbering bars as the importer does", function() {
      let score = measureAttrs => parse(`<score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1">${measureAttrs.map(attrs => `<measure ${attrs}>${noteXML("C", 5, 4, 1)}</measure>`).join("")}</part>
      </score-partwise>`)

      it("keeps both halves of a split implicit bar under the first half's number", function() {
        let doc = score(['number="1"', 'number="2"', 'number="X1" implicit="yes"', 'number="3"'])
        expect(bundle.measurePositions(doc, 2, 2)).toEqual([1, 2])
        expect(bundle.measurePositions(doc, 3, 3)).toEqual([3, 3])
      })

      it("counts a pickup numbered 1 but marked implicit as measure 0", function() {
        let doc = score(['number="1" implicit="yes"', 'number="2"', 'number="3"', 'number="4"'])
        expect(bundle.measurePositions(doc, 0, 0)).toEqual([0, 0])
        expect(bundle.measurePositions(doc, 1, 2)).toEqual([1, 2])
      })

      it("counts from 1 whatever number the first bar prints", function() {
        let doc = score(['number="17"', 'number="18"', 'number="19"'])
        expect(bundle.measurePositions(doc, 1, 2)).toEqual([0, 1])
        expect(bundle.measurePositions(doc, 17, 19)).toBe(null)
      })
    })

    it("tags every note and reads its pitch, onset, staff and voice", function() {
      let doc = parse(twoStaffScore(2))
      let {notes} = bundle.tagNotes(doc)
      expect([...notes.values()].map(n => [n.pitch, n.onsetBeats, n.staff, n.voice]).sort(byOrder))
        .toEqual(fixtureNotes(0, 2).sort(byOrder))
      expect([...doc.querySelectorAll("note")].every(note => note.id)).toBe(true)
    })

    it("drops the other staff, keeping the voices' time and the kept staff's clef", function() {
      let doc = parse(twoStaffScore(2))
      bundle.keepStaff(doc, 2)

      expect([...doc.querySelectorAll("staves")].map(el => el.textContent)).toEqual(["1"])
      let clefs = [...doc.querySelectorAll("clef")]
      expect(clefs.map(clef => clef.querySelector("sign").textContent)).toEqual(["F"])
      expect(clefs[0].hasAttribute("number")).toBe(false)

      let notes = [...doc.querySelectorAll("note")]
      expect(notes.map(note => note.querySelector("step").textContent)).toEqual(["C", "G", "C"])
      expect(notes.every(note => note.querySelector("staff").textContent == "1")).toBe(true)

      // the upper staff's run is held by a forward in its voice
      let forwards = [...doc.querySelectorAll("measure[number='1'] forward")]
      expect(forwards.map(el => el.querySelector("duration").textContent)).toEqual(["1", "1", "1", "1"])
      expect(forwards.map(el => el.querySelector("voice").textContent)).toEqual(["1", "1", "1", "1"])
    })

    it("keeps a chord across the staves on the staff drawn, as its own lead", function() {
      let doc = parse(twoStaffScore(1))
      bundle.keepStaff(doc, 1)
      let measure = doc.querySelector("measure[number='1']")
      let e3 = [...measure.querySelectorAll("note")].find(note => note.querySelector("step").textContent == "E" &&
        note.querySelector("octave").textContent == "3")
      expect(e3).toBeDefined()
      expect(e3.querySelector("chord")).toBe(null)
      expect(measure.querySelectorAll("forward").length).toEqual(1)
    })
  })

  for (let key of ENGINE_ORDER) {
    describe(`the ${key} engine`, function() {
      let engine, container

      beforeEach(function() {
        engine = bundle.ENGINES[key]
        container = document.createElement("div")
        document.body.appendChild(container)
      })

      afterEach(function() {
        container.remove()
      })

      let draw = async opts => {
        let result = await engine.renderCard({musicXML: twoStaffScore(), hand: "both", width: 644, ...opts})
        container.replaceChildren(result.svg)
        return result
      }

      it("draws the measure range asked for, numbered as printed", async function() {
        let result = await draw({fromMeasure: 2, toMeasure: 3})
        expect(sortedKeys(result.notes)).toEqual(fixtureNotes(2, 3).sort(byOrder))

        result = await draw({fromMeasure: 0, toMeasure: 1})
        expect(sortedKeys(result.notes)).toEqual(fixtureNotes(0, 1).sort(byOrder))
      })

      it("draws one hand alone, dropping the other staff", async function() {
        let result = await draw({fromMeasure: 1, toMeasure: 2, hand: "lower"})
        expect(sortedKeys(result.notes)).toEqual(fixtureNotes(1, 2, "lower").sort(byOrder))

        result = await draw({fromMeasure: 1, toMeasure: 2, hand: "upper"})
        expect(sortedKeys(result.notes)).toEqual(fixtureNotes(1, 2, "upper").sort(byOrder))
      })

      it("hands back every drawn note with its own live element", async function() {
        let result = await draw({fromMeasure: 1, toMeasure: 2})
        expect(result.svg instanceof SVGSVGElement).toBe(true)
        expect(result.notes.length).toEqual(fixtureNotes(1, 2).length)
        expect(new Set(result.notes.map(note => note.el)).size).toEqual(result.notes.length)
        for (let note of result.notes) {
          expect(note.el instanceof SVGElement).toBe(true)
          expect(document.contains(note.el)).toBe(true)
          expect(note.el.getBoundingClientRect().width).toBeGreaterThan(0)
        }
      })

      it("wraps a range too wide for the plate onto a second system", async function() {
        let top = note => note.el.getBoundingClientRect().top
        let firstC5 = notes => notes.find(note => note.pitch == 72 && note.onsetBeats == 1)

        let short = await draw({fromMeasure: 1, toMeasure: 2})
        let shortHeight = short.svg.getBoundingClientRect().height

        let wide = await draw({fromMeasure: 1, toMeasure: 12})
        let lastC5 = wide.notes.find(note => note.pitch == 72 && note.onsetBeats == 1 + 4 * 11)
        expect(top(lastC5) - top(firstC5(wide.notes))).toBeGreaterThan(40)
        expect(wide.svg.getBoundingClientRect().height).toBeGreaterThan(shortHeight * 1.5)
      })
    })
  }

  it("gives the same notes the same ids and values in both engines", async function() {
    let cards = await Promise.all(ENGINE_ORDER.map(key =>
      bundle.ENGINES[key].renderCard({musicXML: twoStaffScore(), fromMeasure: 0, toMeasure: 3, hand: "both", width: 926})))
    let [osmd, verovio] = cards.map(card =>
      card.notes.map(note => [note.id, ...noteKey(note)].join(" ")).sort())
    expect(osmd).toEqual(verovio)
  })
})

describe("ScoreEnginesPage", function() {
  let container, root

  beforeEach(function() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(function() {
    flushSync(() => root.unmount())
    container.remove()
  })

  let pieces = [{id: "p1", title: "Engine Etude", song: null}]
  let renderPage = props => {
    flushSync(() => root.render(React.createElement(ScoreEnginesPage, {
      deck: () => ({pieces}),
      ...props,
    })))
  }

  let waitFor = async (check, tries=500) => {
    for (let i = 0; i < tries && !check(); i++) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    return check()
  }

  it("says plainly when a piece has no stored source and to import it again", async function() {
    let loadEngines = jasmine.createSpy("loadEngines").and.returnValue(new Promise(() => {}))
    renderPage({readSource: async () => null, loadEngines})

    expect(await waitFor(() => container.querySelector("[data-missing-source]"))).toBeTruthy()
    expect(container.textContent).toContain(MISSING_SOURCE_MESSAGE)
    expect(MISSING_SOURCE_MESSAGE).toContain("Import its file again")
    expect(container.querySelector("[data-engine]")).toBe(null)
  })

  it("says so when there are no pieces", function() {
    renderPage({deck: () => ({pieces: []}), loadEngines: () => new Promise(() => {})})
    expect(container.textContent).toContain("No pieces imported yet")
  })

  it("draws the card with both engines and reads a pointed note back the same in each", async function() {
    renderPage({
      readSource: async () => twoStaffScore(),
      initial: {piece: "p1", from: 1, to: 2},
    })

    let times = () => [...container.querySelectorAll("[data-render-time]")].map(el => el.textContent)
    expect(await waitFor(() => times().length == 2 && times().every(t => / ms$/.test(t)))).toBe(true)

    let sections = [...container.querySelectorAll("[data-engine]")]
    expect(sections.map(el => el.dataset.engine)).toEqual(ENGINE_ORDER)
    expect(sections.map(el => el.querySelector("svg") != null)).toEqual([true, true])

    // point at the first engine's drawn D5
    let page = pageInstance(container)
    let note = page.state.cards.osmd.result.notes.find(n => n.pitch == 74)
    note.el.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}))

    let readouts = () => [...container.querySelectorAll("[data-readout]")].map(el => el.textContent)
    expect(await waitFor(() => readouts()[0].startsWith("D5"))).toBe(true)
    readouts = readouts()
    expect(readouts[0]).toEqual("D5 · MIDI 74 · onset 2 beats · upper staff · voice 1")
    expect(readouts[1]).toEqual(readouts[0])
    expect(container.querySelectorAll(".score_note_active").length).toEqual(2)
  }, 30000)
})

// the ScoreEnginesPage instance rendered in container
function pageInstance(container) {
  let el = container.querySelector("[data-engine]")
  let fiber = el[Object.keys(el).find(key => key.startsWith("__reactFiber"))]
  while (fiber && !(fiber.stateNode instanceof ScoreEnginesPage)) {
    fiber = fiber.return
  }
  return fiber.stateNode
}

describe("scoreEnginesPath", function() {
  it("opens the page on the sheet music generator's piece, measures and hand", function() {
    expect(scoreEnginesPath({piece: "p1", startMeasure: 4, endMeasure: 9, hand: LEFT_HAND}))
      .toEqual("/score-engines?piece=p1&from=4&to=9&hand=lower")
    expect(scoreEnginesPath({piece: "p1", hand: RIGHT_HAND})).toEqual("/score-engines?piece=p1&hand=upper")
    expect(scoreEnginesPath({})).toEqual("/score-engines")
  })
})
