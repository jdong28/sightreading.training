import SongParser from "st/song_parser"
import {SongNoteList, MultiTrackSong, SongNote} from "st/song_note_list"

import {
  extractSectionColumns, measureBeatRange, countMeasures, filterColumnsToRange,
  parseSongText, staffTracks
} from "st/song_sections"
import {parseMusicXML} from "st/musicxml"
import {noteXML, nocturneBars5to6, tiedTrillScore} from "spec/helpers"

import {
  SheetMusicGenerator, generatorDefaultSettings, storeGeneratorSettings,
  storeCurrentDrill, currentStaffFor, currentGeneratorFor, DRILL_STORAGE_KEY,
  currentKeySignature, currentDrillMode, currentScrollSpeed,
} from "st/generators"
import {sheetMusicSection} from "st/data"
import NoteList from "st/note_list"
import NoteMatcher from "st/note_matcher"

describe("song sections", function() {
  // two measures of 4/4, two tracks
  const twoHands = `
    t0 m0 c4 e4 g4 c5
    t1 m0 c2.2 g2.2
    t0 m1 d4 f4 a4 d5
    t1 m1 d2.4
  `

  const staff = {name: "grand", range: ["C2", "C6"]}

  it("groups notes with equal onsets into one ascending column", function() {
    let song = SongNoteList.newSong([
      ["G4", 0, 1],
      ["C4", 0, 1],
      ["E4", 0, 1],
      ["D4", 1, 1],
    ])

    song.metadata = {beatsPerMeasure: 4}

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
      ["C4", "E4", "G4"],
      ["D4"],
    ])
  })

  it("quantizes near equal onsets and dedupes pitches", function() {
    let song = SongNoteList.newSong([
      ["C4", 0, 1],
      ["E4", 0.0001, 1],
      ["C4", 0, 2], // duplicate pitch
      ["Db4", 1/3 + 2/3, 1], // floating error lands on beat 1
      ["C#4", 1, 1], // same pitch, different spelling
    ])

    song.metadata = {beatsPerMeasure: 4}

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
      ["C4", "E4"],
      ["Db4"],
    ])
  })

  it("respects measure range boundaries", function() {
    let song = SongParser.load(twoHands)
    expect(song.metadata.beatsPerMeasure).toEqual(4)

    expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 2})).toEqual([
      ["D2", "D4"],
      ["F4"],
      ["A4"],
      ["D5"],
    ])

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
      ["C2", "C4"],
      ["E4"],
      ["G2", "G4"],
      ["C5"],
    ])

    // ranges past the end of the song yield nothing
    expect(extractSectionColumns(song, {startMeasure: 3, endMeasure: 10})).toEqual([])

    // both measures
    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 2}).length).toEqual(8)
  })

  it("filters by track", function() {
    let song = SongParser.load(twoHands)

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 2, track: 1})).toEqual([
      ["C2"],
      ["G2"],
      ["D2"],
    ])

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1, track: 0})).toEqual([
      ["C4"], ["E4"], ["G4"], ["C5"],
    ])

    // missing track has no notes
    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 2, track: 5})).toEqual([])
  })

  it("returns empty for empty or inverted ranges", function() {
    let song = SongParser.load(twoHands)
    expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 1})).toEqual([])
    expect(extractSectionColumns(new MultiTrackSong(), {startMeasure: 1, endMeasure: 4})).toEqual([])
  })

  it("uses explicit measure starts when present", function() {
    let song = SongNoteList.newSong([
      ["C4", 0, 1],
      ["D4", 3, 1],
      ["E4", 7, 1],
    ])

    // measures of 3 then 4 beats
    song.metadata = {beatsPerMeasure: 4, measureStarts: [0, 3, 7]}

    expect(measureBeatRange(song, 1, 1)).toEqual([0, 3])
    expect(measureBeatRange(song, 2, 3)).toEqual([3, Infinity])
    expect(countMeasures(song)).toEqual(3)

    expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 2})).toEqual([["D4"]])
  })

  it("counts measures", function() {
    let song = SongParser.load(twoHands)
    expect(countMeasures(song)).toEqual(2)

    let partial = SongParser.load("ts3/4 c4 d4 e4 f4")
    expect(countMeasures(partial)).toEqual(2)

    expect(countMeasures(new MultiTrackSong())).toEqual(0)
  })

  it("filters columns to a pitch range", function() {
    let [columns, dropped] = filterColumnsToRange([
      ["C2", "C4"],
      ["A1"],
      ["E4"],
    ], "C3", "C6")

    expect(columns).toEqual([["C4"], ["E4"]])
    expect(dropped).toEqual(["C2", "A1"])
  })

  // T7: the ornaments a player may add at a column without a slip
  describe("ornament allowances", function() {
    let allowances = columns => columns.map(column => [[...column], column.allowed || null])

    it("allows the Nocturne's trill over every column it sounds at, and its grace notes at their note's", function() {
      let song = parseMusicXML(nocturneBars5to6())

      for (let notation of [false, true]) {
        let columns = extractSectionColumns(song, {startMeasure: 1, endMeasure: 2, notation})
        expect(allowances(columns).slice(3, 10)).toEqual([
          [["C#4"], null],
          // the trill on F#5 with its upper note, G#5: F#5 itself is required
          // where it is struck, allowed again while it sounds
          [["C#3", "F#5"], ["G#5"]],
          [["A3"], ["F#5", "G#5"]],
          [["D#4"], ["F#5", "G#5"]],
          [["C#4"], ["F#5", "G#5"]],
          // the grace notes E5 and F#5 into G#5
          [["C#3", "G#5"], ["E5", "F#5"]],
          [["G#3"], null],
        ])
        expect(columns.filter(column => column.allowed).length).toEqual(5)
      }

      // the right hand alone allows the same
      let right = extractSectionColumns(song, {startMeasure: 1, endMeasure: 2, track: staffTracks(song).treble})
      expect(allowances(right)).toEqual([
        [["G#5"], null], [["F#5"], ["G#5"]], [["G#5"], ["E5", "F#5"]], [["C#5"], null],
      ])
    })

    // 4/4, C major: a whole note C5 carrying one ornament over the left
    // hand's quarters G3 A3 B3 C4
    let heldOrnament = marks => parseMusicXML(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${noteXML("C", 5, 4, 1, `<voice>1</voice><notations><ornaments>${marks}</ornaments></notations>`)}
      <backup><duration>4</duration></backup>
      ${["G", "A", "B"].map(step => noteXML(step, 3, 1, 2, "<voice>5</voice>")).join("")}
      ${noteXML("C", 4, 1, 2, "<voice>5</voice>")}
    </measure>
  </part>
</score-partwise>`)

    let heldColumns = marks =>
      extractSectionColumns(heldOrnament(marks), {startMeasure: 1, endMeasure: 1, notation: true})

    it("allows the ornamented note again at every column past its own onset", function() {
      // an ornament returns to the note it is written on, so C5 is allowed
      // wherever it sounds but the column that requires it
      expect(allowances(heldColumns("<mordent/>"))).toEqual([
        [["G3", "C5"], ["B4"]], [["A3"], ["B4", "C5"]], [["B3"], ["B4", "C5"]], [["C4"], ["B4", "C5"]],
      ])

      expect(allowances(heldColumns("<trill-mark/>"))).toEqual([
        [["G3", "C5"], ["D5"]], [["A3"], ["C5", "D5"]], [["B3"], ["C5", "D5"]], [["C4"], ["C5", "D5"]],
      ])
    })

    it("counts no slip for a mordent played as written across the next column", function() {
      let columns = heldColumns("<mordent/>")
      let queued = [...columns]
      let notes = new NoteList([], {generator: {nextNote: () => queued.shift() || []}})
      notes.fillBuffer(columns.length)

      let judged = []
      let matcher = new NoteMatcher(notes, {onEvent: event => judged.push(event)})

      // the first column played, then the mordent's B4 and its return to C5
      // over the A3 the left hand has moved on to
      matcher.noteOn("G3")
      matcher.noteOn("C5")
      matcher.noteOff("G3")
      matcher.noteOff("C5")
      matcher.noteOn("B4")
      matcher.noteOff("B4")
      matcher.noteOn("C5")

      expect(judged.map(event => event.type)).toEqual(["hit"])
      expect([...matcher.notes.currentColumn()]).toEqual(["A3"])
    })

    it("allows a trill written on a tie's continuation only from that continuation on", function() {
      let columns = extractSectionColumns(parseMusicXML(tiedTrillScore()),
        {startMeasure: 1, endMeasure: 2, notation: true})

      // bar 1 holds the same C5 but writes no trill, so nothing is allowed
      // there; from bar 2 the trill allows its upper note and the C5 it
      // strikes again
      expect(allowances(columns)).toEqual([
        [["G3", "C5"], null], [["A3"], null], [["B3"], null], [["C4"], null],
        [["G3"], ["C5", "D5"]], [["A3"], ["C5", "D5"]], [["B3"], ["C5", "D5"]], [["C4"], ["C5", "D5"]],
      ])
    })

    it("keeps a column's allowances through the range filter and the generator's copies", function() {
      let column = Object.assign(["C2", "C4"], {allowed: ["D4"]})
      let [[kept]] = filterColumnsToRange([column], "C3", "C6")
      expect(allowances([kept])).toEqual([[["C4"], ["D4"]]])

      let g = new SheetMusicGenerator([kept])
      expect(g.nextNote().allowed).toEqual(["D4"])
    })
  })

  it("parses song text and reports errors", function() {
    expect(parseSongText("").song).toBeNull()
    expect(parseSongText("c4 d4").song.length).toEqual(2)

    let bad = parseSongText("c4 ??")
    expect(bad.song).toBeNull()
    expect(bad.error).toBeTruthy()
  })

  describe("score staves", function() {
    // 4/4 on a grand staff, a chord across the staves then a bass note; the
    // lower staff changes to treble clef in measure 2
    const clefChange = parseMusicXML(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${noteXML("E", 5, 4, 1)}
      <backup><duration>4</duration></backup>
      ${noteXML("C", 3, 2, 2)}
      ${noteXML("G", 3, 2, 2)}
    </measure>
    <measure number="2">
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      ${noteXML("E", 5, 4, 1)}
      <backup><duration>4</duration></backup>
      ${noteXML("C", 4, 4, 2)}
    </measure>
  </part>
</score-partwise>`)

    it("carries the staff of each note and the clefs at each onset of an imported piece", function() {
      let columns = extractSectionColumns(clefChange, {notation: true})
      expect(columns.map(column => [...column])).toEqual([["C3", "E5"], ["G3"], ["C4", "E5"]])
      expect(columns.map(column => column.staves)).toEqual([["lower", "upper"], ["lower"], ["lower", "upper"]])
      expect(columns.map(column => column.clefs)).toEqual([
        {upper: "g", lower: "f"}, {upper: "g", lower: "f"}, {upper: "g", lower: "g"},
      ])

      // one hand's tracks carry their own staff alone
      let upper = extractSectionColumns(clefChange, {notation: true, track: staffTracks(clefChange).treble})
      expect(upper.map(column => [column.staves, column.clefs])).toEqual([
        [["upper"], {upper: "g"}], [["upper"], {upper: "g"}],
      ])

      // not asked for, as for pasted notation
      expect(extractSectionColumns(clefChange).some(column => column.staves || column.clefs)).toBe(false)
    })

    it("keeps the staves of the notes kept by the staff's range", function() {
      let columns = extractSectionColumns(clefChange, {notation: true})
      let [kept] = filterColumnsToRange(columns, "C4", "C6")
      expect(kept.map(column => [[...column], column.staves, column.clefs])).toEqual([
        [["E5"], ["upper"], {upper: "g", lower: "f"}],
        [["C4", "E5"], ["lower", "upper"], {upper: "g", lower: "g"}],
      ])
    })
  })

  describe("generator", function() {
    it("emits columns in order and wraps around", function() {
      let g = new SheetMusicGenerator([["C4"], ["D4", "F4"], ["E4"]])
      let seen = []
      for (let i = 0; i < 7; i++) {
        seen.push(g.nextNote())
      }

      expect(seen).toEqual([
        ["C4"], ["D4", "F4"], ["E4"],
        ["C4"], ["D4", "F4"], ["E4"],
        ["C4"],
      ])
    })

    it("emits empty columns for an empty section", function() {
      let g = new SheetMusicGenerator([])
      expect(g.nextNote()).toEqual([])
      expect(g.nextNote()).toEqual([])

      // an empty column is never matched by a played note
      let notes = new NoteList([], {generator: g})
      notes.fillBuffer(3)
      expect(notes.length).toEqual(3)
      expect(notes.currentColumn()).toEqual([])
      expect(notes.matchesHead(["C4"])).toBe(false)
      expect(notes.inHead("C4")).toBe(false)
    })
  })

  describe("sheet music section", function() {
    it("drills the named track", function() {
      let {columns, status} = sheetMusicSection(staff, {
        song: twoHands, startMeasure: 1, endMeasure: 2, track: "track t1",
      })

      expect(columns).toEqual([["C2"], ["G2"], ["D2"]])
      expect(status).toContain("Song has 2 measures")
      expect(status).toContain("section has 3 columns")
    })

    it("falls back to all tracks when the song has no such track", function() {
      let oneHand = "c4 e4 g4 c5"

      let {columns} = sheetMusicSection(staff, {
        song: oneHand, startMeasure: 1, endMeasure: 1, track: "track t1",
      })

      expect(columns).toEqual([["C4"], ["E4"], ["G4"], ["C5"]])
    })

    it("ignores accompaniment generated for chord macros", function() {
      let {columns} = sheetMusicSection(staff, {
        song: "t0 m0 c4 e4 g4 c5 $C", startMeasure: 1, endMeasure: 1, track: "all",
      })

      expect(columns).toEqual([["C4"], ["E4"], ["G4"], ["C5"]])
      expect(parseSongText("t0 m0 c4 e4 g4 c5 $C").song.tracks.length).toEqual(1)
    })

    it("reports an empty section", function() {
      let {columns, status} = sheetMusicSection(staff, {
        song: twoHands, startMeasure: 5, endMeasure: 6, track: "all",
      })

      expect(columns).toEqual([])
      expect(status).toContain("section has no notes")
    })
  })

  describe("stored deck", function() {
    // a spec-only key so running the specs never touches the real deck
    const storageKey = "st:spec_deck"

    const generator = {
      name: "stored",
      storageKey,
      inputs: [
        {name: "song", type: "text", default: ""},
        {name: "startMeasure", type: "number", default: 1, min: 1, max: 9999},
        {name: "endMeasure", type: "number", default: 4, min: 1, max: 9999},
        {name: "track", type: "select", default: "all", values: () => []},
      ],
    }

    afterEach(function() {
      window.localStorage.removeItem(storageKey)
    })

    it("restores the whole section configuration", function() {
      storeGeneratorSettings(storageKey, {
        song: twoHands, startMeasure: 2, endMeasure: 2, track: "track t1",
      })

      expect(generatorDefaultSettings(generator, staff)).toEqual({
        song: twoHands, startMeasure: 2, endMeasure: 2, track: "track t1",
      })
    })

    it("ignores stored values of the wrong shape", function() {
      window.localStorage.setItem(storageKey, JSON.stringify({
        song: 12, startMeasure: "2", endMeasure: 99999,
      }))

      expect(generatorDefaultSettings(generator, staff)).toEqual({
        song: "", startMeasure: 1, endMeasure: 9999, track: "all",
      })

      window.localStorage.setItem(storageKey, "not json")
      expect(generatorDefaultSettings(generator, staff).song).toEqual("")
    })
  })

  describe("stored drill", function() {
    const treble = {name: "treble", mode: "notes"}
    const grand = {name: "grand", mode: "notes"}
    const staves = [treble, grand]

    const random = {name: "random", mode: "notes"}
    const sheetMusic = {name: "sheet music", mode: "notes"}
    const chords = {name: "random", mode: "chords"}
    const generators = [random, sheetMusic, chords]

    // the drill key is shared with the app on this origin, so put back
    // whatever the user was drilling once the specs are done
    let saved
    beforeEach(function() {
      saved = window.localStorage.getItem(DRILL_STORAGE_KEY)
      window.localStorage.removeItem(DRILL_STORAGE_KEY)
    })

    afterEach(function() {
      if (saved == null) {
        window.localStorage.removeItem(DRILL_STORAGE_KEY)
      } else {
        window.localStorage.setItem(DRILL_STORAGE_KEY, saved)
      }
    })

    it("restores the chosen staff and generator", function() {
      expect(currentStaffFor(staves)).toBe(treble)
      expect(currentGeneratorFor(generators, "notes")).toBe(random)

      storeCurrentDrill({staff: "grand"})
      storeCurrentDrill({generator: "sheet music"})
      expect(currentStaffFor(staves)).toBe(grand)
      expect(currentGeneratorFor(generators, "notes")).toBe(sheetMusic)
      expect(currentGeneratorFor(generators, "chords")).toBe(chords)
    })

    it("restores the key signature, mode and scroll speed", function() {
      expect(currentKeySignature().name()).toEqual("C")
      expect(currentDrillMode()).toEqual("wait")
      expect(currentScrollSpeed()).toEqual(100)

      storeCurrentDrill({key: "Chromatic", mode: "scroll", speed: 180})
      expect(currentKeySignature().isChromatic()).toBe(true)
      expect(currentDrillMode()).toEqual("scroll")
      expect(currentScrollSpeed()).toEqual(180)

      storeCurrentDrill({key: "H", mode: "fast", speed: 9000})
      expect(currentKeySignature().name()).toEqual("C")
      expect(currentDrillMode()).toEqual("wait")
      expect(currentScrollSpeed()).toEqual(300)

      storeCurrentDrill({speed: "quick"})
      expect(currentScrollSpeed()).toEqual(100)
    })

    it("falls back when the stored drill is unknown or malformed", function() {
      window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify({staff: "gone", generator: "gone"}))
      expect(currentStaffFor(staves)).toBe(treble)
      expect(currentGeneratorFor(generators, "notes")).toBe(random)

      window.localStorage.setItem(DRILL_STORAGE_KEY, "not json")
      expect(currentStaffFor(staves)).toBe(treble)
      expect(currentGeneratorFor(generators, "notes")).toBe(random)
    })
  })
})
