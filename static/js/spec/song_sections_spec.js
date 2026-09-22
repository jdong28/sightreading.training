import SongParser from "st/song_parser"
import {SongNoteList, MultiTrackSong, SongNote} from "st/song_note_list"

import {
  extractSectionColumns, measureBeatRange, countMeasures, filterColumnsToRange,
  parseSongText, staffTracks
} from "st/song_sections"
import {parseMusicXML} from "st/musicxml"
import {noteXML} from "spec/helpers"

import {
  SheetMusicGenerator, generatorDefaultSettings, storeGeneratorSettings,
  storeCurrentDrill, currentStaffFor, currentGeneratorFor, DRILL_STORAGE_KEY,
  currentKeySignature, currentDrillMode, currentScrollSpeed,
} from "st/generators"
import {sheetMusicSection} from "st/data"
import NoteList from "st/note_list"

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

    expect(columns.map(column => [...column])).toEqual([["C4"], ["E4"]])
    expect(columns.map(column => column.dropped)).toEqual([["C2"], undefined])
    expect(dropped).toEqual(2)
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
