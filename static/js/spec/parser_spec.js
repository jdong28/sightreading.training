import SongParser, {shiftNotationOctaves} from "st/song_parser"
import {parseNote} from "st/music"
import {SongNoteList, SongNote} from "st/song_note_list"

let stripIds = notes =>
  notes.map(n => Object.assign({}, n, {id: undefined}))

let matchNotes = (have, expected) =>
  expect(stripIds([...have])).toEqual(stripIds(expected))

describe("song parser", function() {
  it("parses single note song", function() {
    expect(new SongParser().parse("a4")).toEqual([
      ["note", "A4"]
    ])
  })

  it("parses single note song with some whitespace", function() {
    expect(new SongParser().parse(`
      a4
    `)).toEqual([
      ["note", "A4"]
    ])
  })

  it("parses notes with timing information", function() {
    expect(new SongParser().parse(`
      g3 a4.1 b1 f2.1.2
    `)).toEqual([
      ["note", "G3"],
      ["note", "A4", { duration: 1 }],
      ["note", "B1"],
      ["note", "F2", { duration: 1, start: 2 }]
    ])
  })

  it("parses rests and notes", function() {
    expect(new SongParser().parse("g3.1 r2 a3.3 r b1")).toEqual([
      ["note", "G3", {duration: 1}],
      ["rest", {duration: 2}],
      ["note", "A3", {duration: 3}],
      ["rest"],
      ["note", "B1"],
    ])
  })

  it("parses key signature", function() {
    expect(new SongParser().parse("ks-4 g4 ks2 d5")).toEqual([
      ["keySignature", -4],
      ["note", "G4"],
      ["keySignature", 2],
      ["note", "D5"],
    ])
  })

  it("parses time adjustments", function() {
    expect(new SongParser().parse("ht ht dt dt m1 m2 ht")).toEqual([
      ["halfTime"],
      ["halfTime"],
      ["doubleTime"],
      ["doubleTime"],
      ["measure", 1],
      ["measure", 2],
      ["halfTime"],
    ])
  })

  it("parses accidental", function() {
    expect(new SongParser().parse(`
      a+4
      a-4
      a=4
    `)).toEqual([
      ["note", "A4", {sharp: true}],
      ["note", "A4", {flat: true}],
      ["note", "A4", {natural: true}],
    ])
  })

  it("parses a block", function() {
    expect(new SongParser().parse(`
      m1 {
        a4
      }
    `)).toEqual([
      ["measure", 1],
      ["block", [
        ["note", "A4"]
      ]],
    ])
  })

  it("ignores a comment", function() {
    expect(new SongParser().parse(`
      # this is comment
      a4 c4 # a good one

      #more comment

      b5 #a5
    `)).toEqual([
      ["note", "A4"],
      ["note", "C4"],
      ["note", "B5"],
    ])
  })

  it("parses time signature", function() {
    expect(new SongParser().parse(`
      ts4/4
      ts3/4
      ts6/8
    `)).toEqual([
      ["timeSignature", 4, 4],
      ["timeSignature", 3, 4],
      ["timeSignature", 6, 8],
    ])
  })


  it("parses macro", function() {
    expect(new SongParser().parse(`
      $hello $w $cm7
    `)).toEqual([
      ["macro", "hello"],
      ["macro", "w"],
      ["macro", "cm7"],
    ])

  })
})

