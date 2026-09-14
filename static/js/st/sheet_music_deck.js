// The sheet music deck: MusicXML pieces imported into the sheet music
// generator, kept in the browser's library (the pieces store of st/storage)
// so a piece is picked from the deck instead of imported again.
//
// Pieces are stored as a compact JSON form of the parsed song model (never
// the MusicXML text). Reads are synchronous over the store's cache; adding and
// removing pieces is async, and a failed write (usually the storage quota)
// leaves the deck untouched and resolves to a message for the UI.

import {MultiTrackSong, SongNote} from "st/song_note_list"
import {
  parseMusicXML, MusicXMLError, isCompressedMusicXML, COMPRESSED_MESSAGE
} from "st/musicxml"
import {getAppStore, LEGACY_DECK_KEY, LibraryFormatError} from "st/storage"

// where the deck was kept before the local store, see migrateLegacyDeck in
// st/storage
export const DECK_STORAGE_KEY = LEGACY_DECK_KEY

export const MAX_PIECES = 300

const SONG_FORMAT = 1

// metadata copied into a stored piece, see parseMusicXML
const METADATA_FIELDS = [
  "title", "keySignature", "beatsPerMeasure", "measureStarts",
  "measureNumbers", "measuresEnd",
]

// beats are rounded so float noise from uneven divisions doesn't bloat the
// stored JSON; far below the onset quantization of a section
const round = n => Math.round(n * 1e6) / 1e6

// Song model -> plain JSON object. Each track keeps its name, clefs and its
// notes as a flat [name, start, duration, name, start, duration, ...] list.
export function songToJSON(song) {
  let metadata = {}
  for (let field of METADATA_FIELDS) {
    if (song.metadata && song.metadata[field] != null) {
      metadata[field] = song.metadata[field]
    }
  }

  let tracks = (song.tracks || []).map(track => {
    let out = {notes: []}

    if (track.trackName) {
      out.name = track.trackName
    }

    if (Array.isArray(track.cleffs) && track.cleffs.length) {
      out.cleffs = track.cleffs.map(([beat, sign]) => [round(beat), sign])
    }

    for (let note of track) {
      out.notes.push(note.note, round(note.start), round(note.duration))
    }

    return out
  })

  return {format: SONG_FORMAT, metadata, tracks}
}

// plain JSON object -> MultiTrackSong. Throws on data of the wrong shape.
export function songFromJSON(data) {
  if (!data || data.format != SONG_FORMAT || !Array.isArray(data.tracks)) {
    throw new Error("Unknown stored song format")
  }

  let song = new MultiTrackSong()
  song.metadata = {...data.metadata}

  data.tracks.forEach((trackData, trackIdx) => {
    let notes = trackData && trackData.notes
    if (!Array.isArray(notes) || notes.length % 3 != 0) {
      throw new Error("Malformed stored track")
    }

    let track = song.getTrack(trackIdx)

    if (trackData.name) {
      track.trackName = trackData.name
    }

    if (Array.isArray(trackData.cleffs)) {
      track.cleffs = trackData.cleffs
    }

    for (let i = 0; i < notes.length; i += 3) {
      let [name, start, duration] = notes.slice(i, i + 3)
      if (typeof name != "string" || typeof start != "number" || typeof duration != "number") {
        throw new Error("Malformed stored note")
      }
      song.pushWithTrack(new SongNote(name, start, duration), trackIdx)
    }
  })

  return song
}

let decks = new WeakMap()

// {pieces: [{id, title, song, importedAt}]} in import order, the same object
// while the pieces are unchanged since the settings panel reads the deck on
// every render
export function loadDeck(store=getAppStore()) {
  let pieces = store.pieces()
  if (!decks.has(pieces)) {
    decks.set(pieces, {pieces})
  }
  return decks.get(pieces)
}

function isQuotaError(e) {
  return e && (e.name == "QuotaExceededError" ||
    e.name == "NS_ERROR_DOM_QUOTA_REACHED" || e.code == 22 || e.code == 1014)
}

// a message for the UI about a failed write to the store
export function storageErrorMessage(e) {
  if (isQuotaError(e)) {
    return "Browser storage is full. Remove a piece from the deck and try again."
  }
  return `Couldn't save to browser storage: ${(e && e.message) || e}`
}

const NOT_PERSISTENT_WARNING = "Browser storage is unavailable, so the deck is kept only until the page closes."

export function findPiece(id, store=getAppStore()) {
  if (!id) { return null }
  return store.piece(id)
}

let songCache = new WeakMap()

