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
  sheetMusicKeyFor, measuresDescription, GENERATORS, BOTH_HANDS, RIGHT_HAND, LEFT_HAND
} from "st/data"

import {setAppStore} from "st/storage"
import {openTestStore, pickupScore, noteXML, reverieOpening, keyChangeScore} from "spec/helpers"

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

    it("keeps the ratio of a triplet the score writes late in the piece", function() {
      // six 4/4 bars of whole notes, the last a triplet of quarters and a
      // half: part 2 draws the brackets and beams from the stored ratio
      let song = parseMusicXML(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${Array.from({length: 5}, (_, idx) => `
    <measure number="${idx + 1}">
      ${idx == 0 ? `<attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : ""}
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

      let reopened = await openTestStore({keep: true})
      expect(pieceSong(findPiece(old.id, reopened)).metadata.measureKeySignatures).toEqual([-1, -1, -1, -1])
      await reopened.close()
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
      let generator = GENERATORS.find(g => g.name == "sheet music")
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
