import {parseMusicXML, COMPRESSED_MESSAGE} from "st/musicxml"
import {MultiTrackSong, SongNote} from "st/song_note_list"

import {
  extractSectionColumns, measureBeatRange, measureNumberRange, staffTracks
} from "st/song_sections"

import {
  songToJSON, songFromJSON, loadDeck, findPiece, pieceSong, addPiece,
  removePiece, importMusicXMLPiece, MAX_PIECES
} from "st/sheet_music_deck"

import {
  pieceSection, sheetMusicSection, sheetMusicPieceSettings, sheetMusicStaffFor,
  measuresDescription, BOTH_HANDS, RIGHT_HAND, LEFT_HAND
} from "st/data"

import {setAppStore} from "st/storage"
import {openTestStore} from "spec/helpers"

let tuples = notes => [...notes]
  .map(n => [n.note, n.start, n.duration])
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))

let noteXML = (step, octave, duration, staff, extra="") => `
<note>
  <pitch><step>${step}</step><octave>${octave}</octave></pitch>
  <duration>${duration}</duration>
  <staff>${staff}</staff>
  ${extra}
</note>`

// A 3/4 piano minuet opening with a one beat pickup, numbered like a score:
//   pickup (0): treble D5
//   1: treble G4 A4 B4, bass G3 (dotted half)
//   2: treble C5 (dotted half), bass C3 E3 G3 chord (dotted half)
let pickupScore = ({title="Pickup Minuet", clefs=[["G", 2], ["F", 4]]}={}) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${title ? `<work><work-title>${title}</work-title></work>` : ""}
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>1</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        ${clefs.map(([sign, line], idx) =>
          `<clef number="${idx + 1}"><sign>${sign}</sign><line>${line}</line></clef>`).join("")}
      </attributes>
      ${noteXML("D", 5, 1, 1)}
    </measure>
    <measure number="1">
      ${noteXML("G", 4, 1, 1)}
      ${noteXML("A", 4, 1, 1)}
      ${noteXML("B", 4, 1, 1)}
      <backup><duration>3</duration></backup>
      ${noteXML("G", 3, 3, 2)}
    </measure>
    <measure number="2">
      ${noteXML("C", 5, 3, 1)}
      <backup><duration>3</duration></backup>
      ${noteXML("C", 3, 3, 2)}
      ${noteXML("E", 3, 3, 2, "<chord/>")}
      ${noteXML("G", 3, 3, 2, "<chord/>")}
    </measure>
  </part>
