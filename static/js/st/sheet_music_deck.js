// The sheet music deck: MusicXML pieces imported into the sheet music
// generator, kept in browser storage so a piece is picked from the deck
// instead of imported again.
//
// Pieces are stored as a compact JSON form of the parsed song model (never
// the MusicXML text), all under one versioned storage key. The deck is
// bounded by MAX_PIECES, and a failed write (usually the storage quota)
// leaves the stored deck untouched and returns a message for the UI.

import {MultiTrackSong, SongNote} from "st/song_note_list"
import {
  parseMusicXML, MusicXMLError, isCompressedMusicXML, COMPRESSED_MESSAGE
} from "st/musicxml"

export const DECK_STORAGE_KEY = "st:sheet_music_pieces:v1"

export const MAX_PIECES = 20

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

function defaultStorage() {
  try {
    return window.localStorage
  } catch (e) {
    return null // storage blocked
  }
}

function validPiece(piece) {
  return piece && typeof piece == "object" &&
    typeof piece.id == "string" && typeof piece.title == "string" &&
    piece.song && typeof piece.song == "object"
}

// the last parsed deck, reused while the stored text is unchanged since the
// settings panel reads the deck on every render
let cached = {storage: null, raw: null, deck: null}

// {pieces: [{id, title, song}]}, empty when nothing valid is stored
export function loadDeck(storage=defaultStorage()) {
  let raw = null
  try {
    raw = storage ? storage.getItem(DECK_STORAGE_KEY) : null
  } catch (e) {
    raw = null
  }

  if (cached.deck && cached.storage === storage && cached.raw === raw) {
    return cached.deck
  }

  let pieces = []
  try {
    let stored = JSON.parse(raw)
    if (stored && Array.isArray(stored.pieces)) {
      pieces = stored.pieces.filter(validPiece)
    }
  } catch (e) {
    pieces = []
  }

  let deck = {pieces}
  cached = {storage, raw, deck}
  return deck
}

function isQuotaError(e) {
  return e && (e.name == "QuotaExceededError" ||
    e.name == "NS_ERROR_DOM_QUOTA_REACHED" || e.code == 22 || e.code == 1014)
}

// writes the deck, returns {error} with a message for the UI on failure
export function saveDeck(deck, storage=defaultStorage()) {
  if (!storage) {
    return {error: "Browser storage is unavailable, so the deck can't be saved."}
  }

  try {
    storage.setItem(DECK_STORAGE_KEY, JSON.stringify({pieces: deck.pieces}))
  } catch (e) {
    if (isQuotaError(e)) {
      return {error: "Browser storage is full. Remove a piece from the deck and try again."}
    }
    return {error: `Couldn't save the deck to browser storage: ${e.message || e}`}
  }

  return {}
}

export function findPiece(id, storage=defaultStorage()) {
  if (!id) { return null }
  return loadDeck(storage).pieces.find(piece => piece.id == id) || null
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

// Adds a song to the deck. Returns {piece} or {error}. Adding the same
// title and notes again returns the stored piece instead of a duplicate.
export function addPiece(title, song, storage=defaultStorage()) {
  let deck = loadDeck(storage)
  let songData = songToJSON(song)
  let songText = JSON.stringify(songData)

  let existing = deck.pieces.find(piece =>
    piece.title == title && JSON.stringify(piece.song) == songText)

  if (existing) {
    return {piece: existing}
  }

  if (deck.pieces.length >= MAX_PIECES) {
    return {error: `The deck is full (${MAX_PIECES} pieces). Remove a piece before importing another.`}
  }

  let piece = {id: newPieceId(), title, song: songData}
  let result = saveDeck({pieces: [...deck.pieces, piece]}, storage)

  if (result.error) {
    return {error: `"${title}" wasn't added to the deck. ${result.error}`}
  }

  return {piece}
}

// Returns {} or {error}
export function removePiece(id, storage=defaultStorage()) {
  let deck = loadDeck(storage)
  let pieces = deck.pieces.filter(piece => piece.id != id)

  if (pieces.length == deck.pieces.length) {
    return {}
  }

  return saveDeck({pieces}, storage)
}

// Imports an uncompressed MusicXML file into the deck. Returns {piece} or
// {error} with a message for the UI.
export function importMusicXMLPiece(fileName, text, storage=defaultStorage()) {
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

  return addPiece(title, song, storage)
}
