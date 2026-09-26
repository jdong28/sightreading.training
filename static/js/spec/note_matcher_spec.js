import NoteList from "st/note_list"
import NoteMatcher, {EARLY_KEY_WINDOW, LATE_REPEAT_WINDOW} from "st/note_matcher"

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
        return `hit ${sorted(event.hitNotes)}` +
          (event.early.length ? ` (early ${sorted(event.early)})` : "") +
          ((event.heldCredit || []).length ? ` (held ${sorted(event.heldCredit)})` : "")
      default:
        return event.type
    }
  })
}

let head = matcher => [...matcher.notes.currentColumn()]

// a column with the score's ornament notes allowed at it (column.allowed)
let ornamented = (column, allowed) => Object.assign([...column], {allowed})

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

    // T7: the score's ornaments played as written are allowed extras
    ["an ornament note allowed at the head is neither required nor a slip",
      [ornamented(["C4"], ["D4", "B3"]), ["G4"]],
      [["on", "D4"], ["off", "D4"], ["on", "B3"], ["on", "C4"]],
      ["hit C4"], ["G4"]],

    ["a column doesn't wait for its ornament notes",
      [ornamented(["C4", "E4"], ["F4"]), ["G4"]],
      [["on", "C4"], ["on", "E4"]],
      ["hit C4+E4"], ["G4"]],

    ["a brushed key that isn't one of the head's ornament notes still slips",
      [ornamented(["C4"], ["D4"]), ["G4"]],
      [["on", "E4"], ["on", "C4"]],
      ["miss C4", "hit C4"], ["G4"]],

    ["the next column's ornament notes are no allowance at the head",
      [["C4"], ornamented(["G4"], ["A4"])],
      [["on", "A4"], ["on", "C4"], ["on", "A4"]],
      ["miss C4", "hit C4"], ["G4"]],

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
  // let up or is still down, but for a key held that the score still sounds
  // at the new head (score-sustained credit, below)
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

  // T5 of the note detection report: lookahead (rules 2.4 and 3) and
  // lookbehind (rule 2.3), each over a window of the events' timeStamps. A
  // press with no timeStamp (the on-screen keyboard) can't be shown to fall
  // inside either window, so it is judged as before them
  describe("lookahead and lookbehind (T5)", function() {
    let rules = [
      ["credits a key of the next column struck while the column is under way to that column",
        [["C4", "E4"], ["G4", "B4"], ["D5"]],
        [["on", "C4", 0], ["on", "G4", 100], ["on", "E4", 200], ["on", "B4", 300]],
        ["hit C4+E4", "hit B4+G4 (early G4)"], ["D5"]],

      ["completes the next column at once when the keys credited early are all of it",
        [["C4", "E4"], ["G4"], ["A4"]],
        [["on", "C4", 0], ["on", "G4", 100], ["on", "E4", 200]],
        ["hit C4+E4", "hit G4 (early G4)"], ["A4"]],

      ["credits a key struck exactly the early window before the column completes",
        [["C4"], ["E4"], ["G4"]],
        [["on", "E4", 1000], ["on", "C4", 1000 + EARLY_KEY_WINDOW]],
        ["hit C4", "hit E4 (early E4)"], ["G4"]],

      // the player wasn't early, they were wrong: the key counts against the
      // column under way, and its own column still needs it struck
      ["counts a next column's key as a slip on the column that doesn't complete within the window",
        [["C4"], ["E4"], ["G4"]],
        [["on", "E4", 1000], ["on", "C4", 1001 + EARLY_KEY_WINDOW]],
        ["miss C4", "hit C4"], ["E4"]],

      ["counts one slip however many keys of the next column turn out wrong",
        [["C4"], ["E4", "G4"], ["A4"]],
        [["on", "E4", 0], ["on", "G4", 10], ["on", "C4", 1000], ["on", "E4", 1100], ["on", "G4", 1110]],
        ["miss C4", "hit C4", "hit E4+G4"], ["A4"]],

      ["judges a key of the next column gone stale at the next key down, before that key",
        [["C4"], ["E4"], ["G4"]],
        [["on", "E4", 0], ["on", "D4", 600], ["on", "C4", 700]],
        ["miss C4", "uncounted C4", "hit C4"], ["E4"]],

      ["counts no slip for the just completed column's key struck again shortly after",
        [["C4"], ["E4"]],
        [["on", "C4", 0], ["off", "C4", 30], ["on", "C4", 80]],
        ["hit C4"], ["E4"]],

      ["counts no slip for a key bounce in a chord just completed",
        [["C4", "E4"], ["G4"]],
        [["on", "C4", 0], ["on", "E4", 10], ["off", "E4", 40], ["on", "E4", 70], ["on", "G4", 500]],
        ["hit C4+E4", "hit G4"], []],

      ["counts the just completed column's key struck again after the window as a slip",
        [["C4"], ["E4"]],
        [["on", "C4", 0], ["off", "C4", 30], ["on", "C4", 1 + LATE_REPEAT_WINDOW]],
        ["hit C4", "miss E4"], ["E4"]],

      ["looks back only to the column just completed",
        [["C4"], ["E4"], ["G4"]],
        [["on", "C4", 0], ["on", "E4", 50], ["on", "C4", 100]],
        ["hit C4", "hit E4", "miss G4"], ["G4"]],

      // the key could be either: rule 2.3 comes first, so the next column
      // still needs it struck
      ["takes a key of both the column just completed and the next as struck again",
        [["C4"], ["E4"], ["C4"]],
        [["on", "C4", 0], ["on", "C4", 100], ["on", "E4", 150]],
        ["hit C4", "hit E4"], ["C4"]],

      ["credits nothing early and excuses nothing without timeStamps",
        [["C4"], ["E4"], ["G4"]],
        [["on", "E4"], ["on", "C4"], ["on", "C4"]],
        ["miss C4", "hit C4", "miss E4"], ["E4"]],
    ]

    for (let [what, columns, script, judged, left, opts] of rules) {
      it(what, function() {
        let matcher = matcherFor(columns, opts)
        expect(run(matcher, script)).toEqual(judged)
        expect(head(matcher)).toEqual(left)
      })
    }

    it("starts the spread of a column at its key credited early", function() {
      let matcher = matcherFor([["C4"], ["E4", "G4"], ["A4"]])
      run(matcher, [["on", "E4", 0], ["on", "C4", 100], ["on", "G4", 300]])

      let hits = matcher.judged.filter(event => event.type == "hit")
      expect(hits.map(event => [event.spread, event.early])).toEqual([[0, []], [300, ["E4"]]])
    })

    it("shows the keys credited early as touched at the column they complete", function() {
      let matcher = matcherFor([["C4"], ["E4", "G4"], ["A4"]])
      run(matcher, [["on", "E4", 0], ["on", "C4", 100]])

      expect(matcher.touched).toEqual({E4: true})
      expect(matcher.held).toEqual({E4: true, C4: true})
    })

    it("drops the keys held early and the column looked back to when it adopts another list", function() {
      let matcher = matcherFor([["C4"], ["E4"], ["G4"]])
      run(matcher, [["on", "C4", 0], ["on", "G4", 10]])

      let rebuilt = new NoteList([["E4"], ["G4"]], {generator: {nextNote: () => []}})
      matcher.setNotes(rebuilt)

      // C4 is no longer the column just completed, and the G4 held early
      // isn't credited to the new list's G4
      expect(run(matcher, [["on", "C4", 20], ["on", "E4", 50]])).toEqual(["miss E4", "hit E4"])
      expect(head(matcher)).toEqual(["G4"])
    })
  })

  it("holds an allowed ornament key without touching the column with it", function() {
    let matcher = matcherFor([ornamented(["C4", "E4"], ["D4"]), ["G4"]])
    run(matcher, [["on", "C4"], ["on", "D4"]])

    expect(matcher.held).toEqual({C4: true, D4: true})
    expect(matcher.touched).toEqual({C4: true})
  })

  // T6 of the note detection report, rule 1's held credit: a key the score
  // still sounds at a column's onset from an earlier one (column.sustained,
  // see extractSectionColumns), held rather than struck again, counts toward
  // the column (ruling D3(a)). It is credited lazily, when the next key goes
  // down or when it would complete the column, never before the column is
  // the head, and striking the key again counts as well
  describe("score-sustained credit (T6)", function() {
    let sustain = (column, ...notes) => Object.assign(column, {sustained: notes})

    // the Rêverie's left hand, from its bar 1 (see reverieOpening): Bb3 C4,
    // then Bb3 at beats 5.5 and 6, each still sounding from an earlier onset,
    // then C4 D4
    let reverie = () => [["Bb3"], ["C4"], sustain(["Bb3"], "Bb3"), sustain(["Bb3"], "Bb3"), ["C4"], ["D4"]]

    let rules = [
      ["credits a key the score still sounds, held, once the next key goes down",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500], ["off", "C4", 900], ["on", "C4", 1500]],
        ["hit Bb3", "hit C4", "hit Bb3 (held Bb3)", "hit Bb3 (held Bb3)", "hit C4"], ["D4"]],

      ["never credits a key held before the column is the head, nor as it becomes it",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500]],
        ["hit Bb3", "hit C4"], ["Bb3"]],

      // ruling D3(a): striking it again is accepted too, and the column after
      // it, which the key still sounds into, isn't credited in advance
      ["completes the column with the key struck again, with no slip",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500], ["off", "Bb3", 900], ["on", "Bb3", 1000],
          ["off", "Bb3", 1400], ["on", "Bb3", 1500], ["on", "C4", 2000]],
        ["hit Bb3", "hit C4", "hit Bb3", "hit Bb3", "hit C4"], ["D4"]],

      ["credits the key held when it is struck again for one column and held for the next",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500], ["off", "Bb3", 900], ["on", "Bb3", 1000], ["on", "C4", 2000]],
        ["hit Bb3", "hit C4", "hit Bb3", "hit Bb3 (held Bb3)", "hit C4"], ["D4"]],

      ["completes a column with its other keys struck while the sustained one is held",
        [["Bb3"], ["C4"], sustain(["Bb3", "D5"], "Bb3"), ["G4"]],
        [["on", "Bb3", 0], ["on", "C4", 500], ["on", "D5", 1000]],
        ["hit Bb3", "hit C4", "hit Bb3+D5 (held Bb3)"], ["G4"]],

      // the key held is the column's already, so a slip alongside it is
      // never blamed on it (its hand isn't the one that missed)
      ["blames a slip on the column's other keys, not the one it credits held",
        [["Bb3"], ["C4"], sustain(["Bb3", "D5"], "Bb3"), ["G4"]],
        [["on", "Bb3", 0], ["on", "C4", 500], ["on", "F4", 1000]],
        ["hit Bb3", "hit C4", "miss D5"], ["Bb3", "D5"]],

      ["credits nothing for a sustained key let up before the next key down",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500], ["off", "Bb3", 900], ["on", "D4", 1500]],
        ["hit Bb3", "hit C4", "miss Bb3"], ["Bb3"]],

      // the report's Nocturne C#4 at beats 9.5 and 10: the eighth ends as the
      // half is struck, so the score doesn't still sound it, and holding it
      // through still leaves the column waiting for it
      ["gives no credit to a repeated note the score strikes again, held through",
        [["C#3", "G#4"], ["C#4"], ["G#2", "C#4"], ["E4"]],
        [["on", "C#3", 0], ["on", "G#4", 0], ["on", "C#4", 750], ["on", "G#2", 1000], ["on", "E4", 1500]],
        ["hit C#3+G#4", "hit C#4"], ["G#2", "C#4"]],

      ["credits a wrong key's column held and judges the key at the column after it",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500], ["on", "F4", 1500]],
        ["hit Bb3", "hit C4", "hit Bb3 (held Bb3)", "hit Bb3 (held Bb3)", "miss C4"], ["C4"]],

      ["completes the next column from keys credited early and keys held",
        [["Bb3"], ["C4"], sustain(["Bb3", "E4"], "Bb3"), ["G4"]],
        [["on", "Bb3", 0], ["on", "E4", 400], ["on", "C4", 500]],
        ["hit Bb3", "hit C4", "hit Bb3+E4 (early E4) (held Bb3)"], ["G4"]],

      ["settles no held column on a key of the column just completed struck again",
        reverie(),
        [["on", "Bb3", 0], ["on", "C4", 500], ["off", "C4", 540], ["on", "C4", 600]],
        ["hit Bb3", "hit C4"], ["Bb3"]],
    ]

    for (let [what, columns, script, judged, left, opts] of rules) {
      it(what, function() {
        let matcher = matcherFor(columns, opts)
        expect(run(matcher, script)).toEqual(judged)
        expect(head(matcher)).toEqual(left)
      })
    }

    it("credits the stats with the key held, and times the column by its keys struck", function() {
      let matcher = matcherFor([["Bb3"], ["C4"], sustain(["Bb3", "D5"], "Bb3"), sustain(["Bb3"], "Bb3"), ["G4"]])
      run(matcher, [["on", "Bb3", 0], ["on", "C4", 500], ["on", "D5", 1000], ["on", "G4", 1500]])

      let hits = matcher.judged.filter(event => event.type == "hit")
      expect(hits.map(event => [[...event.hitNotes].sort(), event.heldCredit, event.spread])).toEqual([
        [["Bb3"], [], 0],
        [["C4"], [], 0],
        [["Bb3", "D5"], ["Bb3"], 0],
        // no key of it went down, so there is nothing to time
        [["Bb3"], ["Bb3"], null],
        [["G4"], [], 0],
      ])
    })

    it("credits a key held over to the head of a list it adopts, once the next key goes down", function() {
      let matcher = matcherFor([["Bb3"], ["C4"]])
      run(matcher, [["on", "Bb3", 0]])

      let rebuilt = new NoteList([sustain(["Bb3"], "Bb3"), ["C4"]], {generator: {nextNote: () => []}})
      matcher.setNotes(rebuilt)
      expect(head(matcher)).toEqual(["Bb3"])

      expect(run(matcher, [["on", "C4", 1000]])).toEqual(["hit Bb3 (held Bb3)", "hit C4"])
    })

    // a card of one column the key it holds sounds on through, looping: the
    // key goes on crediting every lap, so one key down settles one lap of
    // the list at most
    it("settles no more columns at one key down than the list holds", function() {
      let notes = new NoteList([], {generator: {nextNote: () => sustain(["Bb3"], "Bb3")}})
      notes.fillBuffer(3)
      let judged = []
      let matcher = new NoteMatcher(notes, {onEvent: event => judged.push(event)})
      matcher.judged = judged

      run(matcher, [["on", "Bb3", 0], ["on", "D4", 1000]])
      expect(judged.map(event => event.type)).toEqual(["hit", "hit", "hit", "hit", "miss"])
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
