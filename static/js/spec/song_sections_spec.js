import SongParser from "st/song_parser"
import {SongNoteList, MultiTrackSong, SongNote} from "st/song_note_list"

import {
  extractSectionColumns, measureBeatRange, countMeasures, filterColumnsToRange,
  parseSongText
} from "st/song_sections"

import {
  SheetMusicGenerator, generatorDefaultSettings, storeGeneratorSettings,
  storeCurrentDrill, currentStaffFor, currentGeneratorFor, DRILL_STORAGE_KEY
} from "st/generators"
import {sheetMusicSection} from "st/data"
import NoteList from "st/note_list"

describe("song sections", function() {
  // two measures of 4/4, two tracks
  const twoHands = `
    t0 m0 c5 e5 g5 c6
    t1 m0 c3.2 g3.2
    t0 m1 d5 f5 a5 d6
    t1 m1 d3.4
  `

  const staff = {name: "grand", range: ["C3", "C7"]}

  it("groups notes with equal onsets into one ascending column", function() {
    let song = SongNoteList.newSong([
      ["G5", 0, 1],
      ["C5", 0, 1],
      ["E5", 0, 1],
      ["D5", 1, 1],
    ])

    song.metadata = {beatsPerMeasure: 4}

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
      ["C5", "E5", "G5"],
      ["D5"],
    ])
  })

  it("quantizes near equal onsets and dedupes pitches", function() {
    let song = SongNoteList.newSong([
      ["C5", 0, 1],
      ["E5", 0.0001, 1],
      ["C5", 0, 2], // duplicate pitch
      ["Db5", 1/3 + 2/3, 1], // floating error lands on beat 1
      ["C#5", 1, 1], // same pitch, different spelling
    ])

    song.metadata = {beatsPerMeasure: 4}

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
      ["C5", "E5"],
      ["Db5"],
    ])
  })

  it("respects measure range boundaries", function() {
    let song = SongParser.load(twoHands)
    expect(song.metadata.beatsPerMeasure).toEqual(4)

    expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 2})).toEqual([
      ["D3", "D5"],
      ["F5"],
      ["A5"],
      ["D6"],
    ])

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
      ["C3", "C5"],
      ["E5"],
      ["G3", "G5"],
      ["C6"],
    ])

    // ranges past the end of the song yield nothing
    expect(extractSectionColumns(song, {startMeasure: 3, endMeasure: 10})).toEqual([])

    // both measures
    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 2}).length).toEqual(8)
  })

  it("filters by track", function() {
    let song = SongParser.load(twoHands)

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 2, track: 1})).toEqual([
      ["C3"],
      ["G3"],
      ["D3"],
    ])

    expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1, track: 0})).toEqual([
      ["C5"], ["E5"], ["G5"], ["C6"],
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
      ["C5", 0, 1],
      ["D5", 3, 1],
      ["E5", 7, 1],
    ])

    // measures of 3 then 4 beats
    song.metadata = {beatsPerMeasure: 4, measureStarts: [0, 3, 7]}

    expect(measureBeatRange(song, 1, 1)).toEqual([0, 3])
    expect(measureBeatRange(song, 2, 3)).toEqual([3, Infinity])
    expect(countMeasures(song)).toEqual(3)

    expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 2})).toEqual([["D5"]])
  })

  it("counts measures", function() {
    let song = SongParser.load(twoHands)
    expect(countMeasures(song)).toEqual(2)

    let partial = SongParser.load("ts3/4 c5 d5 e5 f5")
    expect(countMeasures(partial)).toEqual(2)

    expect(countMeasures(new MultiTrackSong())).toEqual(0)
  })

  it("filters columns to a pitch range", function() {
    let [columns, dropped] = filterColumnsToRange([
      ["C3", "C5"],
      ["A2"],
      ["E5"],
    ], "C4", "C7")

    expect(columns).toEqual([["C5"], ["E5"]])
    expect(dropped).toEqual(2)
  })

  it("parses song text and reports errors", function() {
    expect(parseSongText("").song).toBeNull()
    expect(parseSongText("c5 d5").song.length).toEqual(2)

    let bad = parseSongText("c5 ??")
    expect(bad.song).toBeNull()
    expect(bad.error).toBeTruthy()
  })

  describe("generator", function() {
    it("emits columns in order and wraps around", function() {
      let g = new SheetMusicGenerator([["C5"], ["D5", "F5"], ["E5"]])
      let seen = []
      for (let i = 0; i < 7; i++) {
        seen.push(g.nextNote())
      }

      expect(seen).toEqual([
        ["C5"], ["D5", "F5"], ["E5"],
        ["C5"], ["D5", "F5"], ["E5"],
        ["C5"],
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
      expect(notes.matchesHead(["C5"])).toBe(false)
      expect(notes.inHead("C5")).toBe(false)
    })
  })

  describe("sheet music section", function() {
    it("drills the named track", function() {
      let {columns, status} = sheetMusicSection(staff, {
        song: twoHands, startMeasure: 1, endMeasure: 2, track: "track t1",
      })

      expect(columns).toEqual([["C3"], ["G3"], ["D3"]])
      expect(status).toContain("Song has 2 measures")
      expect(status).toContain("section has 3 columns")
    })

    it("falls back to all tracks when the song has no such track", function() {
      let oneHand = "c5 e5 g5 c6"

      let {columns} = sheetMusicSection(staff, {
        song: oneHand, startMeasure: 1, endMeasure: 1, track: "track t1",
      })

      expect(columns).toEqual([["C5"], ["E5"], ["G5"], ["C6"]])
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
