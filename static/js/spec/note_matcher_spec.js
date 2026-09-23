import NoteList from "st/note_list"
import NoteMatcher from "st/note_matcher"

// A matcher over an explicit run of columns: the generator hands out the
// columns still to come, and empty ones once they run out. Every judgement
// it makes is collected on matcher.judged, in the order it made them
let matcherFor = (columns, opts={}) => {
  let rest = [...columns]
  let notes = new NoteList([], {generator: {nextNote: () => rest.shift() || []}})
  notes.fillBuffer(columns.length)

  let judged = []
  let matcher = new NoteMatcher(notes, {...opts, onEvent: event => judged.push(event)})
  matcher.judged = judged
  return matcher
}

// Plays a script of ["on"|"off", note, timeStamp] against the matcher (plus
// ["forget"], the stats starting over), returning what it judged: one line
// an event, in the order the matcher produced them
let run = (matcher, script) => {
  let sorted = notes => [...notes].sort().join("+")
  matcher.judged.length = 0

  for (let [what, note, at] of script) {
    if (what == "forget") {
      matcher.forgetMisses()
      continue
    }

    if (what == "on") {
      matcher.noteOn(note, at)
    } else {
      matcher.noteOff(note, at)
    }
  }

  return matcher.judged.map(event => {
    switch (event.type) {
      case "miss":
        return `${event.counted || "uncounted"} ${sorted(event.blamed)}`
      case "hit":
        return `hit ${sorted(event.hitNotes)}`
      default:
        return event.type
    }
  })
}

let head = matcher => [...matcher.notes.currentColumn()]

