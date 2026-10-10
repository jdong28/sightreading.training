// The browser half of the command, bundled by lib/bridge.mjs and run in
// headless Chrome beside the node half: the app's own importer, analysis,
// fingerprint and flags file reader, so what the command sends and writes is
// exactly what the app understands. Exposed as window.claudeFlags.

import {readMusicXMLFile, parseMusicXML} from "st/musicxml"
import {songToJSON, songFromJSON} from "st/sheet_music_deck"
import {analyzePiece} from "st/difficulty/index"
import {fingerprint} from "st/difficulty/fingerprints"
import {FLAG_KINDS} from "st/difficulty/decisions"
import {measureNumberList} from "st/song_sections"

import {compactScore, userMessage, composerOf, analysisText} from "./compact"
import {outputSchema} from "./schema"
import {verifyOutput} from "./verify"
import {claudeFlagsFile, selfCheck} from "./proposals"

const prepared = new Map()
let nextKey = 1

function base64ToBytes(text) {
  let binary = atob(text)
  let bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i) }
  return bytes
}

// the title the importer gives a file (st/sheet_music_deck importMusicXMLPiece)
function titleFor(song, fileName) {
  return (song.metadata && song.metadata.title) ||
    (fileName || "").replace(/\.(musicxml|xml|mxl)$/i, "").replace(/_+/g, " ").trim() ||
    "Untitled piece"
}

/**
 * Reads a piece the way the app stores it and builds what is sent for it.
 * @param {Object} input {kind: "musicxml", fileName, base64} or
 * {kind: "piece", title, fileName, song (stored JSON), source (text or null)}
 * @param {Object} opts {web}
 * @returns {Object} {key, title, composer, fileName, bars, numbers, fingerprint, compact,
 * analysisText, userMessage, analysis}, or {error}
 */
function prepare(input, {web = true} = {}) {
  let song, source, title, fileName

  try {
    if (input.kind == "musicxml") {
      source = readMusicXMLFile(base64ToBytes(input.base64))
      // through the stored form and back, as the deck keeps it, so the
      // fingerprint is the one the app computes for this piece
      song = songFromJSON(songToJSON(parseMusicXML(source)))
      fileName = input.fileName
      title = titleFor(song, fileName)
    } else {
      song = songFromJSON(input.song)
      source = input.source || null
      fileName = input.fileName || ""
      title = input.title
    }
  } catch (e) {
    return {error: `can't read the score: ${(e && e.message) || e}`}
  }

  if (!song.length) { return {error: "the score has no notes"} }

  let analysis = analyzePiece({song, source, at: 0})
  let compact = compactScore({song, source})
  let composer = composerOf(source)
  let message = userMessage({title, composer, fileName, song, compact, analysis, source, web})

  let key = `piece${nextKey++}`
  prepared.set(key, {song, title, fingerprint: fingerprint(song)})

  return {
    key, title, composer, fileName,
    bars: compact.bars,
    numbers: measureNumberList(song),
    fingerprint: prepared.get(key).fingerprint,
    compact: compact.text,
    analysisText: analysisText(analysis, compact.numbers),
    userMessage: message,
  }
}

function verify(key, output) {
  return verifyOutput(prepared.get(key).song, output)
}

function flagsFile(key, {proposals, run, at}) {
  let {song, title, fingerprint: fp} = prepared.get(key)
  let file = claudeFlagsFile({title, song, fingerprint: fp, proposals, run, at})
  return {file, check: selfCheck({file, song, fingerprint: fp})}
}

// for the specs: the fingerprint of a file by the importer's own route, with
// and without the store's round trip through JSON, and the stored song itself
function fingerprintsOf(input) {
  let source = readMusicXMLFile(base64ToBytes(input.base64))
  let song = parseMusicXML(source)
  return {raw: fingerprint(song), stored: fingerprint(songFromJSON(songToJSON(song)))}
}

function storedSong(input) {
  return songToJSON(parseMusicXML(readMusicXMLFile(base64ToBytes(input.base64))))
}

window.claudeFlags = {
  prepare, schema: outputSchema, verify, flagsFile,
  flagKinds: () => [...FLAG_KINDS], fingerprintsOf, storedSong,
}
