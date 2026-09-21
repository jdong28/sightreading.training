import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {GStaff, FStaff, GrandStaff} from "st/components/staves"
import staffStyles from "st/components/staff.module.css"
import {minNoteWidth, keySignatureWidth, ACCIDENTAL_WIDTH, NOTE_HEAD_WIDTH, GROUP_OFFSET} from "st/components/staff_notes"
import {
  SPACING_EXPONENT, headGlyph, NOTE_HEAD_HEIGHT, STAFF_ROW, MAX_BEAM_RISE,
  columnSpan,
} from "st/staff_rhythm"
import {songFromJSON} from "st/sheet_music_deck"
import NoteList from "st/note_list"
import {KeySignature, noteName, parseNote} from "st/music"
import {parseMusicXML} from "st/musicxml"
import {extractSectionColumns} from "st/song_sections"
import {
  sectionCard, cardColumn, cardColumns, drillColumns, measureCards, MeasureCardDeck, MeasureCardGenerator, IN_ORDER
} from "st/measure_cards"
import {SheetMusicGenerator} from "st/generators"
import {pieceSectionMeasures, BOTH_HANDS, RIGHT_HAND, LEFT_HAND} from "st/data"
import {
  reverieOpening, tripletScore, restBarScore, clefChangeScore, midMeasureClefScore,
  tiedLeadScore, bassOstinatoScore
} from "spec/helpers"

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

// the one bar of bassOstinatoScore, drilled on the grand staff
let bassOstinato = () => sectionColumns(parseMusicXML(bassOstinatoScore()), 1, 1)

