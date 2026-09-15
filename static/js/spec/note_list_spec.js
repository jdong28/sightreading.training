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
})
