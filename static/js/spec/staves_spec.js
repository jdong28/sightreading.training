import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {GStaff, FStaff, GrandStaff} from "st/components/staves"
import staffStyles from "st/components/staff.module.css"
import {minNoteWidth, ACCIDENTAL_WIDTH, NOTE_HEAD_WIDTH, GROUP_OFFSET} from "st/components/staff_notes"
import {SPACING_EXPONENT} from "st/staff_rhythm"
import NoteList from "st/note_list"
import {KeySignature, noteName, parseNote} from "st/music"
import {parseMusicXML} from "st/musicxml"
import {extractSectionColumns} from "st/song_sections"
import {
  sectionCard, cardColumn, cardColumns, drillColumns, measureCards, MeasureCardDeck, MeasureCardGenerator, IN_ORDER
} from "st/measure_cards"
import {SheetMusicGenerator} from "st/generators"
import {pieceSectionMeasures, BOTH_HANDS, RIGHT_HAND, LEFT_HAND} from "st/data"
import {reverieOpening, clefChangeScore, midMeasureClefScore} from "spec/helpers"

// MIDI pitches, so the specs don't depend on the octave numbering of names
const G2 = 43, C3 = 48, E3 = 52, F3 = 53, G3 = 55, A3 = 57, Bb3 = 58, B3 = 59, C4 = 60, D4 = 62, E4 = 64, G4 = 67, A4 = 69, C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79

const GRAND = {name: "grand", range: ["C2", "C6"]}

// the staff columns of the measures of a piece, drilled as one card
let sectionColumns = (song, startMeasure, endMeasure, hand=BOTH_HANDS, staff=GRAND) => {
  let measures = pieceSectionMeasures(staff, {startMeasure, endMeasure, hand}, song)
  let card = sectionCard(measures)
  return card.columns.map((column, idx) => cardColumn(card, idx))
}

let pitches = column => column.map(parseNote)

