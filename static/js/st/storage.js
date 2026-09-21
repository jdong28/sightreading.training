// The local store: practice data kept in the browser with IndexedDB (through
// the "idb" package), with no server behind it.
//
// One database holds the stores in STORES: the imported sheet music pieces
// (the deck, see st/sheet_music_deck), the source score each piece was
// imported from, the practice records of spaced repetition (items, the log of
// reviews and studies, see st/srs/records), practice sessions, and in meta
// the scheduler's and practice settings (st/srs/schedule).
// init() loads the pieces, items, studies, recent sessions and settings into an
// in-memory cache so the UI reads synchronously (eg. a generator's settings
// inputs on every render); a piece's source and the reviews are read on
// demand. Every
// mutation is async, writes to the database first and only then updates the
// cache, so a failed write (usually the storage quota) leaves both untouched.
// Mutations run one at a time in call order.
//
// When IndexedDB can't be opened (blocked by the browser, private modes) the
// store keeps everything in memory for the visit and says so in the console.
//
// Times are milliseconds since the epoch (Date.now()).

import {openDB} from "idb"
import {shiftNoteOctave} from "st/music"
import {
  validItem, validReview, validStudy, newItem, itemId, itemFromSectionStats,
  legacyReview, itemWithPractice, itemForPiece, reviewForPiece, sectionStatsOf
} from "st/srs/records"
import {
  applyGrade, predictedRecall, replay, schedulable, scheduled,
  validSchedulerSettings, validPracticeSettings,
  SCHEDULER_SETTINGS_KEY, PRACTICE_SETTINGS_KEY,
  DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS
} from "st/srs/schedule"
import {
  SOURCE_ENCODING, compressSource, decompressSource, isCompressedSource,
  bytesToBase64, base64ToBytes
} from "st/score_source"

export const DB_NAME = "sightreading"

// bump with a new step in upgradeSchema when the stores change
// 2: note names of stored pieces moved to middle C "C4", see
// renumberPieceOctaves
// 3: adds the pieceSources store; pieces stored before it have no source
// 4: adds the items, reviews and studies stores; each sectionStats row is
// migrated into a tracked item and a legacy review, and the sectionStats store
// is left as it was, frozen: nothing reads or writes it after the migration
export const DB_VERSION = 4

// the localStorage deck used before the local store, migrated into the pieces
// store once, see migrateLegacyDeck. The key itself is left in place
export const LEGACY_DECK_KEY = "st:sheet_music_pieces:v1"

// meta store record written with the migrated pieces, its presence means the
// legacy deck has been migrated (or there was none) and is never read again
export const DECK_MIGRATION_MARKER = "legacyDeckMigrated"

export const LIBRARY_FORMAT = "sightreading-library"
// 2: note names use middle C "C4", version 1 pieces are renumbered on import
// 3: pieces carry the score's rhythm (song format 2, see st/sheet_music_deck);
// version 2 pieces are read as they are and drill unchanged, drawn as whole
// notes until their score is imported again
// 4: carries the source score of the pieces that have one (sources); older
// libraries have none
// 5: carries items, reviews and studies in place of sectionStats; the section
// stats of older libraries are imported as tracked items with a legacy review
export const LIBRARY_VERSION = 5

// sessions started within this many days are loaded into the cache
export const RECENT_SESSION_DAYS = 30

const DAY = 24 * 60 * 60 * 1000

// how long init waits for the database to open before falling back to memory,
// eg. when another tab blocks a schema upgrade
const OPEN_TIMEOUT = 5000

const STORES = {
  pieces: {keyPath: "id"},
  pieceSources: {keyPath: "pieceId"},
  // frozen since DB_VERSION 4: kept as it was migrated, read and written by
  // nothing but deletePiece
  sectionStats: {
    keyPath: ["pieceId", "startMeasure", "endMeasure"],
    indexes: {pieceId: "pieceId"},
  },
  sessions: {keyPath: "id", indexes: {startedAt: "startedAt"}},
  meta: {keyPath: "key"},
  items: {keyPath: "id", indexes: {pieceId: "pieceId", due: "due"}},
  reviews: {
    keyPath: ["itemId", "at"],
    indexes: {at: "at", sessionId: "sessionId", pieceId: "pieceId"},
  },
  studies: {keyPath: "pieceId"},
}

/**
 * An imported piece. song is the compact song JSON, see songToJSON in
 * st/sheet_music_deck.
 * @typedef {Object} PieceRecord
 * @property {string} id
 * @property {string} title
 * @property {Object} song
 * @property {number} importedAt
 * @property {string} [fileName]
 */

/**
 * The MusicXML text a piece was imported from, gzipped (see st/score_source).
 * Kept out of the cache, read with LocalStore#pieceSource. In a library file
 * data is base64.
 * @typedef {Object} PieceSourceRecord
 * @property {string} pieceId
 * @property {string} encoding SOURCE_ENCODING
 * @property {Uint8Array} data
 * @property {number} storedAt
 */

/**
 * Practice on one measure range of a piece (the score's printed bar
 * numbers): the rows of the sectionStats store before DB_VERSION 4, and now a
 * view over the items of the range, see LocalStore#sectionStats.
 * @typedef {Object} SectionStatsRecord
 * @property {string} pieceId
 * @property {number} startMeasure
 * @property {number} endMeasure
 * @property {number} hits
 * @property {number} misses
 * @property {number} attempts practice stints on the section with any notes played
 * @property {number} lastPracticed
 * @property {number} [elapsedMs] time spent playing the section, kept for
 * the single measures practiced on measure flashcards (see st/measure_cards)
 */

