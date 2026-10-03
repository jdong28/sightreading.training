import NoteList from "st/note_list"
import {StaffTwo} from "st/components/staff_two"
import {render} from "spec/helpers"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import Two from "two.js"

import {GStaff, FStaff, GrandStaff, ChordStaff} from "st/components/staves"

// Example for rendering with old staff:
// import {GStaff, FStaff, GrandStaff} from "st/components/staves"
// React.createElement(GStaff, {
//   heldNotes: {},
//   keySignature: new KeySignature(0),
//   pixelsPerBeat: 100,
//   noteWidth: 100,
//   notes
// })

import {KeySignature} from "st/music"


import * as React from "react"

describe("staff two", function() {
  it("renders empty staves", function() {
    render(
      // treble
      React.createElement(StaffTwo, {
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0),
        height: 150
      }),

      // bass
      React.createElement(StaffTwo, {
        type: "bass",
        range: ["C2", "E4"],
        keySignature: new KeySignature(0),
        height: 150
      }),

      // alto
      React.createElement(StaffTwo, {
        type: "alto",
        range: ["B3", "D6"],
        keySignature: new KeySignature(0),
        height: 150,
      })
    )

    expect(true).toBe(true)
  })

  it("renders empty grand staff", function() {
    render(React.createElement(StaffTwo, {
      type: "grand",
      range: ["C2", "C6"],
      keySignature: new KeySignature(0)
    }))

    expect(true).toBe(true)
  })

  // this spec is concerned with assigning notes to the correct staff based on
  // minimizing staff jumps by using ledger lines
  it("renders full grand staff", function() {
    render(
      React.createElement(StaffTwo, {
        height: 200,
        type: "grand",
        range: ["C2", "C6"],
        keySignature: new KeySignature(0),
        notes: new NoteList([
          ["C4"],
          ["B3"],
          ["A3"],
          ["G3"],
          ["F3"],
          ["E3"],
          ["D3"],
          ["E3"],
          ["F3"],
          ["G3"],
          ["A3"],
          ["B3"],
          ["C4"],
          ["D4"],
          ["E4"],
          ["F4"],
          ["G4"],
          ["A4"],
          ["B4"],
        ])
      }),

      React.createElement(StaffTwo, {
        height: 200,
        type: "grand",
        range: ["C2", "C6"],
        keySignature: new KeySignature(0),
        notes: new NoteList([
          ["C4"],
          ["B3"],
          ["C5"],
          ["B3"],
        ])
      }),

      React.createElement(StaffTwo, {
        type: "grand",
        range: ["C2", "C6"],
        keySignature: new KeySignature(0),
        notes: new NoteList([
          ["F3", "A3", "D4"],
          ["A3", "D4", "F4"]
        ])
      })
    )

    expect(true).toBe(true)
  })

  it("grand staff with held notes", function() {
    render(
      React.createElement(StaffTwo, {
        type: "grand",
        range: ["C2", "C6"],
        keySignature: new KeySignature(0),
        heldNotes: {
          "C4": true
        },
        notes: new NoteList([
          ["A3", "C4", "F4"],
          ["C4"]
        ])
      })
    )

    expect(true).toBe(true)
  })

  it("renders held notes", function() {
    const heldNotes = {
      "F4": true,
      "A3": true,
      "F3": true
    }

    const notes = new NoteList([
      ["A3","G4"],
      ["F4"]
    ])

    render(
      React.createElement(StaffTwo, {
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(2),
        heldNotes,
        notes
      }),

      // React.createElement(GStaff, {
      //   keySignature: new KeySignature(2),
      //   pixelsPerBeat: 100,
      //   noteWidth: 100,
      //   heldNotes,
      //   notes,
      // })
    )

    expect(true).toBe(true)
  })


  it("renders full treble staff", function() {
    render(React.createElement(StaffTwo, {
      type: "treble",
      range: ["A3", "C6"],
      keySignature: new KeySignature(0),
      notes: new NoteList([
        ["G4"],
        ["F5", "E4"], // the extend of the cleff
        ["G5", "D4"],
        ["A5", "C4"],
        ["B5", "B3"],
        ["C6", "A3"],
      ]),
      heldNotes: {
        "C6": true,
        "A2": true
      }
    }))

    expect(true).toBe(true)
  })

  it("renders full alto staff", function() {
    const notes = new NoteList([
      ["F5"], // key signature root
      ["C5"],
      ["E5", "A4"],
      ["G5", "F4"],
      ["B5", "D4"],
      ["D6", "B3"],
    ])


    render(
      React.createElement(StaffTwo, {
        type: "alto",
        range: ["B3", "D6"],
        height: 150,
        keySignature: new KeySignature(0),
        notes
      }),

      React.createElement(StaffTwo, {
        type: "alto",
        range: ["B3", "D6"],
        height: 150,
        keySignature: new KeySignature(7),
        notes
      }),

      React.createElement(StaffTwo, {
        type: "alto",
        range: ["B3", "D6"],
        height: 150,
        keySignature: new KeySignature(-7),
        notes
      })
    )

    expect(true).toBe(true)
  })


  it("renders key signatures", function() {
    const notes = new NoteList([
      ["G4"],
      ["A4"],
      ["B4"],
      ["C5"],
      ["D5"],
      ["E5"],
      ["F5"],
      ["G5"],
    ])

    render(
      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(7),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(-7),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "bass",
        range: ["C2", "G5"],
        keySignature: new KeySignature(7),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "bass",
        range: ["C2", "G5"],
        keySignature: new KeySignature(-7),
        notes
      }),
    )

    expect(true).toBe(true)
  })


  it("renders stacked notes", function() {
    const notes = new NoteList([
      ["C4", "D4", "E4", "F4"],
      ["G4", "A4", "C5"],
      ["F4", "A4", "B4"],
    ])

    render(
      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0),
        notes
      }),

      // React.createElement(GStaff, {
      //   heldNotes: {},
      //   keySignature: new KeySignature(0),
      //   pixelsPerBeat: 100,
      //   noteWidth: 100,
      //   notes
      // })
    )

    expect(true).toBe(true)
  })

  it("renders accidentals", function() {
    const notes = new NoteList([
      ["G4", "C4"],
      ["E#4", "G#4", "B#4"],
      ["E#4", "F#4", "G#4"],

      ["G#4", "C#4"],
      ["Gb4", "Cb4"],
    ])

    render(
      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(3),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(-3),
        notes
      }),

      // React.createElement(GStaff, {
      //   heldNotes: {},
      //   keySignature: new KeySignature(0),
      //   pixelsPerBeat: 100,
      //   noteWidth: 100,
      //   notes
      // }),
      // React.createElement(GStaff, {
      //   heldNotes: {},
      //   keySignature: new KeySignature(3),
      //   pixelsPerBeat: 100,
      //   noteWidth: 100,
      //   notes
      // }),
      // // NOTE: there is a discrepancy here, the old staff would transform notes
      // // in a strange way. With refactoring to how note lists work, we should
      // // be not be concerned about re-implementing this in the new staff
      // React.createElement(GStaff, {
      //   heldNotes: {},
      //   keySignature: new KeySignature(-3),
      //   pixelsPerBeat: 100,
      //   noteWidth: 100,
      //   notes
      // }),
    )

    expect(true).toBe(true)
  })


})

