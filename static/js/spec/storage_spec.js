import {MultiTrackSong, SongNote} from "st/song_note_list"
import {songToJSON, exportLibraryFile, importLibraryFile, MAX_PIECES, pieceSong} from "st/sheet_music_deck"
import NoteStats from "st/note_stats"
import {parseNote} from "st/music"
import {openDB, deleteDB} from "idb"

import {
  LEGACY_DECK_KEY, DECK_MIGRATION_MARKER, LIBRARY_FORMAT, LIBRARY_VERSION,
  RECENT_SESSION_DAYS, DB_VERSION, SCORE_ENDED_KEY
} from "st/storage"

import {compressSource, bytesToBase64, SOURCE_ENCODING} from "st/score_source"
import {newItem, validBarLog} from "st/srs/records"
import {newLessonNote} from "st/lesson_notes"
import {GOOD} from "st/srs/grade"

import {
  openTestStore, MemoryStorage, TEST_DB_NAME, reverieOpening, LITTLE_WALTZ_XML
} from "spec/helpers"

const DAY = 24 * 60 * 60 * 1000

let songData = (...notes) => {
  let song = new MultiTrackSong()
  notes.forEach((note, idx) => song.pushWithTrack(new SongNote(note, idx, 1), 0))
  song.metadata = {title: "Song", beatsPerMeasure: 4}
  return songToJSON(song)
}

let pieceData = (id, title, importedAt, notes=["C4", "D4"]) =>
  ({id, title, importedAt, song: songData(...notes)})

// the stores of the version 1 and 2 databases, before pieceSources
let upgradeToVersion2 = db => {
  db.createObjectStore("pieces", {keyPath: "id"})
  db.createObjectStore("sectionStats", {keyPath: ["pieceId", "startMeasure", "endMeasure"]})
    .createIndex("pieceId", "pieceId")
  db.createObjectStore("sessions", {keyPath: "id"}).createIndex("startedAt", "startedAt")
  db.createObjectStore("meta", {keyPath: "key"})
}

let section = (pieceId, startMeasure, endMeasure, extra={}) => ({
  pieceId, startMeasure, endMeasure, hits: 3, misses: 1, attempts: 1,
  lastPracticed: 1000, ...extra,
})

