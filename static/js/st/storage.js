// The local store: practice data kept in the browser with IndexedDB (through
// the "idb" package), with no server behind it.
//
// One database holds the stores in STORES: the imported sheet music pieces
// (the deck, see st/sheet_music_deck), practice stats per piece section, and
// practice sessions. init() loads them into an in-memory cache so the UI reads
// synchronously (eg. a generator's settings inputs on every render); every
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

export const DB_NAME = "sightreading"

// bump with a new step in upgradeSchema when the stores change
// 2: note names of stored pieces moved to middle C "C4", see
// renumberPieceOctaves
export const DB_VERSION = 2

// the localStorage deck used before the local store, migrated into the pieces
// store once, see migrateLegacyDeck. The key itself is left in place
export const LEGACY_DECK_KEY = "st:sheet_music_pieces:v1"

// meta store record written with the migrated pieces, its presence means the
// legacy deck has been migrated (or there was none) and is never read again
export const DECK_MIGRATION_MARKER = "legacyDeckMigrated"

export const LIBRARY_FORMAT = "sightreading-library"
// 2: note names use middle C "C4", version 1 pieces are renumbered on import
export const LIBRARY_VERSION = 2

// sessions started within this many days are loaded into the cache
export const RECENT_SESSION_DAYS = 30

const DAY = 24 * 60 * 60 * 1000

// how long init waits for the database to open before falling back to memory,
// eg. when another tab blocks a schema upgrade
const OPEN_TIMEOUT = 5000

