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
        keySignature: new KeySignature(0),
        height: 150
      }),

      // bass
      React.createElement(StaffTwo, {
        type: "bass",
        keySignature: new KeySignature(0),
        height: 150
      }),

      // alto
      React.createElement(StaffTwo, {
        type: "alto",
        keySignature: new KeySignature(0),
        height: 150,
      })
    )

    expect(true).toBe(true)
  })

  it("renders empty grand staff", function() {
    render(React.createElement(StaffTwo, {
      type: "grand",
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
        height: 150,
        keySignature: new KeySignature(0),
        notes
      }),

      React.createElement(StaffTwo, {
        type: "alto",
        height: 150,
        keySignature: new KeySignature(7),
        notes
      }),

      React.createElement(StaffTwo, {
        type: "alto",
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
        keySignature: new KeySignature(7),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        keySignature: new KeySignature(-7),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "bass",
        keySignature: new KeySignature(7),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "bass",
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
        keySignature: new KeySignature(0),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
        keySignature: new KeySignature(3),
        notes
      }),

      React.createElement(StaffTwo, {
        height: 150,
        type: "treble",
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
        keySignature: new KeySignature(0)
      }))
    })

    // simulate an unmount landing before the Two.js setup triggered by mount
    // has assigned state.two (e.g. mount and unmount in the same tick)
    instance.state = {...instance.state, two: undefined}

    expect(() => instance.componentWillUnmount()).not.toThrow()
  })

  it("paints the scene (flushes to Two#update) when notes/type/keySignature are already set on the first render", function() {
    const root = createRoot(container)
    const updateSpy = spyOn(Two.prototype, "update").and.callThrough()

    flushSync(() => {
      root.render(React.createElement(StaffTwo, {
        type: "treble",
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
        keySignature: new KeySignature(0)
      }))
    })

    instance.assets.gclef = {current: null}
    instance.assetCache = {}

    expect(() => instance.getAsset("gclef")).toThrowError("Failed to find asset by name: gclef")

    flushSync(() => root.unmount())
  })
})