// these specs mount into their own isolated root (rather than the shared
// helper root) so each test has direct control over unmount timing
describe("staff two mount/unmount race", function() {
  let container

  beforeEach(function() {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(function() {
    document.body.removeChild(container)
  })

  it("does not throw when unmounted before Two.js setup has assigned state.two", function() {
    const root = createRoot(container)

    let instance
    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0)
      }))
    })

    // simulate an unmount landing before the Two.js setup triggered by mount
    // has assigned state.two (e.g. mount and unmount in the same tick)
    instance.state = {...instance.state, two: undefined}

    expect(() => instance.componentWillUnmount()).not.toThrow()
  })

  // the trainer's scroll mode slider sets its first offset as the page
  // mounts, which can land before the Two.js setup has assigned state.two
  it("does not throw when the slider sets an offset before Two.js setup has assigned state.two", function() {
    const root = createRoot(container)

    let instance
    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0),
        notes: new NoteList([["C4"], ["E4"]])
      }))
    })

    instance.state = {...instance.state, two: undefined}

    expect(() => instance.setOffset(4)).not.toThrow()

    flushSync(() => root.unmount())
  })

  it("paints the scene (flushes to Two#update) when notes/type/keySignature are already set on the first render", function() {
    const root = createRoot(container)
    const updateSpy = spyOn(Two.prototype, "update").and.callThrough()

    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0),
        notes: new NoteList([["C4"]])
      }))
    })

    // componentDidMount always does one initial (empty) update() before the
    // staff/notes exist; the scene must be painted again once they're added,
    // without requiring a later, separate prop change to trigger it
    expect(updateSpy.calls.count()).toBeGreaterThan(1)

    flushSync(() => root.unmount())
  })

  it("waits for asset refs to attach before rendering the staves", function() {
    const root = createRoot(container)

    let instance
    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0),
        notes: new NoteList([["C4"]])
      }))
    })

    // swap in a fresh, unattached ref so the next render mounts a staff that
    // needs it before React commits and attaches it
    instance.assets.fclef = React.createRef()
    instance.assetCache = {}

    expect(() => flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        type: "bass",
        range: ["C2", "E4"],
        keySignature: new KeySignature(0),
        notes: new NoteList([["C4"]])
      }))
    })).not.toThrow()
    expect(instance.assets.fclef.current).toBeTruthy()
    expect(instance.bassStaffRef.current).toBeTruthy()

    flushSync(() => root.unmount())
  })

  it("throws a clear error when an asset is genuinely missing", function() {
    const root = createRoot(container)

    let instance
    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        type: "treble",
        range: ["A3", "C6"],
        keySignature: new KeySignature(0)
      }))
    })

    instance.assets.gclef = {current: null}
    instance.assetCache = {}

    expect(() => instance.getAsset("gclef")).toThrowError("Failed to find asset by name: gclef")

    flushSync(() => root.unmount())
  })
})

