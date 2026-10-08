import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage, {SCORE_PROGRAMME} from "st/components/pages/score_page"
import ScoreCard from "st/components/score_card"
import {MISSING_ENGINE_SOURCE, FAILED_ENGINE_SOURCE} from "st/components/pages/sight_reading_page"
import {joinCard, markCard, joinable, MARK_CLASSES} from "st/score_render/card_join"
import {
  scrollTrack, trackX, scrollAdvance, scrollOffset, SCROLL_WAIT, MIN_SCROLL_ADVANCE, JUMP_LEAD_IN,
} from "st/score_render/card_scroll"
import {prepareCard} from "st/score_render/card_source"
import {placeBadges} from "st/score_render/card_badges"
import {loadScoreEngines} from "st/score_render/load"
import {STAVES, pieceSectionMeasures, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {sectionCard} from "st/measure_cards"
import {importMusicXMLPiece, addPiece} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {parseNote} from "st/music"
import {setAppStore} from "st/storage"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import staffStyles from "st/components/staff.module.css"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"
import scoreCardStyles from "st/components/score_card.module.css"

import {openTestStore, reverieOpening, pickupScore, noteXML} from "spec/helpers"

const SVG_NS = "http://www.w3.org/2000/svg"

// a drawn note as an engine hands it back, with its own element
let drawn = (pitch, onsetBeats, staff=1, voice=1) => ({
  id: `n${pitch}-${onsetBeats}-${staff}-${voice}`,
  pitch, onsetBeats, staff, voice,
  el: document.createElementNS(SVG_NS, "g"),
})

// a detection column as extractSectionColumns gives it
let column = (names, beat, {notation, extras}={}) => {
  let col = [...names]
  col.beat = beat
  col.notation = notation || names.map(() => ({tieTo: null}))
  col.extras = extras || []
  return col
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

describe("card badges", function() {
  let rect = (left, top, right, bottom) => ({left, top, right, bottom})

  it("places a badge over each bar, left to right, tinted over its span", function() {
    let badges = [{column: 0, label: "Bar 1", on: false}, {column: 2, label: "Bar 2", on: true}]
    let columnRects = [
      [rect(0, 10, 20, 30)],
      [],
      [rect(100, 5, 120, 30)],
      [rect(140, 10, 160, 35)],
    ]

    let placements = placeBadges(badges, columnRects)
    expect(placements).toEqual([
      {
        label: "Bar 1", on: false, left: 0, top: 0,
        tint: {left: 0, top: -1, width: 24, height: 42},
      },
      {
        label: "Bar 2", on: true, left: 96, top: 0,
        tint: {left: 96, top: -1, width: 68, height: 42},
      },
    ])
  })

  // joinCard leaves a column the engine didn't draw without heads, so a bar
  // is spanned by the heads it has, not by the slots of its first and last
  // columns
  it("spans a bar by its own drawn heads, whichever of its columns were joined", function() {
    let badges = [{column: 0, label: "Bar 1", on: false}, {column: 2, label: "Bar 2", on: true}]
    let columnRects = [
      [rect(0, 10, 20, 30)],
      [rect(40, 10, 60, 30)],
      [],
      [rect(140, 10, 160, 30)],
    ]

    let placements = placeBadges(badges, columnRects)
    expect(placements.map(p => [p.left, p.tint.left, p.tint.width])).toEqual([
      [0, 0, 64],
      [136, 136, 28],
    ])
  })

  // a bar the engine drew nothing of has no span of its own, and must not
  // land at the card's left edge nor read as the start of a new row
  it("sits a bar without drawn heads at the end of the bar before it, in the same row", function() {
    let badges = [{column: 0, label: "Bar 3", on: false}, {column: 2, label: "Bar 4", on: true}]
    let columnRects = [
      [rect(100, 10, 120, 30)],
      [rect(140, 10, 160, 30)],
      [],
      [],
    ]

    let placements = placeBadges(badges, columnRects)
    expect(placements.map(p => [p.left, p.top, p.tint.left, p.tint.width])).toEqual([
      [96, 0, 96, 68],
      [164, 0, 164, 0],
    ])
  })

  it("wraps to a new row once a bar's left is less than the previous bar's, its own top below the first row's bottom", function() {
    let badges = [
      {column: 0, label: "Bar 1", on: false},
      {column: 1, label: "Bar 2", on: false},
      {column: 2, label: "Bar 3", on: false},
    ]
    let columnRects = [
      [rect(500, 10, 520, 30)],
      [rect(0, 100, 20, 120)],
      [rect(50, 100, 70, 120)],
    ]

    let placements = placeBadges(badges, columnRects)
    expect(placements).toEqual([
      {
        label: "Bar 1", on: false, left: 496, top: 0,
        tint: {left: 496, top: 4, width: 28, height: 32},
      },
      {
        label: "Bar 2", on: false, left: 0, top: 54,
        tint: {left: 0, top: 94, width: 24, height: 32},
      },
      {
        label: "Bar 3", on: false, left: 46, top: 54,
        tint: {left: 46, top: 94, width: 28, height: 32},
      },
    ])
  })

  it("places nothing without any badges", function() {
    expect(placeBadges([], [[rect(0, 0, 10, 10)]])).toEqual([])
  })
})

describe("card join", function() {
  it("finds each column's notes among the drawn notes by onset and pitch", function() {
    let notes = [drawn(60, 0), drawn(62, 1), drawn(64, 2), drawn(62, 2)]
    let columns = [column(["C4"], 0), column(["D4"], 1), column(["D4", "E4"], 2)]
    let join = joinCard(columns, notes)

    expect(join.heads[0]).toEqual([notes[0].el])
    expect(join.heads[1]).toEqual([notes[1].el])
    // a pitch drawn at another onset is another column's
    expect(join.heads[2]).toEqual([notes[3].el, notes[2].el])
    expect(join.unmatched).toEqual([])
  })

  it("joins every head of a chord to its one column", function() {
    let notes = [drawn(48, 4, 2), drawn(52, 4, 2), drawn(55, 4, 2), drawn(72, 4, 1)]
    let join = joinCard([column(["C3", "E3", "G3", "C5"], 4)], notes)
    expect(new Set(join.heads[0])).toEqual(new Set(notes.map(note => note.el)))
  })

  it("marks the heads a tie runs on to with the note they sound", function() {
    // C4 from beat 0 tied to 2, then on to 4; a new C4 is struck at 6
    let notes = [drawn(60, 0), drawn(60, 2), drawn(60, 4), drawn(60, 6)]
    let columns = [
      column(["C4"], 0, {notation: [{tieTo: 2}], extras: [
        {kind: "head", name: "C4", beat: 2, tieTo: 4},
        {kind: "head", name: "C4", beat: 4, tieTo: null},
      ]}),
      column(["C4"], 6),
    ]
    let join = joinCard(columns, notes)

    expect(join.heads[0]).toEqual([notes[0].el, notes[1].el, notes[2].el])
    expect(join.heads[1]).toEqual([notes[3].el])
    expect(join.unmatched).toEqual([])
  })

  it("tells a tied head from the other voice's note struck at its beat by voice", function() {
    // voice 5's C4 is tied over onto beat 2, where voice 6 strikes a C4
    let tiedFrom = drawn(60, 0, 2, 5)
    let tiedTo = drawn(60, 2, 2, 5)
    let struck = drawn(60, 2, 2, 6)
    let columns = [
      column(["C4"], 0, {notation: [{tieTo: 2, voice: 5}]}),
      column(["C4"], 2, {notation: [{tieTo: null, voice: 6}]}),
    ]

    let join = joinCard(columns, [tiedFrom, struck, tiedTo])
    expect(join.heads).toEqual([[tiedFrom.el, tiedTo.el], [struck.el]])
  })

  it("joins a pitch both staves or two voices draw at one onset to its one column note", function() {
    let notes = [drawn(60, 1, 1, 1), drawn(60, 1, 2, 5), drawn(58, 1, 2, 5), drawn(58, 1, 2, 6)]
    let join = joinCard([column(["Bb3", "C4"], 1)], notes)

    expect(new Set(join.heads[0])).toEqual(new Set(notes.map(note => note.el)))
  })

  it("keeps the notes of both staves apart by pitch", function() {
    let upper = drawn(76, 0, 1)
    let lower = drawn(48, 0, 2)
    let join = joinCard([column(["C3", "E5"], 0)], [upper, lower])
    expect(join.heads[0]).toEqual([lower.el, upper.el])
  })

  it("meets a drawn onset a rounding away from the column's beat", function() {
    let notes = [drawn(64, 1 / 3 + 1e-9), drawn(64, 2 / 3 - 1e-9)]
    let join = joinCard([column(["E4"], 1 / 3), column(["E4"], 2 / 3)], notes)
    expect(join.heads).toEqual([[notes[0].el], [notes[1].el]])
  })

  it("leaves drawn notes no column plays, and columns nothing is drawn for, unjoined", function() {
    // a grace note and a note outside the staff's range are drawn, but no
    // column plays them; the column at beat 3 isn't drawn at all
    let grace = drawn(61, 0)
    let high = drawn(100, 1)
    let played = drawn(60, 0)
    let join = joinCard([column(["C4"], 0), column(["D4"], 3)], [grace, played, high])

    expect(join.heads).toEqual([[played.el], []])
    expect(join.unmatched).toEqual([grace, high])
  })

  it("only joins columns that carry the score's beats", function() {
    expect(joinable([column(["C4"], 0), column(["D4"], 1)])).toBe(true)
    expect(joinable([["C4"], ["D4"]])).toBe(false)
    // nothing to join on a card of rests
    expect(joinable([])).toBe(true)
  })

  it("marks the head column current, those before it done and the missed ones missed", function() {
    let notes = [drawn(60, 0), drawn(62, 1), drawn(64, 2), drawn(65, 3)]
    let columns = notes.map(note => column([["C4", "D4", "E4", "F4"][note.onsetBeats]], note.onsetBeats))
    let join = joinCard(columns, notes)
    let classes = () => notes.map(note => [...note.el.classList].sort().join(" "))

    markCard(join, {head: 2, missed: [1, 2]})
    expect(classes()).toEqual([
      MARK_CLASSES.done,
      [MARK_CLASSES.done, MARK_CLASSES.missed].sort().join(" "),
      [MARK_CLASSES.current, MARK_CLASSES.missed].sort().join(" "),
      "",
    ])

    // a new pass of the card
    markCard(join, {head: 0, missed: []})
    expect(classes()).toEqual([MARK_CLASSES.current, "", "", ""])

    markCard(join, {head: null, missed: []})
    expect(classes()).toEqual(["", "", "", ""])
  })

  it("counts the drawn notes' onsets on the song model's clock when handed it", function() {
    let xml = pickupScore()
    let own = prepareCard(xml, {fromMeasure: 0, toMeasure: 2, hand: "both"})
    let song = prepareCard(xml, {fromMeasure: 0, toMeasure: 2, hand: "both", measureStarts: [0, 4, 10]})

    let onsets = card => [...card.notes.values()].map(note => note.onsetBeats)
    // the pickup's one beat, then 3/4 bars
    expect(onsets(own)).toEqual([0, 1, 2, 3, 1, 4, 4, 4, 4])
    expect(onsets(song)).toEqual([0, 4, 5, 6, 4, 10, 10, 10, 10])
    expect(song.measureStarts).toEqual([0, 4, 10])
  })

  describe("on a card OSMD drew of an imported score", function() {
    let bundle

    beforeAll(async function() {
      bundle = await loadScoreEngines()
    })

    it("joins every drawn head to the column that plays it, ties and doubled voices included", async function() {
      let xml = reverieOpening()
      let song = parseMusicXML(xml)
      let grand = STAVES.find(staff => staff.name == "grand")
      let measures = pieceSectionMeasures(grand, {startMeasure: 2, endMeasure: 4, hand: BOTH_HANDS}, song)
      let card = sectionCard(measures)

      for (let width of [644, 926]) {
        let result = await bundle.ENGINES.osmd.renderCard({
          musicXML: xml, fromMeasure: 2, toMeasure: 4, hand: "both", width,
          measureStarts: song.metadata.measureStarts,
        })

        let join = joinCard(card.columns, result.notes)
        expect(join.unmatched).toEqual([])
        expect(join.heads.every(heads => heads.length > 0)).toBe(true)

        // the G4 of measure 2 and its tied head
        let g4 = card.columns.findIndex(col => col.beat == 3.5)
        expect(card.columns[g4]).toEqual(jasmine.arrayContaining(["G4"]))
        expect(join.heads[g4].length).toEqual(2)

        // measure 2's first beat: the ostinato's Bb3 and the whole Bb3 of the
        // other voice
        expect(join.heads[0].length).toEqual(2)
        expect(result.notes.filter(note => join.heads[0].includes(note.el))
          .every(note => note.pitch == parseNote("Bb3"))).toBe(true)
      }
    })

    it("joins one hand drawn alone", async function() {
      let xml = reverieOpening()
      let song = parseMusicXML(xml)
      let grand = STAVES.find(staff => staff.name == "grand")
      let measures = pieceSectionMeasures(grand, {startMeasure: 4, endMeasure: 4, hand: RIGHT_HAND}, song)
      let card = sectionCard(measures)

      let result = await bundle.ENGINES.osmd.renderCard({
        musicXML: xml, fromMeasure: 4, toMeasure: 4, hand: "upper", width: 644,
        measureStarts: song.metadata.measureStarts,
      })

      let join = joinCard(card.columns, result.notes)
      expect(card.columns.map(col => [...col])).toEqual([["G5"], ["D5"]])
      expect(join.heads.map(heads => heads.length)).toEqual([1, 1])
      expect(join.unmatched).toEqual([])
    })
  })
})

describe("card scroll", function() {
  // drawn notes whose heads sit at the given x, as a system lays them out
  let at = new Map()
  let placed = (x, ...args) => {
    let note = drawn(...args)
    at.set(note.el, x)
    return note
  }
  let xOf = el => at.get(el)

  it("places each column at its own drawn heads, never at the heads its ties run on to", function() {
    // C4 at beat 0 tied to beat 2; the second voice's E3 struck at 1, a
    // grace note drawn just before beat 1's head
    let notes = [
      placed(100, 60, 0), placed(152, 60, 2), placed(98, 48, 0, 2),
      placed(130, 52, 1, 2), placed(120, 61, 1),
      placed(150, 50, 2, 2),
    ]
    let columns = [
      column(["C3", "C4"], 0, {notation: [{tieTo: null}, {tieTo: 2}], extras: [{kind: "head", name: "C4", beat: 2, tieTo: null}]}),
      column(["E3"], 1),
      column(["D3"], 2),
    ]
    let join = joinCard(columns, notes)
    expect(join.unmatched).toEqual([notes[4]])

    let track = scrollTrack(columns, join, notes, xOf)
    expect(track.points).toEqual([[0, 99], [1, 130], [2, 150]])
    expect(trackX(track, 0)).toEqual(99)
    expect(trackX(track, 1)).toEqual(130)
    expect(trackX(track, 2)).toEqual(150)
    // the mean gap between drawn onsets is the slider's unit
    expect(track.unit).toEqual((150 - 99) / 2)
  })

  it("places a column with no drawn head between the drawn onsets either side of it", function() {
    let notes = [placed(100, 60, 0), placed(200, 64, 2), placed(260, 65, 3)]
    let columns = [column(["C4"], 0), column(["D4"], 1), column(["E4"], 2), column(["F4"], 3), column(["G4"], 4)]
    let join = joinCard(columns, notes)
    expect(join.heads[1]).toEqual([])
    expect(join.heads[4]).toEqual([])

    let track = scrollTrack(columns, join, notes, xOf)
    expect(trackX(track, 1)).toEqual(150)
    // past the last drawn onset along the drawing's mean pace
    expect(trackX(track, 4)).toBeCloseTo(260 + (260 - 100) / 3, 6)
    expect(trackX(track, -1)).toBeCloseTo(100 - (260 - 100) / 3, 6)

    // it is scrolled to and past like any other column
    let unit = track.unit
    expect(scrollAdvance(track, columns[0], columns[1])).toBeCloseTo(50 / unit, 6)
    expect(scrollAdvance(track, columns[1], columns[2])).toBeCloseTo(50 / unit, 6)
    expect(scrollAdvance(track, columns[3], columns[4])).toBeGreaterThan(0)
  })

  it("moves the system on by the drawn gap to the column that comes next", function() {
    let notes = [placed(100, 60, 0), placed(140, 62, 1), placed(220, 64, 2), placed(222, 65, 3)]
    let columns = notes.map(note => column([["C4", "D4", "E4", "F4"][note.onsetBeats]], note.onsetBeats))
    let track = scrollTrack(columns, joinCard(columns, notes), notes, xOf)
    let unit = track.unit

    expect(scrollAdvance(track, columns[0], columns[1])).toBeCloseTo(40 / unit, 6)
    expect(scrollAdvance(track, columns[1], columns[2])).toBeCloseTo(80 / unit, 6)
    // columns drawn all but on top of each other are still passed one by one
    expect(scrollAdvance(track, columns[2], columns[3])).toBeCloseTo(Math.max(MIN_SCROLL_ADVANCE, 2 / unit), 6)

    // the next card not yet picked: the next drawn onset
    expect(scrollAdvance(track, columns[1], [])).toBeCloseTo(80 / unit, 6)
    // the drawing's last column with no next known: the system jumps
    expect(scrollAdvance(track, columns[3], [])).toEqual(JUMP_LEAD_IN)
  })

  describe("a next card that doesn't follow on", function() {
    // eight bars of quarters, a unit apart, drilled in cards of two bars
    let notes = [...Array(32).keys()].map(beat => placed(100 + 30 * beat, 60, beat))
    let columns = notes.map(note => column(["C4"], note.onsetBeats))
    let track = scrollTrack(columns, joinCard(columns, notes), notes, xOf)

    it("keeps scrolling on to the adjacent card", function() {
      expect(scrollAdvance(track, columns[7], columns[8])).toBeCloseTo(1, 6)
    })

    it("keeps scrolling on past the head a column's tie runs on to", function() {
      let tied = [placed(100, 60, 0), placed(130, 60, 1), placed(160, 62, 2)]
      let columns = [
        column(["C4"], 0, {notation: [{tieTo: 1}], extras: [{kind: "head", name: "C4", beat: 1, tieTo: null}]}),
        column(["D4"], 2),
      ]
      let track = scrollTrack(columns, joinCard(columns, tied), tied, xOf)
      expect(scrollAdvance(track, columns[0], columns[1])).toBeCloseTo(60 / track.unit, 6)
    })

    it("jumps forward to a later card with the lead-in, not through the bars between", function() {
      let advance = scrollAdvance(track, columns[7], columns[24])
      expect(advance).toBeGreaterThan(SCROLL_WAIT)
      expect(advance).toBeLessThanOrEqual(JUMP_LEAD_IN)
    })

    it("jumps back to an earlier card with the lead-in", function() {
      let advance = scrollAdvance(track, columns[23], columns[8])
      expect(advance).toBeGreaterThan(SCROLL_WAIT)
      expect(advance).toBeLessThanOrEqual(JUMP_LEAD_IN)
    })

    it("jumps back to the first card as the in-order walk wraps", function() {
      let advance = scrollAdvance(track, columns[31], columns[0])
      expect(advance).toBeGreaterThan(SCROLL_WAIT)
      expect(advance).toBeLessThanOrEqual(JUMP_LEAD_IN)

      // the first column comes on the lead-in right of where the last one was
      let before = scrollOffset(track, 31, 0.8, 322) + trackX(track, 31)
      let after = scrollOffset(track, 0, 0.8 + advance, 322) + trackX(track, 0)
      expect(after - before).toBeCloseTo(JUMP_LEAD_IN * track.unit, 6)
    })
  })

  it("puts the head column on the hit line while the slider waits, and after it as it runs down", function() {
    let notes = [placed(100, 60, 0), placed(140, 62, 1)]
    let columns = [column(["C4"], 0), column(["D4"], 1)]
    let track = scrollTrack(columns, joinCard(columns, notes), notes, xOf)

    // the system's translation plus the column's x is where it is drawn
    expect(scrollOffset(track, 1, SCROLL_WAIT, 322) + 140).toEqual(322)
    expect(scrollOffset(track, 1, SCROLL_WAIT + 2, 322) + 140).toEqual(322 + 2 * track.unit)

    // the column moves on without the system jumping: the slider gains the
    // gap it moved on by
    let before = scrollOffset(track, 0, 0.8, 322)
    let after = scrollOffset(track, 1, 0.8 + scrollAdvance(track, columns[0], columns[1]), 322)
    expect(after).toBeCloseTo(before, 6)
  })
})

describe("score card overview", function() {
  let container, root

  let mount = props => {
    container = document.createElement("div")
    container.style.width = "600px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(ScoreCard, {
        musicXML: pickupScore(), fromMeasure: 0, toMeasure: 2, hand: "both", width: 500,
        overview: true, ...props,
      }))
    })
    return container
  }

  afterEach(function() {
    flushSync(() => root.unmount())
    container.remove()
  })

  it("draws a rect per shaded band and an HTML label per shade, clickable, with no [data-score-card]", async function() {
    let onShade = jasmine.createSpy("onShade")
    let shades = [
      {id: "a", from: 1, to: 1, level: 3, on: true, label: "I"},
      {id: "b", from: 2, to: 2, level: 1, on: false, label: "II"},
    ]
    mount({shades, onShade})

    await waitFor(() => container.querySelector("[data-score-overview] svg rect[data-shade]"),
      {message: "the shaded overview"})

    expect(container.querySelector("[data-score-card]")).toBe(null)
    expect(container.querySelector("[data-score-overview]")).toBeTruthy()

    let rects = [...container.querySelectorAll("rect[data-shade]")]
    expect(rects.map(el => el.getAttribute("data-shade")).sort()).toEqual(["a", "b"])
    for (let rect of rects) {
      expect(rect.hasAttribute("fill")).toBe(false)
      expect(rect.hasAttribute("stroke")).toBe(false)
    }

    let labels = [...container.querySelectorAll("button")]
    expect(labels.map(el => el.textContent).sort()).toEqual(["I", "II"])
    for (let label of labels) {
      expect(parseFloat(getComputedStyle(label).fontSize)).toBeGreaterThanOrEqual(11)
    }

    rects.find(el => el.getAttribute("data-shade") == "a").dispatchEvent(new MouseEvent("click", {bubbles: true}))
    expect(onShade).toHaveBeenCalledWith("a")

    labels.find(el => el.textContent == "II").dispatchEvent(new MouseEvent("click", {bubbles: true}))
    expect(onShade).toHaveBeenCalledWith("b")
  })

  it("restyles in place without redrawing when the shade on changes", async function() {
    let shades = [{id: "a", from: 1, to: 1, level: 2, on: false, label: "I"}]
    let el = mount({shades})

    await waitFor(() => el.querySelector("rect[data-shade]"), {message: "the shaded overview"})
    let svg = el.querySelector("svg")
    let rect = el.querySelector("rect[data-shade]")
    expect(rect.getAttribute("class")).not.toContain("on")

    flushSync(() => root.render(React.createElement(ScoreCard, {
      musicXML: pickupScore(), fromMeasure: 0, toMeasure: 2, hand: "both", width: 500,
      overview: true, shades: [{...shades[0], on: true}],
    })))

    expect(el.querySelector("svg")).toBe(svg) // the same element: no redraw
    let restyled = el.querySelector("rect[data-shade]")
    expect(restyled.getAttribute("class")).toContain("on")
  })
})

