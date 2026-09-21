import NoteList from "st/note_list"

describe("NoteList", function() {

  describe("matchesHead", function() {
    it("matches with singular notes", function () {
      const notes = new NoteList([
        "D4",
        "C4",
      ])

      expect(notes.matchesHead(["D4"])).toBe(true)
      expect(notes.matchesHead(["D5"])).toBe(false)
      expect(notes.matchesHead(["C4"])).toBe(false)

      // singular notes wrapped in array
      const notes2 = new NoteList([
        ["D4"],
        ["C4"],
      ])

      expect(notes2.matchesHead(["D4"])).toBe(true)
      expect(notes2.matchesHead(["C4"])).toBe(false)

      const enharmonic = new NoteList([ "C#3" ])
      expect(enharmonic.matchesHead(["Db3"])).toBe(true)

      const enharmonic2 = new NoteList([ "Bb3" ])
      expect(enharmonic2.matchesHead(["A#3"])).toBe(true)

      // wrapped
      const enharmonic3 = new NoteList([ ["C#3"] ])
      expect(enharmonic3.matchesHead(["Db3"])).toBe(true)

      const enharmonic4 = new NoteList([ ["Bb3"] ])
      expect(enharmonic4.matchesHead(["A#3"])).toBe(true)

    })

    it("matches with multiple notes", function () {
      const notes = new NoteList([
        ["D4", "C4"],
      ])

      expect(notes.matchesHead(["C4"])).toBe(false)
      expect(notes.matchesHead(["C4", "D4"])).toBe(true)
      expect(notes.matchesHead(["D4", "C4"])).toBe(true)
      expect(notes.matchesHead(["D5", "C4"])).toBe(false)
    })

    it("matches with other keys touched besides the head", function () {
      const notes = new NoteList([
        ["D4", "C4"],
        ["E4"],
      ])

      expect(notes.matchesHead(["C#4", "C4", "D4"])).toBe(true)
      expect(notes.matchesHead(["C#4", "C4"])).toBe(false)
      expect(notes.matchesHead(["E4", "D5"], true)).toBe(false)
      expect(notes.matchesHead(["C5", "D5", "F4"], true)).toBe(true)

      const single = new NoteList(["D4"])
      expect(single.matchesHead(["C4", "D4"])).toBe(true)
      expect(single.matchesHead(["C4"])).toBe(false)
    })

    it("never matches an empty head column", function () {
      const notes = new NoteList([[], ["C4"]])
      expect(notes.matchesHead([])).toBe(false)
      expect(notes.matchesHead(["C4"])).toBe(false)
    })

    it("matches with singular notes, anyOctave", function () {
      const notes = new NoteList([
        "D4",
        "C4",
      ])

      expect(notes.matchesHead(["D4"], true)).toBe(true)
      expect(notes.matchesHead(["D5"], true)).toBe(true)
      expect(notes.matchesHead(["C4"], true)).toBe(false)

      // singular notes wrapped in array
      const notes2 = new NoteList([
        ["D4"],
        ["C4"],
      ])

      expect(notes2.matchesHead(["D4"], true)).toBe(true)
      expect(notes2.matchesHead(["D5"], true)).toBe(true)
      expect(notes2.matchesHead(["C4"], true)).toBe(false)
    })

  })

  describe("strayNotes", function() {
    it("lists the keys touched that aren't in the head column", function () {
      const notes = new NoteList([
        ["D4", "C4"],
        ["E4"],
      ])

      expect(notes.strayNotes(["C4", "D4"])).toEqual([])
      expect(notes.strayNotes(["C#4", "C4", "E4"])).toEqual(["C#4", "E4"])
      expect(notes.strayNotes(["Db4", "C4"])).toEqual(["Db4"])
      expect(notes.strayNotes(["C5", "D3", "F4"], true)).toEqual(["F4"])
    })
  })

  describe("blamedNotes", function() {
    it("blames the head's notes not touched, else those nearest the stray keys", function () {
      const notes = new NoteList([
        ["C3", "E5"],
      ])

      expect(notes.blamedNotes(["C3", "D5"])).toEqual(["E5"])
      expect(notes.blamedNotes(["D5"])).toEqual(["C3", "E5"])
      expect(notes.blamedNotes(["C3", "E5", "D5"])).toEqual(["E5"])
      expect(notes.blamedNotes(["C3", "E5", "B2"])).toEqual(["C3"])
      expect(notes.blamedNotes(["C3", "E5"])).toEqual(["C3", "E5"])
      expect(notes.blamedNotes(["C4", "E4"], true)).toEqual(["C3", "E5"])
      expect(notes.blamedNotes(["C4", "E4", "D5"], true)).toEqual(["E5"])
    })
  })
})
