import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import ScorePage, {SCORE_PROGRAMME} from "st/components/pages/score_page"
import ScoreCard from "st/components/score_card"
import {MISSING_ENGINE_SOURCE} from "st/components/pages/sight_reading_page"
import {joinCard, markCard, joinable, MARK_CLASSES} from "st/score_render/card_join"
import {prepareCard} from "st/score_render/card_source"
import {loadScoreEngines} from "st/score_render/load"
import {STAVES, pieceSectionMeasures, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {sectionCard, MAX_MEASURES_PER_CARD} from "st/measure_cards"
import {importMusicXMLPiece, addPiece} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {parseNote} from "st/music"
import {setAppStore} from "st/storage"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import staffStyles from "st/components/staff.module.css"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"

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

  let renderScorePage = (props={}) => {
    container = document.createElement("div")
    container.style.width = "1100px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, ...props})))
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

  it("draws a whole section longer than the staff's card cap as one card", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    let el = renderScorePage()
    await cardDrawn()

    expect(4).toBeGreaterThan(MAX_MEASURES_PER_CARD)
    let {card, number} = page.currentCard()
    expect([card.startMeasure, card.endMeasure, number]).toEqual([1, 4, null])
    expect(el.textContent).toContain("measures 1–4")
  })

  // the programme drawer, opened
  let openDrawer = el => {
    flushSync(() => el.querySelector("button[aria-label=\"Programme\"]").click())
    return el.querySelector(`.${drawerStyles.drawer}`)
  }

  let perCardPicker = drawer => drawer.querySelector("[role=\"spinbutton\"][aria-label=\"measures per card\"]")

  it("picks a card size past the staff's cap for the score's cards, capping it again in scroll mode", async function() {
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

    expect(4).toBeGreaterThan(MAX_MEASURES_PER_CARD)
    expect(page.state.currentGeneratorSettings.measuresPerCard).toEqual(4)
    let {card} = page.currentCard()
    expect(card.measures).toEqual([1, 2, 3, 4])
    await waitFor(() => el.querySelector("[data-score-card] svg"), {message: "the four measure card"})

    // the app's staff draws scroll mode's cards, so the cap is back and says why
    flushSync(() => page.setMode("scroll"))
    flushSync(() => {})
    expect(perCardPicker(drawer).getAttribute("aria-valuemax")).toEqual(`${MAX_MEASURES_PER_CARD}`)
    expect(perCardPicker(drawer).value).toEqual(`${MAX_MEASURES_PER_CARD}`)
    expect(drawer.textContent).toContain(`max ${MAX_MEASURES_PER_CARD}`)
    expect(drawer.textContent).toContain(`Cards stop at ${MAX_MEASURES_PER_CARD} measures in scroll mode`)
    expect(page.currentCard().card.measures.length).toEqual(MAX_MEASURES_PER_CARD)
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

  it("draws the card on the app's staff in scroll mode", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 2, endMeasure: 4})
    window.localStorage.setItem(SCORE_DRILL_STORAGE_KEY, JSON.stringify({mode: "scroll"}))

    let el = renderScorePage()
    await waitFor(() => page.state.engineSource?.status == "ready", {message: "the source"})
    flushSync(() => {})

    expect(el.querySelector("[data-score-card]")).toBe(null)
    expect(el.querySelector(`.${staffStyles.staff_notes}`)).not.toBe(null)
    expect(el.textContent).not.toContain(MISSING_ENGINE_SOURCE)
  })

  it("falls back to the app's staff when the engine can't draw the card", async function() {
    await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    spyOn(console, "warn")

    let el = renderScorePage({loadEngines: () => Promise.reject(new Error("offline"))})
    await waitFor(() => el.querySelector(`.${staffStyles.staff_notes}`), {message: "the app's staff"})

    expect(el.querySelector("[data-score-card]")).toBe(null)
    // capped again to what the staff fits, which the card size says
    let {card} = page.currentCard()
    expect(card.endMeasure - card.startMeasure + 1).toBeLessThanOrEqual(MAX_MEASURES_PER_CARD)
    let drawer = openDrawer(el)
    expect(perCardPicker(drawer).getAttribute("aria-valuemax")).toEqual(`${MAX_MEASURES_PER_CARD}`)
    expect(drawer.textContent).toContain("while the score can't be drawn")
  })

  it("records each measure's stats as a whole section longer than the staff's card cap is played on one card", async function() {
    let piece = await drillPiece(reverieOpening(), {startMeasure: 1, endMeasure: 4})
    renderScorePage()
    await cardDrawn()

    flushSync(() => page.beginSession())
    let {card} = page.currentCard()
    expect(card.endMeasure - card.startMeasure + 1).toBeGreaterThan(MAX_MEASURES_PER_CARD)

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

  it("records each measure of a whole section on one card as it is played, before the pass is done", async function() {
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
    await page.state.notes.generator.finishing

    let measureStats = store.sectionStats(piece.id).filter(stats => stats.startMeasure == stats.endMeasure)
    expect(measureStats.map(stats => [stats.startMeasure, stats.hits, stats.misses]))
      .toEqual([[card.measures[first], firstColumns, 0]])
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

  for (let [shape, xml] of Object.entries(SCORE_SHAPES)) {
    for (let [hand, pitches] of [
      [RIGHT_HAND, rightNotes.map(step => parseNote(`${step}5`))],
      [LEFT_HAND, leftNotes.map(step => parseNote(`${step}3`))],
    ]) {
      it(`draws only the ${hand} notes it judges of ${shape}`, async function() {
        await drillPiece(xml, {startMeasure: 1, endMeasure: 1, hand})
        renderScorePage()
        await cardDrawn()

        // the page's card drawn again, to read what the engine drew
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

  it("is the score page's own programme", function() {
    expect(SCORE_PROGRAMME.engine).toEqual("osmd")
  })
})
