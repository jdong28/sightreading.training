import {MultiTrackSong, SongNote} from "st/song_note_list"
import {songToJSON, exportLibraryFile, importLibraryFile, MAX_PIECES} from "st/sheet_music_deck"
import NoteStats from "st/note_stats"

import {
  LEGACY_DECK_KEY, DECK_MIGRATION_MARKER, LIBRARY_FORMAT, LIBRARY_VERSION,
  RECENT_SESSION_DAYS
} from "st/storage"

import {openTestStore, MemoryStorage} from "spec/helpers"

const DAY = 24 * 60 * 60 * 1000

let songData = (...notes) => {
  let song = new MultiTrackSong()
  notes.forEach((note, idx) => song.pushWithTrack(new SongNote(note, idx, 1), 0))
  song.metadata = {title: "Song", beatsPerMeasure: 4}
  return songToJSON(song)
}

let pieceData = (id, title, importedAt, notes=["C5", "D5"]) =>
  ({id, title, importedAt, song: songData(...notes)})

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
      expect(reopened.piece("b").song).toEqual(songData("C5", "D5"))
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

  describe("legacy deck migration", function() {
    let legacy = () => new MemoryStorage({
      [LEGACY_DECK_KEY]: JSON.stringify({pieces: [
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
      await store.putPiece(pieceData("b", "Second", 2000, ["E5"]))
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
      expect(reopened.sectionStats()).toEqual(data.sectionStats)
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
      await store.putPiece(pieceData("local", "Same notes", 1500, ["F5"]))
      await store.recordSectionPractice(section("a", 1, 4, {at: 5000}))
      await store.recordSectionPractice(section("local", 1, 4, {at: 1000}))

      let library = {
        format: LIBRARY_FORMAT,
        version: LIBRARY_VERSION,
        pieces: [
          pieceData("a", "First, elsewhere", 1000),
          // the same title and notes under another id
          pieceData("remote", "Same notes", 1500, ["F5"]),
          pieceData("c", "New", 3000, ["G5"]),
          {id: "broken"},
        ],
        sectionStats: [
          section("a", 1, 4, {hits: 99, lastPracticed: 10}), // older, ignored
          section("remote", 1, 4, {hits: 42, lastPracticed: 2000}), // newer, replaces
          section("c", 2, 3),
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
      expect(store.sectionStats("c").length).toEqual(1)
      expect(store.sectionStats("unknown")).toEqual([])
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

  describe("sessions", function() {
    it("records a sight reading session from its note stats", async function() {
      let stats = new NoteStats()
      expect(stats.sessionRecord({staff: "treble", generator: "random"})).toBe(null)

      stats.hitNotes(["C5"])
      stats.hitNotes(["D5", "F5"])
      stats.missNotes(["C6"])
      stats.hitNotes(["C4"])

      let record = stats.sessionRecord({
        staff: "treble",
        generator: "sheet music",
        settings: {piece: "p1", startMeasure: 1, endMeasure: 4, song: "c5 ".repeat(100), noteRange: [60, 72]},
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
      stats.hitNotes(["E5"])
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
        stats.hitNotes(["C5"])
        jasmine.clock().tick(4000)
        stats.missNotes(["D5"])
        jasmine.clock().tick(6000)
        stats.hitNotes(["D5"])

        // a pause of a few minutes isn't practice
        jasmine.clock().tick(3 * 60 * 1000)
        stats.hitNotes(["E5"])
        jasmine.clock().tick(2000)
        stats.hitNotes(["F5"])

        let record = stats.sessionRecord()
        expect(record.activeSeconds).toEqual(12)
        expect(record.endedAt - record.startedAt).toEqual(3 * 60 * 1000 + 12000)
      })

      it("starts a new session on the first note after a long pause", function() {
        let ended = []
        let stats = new NoteStats(null, {
          onSessionEnd: s => ended.push(s.sessionRecord({staff: "treble"})),
        })

        stats.hitNotes(["C5"])
        jasmine.clock().tick(5000)
        stats.hitNotes(["D5"])
        let firstId = stats.id

        jasmine.clock().tick(NoteStats.SESSION_GAP - 1)
        stats.missNotes(["E5"])
        expect(ended).toEqual([])

        jasmine.clock().tick(NoteStats.SESSION_GAP)
        stats.hitNotes(["G5"])

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

    it("refuses a session without an id or start", async function() {
      let store = await open()
      await expectAsync(store.putSession({startedAt: 5})).toBeRejected()
      await expectAsync(store.putSession({id: "s"})).toBeRejected()
      expect(store.recentSessions()).toEqual([])
    })
  })
})