describe("score card bar clicks", function() {
  let container, root, card

  let mount = props => {
    container = document.createElement("div")
    container.style.width = "600px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(ScoreCard, {
        ref: c => { card = c },
        musicXML: pickupScore(), fromMeasure: 0, toMeasure: 2, hand: "both", width: 500,
        ...props,
      }))
    })
    return container
  }

  afterEach(function() {
    flushSync(() => root.unmount())
    container.remove()
    card = null
  })

  // the client coordinates of a measure's box centre, through the drawn
  // svg's own natural size (score_card.jsx's naturalSize) and its
  // getBoundingClientRect, as ScoreCard#onBarClick converts the other way
  let clickMeasure = (svg, measure) => {
    let rect = svg.getBoundingClientRect()
    let width = svg.width.baseVal.value
    let height = svg.height.baseVal.value
    let clientX = rect.left + (measure.box.x + measure.box.width / 2) * rect.width / width
    let clientY = rect.top + (measure.box.y + measure.box.height / 2) * rect.height / height
    svg.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX, clientY}))
  }

  it("calls onBar with the printed number of the bar clicked", async function() {
    let onBar = jasmine.createSpy("onBar")
    let drawn
    mount({onBar, onDrawn: ({result}) => { drawn = result }})
    await waitFor(() => drawn, {message: "the card to draw"})

    clickMeasure(drawn.svg, drawn.measures.find(m => m.number == 1))
    expect(onBar).toHaveBeenCalledWith(1)

    clickMeasure(drawn.svg, drawn.measures.find(m => m.number == 0))
    expect(onBar).toHaveBeenCalledWith(0)
  })

  it("ignores a click outside every bar", async function() {
    let onBar = jasmine.createSpy("onBar")
    let drawn
    mount({onBar, onDrawn: ({result}) => { drawn = result }})
    await waitFor(() => drawn, {message: "the card to draw"})

    let bottom = Math.max(...drawn.measures.map(m => m.box.y + m.box.height))
    let height = drawn.measures[0].box.height
    let rect = drawn.svg.getBoundingClientRect()
    let width = drawn.svg.width.baseVal.value
    let naturalHeight = drawn.svg.height.baseVal.value
    let clientX = rect.left + (drawn.measures[0].box.x + 1) * rect.width / width
    let clientY = rect.top + (bottom + 3 * height) * rect.height / naturalHeight
    drawn.svg.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX, clientY}))

    expect(onBar).not.toHaveBeenCalled()
  })

  it("has a pointer cursor only with onBar", async function() {
    let onBar = jasmine.createSpy("onBar")
    let drawn
    mount({onBar, onDrawn: ({result}) => { drawn = result }})
    await waitFor(() => drawn, {message: "the card to draw"})
    expect(container.querySelector(`.${scoreCardStyles.bars_clickable}`)).toBeTruthy()

    flushSync(() => root.unmount())
    container.remove()

    let drawnWithout
    mount({onDrawn: ({result}) => { drawnWithout = result }})
    await waitFor(() => drawnWithout, {message: "the card to draw"})
    expect(container.querySelector(`.${scoreCardStyles.bars_clickable}`)).toBe(null)
    expect(() => clickMeasure(drawnWithout.svg, drawnWithout.measures[0])).not.toThrow()
  })

  it("never reports a bar on an overview", async function() {
    let onBar = jasmine.createSpy("onBar")
    let onShade = jasmine.createSpy("onShade")
    let shades = [{id: "a", from: 1, to: 1, level: 3, on: true, label: "I"}]
    mount({overview: true, shades, onShade, onBar})
    await waitFor(() => card.result, {message: "the overview to draw"})

    let bar2 = card.result.measures.find(m => m.number == 2)
    clickMeasure(card.result.svg, bar2)
    expect(onBar).not.toHaveBeenCalled()

    let rect = container.querySelector('rect[data-shade="a"]')
    rect.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    expect(onShade).toHaveBeenCalledWith("a")
  })
})