describe("load song", function() {
  it("loads empty song", function() {
    let song = SongParser.load("ks0")
    expect([...song]).toEqual([])
  })

  it("loads some notes", function() {
    let song = SongParser.load(`
      ks1
      b5 a5 g5 a5
      b5 b5 b5.2
      a5 a5 a5.2
    `)

    matchNotes(song, [
      new SongNote("B5", 0, 1),
      new SongNote("A5", 1, 1),
      new SongNote("G5", 2, 1),
      new SongNote("A5", 3, 1),

      new SongNote("B5", 4, 1),
      new SongNote("B5", 5, 1),
      new SongNote("B5", 6, 2),

      new SongNote("A5", 8, 1),
      new SongNote("A5", 9, 1),
      new SongNote("A5", 10, 2),
    ])
  })

  it("loads some notes with rests", function() {
    let song = SongParser.load(`
      r1 g4 r2 a4 r3 r1.1 f5
    `)

    matchNotes(song, [
      new SongNote("G4", 1, 1),
      new SongNote("A4", 4, 1),
      new SongNote("F5", 8, 1),
    ])
  })

  it("loads notes with timing", function() {
    let song = SongParser.load(`
      dt
      m0 c4 c4 c4
      m0 g4 a4 g4
      ht
      m1 c5
    `)

    matchNotes(song, [
      // first measure
      new SongNote("C4", 0, 0.5),
      new SongNote("C4", 0.5, 0.5),
      new SongNote("C4", 1.0, 0.5),

      new SongNote("G4", 0, 0.5),
      new SongNote("A4", 0.5, 0.5),
      new SongNote("G4", 1.0, 0.5),

      // second measure
      new SongNote("C5", 4, 1),
    ])
  })

  it("sets position and time correctly when using half and double time", function() {
    let song = SongParser.load(`
      ht
      a4.2
      dt
      b4.2
      dt
      c4.2
      c4
      dt
      g4

      m2
      a4
    `)

    matchNotes(song, [
      new SongNote("A4", 0, 4),
      new SongNote("B4", 4, 2),
      new SongNote("C4", 6, 1),
      new SongNote("C4", 7, 0.5),
      new SongNote("G4", 7.5, 0.25),
      new SongNote("A4", 8, 0.25),
    ])
  })

  it("parses keysignature into metadata", function() {
    let song = SongParser.load(`
      ks-5
      c4
    `)

    expect(song.metadata).toEqual({
      keySignature: -5,
      beatsPerMeasure: 4,
    })
  })

  it("applies key signature to notes", function() {
    let song = SongParser.load(`
      ks2
      c4
      d4
      e4
      f4
      g4
      a4
      b4
    `)

    matchNotes(song, [
      new SongNote("C#4", 0, 1),
      new SongNote("D4", 1, 1),
      new SongNote("E4", 2, 1),
      new SongNote("F#4", 3, 1),
      new SongNote("G4", 4, 1),
      new SongNote("A4", 5, 1),
      new SongNote("B4", 6, 1),
    ])

    let song2 = SongParser.load(`
      ks-2
      c4
      d4
      e4
      f4
      g4
      a4
      b4
    `)

    matchNotes(song2, [
      new SongNote("C4", 0, 1),
      new SongNote("D4", 1, 1),
      new SongNote("Eb4", 2, 1),
      new SongNote("F4", 3, 1),
      new SongNote("G4", 4, 1),
      new SongNote("A4", 5, 1),
      new SongNote("Bb4", 6, 1),
    ])
  })


  it("sets position when using blocks", function() {
    let song = SongParser.load(`
      {
        dt
        a4
        a4.2
      }
      g5
    `)

    matchNotes(song, [
      new SongNote("A4", 0, 0.5),
      new SongNote("A4", 0.5, 1),
      new SongNote("G5", 1.5, 1),
    ])
  })

  it("renders a chord with restore position", function() {
    let song = SongParser.load(`
      c4 | e4 | g4
      a5
    `)

    matchNotes(song, [
      new SongNote("C4", 0, 1),
      new SongNote("E4", 0, 1),
      new SongNote("G4", 0, 1),
      new SongNote("A5", 1, 1),
    ])
  })

  it("loads song with 3/4 time", function() {
    let song = SongParser.load(`
      ts3/4
      m0 {
        c4
        d4.2
        |
        g3.3
      }

      m1 {
        e4
        d4
        c4
      }
    `)

    matchNotes(song, [
      new SongNote("C4", 0, 1),
      new SongNote("D4", 1, 2),
      new SongNote("G3", 0, 3),

      new SongNote("E4", 3, 1),
      new SongNote("D4", 4, 1),
      new SongNote("C4", 5, 1),
    ])
  })

  it("loads song with 6/8 time", function() {
    let song = SongParser.load(`
      ts6/8
      m0 {
        c4
        d4.2
        |
        g3.3
      }

      m1 {
        c5
      }
    `)

    matchNotes(song, [
      new SongNote("C4", 0, 0.5),
      new SongNote("D4", 0.5, 1),
      new SongNote("G3", 0, 1.5),

      new SongNote("C5", 3, 0.5),
    ])
  })

  it("loads song with autochords", function() {
    let song = SongParser.load(`
      ts6/8
      m0 $g
      m1 $bbm
    `)

    expect(song.metadata.beatsPerMeasure).toEqual(3)
    expect(song.autoChords).toEqual([
      [0, ["G", "M"]],
      [3, ["Bb", "m"]],
    ])
  })
})

describe("shiftNotationOctaves", function() {
  let notes = (text) => {
    let out = []
    let collect = commands => {
      for (let command of commands) {
        if (command[0] == "note") { out.push(command) }
        if (command[0] == "block") { collect(command[1]) }
      }
    }
    collect(new SongParser().parse(text))
    return out
  }

  it("moves every note an octave and nothing else", function() {
    let text = `
      ts3/4 ks-2 # c5 in a comment stays
      m0 {$g c5.2 a+5 d-5.1.2}
      m1 {
        dt e5 | {ht g=4} r2 B6
      }
      t1 c9 c0
    `

    let shifted = shiftNotationOctaves(text, -1)

    expect(shifted).toContain("# c5 in a comment stays")
    expect(shifted).toContain("ts3/4 ks-2")
    expect(shifted).toContain("{$g c4.2 a+4 d-4.1.2}")
    expect(shifted).toContain("dt e4 | {ht g=3} r2 B5")
    // c0 has no octave below it
    expect(shifted).toContain("t1 c8 c0")

    let before = notes(text)
    let after = notes(shifted)
    expect(after.length).toEqual(before.length)
    after.forEach(([, name, opts], idx) => {
      let [, oldName, oldOpts] = before[idx]
      if (oldName != "C0") {
        expect(parseNote(name)).toEqual(parseNote(oldName) - 12)
      }
      expect(opts).toEqual(oldOpts)
    })
  })
})