// the directions of the stems drawn on the eighth note heads of a staff
let eighthStems = el => new Set([...el.querySelectorAll(`.${staffStyles.note}`)]
  .filter(note => note.dataset.noteType == "eighth")
  .map(note => {
    let stem = note.querySelector(`.${staffStyles.stem}`)
    return stem && stem.dataset.stem
  }))

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

    it("turns every eighth of Rêverie bar 2 the same way in the left hand", function() {
      let song = parseMusicXML(reverieOpening())
      renderStaff(GrandStaff, sectionColumns(song, 2, 2))

      let lower = staffEl("lower")
      // the voice holding the whole note under the ostinato sounds only on
      // the bar's first onset, but the ostinato is the bar's upper voice
      // right through it, so every one of its eighths stems the same way
      let stems = notesOn(lower)
        .filter(note => note.dataset.noteType == "eighth")
        .map(note => note.querySelector(`.${staffStyles.stem}`))

      expect(stems.length).toEqual(8)
      expect(new Set(stems.map(stem => stem && stem.dataset.stem))).toEqual(new Set(["up"]))
    })

    it("turns a bar's upper voice up over a bass staff's middle line", function() {
      // every note of the ostinato sits above the bass staff's middle line, so
      // the middle line alone would stem them all down; the held note under
      // them makes the ostinato the bar's upper voice, which stems up
      let columns = bassOstinato()
      renderStaff(GrandStaff, columns, {unitColumns: columns})

      expect(eighthStems(staffEl("lower"))).toEqual(new Set(["up"]))
    })

    it("keeps the left hand's stems turned the same way as the window slides", function() {
      let columns = bassOstinato()

      // the window has moved past the bar's first column, which is where the
      // held note the ostinato is the upper voice of sounds, so only the unit
      // still says which voice the eighths are
      renderStaff(GrandStaff, columns.slice(1), {unitColumns: columns})

      expect(eighthStems(staffEl("lower"))).toEqual(new Set(["up"]))
    })

    it("keeps the room between the staves clear of the left hand's stems", function() {
      let columns = bassOstinato()
      container.classList.add(staffStyles.staff_wrapper)
      renderStaff(GrandStaff, columns, {unitColumns: columns})

      // the ostinato is the upper of the bar's two voices, so its stems point
      // up, off the top of the bass staff, and the grand staff measures them
      let lines = [...staffEl("upper").querySelectorAll(`.${staffStyles.line}`)]
        .map(line => line.getBoundingClientRect().bottom)
      let stemTops = [...staffEl("lower").querySelectorAll(`.${staffStyles.stem}`)]
        .map(stem => stem.getBoundingClientRect().top)

      expect(stemTops.length).toBeGreaterThan(0)
      expect(Math.min(...stemTops)).toBeGreaterThan(Math.max(...lines))
    })

    it("draws a tie running on from the card before inside the staff's notes", function() {
      let song = parseMusicXML(tiedLeadScore())
      // the treble staff drops beat 2's column, which only the left hand
      // strikes, so the head the C5 ties on to there is carried onto the
      // column after it and leads that column's own bar
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS,
        {name: "treble", range: [noteName(C4), noteName(C5 + 12)]})
      let lead = columns.findIndex(column => (column.extras || [])
        .some(extra => extra.kind == "head" && extra.beat < column.beat))

      expect(lead).toBeGreaterThan(0)
      renderStaff(GStaff, columns.slice(lead), {unitColumns: columns})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      // F major, so the staff's notes start after its one flat
      let offsetLeft = keySignatureWidth(new KeySignature(-1))
      let heads = notesOn(staff).map(note => parseFloat(note.style.left))

      // the tied head leads the staff, and no head is drawn back over the
      // key signature to make room for the stub of its tie
      expect(Math.min(...heads)).toBeGreaterThanOrEqual(offsetLeft)

      let ties = [...staff.querySelectorAll(`.${staffStyles.tie}`)]
      expect(ties.length).toBeGreaterThan(0)
      for (let tie of ties) {
        // M x1 y1 Q cx cy x2 y2
        let [x1, , , , x2] = tie.getAttribute("d").match(/-?[\d.]+/g).map(Number)
        expect(x1).toBeGreaterThanOrEqual(offsetLeft)
        expect(x1).toBeLessThan(x2)
      }
    })

    it("ends a tie on the head it joins when another voice doubles it", function() {
      let song = parseMusicXML(reverieOpening())
      let columns = sectionColumns(song, 2, 3)
      renderStaff(GrandStaff, columns, {unitColumns: columns})

      let lower = staffEl("lower")
      // bar 3 opens on the Bb3 the ostinato ties into, which the whole note of
      // the other voice also strikes: the tied head, written as the eighth the
      // ostinato runs in, is drawn beside the whole note that is played
      let [doubled] = notesOn(lower).filter(note =>
        parseFloat(note.style.marginLeft) > 0 && note.dataset.noteType == "eighth")
      expect(doubled).toBeTruthy()

      let width = headGlyph(doubled.dataset.noteType, NOTE_HEAD_HEIGHT).width
      let drawn = parseFloat(doubled.style.left) + parseFloat(doubled.style.marginLeft)

      // the arc meets the head where it is drawn, not a head's width short of
      // it on the played note beside it
      let ends = [...lower.querySelectorAll(`.${staffStyles.tie}`)]
        .map(tie => tie.getAttribute("d").match(/-?[\d.]+/g).map(Number)[4])
      let nearest = ends.reduce((near, x2) =>
        Math.abs(x2 - drawn) < Math.abs(near - drawn) ? x2 : near)

      expect(nearest).toBeGreaterThan(drawn)
      expect(nearest).toBeLessThan(drawn + width)
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

    // four 4/4 grand staff bars: the lower staff changes to treble clef in
    // measure 3, the card's last played bar, and measure 4 is one every hand
    // rests through, so that bar hangs on the card's last column
    let clefChangeThenRestBarScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[["C", 3], ["E", 3], ["C", 4], null].map((lower, idx) => `
    <measure number="${idx + 1}">
      ${idx == 0 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${idx == 2 ? `<attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>` : ""}
      ${lower ? `<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>` :
        `<note><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note>`}
      <backup><duration>4</duration></backup>
      ${lower ? `<note><pitch><step>${lower[0]}</step><octave>${lower[1]}</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>` :
        `<note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("keeps a clef change clear of its own bar line when the card ends on a rested bar", function() {
      let song = parseMusicXML(clefChangeThenRestBarScore())
      let columns = sectionColumns(song, 1, 4)

      // the rested bar is drawn after the card's last column, which is also
      // the one that changes clef
      expect(columns.length).toEqual(3)
      expect(columns[2].bars).toEqual([{number: 4, beat: 12, beats: 4}])

      // wide enough that the clef is drawn in the gap rather than above the staff
      renderStaff(GrandStaff, columns, {noteWidth: 130, keySignature: new KeySignature(0)})
      let lower = staffEl("lower")

      let [change] = clefChanges(lower)
      expect(clefChanges(lower).length).toEqual(1)
      expect(change.getAttribute("src")).toContain("clefs.G")
      expect(clefBox(change).top).toBeGreaterThanOrEqual(0)

      let barLine = n => parseFloat(lower
        .querySelector(`.${staffStyles.bar_line}[data-measure="${n}"]`).style.left)

      // the clef sits in the gap before the bar it opens, never over that
      // bar's own line, whatever the bar drawn after the column does
      expect(clefBox(change).right).toBeLessThan(barLine(3))
      expect(barLine(3)).toBeLessThan(barLine(4))
      for (let head of headBoxes(lower)) {
        expect(overlaps(clefBox(change), head)).toBe(false)
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

    // a grand staff score whose right hand plays four quarters through a bar
    // the left hand rests out whole, then a bar both hands hold
    let barRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>16</duration></backup>
      <note><rest measure="yes"/><duration>16</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("centres a whole measure rest in the bar it fills, not in one column's room", function() {
      let song = parseMusicXML(barRestScore())
      let columns = sectionColumns(song, 1, 2)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let rest = staffEl("lower").querySelector(`.${staffStyles.rest}`)
      expect(rest.dataset.restType).toEqual("whole")

      let heads = notesOn(staffEl("upper"))
        .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let middle = parseFloat(rest.style.left) + rest.getBoundingClientRect().width / 2
      let barLine = n => parseFloat(staffEl("lower")
        .querySelector(`.${staffStyles.bar_line}[data-measure="${n}"]`).style.left)

      expect(heads.length).toEqual(5)
      // the rest fills the bar, so it is centred between the lines the bar is
      // drawn between — about its third quarter, not half way into the first
      // one's room
      expect(middle).toBeCloseTo((barLine(1) + barLine(2)) / 2, 0)
      expect(Math.abs(middle - heads[2])).toBeLessThan(heads[1] - heads[0])
    })

    // three 4/4 bars whose middle one the left hand rests out while the right
    // hand waits three beats before its one note, so that bar's line is drawn
    // well left of the only head in it
    let lateEntryRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>3</duration><dot/><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="3">
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("centres a whole measure rest between the bar lines its bar is drawn between", function() {
      let song = parseMusicXML(lateEntryRestScore())
      let columns = sectionColumns(song, 1, 3)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let lower = staffEl("lower")
      let rest = lower.querySelector(`.${staffStyles.rest}`)
      let barLine = n => parseFloat(lower
        .querySelector(`.${staffStyles.bar_line}[data-measure="${n}"]`).style.left)

      expect(rest.dataset.restType).toEqual("whole")
      // bar 2's line is pulled back to the rests that open it, well left of
      // the bar's only head, and the rest fills the bar between the lines
      expect(barLine(2)).toBeLessThan(noteLeft(staffEl("upper"), G5))

      let middle = parseFloat(rest.style.left) + rest.getBoundingClientRect().width / 2
      expect(middle).toBeCloseTo((barLine(2) + barLine(3)) / 2, 0)
    })

    it("keeps a bar's whole measure rest drawn once its opening column is played", function() {
      let song = parseMusicXML(barRestScore())
      let columns = sectionColumns(song, 1, 2)
      // the window the staff draws once bar 1's first column has been played,
      // its card still fixing the layout (see unitColumns)
      renderStaff(GrandStaff, columns.slice(1), {unitColumns: columns, keySignature: new KeySignature(0)})

      let lower = staffEl("lower")
      let rest = lower.querySelector(`.${staffStyles.rest}`)

      // the rest fills a bar the staff still draws three quarters of, so it is
      // drawn though the column it was attached to has left the window
      expect(rest).toBeTruthy()
      expect(rest.dataset.restType).toEqual("whole")

      let heads = notesOn(staffEl("upper"))
        .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let barLine = parseFloat(lower
        .querySelector(`.${staffStyles.bar_line}[data-measure="2"]`).style.left)
      let middle = parseFloat(rest.style.left) + rest.getBoundingClientRect().width / 2

      expect(heads.length).toEqual(4)
      expect(middle).toBeGreaterThan(heads[0])
      expect(middle).toBeLessThan(barLine)
    })

    // a grand staff score whose middle bar every hand rests through, between a
    // bar of whole notes and one the right hand plays four quarters in
    let restBarThenNotesScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[1, 2, 3].map(number => `
    <measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${number == 2 ? `<note><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note>` :
        number == 3 ? ["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("") :
        `<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>`}
      <backup><duration>4</duration></backup>
      ${number == 2 ? `<note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>` :
        `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("leaves the whole measure rest of a bar holding no column behind with it", function() {
      let song = parseMusicXML(restBarThenNotesScore())
      let columns = sectionColumns(song, 1, 3)

      // the rested bar hands the drill nothing, so its rests hang on the
      // opening column of the bar after it
      expect(columns.map(column => column.measure ?? null)).toEqual([1, 3, null, null, null])

      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      expect(staffEl("lower").querySelectorAll(`.${staffStyles.rest}`).length).toEqual(1)

      // once that column is played the rested bar has left the staff, so its
      // rest is not drawn again over the bar being read
      renderStaff(GrandStaff, columns.slice(2), {unitColumns: columns, keySignature: new KeySignature(0)})
      expect(staffEl("lower").querySelectorAll(`.${staffStyles.rest}`).length).toEqual(0)
    })

    // three 4/4 grand staff bars: whole notes, then a bar every hand rests
    // through, then a bar the right hand plays four quarters in while the left
    // hand rests it out
    let restedBarThenRestingHandScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[1, 2, 3].map(number => `
    <measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${number == 2 ? `<note><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note>` :
        number == 3 ? ["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("") :
        `<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>`}
      <backup><duration>4</duration></backup>
      ${number == 1 ? `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>` :
        `<note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("carries the whole measure rest of a bar that also holds one with no column", function() {
      let song = parseMusicXML(restedBarThenRestingHandScore())
      let columns = sectionColumns(song, 1, 3)

      // measure 3's opening column holds the rested bar before it and its own
      // hand's whole measure rest
      expect(columns[1].bars).toEqual([{number: 2, beat: 4, beats: 4}])

      renderStaff(GrandStaff, columns.slice(2), {unitColumns: columns, keySignature: new KeySignature(0)})
      let lower = staffEl("lower")
      let rests = [...lower.querySelectorAll(`.${staffStyles.rest}`)]

      // the left hand rests measure 3 out, so its rest is still drawn once the
      // bar's opening column is played, while the rested bar's has left with it
      expect(rests.map(rest => rest.dataset.restType)).toEqual(["whole"])
      expect(parseFloat(rests[0].style.left)).toBeGreaterThanOrEqual(0)
    })

    // the same three bars, but measure 3 opens on a quarter rest in both hands
    let restedBarThenLeadingRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[1, 2, 3].map(number => `
    <measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${number == 2 ? `<note><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note>` :
        number == 3 ? `<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>` +
          ["D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("") :
        `<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>`}
      <backup><duration>4</duration></backup>
      ${number == 2 ? `<note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>` :
        number == 3 ? `<note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><dot/><voice>2</voice><type>half</type><staff>2</staff></note>` :
        `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("keeps the rest a bar opens with in front of its head, not on it, after a rested bar", function() {
      let song = parseMusicXML(restedBarThenLeadingRestScore())
      let columns = sectionColumns(song, 1, 3)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let upper = staffEl("upper")
      let rests = [...upper.querySelectorAll(`.${staffStyles.rest}`)]
      let opening = rests.find(rest => rest.dataset.restType == "quarter")
      expect(opening).toBeTruthy()

      // measure 3's own opening rest belongs to its bar, not to the rested bar
      // before it, so it sits in the room kept in front of the bar's first head
      let at = parseFloat(opening.style.left)
      let head = headBoxes(upper).sort((a, b) => a.left - b.left)
        .find(box => box.left >= at)
      expect(head).toBeTruthy()
      expect(at + opening.getBoundingClientRect().width).toBeLessThanOrEqual(head.left)
    })

    // three 4/4 grand staff bars whose first one every hand rests through
    let openingRestBarScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[1, 2, 3].map(number => `
    <measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${number == 1 ? `<note><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note>` :
        `<note><pitch><step>${number == 2 ? "C" : "E"}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>`}
      <backup><duration>4</duration></backup>
      ${number == 1 ? `<note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>` :
        `<note><pitch><step>${number == 2 ? "C" : "E"}</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("draws the rested bar a looping card opens on again where the loop wraps", function() {
      let song = parseMusicXML(openingRestBarScore())
      let card = sectionCard(pieceSectionMeasures(GRAND, {
        startMeasure: 1, endMeasure: 3, hand: BOTH_HANDS,
      }, song))
      let columns = drillColumns(card, {loop: true})

      // the rested bar hangs on the card's first column, which the loop draws
      // again at its end
      expect(columns.length).toEqual(3)
      expect(columns[2].bars).toEqual([{number: 1, beat: 0, beats: 4}])

      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      let lower = staffEl("lower")

      let lines = [...lower.querySelectorAll(`.${staffStyles.bar_line}[data-measure="1"]`)]
        .map(line => parseFloat(line.style.left))
      let heads = notesOn(lower).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let rests = [...lower.querySelectorAll(`.${staffStyles.rest}`)]
        .map(rest => parseFloat(rest.style.left))

      // the wrap draws the bar again after the notes before it, never back
      // over them or off the left of the plate
      expect(lines.length).toEqual(2)
      expect(lines[0]).toBeGreaterThanOrEqual(0)
      expect(lines[1]).toBeGreaterThan(heads[1])
      expect(Math.min(...rests)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...rests)).toBeGreaterThan(heads[1])
    })

    it("centres a whole measure rest in its own bar when the card loops", function() {
      let song = parseMusicXML(barRestScore())
      let card = sectionCard(pieceSectionMeasures(GRAND, {
        startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS,
      }, song))
      // the single bar drilled on a loop, its first column coming round again
      let columns = drillColumns(card, {loop: true})
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let [rest] = [...staffEl("lower").querySelectorAll(`.${staffStyles.rest}`)]
      let heads = notesOn(staffEl("upper"))
        .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let middle = parseFloat(rest.style.left) + rest.getBoundingClientRect().width / 2

      // the bar ends where the loop wraps back to it, so its middle is still
      // the third of its four quarters
      expect(heads.length).toEqual(5)
      expect(middle).toBeCloseTo(heads[2], 0)
    })

    it("centres a whole measure rest in its bar, not in the empty columns after the card", function() {
      let song = parseMusicXML(barRestScore())
      let card = sectionCard(pieceSectionMeasures(GRAND, {
        startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS,
      }, song))
      // the staff is padded with empty columns once the card's are handed out
      // (MeasureCardGenerator), which are no part of the bar
      let unitColumns = cardColumns(card)
      let columns = [...unitColumns, [], [], [], [], [], []]
      renderStaff(GrandStaff, columns, {unitColumns, keySignature: new KeySignature(0)})

      let rest = staffEl("lower").querySelector(`.${staffStyles.rest}`)
      let heads = notesOn(staffEl("upper"))
        .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let middle = parseFloat(rest.style.left) + rest.getBoundingClientRect().width / 2

      expect(heads.length).toEqual(4)
      expect(middle).toBeCloseTo(heads[2], 0)
    })

    // a 6/8 grand staff bar, the meter of the Rêverie: the right hand plays an
    // eighth, a dotted quarter rest and two eighths, the left hand rests the
    // bar out, then a bar both hands hold
    let compoundRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>6</beats><beat-type>8</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><rest/><duration>3</duration><dot/><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><rest measure="yes"/><duration>6</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>6</duration><dot/><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><dot/><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("draws a whole measure rest as the whole rest whatever the bar's length", function() {
      let song = parseMusicXML(compoundRestScore())
      let columns = sectionColumns(song, 1, 2)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let lower = staffEl("lower")
      let rest = lower.querySelector(`.${staffStyles.rest}`)
      let box = rest.getBoundingClientRect()
      let line = n => lower.querySelector(`.${staffStyles[`line${n}`]}`).getBoundingClientRect()

      // a 6/8 bar is three quarter beats, which spells a dotted half, but a
      // whole measure rest is the whole rest hanging under the second line
      expect(rest.dataset.restType).toEqual("whole")
      expect(Math.abs(box.top - line(2).top)).toBeLessThanOrEqual(line(2).height)
      expect(box.bottom).toBeGreaterThan(line(2).bottom)

      // and it fills its bar, so it carries no dot of its own
      expect(lower.querySelectorAll(`.${staffStyles.rest_dot}`).length).toEqual(0)
    })

    it("draws the dots of a dotted rest after it", function() {
      let song = parseMusicXML(compoundRestScore())
      let columns = sectionColumns(song, 1, 2)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let upper = staffEl("upper")
      let rests = [...upper.querySelectorAll(`.${staffStyles.rest}`)]
      let dots = [...upper.querySelectorAll(`.${staffStyles.rest_dot}`)]

      expect(rests.map(rest => rest.dataset.restType)).toEqual(["quarter"])
      expect(dots.length).toEqual(1)

      let rest = rests[0].getBoundingClientRect()
      let dot = dots[0].getBoundingClientRect()
      expect(dot.width).toBeGreaterThan(0)
      expect(dot.left).toBeGreaterThanOrEqual(rest.right)

      // and in the space above the line the rest is drawn against, never on it
      let middle = upper.querySelector(`.${staffStyles.line3}`).getBoundingClientRect()
      expect(dot.bottom).toBeLessThanOrEqual(middle.top)
    })

    // a treble staff bar opening on a quarter rest in the hand that plays it,
    // then three quarters, and a bar of a whole note
    let leadingRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      ${["C", "D", "E"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("draws the rest a bar opens with clear of the first head", function() {
      let song = parseMusicXML(leadingRestScore())
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let rest = staff.querySelector(`.${staffStyles.rest}`)
      let first = notesOn(staff)
        .map(note => note.querySelector(`.${staffStyles.primary}`).getBoundingClientRect())
        .sort((a, b) => a.left - b.left)[0]

      expect(rest.dataset.restType).toEqual("quarter")
      expect(rest.getBoundingClientRect().width).toBeGreaterThan(0)
      expect(rest.getBoundingClientRect().right).toBeLessThanOrEqual(first.left)
    })

    // a treble staff of two eighths tied above the middle line, beamed, so the
    // score writes the beam's stem up where the staff draws the heads stem down
    let tiedBeamScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><type>eighth</type><stem>up</stem><beam number="1">begin</beam><staff>1</staff><notations><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><type>eighth</type><stem>up</stem><beam number="1">end</beam><staff>1</staff><notations><tied type="stop"/></notations></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><type>half</type><dot/><stem>up</stem><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("bows a tie away from the stem the staff draws, not the one the score writes", function() {
      let song = parseMusicXML(tiedBeamScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)

      // a head above the middle line is drawn stem down, whatever direction
      // the score's beam runs in, so its tie bows over the head
      expect(stemOf(staff, G5).dataset.stem).toEqual("down")
      expect([...staff.querySelectorAll(`.${staffStyles.tie}`)].map(tie => tie.dataset.tie))
        .toEqual(["up"])
    })

    // a treble staff whose chord holds one of its notes across the beat: C5
    // and E5 are struck together, the C5 is tied over, and a G4 is struck
    // under the held C5 on the next beat
    let tiedChordScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="start"/></notations></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/></notations></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    // a treble bar whose chord holds a C5 across the beat while the other
    // voice strikes that same C5 under it
    let tiedDoubledScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="start"/></notations></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/></notations></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><rest/><duration>2</duration><voice>2</voice><type>half</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("keeps a tie's head out of the chord's stem when another voice doubles it", function() {
      let song = parseMusicXML(tiedDoubledScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)

      // the C5 held across the beat is drawn beside the C5 the other voice
      // strikes there, so it is not one of the chord that is played
      let doubled = notesOn(staff).filter(note => parseFloat(note.style.marginLeft) > 0)
      expect(doubled.length).toEqual(1)
      expect(+doubled[0].dataset.midiNote).toEqual(C5)

      // the chord's stem runs from the note struck with it, and the head
      // drawn beside them keeps a stem of its own
      expect(stemOf(staff, E5)).toBeTruthy()
      expect(doubled[0].querySelector(`.${staffStyles.stem}`)).toBeTruthy()
    })

    it("draws one stem for a chord whose note is held over from the onset before", function() {
      let song = parseMusicXML(tiedChordScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)

      let byLeft = new Map()
      for (let note of notesOn(staff)) {
        let left = parseFloat(note.style.left)
        if (!byLeft.has(left)) { byLeft.set(left, []) }
        byLeft.get(left).push(note)
      }

      // the bar's three onsets: the chord, the chord under the held C5, and
      // the half note, each drawn with one stem of its own
      let onsets = [...byLeft.entries()].sort(([a], [b]) => a - b).map(([, heads]) => heads)
      expect(onsets.map(heads => heads.length)).toEqual([2, 2, 1])
      expect([...staff.querySelectorAll(`.${staffStyles.stem}`)].length).toEqual(3)

      // the held C5 is one of the second chord, not a note of its own: the
      // pair turns one stem up, rather than each drawing its own either way
      let [, held] = onsets
      expect(held.map(note => +note.dataset.midiNote).sort((a, b) => a - b)).toEqual([G4, C5])

      let stems = held.map(note => note.querySelector(`.${staffStyles.stem}`)).filter(stem => stem)
      expect(stems.map(stem => stem.dataset.stem)).toEqual(["up"])
    })

    it("draws the bar line before the rest its bar opens with", function() {
      let song = parseMusicXML(leadingRestScore())
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let rest = staff.querySelector(`.${staffStyles.rest}`)
      let barLine = staff.querySelector(`.${staffStyles.bar_line}[data-measure="1"]`)
      let heads = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)

      // the rest belongs to the bar the line opens, so the line is drawn in
      // front of it rather than through it
      expect(parseFloat(barLine.style.left)).toBeLessThan(parseFloat(rest.style.left))
      expect(parseFloat(rest.style.left)).toBeLessThan(heads[0])
    })

    // a two staff bar the left hand rests out whole while the right hand plays
    // inside the bass staff's own range
    let lowStaffRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${["C", "D", "E", "D"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>16</duration></backup>
      <note><rest measure="yes"/><duration>16</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("draws no rest on a lone staff that reads both staves of the score", function() {
      let song = parseMusicXML(lowStaffRestScore())

      // both hands are drilled, so the notes of this bar are the right hand's
      // and its whole measure rest the left hand's: on one staff, which draws
      // either hand's notes, no rest can say which hand it belongs to
      for (let [type, staff] of [
        [GStaff, {name: "treble", range: ["C4", "C6"]}],
        [FStaff, {name: "bass", range: ["C2", "E4"]}],
      ]) {
        let columns = sectionColumns(song, 1, 1, BOTH_HANDS, staff)
        renderStaff(type, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

        let el = container.querySelector(`.${staffStyles.staff}`)
        expect(notesOn(el).length).toEqual(4)
        expect(el.querySelectorAll(`.${staffStyles.rest}`).length).toEqual(0)
      }
    })

    // a two staff bar whose left hand opens on a quarter rest and plays notes a
    // treble staff can show
    let lowHandRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      ${["C", "D", "C"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>`).join("")}
    </measure>
  </part>
</score-partwise>`

    it("draws the drilled hand's rests on a staff that isn't the score's", function() {
      let song = parseMusicXML(lowHandRestScore())
      // the left hand alone, read on a treble staff: its own rest is the only
      // one the drill carries, so it is the one to draw
      let columns = sectionColumns(song, 1, 1, LEFT_HAND, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let rests = [...staff.querySelectorAll(`.${staffStyles.rest}`)]

      expect(notesOn(staff).length).toEqual(3)
      expect(rests.map(rest => rest.dataset.restType)).toEqual(["quarter"])
    })

    // a treble bar of a dotted quarter on a line (D5), a dotted quarter in a
    // space (C5) and a quarter to fill it
    let dottedScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>6</duration><dot/><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>6</duration><dot/><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("draws an augmentation dot clear of the staff line its head sits on", function() {
      let song = parseMusicXML(dottedScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      // how far above its own head's middle a note's dot is drawn
      let dotRise = pitch => {
        let el = head(staff, pitch)
        let dot = el.querySelector(`.${staffStyles.aug_dot}`).getBoundingClientRect()
        let glyph = el.querySelector(`.${staffStyles.primary}`).getBoundingClientRect()
        return (glyph.top + glyph.bottom) / 2 - (dot.top + dot.bottom) / 2
      }

      // D5 is on the fourth line, so its dot goes in the space above it; C5
      // is already in a space and keeps its dot beside the head
      expect(dotRise(D5)).toBeCloseTo(STAFF_ROW, 0)
      expect(dotRise(C5)).toBeCloseTo(0, 0)
    })

    // a treble bar whose last onset is above the staff's range, with the
    // bar's closing rest drawn after it
    let highLastNoteScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("keeps the rest of a last column the staff's range drops whole", function() {
      let song = parseMusicXML(highLastNoteScore())
      // the E6 the bar ends on is above the staff, so its column goes whole
      // and takes the bar's closing rest with it unless that rest is kept
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let heads = notesOn(staff).map(note => parseFloat(note.style.left))
      let rests = [...staff.querySelectorAll(`.${staffStyles.rest}`)]

      expect(heads.length).toEqual(2)
      expect(rests.map(rest => rest.dataset.restType)).toEqual(["quarter"])
      // the rest falls after the last head the staff can show
      expect(parseFloat(rests[0].style.left)).toBeGreaterThan(Math.max(...heads))
    })

    // two bars whose second opens on a quarter rest in both hands, so nothing
    // is struck on its down beat
    let bothHandsRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      ${["G", "A", "G"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>4</duration></backup>
      <note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><dot/><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("keeps no room for rests a lone staff reading both staves never draws", function() {
      let song = parseMusicXML(bothHandsRestScore())
      // both hands on one treble staff: no rest on it could say which hand it
      // belongs to, so none is drawn and none is spaced for either
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let lefts = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let barLine = n =>
        parseFloat(staff.querySelector(`.${staffStyles.bar_line}[data-measure="${n}"]`).style.left)

      expect(staff.querySelectorAll(`.${staffStyles.rest}`).length).toEqual(0)
      // the card opens on its first head rather than on room kept for a rest
      expect(lefts[0]).toEqual(0)

      // and bar 2's line stays on the head that opens it, the room the card's
      // own first bar line keeps in front of the first head of all
      let opens = lefts.find(left => left > barLine(2))
      expect(opens - barLine(2)).toBeCloseTo(lefts[0] - barLine(1), 0)
    })

    // a treble bar whose two voices strike the same C5 at once, which the
    // score writes twice though only one of them is played
    let sharedPitchScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>2</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>half</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`

    it("stems a chord from the note it is struck on, not the head another voice doubles", function() {
      let song = parseMusicXML(sharedPitchScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)

      // the C5 the lower voice shares with the upper one is drawn beside the
      // played chord, so it is never the head that chord's stem runs from
      let doubled = notesOn(staff).filter(note => parseFloat(note.style.marginLeft) > 0)
      expect(doubled.length).toEqual(1)

      expect(stemOf(staff, G4)).toBeTruthy()
      expect(stemOf(staff, G4).dataset.stem).toEqual("down")
    })

    // a treble staff whose first tie joins eighths and whose second joins whole
    // notes, so the two arcs are anchored on heads of different widths
    let mixedTieScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest/><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><rest/><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><type>eighth</type><staff>1</staff><notations><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><type>eighth</type><staff>1</staff><notations><tied type="stop"/></notations></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><tie type="start"/><voice>1</voice><type>whole</type><staff>1</staff><notations><tied type="start"/></notations></note>
    </measure>
    <measure number="3">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><tie type="stop"/><voice>1</voice><type>whole</type><staff>1</staff><notations><tied type="stop"/></notations></note>
    </measure>
  </part>
</score-partwise>`

    it("anchors each tie on the head it leaves, whatever that head's value", function() {
      let song = parseMusicXML(mixedTieScore())
      let columns = sectionColumns(song, 1, 3, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let ties = [...staff.querySelectorAll(`.${staffStyles.tie}`)]
      let startOf = tie => parseFloat(tie.getAttribute("d").match(/^M([-\d.]+)/)[1])
      let width = type => headGlyph(type, NOTE_HEAD_HEIGHT).width

      expect(ties.length).toEqual(2)
      // a whole note's head is wider than an eighth's, and each arc leaves the
      // right hand end of its own head rather than of the first one drawn
      expect(width("whole")).toBeGreaterThan(width("eighth"))

      for (let [tie, pitch, type] of [[ties[0], G4, "eighth"], [ties[1], C5, "whole"]]) {
        let left = parseFloat(head(staff, pitch).style.left)
        expect(startOf(tie)).toBeGreaterThan(left + 0.7 * width(type))
        expect(startOf(tie)).toBeLessThanOrEqual(left + width(type))
      }
    })

    // two 4/4 bars, the second opening on a quarter rest, so the bar whose rest
    // comes before its first head starts inside the card
    let nextBarRestScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
    </measure>
    <measure number="2">
      <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      ${["G", "A", "G"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
    </measure>
  </part>
</score-partwise>`

    it("draws a bar line between the head before it and the rest its bar opens on", function() {
      let song = parseMusicXML(nextBarRestScore())
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})

      // the column widths the staff fits a card of an imported piece to, where
      // the previous bar's last head reaches past the rest that opens the next
      for (let noteWidth of [47, 41]) {
        renderStaff(GStaff, columns,
          {unitColumns: columns, keySignature: new KeySignature(0), noteWidth})

        let staff = container.querySelector(`.${staffStyles.staff}`)
        let rest = staff.querySelector(`.${staffStyles.rest}`).getBoundingClientRect()
        let barLine = staff
          .querySelector(`.${staffStyles.bar_line}[data-measure="2"]`).getBoundingClientRect()
        let before = notesOn(staff)
          .map(note => note.querySelector(`.${staffStyles.primary}`).getBoundingClientRect())
          .filter(head => head.right <= rest.left)
          .sort((a, b) => a.right - b.right)
          .pop()

        expect(before).toBeTruthy()
        // the line opens the bar the rest belongs to, so it is drawn clear of
        // the last head of the bar before it and clear of the rest itself
        expect(barLine.left).toBeGreaterThanOrEqual(before.right)
        expect(barLine.right).toBeLessThanOrEqual(rest.left)
      }
    })

    it("keeps a bar's opening rest clear of its head once the window reaches it", function() {
      let song = parseMusicXML(nextBarRestScore())
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      // the window the staff draws once the first bar has been played, its card
      // still fixing the layout (see unitColumns)
      renderStaff(GStaff, columns.slice(4), {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let rest = staff.querySelector(`.${staffStyles.rest}`)
      let heads = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let barLine = staff.querySelector(`.${staffStyles.bar_line}[data-measure="2"]`)

      expect(rest.dataset.restType).toEqual("quarter")
      expect(heads.length).toEqual(3)
      // the rest opens the bar at the head of the window, so it keeps the room
      // before that head, with its own bar line drawn in front of it
      expect(parseFloat(rest.style.left)).toBeLessThan(heads[0])
      expect(parseFloat(barLine.style.left)).toBeLessThan(parseFloat(rest.style.left))
    })

    it("draws a note held down on the head column of a bar that opens with a rest", function() {
      let song = parseMusicXML(leadingRestScore())
      let columns = sectionColumns(song, 1, 2, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {
        unitColumns: columns,
        keySignature: new KeySignature(0),
        heldNotes: {[noteName(A4)]: true},
      })

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let held = [...staff.querySelectorAll(`.${staffStyles.held}`)]
      let heads = notesOn(staff)
        .filter(note => !note.classList.contains(staffStyles.held))
        .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)

      expect(held.length).toEqual(1)
      // the head column is drawn after the room the opening rest holds, and a
      // wrong note held down is drawn on that column, not left of it
      expect(heads[0]).toBeGreaterThan(0)
      expect(parseFloat(held[0].style.left)).toEqual(heads[0])
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

  describe("beams, slurs and tuplets", function() {
    let beamsOn = el => [...el.querySelectorAll(`.${staffStyles.beam}`)]
    let slursOn = el => [...el.querySelectorAll(`.${staffStyles.slur}`)]
    let flagsOn = el => [...el.querySelectorAll(`.${staffStyles.flag}`)]
    let stemsOn = el => [...el.querySelectorAll(`.${staffStyles.stem}`)]
    let numbersOn = el => [...el.querySelectorAll(`.${staffStyles.tuplet_number}`)]
    let bracketsOn = el => [...el.querySelectorAll(`.${staffStyles.tuplet_bracket}`)]

    // the points of an svg path, in the pixels of the staff's notes
    let pathPoints = path => (path.getAttribute("d").match(/-?[\d.]+ -?[\d.]+/g) || [])
      .map(pair => pair.split(" ").map(Number))

    // the edge of a beam the stems of its group end on, as [[x1, y1], [x2, y2]]
    let beamEdge = path => pathPoints(path).slice(0, 2)

    // where a stem's far end falls, in the pixels of the staff's notes
    let stemEnd = (el, stem) => {
      let notes = el.querySelector(`.${staffStyles.staff_notes}`).getBoundingClientRect()
      let box = stem.getBoundingClientRect()
      return {
        x: (box.left + box.right) / 2 - notes.left,
        y: (stem.dataset.stem == "up" ? box.top : box.bottom) - notes.top,
      }
    }

    // where an arc bulges to, the middle of its quadratic curve
    let arcApex = path => {
      let [[, y1], [, cy], [, y2]] = pathPoints(path)
      return (y1 + 2 * cy + y2) / 4
    }

    // the vertical middle of every note head, in the pixels of the staff's notes
    let headMiddles = el => {
      let notes = el.querySelector(`.${staffStyles.staff_notes}`).getBoundingClientRect()
      return notesOn(el).map(note => {
        let box = note.getBoundingClientRect()
        return (box.top + box.bottom) / 2 - notes.top
      })
    }

    // the Rêverie's opening bars on the grand staff, its left hand ostinato
    // drawn on the lower staff
    let reverieColumns = (start, end) =>
      sectionColumns(parseMusicXML(reverieOpening()), start, end)

    let renderReverie = (start, end, {window=null}={}) => {
      let columns = reverieColumns(start, end)
      renderStaff(GrandStaff, window ? columns.slice(window) : columns,
        {unitColumns: columns, keySignature: new KeySignature(-1)})
      return columns
    }

    it("beams the group the score writes instead of drawing a flag on each head", function() {
      renderReverie(2, 2)
      let lower = staffEl("lower")

      // the bar's eighths are written as two beamed groups of four
      expect(beamsOn(lower).length).toEqual(2)
      expect(flagsOn(lower).length).toEqual(0)
      expect(beamsOn(lower).map(beam => beam.dataset.beam)).toEqual(["1", "1"])

      // and every stem of the groups turns the same way
      expect(eighthStems(lower)).toEqual(new Set(["up"]))
    })

    it("runs every stem of a beamed group to its beam, over a bounded slope", function() {
      renderReverie(2, 2)
      let lower = staffEl("lower")
      let ends = stemsOn(lower).map(stem => stemEnd(lower, stem))

      for (let beam of beamsOn(lower)) {
        let [[x1, y1], [x2, y2]] = beamEdge(beam)
        let onBeam = ends.filter(end => end.x >= x1 - 1 && end.x <= x2 + 1)

        // the beam joins four stems, each of which ends on it
        expect(onBeam.length).toEqual(4)
        for (let end of onBeam) {
          expect(end.y).toBeCloseTo(y1 + (end.x - x1) * (y2 - y1) / (x2 - x1), 0)
        }

        // an engraver keeps a beam near level, and level over a level group
        expect(Math.abs(y2 - y1)).toBeLessThanOrEqual(MAX_BEAM_RISE * STAFF_ROW + 0.5)
      }

      // the ostinato climbs to its G4 and falls back, and each beam follows
      // its own group up or down
      let [up, down] = beamsOn(lower).map(beam => {
        let [[, y1], [, y2]] = beamEdge(beam)
        return y2 - y1
      })
      expect(up).toBeLessThan(0)
      expect(down).toBeGreaterThan(0)
    })

    // a 4/4 treble bar of four eighths on one pitch, then a half note
    let levelBeamScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${["begin", "continue", "continue", "end"].map(beam =>
        `<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><beam number="1">${beam}</beam></note>`).join("")}
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`

    it("draws a level beam over a level group", function() {
      let song = parseMusicXML(levelBeamScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let [beam, ...rest] = beamsOn(staff)
      let [[, y1], [, y2]] = beamEdge(beam)

      expect(rest.length).toEqual(0)
      expect(y2).toBeCloseTo(y1, 3)
    })

    it("draws the score's slur from its first head to its last, clear of the heads between", function() {
      renderReverie(2, 2)
      let lower = staffEl("lower")
      let [slur, ...rest] = slursOn(lower)

      expect(rest.length).toEqual(0)

      // the ostinato stems up, so its slur bulges below the heads
      expect(slur.dataset.tie).toEqual("down")

      let [[x1], , [x2]] = pathPoints(slur)
      let heads = notesOn(lower).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)

      // it runs from the bar's first eighth to its last, which are the first
      // and last heads the lower staff draws
      expect(x1).toBeGreaterThan(heads[0] - 1)
      expect(x2).toBeGreaterThan(heads[heads.length - 2])

      // and arches clear of every head it spans
      expect(arcApex(slur)).toBeGreaterThan(Math.max(...headMiddles(lower)))
    })

    it("carries a beam group and a slur cut by the card's edge off it", function() {
      // the window the staff draws once the card's first two columns are
      // played, which cuts the opening beam group and the slur over it
      renderReverie(2, 3, {window: 2})
      let lower = staffEl("lower")

      let [beam] = beamsOn(lower)
      let [[x1, y1], [x2, y2]] = beamEdge(beam)
      let ends = stemsOn(lower).map(stem => stemEnd(lower, stem))
      let first = ends.reduce((low, end) => end.x < low.x ? end : low)

      // the beam runs off the card's edge, past the first stem it still joins
      expect(x1).toBeLessThan(first.x - 1)
      expect(first.y).toBeCloseTo(y1 + (first.x - x1) * (y2 - y1) / (x2 - x1), 0)

      // and the slur the cut group opened runs in from the card's edge to the
      // head it stops on, where the bar after it draws its own slur whole
      let [cut, whole] = slursOn(lower).map(slur => {
        let [[x1], , [x2]] = pathPoints(slur)
        return {x1, x2}
      })

      expect(cut.x1).toBeGreaterThanOrEqual(0)
      expect(cut.x2).toBeLessThan(whole.x1)
      expect(cut.x2 - cut.x1).toBeLessThan((whole.x2 - whole.x1) / 2)
    })

    it("numbers a tuplet, bracketing it only when its beam doesn't mark it out", function() {
      let song = parseMusicXML(tripletScore())
      let treble = {name: "treble", range: ["C4", "C6"]}

      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, treble)
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      let staff = container.querySelector(`.${staffStyles.staff}`)

      // a triplet of quarter notes carries no beam, so its number is bracketed
      expect(numbersOn(staff).map(number => number.dataset.tuplet)).toEqual(["3"])
      expect(bracketsOn(staff).length).toEqual(2)

      let [number] = numbersOn(staff)
      let heads = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let middle = +number.getAttribute("x")
      expect(middle).toBeGreaterThan(heads[0])
      expect(middle).toBeLessThan(heads[3])

      columns = sectionColumns(song, 2, 2, BOTH_HANDS, treble)
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      staff = container.querySelector(`.${staffStyles.staff}`)

      // a triplet of beamed eighths is marked out by its own beam, so the
      // number is drawn over it alone
      expect(numbersOn(staff).map(number => number.dataset.tuplet)).toEqual(["3"])
      expect(bracketsOn(staff).length).toEqual(0)
      expect(beamsOn(staff).length).toEqual(1)
    })

    // a 4/4 treble bar holding a quarter note triplet and, after it, a beamed
    // run of three eighths: two runs of three stem groups that mark out
    // different notes of the bar
    let tripletAndRunScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${[["E", "start"], ["C", null], ["E", "stop"]].map(([step, tuplet]) =>
        `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>${tuplet ? `<notations><tuplet type="${tuplet}"${tuplet == "start" ? ' bracket="yes"' : ""}/></notations>` : ""}</note>`).join("")}
      ${[["D", "begin"], ["E", "continue"], ["F", "end"]].map(([step, beam]) =>
        `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>eighth</type><beam number="1">${beam}</beam></note>`).join("")}
      <note><rest/><duration>3</duration><voice>1</voice><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>`

    it("brackets a tuplet a beam run of the same length elsewhere in the bar doesn't mark out", function() {
      let song = parseMusicXML(tripletAndRunScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)

      // the eighths are the bar's one beam group, and it marks out no tuplet
      expect(beamsOn(staff).length).toEqual(1)

      // so the quarter note triplet, which carries no beam of its own, keeps
      // its bracket however many groups that run happens to hold
      expect(numbersOn(staff).map(number => number.dataset.tuplet)).toEqual(["3"])
      expect(bracketsOn(staff).length).toEqual(2)

      // and the bracket sits over the triplet, left of the beamed run
      let heads = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      let [number] = numbersOn(staff)
      expect(+number.getAttribute("x")).toBeLessThan(heads[3])
    })

    // three 4/4 treble bars under one slur, written from the first head of
    // bar 1 to the last of bar 3, so nothing in bar 2 marks it
    let longSlurScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[["C", "D", "E", "F"], ["G", "F", "E", "D"], ["C", "D", "E", "F"]].map((steps, idx) => `
    <measure number="${idx + 1}">
      ${idx == 0 ? "<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>" : ""}
      ${steps.map((step, at) => {
        let slur = idx == 0 && at == 0 ? "start" : (idx == 2 && at == 3 ? "stop" : null)
        return `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${slur ? `<notations><slur number="1" type="${slur}"/></notations>` : ""}</note>`
      }).join("")}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("draws a slur passing over a card that holds neither of its ends", function() {
      let song = parseMusicXML(longSlurScore())
      let treble = {name: "treble", range: ["C4", "C6"]}
      let render = measure => {
        let columns = sectionColumns(song, measure, measure, BOTH_HANDS, treble)
        renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
        return container.querySelector(`.${staffStyles.staff}`)
      }

      // the card the slur starts on draws a stub running off its right edge
      let first = render(1)
      expect(slursOn(first).length).toEqual(1)

      // the middle card holds neither end of the slur, so the arc passes
      // right over it rather than disappearing while the phrase is played
      let middle = render(2)
      let [slur, ...rest] = slursOn(middle)
      expect(rest.length).toEqual(0)

      // the bar's heads all sit above the middle line and stem down, so the
      // arc bulges over them
      expect(slur.dataset.tie).toEqual("up")
      expect(arcApex(slur)).toBeLessThan(Math.min(...headMiddles(middle)))

      // and it runs off both edges, past every head on the staff
      let [[x1], , [x2]] = pathPoints(slur)
      let heads = notesOn(middle).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      expect(x1).toBeLessThanOrEqual(heads[0])
      expect(x2).toBeGreaterThan(heads[heads.length - 1])

      // the card the slur stops on draws its own stub, running in from the left
      let last = render(3)
      expect(slursOn(last).length).toEqual(1)
    })

    // a 4/4 treble bar of two quarter note triplets written the way several
    // exporters do: a <time-modification> on every note and no <tuplet> spans
    let unmarkedTripletsScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${["C", "E", "G", "F", "D", "B"].map(step =>
        `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`).join("")}
    </measure>
  </part>
</score-partwise>`

    it("splits a run of tuplets the score marks out with no spans at the notes it writes them with", function() {
      let song = parseMusicXML(unmarkedTripletsScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let heads = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      expect(heads.length).toEqual(6)

      // two triplets, each numbered and bracketed over its own three heads
      let numbers = numbersOn(staff)
      expect(numbers.map(number => number.dataset.tuplet)).toEqual(["3", "3"])

      let middles = numbers.map(number => +number.getAttribute("x")).sort((a, b) => a - b)
      expect(middles[0]).toBeGreaterThan(heads[0])
      expect(middles[0]).toBeLessThan(heads[2])
      expect(middles[1]).toBeGreaterThan(heads[3])
      expect(middles[1]).toBeLessThan(heads[5])
    })

    // a 4/4 treble bar whose quarter note triplet writes its middle member as
    // two beamed eighths, with the <tuplet> spans the score marks it out by
    let markedTripletScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><tuplet type="start" bracket="yes"/></notations></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">begin</beam></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">end</beam></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><tuplet type="stop"/></notations></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`

    it("keeps a tuplet the score marks out whole however many heads it is written over", function() {
      let song = parseMusicXML(markedTripletScore())
      let columns = sectionColumns(song, 1, 1, BOTH_HANDS, {name: "treble", range: ["C4", "C6"]})
      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})

      let staff = container.querySelector(`.${staffStyles.staff}`)
      let heads = notesOn(staff).map(note => parseFloat(note.style.left)).sort((a, b) => a - b)
      expect(heads.length).toEqual(5)

      // the score's start and stop spans mark out one triplet of four heads,
      // so one number is drawn over it and none over its tail
      let numbers = numbersOn(staff)
      expect(numbers.map(number => number.dataset.tuplet)).toEqual(["3"])
      expect(bracketsOn(staff).length).toEqual(2)

      let middle = +numbers[0].getAttribute("x")
      expect(middle).toBeGreaterThan(heads[0])
      expect(middle).toBeLessThan(heads[3])
      expect(middle).toBeGreaterThan(heads[1])
    })

    it("draws a bar both hands rest out without giving the drill a column", function() {
      let song = parseMusicXML(restBarScore())
      let measures = pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 3, hand: BOTH_HANDS}, song)
      let card = sectionCard(measures)

      // the resting bar hands the player nothing to answer
      expect(measures.map(measure => measure.columns.length)).toEqual([1, 0, 1])
      expect(card.columns.length).toEqual(2)

      let columns = cardColumns(card)
      expect(columns.map(column => column.measure)).toEqual([1, 3])
      expect(columns[1].bars).toEqual([{number: 2, beat: 4, beats: 4}])

      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      let lower = staffEl("lower")

      // its bar line and number are drawn where the score puts them
      let lines = [...lower.querySelectorAll(`.${staffStyles.bar_line}`)]
      expect(lines.map(line => line.dataset.measure)).toEqual(["1", "2", "3"])

      let at = n => parseFloat(lines.find(line => line.dataset.measure == `${n}`).style.left)
      expect(at(1)).toBeLessThan(at(2))
      expect(at(2)).toBeLessThan(at(3))

      // with its whole measure rest centred between them
      let rest = lower.querySelector(`.${staffStyles.rest}`)
      expect(rest.dataset.restType).toEqual("whole")
      let middle = parseFloat(rest.style.left) + rest.getBoundingClientRect().width / 2
      expect(middle).toBeCloseTo((at(2) + at(3)) / 2, 0)

      // and the numbers are written on the upper staff of a grand staff
      expect([...staffEl("upper").querySelectorAll(`.${staffStyles.bar_line}[data-label]`)]
        .map(line => line.dataset.label)).toEqual(["1", "2", "3"])
    })

    // a 4/4 grand staff score of three bars whose last one every hand rests
    // through, so the card ends on a bar that hands the drill no column
    let endRestBarScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[1, 2, 3].map(number => `
    <measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${number == 3 ?
        `<note><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note>` :
        `<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>`}
      <backup><duration>4</duration></backup>
      ${number == 3 ?
        `<note><rest measure="yes"/><duration>4</duration><voice>2</voice><staff>2</staff></note>` :
        `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("keeps the bar a card ends resting through inside the room the card spans", function() {
      let song = parseMusicXML(endRestBarScore())
      let measures = pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 3, hand: BOTH_HANDS}, song)
      let card = sectionCard(measures)
      let columns = cardColumns(card)

      // the rested bar is drawn after the card's last column, carrying the
      // beats it covers
      expect(columns.length).toEqual(2)
      expect(columns[1].bars).toEqual([{number: 3, beat: 8, beats: 4}])

      let key = new KeySignature(0)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: key})
      let lower = staffEl("lower")

      let lines = [...lower.querySelectorAll(`.${staffStyles.bar_line}`)]
      expect(lines.map(line => line.dataset.measure)).toEqual(["1", "2", "3"])

      let at = n => parseFloat(lines.find(line => line.dataset.measure == `${n}`).style.left)
      expect(at(2)).toBeLessThan(at(3))

      // its line is drawn past the card's last head, in room of its own,
      // rather than through the note that head draws
      let [head] = headBoxes(lower).sort((a, b) => b.right - a.right)
      expect(at(3)).toBeGreaterThan(head.right)

      // and both its line and its whole measure rest fall inside the room the
      // page fits the plate to, rather than off the end of it
      let limit = keySignatureWidth(key) + columnSpan(columns, columns, {rests: true}) * 60
      let rest = lower.querySelector(`.${staffStyles.rest}`)
      expect(rest.dataset.restType).toEqual("whole")

      expect(parseFloat(rest.style.left)).toBeGreaterThan(head.right)
      expect(at(3)).toBeLessThanOrEqual(limit)
      expect(parseFloat(rest.style.left) + rest.getBoundingClientRect().width)
        .toBeLessThanOrEqual(limit)
    })

    // three 4/4 bars whose middle one every hand rests through, written as two
    // half rests rather than one whole measure rest
    let halfRestBarScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${[1, 2, 3].map(number => `
    <measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ""}
      ${number == 2 ?
        [0, 1].map(() => `<note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>`).join("") :
        ["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("")}
      <backup><duration>4</duration></backup>
      ${number == 2 ?
        [0, 1].map(() => `<note><rest/><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>`).join("") :
        `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>`}
    </measure>`).join("")}
  </part>
</score-partwise>`

    it("opens the bar after a rested one at its boundary, not at the rests before it", function() {
      let song = parseMusicXML(halfRestBarScore())
      let measures = pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 3, hand: BOTH_HANDS}, song)
      let columns = cardColumns(sectionCard(measures))

      expect(measures.map(measure => measure.columns.length)).toEqual([4, 0, 4])
      expect(columns[4].bars).toEqual([{number: 2, beat: 4, beats: 4}])

      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      let lower = staffEl("lower")

      // the rested bar draws both of its half rests
      let rests = [...lower.querySelectorAll(`.${staffStyles.rest}`)]
      expect(rests.map(rest => rest.dataset.restType)).toEqual(["half", "half"])

      let lines = [...lower.querySelectorAll(`.${staffStyles.bar_line}`)]
      let at = n => parseFloat(lines.find(line => line.dataset.measure == `${n}`).style.left)
      let heads = notesOn(staffEl("upper"))
        .map(note => parseFloat(note.style.left)).sort((a, b) => a - b)

      // measure 3 opens on its own first beat, so its line is drawn after
      // every rest of the bar before it and in front of its own first head
      expect(at(3)).toBeGreaterThan(Math.max(...rests.map(rest => parseFloat(rest.style.left))))
      expect(at(3)).toBeLessThan(heads[4])
      expect(at(2)).toBeLessThan(at(3))

      // and the rested bar's own line is drawn past the head before it, in the
      // room kept for that bar, rather than through the note
      let before = headBoxes(staffEl("upper"))
        .filter(box => box.left < at(2))
        .sort((a, b) => b.right - a.right)[0]
      expect(at(2)).toBeGreaterThan(before.right)
      expect(parseFloat(rests[0].style.left)).toBeGreaterThan(before.right)
    })

    it("draws no bar for a measure a piece stored without the score's rhythm puts out of range", function() {
      // a format 1 piece: notes with no notation at all, still read as stored
      let song = songFromJSON({
        format: 1,
        metadata: {
          beatsPerMeasure: 4,
          measureStarts: [0, 4, 8],
          measureNumbers: [1, 2, 3],
          measuresEnd: 12,
        },
        tracks: [
          {notes: ["C5", 0, 4, "E5", 8, 4]},
          {notes: ["C3", 4, 4]},
        ],
      })

      let treble = {name: "treble", range: ["C4", "C6"]}
      let measures = pieceSectionMeasures(treble, {startMeasure: 1, endMeasure: 3, hand: BOTH_HANDS}, song)

      // measure 2 holds a column the treble staff can't show, which is not a
      // bar every hand rests through: nothing of it is drawn
      expect(measures.map(measure => measure.columns.length)).toEqual([1, 0, 1])
      expect(measures.some(measure => measure.bar)).toBe(false)

      let columns = cardColumns(sectionCard(measures))
      expect(columns.every(column => !column.bars)).toBe(true)

      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      let staff = container.querySelector(`.${staffStyles.staff}`)

      expect([...staff.querySelectorAll(`.${staffStyles.bar_line}`)]
        .map(line => line.dataset.measure)).toEqual(["1", "3"])
    })

    it("draws no bar for a measure a piece stored without the score's rhythm holds nothing in", function() {
      // a format 1 piece whose measures 2 and 4 hold no note at all: it kept
      // no notation, so nothing of it places a bar line
      let song = songFromJSON({
        format: 1,
        metadata: {
          beatsPerMeasure: 4,
          measureStarts: [0, 4, 8, 12],
          measureNumbers: [1, 2, 3, 4],
          measuresEnd: 16,
        },
        tracks: [
          {notes: ["C5", 0, 4, "E5", 8, 4]},
          {notes: ["C4", 0, 4, "E4", 8, 4]},
        ],
      })

      let treble = {name: "treble", range: ["C4", "C6"]}
      let measures = pieceSectionMeasures(treble, {startMeasure: 1, endMeasure: 4, hand: BOTH_HANDS}, song)

      expect(measures.map(measure => measure.columns.length)).toEqual([1, 0, 1, 0])
      expect(measures.some(measure => measure.bar)).toBe(false)

      let columns = cardColumns(sectionCard(measures))
      expect(columns.every(column => !column.bars)).toBe(true)

      renderStaff(GStaff, columns, {unitColumns: columns, keySignature: new KeySignature(0)})
      let staff = container.querySelector(`.${staffStyles.staff}`)

      // only the bars the card plays are drawn, in reading order
      expect([...staff.querySelectorAll(`.${staffStyles.bar_line}`)]
        .map(line => line.dataset.measure)).toEqual(["1", "3"])
    })

    it("draws a piece stored before the spans were kept with a flag on every eighth", function() {
      let song = parseMusicXML(reverieOpening())

      // a piece stored as format 2, which kept no beams or slurs
      for (let track of song.tracks) {
        for (let note of track) {
          delete note.notation.beams
          delete note.notation.slurs
          for (let tie of note.notation.ties) {
            delete tie.beams
            delete tie.slurs
          }
        }
      }

      let columns = sectionColumns(song, 2, 2)
      renderStaff(GrandStaff, columns, {unitColumns: columns, keySignature: new KeySignature(-1)})
      let lower = staffEl("lower")

      expect(beamsOn(lower).length).toEqual(0)
      expect(slursOn(lower).length).toEqual(0)
      expect(flagsOn(lower).length).toEqual(8)
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