</score-partwise>`

const grand = {name: "grand", range: ["C3", "C7"]}
const treble = {name: "treble", range: ["A4", "C7"]}

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

    it("stores notes compactly and rounds float beats", function() {
      let song = new MultiTrackSong()
      song.metadata = {beatsPerMeasure: 4}
      song.pushWithTrack(new SongNote("C5", 1 / 3, 1 / 3), 0)

      let data = songToJSON(song)
      expect(data.tracks).toEqual([{notes: ["C5", 0.333333, 0.333333]}])
      expect(JSON.stringify(data)).not.toContain("<")
    })

    it("refuses stored data of the wrong shape", function() {
      expect(() => songFromJSON(null)).toThrow()
      expect(() => songFromJSON({format: 99, tracks: []})).toThrow()
      expect(() => songFromJSON({format: 1, tracks: [{notes: ["C5", 0]}]})).toThrow()
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

      expect(extractSectionColumns(song, {startMeasure: 0, endMeasure: 0})).toEqual([["D6"]])
      expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([
        ["G4", "G5"], ["A5"], ["B5"],
      ])
      expect(extractSectionColumns(song, {startMeasure: 2, endMeasure: 5})).toEqual([
        ["C4", "E4", "G4", "C6"],
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
      expect(extractSectionColumns(song, {startMeasure: 1, endMeasure: 1})).toEqual([["G5"]])
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
        ["D6"], ["E6"], ["F6"],
      ])

      // a start before the first measure starts at the first measure
      expect(extractSectionColumns(song, {startMeasure: 0, endMeasure: 1})).toEqual([["C6"]])
    })
  })

  describe("hand filter", function() {
    it("drills a hand by the staff its clef puts it on", function() {
      let song = parseMusicXML(pickupScore())
      expect(staffTracks(song)).toEqual({treble: [0], bass: [1]})

      let settings = {startMeasure: 1, endMeasure: 2}

      expect(pieceSection(grand, {...settings, hand: RIGHT_HAND}, song).columns).toEqual([
        ["G5"], ["A5"], ["B5"], ["C6"],
      ])

      expect(pieceSection(grand, {...settings, hand: LEFT_HAND}, song).columns).toEqual([
        ["G4"], ["C4", "E4", "G4"],
      ])

      expect(pieceSection(grand, {...settings, hand: BOTH_HANDS}, song).columns).toEqual([
        ["G4", "G5"], ["A5"], ["B5"], ["C4", "E4", "G4", "C6"],
      ])
    })

    it("follows the clefs rather than the staff order", function() {
      // staff 1 written in bass clef, staff 2 in treble clef
      let song = parseMusicXML(pickupScore({clefs: [["F", 4], ["G", 2]]}))
      expect(staffTracks(song)).toEqual({treble: [1], bass: [0]})

      let {columns} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([["G5"], ["A5"], ["B5"]])
    })

    it("falls back to track order when both staves open in the same clef", function() {
      // the lower staff opens in treble clef, switching to bass clef later
      let song = parseMusicXML(pickupScore({clefs: [["G", 2], ["G", 2]]}))
      expect(staffTracks(song)).toEqual({treble: [0], bass: [1]})
      expect(sheetMusicStaffFor(song)).toEqual("grand")

      let {columns, status} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([["G4"]])
      expect(status).not.toContain("no bass staff")

      let upperBass = parseMusicXML(pickupScore({clefs: [["F", 4], ["F", 4]]}))
      expect(staffTracks(upperBass)).toEqual({treble: [0], bass: [1]})
    })

    it("falls back to track order without clefs", function() {
      let song = parseMusicXML(pickupScore({clefs: []}))
      expect(song.tracks.every(track => !track.cleffs)).toBe(true)
      expect(staffTracks(song)).toEqual({treble: [0], bass: [1]})

      let {columns} = pieceSection(grand, {startMeasure: 1, endMeasure: 1, hand: LEFT_HAND}, song)
      expect(columns).toEqual([["G4"]])
    })

    it("reports a hand the score doesn't have", function() {
      let song = new MultiTrackSong()
      song.metadata = {beatsPerMeasure: 4, measureStarts: [0], measureNumbers: [1]}
      song.pushWithTrack(new SongNote("C5", 0, 1), 0)
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

      // stored as song JSON, not MusicXML
      expect(JSON.stringify(await store.backend.getAll("pieces"))).not.toContain("score-partwise")
      expect(loadDeck(store).pieces.map(p => p.title)).toEqual(["Pickup Minuet"])

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

    it("refuses compressed and broken files", async function() {
      expect((await importMusicXMLPiece("nocturne.mxl", "whatever", store)).error).toEqual(COMPRESSED_MESSAGE)
      expect((await importMusicXMLPiece("nocturne.xml", "PK\u0003\u0004zipdata", store)).error).toEqual(COMPRESSED_MESSAGE)
      expect((await importMusicXMLPiece("broken.xml", "<score-partwise>", store)).error).toContain("well-formed")
      expect(loadDeck(store).pieces).toEqual([])
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

    it("drills the picked piece and falls back to the notation once it's removed", async function() {
      let {piece} = await importMusicXMLPiece("minuet.musicxml", pickupScore())

      let settings = {
        piece: piece.id, song: "c5 d5", startMeasure: 0, endMeasure: 0,
        hand: BOTH_HANDS, track: "all",
      }

      expect(sheetMusicSection(grand, settings).columns).toEqual([["D6"]])

      await removePiece(piece.id)
      expect(sheetMusicSection(grand, {...settings, endMeasure: 1}).columns).toEqual([["C5"], ["D5"]])
    })
  })
})
