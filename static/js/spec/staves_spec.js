import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {GStaff, FStaff, GrandStaff} from "st/components/staves"
import staffStyles from "st/components/staff.module.css"
import NoteList from "st/note_list"
import {KeySignature, noteName} from "st/music"
import {parseMusicXML} from "st/musicxml"
import {sectionCard, cardColumn} from "st/measure_cards"
import {pieceSectionMeasures, BOTH_HANDS} from "st/data"
import {reverieOpening} from "spec/helpers"

// MIDI pitches, so the specs don't depend on the octave numbering of names
const G3 = 55, Bb3 = 58, B3 = 59, C4 = 60, D4 = 62, E4 = 64, G4 = 67, C5 = 72, E5 = 76

const GRAND = {name: "grand", range: ["C2", "C6"]}

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

  it("draws a drill's columns as whole notes a column width apart", function() {
    renderStaff(GStaff, [[noteName(C5)], [noteName(E5)]], {keySignature: new KeySignature(0)})

    let staff = container.querySelector(`.${staffStyles.staff}`)
    expect(notesOn(staff).every(note => note.classList.contains(staffStyles.whole_note))).toBe(true)
    expect(notesOn(staff).map(note => parseFloat(note.style.left))).toEqual([0, 60])
  })

  it("draws an imported piece's columns as plain whole notes, whatever the score writes", function() {
    // Rêverie's opening: eighths, a tied half and two voices, which the app's
    // staff draws as it draws any drill
    let measures = pieceSectionMeasures(GRAND, {startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS},
      parseMusicXML(reverieOpening()))
    let card = sectionCard(measures)
    let columns = card.columns.map((column, idx) => cardColumn(card, idx))
    expect(columns.some(column => column.notation)).toBe(true)

    renderStaff(GrandStaff, columns, {keySignature: new KeySignature(0)})

    let notes = [...notesOn(staffEl("upper")), ...notesOn(staffEl("lower"))]
    expect(notes.length).toEqual(columns.reduce((sum, column) => sum + column.length, 0))
    expect(notes.every(note => note.classList.contains(staffStyles.whole_note))).toBe(true)

    // one column width a column, and each note on the staff its pitch falls nearest
    let lefts = new Set(notes.map(note => parseFloat(note.style.left)))
    expect([...lefts].sort((a, b) => a - b)).toEqual(columns.map((column, idx) => idx * 60))
    expect(notePitches(staffEl("upper")).every(pitch => pitch >= C4)).toBe(true)
    expect(notePitches(staffEl("lower")).every(pitch => pitch < C4)).toBe(true)
    expect(clefImage(staffEl("upper"))).toContain("clefs.G")
    expect(clefImage(staffEl("lower"))).toContain("clefs.F")
  })

  it("splits wrong held notes at middle C", function() {
    renderStaff(GrandStaff, [[noteName(E4)], [noteName(G3)]],
      {heldNotes: {[noteName(C4)]: true, [noteName(B3)]: true}})

    let held = el => notesOn(el).filter(note => note.classList.contains(staffStyles.held))
    expect(held(staffEl("upper")).map(note => +note.dataset.midiNote)).toEqual([C4])
    expect(held(staffEl("lower")).map(note => +note.dataset.midiNote)).toEqual([B3])
  })

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