describe("score page engine card", function() {
  let container, root, page, store, previousStore, savedStorage
  const STORAGE_KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

  beforeEach(async function() {
    savedStorage = STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of STORAGE_KEYS) {
      window.localStorage.removeItem(key)
    }

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
      if (value == null) {
        window.localStorage.removeItem(key)
      } else {
        window.localStorage.setItem(key, value)
      }
    }
  })

  // these specs reach the trainer's internals (the staff, the engine card,
  // the drawer) directly, the same pattern as today's {...SCORE_PROGRAMME,
  // engine: null}: with ScoreView null the trainer renders its own grid and
  // today's Begin/Rest, never the score-first view (see
  // SightReadingPage#inScoreView/restPauses)
  let renderScorePage = (props={}) => {
    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {
          ref: p => page = p,
          programme: {...SCORE_PROGRAMME, ScoreView: null},
          ...props,
        })))
    })
    flushSync(() => {})
    return container
  }

  let drillPiece = async (xml, settings) => {
    let {piece} = await importMusicXMLPiece("piece.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: "all", ...settings,
    }))
    return piece
  }

  let play = notes => {
    for (let note of notes) {
      flushSync(() => page.pressNote(note))
    }
    for (let note of notes) {
      flushSync(() => page.releaseNote(note))
    }
  }

  let cardDrawn = () => waitFor(() =>
    container.querySelector(`[data-score-card] .${MARK_CLASSES.current}`), {message: "the engine card"})

  let marked = cls => [...container.querySelectorAll(`[data-score-card] .${cls}`)]

  // the drawn heads of the column the page has at the head of the drill
  let headElements = () => {
    let card = container.querySelector("[data-score-card]")
    return [...card.querySelectorAll(`.${MARK_CLASSES.current}`)]
  }

  it("draws the card from the piece's score and moves the marks as it is played", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    let el = renderScorePage()
    await cardDrawn()

    // the app's own staff isn't drawn
    expect(el.querySelector(`.${staffStyles.staff_notes}`)).toBe(null)
    expect(el.querySelector("[data-score-card] svg")).not.toBe(null)

    flushSync(() => page.beginSession())

    let columns = page.currentCard().card.columns
    expect(page.state.notes.currentColumn().cardIndex).toEqual(0)
    let first = headElements()
    expect(first.length).toEqual(2)

    play(page.state.notes.currentColumn())
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(first.every(head => head.classList.contains(MARK_CLASSES.done))).toBe(true)
    expect(first.some(head => head.classList.contains(MARK_CLASSES.current))).toBe(false)

    // a wrong note is a miss on the column, which doesn't advance
    let second = headElements()
    play(["C2"])
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(second.every(head => head.classList.contains(MARK_CLASSES.missed))).toBe(true)
    expect(second.every(head => head.classList.contains(MARK_CLASSES.current))).toBe(true)

    play(page.state.notes.currentColumn())
    expect(second.every(head =>
      head.classList.contains(MARK_CLASSES.done) && head.classList.contains(MARK_CLASSES.missed))).toBe(true)

    // the rest of the card, back round to its start
    for (let idx = 2; idx < columns.length; idx++) {
      play(page.state.notes.currentColumn())
    }

    expect(page.state.notes.currentColumn().cardIndex).toEqual(0)
    expect(page.state.stats.hits).toEqual(columns.length)
    expect(page.state.stats.misses).toEqual(1)
    expect(marked(MARK_CLASSES.done).length).toEqual(0)
    expect(marked(MARK_CLASSES.missed).length).toEqual(0)
    expect(headElements()).toEqual(first)
  })

  // the misses of one MIDI packet are judged against the head each of them
  // saw, so a packet that slips on one column, completes it and slips on the
  // next must mark both: the second mark used to be built over the state as
  // it stood before the packet, dropping the first
  it("marks every column a MIDI packet misses", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    renderScorePage()
    await cardDrawn()

    flushSync(() => page.beginSession())
    let first = headElements()
    let column = [...page.state.notes.currentColumn()]

    flushSync(() => {
      page.pressNote("C#1")
      for (let note of column) { page.pressNote(note) }
      page.pressNote("D#1")
    })

    expect(page.state.engineMissed).toEqual([0, 1])
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(first.every(head => head.classList.contains(MARK_CLASSES.missed))).toBe(true)
    expect(headElements().every(head => head.classList.contains(MARK_CLASSES.missed))).toBe(true)
  })

  // the marks of the pass just finished are cleared with the hit that wraps
  // the card, so a miss judged after it in the same MIDI packet belongs to
  // the new pass and keeps its mark, as it does when the two are spread out
  it("keeps the mark of a miss judged after a card-wrapping hit in one packet", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    renderScorePage()
    await cardDrawn()

    flushSync(() => page.beginSession())
    let first = headElements()
    let columns = page.currentCard().card.columns

    for (let idx = 0; idx < columns.length - 1; idx++) {
      play(page.state.notes.currentColumn())
    }
    expect(page.state.notes.currentColumn().cardIndex).toEqual(columns.length - 1)

    let last = [...page.state.notes.currentColumn()]
    flushSync(() => {
      for (let note of last) { page.pressNote(note) }
      page.pressNote("C#1")
    })

    expect(page.state.notes.currentColumn().cardIndex).toEqual(0)
    expect(page.state.engineMissed).toEqual([0])
    expect(first.every(head => head.classList.contains(MARK_CLASSES.missed))).toBe(true)
  })

  it("keeps drawing from the score after a section of rests alone", async function() {
    let piece = await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 1})
    let el = renderScorePage()
    await waitFor(() => el.querySelector("[data-score-card] svg"), {message: "the card of rests"})
    expect(page.currentCard().card.columns.length).toEqual(0)

    flushSync(() => page.setGenerator(page.state.currentGenerator, {
      ...page.state.currentGeneratorSettings, piece: piece.id, endMeasure: 4,
    }))
    await cardDrawn()
    expect(page.state.engineSource.status).toEqual("ready")
    expect(el.querySelector(`.${staffStyles.staff_notes}`)).toBe(null)
  })

  it("draws each numbered card of the section in turn", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4, measuresPerCard: "2"})
    let el = renderScorePage()
    await cardDrawn()

    let {card, number} = page.currentCard()
    expect([card.startMeasure, card.endMeasure, number]).toEqual([2, 3, 1])
    let firstSvg = el.querySelector("[data-score-card] svg")

    flushSync(() => page.beginSession())
    play(["C2"])
    for (let idx = 0; idx < card.columns.length; idx++) {
      play(page.state.notes.currentColumn())
    }

    ;({card, number} = page.currentCard())
    expect([card.startMeasure, card.endMeasure, number]).toEqual([4, 4, 2])
    await waitFor(() => el.querySelector("[data-score-card] svg") != firstSvg && !page.state.engineMissed.length &&
      el.querySelector(`[data-score-card] .${MARK_CLASSES.current}`), {message: "the next card"})
    expect(marked(MARK_CLASSES.missed).length).toEqual(0)
    expect(marked(MARK_CLASSES.done).length).toEqual(0)
  })

  it("draws a whole section of four measures as one card", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    let el = renderScorePage()
    await cardDrawn()

    let {card, number} = page.currentCard()
    expect([card.startMeasure, card.endMeasure, number]).toEqual([1, 4, null])
    expect(el.textContent).toContain("measures 1–4")
  })

  // the programme drawer, opened
  let openDrawer = el => {
    flushSync(() => el.querySelector("button[aria-label=\"Programme\"]").click())
    return el.querySelector(`.${drawerStyles.drawer}[aria-label="Programme"]`)
  }

  let perCardPicker = drawer => drawer.querySelector("[role=\"spinbutton\"][aria-label=\"measures per card\"]")

  // Pending: the score page has no Programme drawer any more (Drawer: null);
  // its "Bars per card" stepper moves to the setup pane (score-first sheet
  // music plan, build 5), where this clamping behaviour is re-covered
  xit("picks a card size up to the whole section for the score's cards, in scroll mode too", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4, measuresPerCard: "2"})
    let el = renderScorePage()
    await cardDrawn()

    let drawer = openDrawer(el)
    let input = perCardPicker(drawer)
    expect(input.getAttribute("aria-valuemax")).toEqual("4")
    expect(drawer.textContent).toContain("of 4")
    expect(drawer.textContent).not.toContain("Cards stop")

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "4")
    flushSync(() => input.dispatchEvent(new Event("input", {bubbles: true})))
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})))
    flushSync(() => {})

    expect(page.state.currentGeneratorSettings.measuresPerCard).toEqual(4)
    let {card} = page.currentCard()
    expect(card.measures).toEqual([1, 2, 3, 4])
    await waitFor(() => el.querySelector("[data-score-card] svg"), {message: "the four measure card"})

    // and keeps it in scroll mode
    flushSync(() => page.setMode("scroll"))
    flushSync(() => {})
    expect(perCardPicker(drawer).getAttribute("aria-valuemax")).toEqual("4")
    expect(perCardPicker(drawer).value).toEqual("4")
    expect(drawer.textContent).not.toContain("Cards stop")
    expect(page.currentCard().card.measures).toEqual([1, 2, 3, 4])
  })

  it("draws a piece stored without its score on the app's staff, saying how to draw it from the score", async function() {
    let {piece} = await addPiece("Rêverie", parseMusicXML(reverieOpening()), store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 2, endMeasure: 4, hand: BOTH_HANDS, measuresPerCard: "all",
    }))

    let el = renderScorePage()
    await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`), {message: "the app's staff"})

    expect(el.querySelector("[data-score-card]")).toBe(null)
    expect(el.textContent).toContain(MISSING_ENGINE_SOURCE)

    // and it is still played as before
    flushSync(() => page.beginSession())
    play(page.state.notes.currentColumn())
    expect(page.state.stats.hits).toEqual(1)
  })

  // the scroll mode's system on the page, with its hit line
  let systemDrawn = () => waitFor(() =>
    container.querySelector("[data-score-card] [data-hit-line]") &&
    container.querySelector(`[data-score-card] .${MARK_CLASSES.current}`), {message: "the engine's system"})

  let centre = el => {
    let rect = el.getBoundingClientRect()
    return rect.left + rect.width / 2
  }

  // how far right of the hit line the head column is: the middle of the
  // heads struck at its beat (a chord's heads, two voices' heads side by
  // side), never those its ties run on to
  let headFromLine = () => {
    let card = page.staff
    let head = card.props.head
    let beat = card.props.columns[head].beat
    let struck = card.result.notes
      .filter(note => Math.abs(note.onsetBeats - beat) < 1e-6 && card.cardJoin.heads[head].includes(note.el))
      .map(note => centre(note.el))
    let line = container.querySelector("[data-hit-line]")
    return struck.reduce((sum, x) => sum + x, 0) / struck.length - centre(line)
  }

  // runs the scroll's slider down until it waits on the head column
  let settle = async () => {
    page.state.slider.speed = 20
    await waitFor(() => page.state.slider.value == SCROLL_WAIT && !page.state.slider.animating,
      {message: "the slider to wait"})
  }

  let scrollPiece = async (xml, settings) => {
    let piece = await drillPiece(xml, settings)
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    return piece
  }

  it("draws the whole section on one line in scroll mode, the head column waiting on the hit line", async function() {
    await scrollPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    let el = renderScorePage()
    await systemDrawn()

    expect(page.state.mode).toEqual("scroll")
    expect(el.querySelector(`.${staffStyles.staff_notes}`)).toBe(null)
    expect(el.textContent).not.toContain(MISSING_ENGINE_SOURCE)
    // one card of the whole section
    let {card, number} = page.currentCard()
    expect([card.startMeasure, card.endMeasure, number]).toEqual([1, 4, null])

    await settle()
    expect(Math.abs(headFromLine())).toBeLessThan(1)
  })

  it("judges the column on the hit line: a hit moves the system on, a wrong note marks it missed", async function() {
    await scrollPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    let el = renderScorePage()
    await systemDrawn()
    await settle()
    let svg = el.querySelector("[data-score-card] svg")

    flushSync(() => page.beginSession())
    let first = headElements()
    let x = centre(first[0])

    play(page.state.notes.currentColumn())
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(page.state.stats.hits).toEqual(1)
    expect(first.every(head => head.classList.contains(MARK_CLASSES.done))).toBe(true)
    // the system hasn't moved yet: the next column comes on towards the line
    expect(Math.abs(centre(first[0]) - x)).toBeLessThan(0.5)
    expect(headFromLine()).toBeGreaterThan(5)

    // nor on a hit while it is still moving
    expect(page.state.slider.animating).toBe(true)
    play(page.state.notes.currentColumn())
    expect(page.state.notes.currentColumn().cardIndex).toEqual(2)
    expect(Math.abs(centre(first[0]) - x)).toBeLessThan(0.5)

    await settle()
    expect(centre(first[0])).toBeLessThan(x - 5)
    expect(Math.abs(headFromLine())).toBeLessThan(1)

    let second = headElements()
    play(["C2"])
    expect(page.state.notes.currentColumn().cardIndex).toEqual(2)
    expect(page.state.stats.misses).toEqual(1)
    expect(second.every(head =>
      head.classList.contains(MARK_CLASSES.missed) && head.classList.contains(MARK_CLASSES.current))).toBe(true)

    // drawn once: the drill only moves the system and its marks
    expect(el.querySelector("[data-score-card] svg")).toBe(svg)
  })

  it("counts a column that scrolls past the line unplayed as missed, but not at rest", async function() {
    await scrollPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    renderScorePage()
    await systemDrawn()
    await settle()

    // at rest
    let resting = headElements()
    flushSync(() => page.state.slider.onLoop())
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(page.state.stats.misses).toEqual(0)
    expect(resting.some(head => head.classList.contains(MARK_CLASSES.missed))).toBe(false)

    flushSync(() => page.beginSession())
    let passing = headElements()
    flushSync(() => page.state.slider.onLoop())
    flushSync(() => {})
    expect(page.state.notes.currentColumn().cardIndex).toEqual(2)
    expect(page.state.stats.misses).toEqual(1)
    expect(passing.every(head =>
      head.classList.contains(MARK_CLASSES.missed) && head.classList.contains(MARK_CLASSES.done))).toBe(true)

    // Rest ends the session
    flushSync(() => page.toggleSession())
    expect(page.state.session).toBe(false)
    flushSync(() => page.state.slider.onLoop())
    expect(page.state.stats.misses).toEqual(1)
  })

  it("waits on the column coming on however long a frame runs past the line", async function() {
    await scrollPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    renderScorePage()
    await systemDrawn()
    await settle()
    flushSync(() => page.beginSession())

    // frames run by hand, the second a whole second after the first
    let frames = []
    spyOn(window, "requestAnimationFrame").and.callFake(frame => frames.push(frame))
    let step = time => flushSync(() => frames.shift()(time))

    play(page.state.notes.currentColumn())
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(page.state.slider.value).toBeGreaterThan(SCROLL_WAIT)
    step(0)
    step(1000)

    expect(page.state.slider.value).toEqual(SCROLL_WAIT)
    expect(page.state.slider.animating).toBe(false)
    expect(frames).toEqual([])
    expect(page.state.notes.currentColumn().cardIndex).toEqual(1)
    expect(page.state.stats.misses).toEqual(0)
  })

  it("scrolls on past a column the engine drew no head for", async function() {
    await scrollPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})

    // the engine's system with the heads of the section's second column left
    // out, each drawn head a mark 30px along a beat
    let skipped
    let loadEngines = async () => {
      let bundle = await loadScoreEngines()
      let osmd = bundle.ENGINES.osmd
      return {...bundle, ENGINES: {...bundle.ENGINES, osmd: {...osmd, renderSystem: async opts => {
        let {notes} = await osmd.renderSystem(opts)
        let beats = [...new Set(notes.map(note => note.onsetBeats))].sort((a, b) => a - b)
        skipped = page.currentCard().card.columns[1].beat
        let svg = document.createElementNS(SVG_NS, "svg")
        svg.setAttribute("width", "2000")
        svg.setAttribute("height", "100")
        let kept = notes.filter(note => note.onsetBeats != skipped).map(note => {
          let el = document.createElementNS(SVG_NS, "g")
          let rect = document.createElementNS(SVG_NS, "rect")
          Object.entries({x: 20 + 30 * (note.onsetBeats - beats[0]), y: 10, width: 8, height: 6})
            .forEach(([name, value]) => rect.setAttribute(name, value))
          el.appendChild(rect)
          svg.appendChild(el)
          return {...note, el}
        })
        return {svg, notes: kept}
      }}}}
    }

    renderScorePage({loadEngines})
    await systemDrawn()
    await settle()
    flushSync(() => page.beginSession())

    play(page.state.notes.currentColumn())
    let column = page.state.notes.currentColumn()
    expect(column.beat).toEqual(skipped)
    expect(headElements()).toEqual([])
    // the system moves on to it all the same, by its place between the heads
    // either side, and past it
    expect(page.state.slider.value).toBeGreaterThan(SCROLL_WAIT)
    await settle()
    play(column)
    expect(page.state.notes.currentColumn().cardIndex).toEqual(2)
    expect(page.state.slider.value).toBeGreaterThan(SCROLL_WAIT)
    await settle()
    expect(Math.abs(headFromLine())).toBeLessThan(1)
  })

  it("draws a piece stored without its score on the app's staff in scroll mode", async function() {
    let {piece} = await addPiece("Rêverie", parseMusicXML(reverieOpening()), store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, startMeasure: 2, endMeasure: 4, hand: BOTH_HANDS, measuresPerCard: "all",
    }))
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))

    let el = renderScorePage()
    await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`), {message: "the app's staff"})
    expect(page.state.mode).toEqual("scroll")
    expect(el.querySelector("[data-score-card]")).toBe(null)
    expect(el.textContent).toContain(MISSING_ENGINE_SOURCE)
  })

  it("falls back to the app's staff in scroll mode when the engine can't draw the system", async function() {
    await scrollPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    spyOn(console, "warn")

    let el = renderScorePage({loadEngines: () => Promise.reject(new Error("offline"))})
    await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`), {message: "the app's staff"})

    expect(el.querySelector("[data-score-card]")).toBe(null)
    expect(page.state.engineSource.status).toEqual("failed")
    expect(page.state.mode).toEqual("scroll")
  })

  it("falls back to the app's staff when the engine can't draw the card", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    spyOn(console, "warn")

    let el = renderScorePage({loadEngines: () => Promise.reject(new Error("offline"))})
    await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`), {message: "the app's staff"})

    expect(el.querySelector("[data-score-card]")).toBe(null)
    // the same card, which the card size says, and why it is drawn this way
    let {card} = page.currentCard()
    expect(card.measures).toEqual([1, 2, 3, 4])
    expect(el.textContent).toContain(FAILED_ENGINE_SOURCE)
  })

  it("records each measure's stats as a whole section of four measures is played on one card", async function() {
    let piece = await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    renderScorePage()
    await cardDrawn()

    flushSync(() => page.beginSession())
    let {card} = page.currentCard()
    expect(card.measures).toEqual([1, 2, 3, 4])

    play(["C2"])
    for (let idx = 0; idx < card.columns.length; idx++) {
      play(page.state.notes.currentColumn())
    }
    await page.state.notes.generator.finishing

    let measureStats = store.sectionStats(piece.id)
      .filter(stats => stats.startMeasure == stats.endMeasure)
      .sort((a, b) => a.startMeasure - b.startMeasure)

    let played = [...new Set(card.columnMeasures.map(idx => card.measures[idx]))]
    expect(measureStats.map(stats => stats.startMeasure)).toEqual(played)
    expect(measureStats.reduce((sum, stats) => sum + stats.hits, 0)).toEqual(card.columns.length)
    expect(measureStats.reduce((sum, stats) => sum + stats.misses, 0)).toEqual(1)
  })

  it("adds the measures of a whole section card left at Rest to their totals, grading only a whole lap", async function() {
    let piece = await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    renderScorePage()
    await cardDrawn()

    flushSync(() => page.beginSession())
    let {card} = page.currentCard()
    let first = card.columnMeasures[0]
    let firstColumns = card.columnMeasures.filter(idx => idx == first).length
    expect(firstColumns).toBeLessThan(card.columns.length)

    for (let idx = 0; idx < firstColumns; idx++) {
      play(page.state.notes.currentColumn())
    }
    flushSync(() => page.restSession())
    await waitFor(() => store.recentSessions().length == 1, {message: "the session to be saved"})

    let measureStats = store.sectionStats(piece.id).filter(stats => stats.startMeasure == stats.endMeasure)
    expect(measureStats.map(stats => [stats.startMeasure, stats.hits, stats.misses]))
      .toEqual([[card.measures[first], firstColumns, 0]])
    expect(await store.reviews({pieceId: piece.id})).toEqual([])
  })

  // a piano score with the same notes as one part of two staves and as a
  // part for each hand, each on its own staff 1
  let rightNotes = ["E", "G", "C", "E"]
  let leftNotes = ["C", "G", "E", "G"]
  let attributes = (clefs, staves) => `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${staves > 1 ? `<staves>${staves}</staves>` : ""}${clefs.map(([sign, line], idx) => `<clef${staves > 1 ? ` number="${idx + 1}"` : ""}><sign>${sign}</sign><line>${line}</line></clef>`).join("")}</attributes>`
  let notesOn = (steps, octave, staff) => steps.map(step => noteXML(step, octave, 1, staff)).join("")
  let scoreOf = (partList, parts) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>${partList}</part-list>
  ${parts}