// StaffGroup#makeNotes computes ledger lines (StaffGroup#render draws them,
// one LedgerLine per note that needs one, mirroring NoteGroup): these specs
// mount into their own root for direct, synchronous access to the staff
// refs (trebleStaffRef/bassStaffRef) and their Two.js shapes
describe("staff two ledger lines", function() {
  let container, root

  beforeEach(function() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(function() {
    flushSync(() => root.unmount())
    document.body.removeChild(container)
  })

  let mount = (props) => {
    let instance
    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        keySignature: new KeySignature(0),
        height: 150,
        range: ["A3", "C6"],
        ...props,
      }))
    })
    return instance
  }

  it("draws ledger lines above and below the treble staff", function() {
    let instance = mount({
      type: "treble",
      notes: new NoteList([["C6"], ["A5"], ["G5"], ["F5"], ["E4"], ["D4"], ["C4"], ["A3"]]),
    })

    let lines = instance.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine")
    expect(lines.length).toBe(6)

    let ys = lines.map(l => l.translation.y).sort((a, b) => a - b)
    expect(ys).toEqual([-116, -58, -58, 290, 290, 348])

    for (let line of lines) {
      expect(line.vertices[1].x - line.vertices[0].x).toBeCloseTo(106 + 15 * 2, 5)
    }
  })

  it("draws ledger lines above and below the bass staff", function() {
    let instance = mount({
      type: "bass",
      range: ["C2", "E4"],
      notes: new NoteList([["C2"], ["E2"], ["G2"], ["A3"], ["C4"], ["E4"]]),
    })

    let lines = instance.bassStaffRef.current.notesGroup.getByClassName("ledgerLine")
    expect(lines.length).toBe(6)
  })

  it("draws ledger lines above and below both staves of the grand staff", function() {
    let bothAbove = mount({type: "grand", range: ["C2", "C6"], notes: new NoteList([["C6"], ["C6"]])})
    expect(bothAbove.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(4)
    expect(bothAbove.bassStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(0)

    let stickToTreble = mount({type: "grand", range: ["C2", "C6"], notes: new NoteList([["E4"], ["B3"]])})
    let trebleLines = stickToTreble.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine")
    expect(trebleLines.length).toBe(1)
    expect(trebleLines[0].translation.y).toBe(290)
    expect(stickToTreble.bassStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(0)

    let stickToBass = mount({type: "grand", range: ["C2", "C6"], notes: new NoteList([["A3"], ["C4"]])})
    let bassLines = stickToBass.bassStaffRef.current.notesGroup.getByClassName("ledgerLine")
    expect(bassLines.length).toBe(1)
    expect(bassLines[0].translation.y).toBe(-58)
    expect(stickToBass.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(0)

    let bothBelow = mount({type: "grand", range: ["C2", "C6"], notes: new NoteList([["C2"], ["C2"]])})
    expect(bothBelow.bassStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(4)
    expect(bothBelow.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(0)
  })

  it("fits inside the plate", function() {
    let instance = mount({
      type: "treble",
      notes: new NoteList([["C6"], ["A3"]]),
    })

    // StaffTwo also renders its hidden asset svgs (display: none, so a
    // zero rect); pick the real, visible Two.js canvas
    let svg = [...container.querySelectorAll("svg")].find(s => s.getBoundingClientRect().height > 0)
    let svgRect = svg.getBoundingClientRect()
    let lines = container.querySelectorAll(".ledgerLine")
    expect(lines.length).toBeGreaterThan(0)

    for (let line of lines) {
      let rect = line.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(svgRect.top)
      expect(rect.bottom).toBeLessThanOrEqual(svgRect.bottom)
    }
  })

  it("scroll with the notes", function() {
    let instance = mount({
      type: "treble",
      notes: new NoteList([["G4"], ["C4"]]),
    })

    let staff = instance.trebleStaffRef.current
    let ledger = staff.notesGroup.getByClassName("ledgerLine")[0]
    let note = staff.notesGroup.getByClassName("note").find(n => !n.classList.includes("head"))

    let ledgerBefore = ledger.getBoundingClientRect().left
    let noteBefore = note.getBoundingClientRect().left

    instance.setOffset(2)

    let ledgerDelta = ledger.getBoundingClientRect().left - ledgerBefore
    let noteDelta = note.getBoundingClientRect().left - noteBefore

    expect(ledgerDelta).not.toBe(0)
    expect(ledgerDelta).toBeCloseTo(noteDelta, 3)
  })

  it("are replaced, not accumulated, on a re-render", function() {
    let instance = mount({type: "treble", notes: new NoteList([["C6"]])})
    expect(instance.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(2)

    instance = mount({type: "treble", notes: new NoteList([["G4"]])})
    expect(instance.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine").length).toBe(0)
  })

  it("widens a seconds-offset note's ledger line to span its offset head", function() {
    let instance = mount({
      type: "treble",
      notes: new NoteList([["B3", "C4"]]),
    })

    let lines = instance.trebleStaffRef.current.notesGroup.getByClassName("ledgerLine")
    expect(lines.length).toBe(2)
    lines.forEach(l => expect(l.translation.y).toBe(290))

    let xs = lines.map(l => l.translation.x).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeCloseTo(Math.floor(106 * 0.9), 5)
  })

  it("fits the plate from the staff's range, not its current notes", function() {
    let a = mount({
      type: "treble", maxScale: 0.24,
      range: ["A3", "C6"],
      notes: new NoteList([["G4"]]),
    })
    let scaleA = a.renderGroup.scale
    let yA = a.renderGroup.translation.y

    let b = mount({
      type: "treble", maxScale: 0.24,
      range: ["A3", "C6"],
      notes: new NoteList([["C6"], ["A3"]]),
    })
    let scaleB = b.renderGroup.scale
    let yB = b.renderGroup.translation.y

    expect(scaleB).toBeCloseTo(scaleA, 6)
    expect(yB).toBe(yA)
  })

  it("measures the fit once, not on every render", function() {
    let instance = mount({
      type: "treble",
      notes: new NoteList([["C4"]]),
    })

    let loads = spyOn(instance, "getAsset").and.callThrough()

    mount({
      type: "treble",
      notes: new NoteList([["D4"], ["E4"]]),
    })

    expect(loads.calls.allArgs().map(args => args[0])).not.toContain("gclef")
  })

  it("spaces columns by noteWidth times scale in both modes, not the fixed legacy spacing", function() {
    let instance = mount({
      type: "treble",
      range: ["A3", "C6"],
      maxScale: 0.24,
      notes: new NoteList([["C4"], ["D4"], ["E4"]]),
      noteWidth: 200,
      scale: 0.64,
    })

    let notes = instance.trebleStaffRef.current.notesGroup.getByClassName("note")
      .sort((a, b) => a.translation.x - b.translation.x)
    expect(notes.length).toBe(3)

    let renderScale = instance.renderGroup.scale
    let dxPx = (notes[1].translation.x - notes[0].translation.x) * renderScale
    expect(dxPx).toBeCloseTo(200 * 0.64, 1)
  })
})

// StaffGroup#makeNotes's parity with the legacy renderer (AGENTS.md's
// "Legacy features StaffTwo doesn't draw", Q2 = P1): accidentals, held keys
// and the miss shake
describe("staff two parity", function() {
  let container, root

  beforeEach(function() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(function() {
    flushSync(() => root.unmount())
    document.body.removeChild(container)
  })

  let mount = (props) => {
    let instance
    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        ref: inst => { instance = inst },
        height: 150,
        range: ["A3", "C6"],
        ...props,
      }))
    })
    return instance
  }

  it("draws the accidental a key signature leaves on a note", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["C#4"], ["Bb4"]]),
    })

    let accidentals = instance.trebleStaffRef.current.notesGroup.getByClassName("accidental")
    expect(accidentals.map(a => a.classList.includes("sharp"))).toContain(true)
    expect(accidentals.map(a => a.classList.includes("flat"))).toContain(true)
  })

  it("draws a natural a key signature leaves on a note", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(1), // G major: F is sharp
      notes: new NoteList([["F4"]]),
    })

    let accidentals = instance.trebleStaffRef.current.notesGroup.getByClassName("accidental")
    expect(accidentals.length).toBe(1)
    expect(accidentals[0].classList.includes("natural")).toBe(true)
  })

  it("draws no accidental on a note already in the key", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(3), // A major: F# is in the key
      notes: new NoteList([["F#4"]]),
    })

    expect(instance.trebleStaffRef.current.notesGroup.getByClassName("accidental").length).toBe(0)
  })

  it("draws a held key not in the head column as a faint extra head, and dims a held head note", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["C5"]]),
      heldNotes: {"A5": true},
    })

    let notes = instance.trebleStaffRef.current.notesGroup.getByClassName("note")
    let held = notes.filter(n => n.classList.includes("held"))
    expect(held.length).toBe(1)
    expect(held[0].opacity).toBe(0.2)
    // drawn at column 0's x, alongside the head itself
    let head = notes.find(n => n.classList.includes("head"))
    expect(held[0].translation.x).toBe(head.translation.x)

    // the head itself is held when the key down is its own note
    instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["C5"]]),
      heldNotes: {"C5": true},
    })
    let headNote = instance.trebleStaffRef.current.notesGroup.getByClassName("note")
      .find(n => n.classList.includes("head"))
    expect(headNote.classList.includes("held")).toBe(true)
    expect(headNote.opacity).toBe(0.2)
  })

  it("draws a held key on the grand staff that holds its column, not the one middle C alone would pick", function() {
    // splitForGrandStaff keeps B3 on the treble staff, following the C4
    // before it, even though B3 is below middle C
    let instance = mount({
      type: "grand",
      range: ["C2", "C6"],
      keySignature: new KeySignature(0),
      notes: new NoteList([["C4"], ["B3"]]),
      heldNotes: {"B3": true},
    })

    let heldOn = staff => staff.notesGroup.getByClassName("note")
      .filter(n => n.classList.includes("held"))

    expect(heldOn(instance.trebleStaffRef.current).length).toBe(1)
    expect(heldOn(instance.bassStaffRef.current).length).toBe(0)
  })

  it("draws a grand staff column's annotation on the upper staff, wherever its notes went", function() {
    let notes = new NoteList([["C5"], ["C2"]])
    notes[0].annotation = "1"
    notes[1].annotation = "2"

    let instance = mount({
      type: "grand",
      range: ["C2", "C6"],
      keySignature: new KeySignature(0),
      notes,
    })

    let annotations = staff => staff.notesGroup.getByClassName("annotation")

    expect(annotations(instance.trebleStaffRef.current).map(a => a.value).sort())
      .toEqual(["1", "2"])
    expect(annotations(instance.bassStaffRef.current).length).toBe(0)
  })

  it("shakes the head column's shapes while noteShaking, settling back to x 0", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["C6"]]), // a ledger line too, so it's in the shake
      noteShaking: true,
    })

    let groups = instance.getFirstColumnGroups()
    expect(groups.length).toBeGreaterThan(0)

    let updater
    instance.updaters.forEach(fn => { updater = fn })
    expect(updater).toBeTruthy()

    flushSync(() => updater(1, 16))
    expect(groups.some(g => g.translation.x != 0)).toBe(true)

    flushSync(() => updater(-1, 0))
    expect(groups.every(g => g.translation.x == 0)).toBe(true)
  })

  it("dims a held key's accidental along with its head", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["C5"]]),
      heldNotes: {"A#5": true},
    })

    let accidentals = instance.trebleStaffRef.current.notesGroup.getByClassName("accidental")
    expect(accidentals.length).toBe(1)
    expect(accidentals[0].classList.includes("held")).toBe(true)
    expect(accidentals[0].opacity).toBe(0.2)

    // the same accidental, on a note nothing is holding, is drawn full black
    instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["A#5"]]),
    })

    accidentals = instance.trebleStaffRef.current.notesGroup.getByClassName("accidental")
    expect(accidentals.length).toBe(1)
    expect(accidentals[0].classList.includes("held")).toBe(false)
    expect(accidentals[0].opacity).toBe(1)
  })

  it("redraws an accidental's glyph when its type changes under the same key", function() {
    // F major: B is natural against the key's Bb, C# is spelled Db
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(-1),
      notes: new NoteList([["E4"]]),
      heldNotes: {"B4": true, "C#5": true},
    })

    // the glyph's own extent, with its placement (the shape's own matrix)
    // left out, so a drawn accidental can be compared against a fresh asset
    let extent = shape => {
      let rect = shape.getBoundingClientRect(true)
      return [rect.width, rect.height]
    }

    let flat = extent(instance.getAsset("flat"))
    let natural = extent(instance.getAsset("natural"))
    // the spec only means something if the two glyphs are different shapes
    expect(Math.abs(flat[0] - natural[0]) + Math.abs(flat[1] - natural[1]))
      .toBeGreaterThan(1)

    let accidentals = () => instance.trebleStaffRef.current.notesGroup.getByClassName("accidental")
    expect(accidentals().length).toBe(2)

    // releasing B4 drops the natural, leaving the flat under the key the
    // natural's shape was built for
    instance = mount({
      type: "treble",
      keySignature: new KeySignature(-1),
      notes: new NoteList([["E4"]]),
      heldNotes: {"C#5": true},
    })

    expect(accidentals().length).toBe(1)
    expect(accidentals()[0].classList.includes("flat")).toBe(true)

    let drawn = extent(accidentals()[0])
    expect(drawn[0]).toBeCloseTo(flat[0], 3)
    expect(drawn[1]).toBeCloseTo(flat[1], 3)
  })

  it("measures an accidental's glyph width once, not on every render", function() {
    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["C#4"]]),
    })

    expect(instance.assetWidths.sharp).toBeGreaterThan(0)

    let loads = spyOn(instance, "getAsset").and.callThrough()

    mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList([["D#4"], ["F#4"]]),
    })

    expect(loads.calls.allArgs().map(args => args[0])).not.toContain("sharp")
  })

  it("moves a shape into the head column's group as the note list shifts under it", function() {
    let notes = (columns, heldNotes) => ({
      type: "treble",
      keySignature: new KeySignature(0),
      notes: new NoteList(columns),
      heldNotes,
    })

    let instance = mount(notes([["C4"], ["E4"]], {"A5": true}))
    let staff = instance.trebleStaffRef.current

    // the faint held key is drawn on the head column, so its shape has to sit
    // in the head group NoteShaker shakes
    let faint = () => staff.notesGroup.getByClassName("note")
      .find(n => n.classList.includes("held"))
    let later = () => staff.notesGroup.getByClassName("note")
      .find(n => !n.classList.includes("held") && !n.classList.includes("head"))

    expect(faint().parent).toBe(staff.headGroup)
    expect(later().parent).toBe(staff.notesGroup)

    // the list advances: the keyed shape that drew the second column's note
    // now draws the faint held key on the head column
    mount(notes([["E4"]], {"A5": true}))
    expect(faint().parent).toBe(staff.headGroup)
    expect(later()).toBeUndefined()

    // and back the other way: that shape draws the second column again
    mount(notes([["C4"], ["E4"]], {"A5": true}))
    expect(faint().parent).toBe(staff.headGroup)
    expect(later().parent).toBe(staff.notesGroup)
  })

  it("draws a column's annotation above it", function() {
    let notes = new NoteList([["C4"]])
    notes[0].annotation = "1"

    let instance = mount({
      type: "treble",
      keySignature: new KeySignature(0),
      notes,
    })

    let annotations = instance.trebleStaffRef.current.notesGroup.getByClassName("annotation")
    expect(annotations.length).toBe(1)
    expect(annotations[0].value).toBe("1")
  })
})
