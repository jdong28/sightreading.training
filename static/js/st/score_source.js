// The source score of an imported piece: the MusicXML text it was imported
// from, kept beside the piece (see pieceSource in st/storage) so the score can
// be read again as written rather than through the song model the deck
// stores. It is stored gzipped (a score's XML shrinks around twentyfold), and
// written into a library file as base64 of those bytes.

import {gzipSync, gunzipSync} from "fflate"

export const SOURCE_ENCODING = "gzip"

/**
 * @param {string} text MusicXML text
 * @returns {Uint8Array} gzipped UTF-8
 */
export function compressSource(text) {
  return gzipSync(new TextEncoder().encode(text))
}

/**
 * @param {Uint8Array} bytes from compressSource
 * @returns {string}
 * @throws on bytes that aren't gzip
 */
export function decompressSource(bytes) {
  return new TextDecoder().decode(gunzipSync(bytes))
}

/**
 * @param {*} bytes
 * @returns {boolean} whether bytes start like gzip data
 */
export function isCompressedSource(bytes) {
  return bytes instanceof Uint8Array && bytes.length > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

// btoa takes a string of byte values, built in chunks since spreading a whole
// score's bytes into one call overflows the stack
const CHUNK = 0x8000

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64
 */
export function bytesToBase64(bytes) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * @param {string} text base64
 * @returns {Uint8Array}
 * @throws on text that isn't base64
 */
export function base64ToBytes(text) {
  let binary = atob(text)
  let bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