/**
 * One sight reading session, see NoteStats#sessionRecord.
 * @typedef {Object} SessionRecord
 * @property {string} id
 * @property {number} startedAt the first note played
 * @property {number} endedAt the last note played
 * @property {number} activeSeconds time between notes, leaving out pauses
 * @property {string} staff
 * @property {string} generator
 * @property {Object} settings summary of the generator settings
 * @property {number} notesRead
 * @property {number} misses
 * @property {number} bestStreak
 * @property {Object<string, {hits: number, misses: number}>} notes by note name without octave
 */

/**
 * @typedef {Object} LibraryExport
 * @property {string} format LIBRARY_FORMAT
 * @property {number} version LIBRARY_VERSION
 * @property {string} exportedAt
 * @property {PieceRecord[]} pieces
 * @property {PieceSourceRecord[]} [sources] with base64 data, since version 4
 * @property {ItemRecord[]} [items] since version 5
 * @property {ReviewRecord[]} [reviews] since version 5
 * @property {StudyRecord[]} [studies] since version 5
 * @property {Object[]} [settings] the scheduler and practice settings records
 * (st/srs/schedule), since version 5
 * @property {SectionStatsRecord[]} [sectionStats] before version 5
 * @property {SessionRecord[]} sessions
 */

/**
 * What importLibrary did. Pieces already in the library (by id, or by the
 * same title and notes) count as existing and aren't added again, as do
 * sessions with an id already in the library.
 * @typedef {Object} LibraryImportReport
 * @property {number} addedPieces
 * @property {number} existingPieces
 * @property {number} invalidPieces
 * @property {number} fullPieces pieces left out because the library is full
 * @property {number} addedSources sources added to pieces that had none
 * @property {number} addedSections items added (from section stats in older libraries)
 * @property {number} updatedSections items replaced by more recently practiced ones
 * @property {number} addedReviews
 * @property {number} addedStudies studies of pieces that had none
 * @property {number} importedSettings settings records, which replace this library's
 * @property {number} addedSessions
 * @property {number} existingSessions
 */

// The app used to number octaves one higher, with middle C as "C5" (and it
// still does in pieces stored before DB_VERSION 2, the legacy deck and
// libraries exported before LIBRARY_VERSION 2). A piece in that numbering ->
// the same piece with its note names renumbered so every pitch stays the same.
// Anything that isn't a note name is left as it is
export function renumberPieceOctaves(piece) {
  let tracks = piece && piece.song && piece.song.tracks
  if (!Array.isArray(tracks)) {
    return piece
  }

  let renumber = name => {
    try {
      return shiftNoteOctave(name, -1)
    } catch (e) {
      return name
    }
  }

  return {
    ...piece,
    song: {
      ...piece.song,
      tracks: tracks.map(track => track && Array.isArray(track.notes) ? {
        ...track,
        notes: track.notes.map((value, idx) =>
          idx % 3 == 0 && typeof value == "string" ? renumber(value) : value)
      } : track),
    },
  }
}

function createStore(db, name) {
  let {keyPath, indexes} = STORES[name]
  let store = db.createObjectStore(name, {keyPath})
  for (let [indexName, indexPath] of Object.entries(indexes || {})) {
    store.createIndex(indexName, indexPath)
  }
}

async function upgradeSchema(db, oldVersion, newVersion, transaction) {
  if (oldVersion < 1) {
    for (let name of Object.keys(STORES)) {
      createStore(db, name)
    }
  }

  if (oldVersion >= 1 && oldVersion < 2) {
    // only requests on the upgrade transaction may be awaited here, or it
    // commits before the pieces are written back
    let pieces = transaction.objectStore("pieces")
    for (let piece of await pieces.getAll()) {
      pieces.put(renumberPieceOctaves(piece))
    }
  }

  if (oldVersion >= 1 && oldVersion < 3) {
    // the stored pieces keep loading and drilling without a source, until
    // their score is imported again
    db.createObjectStore("pieceSources", {keyPath: STORES.pieceSources.keyPath})
  }

  if (oldVersion >= 1 && oldVersion < 4) {
    createStore(db, "items")
    createStore(db, "reviews")
    createStore(db, "studies")

    // every section stats row becomes an item and a legacy review, and
    // sectionStats is left as it is
    let items = transaction.objectStore("items")
    let reviews = transaction.objectStore("reviews")
    let now = Date.now()
    for (let stats of await transaction.objectStore("sectionStats").getAll()) {
      items.put(itemFromSectionStats(stats, now))
      reviews.put(legacyReview(stats))
    }
  }
}

function defaultIndexedDB() {
  try {
    return window.indexedDB || null
  } catch (e) {
    return null
  }
}

function defaultLocalStorage() {
  try {
    return window.localStorage
  } catch (e) {
    return null
  }
}

// store access over an open IndexedDB database
class IndexedDBBackend {
  persistent = true

  constructor(db) {
    this.db = db
  }

  get(store, key) {
    return this.db.get(store, key)
  }

  getAll(store) {
    return this.db.getAll(store)
  }

  getAllKeys(store) {
    return this.db.getAllKeys(store)
  }

  getAllFrom(store, index, lower) {
    return this.db.getAllFromIndex(store, index, IDBKeyRange.lowerBound(lower))
  }

  // the records whose index is value
  getAllWith(store, index, value) {
    return this.db.getAllFromIndex(store, index, value)
  }

  // ops: [{store, put: record} or {store, delete: key}], in one transaction
  async write(ops) {
    if (!ops.length) { return }

    let tx = this.db.transaction([...new Set(ops.map(op => op.store))], "readwrite")
    let requests = ops.map(op => "delete" in op ?
      tx.objectStore(op.store).delete(op.delete) :
      tx.objectStore(op.store).put(op.put))

    // commit now rather than when control returns to the event loop, which
    // never happens for a write started as the page is left or reloaded
    if (tx.commit) {
      tx.commit()
    }

    await Promise.all([...requests, tx.done])
  }

