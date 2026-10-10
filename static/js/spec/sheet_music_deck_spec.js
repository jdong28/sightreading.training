import {zipSync} from "fflate"
import {
  parseMusicXML, COMPRESSED_MESSAGE, DAMAGED_ARCHIVE_MESSAGE, NO_SCORE_MESSAGE
} from "st/musicxml"
import {MultiTrackSong, SongNote} from "st/song_note_list"

import {
  extractSectionColumns, measureBeatRange, measureNumberRange, measureIndexRange, staffTracks
} from "st/song_sections"

import {
  songToJSON, songFromJSON, loadDeck, findPiece, pieceSong, pieceSource, addPiece,
  removePiece, importMusicXMLPiece, ensureAnnotation, MAX_PIECES,
  decideFlags, exportFlagsFile, importFlagsFile, exportLibraryFile, importLibraryFile
} from "st/sheet_music_deck"

import {flagsInForce} from "st/difficulty/records"
import {acceptDecision, dismissDecision, reviewFlags} from "st/difficulty/decisions"

import {
  pieceSection, pieceSectionMeasures, sheetMusicSection, sheetMusicPieceSettings, sheetMusicStaffFor,
  sheetMusicKeyFor, measuresDescription, SHEET_MUSIC_GENERATOR, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, FREE_PRACTICE
} from "st/data"

import {setAppStore} from "st/storage"
import {
  openTestStore, pickupScore, noteXML, reverieOpening, keyChangeScore, nocturneBars5to6,
  tiedTrillScore, trillLineScore, LITTLE_WALTZ_XML, littleWaltzMXL, pianoScore
} from "spec/helpers"

let tuples = notes => [...notes]
  .map(n => [n.note, n.start, n.duration])
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))

const grand = {name: "grand", range: ["C2", "C6"]}
const treble = {name: "treble", range: ["A3", "C6"]}

// a piece with a dense run of sixteenths at bars 9-11, long enough for
// st/difficulty to flag passages. A different barCount makes a different
// score (fewer/more measures) under the same (score-given) title.
function workhorseScore({leadNote="C4", barCount=16, directions=null, denseRun=true, lead=false}={}) {
  let quiet = {upper: ["C4", "D4", "E4", "F4"], lower: ["C3", "D3", "E3", "F3"]}
  let dense = {
    upper: ["C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4", "C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4"],
    lower: ["C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3", "C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3"],
  }

  let bars = Array.from({length: barCount}, (_, i) => denseRun && i >= 8 && i <= 10 ?
    {upper: dense.upper.map(name => ({name, duration: 0.25, type: "16th"})),
      lower: dense.lower.map(name => ({name, duration: 0.25, type: "16th"}))} :
    {upper: quiet.upper.map(name => ({name})), lower: quiet.lower.map(name => ({name}))})

  bars[0].upper[0] = {name: leadNote}
  if (directions) { bars[0] = {...bars[0], directions} }
  // a bar of its own ahead of the rest: the same score numbered one higher
  if (lead) {
    bars.unshift({
      upper: ["A4", "B4", "A4", "G4"].map(name => ({name})),
      lower: ["A2", "B2", "A2", "G2"].map(name => ({name})),
    })
  }
  return pianoScore({title: "Workhorse", bars})
}