// the song model of a stored piece, or null when it can't be read
export function pieceSong(piece) {
  if (!piece) { return null }

  if (!songCache.has(piece)) {
    let song = null
    try {
      song = songFromJSON(piece.song)
    } catch (e) {
      song = null
    }
    songCache.set(piece, song)
  }

  return songCache.get(piece)
}

function newPieceId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// Adds a song to the deck. Resolves to {piece} or {error}, with a warning
// when the deck won't outlive the page. Adding the same title and notes
// again resolves to the stored piece instead of a duplicate.
export async function addPiece(title, song, store=getAppStore(), {fileName}={}) {
  await store.init()

  let deck = loadDeck(store)
  let songData = songToJSON(song)
  let songText = JSON.stringify(songData)
  let warning = store.persistent ? {} : {warning: NOT_PERSISTENT_WARNING}

  let existing = deck.pieces.find(piece =>
    piece.title == title && JSON.stringify(piece.song) == songText)

  if (existing) {
    return {piece: existing, ...warning}
  }

  if (deck.pieces.length >= MAX_PIECES) {
    return {error: `The deck is full (${MAX_PIECES} pieces). Remove a piece before importing another.`}
  }

  // strictly after the last piece, so pieces imported within a millisecond
  // keep their order
  let last = deck.pieces[deck.pieces.length - 1]
  let importedAt = Math.max(Date.now(), last ? last.importedAt + 1 : 0)
  let record = {id: newPieceId(), title, song: songData, importedAt}
  if (fileName) {
    record.fileName = fileName
  }

  try {
    return {piece: await store.putPiece(record), ...warning}
  } catch (e) {
    return {error: `"${title}" wasn't added to the deck. ${storageErrorMessage(e)}`}
  }
}

// Resolves to {} or {error}
export async function removePiece(id, store=getAppStore()) {
  try {
    await store.deletePiece(id)
  } catch (e) {
    return {error: `Couldn't remove the piece. ${storageErrorMessage(e)}`}
  }
  return {}
}

// Imports an uncompressed MusicXML file into the deck. Resolves to {piece}
// or {error} with a message for the UI.
export async function importMusicXMLPiece(fileName, text, store=getAppStore()) {
  if (/\.mxl$/i.test(fileName || "") || isCompressedMusicXML(text)) {
    return {error: COMPRESSED_MESSAGE}
  }

  let song
  try {
    song = parseMusicXML(text)
  } catch (e) {
    if (e instanceof MusicXMLError) {
      return {error: e.message}
    }
    return {error: `Couldn't import the file: ${e.message || e}`}
  }

  if (!song.length) {
    return {error: "The score has no notes to drill."}
  }

  // exported file names often use underscores for spaces
  let title = (song.metadata && song.metadata.title) ||
    (fileName || "").replace(/\.(musicxml|xml)$/i, "").replace(/_+/g, " ").trim() ||
    "Untitled piece"

  return addPiece(title, song, store, {fileName})
}

// The library file for the store's pieces and section stats. Resolves to
// {fileName, text} or {error}
export async function exportLibraryFile(store=getAppStore()) {
  try {
    let data = await store.exportLibrary()
    let date = data.exportedAt.slice(0, 10)
    return {
      fileName: `sightreading-library-${date}.json`,
      text: JSON.stringify(data),
      pieces: data.pieces.length,
    }
  } catch (e) {
    return {error: `Couldn't export the library: ${(e && e.message) || e}`}
  }
}

const plural = (n, word) => `${n} ${word}${n == 1 ? "" : "s"}`

// Merges a library file (see exportLibraryFile) into the store. Resolves to
// {message} describing what was added, or {error}
export async function importLibraryFile(text, store=getAppStore()) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return {error: "The file isn't an exported sight reading library."}
  }

  let report
  try {
    report = await store.importLibrary(data, {maxPieces: MAX_PIECES})
  } catch (e) {
    if (e instanceof LibraryFormatError) {
      return {error: e.message}
    }
    return {error: `The library wasn't imported. ${storageErrorMessage(e)}`}
  }

  let sections = report.addedSections + report.updatedSections
  let parts = [
    `Added ${plural(report.addedPieces, "piece")}` +
      (sections ? ` and stats for ${plural(sections, "section")}` : ""),
  ]

  if (report.existingPieces) {
    parts.push(`${plural(report.existingPieces, "piece")} already in the library`)
  }

  if (report.fullPieces) {
    parts.push(`${plural(report.fullPieces, "piece")} left out, the deck is full (${MAX_PIECES} pieces)`)
  }

  if (report.invalidPieces) {
    parts.push(`${plural(report.invalidPieces, "unreadable piece")} skipped`)
  }

  let result = {message: parts.join("; "), report}
  if (!store.persistent) {
    result.warning = NOT_PERSISTENT_WARNING
  }
  return result
}
