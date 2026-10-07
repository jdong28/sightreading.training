import NoteStats, {staffClefs} from "st/note_stats"
import {GOOD, HARD} from "st/srs/grade"

describe("note stats", function() {
  describe("streak", function() {
    it("counts a run of hits, resets on a miss, and never breaks on a slip", function() {
      let stats = new NoteStats()

      stats.hitNotes(["C4"])
      stats.hitNotes(["D4"])
      stats.hitNotes(["E4"])
      expect(stats.streak).toEqual(3)
      expect(stats.bestStreak).toEqual(3)

      stats.missNotes(["F4"])
      expect(stats.streak).toEqual(0)
      expect(stats.bestStreak).toEqual(3)
      expect(stats.misses).toEqual(1)

      stats.slipNotes(["F4"])
      expect(stats.streak).toEqual(0)
      expect(stats.bestStreak).toEqual(3)
      expect(stats.misses).toEqual(1)

      stats.hitNotes(["F4"])
      expect(stats.streak).toEqual(1)
      expect(stats.bestStreak).toEqual(3)
    })
  })

  describe("sessionRecord", function() {
    it("carries the session clock only when given one", function() {
      let stats = new NoteStats()
      stats.hitNotes(["C4"])

      let record = stats.sessionRecord({elapsedSeconds: 95.7})
      expect(record.elapsedSeconds).toEqual(95)

      let withoutClock = stats.sessionRecord()
      expect("elapsedSeconds" in withoutClock).toBe(false)

      expect(stats.sessionRecord({elapsedSeconds: -5}).elapsedSeconds).toEqual(0)
    })
  })

  // acoustic mode: a self-graded pass is never detected, so selfGraded is
  // the session's only record of it (see MeasureCardGenerator#selfGrade)
  describe("self-graded passes", function() {
    it("counts passes and clean passes, making a session record with no notes read", function() {
      let stats = new NoteStats()
      expect(stats.sessionRecord()).toBe(null)

      stats.selfGraded(GOOD, 1000)
      expect(stats.passes).toEqual(1)
      expect(stats.cleanPasses).toEqual(1)

      let record = stats.sessionRecord()
      expect(record).not.toBe(null)
      expect(record.selfGraded).toEqual({passes: 1, clean: 1})
      expect(record.startedAt).toEqual(1000)
      expect(record.notesRead).toEqual(0)
      expect(record.misses).toEqual(0)

      stats.selfGraded(HARD, 2000)
      expect(stats.passes).toEqual(2)
      expect(stats.cleanPasses).toEqual(1)
      expect(stats.sessionRecord().selfGraded).toEqual({passes: 2, clean: 1})
      expect(stats.sessionRecord().endedAt).toEqual(2000)
    })
  })

  // the clefs a clefless column (the exercises page, see
  // SightReadingPage#applyEvent) is counted under, by the staff it was read
  // on; complementary to a score column's own clefs (columnClefs)
  describe("staffClefs", function() {
    it("reads a single-hand staff straight, and splits the grand staff at middle C", function() {
      expect(staffClefs("treble", ["G4"])).toEqual(["g"])
      expect(staffClefs("bass", ["F3"])).toEqual(["f"])
      expect(staffClefs("grand", ["C4"])).toEqual(["g"])
      expect(staffClefs("grand", ["B3"])).toEqual(["f"])
      expect(staffClefs("grand", ["C3", "E5"])).toEqual(["f", "g"])
      expect(staffClefs("chord", ["C4"])).toEqual([])
      expect(staffClefs(undefined, ["C4"])).toEqual([])
    })
  })
})