describe("sheet music deck", function() {
  describe("stored song", function() {
    it("round trips an imported piece through JSON", function() {
      let song = parseMusicXML(pickupScore())
      let stored = JSON.parse(JSON.stringify(songToJSON(song)))
      let restored = songFromJSON(stored)

      expect(restored instanceof MultiTrackSong).toBe(true)
      expect(restored.metadata).toEqual(song.metadata)
      expect(restored.tracks.length).toEqual(song.tracks.length)

      song.tracks.forEach((track, idx) => {
        expect(tuples(restored.tracks[idx])).toEqual(tuples(track))
        expect(restored.tracks[idx].cleffs).toEqual(track.cleffs)
        expect(restored.tracks[idx].trackName).toEqual(track.trackName)
      })

      expect(tuples(restored)).toEqual(tuples(song))

      for (let [start, end] of [[0, 0], [1, 2]]) {
        expect(extractSectionColumns(restored, {startMeasure: start, endMeasure: end}))
          .toEqual(extractSectionColumns(song, {startMeasure: start, endMeasure: end}))
      }
    })

    it("round trips the ornaments of a piece's notes, and the columns they allow", function() {
      let song = parseMusicXML(nocturneBars5to6())
      let stored = JSON.parse(JSON.stringify(songToJSON(song)))

      expect(stored.format).toEqual(4)
      // one entry a note of the right hand's track, as its notation
      expect(stored.tracks[0].ornaments).toEqual([
        null, {neighbours: ["G#5"]}, {graces: ["E5", "F#5"]}, null,
      ])
      expect(stored.tracks[1].ornaments).toBeUndefined()

      let restored = songFromJSON(stored)
      let allowed = s => extractSectionColumns(s, {startMeasure: 1, endMeasure: 2, notation: true})
        .map(column => column.allowed || null)
      expect(allowed(restored)).toEqual(allowed(song))
      expect(allowed(restored).filter(a => a).length).toEqual(5)
    })

    it("round trips the beat an ornament on a tie's continuation sounds from", function() {
      let song = parseMusicXML(tiedTrillScore())
      let stored = JSON.parse(JSON.stringify(songToJSON(song)))

      expect(stored.tracks[0].ornaments).toEqual([{neighbours: ["D5"], at: 4}])

      let allowed = s => extractSectionColumns(s, {startMeasure: 1, endMeasure: 2, notation: true})
        .map(column => column.allowed || null)
      expect(allowed(songFromJSON(stored))).toEqual(allowed(song))
      expect(allowed(song).filter(a => a).length).toEqual(4)
    })

    it("keeps the ratio of a triplet the score writes late in the piece", function() {
      // six 4/4 bars of whole notes, the last a triplet of quarters and a
      // half: part 2 draws the brackets and beams from the stored ratio
      let song = parseMusicXML(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${Array.from({length: 5}, (_, idx) => `
    <measure number="${idx + 1}">
      ${idx == 0 ? "<attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>" : ""}
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>whole</type></note>
    </measure>`).join("")}
    <measure number="6">
      ${["D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`).join("")}
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`)

      let restored = songFromJSON(JSON.parse(JSON.stringify(songToJSON(song))))
      let [start, end] = measureBeatRange(restored, 6, 6)
      let bar6 = [...restored].filter(note => note.start >= start && note.start < end)

      expect(bar6.map(note => [note.note, note.notation.type, note.notation.tuplet || 1]))
        .toEqual([
          ["D5", "quarter", 1.5], ["E5", "quarter", 1.5], ["F5", "quarter", 1.5],
          ["G5", "half", 1],
        ])
    })

    it("stores a track's rests with only what the staff draws them from", function() {
      let song = parseMusicXML(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest/><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><rest/><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`)

      let stored = JSON.parse(JSON.stringify(songToJSON(song)))

      // a rest is drawn by its notated value at a fixed staff position, so the
      // stored piece keeps neither the length it is played for nor the voice
      // that writes it
      expect(stored.tracks[0].rests).toEqual([
        {start: 0, type: "quarter"},
        {start: 1, type: "half"},
      ])
      expect(songFromJSON(stored).tracks[0].rests).toEqual(stored.tracks[0].rests)
    })

    it("stores notes compactly and rounds float beats", function() {
      let song = new MultiTrackSong()
      song.metadata = {beatsPerMeasure: 4}
      song.pushWithTrack(new SongNote("C4", 1 / 3, 1 / 3), 0)

      let data = songToJSON(song)
      expect(data.tracks).toEqual([{notes: ["C4", 0.333333, 0.333333]}])
      expect(JSON.stringify(data)).not.toContain("<")
    })

    it("refuses stored data of the wrong shape", function() {
      expect(() => songFromJSON(null)).toThrow()
      expect(() => songFromJSON({format: 99, tracks: []})).toThrow()
      expect(() => songFromJSON({format: 1, tracks: [{notes: ["C4", 0]}]})).toThrow()
      expect(() => songFromJSON({format: 1, tracks: [{notes: [5, 0, 1]}]})).toThrow()
    })
  })

  describe("measure numbers", function() {
    it("numbers a pickup measure 0 like the score", function() {
      let song = parseMusicXML(pickupScore())

      expect(song.metadata.measureStarts).toEqual([0, 1, 4])
      expect(song.metadata.measureNumbers).toEqual([0, 1, 2])
      expect(measureNumberRange(song)).toEqual([0, 2])
      expect(measuresDescription(song)).toEqual("measures 0–2 (0 is the pickup)")

      expect(measureBeatRange(song, 0, 0)).toEqual([0, 1])
      expect(measureBeatRange(song, 1, 1)).toEqual([1, 4])
      expect(measureBeatRange(song, 2, 2)).toEqual([4, Infinity])

      expect(extractSectionColumns(song, {startMeasure: 0, endMeasure: 0})).toEqual([["D5"]])
      expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
        ["G3", "G4"], ["A4"], ["B4"],
      ])
      expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 5})).toEqual([
        ["C3", "E3", "G3", "C5"],
      ])

      // past the end of the score
      expect(extractSectionColumns(song, {startMeasure: 3, endMeasure: 4})).toEqual([])
    })

    it("numbers a timewise score's pickup measure 0", function() {
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <score-timewise version="4.0">
          <part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
          <measure number="0" implicit="yes">
            <part id="P1">
              <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
              ${noteXML("D", 5, 1, 1)}
            </part>
          </measure>
          <measure number="1"><part id="P1">${noteXML("G", 4, 3, 1)}</part></measure>
          <measure number="2"><part id="P1">${noteXML("C", 5, 3, 1)}</part></measure>
        </score-timewise>`

      let song = parseMusicXML(xml)
      expect(song.metadata.measureStarts).toEqual([0, 1, 4])
      expect(song.metadata.measureNumbers).toEqual([0, 1, 2])
      expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([["G4"]])
    })

    it("keeps a split bar's number and follows meter changes", function() {
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
          <part id="P1">
            <measure number="1">
              <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
              ${noteXML("C", 5, 4, 1)}
            </measure>
            <measure number="2">${noteXML("D", 5, 2, 1)}</measure>
            <measure number="X1" implicit="yes">${noteXML("E", 5, 2, 1)}</measure>
            <measure number="3">
              <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
              ${noteXML("F", 5, 3, 1)}
            </measure>
            <measure number="4">${noteXML("G", 5, 3, 1)}</measure>
          </part>
        </score-partwise>`

      let song = parseMusicXML(xml)
      expect(song.metadata.measureStarts).toEqual([0, 4, 6, 8, 11])
      expect(song.metadata.measureNumbers).toEqual([1, 2, 2, 3, 4])
      expect(measuresDescription(song)).toEqual("measures 1–4")

      expect(measureBeatRange(song, 2, 2)).toEqual([4, 8])
      expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 3})).toEqual([
        ["D5"], ["E5"], ["F5"],
      ])

      // a start before the first measure starts at the first measure
      expect(extractSectionColumns(song, {startMeasure: 0, endMeasure: 1})).toEqual([["C5"]])

      // measure 2 is split across indices 1 and 2: the range's start takes
      // the first of its number, its end the last
      expect(measureIndexRange(song, 1, 1)).toEqual([0, 0])
      expect(measureIndexRange(song, 2, 2)).toEqual([1, 2])
      expect(measureIndexRange(song, 2, 3)).toEqual([1, 3])
      expect(measureIndexRange(song, 1, 4)).toEqual([0, 4])
    })

    it("measureIndexRange falls back to number minus one without explicit numbering", function() {
      let song = parseMusicXML(pianoScore({bars: [{upper: [{name: "C4"}]}, {upper: [{name: "D4"}]}]}))
      delete song.metadata.measureNumbers
      expect(measureIndexRange(song, 1, 2)).toEqual([0, 1])
    })
  })

  describe("hand filter", function() {
    it("drills a hand by the staff its clef puts it on", function() {
      let song = parseMusicXML(pickupScore())
      expect(staffTracks(song)).toEqual({treble: [0], bass: [1]})

      let settings = {startMeasure: 1, endMeasure: 2}

      expect(pieceSection(grand, {...settings, hand: RIGHT_HAND}, song).columns).toEqual([
        ["G4"], ["A4"], ["B4"], ["C5"],
      ])

      expect(pieceSection(grand, {...settings, hand: LEFT_HAND}, song).columns).toEqual([
        ["G3"], ["C3", "E3", "G3"],
      ])

      expect(pieceSection(grand, {...settings, hand: BOTH_HANDS}, song).columns).toEqual([
        ["G3", "G4"], ["A4"], ["B4"], ["C3", "E3", "G3", "C5"],
      ])
    })

    it("follows the clefs rather than the staff order", function() {
      // staff 1 written in bass clef, staff 2 in treble clef
      let song = parseMusicXML(pickupScore({clefs: [["F", 4], ["G", 2]]}))
      expect(staffTracks(song)).toEqual({treble: [1], bass: [0]})

      let {columns} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([["G4"], ["A4"], ["B4"]])
    })

    it("falls back to track order when both staves open in the same clef", function() {
      // the lower staff opens in treble clef, switching to bass clef later
      let song = parseMusicXML(pickupScore({clefs: [["G", 2], ["G", 2]]}))
      expect(staffTracks(song)).toEqual({treble: [0], bass: [1]})
      expect(sheetMusicStaffFor(song)).toEqual("grand")

      let {columns, status} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([["G3"]])
      expect(status).not.toContain("no bass staff")

      let upperBass = parseMusicXML(pickupScore({clefs: [["F", 4], ["F", 4]]}))
      expect(staffTracks(upperBass)).toEqual({treble: [0], bass: [1]})
    })

    it("falls back to track order without clefs", function() {
      let song = parseMusicXML(pickupScore({clefs: []}))
      expect(song.tracks.every(track => !track.cleffs)).toBe(true)
      expect(staffTracks(song)).toEqual({treble: [0], bass: [1]})

      let {columns} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([["G3"]])
    })

    it("reports a hand the score doesn't have", function() {
      let song = new MultiTrackSong()
      song.metadata = {beatsPerMeasure: 4, measureStarts: [0], measureNumbers: [1]}
      song.pushWithTrack(new SongNote("C4", 0, 1), 0)
      song.getTrack(0).cleffs = [[0, "g"]]

      let {columns, status} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([])
      expect(status).toContain("the score has no bass staff")
      expect(sheetMusicStaffFor(song)).toBe(null)
    })

    it("points two staff pieces at the grand staff", function() {
      let song = parseMusicXML(pickupScore())
      expect(sheetMusicStaffFor(song)).toEqual("grand")

      let {status} = pieceSection(treble, {startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS}, song)
      expect(status).toContain("Score has measures 0–2 (0 is the pickup)")
      expect(status).toContain("outside the treble staff range skipped; pick the grand staff to drill both hands")

      // a single hand on its own staff needs no advice
      let right = pieceSection(treble, {startMeasure: 1, endMeasure: 2, hand: RIGHT_HAND}, song)
      expect(right.status).not.toContain("grand staff")
    })
  })

  // T1: the engine draws a piece's whole source, so detection must too; only
  // the app staff's own fallback (a piece it can't engrave) still needs a
  // staff's notes clipped to what it can draw. Both sides call the same
  // pieceSection/pieceSectionMeasures, fed the grand staff's usual C2–C6
  // range or, on the engine path, the whole keyboard
  describe("whole keyboard detection (T1)", function() {
    // a bass G#1 and a treble C#6 at the same onset, both outside the grand
    // staff's C2–C6 range (as in the Nocturne's bar 7, see sr-note-detection-l3)
    let wideRangeXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><alter>1</alter><octave>6</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><alter>1</alter><octave>1</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    let wholeKeyboard = {name: "grand", range: ["A0", "C8"]}
    let settings = {startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS}

    it("pieceSectionMeasures keeps notes outside the grand staff's range given the whole keyboard", function() {
      let song = parseMusicXML(wideRangeXML)
      let measures = pieceSectionMeasures(wholeKeyboard, settings, song)
      expect([...measures[0].columns[0]].sort()).toEqual(["C#6", "G#1"])
    })

    it("pieceSectionMeasures drops the same notes on the grand staff's own range", function() {
      let song = parseMusicXML(wideRangeXML)
      let measures = pieceSectionMeasures(grand, settings, song)
      expect(measures[0].columns).toEqual([])
    })

    it("reports no notes skipped given the whole keyboard, unlike the grand staff's own range", function() {
      let song = parseMusicXML(wideRangeXML)

      let wide = pieceSection(wholeKeyboard, settings, song)
      expect([...wide.columns[0]].sort()).toEqual(["C#6", "G#1"])
      expect(wide.status).not.toContain("skipped")

      let narrow = pieceSection(grand, settings, song)
      expect(narrow.columns).toEqual([])
      expect(narrow.status).toContain("2 notes outside the grand staff range skipped")
    })
  })

  describe("key signature", function() {
    it("follows the score's key, and leaves a song without per-measure keys alone", function() {
      expect(sheetMusicKeyFor(parseMusicXML(reverieOpening()), 1).name()).toEqual("F")
      expect(sheetMusicKeyFor(parseMusicXML(pickupScore()), 0).name()).toEqual("G")

      let song = new MultiTrackSong()
      song.pushWithTrack(new SongNote("C5", 0, 1), 0)
      expect(sheetMusicKeyFor(song, 1)).toBe(null)

      // a piece stored before per-measure keys were recorded
      let legacy = parseMusicXML(reverieOpening())
      delete legacy.metadata.measureKeySignatures
      expect(legacy.metadata.keySignature).toEqual(-1)
      expect(sheetMusicKeyFor(legacy, 1)).toBe(null)
    })

    it("takes the key in effect at the section's start measure", function() {
      let song = parseMusicXML(keyChangeScore())
      expect(song.metadata.measureKeySignatures).toEqual([-1, -1, 4, 4])

      let restored = songFromJSON(JSON.parse(JSON.stringify(songToJSON(song))))
      expect(restored.metadata.measureKeySignatures).toEqual([-1, -1, 4, 4])

      expect(sheetMusicKeyFor(restored, 2).name()).toEqual("F")
      expect(sheetMusicKeyFor(restored, 3).name()).toEqual("E")
      expect(sheetMusicKeyFor(restored, 4).name()).toEqual("E")
    })

    it("has no key for a score in a key the trainer lacks", function() {
      let song = parseMusicXML(keyChangeScore({keys: [6]}))
      expect(song.metadata.keySignature).toEqual(-6)
      expect(song.metadata.measureKeySignatures).toEqual([6, 6, 6, 6])
      expect(sheetMusicKeyFor(song, 1)).toBe(null)
    })
  })

  describe("deck", function() {
    // a store on the specs' own database, so the specs never touch the real
    // deck
    let store
    beforeEach(async function() {
      store = await openTestStore()
    })

    afterEach(async function() {
      await store.close()
    })

    it("adds, selects, and removes pieces", async function() {
      expect(loadDeck(store).pieces).toEqual([])

      let {piece, error} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect(error).toBeUndefined()
      expect(piece.title).toEqual("Pickup Minuet")
      expect(piece.fileName).toEqual("minuet.musicxml")
      expect(typeof piece.importedAt).toEqual("number")

      // stored as song JSON, with the MusicXML kept apart as its source
      expect(JSON.stringify(await store.backend.getAll("pieces"))).not.toContain("score-partwise")
      expect(loadDeck(store).pieces.map(p => p.title)).toEqual(["Pickup Minuet"])
      expect(await pieceSource(piece.id, store)).toEqual(pickupScore())

      // importing the same score again picks the stored piece
      let again = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect(again.piece.id).toEqual(piece.id)
      expect(loadDeck(store).pieces.length).toEqual(1)

      // a score without a work title is named by its file
      let untitled = await importMusicXMLPiece("Waltz_in_A.xml", pickupScore({title: null}), store)
      expect(untitled.piece.title).toEqual("Waltz in A")
      expect(loadDeck(store).pieces.map(p => p.title)).toEqual(["Pickup Minuet", "Waltz in A"])

      // select
      let selected = findPiece(piece.id, store)
      let song = pieceSong(selected)
      expect(song.metadata.measureNumbers).toEqual([0, 1, 2])

      let settings = sheetMusicPieceSettings({piece: piece.id, startMeasure: 40, endMeasure: 44, hand: LEFT_HAND}, song)
      expect(settings).toEqual({piece: piece.id, startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS})
      expect(pieceSection(grand, settings, song).columns.length).toEqual(4)

      // remove
      expect(await removePiece(piece.id, store)).toEqual({})
      expect(findPiece(piece.id, store)).toBe(null)
      expect(loadDeck(store).pieces.map(p => p.title)).toEqual(["Waltz in A"])
    })

    it("replaces a piece imported again under its title, keeping its id and stats", async function() {
      let legacy = parseMusicXML(reverieOpening())
      delete legacy.metadata.measureKeySignatures
      let old = (await addPiece("Rêverie", legacy, store, {fileName: "old.musicxml"})).piece

      await store.recordSectionPractice({pieceId: old.id, startMeasure: 2, endMeasure: 2, hits: 3, misses: 1})

      let {piece, error, updated, sameTitle} = await importMusicXMLPiece("reverie.musicxml", reverieOpening(), store)
      expect(error).toBeUndefined()
      expect([updated, sameTitle]).toEqual([true, undefined])
      expect(piece.id).toEqual(old.id)
      expect(piece.importedAt).toEqual(old.importedAt)
      expect(piece.fileName).toEqual("reverie.musicxml")
      expect(loadDeck(store).pieces.map(p => p.id)).toEqual([old.id])
      expect(pieceSong(findPiece(old.id, store)).metadata.measureKeySignatures).toEqual([-1, -1, -1, -1])
      expect(store.sectionStats(old.id).map(s => [s.startMeasure, s.hits, s.misses])).toEqual([[2, 3, 1]])
      // the old piece had no source, the score imported again is kept as one
      expect(await pieceSource(old.id, store)).toEqual(reverieOpening())

      let reopened = await openTestStore({keep: true})
      expect(pieceSong(findPiece(old.id, reopened)).metadata.measureKeySignatures).toEqual([-1, -1, -1, -1])
      expect(await pieceSource(old.id, reopened)).toEqual(reverieOpening())
      await reopened.close()
    })

    it("fills in the source of a piece stored before sources were kept", async function() {
      // stored without its source, as every piece imported before was
      let old = (await addPiece("Pickup Minuet", parseMusicXML(pickupScore()), store, {fileName: "minuet.musicxml"})).piece
      await store.recordSectionPractice({pieceId: old.id, startMeasure: 1, endMeasure: 2, hits: 5, misses: 2})
      expect(await pieceSource(old.id, store)).toBe(null)

      let {piece, error, updated, warning} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect([error, updated, warning]).toEqual([undefined, undefined, undefined])
      expect(piece).toBe(findPiece(old.id, store))
      expect(loadDeck(store).pieces.map(p => p.id)).toEqual([old.id])
      expect(store.sectionStats(old.id).map(s => [s.startMeasure, s.endMeasure, s.hits, s.misses])).toEqual([[1, 2, 5, 2]])
      expect(await pieceSource(old.id, store)).toEqual(pickupScore())

      let reopened = await openTestStore({keep: true})
      expect(loadDeck(reopened).pieces.map(p => p.id)).toEqual([old.id])
      expect(await pieceSource(old.id, reopened)).toEqual(pickupScore())
      await reopened.close()
    })

    it("keeps drilling a piece stored in the first song format, without a source", async function() {
      // notes, clefs and metadata only, written before sources were kept
      let song = songToJSON(parseMusicXML(pickupScore()))
      let old = {
        id: "old", title: "Pickup Minuet", importedAt: 1000,
        song: {...song, format: 1, tracks: song.tracks.map(({notation, rests, ...track}) => track)},
      }
      await store.putPiece(old)

      let restored = pieceSong(findPiece("old", store))
      expect(restored.metadata.measureNumbers).toEqual([0, 1, 2])
      expect([...restored].every(note => !note.notation)).toBe(true)
      let settings = sheetMusicPieceSettings({piece: "old", startMeasure: 1, endMeasure: 2}, restored)
      expect(pieceSection(grand, settings, restored).columns.length).toEqual(4)
      expect(await pieceSource("old", store)).toBe(null)

      // imported again it becomes the current format, with its source
      let {piece, updated} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect([piece.id, updated]).toEqual(["old", true])
      expect(await pieceSource("old", store)).toEqual(pickupScore())
    })

    it("drills a piece stored in the second song format unchanged, with no ornaments allowed until it is imported again", async function() {
      // notes, notation and rests, written before ornaments were kept
      let song = songToJSON(parseMusicXML(nocturneBars5to6()))
      let old = {
        id: "old", title: "Nocturne in C sharp Minor", importedAt: 1000,
        song: {...song, format: 2, tracks: song.tracks.map(({ornaments, ...track}) => track)},
      }
      await store.putPiece(old)

      let columns = () => {
        let restored = pieceSong(findPiece("old", store))
        let settings = sheetMusicPieceSettings({piece: "old", startMeasure: 1, endMeasure: 2}, restored)
        return pieceSection(grand, settings, restored).columns
      }

      expect([...pieceSong(findPiece("old", store))].every(note => !note.ornaments)).toBe(true)
      expect(columns().length).toEqual(16)
      expect(columns().some(column => column.allowed)).toBe(false)
      expect(findPiece("old", store).song.format).toEqual(2)

      // imported again it becomes the current format, the same piece, and
      // allows its ornaments
      let {piece, updated} = await importMusicXMLPiece("nocturne.musicxml", nocturneBars5to6(), store)
      expect([piece.id, updated]).toEqual(["old", true])
      expect(findPiece("old", store).song.format).toEqual(4)
      expect(columns().length).toEqual(16)
      expect(columns()[4].allowed).toEqual(["G#5"])
      expect(columns()[8].allowed).toEqual(["E5", "F#5"])
    })

    // sr-detect-trill-lines-n7b: a piece stored before song format 4 has
    // only the marked note's own neighbours (what a format 3 import gave a
    // trill line), so the notes it runs over allow nothing until the score
    // is imported again
    it("drills a piece stored in song format 3 with a trill line trilling only its marked note, until it is imported again", async function() {
      let song = parseMusicXML(trillLineScore())
      let stored = songToJSON(song)
      let trebleIdx = staffTracks(song).treble
      let notes = [...song.tracks[trebleIdx]]
      stored.tracks[trebleIdx] = {
        ...stored.tracks[trebleIdx],
        ornaments: stored.tracks[trebleIdx].ornaments.map((entry, idx) => notes[idx].note == "E5" ? entry : null),
      }

      let old = {id: "old", title: "Trill Line", importedAt: 1000, song: {...stored, format: 3}}
      await store.putPiece(old)

      let columns = () => {
        let restored = pieceSong(findPiece("old", store))
        return extractSectionColumns(restored,
          {startMeasure: 1, endMeasure: 2, track: staffTracks(restored).treble, notation: true})
      }

      expect(columns()[1].allowed).toBeFalsy()
      expect(columns()[2].allowed).toBeFalsy()
      expect(findPiece("old", store).song.format).toEqual(3)

      let {piece, updated} = await importMusicXMLPiece("trill_line.musicxml", trillLineScore(), store)
      expect([piece.id, updated]).toEqual(["old", true])
      expect(findPiece("old", store).song.format).toEqual(4)
      expect(columns()[1].allowed).toEqual(["E5"])
    })

    it("round trips a trill line's neighbours over every note it runs over", function() {
      let song = parseMusicXML(trillLineScore())
      let stored = JSON.parse(JSON.stringify(songToJSON(song)))
      let restored = songFromJSON(stored)

      let columns = extractSectionColumns(restored,
        {startMeasure: 1, endMeasure: 2, track: staffTracks(restored).treble, notation: true})
      expect(columns.map(c => c.allowed)).toEqual([["F#5"], ["E5"], ["D5"], undefined])
    })

    it("imports a compressed .mxl file, keeping its score as the source", async function() {
      let {piece, error} = await importMusicXMLPiece("little_waltz.mxl", littleWaltzMXL().buffer, store)
      expect(error).toBeUndefined()
      // a score without a work title is named by its file
      expect(piece.title).toEqual("little waltz")
      expect(piece.fileName).toEqual("little_waltz.mxl")
      expect([...pieceSong(piece)].map(note => note.note)).toEqual(["E5", "G4", "C5"])
      expect(await pieceSource(piece.id, store)).toEqual(LITTLE_WALTZ_XML)

      // the same file again, as bytes, picks the stored piece
      let again = await importMusicXMLPiece("little_waltz.mxl", littleWaltzMXL(), store)
      expect(again.piece.id).toEqual(piece.id)
      expect(loadDeck(store).pieces.length).toEqual(1)

      // an uncompressed file read as bytes, as the file picker reads it
      let bytes = new TextEncoder().encode(pickupScore())
      let minuet = (await importMusicXMLPiece("minuet.musicxml", bytes.buffer, store)).piece
      expect(minuet.title).toEqual("Pickup Minuet")
      expect(await pieceSource(minuet.id, store)).toEqual(pickupScore())
    })

    it("drops a replaced piece's source when the new version comes without one", async function() {
      let legacy = parseMusicXML(reverieOpening())
      delete legacy.metadata.measureKeySignatures
      let old = (await addPiece("Rêverie", legacy, store, {source: "<older version/>"})).piece
      expect(await pieceSource(old.id, store)).toEqual("<older version/>")

      let {piece, updated} = await addPiece("Rêverie", parseMusicXML(reverieOpening()), store)
      expect([piece.id, updated]).toEqual([old.id, true])
      expect(await pieceSource(old.id, store)).toBe(null)
    })

    it("still picks a stored piece when its source can't be saved", async function() {
      let old = (await addPiece("Pickup Minuet", parseMusicXML(pickupScore()), store)).piece
      spyOn(store, "putPieceSource").and.rejectWith(
        new DOMException("The quota has been exceeded.", "QuotaExceededError"))

      let {piece, error, warning} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect(error).toBeUndefined()
      expect(piece.id).toEqual(old.id)
      expect(warning).toEqual("Its score file wasn't saved with it. Browser storage is full. Remove a piece from the deck and try again.")
    })

    it("has no source for a piece that isn't stored", async function() {
      expect(await pieceSource("", store)).toBe(null)
      expect(await pieceSource("missing", store)).toBe(null)
    })

    it("adds a different score under a stored title as a new piece", async function() {
      let prelude = (await addPiece("Prelude", parseMusicXML(pickupScore()), store)).piece
      await store.recordSectionPractice({pieceId: prelude.id, startMeasure: 1, endMeasure: 1, hits: 2, misses: 0})

      let {piece, error, updated, sameTitle} = await addPiece("Prelude", parseMusicXML(reverieOpening()), store)
      expect(error).toBeUndefined()
      expect([updated, sameTitle]).toEqual([undefined, true])
      expect(piece.id).not.toEqual(prelude.id)
      expect(loadDeck(store).pieces.map(p => [p.id, p.title])).toEqual([[prelude.id, "Prelude"], [piece.id, "Prelude"]])

      expect(pieceSong(findPiece(prelude.id, store)).metadata.measureNumbers).toEqual([0, 1, 2])
      expect(store.sectionStats(prelude.id).map(s => [s.startMeasure, s.hits, s.misses])).toEqual([[1, 2, 0]])
      expect(store.sectionStats(piece.id)).toEqual([])
    })

    it("keeps the import order of pieces imported within a millisecond", async function() {
      spyOn(Date, "now").and.returnValue(1000)
      let song = parseMusicXML(pickupScore())
      for (let title of ["C", "A", "B", "D"]) {
        await addPiece(title, song, store)
      }
      expect(loadDeck(store).pieces.map(p => p.title)).toEqual(["C", "A", "B", "D"])
    })

    it("keeps the deck object while the pieces are unchanged", async function() {
      let deck = loadDeck(store)
      expect(loadDeck(store)).toBe(deck)

      await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect(loadDeck(store)).not.toBe(deck)
      expect(loadDeck(store)).toBe(loadDeck(store))
    })

    it("refuses damaged, empty and broken files", async function() {
      let damaged = littleWaltzMXL().slice(0, 60)
      expect((await importMusicXMLPiece("nocturne.mxl", damaged, store)).error).toEqual(DAMAGED_ARCHIVE_MESSAGE)
      expect((await importMusicXMLPiece("nocturne.mxl", zipSync({}), store)).error).toEqual(NO_SCORE_MESSAGE)
      // compressed data that was read as text can't be unpacked
      expect((await importMusicXMLPiece("nocturne.xml", "PK\u0003\u0004zipdata", store)).error).toEqual(COMPRESSED_MESSAGE)
      expect((await importMusicXMLPiece("nocturne.mxl", "whatever", store)).error).toContain("well-formed")
      expect((await importMusicXMLPiece("broken.xml", "<score-partwise>", store)).error).toContain("well-formed")
      expect(loadDeck(store).pieces).toEqual([])
      expect(await store.backend.getAll("pieceSources")).toEqual([])
    })

    it("keeps the deck bounded", async function() {
      // in memory, the bound doesn't depend on where the deck is kept
      let memory = await openTestStore({persist: false})
      let song = parseMusicXML(pickupScore())

      for (let i = 0; i < MAX_PIECES; i++) {
        expect((await addPiece(`Piece ${i}`, song, memory)).error).toBeUndefined()
      }

      let {piece, error} = await addPiece("One too many", song, memory)
      expect(piece).toBeUndefined()
      expect(error).toContain("The deck is full")
      expect(loadDeck(memory).pieces.length).toEqual(MAX_PIECES)
    })

    it("warns when the deck is kept in memory only", async function() {
      let memory = await openTestStore({persist: false})
      let {piece, warning} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), memory)
      expect(piece.title).toEqual("Pickup Minuet")
      expect(warning).toContain("kept only until the page closes")
    })

    it("reports a full browser storage and keeps the stored deck", async function() {
      await importMusicXMLPiece("Waltz in A.xml", pickupScore({title: null}), store)

      spyOn(store.backend, "write").and.rejectWith(
        new DOMException("The quota has been exceeded.", "QuotaExceededError"))

      let {piece, error} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      expect(piece).toBeUndefined()
      expect(error).toEqual("\"Pickup Minuet\" wasn't added to the deck. Browser storage is full. Remove a piece from the deck and try again.")
      expect(loadDeck(store).pieces.map(p => p.title)).toEqual(["Waltz in A"])

      // nor is it in the database
      store.backend.write.and.callThrough()
      let reopened = await openTestStore({keep: true})
      expect(loadDeck(reopened).pieces.map(p => p.title)).toEqual(["Waltz in A"])
      await reopened.close()
    })
  })

  describe("flagged passages (st/difficulty)", function() {
    let store
    beforeEach(async function() {
      store = await openTestStore()
    })

    afterEach(async function() {
      await store.close()
    })

    it("stores the piece's annotation with it", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let record = store.annotation(piece.id)
      expect(record).toBeTruthy()
      expect(record.pieceId).toEqual(piece.id)
      expect(record.proposals.length).toBeGreaterThan(0)
    })

    it("keeps the record and its ids on a re-import; re-analyses a corrected note; a different score gets its own record", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let ids = store.annotation(piece.id).proposals.map(p => p.id)

      // the same score again: the record (and its ids) stay put
      await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      expect(store.annotation(piece.id).proposals.map(p => p.id)).toEqual(ids)

      // a corrected note, same title and score shape: re-analysed, same id kept
      let {piece: corrected, updated} = await importMusicXMLPiece(
        "workhorse.musicxml", workhorseScore({leadNote: "G4"}), store)
      expect(updated).toBe(true)
      expect(corrected.id).toEqual(piece.id)
      expect(store.annotation(piece.id)).toBeTruthy()

      // a different score under the same title gets a record of its own
      let {piece: other, sameTitle} = await importMusicXMLPiece(
        "workhorse.musicxml", workhorseScore({barCount: 20}), store)
      expect(sameTitle).toBe(true)
      expect(other.id).not.toEqual(piece.id)
      expect(store.annotation(other.id)).toBeTruthy()
    })

    it("never fails the import when the analysis or write fails", async function() {
      spyOn(store, "updateAnnotation").and.rejectWith(new Error("boom"))
      spyOn(console, "warn")

      let {piece, error} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      expect(error).toBeUndefined()
      expect(piece).toBeTruthy()
      expect(store.annotation(piece.id)).toBe(null)
      expect(console.warn).toHaveBeenCalled()
    })

    it("ensureAnnotation analyses a piece stored without a record, once", async function() {
      // stored directly, as a piece imported before this change would be:
      // addPiece always annotates a freshly imported piece
      let song = parseMusicXML(workhorseScore())
      let piece = await store.putPiece({id: "old", title: "Workhorse", importedAt: 1000, song: songToJSON(song)})
      expect(store.annotation(piece.id)).toBe(null)

      let record = await ensureAnnotation(piece.id, store)
      expect(record).toBeTruthy()
      expect(store.annotation(piece.id)).toEqual(record)

      spyOn(store, "updateAnnotation")
      let again = await ensureAnnotation(piece.id, store)
      expect(again).toEqual(record)
      expect(store.updateAnnotation).not.toHaveBeenCalled()
    })

    it("ensureAnnotation analyses the source text its caller already holds", async function() {
      // the metronome mark lives only in the source text, so the stored run
      // shows which copy of it was analysed
      let xml = workhorseScore({directions: [{metronome: {unit: "quarter", perMinute: 90}}]})
      let song = parseMusicXML(xml)
      let piece = await store.putPiece({
        id: "held", title: "Workhorse", importedAt: 1000, song: songToJSON(song),
      })
      spyOn(store, "pieceSource").and.callThrough()

      let record = await ensureAnnotation(piece.id, store, {source: xml})
      expect(store.pieceSource).not.toHaveBeenCalled()
      expect(record.runs.score.source).toBe(true)
      expect(record.runs.score.tempo).toEqual({bpm: 90, from: "metronome", word: null})

      // with no text handed over it still reads the store's copy
      let again = await ensureAnnotation(piece.id, store)
      expect(store.pieceSource).toHaveBeenCalled()
      expect(again).toEqual(record)
    })
  })

  describe("the flags file (st/difficulty)", function() {
    let store
    beforeEach(async function() {
      store = await openTestStore()
    })

    afterEach(async function() {
      await store.close()
    })

    it("decideFlags applies a batch of decisions through updateAnnotation", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let flag = flagsInForce(store.annotation(piece.id))[0]
      let decision = acceptDecision({record: store.annotation(piece.id), flag, by: "Ms Laurent", at: Date.now()})

      let {record, error} = await decideFlags(piece.id, [decision], store)
      expect(error).toBeUndefined()
      expect(record.decisions).toEqual([decision])
      expect(flagsInForce(store.annotation(piece.id)).find(f => f.id == flag.id).status).toEqual("accepted")
    })

    it("exportFlagsFile and importFlagsFile round-trip a piece's decisions onto the same piece", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let flag = flagsInForce(store.annotation(piece.id))[0]
      await decideFlags(piece.id,
        [acceptDecision({record: store.annotation(piece.id), flag, by: "Ms Laurent", at: Date.now()})], store)

      let {fileName, error: exportError} = await exportFlagsFile(piece.id, {by: "Ms Laurent"}, store)
      expect(exportError).toBeUndefined()
      expect(fileName).toContain("workhorse")

      let exported = (await exportFlagsFile(piece.id, {by: "Ms Laurent"}, store)).text

      // a fresh device, with the same score imported, opens the file
      let other = await openTestStore()
      let {piece: otherPiece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), other)

      let {piece: appliedTo, message, error} = await importFlagsFile(exported, other)
      expect(error).toBeUndefined()
      expect(appliedTo.id).toEqual(otherPiece.id)
      expect(message).toContain("Ms Laurent")
      expect(message).toContain("1 placed")

      let applied = flagsInForce(other.annotation(otherPiece.id)).find(f => f.id == flag.id)
      expect(applied.status).toEqual("accepted")
      expect(applied.by).toEqual("Ms Laurent")

      await other.close()
    })

    it("opens a file again to place what first waited, and reports what the copy already had", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let flag = flagsInForce(store.annotation(piece.id))[0]
      await decideFlags(piece.id,
        [acceptDecision({record: store.annotation(piece.id), flag, by: "Ms Laurent", at: Date.now()})], store)
      let exported = (await exportFlagsFile(piece.id, {by: "Ms Laurent"}, store)).text

      // the student's edition has the flagged bars written out plainly: the
      // piece is matched, but the passage can't be placed in it
      let other = await openTestStore()
      let {piece: theirs} =
        await importMusicXMLPiece("workhorse.musicxml", workhorseScore({denseRun: false}), other)

      let first = await importFlagsFile(exported, other)
      expect(first.error).toBeUndefined()
      expect(first.message).toContain("0 placed")
      expect(first.message).toContain("1 waiting for a place")
      expect(flagsInForce(other.annotation(theirs.id)).some(f => f.id == flag.id)).toBe(false)

      // they import the matching edition, which replaces the piece in place,
      // and open the same file again
      let {piece: updated} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), other)
      expect(updated.id).toEqual(theirs.id)

      let second = await importFlagsFile(exported, other)
      expect(second.message).toContain("1 placed")
      expect(second.message).toContain("0 waiting for a place")
      expect(reviewFlags(other.annotation(theirs.id)).filter(f => f.id == flag.id).length).toEqual(1)
      expect(flagsInForce(other.annotation(theirs.id)).find(f => f.id == flag.id).status).toEqual("accepted")

      // a third open has nothing left to write, and says so
      let third = await importFlagsFile(exported, other)
      expect(third.message).toContain("0 placed")
      expect(third.message).toContain("1 already in your copy")
      expect(reviewFlags(other.annotation(theirs.id)).filter(f => f.id == flag.id).length).toEqual(1)

      await other.close()
    })

    it("keeps a decision written while the file was opening", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let flag = flagsInForce(store.annotation(piece.id))[0]
      await decideFlags(piece.id,
        [acceptDecision({record: store.annotation(piece.id), flag, by: "Ms Laurent", at: 1})], store)
      let exported = (await exportFlagsFile(piece.id, {by: "Ms Laurent"}, store)).text

      let other = await openTestStore()
      let {piece: theirs} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), other)
      let theirFlag = flagsInForce(other.annotation(theirs.id))[0]

      // the open reads the record and writes it back as two steps on the
      // store's write queue, so a decision made in between must survive it
      let importing = importFlagsFile(exported, other, {pieceId: theirs.id})
      let deciding = decideFlags(theirs.id,
        [dismissDecision({record: other.annotation(theirs.id), flag: theirFlag, by: "", at: 2})], other)

      let [imported] = await Promise.all([importing, deciding])
      expect(imported.error).toBeUndefined()

      let actions = other.annotation(theirs.id).decisions.map(d => d.action).sort()
      expect(actions).toEqual(["accept", "dismiss"])

      await other.close()
    })

    it("importFlagsFile with a pieceId refuses a file for a different score", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      await decideFlags(piece.id,
        [acceptDecision({
          record: store.annotation(piece.id), flag: flagsInForce(store.annotation(piece.id))[0],
          by: "", at: Date.now(),
        })], store)
      let exported = (await exportFlagsFile(piece.id, {by: ""}, store)).text

      let {piece: otherPiece} = await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      let {error} = await importFlagsFile(exported, store, {pieceId: otherPiece.id})
      expect(error).toContain("different score")
    })

    it("importFlagsFile without a pieceId picks the best match in the deck, and errors when nothing matches", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      await decideFlags(piece.id,
        [acceptDecision({
          record: store.annotation(piece.id), flag: flagsInForce(store.annotation(piece.id))[0],
          by: "", at: Date.now(),
        })], store)
      let exported = (await exportFlagsFile(piece.id, {by: ""}, store)).text

      let other = await openTestStore()
      let {error: noMatch} = await importFlagsFile(exported, other)
      expect(noMatch).toContain("No piece in the deck")

      await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), other)
      let {piece: picked, error} = await importFlagsFile(exported, other)
      expect(error).toBeUndefined()
      expect(picked.title).toEqual("Workhorse")

      await other.close()
    })
  })

  describe("Claude's proposals in a flags file (version 2)", function() {
    let store
    beforeEach(async function() {
      store = await openTestStore()
    })

    afterEach(async function() {
      await store.close()
    })

    function claudeProposal(start, end, over={}) {
      return {
        id: `claude:${start}-${end}:0badf00d`, source: "claude",
        start, end, startIndex: start - 1, endIndex: end - 1,
        hand: "both", level: 2, kinds: ["reading"],
        title: `Passage ${start}`, reason: "The left hand crosses under the right.",
        reasons: ["The left hand crosses under the right."], tip: "Left hand alone first.",
        evidence: [{bar: start, index: start - 1, hand: "lower", notes: ["C3"], what: "the climb"}],
        citations: [{url: "https://example.com/p", title: "A page", says: "It is hard.", quote: "", sourceBars: "", verified: false}],
        claude: {confidence: "high", analysis: "agrees", analysisNote: "Same bars."},
        ...over,
      }
    }

    // a v2 file of Claude proposals for a piece, as the offline command writes it
    async function claudeFile(piece, proposals, {run={}}={}) {
      let exported = JSON.parse((await exportFlagsFile(piece.id, {by: "Claude"}, store)).text)
      return JSON.stringify({
        ...exported, version: 2, decisions: [], proposals,
        run: {source: "claude", model: "claude-opus-5-5", effort: "high", web: true,
          promptVersion: 1, schemaVersion: 1, compactVersion: 1, cli: "2.1.296", at: 100, ...run},
      })
    }

    let claudeOf = record => record.proposals.filter(p => p.source == "claude")

    it("opens onto the same score as proposals that wait, leaving the analysis and decisions alone", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let flag = flagsInForce(store.annotation(piece.id))[0]
      await decideFlags(piece.id, [acceptDecision({record: store.annotation(piece.id), flag, by: "Ms Laurent", at: 5})], store)
      let before = store.annotation(piece.id)

      let text = await claudeFile(piece, [claudeProposal(3, 4), claudeProposal(13, 14)])
      let {message, error} = await importFlagsFile(text, store, {pieceId: piece.id})
      expect(error).toBeUndefined()
      expect(message).toEqual("Opened Claude’s proposals for “Workhorse”: 2 passages to review")

      let record = store.annotation(piece.id)
      expect(claudeOf(record).map(p => [p.start, p.end])).toEqual([[3, 4], [13, 14]])
      expect(record.proposals.filter(p => p.source == "score")).toEqual(before.proposals.filter(p => p.source == "score"))
      expect(record.decisions).toEqual(before.decisions)
      expect(record.runs.claude.promptVersion).toEqual(1)
      expect(record.runs.claude.model).toEqual("claude-opus-5-5")

      // waiting, so out of force until a person decides
      expect(reviewFlags(record).filter(f => f.proposalSource == "claude").every(f => f.status == "waiting")).toBe(true)
      expect(flagsInForce(record).some(f => f.proposalSource == "claude")).toBe(false)
    })

    it("opening the same file twice changes nothing", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let text = await claudeFile(piece, [claudeProposal(3, 4), claudeProposal(13, 14)])

      await importFlagsFile(text, store, {pieceId: piece.id})
      let first = store.annotation(piece.id)
      let {message} = await importFlagsFile(text, store, {pieceId: piece.id})
      expect(store.annotation(piece.id)).toEqual(first)
      expect(claudeOf(store.annotation(piece.id)).length).toEqual(2)
      expect(message).toContain("2 passages to review")
    })

    it("a new run replaces the last run's proposals; a decision survives by its range or by `given`", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      await importFlagsFile(await claudeFile(piece, [claudeProposal(3, 4), claudeProposal(13, 14)]), store, {pieceId: piece.id})

      let record = store.annotation(piece.id)
      let flags = reviewFlags(record)
      let keep = flags.find(f => f.proposalSource == "claude" && f.start == 3)
      let vanish = flags.find(f => f.proposalSource == "claude" && f.start == 13)
      await decideFlags(piece.id, [
        acceptDecision({record, flag: keep, by: "Ms Laurent", at: 5}),
        acceptDecision({record, flag: vanish, by: "Ms Laurent", at: 6}),
      ], store)

      // the second run keeps bars 3-4 under another id and names 7-8 instead of 13-14
      let second = await claudeFile(
        piece, [claudeProposal(3, 4, {id: "claude:3-4:11111111"}), claudeProposal(7, 8)], {run: {at: 200}})
      let {message} = await importFlagsFile(second, store, {pieceId: piece.id})
      expect(message).toContain("2 passages to review")

      let after = store.annotation(piece.id)
      expect(claudeOf(after).map(p => [p.start, p.end])).toEqual([[3, 4], [7, 8]])
      expect(after.runs.claude.at).toEqual(200)

      let reviewed = reviewFlags(after)
      expect(reviewed.find(f => f.proposalSource == "claude" && f.start == 3).status).toEqual("accepted")
      expect(reviewed.find(f => f.proposalSource == "claude" && f.start == 7).status).toEqual("waiting")

      // the one whose range is gone stays in force from `given`, with its reason, as Claude's
      let fallback = flagsInForce(after).find(f => f.start == 13)
      expect(fallback.status).toEqual("accepted")
      expect(fallback.lines[0]).toEqual({source: "claude", text: "The left hand crosses under the right."})
      expect(fallback.sources).toContain("claude")
    })

    it("moves a proposal and its evidence bars onto a copy that gained a bar, and drops one the copy lacks", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let text = await claudeFile(piece, [claudeProposal(3, 4), claudeProposal(9, 11), claudeProposal(13, 14)])

      // the copy has a bar ahead of the rest, and writes the dense bars plainly
      let other = await openTestStore()
      let {piece: theirs} =
        await importMusicXMLPiece("workhorse.musicxml", workhorseScore({lead: true, denseRun: false}), other)
      let {message, error} = await importFlagsFile(text, other, {pieceId: theirs.id})
      expect(error).toBeUndefined()
      expect(message).toContain("2 passages to review")
      expect(message).toContain(", 1 couldn’t be placed")

      let kept = claudeOf(other.annotation(theirs.id))
      expect(kept.map(p => [p.start, p.end, p.startIndex, p.endIndex])).toEqual([[4, 5, 3, 4], [14, 15, 13, 14]])
      expect(kept[0].evidence).toEqual([{bar: 4, index: 3, hand: "lower", notes: ["C3"], what: "the climb"}])
      await other.close()
    })

    it("finds the piece by its fingerprint when no piece is named", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      let text = await claudeFile(piece, [claudeProposal(3, 4)])

      let other = await openTestStore()
      let {piece: theirs} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), other)
      let {piece: found, error} = await importFlagsFile(text, other)
      expect(error).toBeUndefined()
      expect(found.id).toEqual(theirs.id)
      expect(claudeOf(other.annotation(theirs.id)).length).toEqual(1)
      await other.close()
    })

    it("keeps Claude's proposals through a re-analysis and a library round trip", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      await importFlagsFile(await claudeFile(piece, [claudeProposal(3, 4)]), store, {pieceId: piece.id})

      // an older analyzer's record is stale: the score run is redone, Claude's stays
      await store.updateAnnotation(piece.id, r => ({...r, runs: {...r.runs, score: {...r.runs.score, algo: -1}}}))
      let record = await ensureAnnotation(piece.id, store)
      expect(record.runs.score.algo).not.toEqual(-1)
      expect(claudeOf(record).map(p => p.start)).toEqual([3])
      expect(record.runs.claude.promptVersion).toEqual(1)

      let file = await exportLibraryFile(store)
      let other = await openTestStore()
      let result = await importLibraryFile(file.text, other)
      expect(result.error).toBeUndefined()
      let arrived = other.annotations().find(a => claudeOf(a).length)
      expect(claudeOf(arrived).map(p => p.title)).toEqual(["Passage 3"])
      await other.close()
    })

    it("reading a library cleans the links Claude's proposals carry", async function() {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      await importFlagsFile(await claudeFile(piece, [claudeProposal(3, 4)]), store, {pieceId: piece.id})

      let library = JSON.parse((await exportLibraryFile(store)).text)
      library.annotations[0].proposals.find(p => p.source == "claude").citations.push(
        {url: "javascript:alert(1)", title: "Bad", says: "", quote: "", sourceBars: "", verified: true})

      let other = await openTestStore()
      await importLibraryFile(JSON.stringify(library), other)
      let citations = claudeOf(other.annotations()[0])[0].citations
      expect(citations.map(c => c.url)).toEqual(["https://example.com/p"])
      await other.close()
    })
  })

  describe("opening a flags file against the whole deck", function() {
    // the specs' stores share one database, so the deck opened for a test
    // replaces the exporting device's
    let source, store
    beforeEach(async function() {
      source = await openTestStore()
    })

    afterEach(async function() {
      await source.close()
      if (store) { await store.close() }
      store = null
    })

    // a flags file of one accepted decision on the workhorse score, and then
    // the empty deck of another device to open it in
    let exportedWorkhorse = async () => {
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), source)
      await decideFlags(piece.id,
        [acceptDecision({
          record: source.annotation(piece.id), flag: flagsInForce(source.annotation(piece.id))[0],
          by: "Ms Laurent", at: Date.now(),
        })], source)
      let text = (await exportFlagsFile(piece.id, {by: "Ms Laurent"}, source)).text
      store = await openTestStore()
      return text
    }

    // the same score stored under another title, as a piece imported before
    // annotations were kept is: with no record
    let putUnanalysed = (id, title, xml) => store.putPiece({
      id, title, song: songToJSON(parseMusicXML(xml)), importedAt: Date.now(),
    }, {source: xml})

    it("yields to the event loop between the deck's pieces, finding what it did before", async function() {
      let exported = await exportedWorkhorse()

      // a deck whose pieces are all analysed and none of them titled as the
      // file is, the matching one last, so every piece is aligned against
      for (let [name, xml] of [
        ["minuet", pickupScore()], ["waltz", LITTLE_WALTZ_XML], ["key change", keyChangeScore()],
        ["reverie", reverieOpening()],
      ]) {
        await importMusicXMLPiece(`${name}.musicxml`, xml, store)
      }
      let {piece: match} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore(), store)
      await store.putPiece({...store.piece(match.id), title: "Same score, another title"})
      let ids = store.pieces().map(piece => piece.id)
      expect(ids.length).toEqual(5)

      // a macrotask counter ticking alongside, read as each piece is looked at
      let ticks = 0
      let running = true
      let tick = () => { ticks++; if (running) { setTimeout(tick, 0) } }
      setTimeout(tick, 0)

      let seen = []
      let annotation = store.annotation.bind(store)
      spyOn(store, "annotation").and.callFake(id => {
        if (ids.includes(id) && seen.length < ids.length) { seen.push([id, ticks]) }
        return annotation(id)
      })

      let {piece, error, message} = await importFlagsFile(exported, store)
      running = false

      expect(error).toBeUndefined()
      expect(piece.id).toEqual(match.id)
      expect(message).toContain("1 placed")

      // the loop was left between one piece and the next, not run through
      expect(seen.map(([id]) => id)).toEqual(ids)
      seen.slice(1).forEach(([, at], idx) => expect(at).toBeGreaterThan(seen[idx][1]))
    })

    it("finds the matching piece in the deck when it was never analysed", async function() {
      let exported = await exportedWorkhorse()
      await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)
      let unanalysed = await putUnanalysed("old", "Same score, another title", workhorseScore())
      expect(store.annotation(unanalysed.id)).toBe(null)

      let {piece, error, message} = await importFlagsFile(exported, store)
      expect(error).toBeUndefined()
      expect(piece.id).toEqual("old")
      expect(message).toContain("1 placed")

      let record = store.annotation("old")
      expect(record).toBeTruthy()
      expect(record.decisions.length).toEqual(1)
      expect(flagsInForce(record).some(flag => flag.status == "accepted")).toBe(true)
    })

    it("still says nothing in the deck matches when an unanalysed piece is another score", async function() {
      let exported = await exportedWorkhorse()
      await putUnanalysed("minuet", "Minuet", pickupScore())

      let {piece, error} = await importFlagsFile(exported, store)
      expect(piece).toBeUndefined()
      expect(error).toContain("No piece in the deck matches")
    })
  })

  describe("sheet music generator", function() {
    // the generator reads the app's store, so swap in the specs' one
    let store, appStore
    beforeEach(async function() {
      store = await openTestStore()
      appStore = setAppStore(store)
    })

    afterEach(async function() {
      setAppStore(appStore)
      await store.close()
    })

    it("drills Rêverie's opening measures as the score's onsets", async function() {
      let {piece} = await importMusicXMLPiece("reverie.musicxml", reverieOpening())
      let settings = {piece: piece.id, startMeasure: 1, endMeasure: 2, hand: BOTH_HANDS}

      // measure 1 has no notes; measure 2's tied G4 isn't struck again and
      // voice 6's whole note Bb3 shares the first column with voice 5's
      let measure2 = [["Bb3"], ["C4"], ["D4"], ["G4"], ["D4"], ["C4"], ["Bb3"]]
      expect(sheetMusicSection(grand, settings).columns).toEqual(measure2)
      expect(sheetMusicSection(grand, {...settings, hand: LEFT_HAND}).columns).toEqual(measure2)
      expect(sheetMusicSection(grand, {...settings, hand: RIGHT_HAND}).columns).toEqual([])

      // measure 4: the melody starts over the tied Bb3 and the tied G4
      expect(sheetMusicSection(grand, {...settings, startMeasure: 4, endMeasure: 4}).columns).toEqual([
        ["G5"], ["C4"], ["D4"], ["G4"], ["D5"], ["D4"], ["C4"], ["Bb3"],
      ])
    })

    it("draws a picked piece in the score's key at its start measure", async function() {
      let generator = SHEET_MUSIC_GENERATOR
      let pieceInput = generator.inputs.find(i => i.name == "piece")

      let {piece} = await importMusicXMLPiece("reverie.musicxml", reverieOpening())
      let {settings: picked, staff} = pieceInput.pick({}, piece.id)
      expect([picked.piece, picked.startMeasure, picked.endMeasure, picked.hand]).toEqual([piece.id, 1, 4, BOTH_HANDS])
      expect(staff).toEqual("grand")
      // the section's start measure sets the key in free practice; the programme plays the whole piece
      let settings = {...picked, practice: FREE_PRACTICE}
      expect(generator.keySignature(settings).name()).toEqual("F")

      let changing = (await importMusicXMLPiece("key_change.musicxml", keyChangeScore())).piece
      let changingSettings = {...pieceInput.pick({}, changing.id).settings, practice: FREE_PRACTICE}
      expect(generator.keySignature(changingSettings).name()).toEqual("F")
      expect(generator.keySignature({...changingSettings, startMeasure: 3}).name()).toEqual("E")

      expect(generator.keySignature({piece: "missing"})).toBe(null)
    })

    it("drills the picked piece and falls back to the notation once it's removed", async function() {
      let {piece} = await importMusicXMLPiece("minuet.musicxml", pickupScore())

      let settings = {
        piece: piece.id, song: "c4 d4", startMeasure: 0, endMeasure: 0,
        hand: BOTH_HANDS, track: "all",
      }

      expect(sheetMusicSection(grand, settings).columns).toEqual([["D5"]])

      await removePiece(piece.id)
      expect(sheetMusicSection(grand, {...settings, endMeasure: 1}).columns).toEqual([["C4"], ["D4"]])
    })

    it("offers the piece's flagged passages as quick picks in free practice only", async function() {
      let passageInput = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "passage")
      let {piece} = await importMusicXMLPiece("workhorse.musicxml", workhorseScore())

      let free = {piece: piece.id, practice: "free practice", startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS}
      expect(passageInput.visible(free)).toBe(true)
      let flags = passageInput.values(free)
      expect(flags.length).toBeGreaterThan(0)
      expect(flags[0].id.startsWith("score:")).toBe(true)

      let picked = passageInput.update(free, flags[0])
      expect(picked.startMeasure).toEqual(flags[0].start)
      expect(picked.endMeasure).toEqual(flags[0].end)
      expect(picked.measuresPerCard).toEqual("all")
      expect(picked.practice).toEqual("free practice")

      // absent in today's programme
      let planned = {...free, practice: "programme"}
      expect(passageInput.visible(planned)).toBe(false)

      // absent for a piece without passages
      let {piece: short} = await importMusicXMLPiece("minuet.musicxml", pickupScore())
      let shortSettings = {...free, piece: short.id}
      expect(passageInput.values(shortSettings)).toEqual([])
      expect(passageInput.visible(shortSettings)).toBe(false)
    })
  })
})
