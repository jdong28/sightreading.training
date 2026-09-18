import {parseMusicXML} from "st/musicxml"
import {extractSectionColumns} from "st/song_sections"
import {
  typeForBeats, columnUnit, columnAdvances, columnOffsets, columnSpan,
  columnExtras, tieArcs, stemDirection, MIN_COLUMN_ADVANCE,
} from "st/staff_rhythm"
import {reverieOpening} from "spec/helpers"

// the notation of a note, without the fields it leaves out
let notationOf = note => note.notation

// a column of an imported piece, as the staff lays it out
let column = (names, beat, beats) => {
  let out = [...names]
  out.beat = beat
  out.beats = beats
  out.extras = []
  return out
}

describe("staff rhythm", function() {
  describe("notated values", function() {
    it("spells a duration as the value the score writes it with", function() {
      expect(typeForBeats(4)).toEqual({type: "whole", dots: 0})
      expect(typeForBeats(2)).toEqual({type: "half", dots: 0})
      expect(typeForBeats(3)).toEqual({type: "half", dots: 1})
      expect(typeForBeats(1)).toEqual({type: "quarter", dots: 0})
      expect(typeForBeats(0.75)).toEqual({type: "eighth", dots: 1})
      expect(typeForBeats(0.5)).toEqual({type: "eighth", dots: 0})
      expect(typeForBeats(0.25)).toEqual({type: "16th", dots: 0})
      expect(typeForBeats(0)).toBe(null)

      // a length no value spells is drawn as the longest that fits
      expect(typeForBeats(1.1).type).toEqual("quarter")
    })
  })

  describe("the Rêverie opening", function() {
    let song

    beforeEach(function() {
      song = parseMusicXML(reverieOpening())
    })

    it("keeps the value, voice and stem of every note", function() {
      let ostinato = song.tracks[1]

      expect(notationOf(ostinato[0])).toEqual(jasmine.objectContaining({
        type: "eighth", voice: 5,
      }))
      expect(ostinato.slice(0, 7).map(note => note.notation.type))
        .toEqual(Array(7).fill("eighth"))

      // the second voice of the lower staff holds the bar with a whole note
      let whole = [...ostinato].find(note => note.notation.type == "whole")
      expect(whole.note).toEqual("Bb3")
      expect(whole.notation.voice).toEqual(6)

      // the right hand enters in bar 4 with two half notes
      let upper = song.tracks[0]
      expect([...upper].map(note => [note.note, note.notation.type]))
        .toEqual([["G5", "half"], ["D5", "half"]])
    })

    it("keeps the rests of each staff, the hidden ones marked", function() {
      let rests = song.tracks[0].rests

      expect(rests.map(rest => [rest.start, rest.duration, rest.type, !!rest.wholeMeasure]))
        .toEqual([[0, 2, "half", false], [2, 4, "whole", true], [6, 4, "whole", true]])
      expect(rests.every(rest => rest.hidden)).toBe(true)
    })

    it("merges a tie into one note to play and keeps the head it runs to", function() {
      // the last eighth of bar 2 is tied over the bar line into bar 3
      let tied = [...song.tracks[1]].find(note => note.start == 5.5)

      expect([tied.note, tied.duration]).toEqual(["Bb3", 1])
      expect(tied.notation.ties).toEqual([
        jasmine.objectContaining({start: 6, type: "eighth"}),
      ])
    })

    it("leaves the columns to play exactly as they are without the rhythm", function() {
      let columns = extractSectionColumns(song, {startMeasure: 2, endMeasure: 4, staves: true})

      // the seven onsets of bars 2 and 3, and the eight of bar 4 (see staves)
      expect(columns.length).toEqual(7 + 7 + 8)
      expect(columns.map(c => [...c])).toEqual(
        extractSectionColumns(song, {startMeasure: 2, endMeasure: 4}).map(c => [...c]))
    })

    it("carries the rhythm and the heads between the columns", function() {
      let columns = extractSectionColumns(song, {startMeasure: 2, endMeasure: 4, staves: true})

      expect(columns[0].beat).toEqual(2)
      expect(columns[0].notation.map(n => n.type)).toEqual(["eighth"])

      // the whole note of the second voice is the same pitch at the same
      // beat, so it isn't a column of its own but is still drawn
      expect(columns[0].extras.map(extra => [extra.kind, extra.name, extra.type]))
        .toEqual([["head", "Bb3", "whole"]])

      // the tie inside bar 2 hands its second head to the column it starts on
      let tieStart = columns.find(c => c.notation.some(n => n.tieTo != null))
      expect(tieStart.beat).toEqual(3.5)
      expect(tieStart.extras.map(extra => [extra.name, extra.beat, extra.from]))
        .toEqual([["G4", 4, 3.5]])
    })
  })

  describe("beat proportional columns", function() {
    // a 4/4 bar of a half note and two quarters
    let bar = () => [
      column(["C5"], 0, 4),
      column(["E5"], 2, 2),
      column(["G5"], 3, 1),
    ]

    it("measures a column width by the mean gap between the columns", function() {
      expect(columnUnit(bar())).toEqual(4 / 3)

      // the half note holds the staff for twice a quarter's room
      expect(columnAdvances(bar())).toEqual([1.5, 0.75, 0.75])
      expect(columnOffsets(bar())).toEqual([0, 1.5, 2.25])
      expect(columnSpan(bar())).toEqual(2.25)
    })

    it("draws a drill without the score's rhythm one column at a time", function() {
      let plain = [["C5"], ["E5"], ["G5"]]
      expect(columnUnit(plain)).toBe(null)
      expect(columnAdvances(plain)).toEqual([1, 1, 1])
      expect(columnSpan(plain)).toEqual(2)
    })

    it("never squeezes two heads closer than a head's room", function() {
      // a triplet in a section of eighths would be a third of a column apart
      let columns = [
        column(["C5"], 0, 4), column(["D5"], 2, 2),
        column(["E5"], 2 + 1 / 3, 2), column(["F5"], 2 + 2 / 3, 2),
      ]

      expect(columnAdvances(columns).slice(1))
        .toEqual([MIN_COLUMN_ADVANCE, MIN_COLUMN_ADVANCE, jasmine.any(Number)])
    })

    it("places the rests and tied heads between the columns", function() {
      let columns = bar()
      columns[0].extras = [{kind: "rest", beat: 1, staff: "upper", type: "quarter"}]

      let layout = {offsets: columnOffsets(columns), unit: columnUnit(columns)}
      let [rest] = columnExtras(columns, layout)

      // a beat into a column that holds the staff for two
      expect(rest.offset).toBeCloseTo(0.75, 6)
    })
  })

  describe("stems and ties", function() {
    it("turns a stem away from the middle line, or the way the score writes it", function() {
      expect(stemDirection([41], 41)).toEqual("up")
      expect(stemDirection([45], 41)).toEqual("down")
      expect(stemDirection([37], 41)).toEqual("up")
      expect(stemDirection([45], 41, {stem: "up"})).toEqual("up")
      expect(stemDirection([37], 41, {voicePosition: "lower"})).toEqual("down")
    })

    it("runs a tie off the card when the head it joins isn't on it", function() {
      let heads = [
        {beat: 0, name: "C5", x: 10, y: 5, stem: "up", tieTo: 2, tieFrom: null},
        {beat: 2, name: "C5", x: 90, y: 5, stem: "up", tieTo: 4, tieFrom: 0},
      ]

      let arcs = tieArcs(heads, 20)
      expect(arcs.map(arc => [arc.x1, arc.x2, arc.dir]))
        .toEqual([[10, 90, "down"], [90, 110, "down"]])
    })
  })
})