describe("note matcher", function() {
  // Today's detection rules, one row each:
  // [what, columns, script, what it judged, the head left over, options].
  // A dropped pitch (the app staff's fallback for a piece the engine can't
  // draw) never reaches the matcher at all: the page's droppedStaffNote
  // guard keeps it out, and the score page's own specs cover it (D5a)
  let rules = [
    ["a column hits once every one of its notes has been touched",
      [["C4", "E4"], ["G4"]],
      [["on", "C4"], ["on", "E4"]],
      ["hit C4+E4"], ["G4"]],

    ["a column hits with a brushed neighbour still down, which the stats don't credit",
      [["C4"], ["G4"]],
      [["on", "D4"], ["on", "C4"]],
      ["miss C4", "hit C4"], ["G4"]],

    ["a key outside the column is a slip, counted once for the column",
      [["C4"], ["G4"]],
      [["on", "D4"], ["off", "D4"], ["on", "E4"]],
      ["miss C4", "uncounted C4", "slip C4"], ["C4"]],

    ["counts one slip a try however many wrong keys are held together",
      [["C4"], ["G4"]],
      [["on", "D4"], ["on", "E4"]],
      ["miss C4", "uncounted C4"], ["C4"]],

    ["a slip is counted before the hit when both fall to one press",
      [["C4"], ["G4"]],
      [["on", "D4"], ["forget"], ["on", "C4"]],
      ["miss C4", "miss C4", "hit C4"], ["G4"]],

    ["every key up with a touched note unmatched misses, and the column is played afresh",
      [["C4", "E4"], ["G4"]],
      [["on", "C4"], ["off", "C4"], ["on", "C4"], ["on", "E4"]],
      ["miss E4", "hit C4+E4"], ["G4"]],

    ["keys let up that touched nothing in the column are no try at it",
      [["C4", "E4"], ["G4"], ["A4"]],
      [["on", "C4"], ["on", "E4"], ["off", "C4"], ["off", "E4"]],
      ["hit C4+E4"], ["G4"]],

    ["a column blames a miss on the notes not touched",
      [["C4", "E4"], ["G4"]],
      [["on", "C4"], ["on", "D4"]],
      ["miss E4"], ["C4", "E4"]],

    ["an empty column judges nothing, pressed or released",
      [[], ["C4"]],
      [["on", "D4"], ["off", "D4"], ["on", "C4"], ["off", "C4"]],
      [], []],

    ["anyOctave hits the column from any octave of its notes",
      [["C4"], ["G4"]],
      [["on", "C6"]],
      ["hit C6"], ["G4"], {anyOctave: true}],

    ["chords judge nothing on a key down, and hit on the release",
      [["C4", "E4", "G4"], ["D4", "F4", "A4"]],
      [["on", "C4"], ["on", "E4"], ["on", "G4"], ["off", "C4"], ["off", "E4"], ["off", "G4"]],
      ["chordHit"], ["D4", "F4", "A4"], {mode: "chords"}],

    ["chords miss on the release of a chord that doesn't match",
      [["C4", "E4", "G4"], ["D4", "F4", "A4"]],
      [["on", "C4"], ["on", "E4"], ["off", "C4"], ["off", "E4"]],
      ["chordMiss"], ["C4", "E4", "G4"], {mode: "chords"}],
  ]

  for (let [what, columns, script, judged, left, opts] of rules) {
    it(what, function() {
      let matcher = matcherFor(columns, opts)
      expect(run(matcher, script)).toEqual(judged)
      expect(head(matcher)).toEqual(left)
    })
  }

  it("keeps the keys down across a hit and clears the keys touched", function() {
    let matcher = matcherFor([["C4", "E4"], ["G4"]])
    run(matcher, [["on", "C4"], ["on", "E4"]])

    expect(matcher.held).toEqual({C4: true, E4: true})
    expect(matcher.touched).toEqual({})
  })

  it("records the timeStamp of the event it was fed", function() {
    let matcher = matcherFor([["C4"], ["G4"]])
    matcher.noteOn("C4", 1234)
    expect(matcher.lastEventAt).toEqual(1234)

    matcher.noteOff("C4", 1290)
    expect(matcher.lastEventAt).toEqual(1290)
  })

  // The matcher judges one event at a time, so presses that arrived in one
  // MIDI packet are judged against the head each of them actually saw. These
  // are the report's batching cases (M7): they used to run through setState
  // callbacks that all saw the same head
  describe("events that arrive together", function() {
    let judge = script => {
      let matcher = matcherFor([["C4"], ["G4"], ["A4"]])
      return [run(matcher, script), head(matcher)]
    }

    it("judges two key-downs across a column boundary as when they are spread out", function() {
      let together = judge([["on", "C4", 1000], ["on", "G4", 1000]])
      let apart = judge([["on", "C4", 1000], ["on", "G4", 1020]])

      expect(together).toEqual(apart)
      expect(together).toEqual([["hit C4", "hit G4"], ["A4"]])
    })

    it("judges a press and release of one key as when they are spread out", function() {
      let together = judge([["on", "D4", 1000], ["off", "D4", 1000]])
      let apart = judge([["on", "D4", 1000], ["off", "D4", 1020]])

      expect(together).toEqual(apart)
      expect(together).toEqual([["miss C4", "uncounted C4"], ["C4"]])
    })

    it("checks the release once however many keys come up together", function() {
      let matcher = matcherFor([["C4", "E4", "G4"], ["D4", "F4", "A4"]], {mode: "chords"})
      run(matcher, [["on", "C4", 1000], ["on", "E4", 1000], ["on", "G4", 1000]])

      // the chord's three keys come up in one packet, and only the last of
      // them, when no key is left down, checks the release
      let ups = ["C4", "E4", "G4"].map(note => {
        matcher.judged.length = 0
        matcher.noteOff(note, 1100)
        return matcher.judged.map(event => event.type)
      })
      expect(ups).toEqual([[], [], ["chordHit"]])

      // a key that was never down releases nothing at all
      matcher.judged.length = 0
      expect(matcher.noteOff("G4", 1200)).toBe(null)
      expect(matcher.judged).toEqual([])
    })

    it("counts one miss for a column whose keys all come up in one event", function() {
      let matcher = matcherFor([["C4", "E4"], ["G4"]])
      run(matcher, [["on", "C4", 1000], ["on", "D4", 1000]])

      let ups = ["C4", "D4"].map(note => {
        matcher.judged.length = 0
        matcher.noteOff(note, 1100)
        return [...matcher.judged]
      })
      expect(ups.map(events => events.length)).toEqual([0, 1])
      expect(ups[1][0].counted).toBe(null)
    })
  })
})