const STORES = {
  pieces: {keyPath: "id"},
  sectionStats: {
    keyPath: ["pieceId", "startMeasure", "endMeasure"],
    indexes: {pieceId: "pieceId"},
  },
  sessions: {keyPath: "id", indexes: {startedAt: "startedAt"}},
  meta: {keyPath: "key"},
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
 * Practice on one measure range of a piece, keyed by pieceId, startMeasure
 * and endMeasure (the score's printed bar numbers).
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
 * @property {SectionStatsRecord[]} sectionStats
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
 * @property {number} addedSections
 * @property {number} updatedSections section stats replaced by more recent ones
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

async function upgradeSchema(db, oldVersion, newVersion, transaction) {
  if (oldVersion < 1) {
    for (let [name, {keyPath, indexes}] of Object.entries(STORES)) {
      let store = db.createObjectStore(name, {keyPath})
      for (let [indexName, indexPath] of Object.entries(indexes || {})) {
        store.createIndex(indexName, indexPath)
      }
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

  getAllFrom(store, index, lower) {
    return this.db.getAllFromIndex(store, index, IDBKeyRange.lowerBound(lower))
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
// are copied in and out like IndexedDB does
class MemoryBackend {
  persistent = false

  constructor() {
    this.stores = {}
    for (let name of Object.keys(STORES)) {
      this.stores[name] = new Map()
    }
  }

  keyOf(store, record) {
    let {keyPath} = STORES[store]
    return memoryKey(Array.isArray(keyPath) ? keyPath.map(path => record[path]) : record[keyPath])
  }

  async get(store, key) {
    let record = this.stores[store].get(memoryKey(key))
    return record === undefined ? undefined : structuredClone(record)
  }

  async getAll(store) {
    return [...this.stores[store].values()].map(record => structuredClone(record))
  }

  async getAllFrom(store, index, lower) {
    let path = STORES[store].indexes[index]
    return (await this.getAll(store)).filter(record => record[path] >= lower)
  }

  async write(ops) {
    // copy first so a record that can't be cloned fails the whole write
    let copies = ops.map(op => "delete" in op ? op : {...op, put: structuredClone(op.put)})
    for (let op of copies) {
      if ("delete" in op) {
        this.stores[op.store].delete(memoryKey(op.delete))
      } else {
        this.stores[op.store].set(this.keyOf(op.store, op.put), op.put)
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

const sameSection = (a, b) =>
  a.pieceId == b.pieceId && a.startMeasure == b.startMeasure && a.endMeasure == b.endMeasure

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

    this.cache = {pieces: [], sectionStats: [], sessions: []}
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

  async loadCache() {
    let [pieces, sectionStats, sessions] = await Promise.all([
      this.backend.getAll("pieces"),
      this.backend.getAll("sectionStats"),
      this.backend.getAllFrom("sessions", "startedAt", Date.now() - RECENT_SESSION_DAYS * DAY),
    ])

    this.cache = {
      pieces: pieces.sort(byImportOrder),
      sectionStats,
      sessions: sessions.sort(byStart),
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
   * @param {string} [pieceId] only the sections of this piece
   * @returns {SectionStatsRecord[]}
   */
  sectionStats(pieceId) {
    let all = this.cache.sectionStats
    return pieceId == null ? all : all.filter(stats => stats.pieceId == pieceId)
  }

  /** @returns {SessionRecord[]} sessions of the last RECENT_SESSION_DAYS, oldest first */
  recentSessions() {
    return this.cache.sessions
  }

  /**
   * Adds or replaces a piece.
   * @param {PieceRecord} piece
   * @returns {Promise<PieceRecord>} the stored record
   */
  putPiece(piece) {
    return this.mutate(async () => {
      if (!validPiece(piece)) {
        throw new Error("Not a valid piece")
      }

      let record = pieceRecord(piece, Date.now())
      await this.backend.write([{store: "pieces", put: record}])

      this.cache = {
        ...this.cache,
        pieces: [...this.cache.pieces.filter(p => p.id != record.id), record].sort(byImportOrder),
      }

      return record
    })
  }

  /**
   * Removes a piece along with its section stats.
   * @param {string} id
   * @returns {Promise<boolean>} whether there was such a piece
   */
  deletePiece(id) {
    return this.mutate(async () => {
      if (!this.piece(id)) {
        return false
      }

      let sections = this.sectionStats(id)
      await this.backend.write([
        {store: "pieces", delete: id},
        ...sections.map(s => ({store: "sectionStats", delete: [s.pieceId, s.startMeasure, s.endMeasure]})),
      ])

      this.cache = {
        ...this.cache,
        pieces: this.cache.pieces.filter(piece => piece.id != id),
        sectionStats: this.cache.sectionStats.filter(stats => stats.pieceId != id),
      }

      return true
    })
  }

  /**
   * Adds one practice stint on a section to its stats.
   * @param {Object} practice
   * @param {string} practice.pieceId
   * @param {number} practice.startMeasure
   * @param {number} practice.endMeasure
   * @param {number} practice.hits
   * @param {number} practice.misses
   * @param {number} [practice.at] when it was practiced, defaults to now
   * @param {number} [practice.elapsedMs] time spent playing it, added to the
   * section's elapsedMs
   * @returns {Promise<SectionStatsRecord>}
   */
  recordSectionPractice(practice) {
    return this.mutate(async () => {
      let record = this.sectionPracticeRecord(practice)
      await this.backend.write([{store: "sectionStats", put: record}])
      this.cacheSectionStats(record)
      return record
    })
  }

  // the stats of the practiced section with the practice added
  sectionPracticeRecord({pieceId, startMeasure, endMeasure, hits, misses, at=Date.now(), elapsedMs}) {
    let section = {pieceId, startMeasure, endMeasure}
    let current = this.cache.sectionStats.find(stats => sameSection(stats, section)) ||
      {...section, hits: 0, misses: 0, attempts: 0, lastPracticed: 0}

    let record = {
      ...current,
      hits: current.hits + hits,
      misses: current.misses + misses,
      attempts: current.attempts + (hits || misses ? 1 : 0),
      lastPracticed: Math.max(current.lastPracticed, at),
    }

    // only sections timed once carry the field
    if (elapsedMs !== undefined || current.elapsedMs !== undefined) {
      record.elapsedMs = (current.elapsedMs || 0) + Math.round(elapsedMs || 0)
    }

    if (!validSectionStats(record)) {
      throw new Error("Not a valid section practice")
    }

    return record
  }

  cacheSectionStats(record) {
    this.cache = {
      ...this.cache,
      sectionStats: [...this.cache.sectionStats.filter(stats => !sameSection(stats, record)), record],
    }
  }

  /**
   * Adds or replaces (by id) a session, so a session in progress can be
   * written again as it grows. The section practice given with it is added
   * in the same transaction, so both are stored when the page is left.
   * @param {SessionRecord} session
   * @param {Object} [opts]
   * @param {Object} [opts.sectionPractice] as for recordSectionPractice
   * @returns {Promise<SessionRecord>}
   */
  putSession(session, {sectionPractice}={}) {
    return this.mutate(async () => {
      if (!validSession(session)) {
        throw new Error("Not a valid session")
      }

      let stats = sectionPractice && this.sectionPracticeRecord(sectionPractice)
      await this.backend.write([
        {store: "sessions", put: session},
        ...(stats ? [{store: "sectionStats", put: stats}] : []),
      ])

      this.cache = {
        ...this.cache,
        sessions: [...this.cache.sessions.filter(s => s.id != session.id), session].sort(byStart),
      }

      if (stats) {
        this.cacheSectionStats(stats)
      }

      return session
    })
  }

  /**
   * The pieces, section stats and every session, for a library file.
   * @returns {Promise<LibraryExport>}
   */
  exportLibrary() {
    return this.mutate(async () => ({
      format: LIBRARY_FORMAT,
      version: LIBRARY_VERSION,
      exportedAt: new Date().toISOString(),
      pieces: this.cache.pieces,
      sectionStats: this.cache.sectionStats,
      sessions: (await this.backend.getAll("sessions")).sort(byStart),
    }))
  }

  /**
   * Merges an exported library into this one in a single write. Section stats
   * follow their piece (also when it matched a stored piece of another id)
   * and replace stored stats only when practiced more recently. Sessions are
   * added unless one of the same id is stored.
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
        addedPieces: 0, existingPieces: 0, invalidPieces: 0, fullPieces: 0,
        addedSections: 0, updatedSections: 0, addedSessions: 0, existingSessions: 0,
      }

      let importedPieces = data.version < 2 ?
        data.pieces.map(piece => validPiece(piece) ? renumberPieceOctaves(piece) : piece) :
        data.pieces

      let pieces = [...this.cache.pieces]
      let byId = new Map(pieces.map(piece => [piece.id, piece]))
      let byContent = new Map(pieces.map(piece => [pieceContent(piece), piece]))
      let pieceIds = new Map() // imported id -> id in this library
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
        ops.push({store: "pieces", put: record})
        report.addedPieces += 1
      }

      let sectionStats = [...this.cache.sectionStats]

      for (let stats of Array.isArray(data.sectionStats) ? data.sectionStats : []) {
        if (!validSectionStats(stats) || !pieceIds.has(stats.pieceId)) {
          continue
        }

        let record = {
          pieceId: pieceIds.get(stats.pieceId),
          startMeasure: stats.startMeasure,
          endMeasure: stats.endMeasure,
          hits: stats.hits,
          misses: stats.misses,
          attempts: stats.attempts,
          lastPracticed: stats.lastPracticed,
        }

        if (stats.elapsedMs !== undefined) {
          record.elapsedMs = stats.elapsedMs
        }

        let idx = sectionStats.findIndex(s => sameSection(s, record))
        if (idx == -1) {
          sectionStats.push(record)
          report.addedSections += 1
        } else if (record.lastPracticed > sectionStats[idx].lastPracticed) {
          sectionStats[idx] = record
          report.updatedSections += 1
        } else {
          continue
        }

        ops.push({store: "sectionStats", put: record})
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
        sectionStats,
        sessions: recentSessions.sort(byStart),
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
      this.cache = {pieces: [], sectionStats: [], sessions: []}
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
