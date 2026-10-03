import NoteStats from "st/note_stats"
import {GOOD, HARD} from "st/srs/grade"

describe("note stats", function() {
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
})