describe("local store", function() {
  // every store a spec opens, closed after it so the next spec can empty the
  // database
  let opened
  let open = async opts => {
    let store = await openTestStore(opts)
    opened.push(store)
    return store
  }

  beforeEach(function() {
    opened = []
  })

  afterEach(async function() {
    for (let store of opened) {
      await store.close()
    }
  })

  describe("init", function() {
    it("starts empty and loads what was written into the cache", async function() {
      let store = await open()
      expect(store.persistent).toBe(true)
      expect(store.pieces()).toEqual([])
      expect(store.sectionStats()).toEqual([])
      expect(store.recentSessions()).toEqual([])

      await store.putPiece(pieceData("b", "Second", 2000))
      await store.putPiece(pieceData("a", "First", 1000))
      await store.recordSectionPractice(section("a", 1, 4))

      let reopened = await open({keep: true})
      expect(reopened.pieces().map(piece => piece.title)).toEqual(["First", "Second"])
      expect(reopened.piece("b").song).toEqual(songData("C4", "D4"))
      expect(reopened.sectionStats("a").length).toEqual(1)
      expect(reopened.sectionStats("b")).toEqual([])
    })

    it("reads synchronously from a cache that stays the same until a write", async function() {
      let store = await open()
      let pieces = store.pieces()
      expect(store.pieces()).toBe(pieces)

      let write = store.putPiece(pieceData("a", "First", 1000))
      expect(store.pieces()).toBe(pieces) // the database is written first
      await write

      expect(store.pieces()).not.toBe(pieces)
      expect(store.pieces().map(piece => piece.id)).toEqual(["a"])
    })

    it("only loads recent sessions", async function() {
      let store = await open()
      let now = Date.now()
      await store.putSession({id: "old", startedAt: now - (RECENT_SESSION_DAYS + 1) * DAY})
      await store.putSession({id: "recent", startedAt: now - DAY})

      let reopened = await open({keep: true})
      expect(reopened.recentSessions().map(s => s.id)).toEqual(["recent"])
    })

    it("falls back to memory when IndexedDB can't be opened", async function() {
      spyOn(window.indexedDB, "open").and.throwError(new DOMException("blocked", "SecurityError"))
      spyOn(console, "warn")

      let store = await open({
        localStorage: new MemoryStorage({
          [LEGACY_DECK_KEY]: JSON.stringify({pieces: [pieceData("a", "Legacy")]}),
        }),
      })

      expect(store.persistent).toBe(false)
      expect(console.warn).toHaveBeenCalled()
      expect(console.warn.calls.argsFor(0)[0]).toContain("kept in memory")

      // the legacy deck is still readable, and writes work for the visit
      expect(store.pieces().map(piece => piece.title)).toEqual(["Legacy"])
      await store.putPiece(pieceData("b", "New", Date.now() + 1000))
      await store.recordSectionPractice(section("b", 1, 2))
      expect(store.pieces().map(piece => piece.id)).toEqual(["a", "b"])
      expect(store.sectionStats("b").length).toEqual(1)
    })
  })

  describe("schema upgrade", function() {
    it("renumbers the note names of pieces stored when middle C was C5", async function() {
      await deleteDB(TEST_DB_NAME)

      // the version 1 database
      let db = await openDB(TEST_DB_NAME, 1, {upgrade: upgradeToVersion2})
      await db.put("pieces", pieceData("p1", "Minuet", 1000, ["C5", "D#6", "Gb3"]))
      await db.put("pieces", {...pieceData("p2", "Waltz", 2000, ["A5"]), fileName: "waltz.musicxml"})
      await db.put("sectionStats", section("p1", 1, 4))
      await db.put("meta", {key: DECK_MIGRATION_MARKER, migratedAt: 1, pieces: 0})
      db.close()

      let store = await open({keep: true})
      expect(store.persistent).toBe(true)
      expect(store.piece("p1").song).toEqual(songData("C4", "D#5", "Gb2"))
      expect([...pieceSong(store.piece("p1")).tracks[0]].map(note => parseNote(note.note))).toEqual([60, 75, 42])
      expect(store.piece("p2")).toEqual({...pieceData("p2", "Waltz", 2000, ["A4"]), fileName: "waltz.musicxml"})
      expect(store.sectionStats("p1")).toEqual([section("p1", 1, 4)])

      // and upgraded on through the later versions
      expect(await store.pieceSource("p1")).toBe(null)

      // renumbered once: reopening leaves the pieces alone
      await store.close()
      let reopened = await open({keep: true})
      expect(reopened.piece("p1").song).toEqual(songData("C4", "D#5", "Gb2"))
    })

    it("adds the store of piece sources, keeping the stored pieces as they are", async function() {
      await deleteDB(TEST_DB_NAME)

      // the version 2 database, its pieces already named with middle C "C4"
      let db = await openDB(TEST_DB_NAME, 2, {upgrade: upgradeToVersion2})
      let minuet = {...pieceData("p1", "Minuet", 1000, ["C4", "E4"]), fileName: "minuet.musicxml"}
      await db.put("pieces", minuet)
      await db.put("sectionStats", section("p1", 1, 4))
      await db.put("meta", {key: DECK_MIGRATION_MARKER, migratedAt: 1, pieces: 0})
      db.close()

      let store = await open({keep: true})
      expect(store.persistent).toBe(true)
      expect(store.backend.db.version).toEqual(DB_VERSION)
      expect([...store.backend.db.objectStoreNames]).toContain("pieceSources")

      // the piece still loads and drills, without a source
      expect(store.pieces()).toEqual([minuet])
      expect([...pieceSong(store.piece("p1")).tracks[0]].map(note => note.note)).toEqual(["C4", "E4"])
      expect(store.sectionStats("p1")).toEqual([section("p1", 1, 4)])
      expect(await store.pieceSource("p1")).toBe(null)

      // and gains one when its score is imported again
      expect(await store.putPieceSource("p1", LITTLE_WALTZ_XML)).toBe(true)
      await store.close()

      let reopened = await open({keep: true})
      expect(reopened.pieces()).toEqual([minuet])
      expect(await reopened.pieceSource("p1")).toEqual(LITTLE_WALTZ_XML)
      expect(reopened.sectionStats("p1")).toEqual([section("p1", 1, 4)])
    })

    it("adds the annotations store, leaving every other store's records exactly as they were", async function() {
      await deleteDB(TEST_DB_NAME)

      // the version 4 database, before annotations
      let db = await openDB(TEST_DB_NAME, 4, {
        upgrade(db) {
          db.createObjectStore("pieces", {keyPath: "id"})
          db.createObjectStore("pieceSources", {keyPath: "pieceId"})
          db.createObjectStore("sectionStats", {keyPath: ["pieceId", "startMeasure", "endMeasure"]})
            .createIndex("pieceId", "pieceId")
          db.createObjectStore("sessions", {keyPath: "id"}).createIndex("startedAt", "startedAt")
          db.createObjectStore("meta", {keyPath: "key"})
          db.createObjectStore("items", {keyPath: "id"}).createIndex("pieceId", "pieceId")
          db.createObjectStore("reviews", {keyPath: ["itemId", "at"]}).createIndex("pieceId", "pieceId")
          db.createObjectStore("studies", {keyPath: "pieceId"})
        },
      })

      let minuet = pieceData("p1", "Minuet", 1000)
      let item = {
        id: "p1:both:1-4", pieceId: "p1", hand: "both", startMeasure: 1, endMeasure: 4,
        level: "span", state: "tracked", step: 0, reps: 0, lapses: 0, streak: 0,
        hits: 1, misses: 0, attempts: 1, lastPracticed: 1000, recent: [], algo: 0, createdAt: 1,
      }
      let study = {pieceId: "p1"}

      await db.put("pieces", minuet)
      await db.put("items", item)
      await db.put("studies", study)
      await db.put("meta", {key: DECK_MIGRATION_MARKER, migratedAt: 1, pieces: 0})
      db.close()

      let store = await open({keep: true})
      expect(store.persistent).toBe(true)
      expect(store.backend.db.version).toEqual(DB_VERSION)
      expect([...store.backend.db.objectStoreNames]).toContain("annotations")

      expect(store.pieces()).toEqual([minuet])
      expect(store.items("p1")).toEqual([item])
      expect(store.studies()).toEqual([study])
      expect(store.annotations()).toEqual([])
      expect(store.annotation("p1")).toBe(null)
    })
  })

  describe("piece sources", function() {
    it("keeps a piece's source out of the cache and reads it on demand", async function() {
      let xml = reverieOpening()
      let store = await open()
      let stored = await store.putPiece(pieceData("a", "Rêverie", 1000), {source: xml})

      // the cached piece is the piece alone
      expect(Object.keys(stored).sort()).toEqual(["id", "importedAt", "song", "title"])
      expect(store.pieces()).toEqual([pieceData("a", "Rêverie", 1000)])
      expect(await store.pieceSource("a")).toEqual(xml)

      // stored gzipped
      let record = await store.backend.get("pieceSources", "a")
      expect(record.encoding).toEqual(SOURCE_ENCODING)
      expect(record.data instanceof Uint8Array).toBe(true)
      expect(record.data.length).toBeLessThan(xml.length / 5)

      await store.close()
      let reopened = await open({keep: true})
      expect(reopened.pieces()).toEqual([pieceData("a", "Rêverie", 1000)])
      expect(await reopened.pieceSource("a")).toEqual(xml)
    })

    it("keeps, replaces and removes a source with its piece", async function() {
      let store = await open()
      expect(await store.pieceSource("a")).toBe(null)

      await store.putPiece(pieceData("a", "First", 1000), {source: "<first/>"})
      await store.putPiece(pieceData("b", "Second", 2000))
      expect(await store.pieceSource("b")).toBe(null)

      // written again without one, the piece keeps its source
      await store.putPiece(pieceData("a", "First", 1000, ["G4"]))
      expect(await store.pieceSource("a")).toEqual("<first/>")

      await store.putPiece(pieceData("a", "First", 1000), {source: "<second/>"})
      expect(await store.pieceSource("a")).toEqual("<second/>")

      await store.putPiece(pieceData("a", "First", 1000), {source: null})
      expect(await store.pieceSource("a")).toBe(null)

      expect(await store.putPieceSource("a", "<third/>")).toBe(true)
      expect(await store.pieceSource("a")).toEqual("<third/>")

      // removed with its piece, so a piece stored again under the id has none
      await store.deletePiece("a")
      expect(await store.pieceSource("a")).toBe(null)
      await store.putPiece(pieceData("a", "First", 1000))
      expect(await store.pieceSource("a")).toBe(null)

      // nothing is stored for a piece that isn't in the library
      expect(await store.putPieceSource("missing", "<score/>")).toBe(false)
      expect(await store.backend.get("pieceSources", "missing")).toBeUndefined()
    })

    it("refuses a source that isn't MusicXML text, writing nothing", async function() {
      let store = await open()
      await expectAsync(store.putPiece(pieceData("a", "First", 1000), {source: "  "}))
        .toBeRejectedWithError("Not a valid piece source")
      expect(store.pieces()).toEqual([])

      await store.putPiece(pieceData("a", "First", 1000))
      await expectAsync(store.putPieceSource("a", 42)).toBeRejectedWithError("Not a valid piece source")
      expect(await store.pieceSource("a")).toBe(null)
    })

    it("resolves null for a stored source that can't be read", async function() {
      spyOn(console, "warn")
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      await store.backend.write([{store: "pieceSources", put: {
        pieceId: "a", encoding: SOURCE_ENCODING, data: new Uint8Array([1, 2, 3]), storedAt: 1,
      }}])

      expect(await store.pieceSource("a")).toBe(null)
      expect(console.warn).toHaveBeenCalled()
    })

    it("keeps sources for the visit when the store is in memory", async function() {
      let store = await open({persist: false})
      await store.putPiece(pieceData("a", "First", 1000), {source: LITTLE_WALTZ_XML})
      expect(await store.pieceSource("a")).toEqual(LITTLE_WALTZ_XML)

      await store.deletePiece("a")
      expect(await store.pieceSource("a")).toBe(null)
    })
  })

  describe("annotations", function() {
    let flag = () => ({
      id: "score:1-2:aaaaaaaa", source: "score", start: 1, end: 2, startIndex: 0, endIndex: 1,
      hand: "both", level: 2, kinds: ["speed"], title: "The densest bars",
      reason: "Dense writing.", reasons: ["Dense writing."], tip: "Slowly at first.",
    })
    let annotationFor = (pieceId, overrides={}) => ({
      pieceId,
      fingerprint: {algo: 1, numbersHash: "abc", bars: ["x", "y"]},
      proposals: [flag()],
      decisions: [],
      runs: {score: {algo: 1, at: 1, source: false, tempo: null, heat: [0, 1]}},
      ...overrides,
    })

    for (let persist of [true, false]) {
      describe(persist ? "in IndexedDB" : "in memory", function() {
        it("stores, caches synchronously after the write, and survives reopening", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))

          let record = annotationFor("a")
          let stored = await store.putAnnotation(record)
          expect(stored).toEqual(record)
          expect(store.annotation("a")).toEqual(record) // cached synchronously
          expect(store.annotations()).toEqual([record])

          if (persist) {
            await store.close()
            let reopened = await open({keep: true})
            expect(reopened.annotation("a")).toEqual(record)
          }
        })

        it("refuses a record of no stored piece or of the wrong shape, leaving the cache untouched", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.putAnnotation(annotationFor("a"))

          await expectAsync(store.putAnnotation(annotationFor("unknown"))).toBeRejected()
          await expectAsync(store.putAnnotation({...annotationFor("a"), proposals: "not an array"})).toBeRejected()

          expect(store.annotations()).toEqual([annotationFor("a")])
        })

        it("deletePiece deletes the piece's annotation", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.putAnnotation(annotationFor("a"))

          await store.deletePiece("a")
          expect(store.annotation("a")).toBe(null)
          expect(store.annotations()).toEqual([])
        })

        it("updateAnnotation serialises with another write, so a decision isn't lost to a concurrent analysis write", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.putAnnotation(annotationFor("a"))

          let analysisWrite = store.updateAnnotation("a", current =>
            ({...current, runs: {...current.runs, score: {...current.runs.score, at: 2}}}))
          let decisionWrite = store.updateAnnotation("a", current => ({
            ...current,
            decisions: [...current.decisions, {flagId: "x", action: "accept", at: 1, by: "", anchor: {bars: []}}],
          }))

          await Promise.all([analysisWrite, decisionWrite])

          let stored = store.annotation("a")
          expect(stored.runs.score.at).toEqual(2)
          expect(stored.decisions.length).toEqual(1)
        })

        it("importLibrary unions a library's annotation decisions into an existing same-song record", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          let decision = {flagId: "x", action: "accept", at: 1, by: "", anchor: {bars: []}}
          await store.putAnnotation(annotationFor("a", {decisions: [decision]}))

          let data = {
            format: LIBRARY_FORMAT, version: LIBRARY_VERSION,
            pieces: [pieceData("a", "First", 1000)],
            annotations: [annotationFor("a", {
              decisions: [decision, {flagId: "y", action: "dismiss", at: 2, by: "", anchor: {bars: []}}],
            })],
          }

          let report = await store.importLibrary(data)
          expect(report.addedDecisions).toEqual(1)
          expect(report.addedAnnotations).toEqual(0)
          expect(store.annotation("a").decisions.length).toEqual(2)

          // importing the very same library again adds nothing more
          let again = await store.importLibrary(data)
          expect(again.addedDecisions).toEqual(0)
          expect(store.annotation("a").decisions.length).toEqual(2)
        })

        it("importLibrary adds a library's annotation whole for a piece with no record yet", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))

          let data = {
            format: LIBRARY_FORMAT, version: LIBRARY_VERSION,
            pieces: [pieceData("a", "First", 1000)],
            annotations: [annotationFor("a")],
          }

          let report = await store.importLibrary(data)
          expect(report.addedAnnotations).toEqual(1)
          expect(report.addedDecisions).toEqual(0)
          expect(store.annotation("a")).toEqual(annotationFor("a"))
        })
      })
    }
  })

  describe("legacy deck migration", function() {
    let legacy = () => new MemoryStorage({
      [LEGACY_DECK_KEY]: JSON.stringify({pieces: [
        // written while note names put middle C at "C5"
        {id: "p1", title: "Minuet", song: songData("G5")},
        {id: 5, title: "Broken"},
        {id: "p2", title: "Waltz", song: songData("A5")},
      ]}),
    })

    it("moves the localStorage deck into the pieces store once", async function() {
      let localStorage = legacy()
      let store = await open({localStorage})

      expect(store.pieces().map(piece => [piece.id, piece.title])).toEqual([["p1", "Minuet"], ["p2", "Waltz"]])
      expect(typeof store.piece("p1").importedAt).toEqual("number")
      expect(store.piece("p1").song).toEqual(songData("G4"))
      expect(store.piece("p2").song).toEqual(songData("A4"))

      let marker = await store.backend.get("meta", DECK_MIGRATION_MARKER)
      expect(marker.pieces).toEqual(2)

      // the old key is left alone
      expect(localStorage.getItem(LEGACY_DECK_KEY)).toContain("Minuet")

      // a removed piece stays removed: the migration never runs again
      await store.deletePiece("p1")
      let reopened = await open({keep: true, localStorage})
      expect(reopened.pieces().map(piece => piece.id)).toEqual(["p2"])
    })

    it("marks the migration done without a legacy deck", async function() {
      let store = await open()
      expect(store.pieces()).toEqual([])
      expect(await store.backend.get("meta", DECK_MIGRATION_MARKER)).toBeTruthy()

      // a deck showing up later isn't migrated
      let reopened = await open({keep: true, localStorage: legacy()})
      expect(reopened.pieces()).toEqual([])
    })

    it("ignores a malformed legacy deck", async function() {
      let store = await open({localStorage: new MemoryStorage({[LEGACY_DECK_KEY]: "not json"})})
      expect(store.pieces()).toEqual([])
      expect(await store.backend.get("meta", DECK_MIGRATION_MARKER)).toBeTruthy()
    })
  })

  describe("write through", function() {
    it("persists pieces and removes a piece with its section stats", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      await store.putPiece(pieceData("b", "Second", 2000))
      await store.recordSectionPractice(section("a", 1, 4))
      await store.recordSectionPractice(section("b", 1, 4))

      // replacing keeps one record
      await store.putPiece({...pieceData("a", "First, renamed", 1000), extra: "dropped"})
      expect(store.pieces().map(piece => piece.title)).toEqual(["First, renamed", "Second"])
      expect(store.piece("a").extra).toBeUndefined()

      expect(await store.deletePiece("a")).toBe(true)
      expect(await store.deletePiece("a")).toBe(false)

      let reopened = await open({keep: true})
      expect(reopened.pieces().map(piece => piece.id)).toEqual(["b"])
      expect(reopened.sectionStats().map(s => s.pieceId)).toEqual(["b"])
    })

    it("accumulates practice per section", async function() {
      let store = await open()
      await store.recordSectionPractice({pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 5, misses: 2, at: 2000})
      await store.recordSectionPractice({pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 3, misses: 0, at: 3000})
      await store.recordSectionPractice({pieceId: "a", startMeasure: 5, endMeasure: 8, hits: 1, misses: 1, at: 2500})

      let reopened = await open({keep: true})
      let stats = reopened.sectionStats("a").sort((x, y) => x.startMeasure - y.startMeasure)
      expect(stats).toEqual([
        {pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 8, misses: 2, attempts: 2, lastPracticed: 3000},
        {pieceId: "a", startMeasure: 5, endMeasure: 8, hits: 1, misses: 1, attempts: 1, lastPracticed: 2500},
      ])
    })

    it("adds up the time spent on a section once it is timed", async function() {
      let store = await open()
      let practice = {pieceId: "a", startMeasure: 3, endMeasure: 3, hits: 1, misses: 0, at: 1000}
      await store.recordSectionPractice(practice)
      expect(store.sectionStats("a")[0].elapsedMs).toBeUndefined()

      await store.recordSectionPractice({...practice, elapsedMs: 1200.4})
      await store.recordSectionPractice(practice)
      await store.recordSectionPractice({...practice, elapsedMs: 800})

      let reopened = await open({keep: true})
      expect(reopened.sectionStats("a")).toEqual([
        {pieceId: "a", startMeasure: 3, endMeasure: 3, hits: 4, misses: 0, attempts: 4, lastPracticed: 1000, elapsedMs: 2000},
      ])
    })

    it("appends a pass tuple to the item's passes only when pass is given", async function() {
      let store = await open()
      let practice = {pieceId: "a", startMeasure: 3, endMeasure: 3, hits: 1, misses: 0, at: 1000}

      await store.recordSectionPractice(practice)
      expect(store.item("a:both:3-3").passes).toBeUndefined()

      await store.recordSectionPractice({...practice, at: 2000, pass: [4, 4, null]})
      expect(store.item("a:both:3-3").passes).toEqual([[2000, 4, 4, null]])

      await store.recordSectionPractice({...practice, at: 3000})
      expect(store.item("a:both:3-3").passes).toEqual([[2000, 4, 4, null]])
    })

    it("runs writes in order without losing concurrent updates", async function() {
      let store = await open()
      let practice = {pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 1, misses: 0}
      await Promise.all([1, 2, 3, 4, 5].map(() => store.recordSectionPractice(practice)))
      expect(store.sectionStats("a")[0].hits).toEqual(5)
      expect(store.sectionStats("a")[0].attempts).toEqual(5)
    })

    it("leaves the cache untouched when a write fails", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))

      spyOn(store.backend, "write").and.rejectWith(
        new DOMException("The quota has been exceeded.", "QuotaExceededError"))

      await expectAsync(store.putPiece(pieceData("b", "Second", 2000))).toBeRejected()
      await expectAsync(store.recordSectionPractice(section("a", 1, 2))).toBeRejected()
      expect(store.pieces().map(piece => piece.id)).toEqual(["a"])
      expect(store.sectionStats()).toEqual([])

      // later writes still run
      store.backend.write.and.callThrough()
      await store.putPiece(pieceData("b", "Second", 2000))
      expect(store.pieces().map(piece => piece.id)).toEqual(["a", "b"])
    })
  })

  describe("library export", function() {
    it("round trips pieces and section stats", async function() {
      let store = await open()
      await store.putPiece({...pieceData("a", "First", 1000), fileName: "first.musicxml"})
      await store.putPiece(pieceData("b", "Second", 2000, ["E4"]))
      await store.recordSectionPractice(section("a", 1, 4, {at: 1500}))
      await store.putSession({id: "recent", startedAt: Date.now() - DAY, notesRead: 12})
      await store.putSession({id: "old", startedAt: Date.now() - (RECENT_SESSION_DAYS + 1) * DAY, notesRead: 7})

      let file = await exportLibraryFile(store)
      expect(file.fileName).toMatch(/^sightreading-library-\d{4}-\d\d-\d\d\.json$/)

      let data = JSON.parse(file.text)
      expect(data.format).toEqual(LIBRARY_FORMAT)
      expect(data.version).toEqual(LIBRARY_VERSION)
      expect(data.pieces.length).toEqual(2)
      // every session, not only the recent ones in the cache
      expect(data.sessions.map(s => s.id)).toEqual(["old", "recent"])

      await store.close()
      let other = await open()
      let result = await importLibraryFile(file.text, other)
      expect(result.error).toBeUndefined()
      expect(result.message).toEqual("Added 2 pieces, stats for 1 section and 2 practice sessions")
      expect(other.recentSessions().map(s => s.id)).toEqual(["recent"])

      let reopened = await open({keep: true})
      expect(reopened.pieces()).toEqual(data.pieces)
      expect(reopened.items()).toEqual(data.items)
      expect(reopened.sectionStats()).toEqual([section("a", 1, 4, {lastPracticed: 1500})])
      expect(reopened.recentSessions()).toEqual([data.sessions[1]])

      // importing again adds nothing
      let again = await importLibraryFile(file.text, reopened)
      expect(again.message).toEqual("Added 0 pieces; 2 pieces already in the library")
      expect(again.report.addedSessions).toEqual(0)
      expect(again.report.existingSessions).toEqual(2)
      expect(reopened.pieces().length).toEqual(2)
      expect((await reopened.exportLibrary()).sessions.length).toEqual(2)
    })

    it("merges by id and content without duplicating", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      await store.putPiece(pieceData("local", "Same notes", 1500, ["F4"]))
      await store.recordSectionPractice(section("a", 1, 4, {at: 5000}))
      await store.recordSectionPractice(section("local", 1, 4, {at: 1000}))

      // a library of section stats, before items
      let library = {
        format: LIBRARY_FORMAT,
        version: 4,
        pieces: [
          pieceData("a", "First, elsewhere", 1000),
          // the same title and notes under another id
          pieceData("remote", "Same notes", 1500, ["F4"]),
          pieceData("c", "New", 3000, ["G4"]),
          {id: "broken"},
        ],
        sectionStats: [
          section("a", 1, 4, {hits: 99, lastPracticed: 10}), // older, ignored
          section("remote", 1, 4, {hits: 42, lastPracticed: 2000}), // newer, replaces
          section("c", 2, 3, {elapsedMs: 4500}),
          section("unknown", 1, 1),
        ],
        sessions: [
          {id: "s1", startedAt: 1000, notesRead: 5},
          {id: "s1", startedAt: 1000, notesRead: 6}, // repeated in the file
          {id: "s2"}, // no start, skipped
        ],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.message).toEqual("Added 1 piece, stats for 2 sections and 1 practice session; 2 pieces already in the library; 1 unreadable piece skipped")
      expect(result.report.addedSessions).toEqual(1)
      expect((await store.exportLibrary()).sessions).toEqual([{id: "s1", startedAt: 1000, notesRead: 5}])

      expect(store.pieces().map(piece => [piece.id, piece.title])).toEqual([
        ["a", "First"], ["local", "Same notes"], ["c", "New"],
      ])
      expect(store.sectionStats("a")[0].hits).toEqual(3)
      expect(store.sectionStats("local")[0].hits).toEqual(42)
      expect(store.sectionStats("c")[0].elapsedMs).toEqual(4500)
      expect("elapsedMs" in store.sectionStats("local")[0]).toBe(false)
      expect(store.sectionStats("c").length).toEqual(1)
      expect(store.sectionStats("unknown")).toEqual([])
    })

    it("round trips the source of each piece that has one", async function() {
      let xml = reverieOpening()
      let store = await open()
      await store.putPiece(pieceData("a", "Rêverie", 1000), {source: xml})
      await store.putPiece(pieceData("b", "Sourceless", 2000, ["E4"]))
      await store.recordSectionPractice(section("a", 1, 4, {at: 1500}))

      let file = await exportLibraryFile(store)
      let data = JSON.parse(file.text)
      expect(data.version).toEqual(LIBRARY_VERSION)
      expect(data.sources.map(source => [source.pieceId, source.encoding, typeof source.data]))
        .toEqual([["a", SOURCE_ENCODING, "string"]])
      // the pieces themselves carry no source
      expect(data.pieces.map(piece => Object.keys(piece).sort()))
        .toEqual([["id", "importedAt", "song", "title"], ["id", "importedAt", "song", "title"]])

      await store.close()
      let other = await open()
      let result = await importLibraryFile(file.text, other)
      expect(result.error).toBeUndefined()
      expect(result.report.addedPieces).toEqual(2)
      expect(result.report.addedSources).toEqual(1)
      expect(await other.pieceSource("a")).toEqual(xml)
      expect(await other.pieceSource("b")).toBe(null)
      expect(other.sectionStats("a").length).toEqual(1)

      // and on through a second export
      let again = JSON.parse((await exportLibraryFile(other)).text)
      expect(again.sources).toEqual(data.sources)
    })

    it("fills in the sources of stored pieces without one", async function() {
      let store = await open()
      await store.putPiece(pieceData("local", "Same notes", 1000, ["F4"]))
      await store.putPiece(pieceData("kept", "Kept", 2000, ["G4"]), {source: "<kept/>"})
      await store.putPiece(pieceData("bare", "Bare", 3000, ["A4"]))
      await store.recordSectionPractice(section("local", 1, 4, {at: 1000}))

      let source = (pieceId, text) =>
        ({pieceId, encoding: SOURCE_ENCODING, data: bytesToBase64(compressSource(text)), storedAt: 5})

      let library = {
        format: LIBRARY_FORMAT,
        version: LIBRARY_VERSION,
        pieces: [
          // the same title and notes under another id
          pieceData("remote", "Same notes", 1000, ["F4"]),
          pieceData("kept", "Kept", 2000, ["G4"]),
          pieceData("bare", "Bare", 3000, ["A4"]),
        ],
        sources: [
          source("remote", "<remote/>"),
          // a stored source is kept
          source("kept", "<replacement/>"),
          // unreadable, and for a piece that isn't in the file
          {...source("bare", "<bare/>"), encoding: "brotli"},
          {...source("bare", "<bare/>"), data: "not base64!"},
          {...source("bare", "<bare/>"), data: btoa("plain text, not gzip")},
          source("unknown", "<unknown/>"),
          null,
        ],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.report.existingPieces).toEqual(3)
      expect(result.report.addedSources).toEqual(1)

      expect(store.pieces().map(piece => piece.id)).toEqual(["local", "kept", "bare"])
      expect(await store.pieceSource("local")).toEqual("<remote/>")
      expect(await store.pieceSource("kept")).toEqual("<kept/>")
      expect(await store.pieceSource("bare")).toBe(null)
      expect(await store.pieceSource("unknown")).toBe(null)
      expect(store.sectionStats("local").length).toEqual(1)
    })

    it("adds no source to a stored piece whose song differs from the imported one", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "Rêverie", 1000, ["C4"]))

      let library = {
        format: LIBRARY_FORMAT,
        version: LIBRARY_VERSION,
        // the same id, re-imported elsewhere from a new version of the score
        pieces: [pieceData("a", "Rêverie", 1000, ["D4"])],
        sources: [{pieceId: "a", encoding: SOURCE_ENCODING, data: bytesToBase64(compressSource("<new/>")), storedAt: 5}],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.report.existingPieces).toEqual(1)
      expect(result.report.addedSources).toEqual(0)
      expect(store.piece("a").song).toEqual(songData("C4"))
      expect(await store.pieceSource("a")).toBe(null)
    })

    it("round trips the annotations of each piece that has one", async function() {
      let flag = () => ({
        id: "score:1-2:aaaaaaaa", source: "score", start: 1, end: 2, startIndex: 0, endIndex: 1,
        hand: "both", level: 2, kinds: ["speed"], title: "The densest bars",
        reason: "Dense writing.", reasons: ["Dense writing."], tip: "Slowly at first.",
      })
      let annotation = (pieceId, overrides={}) => ({
        pieceId,
        fingerprint: {algo: 1, numbersHash: "abc", bars: ["x", "y"]},
        proposals: [flag()],
        decisions: [],
        runs: {score: {algo: 1, at: 1, source: false, tempo: null, heat: [0, 1]}},
        ...overrides,
      })

      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      await store.putPiece(pieceData("b", "Sourceless", 2000, ["E4"]))
      await store.putAnnotation(annotation("a"))

      let file = await exportLibraryFile(store)
      let data = JSON.parse(file.text)
      expect(data.annotations).toEqual([annotation("a")])

      await store.close()
      let other = await open()
      let result = await importLibraryFile(file.text, other)
      expect(result.error).toBeUndefined()
      expect(result.report.addedAnnotations).toEqual(1)
      expect(other.annotation("a")).toEqual(annotation("a"))
      expect(other.annotation("b")).toBe(null)

      // importing again adds nothing: the piece already has a record
      let again = await importLibraryFile(file.text, other)
      expect(again.report.addedAnnotations).toEqual(0)
      expect(other.annotation("a")).toEqual(annotation("a"))

      // a local annotation is kept, not replaced by the file's
      let keepStore = await open()
      await keepStore.putPiece(pieceData("kept", "Kept", 3000, ["G4"]))
      let localAnnotation = annotation("kept", {proposals: []})
      await keepStore.putAnnotation(localAnnotation)

      let remoteLibrary = {
        format: LIBRARY_FORMAT,
        version: LIBRARY_VERSION,
        pieces: [pieceData("remote", "Kept", 3000, ["G4"])],
        annotations: [annotation("remote"), {pieceId: "remote2", bad: true}],
      }
      let keepResult = await importLibraryFile(JSON.stringify(remoteLibrary), keepStore)
      expect(keepResult.report.addedAnnotations).toEqual(0)
      expect(keepStore.annotation("kept")).toEqual(localAnnotation)

      // libraries without annotations (versions 6 and 7) import as before
      for (let version of [6, 7]) {
        let oldStore = await open({persist: false})
        let oldResult = await importLibraryFile(JSON.stringify({
          format: LIBRARY_FORMAT, version, pieces: [pieceData(`v${version}`, `V${version}`, 1000, [`C${version}`])],
        }), oldStore)
        expect(oldResult.error).toBeUndefined()
        expect(oldResult.report.addedPieces).toEqual(1)
        expect(oldStore.annotations()).toEqual([])
      }
    })

    it("imports a library exported before pieces kept their source", async function() {
      let store = await open()
      let library = {
        format: LIBRARY_FORMAT,
        version: 3,
        pieces: [pieceData("old", "Old", 1000, ["C4", "E4"])],
        sectionStats: [section("old", 1, 2)],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.error).toBeUndefined()
      expect(result.report.addedPieces).toEqual(1)
      expect(result.report.addedSources).toEqual(0)
      expect(store.piece("old").song).toEqual(songData("C4", "E4"))
      expect(await store.pieceSource("old")).toBe(null)
      expect(store.sectionStats("old").length).toEqual(1)
    })

    it("stops adding pieces once the deck is full", async function() {
      let store = await open({persist: false})
      let pieces = []
      for (let i = 0; i <= MAX_PIECES; i++) {
        pieces.push(pieceData(`p${i}`, `Piece ${i}`, i, [`C${i % 7 + 2}`]))
      }

      let result = await importLibraryFile(JSON.stringify({format: LIBRARY_FORMAT, version: 1, pieces}), store)
      expect(result.message).toContain(`1 piece left out, the deck is full (${MAX_PIECES} pieces)`)
      expect(store.pieces().length).toEqual(MAX_PIECES)
    })

    it("imports a library exported before middle C was C4 with its pitches unchanged", async function() {
      let store = await open()
      await store.putPiece(pieceData("local", "Already here", 1000, ["E4", "G4"]))

      // version 1 files named middle C "C5"
      let library = {
        format: LIBRARY_FORMAT,
        version: 1,
        pieces: [
          pieceData("old", "Old Minuet", 2000, ["C5", "F#5", "Bb3", "Cb6"]),
          pieceData("dupe", "Already here", 1000, ["E5", "G5"]),
        ],
        sectionStats: [section("old", 1, 2)],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.report.addedPieces).toEqual(1)
      // the renumbered piece is recognized as the stored one
      expect(result.report.existingPieces).toEqual(1)

      let imported = store.piece("old")
      expect(imported.song).toEqual(songData("C4", "F#4", "Bb2", "Cb5"))
      expect([...pieceSong(imported).tracks[0]].map(note => parseNote(note.note))).toEqual([60, 66, 46, 71])
      expect(store.sectionStats("old").length).toEqual(1)
    })

    it("refuses files that aren't a library", async function() {
      let store = await open()
      expect((await importLibraryFile("not json", store)).error).toEqual("The file isn't an exported sight reading library.")
      expect((await importLibraryFile("{\"pieces\": []}", store)).error).toEqual("The file isn't an exported sight reading library.")
      expect((await importLibraryFile(JSON.stringify({format: LIBRARY_FORMAT, version: 99, pieces: []}), store)).error)
        .toEqual("The library was exported by a newer version of the app.")
    })

    it("reports a full browser storage and imports nothing", async function() {
      let store = await open()
      spyOn(store.backend, "write").and.rejectWith(
        new DOMException("The quota has been exceeded.", "QuotaExceededError"))

      let library = {format: LIBRARY_FORMAT, version: 1, pieces: [pieceData("a", "First", 1)]}
      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.error).toEqual("The library wasn't imported. Browser storage is full. Remove a piece from the deck and try again.")
      expect(store.pieces()).toEqual([])
    })
  })

  describe("lesson notes", function() {
    // a note on a bar of a piece, told by id and creation time so a spec can
    // tell its notes apart
    let barNote = (pieceId, id, at, extra={}) => ({
      ...newLessonNote({
        source: "bar", pieceId, pieceTitle: "Minuet", start: 3, end: 3, text: "Why this fingering?",
        now: at,
      }),
      id, ...extra,
    })
    let generalNote = (id, at, extra={}) => ({
      ...newLessonNote({source: "general", text: "How often should I practise?", now: at}), id, ...extra,
    })

    describe("schema upgrade", function() {
      it("adds the lessonNotes store, empty, leaving every other store's records exactly as they were", async function() {
        await deleteDB(TEST_DB_NAME)

        // the version 6 database, with the bar log and before lesson notes
        let db = await openDB(TEST_DB_NAME, 6, {
          upgrade(db) {
            db.createObjectStore("pieces", {keyPath: "id"})
            db.createObjectStore("pieceSources", {keyPath: "pieceId"})
            db.createObjectStore("sectionStats", {keyPath: ["pieceId", "startMeasure", "endMeasure"]})
              .createIndex("pieceId", "pieceId")
            db.createObjectStore("sessions", {keyPath: "id"}).createIndex("startedAt", "startedAt")
            db.createObjectStore("meta", {keyPath: "key"})
            db.createObjectStore("items", {keyPath: "id"}).createIndex("pieceId", "pieceId")
            let reviews = db.createObjectStore("reviews", {keyPath: ["itemId", "at"]})
            reviews.createIndex("pieceId", "pieceId")
            db.createObjectStore("studies", {keyPath: "pieceId"})
            db.createObjectStore("annotations", {keyPath: "pieceId"})
            let barLog = db.createObjectStore("barLog", {keyPath: ["itemId", "at"]})
            barLog.createIndex("itemId", "itemId")
            barLog.createIndex("pieceId", "pieceId")
          },
        })

        let minuet = pieceData("p1", "Minuet", 1000)
        let item = {
          id: "p1:both:1-4", pieceId: "p1", hand: "both", startMeasure: 1, endMeasure: 4,
          level: "span", state: "tracked", step: 0, reps: 0, lapses: 0, streak: 0,
          hits: 1, misses: 0, attempts: 1, lastPracticed: 1000, recent: [], algo: 0, createdAt: 1,
        }
        let review = {itemId: "p1:both:1-4", at: 1000, pieceId: "p1", kind: "legacy", hits: 1, misses: 0, attempts: 1}
        let row = {
          itemId: "p1:both:1-1", at: 1500, pieceId: "p1", hand: "both", measure: 1, sessionId: "s1",
          mode: "wait", card: [1, 1], cardGrade: 3, columns: 2, clean: 1, grade: 2, reviewed: true,
          beats: [0, 1], gaps: [null, 1], iois: [null, 500], pulse: 500, marks: [],
        }
        await db.put("pieces", minuet)
        await db.put("items", item)
        await db.put("reviews", review)
        await db.put("barLog", row)
        await db.put("studies", {pieceId: "p1"})
        await db.put("meta", {key: DECK_MIGRATION_MARKER, migratedAt: 1, pieces: 0})
        db.close()

        let store = await open({keep: true})
        expect(store.persistent).toBe(true)
        expect(store.backend.db.version).toEqual(DB_VERSION)
        expect(DB_VERSION).toEqual(7)
        expect([...store.backend.db.objectStoreNames]).toContain("lessonNotes")
        expect(store.backend.db.transaction("lessonNotes").store.indexNames.contains("pieceId")).toBe(true)

        expect(store.lessonNotes()).toEqual([])
        expect(store.pieces()).toEqual([minuet])
        expect(store.items("p1")).toEqual([item])
        expect(await store.reviews({pieceId: "p1"})).toEqual([review])
        expect(await store.barLog({pieceId: "p1"})).toEqual([row])
        expect(store.studies()).toEqual([{pieceId: "p1"}])
      })
    })

    for (let persist of [true, false]) {
      describe(persist ? "in IndexedDB" : "in memory", function() {
        it("reads a note back at once and after reopening, in the order written, and refuses what isn't a note", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "Minuet", 1000))
          expect(store.lessonNotes()).toEqual([])

          let late = barNote("a", "n2", 3000)
          let early = barNote("a", "n1", 2000, {topic: "fingering", evidence: {at: 2000, accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"}})
          let any = generalNote("n3", 4000)
          let flag = {...newLessonNote({source: "session", pieceId: "a", pieceTitle: "Minuet", start: 3, end: 4, now: 5000}), id: "n4"}
          for (let note of [late, early, any, flag]) {
            expect(await store.putLessonNote(note)).toEqual(note)
          }

          // synchronous, oldest first
          expect(store.lessonNotes().map(note => note.id)).toEqual(["n1", "n2", "n3", "n4"])
          expect(store.lessonNotes()[0]).toEqual(early)
          expect(store.lessonNotes()[3].text).toEqual("")

          if (persist) {
            await store.close()
            store = await open({keep: true})
            expect(store.lessonNotes()).toEqual([early, late, any, flag])
          }

          // refused, and nothing written
          let bad = [
            {...late, id: "x1", status: "finished"},
            {...late, id: "x2", text: 5},
            {...late, id: "x3", text: "x".repeat(1001)},
            {...late, id: "x4", start: 5, end: 4},
            {...late, id: "x5", pieceId: null},
            {...late, id: "x6", pieceId: "gone"},
            {...late, id: "x7", status: "discussed"},
            {...late, id: "x8", discussedAt: 5000},
            {...late, id: "x9", topic: "tuning"},
            {...late, id: "x10", hand: "left"},
            {...late, id: "x11", start: null, end: null},
            {...any, id: "x12", pieceId: "gone"},
            null,
          ]
          for (let note of bad) {
            await expectAsync(store.putLessonNote(note)).toBeRejected()
          }
          expect(store.lessonNotes().length).toEqual(4)

          // a note of exactly the longest length is fine
          await store.putLessonNote({...any, id: "n5", text: "x".repeat(1000)})
          expect(store.lessonNotes().length).toEqual(5)
        })

        it("lands two quick updates, each built from the note the other left, and moves updatedAt forward", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "Minuet", 1000))
          let note = barNote("a", "n1", 2000)
          await store.putLessonNote(note)

          let builds = []
          let kept = store.updateLessonNote("n1", stored => {
            builds.push(["kept", stored.status, stored.keptAt])
            return {...stored, keptAt: 7000}
          })
          let discussed = store.updateLessonNote("n1", stored => {
            builds.push(["discussed", stored.status, stored.keptAt])
            return {...stored, status: "discussed", discussedAt: 8000, answer: "Thumb under."}
          })
          let [first, second] = await Promise.all([kept, discussed])

          // each saw the other's write: the second was built from the first
          expect(builds).toEqual([["kept", "open", undefined], ["discussed", "open", 7000]])
          expect(first.updatedAt).toBeGreaterThan(note.updatedAt)
          expect(second.updatedAt).toBeGreaterThan(first.updatedAt)

          let stored = store.lessonNotes()[0]
          expect(stored).toEqual(jasmine.objectContaining({
            status: "discussed", discussedAt: 8000, answer: "Thumb under.", keptAt: 7000,
          }))
          expect(stored.updatedAt).toEqual(second.updatedAt)

          if (persist) {
            await store.close()
            expect((await open({keep: true})).lessonNotes()).toEqual([stored])
          }

          // an unknown id, an id changed and an invalid result are refused
          await expectAsync(store.updateLessonNote("nope", n => n)).toBeRejected()
          await expectAsync(store.updateLessonNote("n1", n => ({...n, id: "other"}))).toBeRejected()
          await expectAsync(store.updateLessonNote("n1", n => ({...n, status: "discussed", discussedAt: undefined}))).toBeRejected()
          expect(store.lessonNotes()[0]).toEqual(stored)
        })

        it("keeps a removed piece's notes unless asked to remove them, and never touches the other notes", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "Minuet", 1000))
          await store.putPiece(pieceData("b", "Waltz", 2000, ["E4"]))

          // a2 is a note on the whole piece, g1 on no piece
          let notes = [
            barNote("a", "a1", 2000), {...generalNote("a2", 3000), pieceId: "a", pieceTitle: "Minuet"},
            barNote("b", "b1", 4000), generalNote("g1", 5000),
          ]
          for (let note of notes) { await store.putLessonNote(note) }

          expect(await store.deletePiece("a")).toBe(true)
          expect(store.lessonNotes().map(note => note.id)).toEqual(["a1", "a2", "b1", "g1"])
          expect(store.lessonNotes()[0].pieceTitle).toEqual("Minuet")

          if (persist) {
            await store.close()
            store = await open({keep: true})
            expect(store.lessonNotes().map(note => note.id)).toEqual(["a1", "a2", "b1", "g1"])
          }

          // the kept notes of a piece already gone are changed like any other
          await store.updateLessonNote("a1", note => ({...note, keptAt: 9000}))
          expect(store.lessonNotes()[0].keptAt).toEqual(9000)

          await store.putPiece(pieceData("c", "Gigue", 3000, ["G4"]))
          await store.putLessonNote(barNote("c", "c1", 6000))
          expect(await store.deletePiece("c", {keepNotes: false})).toBe(true)
          expect(store.lessonNotes().map(note => note.id)).toEqual(["a1", "a2", "b1", "g1"])

          expect(await store.deletePiece("b", {keepNotes: false})).toBe(true)
          expect(store.lessonNotes().map(note => note.id)).toEqual(["a1", "a2", "g1"])

          if (persist) {
            await store.close()
            expect((await open({keep: true})).lessonNotes().map(note => note.id)).toEqual(["a1", "a2", "g1"])
          }
        })

        it("exports the notes and merges them on import: new ones added, the newer copy kept, the piece remapped", async function() {
          let source = await open({persist})
          await source.putPiece(pieceData("a", "Minuet", 1000))
          await source.putPiece(pieceData("z", "Zither", 4000, ["F4"]))
          await source.putLessonNote(barNote("a", "n1", 2000))
          await source.putLessonNote(barNote("a", "n2", 3000, {status: "dropped"}))
          await source.putLessonNote(generalNote("n3", 4000))
          await source.putLessonNote(barNote("z", "n4", 5000))

          let exported = await source.exportLibrary()
          expect(exported.version).toEqual(13)
          expect(exported.lessonNotes.map(note => note.id)).toEqual(["n1", "n2", "n3", "n4"])

          // into an empty store, only the notes of the pieces it brought
          let empty = await open({persist})
          let report = await empty.importLibrary(exported)
          expect(report.addedPieces).toEqual(2)
          expect(report.addedLessonNotes).toEqual(4)
          expect(report.updatedLessonNotes).toEqual(0)
          expect(empty.lessonNotes()).toEqual(source.lessonNotes())
          // a dropped note stays stored, so a merge can't bring it back
          expect(empty.lessonNotes().find(note => note.id == "n2").status).toEqual("dropped")

          // into a store holding older and newer copies, and the piece under another id
          let other = await open({persist})
          await other.putPiece(pieceData("local", "Minuet", 1000))
          await other.putLessonNote(barNote("local", "n1", 2000, {updatedAt: 2000, text: "Older words"}))
          await other.putLessonNote(barNote("local", "n2", 3000, {updatedAt: 99000, status: "open", text: "Newer here"}))
          let merged = await other.importLibrary({...exported, lessonNotes: exported.lessonNotes.map(note =>
            note.id == "n1" ? {...note, updatedAt: 50000, text: "Newer words"} : note)})

          expect(merged.existingPieces).toEqual(1)
          expect(merged.addedLessonNotes).toEqual(2) // n3 and n4, and nothing for n2
          expect(merged.updatedLessonNotes).toEqual(1)
          let byId = id => other.lessonNotes().find(note => note.id == id)
          // the newer copy replaced it, filed under the piece here
          expect(byId("n1").text).toEqual("Newer words")
          expect(byId("n1").pieceId).toEqual("local")
          // the older copy didn't
          expect(byId("n2").text).toEqual("Newer here")
          expect(byId("n2").status).toEqual("open")
          // the piece's note followed it, the note on no piece stayed so
          expect(byId("n4").pieceId).toEqual("z")
          expect(byId("n3").pieceId).toBe(null)
        })

        it("leaves out a note whose piece wasn't in the library, keeps a note on no piece, and reads a version 12 library as having none", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "Minuet", 1000))
          let library = {
            format: LIBRARY_FORMAT, version: 13,
            pieces: [pieceData("a", "Minuet", 1000)],
            lessonNotes: [
              barNote("a", "n1", 2000),
              barNote("gone", "n2", 3000),
              generalNote("n3", 4000),
              {...generalNote("n4", 5000), text: 5},
              null,
            ],
          }
          let report = await store.importLibrary(library)
          expect(report.addedLessonNotes).toEqual(2)
          expect(store.lessonNotes().map(note => note.id)).toEqual(["n1", "n3"])

          let old = await open({persist})
          let result = await old.importLibrary({...library, version: 12})
          expect(result.addedLessonNotes).toEqual(0)
          expect(old.lessonNotes()).toEqual([])
        })
      })
    }

    it("names the lesson notes a library file brings", async function() {
      let source = await open()
      await source.putPiece(pieceData("a", "Minuet", 1000))
      await source.putLessonNote(barNote("a", "n1", 2000))
      await source.putLessonNote(generalNote("n2", 3000))

      let exported = await source.exportLibrary()
      let target = await open()
      let result = await importLibraryFile(JSON.stringify(exported), target)
      expect(result.message).toEqual("Added 1 piece and 2 lesson notes")
      expect(target.lessonNotes().length).toEqual(2)

      // and says nothing of them when there were none
      let bare = await open()
      let plain = await importLibraryFile(JSON.stringify({
        format: LIBRARY_FORMAT, version: 12, pieces: [pieceData("b", "Waltz", 1000, ["E4"])],
      }), bare)
      expect(plain.message).toEqual("Added 1 piece")
    })
  })

  // acoustic mode: a self-graded review (st/srs/self_grade) goes through the
  // same store as any detected review
  describe("bar log", function() {
    let row = (pieceId, measure, at, extra={}) => ({
      itemId: `${pieceId}:both:${measure}-${measure}`, at, pieceId, hand: "both", measure, sessionId: "s1",
      mode: "wait", card: [measure, measure], cardGrade: 3, columns: 2, clean: 1, grade: 2, reviewed: true,
      beats: [0, 1], gaps: [null, 1], iois: [null, 500], pulse: 500,
      marks: [[1, "wrong", ["D4"], ["D#4"], 1, null]],
      ...extra,
    })

    describe("schema upgrade", function() {
      it("adds the barLog store, empty, leaving every other store's records exactly as they were", async function() {
        await deleteDB(TEST_DB_NAME)

        // the version 5 database, before the bar log
        let db = await openDB(TEST_DB_NAME, 5, {
          upgrade(db) {
            db.createObjectStore("pieces", {keyPath: "id"})
            db.createObjectStore("pieceSources", {keyPath: "pieceId"})
            db.createObjectStore("sectionStats", {keyPath: ["pieceId", "startMeasure", "endMeasure"]})
              .createIndex("pieceId", "pieceId")
            db.createObjectStore("sessions", {keyPath: "id"}).createIndex("startedAt", "startedAt")
            db.createObjectStore("meta", {keyPath: "key"})
            db.createObjectStore("items", {keyPath: "id"}).createIndex("pieceId", "pieceId")
            let reviews = db.createObjectStore("reviews", {keyPath: ["itemId", "at"]})
            reviews.createIndex("pieceId", "pieceId")
            db.createObjectStore("studies", {keyPath: "pieceId"})
            db.createObjectStore("annotations", {keyPath: "pieceId"})
          },
        })

        let minuet = pieceData("p1", "Minuet", 1000)
        let item = {
          id: "p1:both:1-4", pieceId: "p1", hand: "both", startMeasure: 1, endMeasure: 4,
          level: "span", state: "tracked", step: 0, reps: 0, lapses: 0, streak: 0,
          hits: 1, misses: 0, attempts: 1, lastPracticed: 1000, recent: [], algo: 0, createdAt: 1,
        }
        let review = {itemId: "p1:both:1-4", at: 1000, pieceId: "p1", kind: "legacy", hits: 1, misses: 0, attempts: 1}
        await db.put("pieces", minuet)
        await db.put("items", item)
        await db.put("reviews", review)
        await db.put("studies", {pieceId: "p1"})
        await db.put("meta", {key: DECK_MIGRATION_MARKER, migratedAt: 1, pieces: 0})
        db.close()

        let store = await open({keep: true})
        expect(store.persistent).toBe(true)
        expect(store.backend.db.version).toEqual(DB_VERSION)
        expect([...store.backend.db.objectStoreNames]).toContain("barLog")

        expect(store.pieces()).toEqual([minuet])
        expect(store.items("p1")).toEqual([item])
        expect(await store.reviews({pieceId: "p1"})).toEqual([review])
        expect(store.studies()).toEqual([{pieceId: "p1"}])
        expect(await store.barLog({pieceId: "p1"})).toEqual([])
        expect(await store.scoreEnded()).toBe(null)
      })
    })

    for (let persist of [true, false]) {
      describe(persist ? "in IndexedDB" : "in memory", function() {
        it("reads rows by bar, session and piece, oldest first and by measure within a pass, across reopening", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.putPiece(pieceData("b", "Second", 1000))

          expect(await store.recordBarLog([row("a", 2, 3000, {sessionId: "s2"}), row("a", 1, 3000, {sessionId: "s2"})])).toEqual(2)
          await store.recordBarLog([row("a", 1, 2000), row("b", 1, 2500, {sessionId: "s3"})])

          let at = rows => rows.map(r => [r.itemId, r.at])
          expect(at(await store.barLog({itemId: "a:both:1-1"}))).toEqual([["a:both:1-1", 2000], ["a:both:1-1", 3000]])
          expect(at(await store.barLog({sessionId: "s2"}))).toEqual([["a:both:1-1", 3000], ["a:both:2-2", 3000]])
          expect(at(await store.barLog({pieceId: "a"}))).toEqual([
            ["a:both:1-1", 2000], ["a:both:1-1", 3000], ["a:both:2-2", 3000],
          ])
          expect(at(await store.barLog({pieceId: "b"}))).toEqual([["b:both:1-1", 2500]])
          expect(await store.barLog({itemId: "a:both:3-3"})).toEqual([])

          // a row of the same bar and time replaces the stored one
          await store.recordBarLog([row("a", 1, 2000, {clean: 2, marks: []})])
          expect((await store.barLog({itemId: "a:both:1-1"})).map(r => r.clean)).toEqual([2, 1])

          if (persist) {
            await store.close()
            let reopened = await open({keep: true})
            expect(at(await reopened.barLog({pieceId: "a"}))).toEqual([
              ["a:both:1-1", 2000], ["a:both:1-1", 3000], ["a:both:2-2", 3000],
            ])
          }
        })

        it("reads the rows since a time, oldest first and by measure, a row just written included", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.putPiece(pieceData("b", "Second", 1000))

          await store.recordBarLog([row("a", 1, 2000), row("a", 2, 2000)])
          await store.recordBarLog([row("b", 1, 3000), row("a", 2, 3000), row("a", 1, 3000)])

          let at = rows => rows.map(r => [r.itemId, r.at])
          expect(at(await store.barLogSince(2500))).toEqual([
            ["a:both:1-1", 3000], ["b:both:1-1", 3000], ["a:both:2-2", 3000],
          ])
          expect((await store.barLogSince(2000)).length).toEqual(5)
          expect(await store.barLogSince(3001)).toEqual([])

          // not awaited: the read queues behind the write
          store.recordBarLog([row("a", 3, 4000)])
          expect(at(await store.barLogSince(3500))).toEqual([["a:both:3-3", 4000]])
        })

        it("writes nothing when any row of a pass isn't valid", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))

          let bad = row("a", 2, 3000, {clean: 2, marks: []})
          expect(validBarLog(bad)).toBe(true)
          expect(validBarLog({...bad, clean: 0})).toBe(false)

          let thrown = null
          try {
            await store.recordBarLog([row("a", 1, 3000), {...row("a", 2, 3000), clean: 0}])
          } catch (e) {
            thrown = e
          }
          expect(thrown).not.toBe(null)
          expect(await store.barLog({pieceId: "a"})).toEqual([])
        })

        it("goes with its piece when the piece is deleted, and only its piece's", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.putPiece(pieceData("b", "Second", 1000))
          await store.recordBarLog([row("a", 1, 2000), row("b", 1, 2000)])

          expect(await store.deletePiece("a")).toBe(true)
          expect(await store.barLog({pieceId: "a"})).toEqual([])
          expect((await store.barLog({pieceId: "b"})).length).toEqual(1)
        })

        it("keeps the ended session the score page remembers, per device and never exported", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          expect(await store.scoreEnded()).toBe(null)

          await store.putScoreEnded({sessionId: "s1", pieceId: "a", at: 5000})
          expect(await store.scoreEnded()).toEqual({key: SCORE_ENDED_KEY, sessionId: "s1", pieceId: "a", at: 5000})

          let exported = await store.exportLibrary()
          expect(JSON.stringify(exported)).not.toContain(SCORE_ENDED_KEY)

          let thrown = null
          try { await store.putScoreEnded({sessionId: 1}) } catch (e) { thrown = e }
          expect(thrown).not.toBe(null)

          await store.putScoreEnded(null)
          expect(await store.scoreEnded()).toBe(null)
        })

        it("exports at the library version and imports as a union by key, remapped to the piece it matched", async function() {
          let store = await open({persist})
          await store.putPiece(pieceData("a", "First", 1000))
          await store.recordBarLog([row("a", 1, 2000), row("a", 2, 2000)])

          let exported = await store.exportLibrary()
          expect(exported.version).toEqual(LIBRARY_VERSION)
          expect(exported.barLog.map(r => [r.itemId, r.at])).toEqual([["a:both:1-1", 2000], ["a:both:2-2", 2000]])

          // a library holding the same song under another id: the rows follow the stored piece
          let other = await open({persist})
          await other.putPiece(pieceData("z", "First", 1000))
          let report = await other.importLibrary(exported)
          expect(report.addedBarLog).toEqual(2)
          expect((await other.barLog({pieceId: "z"})).map(r => [r.itemId, r.pieceId, r.at])).toEqual([
            ["z:both:1-1", "z", 2000], ["z:both:2-2", "z", 2000],
          ])
          expect(await other.barLog({pieceId: "a"})).toEqual([])

          // a union: again adds nothing, and a library with one more row adds just it
          expect((await other.importLibrary(exported)).addedBarLog).toEqual(0)
          let more = {...exported, barLog: [...exported.barLog, row("a", 1, 3000)]}
          expect((await other.importLibrary(more)).addedBarLog).toEqual(1)
          expect((await other.barLog({itemId: "z:both:1-1"})).map(r => r.at)).toEqual([2000, 3000])
        })

        it("leaves out an invalid row, a row of a piece the file lacks, and a version 11 library's", async function() {
          let store = await open({persist})
          let library = (version, barLog) => ({
            format: LIBRARY_FORMAT, version, pieces: [pieceData("a", "First", 1000)],
            items: [], reviews: [], studies: [], sessions: [], barLog,
          })

          let report = await store.importLibrary(library(12, [row("a", 1, 2000), {...row("a", 2, 2000), grade: 9}, row("ghost", 1, 2000)]))
          expect(report.addedBarLog).toEqual(1)

          let old = await open({persist})
          expect((await old.importLibrary(library(11, [row("a", 1, 2000)]))).addedBarLog).toEqual(0)
          expect(await old.barLog({pieceId: "a"})).toEqual([])
        })
      })
    }
  })

  describe("self-graded reviews", function() {
    it("stores and schedules a self attempt through recordAttempt", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      let item = newItem({pieceId: "a", startMeasure: 1, endMeasure: 1}, 1000)
      let review = {itemId: item.id, at: 2000, pieceId: "a", kind: "attempt", mode: "self", grade: GOOD, was: "new"}

      let stored = await store.recordAttempt({item, review})
      expect(stored.state).toEqual("learning")
      expect(store.item(item.id)).toEqual(stored)
      expect(await store.reviews({pieceId: "a"})).toEqual([review])
    })

    it("round trips self reviews through exportLibrary and importLibrary, version 6 libraries unaffected", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      let item = newItem({pieceId: "a", startMeasure: 1, endMeasure: 1}, 1000)
      let review = {itemId: item.id, at: 2000, pieceId: "a", kind: "attempt", mode: "self", grade: GOOD, was: "new"}
      await store.recordAttempt({item, review})

      let exported = await store.exportLibrary()
      expect(exported.version).toEqual(LIBRARY_VERSION)
      // version 12 libraries carry no lesson notes, and import as they are
      expect(LIBRARY_VERSION).toEqual(13)
      expect(exported.reviews).toEqual([jasmine.objectContaining({mode: "self", grade: GOOD})])

      let other = await open()
      let result = await other.importLibrary(exported)
      expect(result.addedReviews).toEqual(1)
      expect((await other.reviews({pieceId: "a"})).map(r => r.mode)).toEqual(["self"])

      // a union by key: importing the same library again adds nothing
      let again = await other.importLibrary(exported)
      expect(again.addedReviews).toEqual(0)

      // a version 6 library, with none, still imports as it always did
      let legacy = {
        format: LIBRARY_FORMAT, version: 6,
        pieces: [pieceData("b", "Second", 1000, ["E4"])],
        items: [], reviews: [], studies: [], sessions: [],
      }
      let legacyResult = await other.importLibrary(legacy)
      expect(legacyResult.addedPieces).toEqual(1)
    })
  })

  describe("sessions", function() {
    it("records a sight reading session from its note stats", async function() {
      let stats = new NoteStats()
      expect(stats.sessionRecord({staff: "treble", generator: "random"})).toBe(null)

      stats.hitNotes(["C4"])
      stats.hitNotes(["D4", "F4"])
      stats.missNotes(["C5"])
      stats.hitNotes(["C3"])

      let record = stats.sessionRecord({
        staff: "treble",
        generator: "sheet music",
        settings: {piece: "p1", startMeasure: 1, endMeasure: 4, song: "c4 ".repeat(100), noteRange: [60, 72]},
      })

      expect(record).toEqual({
        id: stats.id,
        startedAt: jasmine.any(Number),
        endedAt: jasmine.any(Number),
        activeSeconds: jasmine.any(Number),
        staff: "treble",
        generator: "sheet music",
        // long pasted notation is left out
        settings: {piece: "p1", startMeasure: 1, endMeasure: 4, noteRange: [60, 72]},
        notesRead: 3,
        misses: 1,
        bestStreak: 2,
        notes: {
          C: {hits: 2, misses: 1},
          D: {hits: 1, misses: 0},
          F: {hits: 1, misses: 0},
        },
      })
      expect(record.endedAt).not.toBeLessThan(record.startedAt)

      let store = await open()
      await store.putSession(record)

      // a growing session replaces its earlier record
      stats.hitNotes(["E4"])
      await store.putSession(stats.sessionRecord({staff: "treble", generator: "sheet music"}))

      let reopened = await open({keep: true})
      expect(reopened.recentSessions().length).toEqual(1)
      expect(reopened.recentSessions()[0].notesRead).toEqual(4)
      expect(reopened.recentSessions()[0].notes.E).toEqual({hits: 1, misses: 0})
    })

    describe("timing", function() {
      beforeEach(function() {
        jasmine.clock().install()
        jasmine.clock().mockDate(new Date(2026, 8, 14, 9))
      })

      afterEach(function() {
        jasmine.clock().uninstall()
      })

      it("counts active time from the gaps between notes, leaving out pauses", function() {
        let stats = new NoteStats()
        stats.hitNotes(["C4"])
        jasmine.clock().tick(4000)
        stats.missNotes(["D4"])
        jasmine.clock().tick(6000)
        stats.hitNotes(["D4"])

        // a pause of a few minutes isn't practice
        jasmine.clock().tick(3 * 60 * 1000)
        stats.hitNotes(["E4"])
        jasmine.clock().tick(2000)
        stats.hitNotes(["F4"])

        let record = stats.sessionRecord()
        expect(record.activeSeconds).toEqual(12)
        expect(record.endedAt - record.startedAt).toEqual(3 * 60 * 1000 + 12000)
      })

      it("starts a new session on the first note after a long pause", function() {
        let ended = []
        let stats = new NoteStats(null, {
          onSessionEnd: s => ended.push(s.sessionRecord({staff: "treble"})),
        })

        stats.hitNotes(["C4"])
        jasmine.clock().tick(5000)
        stats.hitNotes(["D4"])
        let firstId = stats.id

        jasmine.clock().tick(NoteStats.SESSION_GAP - 1)
        stats.missNotes(["E4"])
        expect(ended).toEqual([])

        jasmine.clock().tick(NoteStats.SESSION_GAP)
        stats.hitNotes(["G4"])

        expect(ended.length).toEqual(1)
        expect(ended[0].id).toEqual(firstId)
        expect(ended[0].notesRead).toEqual(2)
        expect(ended[0].misses).toEqual(1)
        expect(ended[0].endedAt).toEqual(ended[0].startedAt + 5000 + NoteStats.SESSION_GAP - 1)

        let next = stats.sessionRecord()
        expect(next.id).not.toEqual(firstId)
        expect(next.startedAt).toEqual(next.endedAt)
        expect(next.activeSeconds).toEqual(0)
        expect(next.notesRead).toEqual(1)
        expect(next.misses).toEqual(0)
        expect(next.bestStreak).toEqual(1)
        expect(next.notes).toEqual({G: {hits: 1, misses: 0}})
      })
    })

    it("stores a session together with its section practice in one write", async function() {
      let store = await open()
      await store.recordSectionPractice({pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 2, misses: 1, at: 1000})

      spyOn(store.backend, "write").and.callThrough()
      let practice = {pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 5, misses: 0, at: 2000}
      await store.putSession({id: "s", startedAt: Date.now()}, {sectionPractice: practice})

      // leaving the page runs no later write, so nothing may wait on another
      expect(store.backend.write).toHaveBeenCalledTimes(1)
      expect(store.recentSessions().map(s => s.id)).toEqual(["s"])
      expect(store.sectionStats("a")[0].hits).toEqual(7)

      let reopened = await open({keep: true})
      expect(reopened.recentSessions().map(s => s.id)).toEqual(["s"])
      expect(reopened.sectionStats("a")).toEqual([
        {pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 7, misses: 1, attempts: 2, lastPracticed: 2000},
      ])
    })

    it("refuses a session without an id or start", async function() {
      let store = await open()
      await expectAsync(store.putSession({startedAt: 5})).toBeRejected()
      await expectAsync(store.putSession({id: "s"})).toBeRejected()
      expect(store.recentSessions()).toEqual([])
    })

    // read from the database, not only the recentSessions cache, so the
    // Progress screen sees a session just ended (still queued when it
    // mounts) and the full 28-day window it reads for the accuracy change
    for (let persist of [true, false]) {
      describe(`sessionsSince, ${persist ? "in IndexedDB" : "in memory"}`, function() {
        it("returns sessions since a time, oldest first, beyond RECENT_SESSION_DAYS", async function() {
          let store = await open({persist})
          let now = Date.now()
          await store.putSession({id: "old", startedAt: now - (RECENT_SESSION_DAYS + 5) * DAY})
          await store.putSession({id: "b", startedAt: now - DAY})
          await store.putSession({id: "a", startedAt: now - 2 * DAY})
          await store.putSession({id: "too-old", startedAt: now - (RECENT_SESSION_DAYS + 10) * DAY})

          let since = await store.sessionsSince(now - (RECENT_SESSION_DAYS + 6) * DAY)
          expect(since.map(s => s.id)).toEqual(["old", "a", "b"])
        })

        it("includes a session put without awaiting it first", async function() {
          let store = await open({persist})
          let now = Date.now()
          store.putSession({id: "s", startedAt: now})

          let since = await store.sessionsSince(now - DAY)
          expect(since.map(s => s.id)).toEqual(["s"])
        })
      })
    }
  })
})