</score-partwise>`
  const SCORE_SHAPES = {
    "one part of two staves": scoreOf(
      "<score-part id=\"P1\"><part-name>Piano</part-name></score-part>",
      `<part id="P1"><measure number="1">${attributes([["G", 2], ["F", 4]], 2)}${notesOn(rightNotes, 5, 1)}<backup><duration>4</duration></backup>${notesOn(leftNotes, 3, 2)}</measure></part>`),
    "a part for each hand": scoreOf(
      "<score-part id=\"P1\"><part-name>Right</part-name></score-part><score-part id=\"P2\"><part-name>Left</part-name></score-part>",
      `<part id="P1"><measure number="1">${attributes([["G", 2]], 1)}${notesOn(rightNotes, 5, 1)}</measure></part>
  <part id="P2"><measure number="1">${attributes([["F", 4]], 1)}${notesOn(leftNotes, 3, 1)}</measure></part>`),
  }

  // the page's card drawn again, to read what the engine drew
  let drawnAgain = async () => {
    let join
    let props = page.engineCard()
    let own = document.createElement("div")
    own.style.width = "1100px"
    document.body.appendChild(own)
    let ownRoot = createRoot(own)
    try {
      flushSync(() => ownRoot.render(React.createElement(ScoreCard, {
        ...props, onDrawn: drawn => join = drawn,
      })))
      await waitFor(() => join, {message: "the card drawn again"})
    } finally {
      flushSync(() => ownRoot.unmount())
      own.remove()
    }
    return join
  }

  // a two bar piano piece whose bar 1 fails hands together on one staff, so
  // today's programme offers that bar as that hand alone
  let scaffoldedPiece = async (right = rightNotes.map(step => `${step}5`), props = {}, blame = "lower") => {
    let left = leftNotes.map(step => `${step}3`)
    let rightXML = right.map(name => noteXML(name.slice(0, -1), Number(name.slice(-1)), 1, 1)).join("")
    let bars = [1, 2].map(number => `<measure number="${number}">${number == 1 ? attributes([["G", 2], ["F", 4]], 2) : ""}${rightXML}<backup><duration>4</duration></backup>${notesOn(leftNotes, 3, 2)}</measure>`)
    let piece = await drillPiece(scoreOf("<score-part id=\"P1\"><part-name>Piano</part-name></score-part>",
      `<part id="P1">${bars.join("")}</part>`), {startMeasure: 1, endMeasure: 2, measuresPerCard: "1"})
    await store.putStudy({pieceId: piece.id, status: "learning", startedAt: Date.now()})
    renderScorePage(props)
    await cardDrawn()

    flushSync(() => page.beginSession())
    let generator = page.state.notes.generator
    expect(generator.statusLine()).toEqual("New · bar 1")

    // a wrong key under the other hand's note on each of two columns: the
    // blamed hand's notes are the untouched ones, and the bar fails
    let [touched, untouched] = blame == "lower" ? [right, left] : [left, right]
    for (let idx of [0, 1]) {
      flushSync(() => page.pressNote(touched[idx]))
      flushSync(() => page.pressNote("A#2"))
      flushSync(() => page.releaseNote("A#2"))
      flushSync(() => page.pressNote(untouched[idx]))
      flushSync(() => page.releaseNote(untouched[idx]))
      flushSync(() => page.releaseNote(touched[idx]))
    }
    play([left[2], right[2]])
    play([left[3], right[3]])
    await generator.finishing
    flushSync(() => page.forceUpdate())

    let failed = (await store.reviews({pieceId: piece.id})).find(review => review.itemId == `${piece.id}:both:1-1`)
    expect([failed.grade, failed.staffMisses])
      .toEqual([1, blame == "lower" ? {upper: 0, lower: 2} : {upper: 2, lower: 0}])

    return {piece, generator, left, right}
  }

  // the scaffolded piece's music with a third part its stored song doesn't
  // know, so the score can't say which of its staves a hand alone reads
  let strangerSource = () => {
    let part = (id, clef, notes) => `<part id="${id}">${[1, 2].map(number =>
      `<measure number="${number}">${number == 1 ? attributes([clef], 1) : ""}${notes}</measure>`)
      .join("")}</part>`
    return scoreOf(
      ["P1", "P2", "P3"].map(id =>
        `<score-part id="${id}"><part-name>${id}</part-name></score-part>`).join(""),
      [part("P1", ["G", 2], notesOn(rightNotes, 5, 1)),
        part("P2", ["F", 4], notesOn(leftNotes, 3, 1)),
        part("P3", ["G", 2], notesOn(rightNotes, 6, 1))].join("\n  "))
  }

  it("engraves a right hand alone once, however often the page renders", async function() {
    await scaffoldedPiece(undefined, {}, "upper")
    expect(page.currentCard().card.hand).toEqual("upper")
    await cardDrawn()

    // the drawn card follows the drill through its join, so the renders a
    // played key brings must not engrave it again
    let drawn = page.staff.drawCount
    let join = page.staff.cardJoin
    expect(join).not.toBe(null)

    flushSync(() => page.forceUpdate())
    flushSync(() => page.forceUpdate())

    expect(page.staff.drawCount).toEqual(drawn)
    expect(page.staff.cardJoin).toBe(join)
  })

  it("offers the hand alone on a piece with no stored source", async function() {
    await scaffoldedPiece()
    expect(page.currentCard().card.hand).toEqual("lower")

    // the page is opened again on the piece, whose source is no longer
    // stored; its reviews land while that read is still outstanding
    flushSync(() => root.unmount())
    container.remove()
    let settle
    renderScorePage({readSource: () => new Promise(resolve => { settle = () => resolve(null) })})

    let loading = await waitFor(() => page.state.notes && page.state.notes.generator,
      {message: "today's programme"})
    await loading.ready
    flushSync(() => {})
    expect(page.state.engineSource.status).toEqual("loading")
    expect(page.currentCard().card.hand).toBeUndefined()

    // the app's staff draws the piece, and it can draw one hand by itself,
    // so the failing bar comes back as the hand its misses were blamed on
    settle()
    await waitFor(() => page.currentCard() && page.currentCard().card.hand,
      {message: "the bar offered as one hand alone"})

    expect(page.state.engineSource.status).toEqual("missing")
    expect(page.engineCard()).toBe(null)
    expect(page.currentCard().card.hand).toEqual("lower")
    expect([...page.state.notes.currentColumn()]).toEqual(["C3"])
    expect(page.state.notes.generator.statusLine()).toEqual("Once more · bar 1 · left hand")
  })

  it("offers no hand alone before the piece's source has settled", async function() {
    let {piece} = await scaffoldedPiece()
    expect(page.currentCard().card.hand).toEqual("lower")

    // the page is opened again on the same piece, whose stored source has a
    // part its song doesn't know; its reviews land while the source is
    // still being read, so the first plan doesn't know what can be drawn
    flushSync(() => root.unmount())
    container.remove()
    let settle
    renderScorePage({readSource: () => new Promise(resolve => { settle = () => resolve(strangerSource()) })})

    let generator = await waitFor(() => page.state.notes && page.state.notes.generator,
      {message: "today's programme"})
    await generator.ready
    flushSync(() => {})
    expect(page.state.engineSource.status).toEqual("loading")
    expect(page.currentCard().card.hand).toBeUndefined()

    // the source settles, and the bar the engine can't split stays together
    settle()
    await waitFor(() => page.state.engineSource.status != "loading", {message: "the piece's source"})
    expect(page.state.engineSource.status).toEqual("ready")
    expect(page.currentCard().card.hand).toBeUndefined()
    expect(await store.reviews({pieceId: piece.id})).not.toEqual([])
  })

  it("never offers a hand alone when the score can't tell that hand's staves", async function() {
    let source = strangerSource()
    let {piece, generator, left, right} = await scaffoldedPiece(undefined, {readSource: () => Promise.resolve(source)})

    // bar 1 failed on the bass staff, but the engine can't draw that hand by
    // itself here, so it comes back hands together on the piece's own source
    expect(page.state.engineSource.status).toEqual("ready")
    expect(page.state.engineSource.trackStaves.length).toEqual(3)
    expect(page.currentCard().card.hand).toBeUndefined()
    expect(generator.statusLine()).toEqual("Once more · bar 1")
    expect(page.engineCard()).not.toBe(null)
    expect(page.engineCard().staves).toBe(null)
    expect([...page.state.notes.currentColumn()]).toEqual([left[0], right[0]])

    // both hands are asked for, and the pass is written to the bar's item
    left.forEach((note, idx) => play([note, right[idx]]))
    await generator.finishing
    flushSync(() => page.forceUpdate())

    let reviews = await store.reviews({pieceId: piece.id})
    expect(reviews.filter(review => review.itemId == `${piece.id}:lower:1-1`)).toEqual([])
    expect(reviews.filter(review => review.itemId == `${piece.id}:both:1-1`).length).toEqual(2)
  })

  it("draws the left hand alone when today's programme offers a bar failing on its notes", async function() {
    let {piece, generator} = await scaffoldedPiece()

    expect(generator.statusLine()).toEqual("Once more · bar 1 · left hand")
    expect(page.currentCard().card.hand).toEqual("lower")
    expect([...page.state.notes.currentColumn()]).toEqual(["C3"])
    expect(page.engineCard().staves).not.toBe(null)

    let join = await drawnAgain()
    expect(join.join.unmatched).toEqual([])
    expect(join.result.notes.map(note => note.pitch).sort())
      .toEqual(leftNotes.map(step => parseNote(`${step}3`)).sort())

    // the left hand alone is written to its own item
    for (let step of leftNotes) {
      play([`${step}3`])
    }
    await generator.finishing
    expect(store.item(`${piece.id}:lower:1-1`)).not.toBe(null)
  })

  it("keeps the grade of a pass the drill leaves and returns to the same mode", async function() {
    let left = leftNotes.map(step => `${step}3`)
    let right = rightNotes.map(step => `${step}5`)
    let bars = [1, 2].map(number => `<measure number="${number}">${number == 1 ? attributes([["G", 2], ["F", 4]], 2) : ""}${notesOn(rightNotes, 5, 1)}<backup><duration>4</duration></backup>${notesOn(leftNotes, 3, 2)}</measure>`)
    let piece = await drillPiece(scoreOf("<score-part id=\"P1\"><part-name>Piano</part-name></score-part>",
      `<part id="P1">${bars.join("")}</part>`), {startMeasure: 1, endMeasure: 2, measuresPerCard: "1"})
    await store.putStudy({pieceId: piece.id, status: "learning", startedAt: Date.now()})
    renderScorePage()
    await cardDrawn()

    flushSync(() => page.beginSession())
    let generator = page.state.notes.generator
    expect(page.currentCard().card.hand).toBeUndefined()

    // half the bar hands together, then the drill scrolls and waits again:
    // the card never leaves, so the pass it is collecting doesn't either
    play([left[0], right[0]])
    play([left[1], right[1]])

    flushSync(() => page.setMode("scroll"))
    await cardDrawn()
    flushSync(() => page.setMode("wait"))
    await cardDrawn()

    expect(page.currentCard().card.hand).toBeUndefined()
    play([left[2], right[2]])
    play([left[3], right[3]])
    await generator.finishing
    flushSync(() => page.forceUpdate())

    let graded = (await store.reviews({pieceId: piece.id}))
      .filter(review => review.itemId == `${piece.id}:both:1-1` && review.grade)
    expect(graded.length).toEqual(1)
  })

  it("draws a failing bar's hand alone as its own one-bar system when the drill scrolls", async function() {
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    let {piece, generator} = await scaffoldedPiece()
    await systemDrawn()
    // scaffoldedPiece's own forceUpdate only starts the hand system's engine
    // draw; wait for it to finish before reading the card it drew
    await waitFor(() => page.staff.cardJoin && page.staff.props.toMeasure == 1,
      {message: "the hand-alone system drawn"})

    expect(page.currentCard().card.hand).toEqual("lower")
    expect(generator.statusLine()).toEqual("Once more · bar 1 · left hand")

    let engineCard = page.engineCard()
    expect(engineCard).toEqual(jasmine.objectContaining({system: true, fromMeasure: 1, toMeasure: 1}))
    expect(engineCard.staves).not.toBe(null)

    expect(page.staff.result.notes.map(note => note.pitch).sort((a, b) => a - b))
      .toEqual(leftNotes.map(step => parseNote(`${step}3`)).sort((a, b) => a - b))
    expect(page.staff.cardJoin.unmatched).toEqual([])

    await settle()
    expect(Math.abs(headFromLine())).toBeLessThan(1)

    // each left note in turn, the head settling onto the line every time,
    // including the hands-together card the bar's last note hands back to
    for (let step of leftNotes) {
      play([`${step}3`])
      await settle()
      expect(Math.abs(headFromLine())).toBeLessThan(1)
    }

    await generator.finishing
    flushSync(() => page.forceUpdate())

    let reviews = await store.reviews({pieceId: piece.id})
    expect(reviews.find(review => review.itemId == `${piece.id}:lower:1-1`))
      .toEqual(jasmine.objectContaining({mode: "scroll", misses: 0}))

    // hands together again, on the section system
    expect(page.currentCard().card.hand).toBeUndefined()
    expect(page.engineCard()).toEqual(jasmine.objectContaining({fromMeasure: 1, toMeasure: 2, staves: null}))
  })

  it("comes back to the section's system without drawing it again", async function() {
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    let renders = 0
    let loadEngines = async () => {
      let bundle = await loadScoreEngines()
      let osmd = bundle.ENGINES.osmd
      return {...bundle, ENGINES: {...bundle.ENGINES, osmd: {...osmd, renderSystem: async opts => {
        renders++
        return osmd.renderSystem(opts)
      }}}}
    }

    // the section drawn once, then the left-hand system once the bar fails:
    // the engine has drawn two systems before any note of the hand card plays.
    // scaffoldedPiece's own forceUpdate only starts that second draw, so wait
    // for it to finish before counting
    let {piece, generator} = await scaffoldedPiece(undefined, {loadEngines})
    await waitFor(() => renders == 2, {message: "the hand-alone system drawn"})
    expect(page.currentCard().card.hand).toEqual("lower")

    for (let step of leftNotes) {
      play([`${step}3`])
      await settle()
    }
    await generator.finishing
    flushSync(() => page.forceUpdate())

    // back on the section without a third render: it is re-joined from the
    // kept drawing, not drawn again, and comes back with none of the stale
    // missed marks it carried when the hand-alone card took its place
    expect(page.currentCard().card.hand).toBeUndefined()
    expect(renders).toEqual(2)
    // the section's drawing is on the plate at once, with both staves of it:
    // a draw of its own would have left result null until the engine answered
    expect(page.staff.result).toBeTruthy()
    expect(page.staff.result.notes.some(note => note.staff == 1)).toBe(true)
    expect(marked(MARK_CLASSES.missed)).toEqual([])

    let current = marked(MARK_CLASSES.current)
    expect(current.length).toBeGreaterThan(0)
  })

  it("judges only the hand alone on its system", async function() {
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))
    let {generator} = await scaffoldedPiece()
    await systemDrawn()
    await settle()

    let misses = page.state.stats.misses
    play(["E5"])
    expect(page.state.stats.misses).toEqual(misses + 1)
    expect([...page.state.notes.currentColumn()]).toEqual(["C3"])
  })

  it("keeps a hand-alone card through a switch of modes", async function() {
    let {piece, generator} = await scaffoldedPiece()
    expect(page.currentCard().card.hand).toEqual("lower")

    play([leftNotes[0] + "3"])
    flushSync(() => page.setMode("scroll"))
    await cardDrawn()
    flushSync(() => page.setMode("wait"))
    await cardDrawn()

    expect(page.currentCard().card.hand).toEqual("lower")
    leftNotes.slice(1).forEach(step => play([`${step}3`]))
    await generator.finishing
    flushSync(() => page.forceUpdate())

    // the card never left, so the pass it was collecting didn't either: one
    // grade for the whole pass, not a graded review per mode it was seen in
    let graded = (await store.reviews({pieceId: piece.id}))
      .filter(review => review.itemId == `${piece.id}:lower:1-1` && review.grade)
    expect(graded.length).toEqual(1)
  })

  for (let [shape, xml] of Object.entries(SCORE_SHAPES)) {
    for (let [hand, pitches] of [
      [RIGHT_HAND, rightNotes.map(step => parseNote(`${step}5`))],
      [LEFT_HAND, leftNotes.map(step => parseNote(`${step}3`))],
    ]) {
      it(`draws only the ${hand} notes it judges of ${shape}`, async function() {
        await drillPiece(xml, {startMeasure: 1, endMeasure: 1, hand})
        renderScorePage()
        await cardDrawn()

        let join = await drawnAgain()
        expect(join.join.unmatched).toEqual([])
        expect(join.join.heads.every(heads => heads.length > 0)).toBe(true)
        expect(join.result.notes.map(note => note.pitch).sort()).toEqual([...pitches].sort())
      })
    }
  }

  it("falls back to the app's staff when the engine draws none of the card's notes", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    spyOn(console, "warn")

    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderCard: async () => ({svg: document.createElementNS(SVG_NS, "svg"), notes: []}),
    }}})

    let el = renderScorePage({loadEngines})
    await waitFor(() => page.state.engineSource?.status == "failed", {message: "the engine card to fail"})
    flushSync(() => {})

    expect(el.querySelector("[data-score-card]")).toBe(null)
    expect(el.querySelector(`.${staffStyles.staff_notes}`)).not.toBe(null)
  })

  it("draws later cards after a card whose drawing threw", async function() {
    let svg = () => document.createElementNS(SVG_NS, "svg")
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderCard: async () => ({svg: svg(), notes: [drawn(parseNote("C4"), 0)]}),
    }}})
    let props = {
      musicXML: "<score-partwise/>", fromMeasure: 1, toMeasure: 1, hand: "both", width: 600,
      columns: [column(["C4"], 0)], head: 0, loadEngines,
    }

    spyOn(console, "warn")
    let first = jasmine.createSpy("first onError")
    let drawnCard = jasmine.createSpy("second onDrawn")

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => root.render(React.createElement("div", {},
      React.createElement(ScoreCard, {...props, onError: first, onDrawn: () => { throw new Error("broken") }}),
      React.createElement(ScoreCard, {...props, onDrawn: drawnCard}))))

    await waitFor(() => drawnCard.calls.count(), {timeout: 2000, message: "the second card"})
    expect(first).toHaveBeenCalled()
  })

  // the drawn heads of the column at the head of the drill, which the
  // plate's ink smudge marks (see PlateFeedback)
  it("locates the head column's drawn heads, [] before the draw settles and with no head", async function() {
    let svg = () => document.createElementNS(SVG_NS, "svg")
    let notes = [drawn(parseNote("C4"), 0), drawn(parseNote("E4"), 1)]
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderCard: async () => ({svg: svg(), notes}),
    }}})
    let props = {
      musicXML: "<score-partwise/>", fromMeasure: 1, toMeasure: 1, hand: "both", width: 600,
      columns: [column(["C4"], 0), column(["E4"], 1)], head: 0, loadEngines,
    }

    let card
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => root.render(React.createElement(ScoreCard, {...props, ref: c => card = c})))

    // nothing joined yet, while the engine is still drawing
    expect(card.headElements()).toEqual([])

    await waitFor(() => card.cardJoin, {message: "the card to draw"})
    expect(card.headElements()).toEqual(card.cardJoin.heads[0])

    flushSync(() => root.render(React.createElement(ScoreCard, {...props, head: null, ref: c => card = c})))
    expect(card.headElements()).toEqual([])
  })

  it("is the score page's own programme", function() {
    expect(SCORE_PROGRAMME.engine).toEqual("osmd")
  })

  // acoustic mode's "Where?" (SelfGradeRow, st/srs/self_grade): bar badges
  // over the engine-drawn card, see st/score_render/card_badges
  describe("acoustic mode's bar badges", function() {
    let click = button => flushSync(() => button.click())
    let buttonLike = (el, text) => [...el.querySelectorAll("button")].find(b => b.textContent.includes(text))
    let exactButton = (el, text) => [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)
    let engineDrawn = () => waitFor(() => container.querySelector("[data-score-card] svg"),
      {message: "the engine card"})
    let badges = () => [...container.querySelectorAll("[data-bar-badge]")]
    let tints = () => [...container.querySelectorAll("[data-bar-tint]")]
    // the grade row's own dwell (SELF_GRADE_DWELL_MS) guards a tap or chip
    // choice sooner than this after it last changed what it shows; this file
    // uses no fake clock, so a real wait stands in for st/srs/self_grade's played()
    let wait = ms => new Promise(resolve => setTimeout(resolve, ms))

    it("shows a badge per bar while Where? is open, lights and tints the chosen one alone, and clears once the grade is written", async function() {
      await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 3, measuresPerCard: "2"})
      let el = renderScorePage({acoustic: true})
      await engineDrawn()

      flushSync(() => page.beginSession())
      await wait(600)
      click(buttonLike(el, "Stumbled"))

      let shown = badges()
      expect(shown.map(b => b.textContent)).toEqual(["Bar 2", "Bar 3"])
      expect(shown.every(b => b.closest("[aria-hidden]"))).toBe(true)
      expect(shown[0].getBoundingClientRect().left).toBeLessThan(shown[1].getBoundingClientRect().left)
      expect(shown.some(b => b.className.includes("bar_badge_on"))).toBe(false)
      // nothing is tinted while no bar has the grade yet
      expect(tints().length).toEqual(0)

      await wait(600)
      click(exactButton(el, "Bar 3"))
      let chosen = badges()
      expect(chosen[1].className).toContain("bar_badge_on")
      expect(chosen[0].className).not.toContain("bar_badge_on")

      // only the chosen bar is tinted, over its own span
      let tinted = tints()
      expect(tinted.length).toEqual(1)
      expect(tinted[0].getAttribute("data-bar-tint")).toEqual("1")
      expect(parseFloat(tinted[0].style.left)).toBeCloseTo(parseFloat(chosen[1].style.left), 3)
      expect(parseFloat(tinted[0].style.width)).toBeGreaterThan(0)

      flushSync(() => page.writeSelfGrade())
      await page.state.notes.generator.finishing
      flushSync(() => {})
      expect(badges().length).toEqual(0)
      expect(tints().length).toEqual(0)
    })

    // the overlay is placed from the drawn heads, so a redraw (a resize,
    // fullscreen) must place it again rather than leave it hidden
    it("places the badges again once the card has been redrawn under the question", async function() {
      await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 3, measuresPerCard: "2"})
      let el = renderScorePage({acoustic: true})
      await engineDrawn()

      flushSync(() => page.beginSession())
      await wait(600)
      click(buttonLike(el, "Stumbled"))

      let overlay = badges()[0].closest("[aria-hidden]")
      expect(overlay.style.display).toEqual("block")

      // the plate narrows (fullscreen, a rotation: the page's only width
      // input, see SightReadingPage#measureStaffWrapper), so the card is
      // drawn again under the question
      flushSync(() => page.setState({staffWidth: page.state.staffWidth - 140}))
      expect(overlay.style.display).toEqual("none")

      await waitFor(() => overlay.style.display == "block", {timeout: 2000, message: "the badges placed again"})
      expect(badges().map(b => b.textContent)).toEqual(["Bar 2", "Bar 3"])
      expect(badges().every(b => parseFloat(b.style.left) >= 0)).toBe(true)
      expect(badges()[0].getBoundingClientRect().left)
        .toBeLessThan(badges()[1].getBoundingClientRect().left)
    })

    it("shows no badges on the app staff's fallback", async function() {
      await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 3, measuresPerCard: "2"})
      let el = renderScorePage({acoustic: true, programme: {...SCORE_PROGRAMME, engine: null, ScoreView: null}})
      flushSync(() => page.beginSession())
      await wait(600)
      click(buttonLike(el, "Stumbled"))
      expect(badges().length).toEqual(0)
    })
  })
})

describe("ScoreCard", function() {
  let container, root, card

  afterEach(function() {
    if (root) {
      flushSync(() => root.unmount())
      root = null
    }
    if (container) {
      container.remove()
      container = null
    }
    card = null
  })

  let mountCard = props => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => root.render(React.createElement(ScoreCard, {ref: c => { card = c }, ...props})))
  }

  let rerenderCard = props => {
    flushSync(() => root.render(React.createElement(ScoreCard, {ref: c => { card = c }, ...props})))
  }

  let columnsOf = names => names.map((name, idx) => column([name], idx))

  it("re-attaches a system it drew before rather than drawing it again", async function() {
    let renders = 0
    let notesFor = {"1-4": ["C4", "D4", "E4", "F4"], "2-2": ["G4"]}
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderSystem: async ({fromMeasure, toMeasure}) => {
        renders++
        let svg = document.createElementNS(SVG_NS, "svg")
        let notes = notesFor[`${fromMeasure}-${toMeasure}`].map((name, idx) => {
          let note = drawn(parseNote(name), idx)
          svg.appendChild(note.el)
          return note
        })
        return {svg, notes}
      },
    }}})
    let base = {
      musicXML: "<score-partwise/>", measureStarts: [0, 4], hand: "both", width: 600,
      system: true, loadEngines,
    }

    mountCard({...base, fromMeasure: 1, toMeasure: 4, columns: columnsOf(notesFor["1-4"]), head: 2})
    await waitFor(() => card.result, {message: "the first system"})
    expect(renders).toEqual(1)
    // the kept system is its own copy (the engine's own display is one it
    // reuses and redraws into, osmd.ts), so re-attaching it is never the
    // same node as the one first drawn, only an equal one
    let firstSvg = card.result.svg
    let firstPitches = card.result.notes.map(note => note.pitch)

    rerenderCard({
      ...base, fromMeasure: 2, toMeasure: 2, staves: [{part: "P1", staff: 2}],
      columns: columnsOf(notesFor["2-2"]), head: 0,
    })
    await waitFor(() => renders == 2, {message: "the second system"})
    expect(card.result.svg).not.toBe(firstSvg)

    // back to the first range: re-attached, not redrawn
    rerenderCard({
      ...base, fromMeasure: 1, toMeasure: 4, staves: null,
      columns: columnsOf(notesFor["1-4"]), head: 0,
    })
    expect(renders).toEqual(2)
    expect(card.result.svg).not.toBe(firstSvg)
    expect(card.result.notes.map(note => note.pitch)).toEqual(firstPitches)
    expect(container.querySelector("[data-score-card] svg")).toBe(card.result.svg)

    expect(card.cardJoin.heads[0].every(el => el.classList.contains(MARK_CLASSES.current))).toBe(true)
    expect(card.cardJoin.heads.every((heads, idx) => idx == 0 || heads.every(el =>
      !el.classList.contains(MARK_CLASSES.current) &&
      !el.classList.contains(MARK_CLASSES.done) &&
      !el.classList.contains(MARK_CLASSES.missed)))).toBe(true)

    // an equal but new staves array still matches the kept system: its
    // drawing is on the plate at once, before any render could have run
    rerenderCard({
      ...base, fromMeasure: 2, toMeasure: 2, staves: [{part: "P1", staff: 2}],
      columns: columnsOf(notesFor["2-2"]), head: 0,
    })
    expect(renders).toEqual(2)
    expect(card.result).toBeTruthy()
    expect(container.querySelector("[data-score-card] svg")).toBe(card.result.svg)
    expect(card.result.notes.map(note => note.pitch)).toEqual([parseNote("G4")])
  })

  it("re-attaches a kept system with none of the marks it was drilled with", async function() {
    let names = ["C4", "D4", "E4", "F4"]
    let notesFor = {"1-4": names, "2-2": ["G4"], "3-3": ["G4"]}
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderSystem: async ({fromMeasure, toMeasure}) => {
        let svg = document.createElementNS(SVG_NS, "svg")
        let notes = notesFor[`${fromMeasure}-${toMeasure}`].map((name, idx) => {
          let note = drawn(parseNote(name), idx)
          svg.appendChild(note.el)
          return note
        })
        return {svg, notes}
      },
    }}})
    let base = {
      musicXML: "<score-partwise/>", measureStarts: [0, 4], hand: "both", width: 600,
      system: true, loadEngines,
    }
    let section = cols => ({
      ...base, fromMeasure: 1, toMeasure: 4, staves: null, columns: columnsOf(cols),
    })
    let bar = {
      ...base, fromMeasure: 2, toMeasure: 2, staves: [{part: "P1", staff: 2}],
      columns: columnsOf(notesFor["2-2"]), head: 0,
    }
    // a second hand-alone bar, so the section is left for a system the engine
    // has yet to draw rather than for another kept one
    let otherBar = {...bar, fromMeasure: 3, toMeasure: 3}
    let marks = () => [...container.querySelectorAll("[data-score-card] svg > *")]
      .map(el => Object.values(MARK_CLASSES).filter(cls => el.classList.contains(cls)))
    let barDrawn = () => waitFor(() => card.result && card.result.notes.length == 1,
      {message: "the one-bar system"})

    // the section drawn, left for a one-bar system, then re-attached and
    // drilled to its last column as the kept drawing itself
    mountCard({...section(names), head: 0})
    await waitFor(() => card.result, {message: "the section"})
    rerenderCard(bar)
    await barDrawn()

    rerenderCard({...section(names), head: 3})
    expect(card.result).toBeTruthy()
    expect(marks()).toEqual([
      [MARK_CLASSES.done], [MARK_CLASSES.done], [MARK_CLASSES.done], [MARK_CLASSES.current],
    ])

    // away and back on another of its bars: scroll mode joins the card's own
    // columns alone (SightReadingPage#engineCard), so the bars the drill has
    // left keep no mark of the pass they were drilled in
    rerenderCard(otherBar)
    await barDrawn()
    rerenderCard({...section(names.slice(0, 1)), head: 0})
    expect(card.result).toBeTruthy()
    expect(marks()).toEqual([[MARK_CLASSES.current], [], [], []])
  })

  it("shades a kept system it re-attaches rather than drawing again", async function() {
    let renders = 0
    let measuresFor = {
      "1-2": [
        {index: 0, number: 1, box: {x: 0, y: 0, width: 50, height: 40}},
        {index: 1, number: 2, box: {x: 50, y: 0, width: 50, height: 40}},
      ],
      "3-3": [{index: 2, number: 3, box: {x: 0, y: 0, width: 50, height: 40}}],
    }
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderSystem: async ({fromMeasure, toMeasure}) => {
        renders++
        let svg = document.createElementNS(SVG_NS, "svg")
        svg.appendChild(document.createElementNS(SVG_NS, "rect"))
        let note = drawn(parseNote("C4"), 0)
        svg.appendChild(note.el)
        return {svg, notes: [note], measures: measuresFor[`${fromMeasure}-${toMeasure}`]}
      },
    }}})
    let base = {
      musicXML: "<score-partwise/>", measureStarts: [0, 4, 8], hand: "both", width: 600,
      system: true, overview: true, loadEngines,
    }
    let shade = on => [{id: "a", from: 1, to: 2, level: 3, on, label: "I"}]
    let shaded = () => [...container.querySelectorAll("rect[data-shade]")]
      .map(el => el.getAttribute("data-shade"))

    mountCard({...base, fromMeasure: 1, toMeasure: 2, shades: shade(false)})
    await waitFor(() => shaded().length, {message: "the first system's shade"})

    rerenderCard({...base, fromMeasure: 3, toMeasure: 3, shades: shade(false)})
    await waitFor(() => renders == 2, {message: "the second system"})

    // back to the kept system, then restyled: its measures came with the
    // copy, so the shade is laid out over them without a redraw
    rerenderCard({...base, fromMeasure: 1, toMeasure: 2, shades: shade(false)})
    expect(renders).toEqual(2)
    rerenderCard({...base, fromMeasure: 1, toMeasure: 2, shades: shade(true)})
    expect(renders).toEqual(2)
    expect(shaded()).toEqual(["a"])
  })

  // The page moves the drawn range on with the section setting, but rebuilds
  // the drill's columns a render later (refreshNoteList in
  // SightReadingPage#componentDidUpdate), and a kept system is re-attached at
  // once rather than on a draw settling: its re-join lands on the columns of
  // the section the card has moved on from. Returning to a flagged passage
  // already drilled in scroll mode used to take those for a card the engine
  // couldn't draw and fall back to the app's staff for good
  it("keeps a kept system's drawing where the drill's columns lag its range by a render", async function() {
    let renders = 0
    let notesFor = {"1-4": ["C4", "D4", "E4", "F4"], "5-8": ["G4", "A4", "B4", "C5"]}
    let beatOf = {"1-4": 0, "5-8": 4}
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderSystem: async ({fromMeasure, toMeasure}) => {
        renders++
        let range = `${fromMeasure}-${toMeasure}`
        let svg = document.createElementNS(SVG_NS, "svg")
        let notes = notesFor[range].map((name, idx) => {
          let note = drawn(parseNote(name), beatOf[range] + idx)
          svg.appendChild(note.el)
          return note
        })
        return {svg, notes, measures: []}
      },
    }}})
    let columnsAt = range => notesFor[range].map((name, idx) => column([name], beatOf[range] + idx))
    let onError = jasmine.createSpy("onError")
    let base = {
      musicXML: "<score-partwise/>", measureStarts: [0, 4, 8, 12, 16, 20, 24, 28],
      hand: "both", width: 600, system: true, loadEngines, onError,
    }

    mountCard({...base, fromMeasure: 1, toMeasure: 4, columns: columnsAt("1-4"), head: 0})
    await waitFor(() => card.result, {message: "the first system"})

    rerenderCard({...base, fromMeasure: 5, toMeasure: 8, columns: columnsAt("5-8"), head: 0})
    await waitFor(() => renders == 2, {message: "the second system"})

    // back to the first range with the second's columns still on the props:
    // re-attached, and the drawing kept rather than failed
    rerenderCard({...base, fromMeasure: 1, toMeasure: 4, columns: columnsAt("5-8"), head: 0})
    expect(renders).toEqual(2)
    expect(onError).not.toHaveBeenCalled()
    expect(card.result).toBeTruthy()
    expect(container.querySelector("[data-score-card] svg")).toBe(card.result.svg)

    // the columns catch up a render later, and the kept system is joined to
    // them without a draw of its own
    rerenderCard({...base, fromMeasure: 1, toMeasure: 4, columns: columnsAt("1-4"), head: 1})
    expect(renders).toEqual(2)
    expect(onError).not.toHaveBeenCalled()
    expect(card.result).toBeTruthy()
    expect(card.cardJoin.heads.map(heads => heads.length)).toEqual([1, 1, 1, 1])
    expect(card.cardJoin.heads[1].every(el => el.classList.contains(MARK_CLASSES.current))).toBe(true)
  })

  it("draws a system again once its score changes", async function() {
    let renders = 0
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderSystem: async () => {
        renders++
        let svg = document.createElementNS(SVG_NS, "svg")
        let note = drawn(parseNote("C4"), 0)
        svg.appendChild(note.el)
        return {svg, notes: [note]}
      },
    }}})
    let props = {
      fromMeasure: 1, toMeasure: 1, hand: "both", width: 600, system: true,
      columns: [column(["C4"], 0)], head: 0, loadEngines,
    }

    mountCard({...props, musicXML: "<score-partwise/>A"})
    await waitFor(() => renders == 1, {message: "the first draw"})

    rerenderCard({...props, musicXML: "<score-partwise/>B"})
    await waitFor(() => renders == 2, {message: "the second draw"})

    rerenderCard({...props, musicXML: "<score-partwise/>A"})
    await waitFor(() => renders == 3, {message: "a third draw of the first score"})
  })

  it("settles the plate when a kept system overtakes a draw in flight", async function() {
    let letCardDraw
    let cardDrawing = new Promise(resolve => { letCardDraw = resolve })
    let oneNote = () => {
      let svg = document.createElementNS(SVG_NS, "svg")
      let note = drawn(parseNote("C4"), 0)
      svg.appendChild(note.el)
      return {svg, notes: [note]}
    }
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderSystem: async () => oneNote(),
      renderCard: async () => {
        await cardDrawing
        return oneNote()
      },
    }}})
    let base = {
      musicXML: "<score-partwise/>", fromMeasure: 1, toMeasure: 1, hand: "both",
      width: 600, columns: [column(["C4"], 0)], head: 0, loadEngines,
    }
    let busy = () => container.querySelector("[data-score-card]").getAttribute("aria-busy")

    mountCard({...base, system: true})
    await waitFor(() => card.result, {message: "the system"})
    expect(busy()).toEqual("false")

    // wait mode's card is still being drawn when scroll mode comes back to
    // the kept system: the plate is settled by the drawing it hands back,
    // not left waiting on the draw its own re-join overtook
    rerenderCard({...base, system: false})
    await waitFor(() => busy() == "true", {message: "the card's draw in flight"})

    rerenderCard({...base, system: true})
    expect(card.result).toBeTruthy()
    expect(busy()).toEqual("false")

    letCardDraw()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(busy()).toEqual("false")
  })

  it("keeps a wait-mode card's marks up until the next card is drawn", async function() {
    let letSecondDraw
    let secondDrawing = new Promise(resolve => { letSecondDraw = resolve })
    let draws = 0
    let notesFor = {1: ["C4", "D4"], 2: ["E4"]}
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderCard: async ({fromMeasure}) => {
        if (++draws > 1) { await secondDrawing }
        let svg = document.createElementNS(SVG_NS, "svg")
        let notes = notesFor[fromMeasure].map((name, idx) => {
          let note = drawn(parseNote(name), idx)
          svg.appendChild(note.el)
          return note
        })
        return {svg, notes}
      },
    }}})
    let base = {
      musicXML: "<score-partwise/>", hand: "both", width: 600, system: false, loadEngines,
    }
    let withClass = (els, cls) => els.filter(el => el.classList.contains(cls))

    mountCard({...base, fromMeasure: 1, toMeasure: 1, columns: columnsOf(notesFor[1]), head: 1})
    await waitFor(() => card.cardJoin, {message: "the first card"})
    let firstHeads = card.cardJoin.heads.flat()
    expect(withClass(firstHeads, MARK_CLASSES.done).length).toEqual(1)
    expect(withClass(firstHeads, MARK_CLASSES.current).length).toEqual(1)

    // the finished card is still the one on the plate while the next is being
    // drawn, so it keeps the marks it ended on
    rerenderCard({...base, fromMeasure: 2, toMeasure: 2, columns: columnsOf(notesFor[2]), head: 0})
    expect(container.querySelector("[data-score-card] svg").contains(firstHeads[0])).toBe(true)
    expect(withClass(firstHeads, MARK_CLASSES.done).length).toEqual(1)
    expect(withClass(firstHeads, MARK_CLASSES.current).length).toEqual(1)

    letSecondDraw()
    await waitFor(() => card.cardJoin && card.cardJoin.heads.flat()[0] != firstHeads[0],
      {message: "the second card"})
    expect(container.querySelector("[data-score-card] svg").contains(firstHeads[0])).toBe(false)
    expect(card.cardJoin.heads[0].every(el => el.classList.contains(MARK_CLASSES.current))).toBe(true)
  })

  it("draws a plate card afresh each time", async function() {
    let renders = 0
    let loadEngines = () => Promise.resolve({ENGINES: {osmd: {
      renderCard: async () => {
        renders++
        let svg = document.createElementNS(SVG_NS, "svg")
        let note = drawn(parseNote("C4"), 0)
        svg.appendChild(note.el)
        return {svg, notes: [note]}
      },
    }}})
    let base = {
      musicXML: "<score-partwise/>", hand: "both", width: 600, system: false,
      columns: [column(["C4"], 0)], head: 0, loadEngines,
    }

    mountCard({...base, fromMeasure: 1, toMeasure: 1})
    await waitFor(() => renders == 1, {message: "the first card"})

    rerenderCard({...base, fromMeasure: 2, toMeasure: 2})
    await waitFor(() => renders == 2, {message: "the second card"})

    rerenderCard({...base, fromMeasure: 1, toMeasure: 1})
    await waitFor(() => renders == 3, {message: "the first card drawn again"})
  })
})
