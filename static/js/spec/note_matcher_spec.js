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

    // letting D4 up used to judge the column again, an uncounted miss that
    // still shook it; releases judge nothing now (T4), so each wrong key is
    // judged once, when it goes down
    ["a key outside the column is a slip, counted once for the column",
      [["C4"], ["G4"]],
      [["on", "D4"], ["off", "D4"], ["on", "E4"]],
      ["miss C4", "slip C4"], ["C4"]],

    ["a wrong key alone then released is one slip",
      [["C4"], ["G4"]],
      [["on", "D4"], ["off", "D4"]],
      ["miss C4"], ["C4"]],

    ["counts one slip a try however many wrong keys are held together",
      [["C4"], ["G4"]],
      [["on", "D4"], ["on", "E4"]],
      ["miss C4", "uncounted C4"], ["C4"]],

    ["a slip is counted before the hit when both fall to one press",
      [["C4"], ["G4"]],
      [["on", "D4"], ["forget"], ["on", "C4"]],
      ["miss C4", "miss C4", "hit C4"], ["G4"]],

    // every key up with the column unmatched used to miss it and forget the
    // keys struck, so C4 had to go down again. Releases never judge (T4): a
    // hand let up before the other lands, as under the pedal, completes it
    ["letting every key up neither misses the column nor forgets the keys struck",
      [["C4", "E4"], ["G4"]],
      [["on", "C4"], ["off", "C4"], ["on", "E4"]],
      ["hit C4+E4"], ["G4"]],

    ["a column completes however far apart its keys go down, each let up before the next",
      [["C4", "E4", "G4"], ["A4"]],
      [["on", "C4", 0], ["off", "C4", 60], ["on", "E4", 5000], ["off", "E4", 5060], ["on", "G4", 20000]],
      ["hit C4+E4+G4"], ["A4"]],

    ["striking the column's key again after letting it up is no slip",
      [["C4", "E4"], ["G4"]],
      [["on", "C4"], ["off", "C4"], ["on", "C4"], ["off", "C4"], ["on", "E4"]],
      ["hit C4+E4"], ["G4"]],

    ["a wrong key let up before the stats start over isn't counted again at the hit",
      [["C4"], ["G4"]],
      [["on", "D4"], ["off", "D4"], ["forget"], ["on", "C4"]],
      ["miss C4", "hit C4"], ["G4"]],

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

  it("keeps the keys struck at the head when every key comes up", function() {
    let matcher = matcherFor([["C4", "E4"], ["G4"]])
    run(matcher, [["on", "C4"], ["on", "D4"], ["off", "C4"], ["off", "D4"]])

    expect(matcher.held).toEqual({})
    expect(matcher.touched).toEqual({C4: true, D4: true})
  })

  // Adopting another list (a rebuilt drill, a column scrolled past) plays its
  // head afresh: no key struck at the old one counts for it, whether it was
  // let up or is still down. Score-sustained held credit is a later step (T6)
  it("drops the keys struck at the old head when it adopts another list", function() {
    let matcher = matcherFor([["C4", "G4"], ["A4"]])
    run(matcher, [["on", "C4"], ["off", "C4"], ["on", "D4"]])

    let rebuilt = new NoteList([["C4", "E4"], ["A4"]], {generator: {nextNote: () => []}})
    matcher.setNotes(rebuilt)
    expect(matcher.touched).toEqual({})
    expect(matcher.held).toEqual({D4: true})

    // the wrong D4 still down was counted on the column it was played on,
    // and isn't counted again on the new head, which its own keys complete
    expect(run(matcher, [["on", "C4"], ["on", "E4"]])).toEqual(["hit C4+E4"])
  })

  it("needs the new head's keys struck again however many are already down", function() {
    let matcher = matcherFor([["C4", "E4", "G4"], ["B4"]])
    run(matcher, [["on", "C4"], ["on", "E4"]])

    let scrolled = new NoteList([["C4", "E4"], ["B4"]], {generator: {nextNote: () => []}})
    matcher.setNotes(scrolled)

    // C4 and E4 are still down, but neither went down at this column, so it
    // isn't complete: a wrong key slips on it and leaves it on the list
    expect(run(matcher, [["on", "D4"]])).toEqual(["miss C4+E4"])
    expect(head(matcher)).toEqual(["C4", "E4"])

    // struck again, they complete it, and the D4 held through isn't recounted
    expect(run(matcher, [["on", "C4"], ["on", "E4"]])).toEqual(["hit C4+E4"])
    expect(head(matcher)).toEqual(["B4"])
  })

  // The spread of a column: from the first of its keys to go down in the
  // pass to the last, the one that completed it. Recorded on the hit for
  // the grade to read later; nothing judges it
  describe("the spread of a column", function() {
    let spreads = (columns, script) => {
      let matcher = matcherFor(columns)
      run(matcher, script)
      return matcher.judged.filter(event => event.type == "hit").map(event => event.spread)
    }

    it("runs from the first of the column's keys down to the last", function() {
      expect(spreads([["C4", "E4", "G4"], ["A4"]], [
        ["on", "C4", 1000], ["off", "C4", 1060],
        ["on", "E4", 1080], ["off", "E4", 1140],
        ["on", "G4", 1160],
        ["on", "A4", 2000],
      ])).toEqual([160, 0])
    })

    it("counts a key struck again from its first strike, and no wrong key", function() {
      expect(spreads([["C4", "E4"], ["A4"]], [
        ["on", "D4", 900],
        ["on", "C4", 1000], ["off", "C4", 1050], ["on", "C4", 1400],
        ["on", "E4", 1500],
      ])).toEqual([500])
    })

    it("starts afresh at each column, with keys held across the hit not in it", function() {
      expect(spreads([["C4"], ["E4", "G4"]], [
        ["on", "C4", 1000],
        ["on", "E4", 3000], ["on", "G4", 3200],
      ])).toEqual([0, 200])
    })

    it("is null for presses with no timeStamp", function() {
      expect(spreads([["C4", "E4"], ["A4"]], [["on", "C4"], ["on", "E4"]])).toEqual([null])
    })

    // the on-screen keyboard's presses carry no timeStamp, so a column with
    // one of them among its keys has no spread to report, whichever it was
    it("is null when either end of the column came with no timeStamp", function() {
      expect(spreads([["C4", "E4"], ["A4"]], [["on", "C4"], ["on", "E4", 5000]])).toEqual([null])
      expect(spreads([["C4", "E4"], ["A4"]], [["on", "C4", 1000], ["on", "E4"]])).toEqual([null])
    })
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

    // the release used to judge the column again (an uncounted miss); it
    // judges nothing now (T4)
    it("judges a press and release of one key as when they are spread out", function() {
      let together = judge([["on", "D4", 1000], ["off", "D4", 1000]])
      let apart = judge([["on", "D4", 1000], ["off", "D4", 1020]])

      expect(together).toEqual(apart)
      expect(together).toEqual([["miss C4"], ["C4"]])
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

    // the last of the keys up used to judge the column once; releases judge
    // nothing now (T4), however many come up together
    it("judges nothing when a column's keys all come up in one event", function() {
      let matcher = matcherFor([["C4", "E4"], ["G4"]])
      run(matcher, [["on", "C4", 1000], ["on", "D4", 1000]])

      let ups = ["C4", "D4"].map(note => {
        matcher.judged.length = 0
        matcher.noteOff(note, 1100)
        return [...matcher.judged]
      })
      expect(ups).toEqual([[], []])
      expect(matcher.held).toEqual({})
    })
  })
})