  async clear() {
    let names = Object.keys(STORES)
    let tx = this.db.transaction(names, "readwrite")
    await Promise.all([...names.map(store => tx.objectStore(store).clear()), tx.done])
  }

  close() {
    this.db.close()
  }
}

// the same access kept in memory, for when IndexedDB is unavailable. Records
// are copied in and out and read in key order like IndexedDB does, and a
// record without a valid key at an index's path is left out of that index
class MemoryBackend {
  persistent = false

  constructor() {
    this.stores = {}
    for (let name of Object.keys(STORES)) {
      this.stores[name] = new Map()
    }
  }

  async get(store, key) {
    let record = this.stores[store].get(memoryKey(key))
    return record === undefined ? undefined : structuredClone(record)
  }

  // [key, record] in key order
  entries(store) {
    return [...this.stores[store].entries()]
      .map(([key, record]) => [JSON.parse(key), record])
      .sort(([a], [b]) => compareKeys(a, b))
  }

  // [key, record] of the records in the index, in index order
  indexEntries(store, index) {
    let path = STORES[store].indexes[index]
    return this.entries(store)
      .filter(([key, record]) => validKey(record[path]))
      .sort(([a, x], [b, y]) => compareKeys(x[path], y[path]) || compareKeys(a, b))
  }

  async getAll(store) {
    return this.entries(store).map(([key, record]) => structuredClone(record))
  }

  async getAllKeys(store) {
    return this.entries(store).map(([key]) => key)
  }

  async getAllFrom(store, index, lower) {
    let path = STORES[store].indexes[index]
    return this.indexEntries(store, index)
      .filter(([key, record]) => compareKeys(record[path], lower) >= 0)
      .map(([key, record]) => structuredClone(record))
  }

  async getAllWith(store, index, value) {
    let path = STORES[store].indexes[index]
    return this.indexEntries(store, index)
      .filter(([key, record]) => compareKeys(record[path], value) == 0)
      .map(([key, record]) => structuredClone(record))
  }

  async write(ops) {
    // copy first so a record that can't be cloned fails the whole write
    let copies = ops.map(op => "delete" in op ? op : {...op, put: structuredClone(op.put)})
    for (let op of copies) {
      if ("delete" in op) {
        this.stores[op.store].delete(memoryKey(op.delete))
      } else {
        this.stores[op.store].set(memoryKey(recordKey(op.store, op.put)), op.put)
      }
    }
  }

  async clear() {
    for (let map of Object.values(this.stores)) {
      map.clear()
    }
  }

  close() {}
}

const memoryKey = key => JSON.stringify(key)

// the key of a record of store
function recordKey(store, record) {
  let {keyPath} = STORES[store]
  return Array.isArray(keyPath) ? keyPath.map(path => record[path]) : record[keyPath]
}

// the keys IndexedDB orders, of the kinds the stores use
const validKey = key => (typeof key == "number" && !Number.isNaN(key)) ||
  typeof key == "string" || (Array.isArray(key) && key.every(validKey))

const keyRank = key => typeof key == "number" ? 0 : typeof key == "string" ? 1 : 2

// IndexedDB's key order: numbers, then strings, then arrays element by element
function compareKeys(a, b) {
  if (keyRank(a) != keyRank(b)) {
    return keyRank(a) - keyRank(b)
  }

  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      let order = compareKeys(a[i], b[i])
      if (order) { return order }
    }
    return a.length - b.length
  }

  return a < b ? -1 : a > b ? 1 : 0
}

async function openIndexedDBBackend(name, timeout) {
  if (!defaultIndexedDB()) {
    throw new Error("IndexedDB is not supported")
  }

  let db = null
  let timer
  let timedOut = false

  let opening = openDB(name, DB_VERSION, {
    upgrade: upgradeSchema,
    // another tab wants a newer schema: let it, writes here then fail with
    // an error message until this tab reloads
    blocking: () => db && db.close(),
  })

  try {
    db = await Promise.race([
      opening,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new Error(`Opening the database took over ${timeout}ms`))
        }, timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (timedOut) {
      // the store has moved on to memory, don't leave a connection open
      opening.then(late => late.close(), () => {})
    }
  }

  return new IndexedDBBackend(db)
}

// thrown by importLibrary for data that isn't a library it can read
export class LibraryFormatError extends Error {}