describe("staves", function() {
  let container, root

  beforeEach(function() {
    container = document.createElement("div")
    container.style.width = "1000px"
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(function() {
    root.unmount()
    container.remove()
  })

  let renderStaff = (type, columns, props={}) => {
    flushSync(() => root.render(React.createElement(type, {
      notes: new NoteList(columns),
      heldNotes: {},
      keySignature: new KeySignature(-1),
      noteWidth: 60,
      scale: 1,
      ...props,
    })))
  }

  let staffEl = staff => container.querySelector(`[data-staff="${staff}"]`)
  let clefImage = el => el.querySelector(`.${staffStyles.cleff}`).getAttribute("src")
  let notesOn = el => [...el.querySelectorAll(`.${staffStyles.note}`)]
  let notePitches = el => notesOn(el).map(note => +note.dataset.midiNote)
  let ledgerLines = el => el.querySelectorAll(`.${staffStyles.ledger_line}`).length
  let clefChanges = el => [...el.querySelectorAll(`.${staffStyles.clef_change}`)]
  let noteTop = (el, pitch) => notesOn(el).find(note => +note.dataset.midiNote == pitch).style.top
  let noteLeft = (el, pitch) => parseFloat(notesOn(el).find(note => +note.dataset.midiNote == pitch).style.left)

  // the boxes of a clef change and of the note heads, in pixels from the top
  // left of the notes of a 120px staff
  let clefBox = el => {
    let [left, top, width, height] = ["left", "top", "width", "height"].map(key => parseFloat(el.style[key]))
    return {left, right: left + width, top, bottom: top + height}
  }
  let headBoxes = el => notesOn(el).map(note => {
    let left = parseFloat(note.style.left) +
      (note.classList.contains(staffStyles.group_offset) ? GROUP_OFFSET : 0)
    let center = parseFloat(note.style.top) / 100 * 120
    return {left, right: left + NOTE_HEAD_WIDTH, top: center - 12, bottom: center + 12}
  })
  let overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

  // the lower staff's clef change ends before the accidental of the note
  // after it and the bar line of its measure, and covers no note head
  let expectClefChangeClear = nextPitch => {
    let lower = staffEl("lower")
    let [change] = clefChanges(lower)
    let next = noteLeft(lower, nextPitch)
    let barLine = [...lower.querySelectorAll(`.${staffStyles.bar_line}`)]
      .map(bar => parseFloat(bar.style.left))
      .filter(left => left < next)
      .pop()
    expect(clefBox(change).right).toBeLessThan(next - ACCIDENTAL_WIDTH)
    expect(clefBox(change).right).toBeLessThan(barLine)
    for (let head of headBoxes(lower)) {
      expect(overlaps(clefBox(change), head)).toBe(false)
    }
  }

  // the columns of the four measures of a clefChangeScore as one card
  let clefChangeCard = opts => {
    let song = parseMusicXML(clefChangeScore(opts))
    let [card] = measureCards(pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS}, song), 4)
    return card.columns.map((column, idx) => cardColumn(card, idx))
  }

  describe("score staves of imported columns", function() {
    it("carries the grand staff of each note of the Rêverie opening", function() {
      let song = parseMusicXML(reverieOpening())
      let columns = extractSectionColumns(song, {startMeasure: 2, endMeasure: 4, staves: true})

      expect(columns.length).toEqual(7 + 7 + 8)
      expect(pitches(columns[0])).toEqual([Bb3])
      expect(columns[0].staves).toEqual(["lower"])
      expect(columns.slice(0, 14).flatMap(column => column.staves))
        .toEqual(Array(14).fill("lower"))

      // measure 4 opens with the right hand's G5 on the upper staff
      expect(pitches(columns[14])).toEqual([G5])
      expect(columns[14].staves).toEqual(["upper"])
      expect(pitches(columns[18])).toEqual([D5])
      expect(columns[18].staves).toEqual(["upper"])

      // both staves open in treble clef
      expect(columns.every(column => column.clefs.upper == "g" && column.clefs.lower == "g")).toBe(true)

      // other sections are still bare note names
      let plain = extractSectionColumns(song, {startMeasure: 2, endMeasure: 4})
      expect(plain.map(pitches)).toEqual(columns.map(pitches))
      expect(plain.some(column => column.staves)).toBe(false)
    })

    it("keeps the staves and clefs through the sheet music generators", function() {
      let song = parseMusicXML(reverieOpening())
      let measures = pieceSectionMeasures(GRAND, {startMeasure: 2, endMeasure: 4, hand: BOTH_HANDS}, song)

      let [card] = measureCards(measures, 3)
      let generator = new SheetMusicGenerator(card.columns.map((column, idx) => cardColumn(card, idx)), {card})
      let first = generator.nextNote()
      expect(first.staves).toEqual(["lower"])
      expect(first.clefs).toEqual({upper: "g", lower: "g"})
      expect(first.measure).toEqual(2)

      // a staff range drops the note and its staff together
      let narrow = pieceSectionMeasures({name: "treble", range: [noteName(C4), noteName(G5)]},
        {startMeasure: 2, endMeasure: 2, hand: BOTH_HANDS}, song)
      expect(narrow[0].columns.every(column => column.length == column.staves.length)).toBe(true)
      expect(narrow[0].columns.map(pitches)[0]).toEqual([C4])
      expect(narrow[0].columns[0].clefs).toEqual({upper: "g", lower: "g"})
    })

    it("draws the Rêverie ostinato on the lower staff in treble clef", function() {
      let song = parseMusicXML(reverieOpening())
      renderStaff(GrandStaff, sectionColumns(song, 2, 3))

      let upper = staffEl("upper")
      let lower = staffEl("lower")

      expect(notesOn(upper).length).toEqual(0)
      expect(new Set(notePitches(lower))).toEqual(new Set([Bb3, C4, D4, G4]))
      // the fourteen columns of the two bars, the three heads their ties run
      // on to and bar 2's whole note in the second voice, which are all drawn
      // though only the columns are played
      expect(notesOn(lower).length).toEqual(14 + 3 + 1)

      expect(clefImage(upper)).toContain("clefs.G")
      expect(clefImage(lower)).toContain("clefs.G")

      // positioned and ledgered for the treble clef: Bb3 hangs below the C4
      // ledger line, where the bass clef would put it above the staff
      let bFlat = notesOn(lower).find(note => +note.dataset.midiNote == Bb3)
      expect(bFlat.style.top).toEqual("137%")
      expect(ledgerLines(lower)).toBeGreaterThan(0)

      // the key signature is drawn on both staves in treble clef
      for (let el of [upper, lower]) {
        let flat = el.querySelector(`.${staffStyles.key_signature} [data-note]`)
        expect(flat.style.top).toEqual("50%")
      }
    })

    it("draws no clef changes at the gaps between the cards of a drill", function() {
      let song = parseMusicXML(reverieOpening())
      let measures = pieceSectionMeasures(GRAND, {startMeasure: 2, endMeasure: 4, hand: BOTH_HANDS}, song)
      let deck = new MeasureCardDeck(measureCards(measures, 1), {pieceId: "p", order: IN_ORDER})
      let generator = new MeasureCardGenerator(deck)
      let notes = new NoteList([], {generator})
      notes.fillBuffer(10)
      generator.stop()

      expect(notes.slice(7).map(column => column.length)).toEqual([0, 0, 0])

      renderStaff(GrandStaff, notes)
      for (let staff of ["upper", "lower"]) {
        expect(clefChanges(staffEl(staff)).length).toEqual(0)
      }

      // a gap at the head keeps the clef of the card after it
      renderStaff(GrandStaff, [[], ...notes.slice(0, 7)])
      expect(clefImage(staffEl("lower"))).toContain("clefs.G")
      expect(clefChanges(staffEl("lower")).length).toEqual(0)
    })

    it("draws measure 4's right hand on the upper staff with bar lines on both", function() {
      let song = parseMusicXML(reverieOpening())
      renderStaff(GrandStaff, sectionColumns(song, 3, 4))

      let upper = staffEl("upper")
      let lower = staffEl("lower")

      expect(notePitches(upper)).toEqual([G5, D5])
      expect(notePitches(lower)).not.toContain(G5)
      expect(notePitches(lower)).not.toContain(D5)

      for (let el of [upper, lower]) {
        expect([...el.querySelectorAll(`.${staffStyles.bar_line}`)].map(line => line.dataset.measure))
          .toEqual(["3", "4"])
      }
    })

    it("keeps a wrong held note on the staff whose clef draws it nearest, inside the wrapper", function() {
      let song = parseMusicXML(reverieOpening())
      container.classList.add(staffStyles.staff_wrapper)
      renderStaff(GrandStaff, sectionColumns(song, 2, 2), {heldNotes: {[noteName(D4)]: true, [noteName(G2)]: true}})

      // both staves are in treble clef here, so the lower one draws the notes
      // hanging below them
      let held = el => notesOn(el).filter(note => note.classList.contains(staffStyles.held))
      let lower = staffEl("lower")
      expect(held(staffEl("upper")).map(note => +note.dataset.midiNote)).toEqual([])
      expect(held(lower).map(note => +note.dataset.midiNote)).toEqual([D4, G2])

      // G2 sits on the ledger lines below that staff, which makes room for it
      let g2 = notesOn(lower).find(note => +note.dataset.midiNote == G2).getBoundingClientRect()
      let lines = [...lower.querySelectorAll(`.${staffStyles.ledger_line}`)]
        .map(line => line.getBoundingClientRect().top)
      expect(lines.length).toBeGreaterThan(0)
      expect(Math.max(...lines)).toBeGreaterThan(g2.top)
      expect(Math.max(...lines)).toBeLessThan(g2.bottom)

      let wrapper = container.getBoundingClientRect()
      expect(g2.top).toBeGreaterThanOrEqual(wrapper.top)
      expect(g2.bottom).toBeLessThanOrEqual(wrapper.bottom)
    })

    it("makes room for a score note hanging below the treble clef of its staff", function() {
      // the lower staff is written in treble clef, so its A3 sits two ledger
      // lines below the staff, further down than the plate's usual margin
      let song = parseMusicXML(clefChangeScore({
        clefs: [["G", 2], ["G", 2]],
        notes: [["A", 3], ["A", 3], ["A", 3], ["A", 3]],
      }))

      let columns = sectionColumns(song, 1, 4)
      container.classList.add(staffStyles.staff_wrapper)
      renderStaff(GrandStaff, columns, {unitColumns: columns})

      let lower = staffEl("lower")
      expect(clefImage(lower)).toContain("clefs.G")
      expect(notePitches(lower)).toEqual([A3, A3, A3, A3])
      expect(clefChanges(lower).length).toEqual(0)

      let wrapper = container.getBoundingClientRect()
      for (let head of notesOn(lower)) {
        let box = head.getBoundingClientRect()
        expect(box.bottom).toBeGreaterThan(lower.getBoundingClientRect().bottom)
        expect(box.bottom).toBeLessThanOrEqual(wrapper.bottom)
        expect(box.top).toBeGreaterThanOrEqual(wrapper.top)
      }
    })

    it("makes room for a clef change drawn above the staff at the narrowest column", function() {
      // C4 before the change sits above the bass staff, and the narrowest
      // column leaves no room on the staff, so the clef goes above them both
      let song = parseMusicXML(clefChangeScore({notes: [["C", 3], ["C", 4], ["D", 4], ["E", 4]]}))
      let [card] = measureCards(
        pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 4, hand: LEFT_HAND}, song), 4)
      let columns = cardColumns(card)

      container.classList.add(staffStyles.staff_wrapper)
      renderStaff(FStaff, columns, {
        noteWidth: minNoteWidth(columns, new KeySignature(-1)),
        unitColumns: columns,
      })

      let single = container.querySelector(`.${staffStyles.staff}`)
      expect(clefImage(single)).toContain("clefs.F")

      let [change] = clefChanges(single)
      expect(clefChanges(single).length).toEqual(1)
      expect(change.getAttribute("src")).toContain("clefs.G")

      let staff = single.getBoundingClientRect()
      let box = change.getBoundingClientRect()
      let c4 = notesOn(single).find(note => +note.dataset.midiNote == C4).getBoundingClientRect()
      expect(box.bottom).toBeLessThanOrEqual(c4.top)
      expect(box.top).toBeLessThan(staff.top)
      expect(box.top).toBeGreaterThanOrEqual(container.getBoundingClientRect().top)
    })

    it("holds the staff's margins as a drill's notes slide through its card", function() {
      // the lower staff changes to treble clef inside the card, and the C4
      // before the change pushes that clef above the staff
      let song = parseMusicXML(clefChangeScore({notes: [["C", 3], ["C", 4], ["D", 4], ["E", 4]]}))
      let [card] = measureCards(
        pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS}, song), 4)
      let unitColumns = cardColumns(card)
      let keySignature = new KeySignature(-1)

      let deck = new MeasureCardDeck([card], {pieceId: "p", order: IN_ORDER})
      let generator = new MeasureCardGenerator(deck)
      let notes = new NoteList([], {generator})
      notes.fillBuffer(2)

      container.classList.add(staffStyles.staff_wrapper)

      let margins = []
      let heights = []

      for (let shift = 0; shift < unitColumns.length; shift++) {
        flushSync(() => root.render(React.createElement(GrandStaff, {
          notes,
          heldNotes: {},
          keySignature,
          noteWidth: minNoteWidth(card.columns, keySignature),
          scale: 1,
          unitColumns,
        })))

        let lower = staffEl("lower")
        margins.push(`${lower.style.marginTop} ${lower.style.marginBottom}`)
        heights.push(container.getBoundingClientRect().height)

        notes = notes.clone()
        notes.shift()
        notes.pushRandom()
      }

      generator.stop()

      // the clef change is only ever in part of the window, but the card
      // reserves room for it above the staff on every shift
      expect(margins.length).toEqual(4)
      expect(parseFloat(margins[0])).toBeGreaterThan(60)
      expect(new Set(margins).size).toEqual(1)
      expect(new Set(heights).size).toEqual(1)
    })

    it("makes room for the clef change where a looping section wraps to its start", function() {
      // the section opens in treble clef and ends in bass on C4, above the
      // staff, so the treble clef the loop returns to goes above that note
      let song = parseMusicXML(clefChangeScore({
        clefs: [["G", 2], ["F", 4]],
        notes: [["G", 4], ["E", 4], ["C", 3], ["C", 4]],
      }))
      let card = sectionCard(pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 4, hand: LEFT_HAND}, song))
      let keySignature = new KeySignature(-1)

      let notes = new NoteList([], {generator: new SheetMusicGenerator(cardColumns(card), {card})})
      notes.fillBuffer(card.columns.length + 2)

      container.classList.add(staffStyles.staff_wrapper)
      flushSync(() => root.render(React.createElement(FStaff, {
        notes,
        heldNotes: {},
        keySignature,
        noteWidth: minNoteWidth(card.columns, keySignature),
        scale: 1,
        unitColumns: drillColumns(card, {loop: true}),
      })))

      let single = container.querySelector(`.${staffStyles.staff}`)
      expect(clefImage(single)).toContain("clefs.G")

      let changes = clefChanges(single)
      expect(changes.map(change => change.getAttribute("src").includes("clefs.G"))).toEqual([false, true])

      let wrap = changes[1].getBoundingClientRect()
      let c4 = notesOn(single).find(note => +note.dataset.midiNote == C4).getBoundingClientRect()
      expect(wrap.bottom).toBeLessThanOrEqual(c4.top)
      expect(wrap.top).toBeLessThan(single.getBoundingClientRect().top)
      expect(wrap.top).toBeGreaterThanOrEqual(container.getBoundingClientRect().top)
    })

    it("keeps the room both staves reach into between them", function() {
      // the right hand dips to A3 on the upper staff while the left hand
      // reaches C4 on the lower one, so both crowd the gap at the same column
      let song = parseMusicXML(clefChangeScore({
        clefs: [["F", 4], ["F", 4]],
        notes: [["C", 4], ["C", 4], ["C", 4], ["C", 4]],
        upper: ["A", 3],
      }))
      let columns = sectionColumns(song, 1, 4)
      renderStaff(GrandStaff, columns, {unitColumns: columns})

      let upper = staffEl("upper")
      let lower = staffEl("lower")
      expect(clefImage(upper)).toContain("clefs.G")
      expect(clefImage(lower)).toContain("clefs.F")
      expect(new Set(notePitches(upper))).toEqual(new Set([A3]))
      expect(new Set(notePitches(lower))).toEqual(new Set([C4]))

      let gap = () => staffEl("lower").getBoundingClientRect().top -
        staffEl("upper").getBoundingClientRect().bottom
      let head = (el, pitch) =>
        notesOn(el).find(note => +note.dataset.midiNote == pitch).getBoundingClientRect()

      // the gap grows past the stylesheet's own, so the heads never meet
      expect(gap()).toBeGreaterThan(70)
      expect(head(upper, A3).bottom).toBeLessThanOrEqual(head(lower, C4).top)

      // a score on the classic treble over bass staves never reaches that
      // far, so it keeps the gap it always had
      let classic = parseMusicXML(clefChangeScore({
        clefs: [["F", 4], ["F", 4]],
        notes: [["B", 3], ["B", 3], ["B", 3], ["B", 3]],
        upper: ["C", 4],
      }))
      let classicColumns = sectionColumns(classic, 1, 4)
      let classicProps = {unitColumns: classicColumns, keySignature: new KeySignature(0)}
      renderStaff(GrandStaff, classicColumns, classicProps)

      expect(notePitches(staffEl("upper"))).toContain(C4)
      expect(notePitches(staffEl("lower"))).toContain(B3)
      expect(gap()).toEqual(70)
      expect(head(staffEl("upper"), C4).bottom)
        .toBeLessThanOrEqual(head(staffEl("lower"), B3).top)

      // in F major the same B3 carries a natural, which reaches further than
      // its head, so the gap opens for it
      renderStaff(GrandStaff, classicColumns, {unitColumns: classicColumns})
      expect(staffEl("lower").querySelector(`.${staffStyles.natural}`)).not.toBe(null)
      expect(gap()).toBeGreaterThan(70)
      expect(head(staffEl("upper"), C4).bottom)
        .toBeLessThanOrEqual(head(staffEl("lower"), B3).top)

      // as does a drill of bare columns, split at middle C
      renderStaff(GrandStaff, [[noteName(E4)], [noteName(G3)]])
      expect(gap()).toEqual(70)
    })

    it("keeps that room at the staff's own scale, where the columns are narrowest", function() {
      // the narrowest columns at this scale leave no room on the lower staff
      // for its clef change, so it goes above the staff's lines and into the
      // gap, where the right hand's A3 already hangs below the upper staff
      let columns = clefChangeCard({
        notes: [["C", 3], ["C", 4], ["D", 4], ["E", 4]],
        upper: ["A", 3],
      })
      let keySignature = new KeySignature(0)

      renderStaff(GrandStaff, columns, {
        scale: 0.8,
        keySignature,
        noteWidth: minNoteWidth(columns, keySignature),
        unitColumns: columns,
      })

      let upper = staffEl("upper")
      let [change] = clefChanges(staffEl("lower"))
      expect(change.getAttribute("src")).toContain("clefs.G")
      expect(clefBox(change).top).toBeLessThan(0)

      let heads = notesOn(upper).map(note => note.getBoundingClientRect().bottom)
      expect(heads.length).toEqual(4)
      expect(change.getBoundingClientRect().top).toBeGreaterThanOrEqual(Math.max(...heads))
    })

    it("makes room for the accidental on a note far outside the staff", function() {
      // the score writes the left hand in treble clef, so its B3 hangs three
      // ledger lines below, and F major draws a natural on it
      let song = parseMusicXML(clefChangeScore({
        clefs: [["G", 2], ["G", 2]],
        notes: [["B", 3], ["B", 3], ["B", 3], ["B", 3]],
      }))
      let columns = sectionColumns(song, 1, 4)

      container.classList.add(staffStyles.staff_wrapper)
      renderStaff(GrandStaff, columns, {unitColumns: columns})

      let lower = staffEl("lower")
      expect(clefImage(lower)).toContain("clefs.G")
      expect(new Set(notePitches(lower))).toEqual(new Set([B3]))

      let naturals = [...lower.querySelectorAll(
        `.${staffStyles.staff_notes} .${staffStyles.natural}`)]
      expect(naturals.length).toEqual(4)

      let wrapper = container.getBoundingClientRect()
      for (let natural of naturals) {
        let box = natural.getBoundingClientRect()
        expect(box.bottom).toBeGreaterThan(lower.getBoundingClientRect().bottom)
        expect(box.bottom).toBeLessThanOrEqual(wrapper.bottom)
      }
    })

    it("splits wrong held notes at middle C on columns without the score's clefs", function() {
      renderStaff(GrandStaff, [[noteName(E4)], [noteName(G3)]],
        {heldNotes: {[noteName(C4)]: true, [noteName(B3)]: true}})

      let held = el => notesOn(el).filter(note => note.classList.contains(staffStyles.held))
      expect(clefImage(staffEl("upper"))).toContain("clefs.G")
      expect(clefImage(staffEl("lower"))).toContain("clefs.F")
      expect(held(staffEl("upper")).map(note => +note.dataset.midiNote)).toEqual([C4])
      expect(held(staffEl("lower")).map(note => +note.dataset.midiNote)).toEqual([B3])
    })

    it("draws one hand alone in that staff's clef", function() {
      let song = parseMusicXML(reverieOpening())

      let left = sectionColumns(song, 2, 4, LEFT_HAND)
      renderStaff(GrandStaff, left)
      expect(notesOn(staffEl("upper")).length).toEqual(0)
      expect(clefImage(staffEl("lower"))).toContain("clefs.G")
      expect(notePitches(staffEl("lower"))).not.toContain(G5)

      // a single bass staff shows the left hand in the treble clef it's written in
      renderStaff(FStaff, left)
      let single = container.querySelector(`.${staffStyles.staff}`)
      expect(clefImage(single)).toContain("clefs.G")
      expect(noteTop(single, Bb3)).toEqual("137%")

      let right = sectionColumns(song, 2, 4, RIGHT_HAND)
      expect(right.map(pitches)).toEqual([[G5], [D5]])
      renderStaff(GrandStaff, right)
      expect(notePitches(staffEl("upper"))).toEqual([G5, D5])
      expect(notesOn(staffEl("lower")).length).toEqual(0)
    })

    it("keeps a staff on its own in its clef when it shows both hands", function() {
      let song = parseMusicXML(reverieOpening())

      // measures 2 and 3 have only the left hand, which the score writes in treble clef
      renderStaff(FStaff, sectionColumns(song, 2, 3))
      let single = container.querySelector(`.${staffStyles.staff}`)
      expect(clefImage(single)).toContain("clefs.F")
      expect(clefChanges(single).length).toEqual(0)
      expect(noteTop(single, Bb3)).toEqual("-13%")
    })

    it("draws a clef change on the lower staff", function() {
      let song = parseMusicXML(clefChangeScore())

      // measures 3 and 4 are in treble clef on the lower staff
      renderStaff(GrandStaff, sectionColumns(song, 3, 4))
      expect(clefImage(staffEl("upper"))).toContain("clefs.G")
      expect(clefImage(staffEl("lower"))).toContain("clefs.G")
      expect(notePitches(staffEl("lower"))).toEqual([C4, C4 + 4])
      expect(ledgerLines(staffEl("lower"))).toEqual(1) // the C4 below the treble staff

      // measures 1 and 2 are in bass clef
      renderStaff(GrandStaff, sectionColumns(song, 1, 2))
      expect(clefImage(staffEl("lower"))).toContain("clefs.F")
      expect(ledgerLines(staffEl("lower"))).toEqual(0)

      // a range crossing the change opens in bass clef and changes to treble
      renderStaff(GrandStaff, sectionColumns(song, 2, 3))
      let lower = staffEl("lower")
      expect(clefImage(lower)).toContain("clefs.F")
      expect(notePitches(lower)).toEqual([C4 - 8, C4])
      expect(clefChanges(lower).map(clef => clef.getAttribute("src"))).toEqual(["/static/svg/clefs.G.svg"])
      expect(noteTop(lower, C4)).toEqual("125%")
      expect(clefChanges(staffEl("upper")).length).toEqual(0)

      // each column keeps the clefs at its onset
      let columns = extractSectionColumns(song, {startMeasure: 1, endMeasure: 4, staves: true})
      expect(columns.map(column => column.clefs.lower)).toEqual(["f", "f", "g", "g"])
    })

    it("draws a clef change inside a card at the measure it starts", function() {
      let song = parseMusicXML(clefChangeScore({
        clefs: [["G", 2], ["F", 4]],
        notes: [["C", 4], ["E", 4], ["G", 2], ["B", 2]],
      }))

      let [card] = measureCards(pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS}, song), 4)
      renderStaff(GrandStaff, card.columns.map((column, idx) => cardColumn(card, idx)))

      let lower = staffEl("lower")
      expect(clefImage(lower)).toContain("clefs.G")

      let [change] = clefChanges(lower)
      expect(clefChanges(lower).length).toEqual(1)
      expect(change.getAttribute("src")).toContain("clefs.F")
      expect(clefBox(change).left).toBeGreaterThan(noteLeft(lower, C4 + 4))
      expect(clefBox(change).right).toBeLessThan(noteLeft(lower, G2))

      // G2 after the change sits on the bottom line of the bass staff,
      // without the ledger lines the treble clef would need
      expect(noteTop(lower, G2)).toEqual("100%")
      expect(ledgerLines(lower)).toEqual(1) // the C4 of measure 1, in treble clef
    })

    it("fits a clef change clear of the note heads and the next accidental", function() {
      // C4 before the change sits above the bass staff, on a ledger line
      let columns = clefChangeCard({notes: [["C", 3], ["C", 4], ["D", 4], ["E", 4]]})

      for (let noteWidth of [minNoteWidth(columns, new KeySignature(-1)), 100]) {
        renderStaff(GrandStaff, columns, {noteWidth})
        expectClefChangeClear(D4)
      }

      // a wide column has room for it on the staff, smaller than the heading clef
      let box = clefBox(clefChanges(staffEl("lower"))[0])
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.bottom - box.top).toBeLessThan(120 * 1.15)
    })

    it("fits a clef change clear of a stacked second before it", function() {
      let columns = clefChangeCard({notes: [["C", 3], [["F", 3], ["G", 3]], ["C", 4], ["E", 4]]})

      for (let noteWidth of [minNoteWidth(columns, new KeySignature(-1)), 130]) {
        renderStaff(GrandStaff, columns, {noteWidth})

        let lower = staffEl("lower")
        expect(notePitches(lower)).toContain(F3)
        expect(notesOn(lower).filter(note => note.classList.contains(staffStyles.group_offset))
          .map(note => +note.dataset.midiNote)).toEqual([G3])
        expectClefChangeClear(C4)
      }
    })

    it("draws a clef change inside a measure before the column it starts at", function() {
      let song = parseMusicXML(midMeasureClefScore([["C", 3], ["E", 3], ["clef", "G", 2], ["C", 4], ["E", 4]]))
      renderStaff(GrandStaff, sectionColumns(song, 1, 1))

      let lower = staffEl("lower")
      expect(clefImage(lower)).toContain("clefs.F")

      let changes = clefChanges(lower)
      expect(changes.map(clef => clef.getAttribute("src"))).toEqual(["/static/svg/clefs.G.svg"])
      let left = pitch => parseFloat(notesOn(lower).find(note => +note.dataset.midiNote == pitch).style.left)
      let changeLeft = parseFloat(changes[0].style.left)
      expect(changeLeft).toBeGreaterThan(left(E3))
      expect(changeLeft).toBeLessThan(left(C4))

      // beats 3 and 4 are placed and ledgered in treble clef: only C4 needs a
      // ledger line, where the bass clef would put both above the staff
      expect(noteTop(lower, C3)).toEqual("62%")
      expect(noteTop(lower, C4)).toEqual("125%")
      expect(noteTop(lower, C4 + 4)).toEqual("100%")
      expect(ledgerLines(lower)).toEqual(1)
    })

    it("draws both clef changes of a switch and back inside a measure", function() {
      let song = parseMusicXML(midMeasureClefScore([
        ["C", 3], ["clef", "G", 2], ["C", 4], ["clef", "F", 4], ["E", 3], ["G", 3],
      ]))
      renderStaff(GrandStaff, sectionColumns(song, 1, 1))

      let lower = staffEl("lower")
      expect(clefImage(lower)).toContain("clefs.F")
      expect(clefChanges(lower).map(clef => clef.getAttribute("src")))
        .toEqual(["/static/svg/clefs.G.svg", "/static/svg/clefs.F_change.svg"])
      expect(noteTop(lower, C4)).toEqual("125%")
      expect(noteTop(lower, E3)).toEqual("37%")
    })
  })

  describe("the score's rhythm", function() {
    // a 4/4 bar of a half note and two quarters, then one of a dotted
    // quarter, an eighth and a sixteenth, all on the treble staff
    let rhythmScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>6</duration><dot/><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>16th</type></note>
      <note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

    let head = (el, pitch) => notesOn(el).find(note => +note.dataset.midiNote == pitch)
    let stemOf = (el, pitch) => head(el, pitch).querySelector(`.${staffStyles.stem}`)
    let flagsOn = (el, pitch) => head(el, pitch).querySelectorAll(`.${staffStyles.flag}`).length
    let dotsOn = (el, pitch) => head(el, pitch).querySelectorAll(`.${staffStyles.aug_dot}`).length

    it("draws each head, stem, flag and dot as the score writes it", function() {
      let song = parseMusicXML(rhythmScore())
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let types = notesOn(staff).map(note => note.dataset.noteType)
      expect(types).toEqual(["half", "quarter", "quarter", "quarter", "eighth", "16th"])
      expect(notesOn(staff).map(note => note.dataset.head))
        .toEqual(["half", "filled", "filled", "filled", "filled", "filled"])

      // stems turn at the middle line, and only shorter values carry flags
      expect(stemOf(staff, C5).dataset.stem).toEqual("down")
      expect(stemOf(staff, G4).dataset.stem).toEqual("up")
      expect(flagsOn(staff, C5)).toEqual(0)
      expect(flagsOn(staff, F5)).toEqual(1)
      expect(flagsOn(staff, A4)).toEqual(2)

      // only the dotted quarter is dotted
      expect(notesOn(staff).map(note => +note.dataset.midiNote).filter(p => dotsOn(staff, p)))
        .toEqual([D5])
      expect(dotsOn(staff, D5)).toEqual(1)
    })

    it("spaces the columns by the beats between them", function() {
      let song = parseMusicXML(rhythmScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let left = pitch => parseFloat(head(staff, pitch).style.left)

      // the gaps of the bar are 2, 1 and 1 beats, a mean of 4/3 to a column
      // width, and a note's room grows under its length (SPACING_EXPONENT)
      let room = gaps => Math.pow(gaps, SPACING_EXPONENT) * 60
      expect(left(E5) - left(C5)).toBeCloseTo(room(1.5), 3)
      expect(left(G4) - left(E5)).toBeCloseTo(room(0.75), 3)
      expect(left(E5) - left(C5)).toBeGreaterThan(left(G4) - left(E5))
    })

    it("draws the score's rests at their beat", function() {
      let song = parseMusicXML(rhythmScore())
      let columns = sectionColumns(song, 2, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let rests = [...staff.querySelectorAll(`.${staffStyles.rest}`)]

      expect(rests.map(rest => rest.dataset.restType)).toEqual(["quarter"])
      expect(parseFloat(rests[0].style.left))
        .toBeGreaterThan(parseFloat(head(staff, A4).style.left))
    })

    // a grand staff piece whose lower staff rests through three bars: a whole
    // measure rest, then a half rest, then a quarter rest
    let restScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest measure="yes"/><duration>16</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>8</duration><voice>2</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
    <measure number="3">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>12</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("sets the rests on the staff by their value, never by a pitch", function() {
      let song = parseMusicXML(restScore())
      let columns = sectionColumns(song, 1, 3)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let lower = staffEl("lower")
      let rests = [...lower.querySelectorAll(`.${staffStyles.rest}`)]
      expect(rests.map(rest => rest.dataset.restType)).toEqual(["whole", "half", "quarter"])

      let [whole, half, quarter] = rests.map(rest => rest.getBoundingClientRect())
      let line = n => lower.querySelector(`.${staffStyles[`line${n}`]}`).getBoundingClientRect()
      let middle = line(3)

      // within a staff line's own thickness
      let onLine = (at, lineBox) => expect(Math.abs(at - lineBox.top)).toBeLessThanOrEqual(lineBox.height)

      // a whole rest hangs under the second line from the top
      onLine(whole.top, line(2))
      expect(whole.bottom).toBeGreaterThan(line(2).bottom)

      // a half rest sits on the middle line, a quarter rest is centred on it
      onLine(half.bottom, middle)
      onLine((quarter.top + quarter.bottom) / 2 - middle.height / 2, middle)

      // the whole measure rest is centred in the bar it fills
      let bars = [...lower.querySelectorAll(`.${staffStyles.bar_line}`)]
        .map(bar => parseFloat(bar.style.left))
      let wholeLeft = parseFloat(rests[0].style.left)
      expect(wholeLeft).toBeGreaterThan(bars[0])
      expect(wholeLeft + whole.width).toBeLessThan(bars[1])
    })

    it("draws a drill without the score's rhythm as whole notes", function() {
      renderStaff(GStaff, [[noteName(C5)], [noteName(E5)]], {keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      expect(notesOn(staff).map(note => note.dataset.head)).toEqual(["whole", "whole"])
      expect(notesOn(staff).every(note => note.classList.contains(staffStyles.whole_note))).toBe(true)
      expect(staff.querySelectorAll(`.${staffStyles.stem}`).length).toEqual(0)

      // one column width apart, as they always were
      expect(notesOn(staff).map(note => parseFloat(note.style.left)))
        .toEqual([0, 60])
    })
  })

  describe("columns without staves", function() {
    it("splits a random generator's notes at middle C", function() {
      renderStaff(GrandStaff, [[noteName(Bb3), noteName(C4), noteName(G4)], [noteName(D4)]])

      expect(notePitches(staffEl("upper")).sort()).toEqual([C4, D4, G4])
      expect(notePitches(staffEl("lower"))).toEqual([Bb3])
      expect(clefImage(staffEl("upper"))).toContain("clefs.G")
      expect(clefImage(staffEl("lower"))).toContain("clefs.F")
    })

    it("keeps a single staff in its own clef", function() {
      renderStaff(FStaff, [[noteName(Bb3)]])
      expect(clefImage(container.querySelector(`.${staffStyles.staff}`))).toContain("clefs.F")

      renderStaff(GStaff, [[noteName(Bb3)]])
      expect(clefImage(container.querySelector(`.${staffStyles.staff}`))).toContain("clefs.G")
    })
  })
})
