import {MultiTrackSong, SongNote} from "st/song_note_list"
import {songToJSON, exportLibraryFile, importLibraryFile} from "st/sheet_music_deck"
import {cardWeights} from "st/measure_cards"
import {openDB, deleteDB} from "idb"

import {DECK_MIGRATION_MARKER, LIBRARY_FORMAT, LIBRARY_VERSION, DB_VERSION} from "st/storage"

import {
  itemId, newItem, itemFromSectionStats, legacyReview, itemWithPractice, validItem,
  validReview
} from "st/srs/records"
import {applyGrade} from "st/srs/schedule"

import {openTestStore, TEST_DB_NAME} from "spec/helpers"

let songData = (...notes) => {
  let song = new MultiTrackSong()
  notes.forEach((note, idx) => song.pushWithTrack(new SongNote(note, idx, 1), 0))
  song.metadata = {title: "Song", beatsPerMeasure: 4}
  return songToJSON(song)
}

let pieceData = (id, title, importedAt, notes=["C4", "D4"]) =>
  ({id, title, importedAt, song: songData(...notes)})

// the stores of the version 3 database, before items
let upgradeToVersion3 = db => {
  db.createObjectStore("pieces", {keyPath: "id"})
  db.createObjectStore("pieceSources", {keyPath: "pieceId"})
  db.createObjectStore("sectionStats", {keyPath: ["pieceId", "startMeasure", "endMeasure"]})
    .createIndex("pieceId", "pieceId")
  db.createObjectStore("sessions", {keyPath: "id"}).createIndex("startedAt", "startedAt")
  db.createObjectStore("meta", {keyPath: "key"})
}

let section = (pieceId, startMeasure, endMeasure, extra={}) => ({
  pieceId, startMeasure, endMeasure, hits: 3, misses: 1, attempts: 1,
  lastPracticed: 1000, ...extra,
})

// a graded attempt at the item of a range
let attempt = (pieceId, startMeasure, endMeasure, at, extra={}) => ({
  itemId: itemId({pieceId, hand: "both", startMeasure, endMeasure}),
  at,
  pieceId,
  kind: "attempt",
  grade: 3,
  was: "new",
  columns: 4,
  clean: 3,
  misses: 1,
  stuck: 0,
  skipped: 0,
  hesitations: 0,
  elapsedMs: 3200,
  leadMs: 600,
  mode: "wait",
  staffMisses: {upper: 1, lower: 0},
  algo: 1,
  ...extra,
})

let practicedItem = (pieceId, startMeasure, endMeasure, at, extra={}) => ({
  ...itemWithPractice(newItem({pieceId, startMeasure, endMeasure}, at), {hits: 4, misses: 1, at}),
  recent: [[at, 4, 3, 3]],
  ...extra,
})

// the stored reviews of every piece, in key order
let storedReviews = store => store.backend.getAll("reviews")

// writes a version 3 database holding the given section stats rows
async function versionThreeDatabase(rows, pieces=[]) {
  await deleteDB(TEST_DB_NAME)
  let db = await openDB(TEST_DB_NAME, 3, {upgrade: upgradeToVersion3})
  for (let piece of pieces) {
    await db.put("pieces", piece)
  }
  for (let row of rows) {
    await db.put("sectionStats", row)
  }
  await db.put("meta", {key: DECK_MIGRATION_MARKER, migratedAt: 1, pieces: 0})
  db.close()
}