const byImportOrder = (a, b) =>
  (a.importedAt || 0) - (b.importedAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const byStart = (a, b) => (a.startedAt || 0) - (b.startedAt || 0)

const pieceContent = piece => `${piece.title}\n${JSON.stringify(piece.song)}`

const isCount = n => Number.isInteger(n) && n >= 0

/**
 * @param {*} piece
 * @returns {boolean} whether piece has the shape of a stored piece
 */
export function validPiece(piece) {
  return !!piece && typeof piece == "object" &&
    typeof piece.id == "string" && piece.id != "" && typeof piece.title == "string" &&
    !!piece.song && typeof piece.song == "object"
}

function validSession(session) {
  return !!session && typeof session == "object" &&
    typeof session.id == "string" && typeof session.startedAt == "number"
}

// a section stats row, as stored before DB_VERSION 4 and carried by
// libraries before LIBRARY_VERSION 5
function validSectionStats(stats) {
  return !!stats && typeof stats == "object" &&
    typeof stats.pieceId == "string" &&
    Number.isInteger(stats.startMeasure) && Number.isInteger(stats.endMeasure) &&
    isCount(stats.hits) && isCount(stats.misses) && isCount(stats.attempts) &&
    typeof stats.lastPracticed == "number" &&
    (stats.elapsedMs === undefined || isCount(stats.elapsedMs))
}

// the stored fields of a piece, dropping anything else
function pieceRecord(piece, importedAt) {
  let record = {
    id: piece.id,
    title: piece.title,
    song: piece.song,
    importedAt: typeof piece.importedAt == "number" ? piece.importedAt : importedAt,
  }

  if (typeof piece.fileName == "string") {
    record.fileName = piece.fileName
  }

  return record
}

const validSourceText = text => typeof text == "string" && text.trim() != ""

// the pieceSources record of a piece's MusicXML text
function sourceRecord(pieceId, text, storedAt=Date.now()) {
  return {pieceId, encoding: SOURCE_ENCODING, data: compressSource(text), storedAt}
}

// a source as a library file carries it, with its bytes in base64
function sourceToJSON(source) {
  return {...source, data: bytesToBase64(source.data)}
}

// a source from a library file under the piece id of this library, or null
// when it isn't one
function sourceFromJSON(source, pieceId, importedAt) {
  if (!source || typeof source != "object" || source.encoding != SOURCE_ENCODING ||
      typeof source.data != "string") {
    return null
  }

  let data
  try {
    data = base64ToBytes(source.data)
  } catch (e) {
    return null
  }

  if (!isCompressedSource(data)) {
    return null
  }

  return {
    pieceId,
    encoding: SOURCE_ENCODING,
    data,
    storedAt: typeof source.storedAt == "number" ? source.storedAt : importedAt,
  }
}

export class LocalStore {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.name] database name, specs use their own
   * @param {boolean} [opts.persist] false keeps the store in memory
   * @param {Storage|null} [opts.localStorage] where the legacy deck is read from
   * @param {number} [opts.openTimeout]
   */
  constructor({
    name=DB_NAME, persist=true, localStorage=defaultLocalStorage(),
    openTimeout=OPEN_TIMEOUT
  }={}) {
    this.name = name
    this.persist = persist
    this.localStorage = localStorage
    this.openTimeout = openTimeout

    this.backend = null
    this.ready = null
    this.queue = Promise.resolve()
    this.sectionStatsView = {items: null, rows: []}

    this.cache = emptyCache()
  }

  /**
   * Opens the database (or falls back to memory), migrates the legacy deck
   * and loads the cache. Safe to call repeatedly, and never rejects.
   * @returns {Promise<void>}
   */
  init() {
    return this.ready ||= this.open()
  }

  async open() {
    try {
      if (!this.persist) {
        this.backend = new MemoryBackend()
      } else {
        this.backend = await openIndexedDBBackend(this.name, this.openTimeout)
      }
      await this.migrateLegacyDeck()
      await this.setUpScheduler()
      await this.loadCache()
      return
    } catch (e) {
      if (this.backend) {
        this.backend.close()
      }
      console.warn("IndexedDB is unavailable, so practice data and imported pieces are kept in memory and lost when the page closes:", e)
    }

    this.backend = new MemoryBackend()
    await this.migrateLegacyDeck()
    await this.setUpScheduler()
    await this.loadCache()
  }

  /** @returns {boolean} whether writes outlive the page */
  get persistent() {
    return !!(this.backend && this.backend.persistent)
  }

  // Copies the pieces of the localStorage deck used before the local store
  // into the pieces store, together with the migration marker so it runs
  // once. A failed migration is retried on the next init
  async migrateLegacyDeck() {
    try {
      if (await this.backend.get("meta", DECK_MIGRATION_MARKER)) {
        return
      }

      let pieces = []
      try {
        let stored = JSON.parse(this.localStorage ? this.localStorage.getItem(LEGACY_DECK_KEY) : null)
        if (stored && Array.isArray(stored.pieces)) {
          // the legacy deck predates the current octave numbering
          pieces = stored.pieces.filter(validPiece).map(renumberPieceOctaves)
        }
      } catch (e) {
        pieces = [] // blocked storage or malformed deck
      }

      let now = Date.now()
      let existing = new Set((await this.backend.getAll("pieces")).map(piece => piece.id))
      let added = pieces.filter(piece => !existing.has(piece.id))

      await this.backend.write([
        // keep the deck order, the pieces predate importedAt
        ...added.map((piece, idx) => ({store: "pieces", put: pieceRecord(piece, now + idx)})),
        {store: "meta", put: {key: DECK_MIGRATION_MARKER, migratedAt: now, pieces: added.length}},
      ])
    } catch (e) {
      console.warn("Couldn't migrate the sheet music deck from localStorage:", e)
    }
  }

  // Writes the settings records the first time the store opens with the
  // scheduler, and schedules the single measures graded before it by
  // replaying their reviews, so every schedule is the one its log gives. A
  // failed set up is retried on the next init
  async setUpScheduler() {
    try {
      if (await this.backend.get("meta", SCHEDULER_SETTINGS_KEY)) {
        return
      }

      let [items, reviews] = await Promise.all([
        this.backend.getAll("items"),
        this.backend.getAll("reviews"),
      ])

      let graded = new Map()
      for (let review of reviews) {
        if (review.kind == "attempt") {
          graded.set(review.itemId, [...graded.get(review.itemId) || [], review])
        }
      }

      let replayed = items
        .filter(item => schedulable(item) && !scheduled(item) && graded.has(item.id))
        .map(item => replay(graded.get(item.id), {item}))

      let practice = await this.backend.get("meta", PRACTICE_SETTINGS_KEY)
      await this.backend.write([
        ...replayed.map(item => ({store: "items", put: item})),
        {store: "meta", put: DEFAULT_SCHEDULER_SETTINGS},
        ...(practice ? [] : [{store: "meta", put: DEFAULT_PRACTICE_SETTINGS}]),
      ])
    } catch (e) {
      console.warn("Couldn't set up the practice scheduler:", e)
    }
  }

  async loadCache() {
    let [pieces, items, studies, sessions, scheduler, practice] = await Promise.all([
      this.backend.getAll("pieces"),
      this.backend.getAll("items"),
      this.backend.getAll("studies"),
      this.backend.getAllFrom("sessions", "startedAt", Date.now() - RECENT_SESSION_DAYS * DAY),
      this.backend.get("meta", SCHEDULER_SETTINGS_KEY),
      this.backend.get("meta", PRACTICE_SETTINGS_KEY),
    ])

    this.cache = {
      pieces: pieces.sort(byImportOrder),
      items,
      studies,
      sessions: sessions.sort(byStart),
      settings: {
        scheduler: validSchedulerSettings(scheduler) ? scheduler : DEFAULT_SCHEDULER_SETTINGS,
        practice: validPracticeSettings(practice) ? practice : DEFAULT_PRACTICE_SETTINGS,
      },
    }
  }

  // runs fn after init and every earlier mutation
  mutate(fn) {
    let result = this.queue.then(() => this.init()).then(fn)
    this.queue = result.catch(() => {})
    return result
  }

  /** @returns {PieceRecord[]} in import order, the same array until a piece changes */
  pieces() {
    return this.cache.pieces
  }

  /**
   * @param {string} id
   * @returns {PieceRecord|null}
   */
  piece(id) {
    return this.cache.pieces.find(piece => piece.id == id) || null
  }

  /**
   * The practice on each measure range, as the sectionStats store kept it
   * before items: the totals of the range's items of every hand added up.
   * @param {string} [pieceId] only the sections of this piece
   * @returns {SectionStatsRecord[]}
   */
  sectionStats(pieceId) {
    if (this.sectionStatsView.items != this.cache.items) {
      this.sectionStatsView = {items: this.cache.items, rows: sectionStatsOf(this.cache.items)}
    }

    let all = this.sectionStatsView.rows
    return pieceId == null ? all : all.filter(stats => stats.pieceId == pieceId)
  }

  /**
   * @param {string} [pieceId] only the items of this piece
   * @returns {ItemRecord[]}
   */
  items(pieceId) {
    let all = this.cache.items
    return pieceId == null ? all : all.filter(item => item.pieceId == pieceId)
  }

  /**
   * @param {string} id
   * @returns {ItemRecord|null}
   */
  item(id) {
    return this.cache.items.find(item => item.id == id) || null
  }

  /**
   * @param {string} pieceId
   * @returns {StudyRecord|null}
   */
  study(pieceId) {
    return this.cache.studies.find(study => study.pieceId == pieceId) || null
  }

  /**
   * The reviews of a piece or of a session, read from the database (they are
   * never cached), oldest first.
   * @param {{pieceId: string}|{sessionId: string}} query
   * @returns {Promise<ReviewRecord[]>}
   */
  reviews(query) {
    return this.mutate(async () => {
      let index = "sessionId" in query ? "sessionId" : "pieceId"
      let reviews = await this.backend.getAllWith("reviews", index, query[index])
      return reviews.sort((a, b) => a.at - b.at || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
    })
  }

  /** @returns {SessionRecord[]} sessions of the last RECENT_SESSION_DAYS, oldest first */
  recentSessions() {
    return this.cache.sessions
  }

  /** @returns {SchedulerSettings} the scheduler's parameters (st/srs/schedule) */
  schedulerSettings() {
    return this.cache.settings.scheduler
  }

  /** @returns {PracticeSettings} */
  practiceSettings() {
    return this.cache.settings.practice
  }

  /**
   * Adds or replaces a piece, in the same write as its source when one is given.
   * @param {PieceRecord} piece
   * @param {Object} [opts]
   * @param {string|null} [opts.source] the MusicXML text the piece was
   * imported from; null removes a stored source, leaving it out keeps it
   * @returns {Promise<PieceRecord>} the stored record
   */
  putPiece(piece, {source}={}) {
    return this.mutate(async () => {
      if (!validPiece(piece)) {
        throw new Error("Not a valid piece")
      }

      if (source != null && !validSourceText(source)) {
        throw new Error("Not a valid piece source")
      }

      let record = pieceRecord(piece, Date.now())
      await this.backend.write([
        {store: "pieces", put: record},
        ...(source === null ? [{store: "pieceSources", delete: record.id}] : []),
        ...(source != null ? [{store: "pieceSources", put: sourceRecord(record.id, source)}] : []),
      ])

      this.cache = {
        ...this.cache,
        pieces: [...this.cache.pieces.filter(p => p.id != record.id), record].sort(byImportOrder),
      }

      return record
    })
  }

  /**
   * Stores the MusicXML text a stored piece was imported from, replacing any
   * source it had.
   * @param {string} pieceId
   * @param {string} source
   * @returns {Promise<boolean>} whether there was such a piece
   */
  putPieceSource(pieceId, source) {
    return this.mutate(async () => {
      if (!validSourceText(source)) {
        throw new Error("Not a valid piece source")
      }

      if (!this.piece(pieceId)) {
        return false
      }

      await this.backend.write([{store: "pieceSources", put: sourceRecord(pieceId, source)}])
      return true
    })
  }

  /**
   * The MusicXML text a piece was imported from, read from the database (it
   * is never cached). Pieces imported before sources were kept have none.
   * @param {string} pieceId
   * @returns {Promise<string|null>} null when the piece has no readable source
   */
  pieceSource(pieceId) {
    return this.mutate(async () => {
      let source = await this.backend.get("pieceSources", pieceId)
      if (!source || !this.piece(pieceId)) {
        return null
      }

      try {
        return decompressSource(source.data)
      } catch (e) {
        console.warn(`The source score of piece ${pieceId} can't be read:`, e)
        return null
      }
    })
  }

  /**
   * Removes a piece along with its source, items, reviews, study and the
   * frozen section stats rows it had before items.
   * @param {string} id
   * @returns {Promise<boolean>} whether there was such a piece
   */
  deletePiece(id) {
    return this.mutate(async () => {
      if (!this.piece(id)) {
        return false
      }

      let [reviews, sections] = await Promise.all([
        this.backend.getAllWith("reviews", "pieceId", id),
        this.backend.getAllWith("sectionStats", "pieceId", id),
      ])

      let deletes = (store, records) =>
        records.map(record => ({store, delete: recordKey(store, record)}))

      await this.backend.write([
        {store: "pieces", delete: id},
        {store: "pieceSources", delete: id},
        {store: "studies", delete: id},
        ...deletes("items", this.items(id)),
        ...deletes("reviews", reviews),
        ...deletes("sectionStats", sections),
      ])

      this.cache = {
        ...this.cache,
        pieces: this.cache.pieces.filter(piece => piece.id != id),
        items: this.cache.items.filter(item => item.pieceId != id),
        studies: this.cache.studies.filter(study => study.pieceId != id),
      }

      return true
    })
  }

  /**
   * Stores one attempt at an item in a single write: the review, the item as
   * the attempt left it, any other items the attempt changed (related) and
   * the session it was played in. The item and the related items replace the
   * stored ones of their id.
   *
   * A graded review of a single measure item also schedules it (see
   * applyGrade in st/srs/schedule, under schedulerSettings()): the item is
   * written with the schedule the grade gives from the one it carries, and
   * the review with the recall that schedule predicted (r), when it had one.
   * @param {Object|function(LocalStore): Object} attempt, or a function
   * building it from this store once the writes before it are done, eg. to
   * add to an item as stored
   * @param {ItemRecord} attempt.item
   * @param {ReviewRecord} attempt.review of attempt.item
   * @param {ItemRecord[]} [attempt.related]
   * @param {SessionRecord} [attempt.session]
   * @returns {Promise<ItemRecord>} the stored item
   */
  recordAttempt(attempt) {
    return this.mutate(async () => {
      let {item, review, related=[], session} =
        typeof attempt == "function" ? attempt(this) : attempt

      if (item && review && review.kind == "attempt" && schedulable(item)) {
        let settings = this.schedulerSettings()
        let r = predictedRecall(item, review.at, settings)
        item = applyGrade(item, review.grade, review.at, settings)
        if (r != null) {
          review = {...review, r}
        }
      }

      let items = [item, ...related]
      if (!items.every(validItem) || new Set(items.map(i => i.id)).size != items.length) {
        throw new Error("Not a valid item")
      }

      if (!validReview(review) || review.itemId != item.id || review.pieceId != item.pieceId) {
        throw new Error("Not a valid review")
      }

      if (session !== undefined && !validSession(session)) {
        throw new Error("Not a valid session")
      }

      await this.backend.write([
        {store: "reviews", put: review},
        ...items.map(record => ({store: "items", put: record})),
        ...(session ? [{store: "sessions", put: session}] : []),
      ])

      this.cacheItems(items)
      if (session) {
        this.cacheSession(session)
      }

      return item
    })
  }

  /**
   * Adds or replaces the study of a stored piece.
   * @param {StudyRecord} study
   * @returns {Promise<StudyRecord>}
   */
  putStudy(study) {
    return this.mutate(async () => {
      if (!validStudy(study) || !this.piece(study.pieceId)) {
        throw new Error("Not a valid study")
      }

      await this.backend.write([{store: "studies", put: study}])

      this.cache = {
        ...this.cache,
        studies: [...this.cache.studies.filter(s => s.pieceId != study.pieceId), study],
      }

      return study
    })
  }

  /**
   * Adds one practice stint on a measure range to the totals of its item
   * (created tracked when there is none), with no review: what the section
   * stats recorded before items.
   * @param {Object} practice
   * @param {string} practice.pieceId
   * @param {string} [practice.hand] the item's hand setting, one of HANDS,
   * "both" by default
   * @param {number} practice.startMeasure
   * @param {number} practice.endMeasure
   * @param {number} practice.hits
   * @param {number} practice.misses
   * @param {number} [practice.at] when it was practiced, defaults to now
   * @param {number} [practice.elapsedMs] time spent playing it, added to the
   * item's elapsedMs
   * @returns {Promise<SectionStatsRecord>} the section stats of the range
   */
  recordSectionPractice(practice) {
    return this.mutate(async () => {
      let item = this.practicedItem(practice)
      await this.backend.write([{store: "items", put: item}])
      this.cacheItems([item])
      return this.sectionStats(item.pieceId).find(stats =>
        stats.startMeasure == item.startMeasure && stats.endMeasure == item.endMeasure)
    })
  }

  // the item of the practiced range with the practice added
  practicedItem({pieceId, hand="both", startMeasure, endMeasure, hits, misses, at=Date.now(), elapsedMs}) {
    let range = {pieceId, hand, startMeasure, endMeasure}
    let current = this.item(itemId(range)) || newItem(range, at)
    let item = itemWithPractice(current, {hits, misses, at, elapsedMs})

    if (!validItem(item)) {
      throw new Error("Not a valid section practice")
    }

    return item
  }

  // replaces the cached items of the ids of items, adding the new ones last
  cacheItems(items) {
    let byId = new Map(items.map(item => [item.id, item]))
    let known = new Set(this.cache.items.map(item => item.id))
    this.cache = {
      ...this.cache,
      items: [
        ...this.cache.items.map(item => byId.get(item.id) || item),
        ...items.filter(item => !known.has(item.id)),
      ],
    }
  }

  cacheSession(session) {
    this.cache = {
      ...this.cache,
      sessions: [...this.cache.sessions.filter(s => s.id != session.id), session].sort(byStart),
    }
  }

  /**
   * Adds or replaces (by id) a session, so a session in progress can be
   * written again as it grows. The section practice given with it is added
   * in the same transaction, so both are stored when the page is left.
   * @param {SessionRecord} session
   * @param {Object} [opts]
   * @param {Object|Object[]} [opts.sectionPractice] as for
   * recordSectionPractice, or a list of them on different ranges
   * @returns {Promise<SessionRecord>}
   */
  putSession(session, {sectionPractice}={}) {
    return this.mutate(async () => {
      if (!validSession(session)) {
        throw new Error("Not a valid session")
      }

      let practice = sectionPractice ? [sectionPractice].flat() : []
      let items = practice.map(stint => this.practicedItem(stint))
      await this.backend.write([
        {store: "sessions", put: session},
        ...items.map(item => ({store: "items", put: item})),
      ])

      this.cacheSession(session)
      if (items.length) {
        this.cacheItems(items)
      }

      return session
    })
  }

  /**
   * The pieces with their sources, items, reviews, studies and every session,
   * for a library file.
   * @returns {Promise<LibraryExport>}
   */
  exportLibrary() {
    return this.mutate(async () => {
      let pieceIds = new Set(this.cache.pieces.map(piece => piece.id))
      let [sources, reviews, sessions] = await Promise.all([
        this.backend.getAll("pieceSources"),
        this.backend.getAll("reviews"),
        this.backend.getAll("sessions"),
      ])

      return {
        format: LIBRARY_FORMAT,
        version: LIBRARY_VERSION,
        exportedAt: new Date().toISOString(),
        pieces: this.cache.pieces,
        sources: sources.filter(source => pieceIds.has(source.pieceId)).map(sourceToJSON),
        items: this.cache.items,
        reviews,
        studies: this.cache.studies,
        settings: [this.cache.settings.scheduler, this.cache.settings.practice],
        sessions: sessions.sort(byStart),
      }
    })
  }

  /**
   * Merges an exported library into this one in a single write. Sources,
   * items, reviews and studies follow their piece (also when it matched a
   * stored piece of another id). A source is added only to a piece without
   * one that holds the same song, so importing a library fills in the sources
   * of pieces stored before them but never gives a piece the source of
   * another song. An item replaces the stored item of its id only when
   * practiced more recently; the section stats of a library before
   * LIBRARY_VERSION 5 are read as tracked items with a legacy review, and
   * replace only the totals of a stored item. Reviews are a union by key, and
   * a study is added to a piece without one. Sessions are added unless one of
   * the same id is stored.
   * @param {LibraryExport} data
   * @param {Object} [opts]
   * @param {number} [opts.maxPieces] the most pieces the library holds
   * @returns {Promise<LibraryImportReport>} rejects with a LibraryFormatError on data that isn't a library
   */
  importLibrary(data, {maxPieces=Infinity}={}) {
    return this.mutate(async () => {
      if (!data || data.format != LIBRARY_FORMAT || !Array.isArray(data.pieces)) {
        throw new LibraryFormatError("The file isn't an exported sight reading library.")
      }

      if (!(data.version <= LIBRARY_VERSION)) {
        throw new LibraryFormatError("The library was exported by a newer version of the app.")
      }

      let report = {
        addedPieces: 0, existingPieces: 0, invalidPieces: 0, fullPieces: 0, addedSources: 0,
        addedSections: 0, updatedSections: 0, addedReviews: 0, addedStudies: 0,
        importedSettings: 0, addedSessions: 0, existingSessions: 0,
      }

      let importedPieces = data.version < 2 ?
        data.pieces.map(piece => validPiece(piece) ? renumberPieceOctaves(piece) : piece) :
        data.pieces

      let pieces = [...this.cache.pieces]
      let byId = new Map(pieces.map(piece => [piece.id, piece]))
      let byContent = new Map(pieces.map(piece => [pieceContent(piece), piece]))
      let pieceIds = new Map() // imported id -> id in this library
      let sameSongIds = new Set() // imported ids whose piece here holds the same song
      let ops = []
      let now = Date.now()

      for (let piece of importedPieces) {
        if (!validPiece(piece)) {
          report.invalidPieces += 1
          continue
        }

        let existing = byId.get(piece.id) || byContent.get(pieceContent(piece))
        if (existing) {
          pieceIds.set(piece.id, existing.id)
          if (JSON.stringify(existing.song) == JSON.stringify(piece.song)) {
            sameSongIds.add(piece.id)
          }
          report.existingPieces += 1
          continue
        }

        if (pieces.length >= maxPieces) {
          report.fullPieces += 1
          continue
        }

        // pieces without an import time keep the file's order
        let record = pieceRecord(piece, now + report.addedPieces)
        pieces.push(record)
        byId.set(record.id, record)
        byContent.set(pieceContent(record), record)
        pieceIds.set(record.id, record.id)
        sameSongIds.add(record.id)
        ops.push({store: "pieces", put: record})
        report.addedPieces += 1
      }

      let sourceIds = new Set(await this.backend.getAllKeys("pieceSources"))

      for (let source of Array.isArray(data.sources) ? data.sources : []) {
        let pieceId = source && sameSongIds.has(source.pieceId) && pieceIds.get(source.pieceId)
        if (!pieceId || sourceIds.has(pieceId)) {
          continue
        }

        let record = sourceFromJSON(source, pieceId, now)
        if (!record) {
          continue
        }

        sourceIds.add(pieceId)
        ops.push({store: "pieceSources", put: record})
        report.addedSources += 1
      }

      let items = [...this.cache.items]
      let itemIndex = new Map(items.map((item, idx) => [item.id, idx]))
      let changedItems = new Set()
      let reviewKeys = new Set((await this.backend.getAllKeys("reviews")).map(memoryKey))
      let fileReviews = []

      // an imported item: added, or replacing the stored one when practiced
      // more recently. totalsOnly keeps the rest of the stored item. Returns
      // whether the item was taken
      let mergeItem = (record, {totalsOnly=false}={}) => {
        let idx = itemIndex.get(record.id)
        if (idx === undefined) {
          itemIndex.set(record.id, items.length)
          items.push(record)
          report.addedSections += 1
        } else if (record.lastPracticed > items[idx].lastPracticed) {
          if (totalsOnly) {
            let {hits, misses, attempts, lastPracticed, elapsedMs} = record
            let current = {...items[idx], hits, misses, attempts, lastPracticed}
            // an untimed row replaces the time too, as it replaced a timed row
            delete current.elapsedMs
            items[idx] = elapsedMs === undefined ? current : {...current, elapsedMs}
          } else {
            items[idx] = record
          }
          report.updatedSections += 1
        } else {
          return false
        }
        changedItems.add(record.id)
        return true
      }

      if (data.version < 5) {
        for (let stats of Array.isArray(data.sectionStats) ? data.sectionStats : []) {
          if (!validSectionStats(stats) || !pieceIds.has(stats.pieceId)) {
            continue
          }

          let row = {...stats, pieceId: pieceIds.get(stats.pieceId)}
          let item = itemFromSectionStats(row, now)
          // the legacy review is a snapshot of the totals it brings, so a row
          // the stored item has outgrown adds none: it would count its
          // practice twice
          if (validItem(item) && mergeItem(item, {totalsOnly: true})) {
            fileReviews.push(legacyReview(row))
          }
        }
      } else {
        for (let item of Array.isArray(data.items) ? data.items : []) {
          if (validItem(item) && pieceIds.has(item.pieceId)) {
            mergeItem(itemForPiece(item, pieceIds.get(item.pieceId)))
          }
        }

        for (let review of Array.isArray(data.reviews) ? data.reviews : []) {
          if (validReview(review) && pieceIds.has(review.pieceId)) {
            fileReviews.push(reviewForPiece(review, pieceIds.get(review.pieceId)))
          }
        }
      }

      for (let review of fileReviews) {
        let key = memoryKey(recordKey("reviews", review))
        if (!reviewKeys.has(key)) {
          reviewKeys.add(key)
          ops.push({store: "reviews", put: review})
          report.addedReviews += 1
        }
      }

      for (let id of changedItems) {
        ops.push({store: "items", put: items[itemIndex.get(id)]})
      }

      let studies = [...this.cache.studies]
      for (let study of data.version >= 5 && Array.isArray(data.studies) ? data.studies : []) {
        let pieceId = validStudy(study) && pieceIds.get(study.pieceId)
        if (pieceId && !studies.some(s => s.pieceId == pieceId)) {
          let record = {...study, pieceId}
          studies.push(record)
          ops.push({store: "studies", put: record})
          report.addedStudies += 1
        }
      }

      let settings = {...this.cache.settings}
      for (let record of data.version >= 5 && Array.isArray(data.settings) ? data.settings : []) {
        let name = settingsName(record)
        if (name) {
          settings[name] = record
          ops.push({store: "meta", put: record})
          report.importedSettings += 1
        }
      }

      let sessionIds = new Set((await this.backend.getAll("sessions")).map(session => session.id))
      let recentSessions = [...this.cache.sessions]
      let recentSince = now - RECENT_SESSION_DAYS * DAY

      for (let session of Array.isArray(data.sessions) ? data.sessions : []) {
        if (!validSession(session)) {
          continue
        }

        if (sessionIds.has(session.id)) {
          report.existingSessions += 1
          continue
        }

        sessionIds.add(session.id)
        ops.push({store: "sessions", put: session})
        report.addedSessions += 1

        if (session.startedAt >= recentSince) {
          recentSessions.push(session)
        }
      }

      await this.backend.write(ops)

      this.cache = {
        pieces: pieces.sort(byImportOrder),
        items,
        studies,
        sessions: recentSessions.sort(byStart),
        settings,
      }

      return report
    })
  }

  /**
   * Empties every store and the cache, for specs.
   * @returns {Promise<void>}
   */
  clear() {
    return this.mutate(async () => {
      await this.backend.clear()
      this.cache = emptyCache()
    })
  }

  /** Closes the database connection, after pending mutations */
  close() {
    return this.queue.then(() => {
      if (this.backend) {
        this.backend.close()
      }
    })
  }
}

const emptyCache = () => ({
  pieces: [], items: [], studies: [], sessions: [],
  settings: {scheduler: DEFAULT_SCHEDULER_SETTINGS, practice: DEFAULT_PRACTICE_SETTINGS},
})

// the cache's name of a valid settings record, null for anything else
function settingsName(record) {
  return validSchedulerSettings(record) ? "scheduler" :
    validPracticeSettings(record) ? "practice" : null
}

let appStore = new LocalStore()

/** @returns {LocalStore} the store the app reads and writes */
export function getAppStore() {
  return appStore
}

/**
 * Replaces the app's store, for specs. Returns the previous one.
 * @param {LocalStore} store
 * @returns {LocalStore}
 */
export function setAppStore(store) {
  let previous = appStore
  appStore = store
  return previous
}

/**
 * Readies the app's store, called once before the app renders.
 * @returns {Promise<void>}
 */
export function initStorage() {
  return appStore.init()
}
