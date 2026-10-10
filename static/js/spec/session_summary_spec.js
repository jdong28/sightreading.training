import {TROUBLE_ACCURACY, TROUBLE_ROWS, troubleNotes, focusFromRows} from "st/session_summary"

describe("the notes a session gave trouble", function() {
  it("picks out the notes with misses, worst accuracy first", function() {
    let rows = troubleNotes({
      notes: {C: {hits: 9, misses: 1}, "F#": {hits: 2, misses: 3}, G: {hits: 5, misses: 0}},
    })
    expect(rows.map(r => [r.note, r.accuracy, r.weak])).toEqual([
      ["F#", 40, true],
      ["C", 90, false],
    ])
  })

  it("calls a note weak below 75%", function() {
    expect(TROUBLE_ACCURACY).toEqual(75)
    // 3 of 4 = 75% exactly: not weak
    expect(troubleNotes({notes: {C: {hits: 3, misses: 1}}})[0].weak).toBe(false)
    // 37 of 50 = 74%: weak
    expect(troubleNotes({notes: {C: {hits: 37, misses: 13}}})[0].weak).toBe(true)
  })

  it("keeps only the worst four, ties broken by more misses then note name", function() {
    let notes = {}
    ;["A", "B", "C", "D", "E", "F"].forEach((note, idx) => {
      notes[note] = {hits: 9 - idx, misses: idx + 1}
    })
    expect(TROUBLE_ROWS).toEqual(4)
    expect(troubleNotes({notes}).map(r => r.note)).toEqual(["F", "E", "D", "C"])

    let tied = troubleNotes({notes: {
      D: {hits: 1, misses: 1}, B: {hits: 2, misses: 2}, C: {hits: 1, misses: 1},
    }})
    expect(tied.map(r => r.note)).toEqual(["B", "C", "D"])
  })

  it("has no rows without any missed note", function() {
    expect(troubleNotes({notes: {}})).toEqual([])
    expect(troubleNotes({notes: {C: {hits: 5, misses: 0}}})).toEqual([])
  })

  // a hit is named from the pitch played (always sharp), a miss by the
  // written column (flat in a flat key), so one note holds two keys
  it("adds up the spellings of one pitch class, labelled the way it was missed", function() {
    let rows = troubleNotes({notes: {Bb: {hits: 0, misses: 3}, "A#": {hits: 10, misses: 0}}})
    expect(rows.length).toEqual(1)
    expect(rows[0].note).toEqual("Bb")
    expect(rows[0].hits).toEqual(10)
    expect(rows[0].misses).toEqual(3)
    expect(rows[0].accuracy).toEqual(77)
    expect(rows[0].weak).toBe(false)
  })

  it("labels a merged row with the sharp spelling when that is the missed one", function() {
    let rows = troubleNotes({notes: {Gb: {hits: 4, misses: 0}, "F#": {hits: 0, misses: 4}}})
    expect(rows.map(r => [r.note, r.accuracy])).toEqual([["F#", 50]])
  })

  it("merges Cb with B, the enharmonic a flat key writes", function() {
    let rows = troubleNotes({notes: {Cb: {hits: 1, misses: 1}, B: {hits: 1, misses: 1}}})
    expect(rows.length).toEqual(1)
    expect(rows[0].misses).toEqual(2)
    expect(rows[0].accuracy).toEqual(50)
  })

  it("seeds a focus from the weak rows alone", function() {
    let rows = troubleNotes({notes: {"F#": {hits: 2, misses: 3}, Bb: {hits: 1, misses: 1}}})
    expect(focusFromRows(rows)).toEqual({"F#": true, Bb: true})

    // C is shown (it has a miss) but read at 90%, above the weak line, so
    // the seed leaves it out
    let mixed = troubleNotes({notes: {"F#": {hits: 2, misses: 3}, C: {hits: 9, misses: 1}}})
    expect(mixed.map(r => r.note)).toEqual(["F#", "C"])
    expect(focusFromRows(mixed)).toEqual({"F#": true})

    expect(focusFromRows(troubleNotes({notes: {C: {hits: 9, misses: 1}}}))).toEqual({})
  })
})