describe("spaced repetition records", function() {
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

  describe("records", function() {
    it("names an item by piece, hand and range, with a form for beats inside a bar", function() {
      expect(itemId({pieceId: "p1a2b3", hand: "both", startMeasure: 9, endMeasure: 12})).toEqual("p1a2b3:both:9-12")
      expect(itemId({pieceId: "p1a2b3", hand: "upper", startMeasure: 37, endMeasure: 37, beats: [2, 4]}))
        .toEqual("p1a2b3:upper:37@2-4")
    })

    it("keeps a review's misses by staff to both staves, as counts", function() {
      expect(validReview(attempt("p", 1, 1, 5))).toBe(true)
      expect(validReview(attempt("p", 1, 1, 5, {staffMisses: {upper: 0, lower: 2}}))).toBe(true)
      expect(validReview(attempt("p", 1, 1, 5, {staffMisses: undefined}))).toBe(true)
      expect(validReview(attempt("p", 1, 1, 5, {staffMisses: {upper: 1}}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {staffMisses: {upper: 1, lower: 0, both: 1}}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {staffMisses: {upper: -1, lower: 0}}))).toBe(false)
    })

    // an attempt graded before GRADE_ALGO 2 has no per-column record, and
    // is read as it was stored
    it("keeps a review's per-column measurements, which reviews graded before them lack", function() {
      let old = attempt("p", 1, 1, 5)
      expect(old.perColumn).toBeUndefined()
      expect(validReview(old)).toBe(true)

      let perColumn = [[0, 0, 400, 12, 0, 0, null], [2, 0, 1800, 0, 0, 0, null], [0, 1, null, null, null, null, null]]
      expect(validReview(attempt("p", 1, 1, 5, {perColumn, algo: 2}))).toBe(true)
      expect(validReview(attempt("p", 1, 1, 5, {perColumn: [[0, 0, 400, 0, 0, 0, 900]], mode: "scroll", algo: 2}))).toBe(true)
      expect(validReview(attempt("p", 1, 1, 5, {perColumn: [[0, 0, 400, 0, 0, 0]]}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {perColumn: [[0, 2, 400, 0, 0, 0, null]]}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {perColumn: [[0, 0, -1, 0, 0, 0, null]]}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {perColumn: {}}))).toBe(false)
    })

    it("tells stored items and reviews from other data", function() {
      let item = newItem({pieceId: "p", startMeasure: 2, endMeasure: 4}, 10)
      expect(item.level).toEqual("span")
      expect(validItem(item)).toBe(true)
      expect(validItem({...item, id: "p:both:2-5"})).toBe(false)
      expect(validItem({...item, hand: "left"})).toBe(false)
      expect(validItem({...item, startMeasure: 5, id: "p:both:5-4"})).toBe(false)
      expect(validItem({...item, state: "due"})).toBe(false)

      expect(validReview(legacyReview(section("p", 1, 4)))).toBe(true)
      expect(validReview({...legacyReview(section("p", 1, 4)), grade: 3})).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {grade: 5}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {itemId: "q:both:1-1"}))).toBe(false)
      expect(validReview(attempt("p", 1, 1, 5, {mode: "free"}))).toBe(false)
    })
  })

  describe("migration from version 3", function() {
    let rows = [
      section("p1", 1, 4),
      section("p1", 3, 3, {hits: 12, misses: 5, attempts: 4, lastPracticed: 3000, elapsedMs: 5400}),
      section("p2", 0, 0, {hits: 0, misses: 2, attempts: 1, lastPracticed: 2000}),
    ]

    it("turns each section stats row into a tracked item and a legacy review, leaving the rows in place", async function() {
      await versionThreeDatabase(rows, [pieceData("p1", "Minuet", 1000), pieceData("p2", "Waltz", 2000)])

      let store = await open({keep: true})
      expect(store.persistent).toBe(true)
      expect(store.backend.db.version).toEqual(DB_VERSION)
      expect(DB_VERSION).toEqual(4)

      expect(store.items("p1")).toEqual([
        {
          id: "p1:both:1-4", pieceId: "p1", hand: "both", startMeasure: 1, endMeasure: 4,
          level: "span", state: "tracked", step: 0, reps: 0, lapses: 0, streak: 0,
          hits: 3, misses: 1, attempts: 1, lastPracticed: 1000, recent: [], algo: 0,
          createdAt: jasmine.any(Number),
        },
        {
          id: "p1:both:3-3", pieceId: "p1", hand: "both", startMeasure: 3, endMeasure: 3,
          level: "bar", state: "tracked", step: 0, reps: 0, lapses: 0, streak: 0,
          hits: 12, misses: 5, attempts: 4, lastPracticed: 3000, elapsedMs: 5400, recent: [], algo: 0,
          createdAt: jasmine.any(Number),
        },
      ])
      expect(store.items("p2").map(item => item.id)).toEqual(["p2:both:0-0"])

      expect(await storedReviews(store)).toEqual([
        {itemId: "p1:both:1-4", at: 1000, pieceId: "p1", kind: "legacy", hits: 3, misses: 1, attempts: 1},
        {itemId: "p1:both:3-3", at: 3000, pieceId: "p1", kind: "legacy", hits: 12, misses: 5, attempts: 4, elapsedMs: 5400},
        {itemId: "p2:both:0-0", at: 2000, pieceId: "p2", kind: "legacy", hits: 0, misses: 2, attempts: 1},
      ])

      // the view gives the numbers the rows had, and the rows are unchanged
      for (let pieceId of ["p1", "p2"]) {
        expect(store.sectionStats(pieceId)).toEqual(rows.filter(row => row.pieceId == pieceId))
      }
      expect(await store.backend.getAll("sectionStats")).toEqual(rows)

      // migrated once
      let createdAt = store.item("p1:both:1-4").createdAt
      await store.recordSectionPractice({pieceId: "p1", startMeasure: 1, endMeasure: 4, hits: 2, misses: 0, at: 4000})
      await store.close()

      let reopened = await open({keep: true})
      expect(reopened.item("p1:both:1-4")).toEqual(jasmine.objectContaining({hits: 5, attempts: 2, createdAt}))
      expect((await storedReviews(reopened)).length).toEqual(3)
      expect(await reopened.backend.getAll("sectionStats")).toEqual(rows)
    })

    it("opens a version 3 database without section stats", async function() {
      await versionThreeDatabase([], [pieceData("p1", "Minuet", 1000)])
      let store = await open({keep: true})
      expect(store.persistent).toBe(true)
      expect(store.pieces().map(piece => piece.id)).toEqual(["p1"])
      expect(store.items()).toEqual([])
      expect(store.sectionStats()).toEqual([])
      expect(store.study("p1")).toBe(null)
    })

    it("adds no legacy review for an older export's rows the migrated items have outgrown", async function() {
      await versionThreeDatabase(rows, [pieceData("p1", "Minuet", 1000), pieceData("p2", "Waltz", 2000)])
      let store = await open({keep: true})
      let migrated = await storedReviews(store)
      let before = store.sectionStats("p1")

      // exported from the same browser before its last practice
      let library = {
        format: LIBRARY_FORMAT,
        version: 4,
        pieces: [pieceData("p1", "Minuet", 1000)],
        sectionStats: [
          section("p1", 1, 4, {hits: 1, misses: 0, lastPracticed: 500}),
          section("p1", 3, 3, {hits: 10, misses: 4, attempts: 3, lastPracticed: 2500, elapsedMs: 4000}),
        ],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.report.addedSections + result.report.updatedSections).toEqual(0)
      expect(result.report.addedReviews).toEqual(0)
      expect(await storedReviews(store)).toEqual(migrated)
      expect(store.sectionStats("p1")).toEqual(before)

      // a row practiced since still brings its totals and their review
      library.sectionStats.push(section("p1", 5, 8, {lastPracticed: 4000}))
      let newer = await importLibraryFile(JSON.stringify(library), store)
      expect(newer.report.addedSections).toEqual(1)
      expect(newer.report.addedReviews).toEqual(1)
      expect((await storedReviews(store)).length).toEqual(migrated.length + 1)
    })

    it("seeds no due dates from the migrated totals", async function() {
      let weightRows = [section("p1", 1, 1, {hits: 3, misses: 8}), section("p1", 2, 2, {hits: 9, misses: 0})]
      let cards = [{measures: [1]}, {measures: [2]}, {measures: [1, 2]}, {measures: [3]}]

      await versionThreeDatabase(weightRows, [pieceData("p1", "Minuet", 1000)])
      let store = await open({keep: true})
      expect(store.items("p1").map(item => [item.state, item.due])).toEqual([["tracked", undefined], ["tracked", undefined]])
      expect(cardWeights(cards, store.items("p1"))).toEqual([2, 2, 2, 2])
    })
  })

  for (let persist of [true, false]) {
    describe(persist ? "in IndexedDB" : "in memory", function() {
      let store

      beforeEach(async function() {
        store = await open({persist})
        expect(store.persistent).toBe(persist)
        await store.putPiece(pieceData("a", "First", 1000))
        await store.putPiece(pieceData("b", "Second", 2000, ["E4"]))
      })

      it("keeps section stats as a view adding up every hand of a range", async function() {
        await store.recordSectionPractice({pieceId: "a", startMeasure: 2, endMeasure: 2, hits: 4, misses: 1, at: 1000})
        let handItem = (hand, at, practice) =>
          itemWithPractice(newItem({pieceId: "a", hand, startMeasure: 2, endMeasure: 2}, at), {...practice, at})
        let upper = handItem("upper", 3000, {hits: 2, misses: 3, elapsedMs: 800})
        await store.recordAttempt({item: upper, review: attempt("a", 2, 2, 3000, {itemId: upper.id})})
        let lower = handItem("lower", 2000, {hits: 1, misses: 0})
        await store.recordAttempt({item: lower, review: attempt("a", 2, 2, 2000, {itemId: lower.id})})

        // a beat range inside the bar isn't a section of its own
        let beats = {...newItem({pieceId: "a", startMeasure: 2, endMeasure: 2}, 10), beats: [1, 2], hits: 9}
        beats.id = itemId(beats)
        await store.recordAttempt({item: beats, review: attempt("a", 2, 2, 50, {itemId: beats.id})})

        expect(store.items("a").map(item => item.id)).toEqual(["a:both:2-2", "a:upper:2-2", "a:lower:2-2", "a:both:2@1-2"])
        expect(store.sectionStats("a")).toEqual([
          {pieceId: "a", startMeasure: 2, endMeasure: 2, hits: 7, misses: 4, attempts: 3, lastPracticed: 3000, elapsedMs: 800},
        ])

        // the same array until an item changes
        expect(store.sectionStats()).toBe(store.sectionStats())
      })

      it("writes the review, the item, the related items and the session in one write", async function() {
        await store.recordSectionPractice({pieceId: "a", startMeasure: 1, endMeasure: 2, hits: 1, misses: 0, at: 500})

        let item = practicedItem("a", 1, 1, 1000)
        let parent = {...store.item("a:both:1-2"), state: "split"}
        let session = {id: "s1", startedAt: Date.now(), notesRead: 4}
        let review = attempt("a", 1, 1, 1000, {sessionId: "s1"})

        spyOn(store.backend, "write").and.callThrough()
        let stored = await store.recordAttempt({item, review, related: [parent], session})
        expect(store.backend.write).toHaveBeenCalledTimes(1)

        // the graded measure is scheduled in the same write, the range isn't
        item = applyGrade(item, review.grade, review.at)
        expect(item.state).toEqual("learning")
        expect(stored).toEqual(item)
        expect(store.item("a:both:1-1")).toEqual(item)
        expect(store.item("a:both:1-2").state).toEqual("split")
        expect(store.recentSessions().map(s => s.id)).toEqual(["s1"])
        expect(await store.reviews({sessionId: "s1"})).toEqual([review])
        expect(await store.reviews({pieceId: "a"})).toEqual([review])
        expect(await store.reviews({pieceId: "b"})).toEqual([])

        if (persist) {
          let reopened = await open({keep: true})
          expect(reopened.item("a:both:1-1")).toEqual(item)
          expect(reopened.item("a:both:1-2").state).toEqual("split")
          expect(reopened.recentSessions().map(s => s.id)).toEqual(["s1"])
          expect(await reopened.reviews({sessionId: "s1"})).toEqual([review])
        }
      })

      it("reads an attempt graded before per-column measurements beside one with them, each schedule from its stored grade", async function() {
        let old = attempt("a", 1, 1, 1000, {grade: 2})
        let item = applyGrade(practicedItem("a", 1, 1, 1000), old.grade, old.at)
        await store.recordAttempt({item: practicedItem("a", 1, 1, 1000), review: old})

        let measured = attempt("a", 1, 1, 2000, {
          grade: 4, algo: 2, perColumn: [[0, 0, 400, 0, 0, 0, null], [0, 0, 350, 20, 0, 0, null]],
        })
        await store.recordAttempt(stored => ({item: stored.item("a:both:1-1"), review: measured}))
        item = applyGrade(item, measured.grade, measured.at)

        // the second is scheduled from the first, so it carries the recall predicted
        measured = {...measured, r: jasmine.any(Number)}
        expect(await store.reviews({pieceId: "a"})).toEqual([old, measured])
        expect(store.item("a:both:1-1")).toEqual(jasmine.objectContaining({
          state: item.state, due: item.due, s: item.s, lastGrade: 4,
        }))

        if (persist) {
          let reopened = await open({keep: true})
          expect(await reopened.reviews({pieceId: "a"})).toEqual([old, measured])
        }
      })

      it("builds an attempt from the items as stored once the writes before it are done", async function() {
        let build = at => stored => {
          let current = stored.item("a:both:1-1") || newItem({pieceId: "a", startMeasure: 1, endMeasure: 1}, at)
          return {item: itemWithPractice(current, {hits: 2, misses: 0, at}), review: attempt("a", 1, 1, at)}
        }

        // queued before either is written, the second still adds to the first
        await Promise.all([store.recordAttempt(build(1000)), store.recordAttempt(build(2000))])
        expect([store.item("a:both:1-1").hits, store.item("a:both:1-1").attempts]).toEqual([4, 2])
        expect((await store.reviews({pieceId: "a"})).map(review => review.at)).toEqual([1000, 2000])
      })

      it("adds section practice under its hand, several ranges with a session in one write", async function() {
        await store.recordSectionPractice({pieceId: "a", hand: "lower", startMeasure: 3, endMeasure: 3, hits: 1, misses: 2, at: 500})

        spyOn(store.backend, "write").and.callThrough()
        await store.putSession({id: "s1", startedAt: Date.now()}, {sectionPractice: [
          {pieceId: "a", hand: "upper", startMeasure: 3, endMeasure: 4, hits: 2, misses: 0, at: 900, elapsedMs: 700},
          {pieceId: "a", hand: "upper", startMeasure: 3, endMeasure: 3, hits: 2, misses: 0, at: 900, elapsedMs: 700},
        ]})
        expect(store.backend.write).toHaveBeenCalledTimes(1)

        expect(store.items("a").map(item => [item.id, item.hits, item.misses])).toEqual([
          ["a:lower:3-3", 1, 2], ["a:upper:3-4", 2, 0], ["a:upper:3-3", 2, 0],
        ])
        expect(store.sectionStats("a").find(stats => stats.endMeasure == 3)).toEqual(
          {pieceId: "a", startMeasure: 3, endMeasure: 3, hits: 3, misses: 2, attempts: 2, lastPracticed: 900, elapsedMs: 700})
      })

      it("leaves the cache untouched when an attempt can't be written", async function() {
        let item = practicedItem("a", 1, 1, 1000)
        let review = attempt("a", 1, 1, 1000)

        await expectAsync(store.recordAttempt({item, review: {...review, itemId: "a:both:2-2"}}))
          .toBeRejectedWithError("Not a valid review")
        await expectAsync(store.recordAttempt({item: {...item, hits: -1}, review}))
          .toBeRejectedWithError("Not a valid item")
        await expectAsync(store.recordAttempt({item, review, session: {id: "s"}}))
          .toBeRejectedWithError("Not a valid session")

        spyOn(store.backend, "write").and.rejectWith(
          new DOMException("The quota has been exceeded.", "QuotaExceededError"))
        await expectAsync(store.recordAttempt({item, review, session: {id: "s", startedAt: 1}})).toBeRejected()

        expect(store.items()).toEqual([])
        expect(store.sectionStats()).toEqual([])
        expect(store.recentSessions()).toEqual([])

        store.backend.write.and.callThrough()
        expect(await store.reviews({pieceId: "a"})).toEqual([])
        await store.recordAttempt({item, review})
        expect(store.items()).toEqual([applyGrade(item, review.grade, review.at)])
      })

      it("removes a piece's items, reviews and study with it", async function() {
        for (let pieceId of ["a", "b"]) {
          await store.recordAttempt({item: practicedItem(pieceId, 1, 1, 1000), review: attempt(pieceId, 1, 1, 1000)})
          await store.recordSectionPractice({pieceId, startMeasure: 1, endMeasure: 4, hits: 1, misses: 0, at: 1000})
          await store.putStudy({pieceId, status: "learning", startedAt: 1000})
        }

        // the frozen section stats rows of the piece go too
        await store.backend.write([
          {store: "sectionStats", put: section("a", 1, 4)},
          {store: "sectionStats", put: section("b", 1, 4)},
        ])

        expect(await store.deletePiece("a")).toBe(true)

        expect(store.items().map(item => item.pieceId)).toEqual(["b", "b"])
        expect(store.sectionStats("a")).toEqual([])
        expect(store.study("a")).toBe(null)
        expect(store.study("b").status).toEqual("learning")
        expect((await storedReviews(store)).map(review => review.pieceId)).toEqual(["b"])
        expect((await store.backend.getAll("sectionStats")).map(row => row.pieceId)).toEqual(["b"])
        expect(await store.backend.get("studies", "a")).toBeUndefined()
      })

      it("keeps a study of a stored piece, with room for its phrase map", async function() {
        let study = {
          pieceId: "a", status: "learning", startedAt: 1000,
          map: {
            algo: 1, basis: "musicxml", computedAt: 1000, measures: 8, numbersHash: "abc",
            phrases: [[1, 4], [5, 8]], sections: [[1, 8]], strengths: [0, 0, 0, 1.5, 0, 0, 0], edited: false,
          },
        }
        await store.putStudy(study)
        expect(store.study("a")).toEqual(study)

        await expectAsync(store.putStudy({...study, pieceId: "missing"})).toBeRejectedWithError("Not a valid study")
        await expectAsync(store.putStudy({...study, status: "done"})).toBeRejectedWithError("Not a valid study")

        await store.putStudy({...study, status: "shelved"})
        expect(store.study("a").status).toEqual("shelved")
      })

      it("reads records in key order, and only indexed records by index", async function() {
        await store.recordAttempt({item: practicedItem("b", 1, 1, 1000), review: attempt("b", 1, 1, 3000)})
        await store.recordAttempt({item: practicedItem("a", 10, 10, 1000), review: attempt("a", 10, 10, 2000)})
        await store.recordAttempt({item: practicedItem("a", 2, 2, 1000), review: attempt("a", 2, 2, 1000)})
        await store.recordSectionPractice({pieceId: "a", startMeasure: 1, endMeasure: 4, hits: 1, misses: 0, at: 1000})

        expect((await store.backend.getAll("items")).map(item => item.id))
          .toEqual(["a:both:1-4", "a:both:10-10", "a:both:2-2", "b:both:1-1"])
        expect(await store.backend.getAllKeys("reviews")).toEqual([
          ["a:both:10-10", 2000], ["a:both:2-2", 1000], ["b:both:1-1", 3000],
        ])
        expect((await store.backend.getAllFrom("reviews", "at", 1500)).map(review => review.at)).toEqual([2000, 3000])

        // scheduled measures are in the due index in due order; a tracked
        // range has no due date
        expect((await store.backend.getAllFrom("items", "due", 0)).map(item => item.id))
          .toEqual(["a:both:2-2", "a:both:10-10", "b:both:1-1"])
      })
    })
  }

  describe("library", function() {
    it("imports the section stats of a version 4 library as items with a legacy review, once", async function() {
      let store = await open()
      let library = {
        format: LIBRARY_FORMAT,
        version: 4,
        pieces: [pieceData("old", "Old", 1000)],
        sectionStats: [section("old", 1, 2), section("old", 3, 3, {elapsedMs: 900})],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.message).toEqual("Added 1 piece and stats for 2 sections")
      expect(result.report.addedReviews).toEqual(2)
      expect(store.items("old")).toEqual(library.sectionStats.map(row =>
        ({...itemFromSectionStats(row), createdAt: jasmine.any(Number)})))
      expect(await storedReviews(store)).toEqual(library.sectionStats.map(legacyReview))
      expect(store.sectionStats("old")).toEqual(library.sectionStats)

      let again = await importLibraryFile(JSON.stringify(library), store)
      expect(again.report.addedSections + again.report.updatedSections).toEqual(0)
      expect(again.report.addedReviews).toEqual(0)
      expect(store.items().length).toEqual(2)
      expect((await storedReviews(store)).length).toEqual(2)
    })

    it("keeps a stored item's schedule when an older library brings newer totals", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      let item = await store.recordAttempt({
        item: practicedItem("a", 1, 1, 1000, {elapsedMs: 50}), review: attempt("a", 1, 1, 1000),
      })
      expect(item.state).toEqual("learning")

      let library = {
        format: LIBRARY_FORMAT,
        version: 4,
        pieces: [pieceData("a", "First", 1000)],
        sectionStats: [section("a", 1, 1, {hits: 40, lastPracticed: 5000})],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.report.updatedSections).toEqual(1)

      // the row had no time, so the item loses its time as a replaced row did
      let {elapsedMs, ...untimed} = item
      expect(elapsedMs).toEqual(50)
      expect(store.item("a:both:1-1")).toEqual({
        ...untimed, hits: 40, misses: 1, attempts: 1, lastPracticed: 5000,
      })
    })

    it("round trips items, reviews and studies, and importing twice adds nothing", async function() {
      let store = await open()
      await store.putPiece(pieceData("a", "First", 1000))
      await store.recordAttempt({item: practicedItem("a", 1, 1, 1000), review: attempt("a", 1, 1, 1000)})
      await store.recordAttempt({
        item: practicedItem("a", 1, 1, 2000, {hand: "upper", id: "a:upper:1-1"}),
        review: attempt("a", 1, 1, 2000, {itemId: "a:upper:1-1", staffMisses: {upper: 2, lower: 0}}),
      })
      await store.putStudy({pieceId: "a", status: "learning", startedAt: 900})

      let file = await exportLibraryFile(store)
      let data = JSON.parse(file.text)
      expect(data.version).toEqual(LIBRARY_VERSION)
      expect(LIBRARY_VERSION).toEqual(6)
      expect(data.items.map(item => item.id)).toEqual(["a:both:1-1", "a:upper:1-1"])
      expect(data.reviews.map(review => [review.itemId, review.at])).toEqual([["a:both:1-1", 1000], ["a:upper:1-1", 2000]])
      expect(data.studies).toEqual([{pieceId: "a", status: "learning", startedAt: 900}])
      expect(data.sectionStats).toBeUndefined()

      await store.close()
      let other = await open()
      let result = await importLibraryFile(file.text, other)
      expect(result.message).toEqual("Added 1 piece and stats for 2 sections")
      expect(result.report.addedReviews).toEqual(2)
      expect(result.report.addedStudies).toEqual(1)

      let reopened = await open({keep: true})
      expect(reopened.items()).toEqual(data.items)
      expect(await storedReviews(reopened)).toEqual(data.reviews)
      expect(reopened.study("a")).toEqual(data.studies[0])
      expect(reopened.sectionStats("a")).toEqual([
        {pieceId: "a", startMeasure: 1, endMeasure: 1, hits: 8, misses: 2, attempts: 2, lastPracticed: 2000},
      ])

      let again = await importLibraryFile(file.text, reopened)
      expect(again.message).toEqual("Added 0 pieces; 1 piece already in the library")
      expect(again.report.addedReviews).toEqual(0)
      expect(again.report.addedStudies).toEqual(0)
      expect(reopened.items()).toEqual(data.items)
      expect((await storedReviews(reopened)).length).toEqual(2)
    })

    it("merges two libraries: a union of reviews, the more recently practiced item, under the stored piece's id", async function() {
      let store = await open()
      await store.putPiece(pieceData("local", "Same notes", 1000, ["F4"]))
      let local = practicedItem("local", 1, 1, 1000)
      await store.recordAttempt({item: local, review: attempt("local", 1, 1, 1000)})
      await store.recordAttempt({item: practicedItem("local", 2, 2, 9000), review: attempt("local", 2, 2, 9000)})
      await store.putStudy({pieceId: "local", status: "maintaining", startedAt: 100})

      // the same piece practiced in another browser, stored under another id
      let remoteItem = (m, at, extra) => practicedItem("remote", m, m, at, extra)
      let library = {
        format: LIBRARY_FORMAT,
        version: LIBRARY_VERSION,
        pieces: [pieceData("remote", "Same notes", 1000, ["F4"])],
        items: [
          remoteItem(1, 5000, {hits: 20}), // newer, replaces
          remoteItem(2, 3000, {hits: 30}), // older, kept out
          remoteItem(3, 3000),
          {id: "broken"},
        ],
        reviews: [
          attempt("remote", 1, 1, 1000), // the same attempt, already stored
          attempt("remote", 1, 1, 5000),
          attempt("remote", 2, 2, 3000),
          attempt("remote", 3, 3, 3000),
          attempt("unknown", 1, 1, 3000),
          {itemId: "remote:both:1-1"},
        ],
        studies: [{pieceId: "remote", status: "learning", startedAt: 50}],
      }

      let result = await importLibraryFile(JSON.stringify(library), store)
      expect(result.report.existingPieces).toEqual(1)
      expect(result.report.addedSections).toEqual(1)
      expect(result.report.updatedSections).toEqual(1)
      expect(result.report.addedReviews).toEqual(3)
      expect(result.report.addedStudies).toEqual(0)

      expect(store.items().map(item => [item.id, item.hits])).toEqual([
        ["local:both:1-1", 20], ["local:both:2-2", 4], ["local:both:3-3", 4],
      ])
      expect(store.items().every(validItem)).toBe(true)
      expect((await storedReviews(store)).map(review => [review.itemId, review.at, review.pieceId])).toEqual([
        ["local:both:1-1", 1000, "local"],
        ["local:both:1-1", 5000, "local"],
        ["local:both:2-2", 3000, "local"],
        ["local:both:2-2", 9000, "local"],
        ["local:both:3-3", 3000, "local"],
      ])
      expect(store.study("local").status).toEqual("maintaining")
    })
  })
})
