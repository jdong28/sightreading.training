import {parseMusicXML} from "st/musicxml"
import {extractSectionColumns} from "st/song_sections"
import {
  typeForBeats, columnUnit, columnAdvances, columnOffsets, columnSpan,
  columnLayout, columnExtras, tieArcs, stemDirection,
  MIN_COLUMN_ADVANCE, SPACING_EXPONENT,
} from "st/staff_rhythm"

// the room a gap of that many mean gaps holds, in column widths
let room = gaps => Math.pow(gaps, SPACING_EXPONENT)
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

    it("spells a tuplet the score names no value for by the value it is written as", function() {
      // three eighths in the room of two, then a dotted half to fill the bar,
      // neither with a <type> of its own
      let song = parseMusicXML(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${["C", "D", "E"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`).join("")}
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>18</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`)

      // a triplet eighth is played a third of a beat but written as an eighth
      expect([...song.tracks[0]].map(note => note.notation.type))
        .toEqual(["eighth", "eighth", "eighth", "half"])
      expect([...song.tracks[0]].map(note => note.notation.tuplet || 1))
        .toEqual([1.5, 1.5, 1.5, 1])
      // and the value filling the rest of the bar keeps its dot
      expect(song.tracks[0][3].notation.dots).toEqual(1)
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

      // the half note holds more room than a quarter, but well under twice
      // it, the way an engraver spaces a system
      let [half, quarter] = columnAdvances(bar())
      expect(half).toBeCloseTo(room(1.5), 6)
      expect(quarter).toBeCloseTo(room(0.75), 6)
      expect(half).toBeGreaterThan(quarter)
      expect(half).toBeLessThan(2 * quarter)

      expect(columnOffsets(bar())).toEqual([0, half, half + quarter])
      expect(columnSpan(bar())).toBeCloseTo(half + quarter, 6)
    })

    it("never spans more room than the same number of even columns", function() {
      // the exponent is below one and the unit is the mean gap, so a card
      // always fits where a drill of the same column count fitted
      let columns = [
        column(["C5"], 0, 4), column(["D5"], 4, 4), column(["E5"], 5, 3),
        column(["F5"], 5.5, 2.5), column(["G5"], 6, 2),
      ]

      expect(columnSpan(columns)).toBeLessThanOrEqual(columns.length - 1)
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

    it("gives a looping card's wrap back to its start the room that column holds", function() {
      // a bar of four quarters drilled on a loop: its first column is drawn
      // again where the loop comes round (drillColumns in st/measure_cards),
      // and the beats of the section left after it are not its own gap
      let quarters = [
        column(["C5"], 0, 4), column(["D5"], 1, 3),
        column(["E5"], 2, 2), column(["F5"], 3, 1),
      ]
      let looped = [...quarters, quarters[0]]

      // every gap of the bar is a beat, so a column width is a beat and each
      // column holds exactly one of them, the wrap included
      expect(columnUnit(looped)).toEqual(1)
      expect(columnAdvances(looped)).toEqual([1, 1, 1, 1, 1])
      expect(columnAdvances(quarters, looped)).toEqual([1, 1, 1, 1])
    })

    it("places the rests and tied heads in the room their column holds", function() {
      let columns = bar()
      columns[0].extras = [{kind: "rest", beat: 1, staff: "upper", type: "quarter"}]

      let layout = columnLayout(columns)
      let [rest] = columnExtras(columns, layout)

      // one of the column's two beats in, so half of the room it holds
      expect(rest.offset).toBeCloseTo(layout.advances[0] / 2, 6)
    })

    it("keeps an extra falling before the first column on the staff", function() {
      // a card whose bar opens with a rest: the first head is a beat into the
      // bar, and the staff has no room before it, where the clef and the key
      // signature are
      let columns = [column(["C5"], 1, 3), column(["E5"], 2, 2)]
      columns[0].extras = [{kind: "rest", beat: 0, staff: "upper", type: "quarter"}]

      let [rest] = columnExtras(columns, columnLayout(columns))
      expect(rest.offset).toEqual(0)
    })
  })

  describe("stems and ties", function() {
    it("turns a stem away from the middle line, and away from the other voice", function() {
      expect(stemDirection([41], 41)).toEqual("down")
      expect(stemDirection([45], 41)).toEqual("down")
      expect(stemDirection([37], 41)).toEqual("up")

      // the furthest note of a chord decides for the whole group
      expect(stemDirection([37, 40], 41)).toEqual("up")

      expect(stemDirection([37], 41, {voicePosition: "lower"})).toEqual("down")
      expect(stemDirection([45], 41, {voicePosition: "upper"})).toEqual("up")
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
