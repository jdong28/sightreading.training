import {zipSync} from "fflate"
import {
  parseMusicXML, COMPRESSED_MESSAGE, DAMAGED_ARCHIVE_MESSAGE, NO_SCORE_MESSAGE
} from "st/musicxml"
import {MultiTrackSong, SongNote} from "st/song_note_list"

import {
  extractSectionColumns, measureBeatRange, measureNumberRange, staffTracks
} from "st/song_sections"

import {
  songToJSON, songFromJSON, loadDeck, findPiece, pieceSong, pieceSource, addPiece,
  removePiece, importMusicXMLPiece, MAX_PIECES
} from "st/sheet_music_deck"

import {
  pieceSection, pieceSectionMeasures, sheetMusicSection, sheetMusicPieceSettings, sheetMusicStaffFor,
  sheetMusicKeyFor, measuresDescription, SHEET_MUSIC_GENERATOR, BOTH_HANDS, RIGHT_HAND, LEFT_HAND
} from "st/data"

import {setAppStore} from "st/storage"
import {
  openTestStore, pickupScore, noteXML, reverieOpening, keyChangeScore, nocturneBars5to6,
  tiedTrillScore, LITTLE_WALTZ_XML, littleWaltzMXL
} from "spec/helpers"

let tuples = notes => [...notes]
  .map(n => [n.note, n.start, n.duration])
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))

const grand = {name: "grand", range: ["C2", "C6"]}
const treble = {name: "treble", range: ["A3", "C6"]}

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

      expect(stored.format).toEqual(3)
      // one entry a note of the right hand's track, as its notation
      expect(stored.tracks[0].ornaments).toEqual([
        null, {neighbours: ["G#5"], trill: true}, {graces: ["E5", "F#5"]}, null,
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

      expect(stored.tracks[0].ornaments).toEqual([{neighbours: ["D5"], trill: true, at: 4}])

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
      expect(findPiece("old", store).song.format).toEqual(3)
      expect(columns().length).toEqual(16)
      expect(columns()[4].allowed).toEqual(["G#5"])
      expect(columns()[8].allowed).toEqual(["E5", "F#5"])
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
      let {settings, staff} = pieceInput.pick({}, piece.id)
      expect([settings.piece, settings.startMeasure, settings.endMeasure, settings.hand]).toEqual([piece.id, 1, 4, BOTH_HANDS])
      expect(staff).toEqual("grand")
      expect(generator.keySignature(settings).name()).toEqual("F")

      let changing = (await importMusicXMLPiece("key_change.musicxml", keyChangeScore())).piece
      let changingSettings = pieceInput.pick({}, changing.id).settings
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
  })
})
