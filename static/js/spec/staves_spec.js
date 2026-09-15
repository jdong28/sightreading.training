import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {GStaff, FStaff, GrandStaff} from "st/components/staves"
import staffStyles from "st/components/staff.module.css"
import NoteList from "st/note_list"
import {KeySignature, noteName, parseNote} from "st/music"
import {parseMusicXML} from "st/musicxml"
import {extractSectionColumns, grandStaffClefs} from "st/song_sections"
import {sectionCard, cardColumn, measureCards} from "st/measure_cards"
import {SheetMusicGenerator} from "st/generators"
import {pieceSectionMeasures, BOTH_HANDS, RIGHT_HAND, LEFT_HAND} from "st/data"
import {reverieOpening, clefChangeScore} from "spec/helpers"

// MIDI pitches, so the specs don't depend on the octave numbering of names
const Bb3 = 58, C4 = 60, D4 = 62, G4 = 67, D5 = 74, G5 = 79

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
  let notesOn = el => [...el.querySelectorAll(`.${staffStyles.whole_note}`)]
  let notePitches = el => notesOn(el).map(note => +note.dataset.midiNote)
  let ledgerLines = el => el.querySelectorAll(`.${staffStyles.ledger_line}`).length

  describe("score staves of imported columns", function() {
    it("carries the track, grand staff and clef of each note of the Rêverie opening", function() {
      let song = parseMusicXML(reverieOpening())
      let columns = extractSectionColumns(song, {startMeasure: 2, endMeasure: 4, staves: true})

      expect(columns.length).toEqual(7 + 7 + 8)
      expect(pitches(columns[0])).toEqual([Bb3])
      expect(columns[0].staves).toEqual([{track: 1, staff: "lower", clef: "g"}])
      expect(columns.slice(0, 14).flatMap(column => column.staves.map(s => s.staff)))
        .toEqual(Array(14).fill("lower"))

      // measure 4 opens with the right hand's G5 on the upper staff
      expect(pitches(columns[14])).toEqual([G5])
      expect(columns[14].staves).toEqual([{track: 0, staff: "upper", clef: "g"}])
      expect(pitches(columns[18])).toEqual([D5])
      expect(columns[18].staves[0].staff).toEqual("upper")

      // both staves open in treble clef
      expect(grandStaffClefs(song, 0)).toEqual({upper: "g", lower: "g"})

      // other sections are still bare note names
      let plain = extractSectionColumns(song, {startMeasure: 2, endMeasure: 4})
      expect(plain.map(pitches)).toEqual(columns.map(pitches))
      expect(plain.some(column => column.staves)).toBe(false)
    })

    it("keeps the staves and card clefs through the sheet music generators", function() {
      let song = parseMusicXML(reverieOpening())
      let measures = pieceSectionMeasures(GRAND, {startMeasure: 2, endMeasure: 4, hand: BOTH_HANDS}, song)
      expect(measures.map(m => m.clefs)).toEqual(Array(3).fill({upper: "g", lower: "g"}))

      let [card] = measureCards(measures, 3)
      let generator = new SheetMusicGenerator(card.columns.map((column, idx) => cardColumn(card, idx)), {card})
      let first = generator.nextNote()
      expect(first.staves).toEqual([{track: 1, staff: "lower", clef: "g"}])
      expect(first.clefs).toEqual({upper: "g", lower: "g"})
      expect(first.measure).toEqual(2)

      // a staff range drops the note and its staff together
      let narrow = pieceSectionMeasures({name: "treble", range: [noteName(C4), noteName(G5)]},
        {startMeasure: 2, endMeasure: 2, hand: BOTH_HANDS}, song)
      expect(narrow[0].columns.every(column => column.length == column.staves.length)).toBe(true)
      expect(narrow[0].columns.map(pitches)[0]).toEqual([C4])
    })

    it("draws the Rêverie ostinato on the lower staff in treble clef", function() {
      let song = parseMusicXML(reverieOpening())
      renderStaff(GrandStaff, sectionColumns(song, 2, 3))

      let upper = staffEl("upper")
      let lower = staffEl("lower")

      expect(notesOn(upper).length).toEqual(0)
      expect(new Set(notePitches(lower))).toEqual(new Set([Bb3, C4, D4, G4]))
      expect(notesOn(lower).length).toEqual(14)

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

    it("draws a wrong held note on the staff of the nearest note to play", function() {
      let song = parseMusicXML(reverieOpening())
      renderStaff(GrandStaff, sectionColumns(song, 2, 2), {heldNotes: {[noteName(D4)]: true}})

      let held = el => notesOn(el).filter(note => note.classList.contains(staffStyles.held))
      expect(held(staffEl("upper")).length).toEqual(0)
      expect(held(staffEl("lower")).map(note => +note.dataset.midiNote)).toEqual([D4])
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
      expect(notesOn(single).find(note => +note.dataset.midiNote == Bb3).style.top).toEqual("137%")

      let right = sectionColumns(song, 2, 4, RIGHT_HAND)
      expect(right.map(pitches)).toEqual([[G5], [D5]])
      renderStaff(GrandStaff, right)
      expect(notePitches(staffEl("upper"))).toEqual([G5, D5])
      expect(notesOn(staffEl("lower")).length).toEqual(0)
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

      // a range crossing the change is drawn in the clef it opens with
      renderStaff(GrandStaff, sectionColumns(song, 2, 3))
      expect(clefImage(staffEl("lower"))).toContain("clefs.F")
      expect(notePitches(staffEl("lower"))).toEqual([C4 - 8, C4])

      // the notes record the clef in effect where they start
      let columns = extractSectionColumns(song, {startMeasure: 1, endMeasure: 4, track: [1], staves: true})
      expect(columns.map(column => column.staves[0].clef)).toEqual(["f", "f", "g", "g"])
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
