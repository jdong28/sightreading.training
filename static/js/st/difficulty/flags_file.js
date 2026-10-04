// The flags file (report §4.3): an instructor's decisions on a piece,
// shareable between installs and across editions numbered differently. It
// carries no proposals (each device makes its own) and re-anchors by bar
// fingerprint (st/difficulty/align) rather than by measure number, so it
// survives a pickup gained or lost, a passage written out instead of
// repeated, or a few corrected notes.

import {measureNumbers} from "st/song_sections"
import {validDecision} from "st/difficulty/decisions"
import {alignBars, mapRange, GOOD_SIMILARITY} from "st/difficulty/align"

export const FLAGS_FORMAT = "sightreading-flags"
export const FLAGS_VERSION = 1

// generous enough for hundreds of bars' sketches (report §4.3 estimates
// 10-20KB for 100 bars); still a hard cap on untrusted input
export const MAX_FLAGS_FILE_BYTES = 1024 * 1024
export const MAX_FLAGS_FILE_DECISIONS = 2000

function numberAt(numbers, index) {
  return numbers && numbers[index] != null ? numbers[index] : index + 1
}

function perIndexNumbers(song, count) {
  let numbers = measureNumbers(song)
  if (numbers && numbers.length == count) { return numbers }
  return Array.from({length: count}, (_, i) => i + 1)
}

/**
 * The flags file for a piece: its whole decision log, no proposals, keyed
 * to re-anchor by fingerprint on the other end.
 * @param {Object} record an AnnotationRecord
 * @param {Object} piece a PieceRecord (st/storage), for its title
 * @param {Object} song the piece's song model, for the fingerprint's numbers
 * @param {Object} opts {by, at}
 * @returns {Object} the file, ready to JSON.stringify
 */
export function flagsFileFor(record, piece, song, {by = "", at = Date.now()} = {}) {
  let fp = record.fingerprint
  return {
    format: FLAGS_FORMAT,
    version: FLAGS_VERSION,
    exportedAt: at,
    by,
    piece: {
      title: piece.title,
      fingerprint: {
        algo: fp.algo,
        numbersHash: fp.numbersHash,
        numbers: perIndexNumbers(song, fp.bars.length),
        bars: fp.bars,
        sketches: fp.sketches,
      },
    },
    decisions: record.decisions || [],
  }
}

function validFileFingerprint(fp) {
  return !!fp && typeof fp == "object" &&
    Number.isInteger(fp.algo) &&
    typeof fp.numbersHash == "string" &&
    Array.isArray(fp.bars) && fp.bars.every(bar => typeof bar == "string") &&
    Array.isArray(fp.sketches) && fp.sketches.length == fp.bars.length &&
    (fp.numbers == null || (Array.isArray(fp.numbers) && fp.numbers.length == fp.bars.length))
}

/**
 * Parses and validates a flags file's text. Never throws.
 * @param {string} text
 * @returns {{data: Object}|{error: string}}
 */
export function readFlagsFile(text) {
  if (typeof text != "string" || text.length > MAX_FLAGS_FILE_BYTES) {
    return {error: "This flags file is too large to open."}
  }

  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return {error: "This isn't a flags file."}
  }

  if (!data || typeof data != "object" || data.format != FLAGS_FORMAT) {
    return {error: "This isn't a flags file."}
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    return {error: "This isn't a flags file."}
  }
  if (data.version > FLAGS_VERSION) {
    return {error: "This flags file was made by a newer version of the app."}
  }
  if (!data.piece || typeof data.piece.title != "string" || !validFileFingerprint(data.piece.fingerprint)) {
    return {error: "This isn't a flags file."}
  }
  if (!Array.isArray(data.decisions) || data.decisions.length > MAX_FLAGS_FILE_DECISIONS) {
    return {error: "This flags file is too large to open."}
  }

  return {data: {...data, by: typeof data.by == "string" ? data.by : "", decisions: data.decisions.filter(validDecision)}}
}

/**
 * The fraction of the file's bars that align well against a local record:
 * what importFlagsFile measures a piece match against (report §3.3).
 * @param {Object} file a parsed flags file (readFlagsFile's `data`)
 * @param {Object} record a local AnnotationRecord, or null
 * @returns {number} 0 to 1
 */
export function fileMatch(file, record) {
  if (!record || !record.fingerprint) { return 0 }
  let fileFp = file.piece.fingerprint
  if (!fileFp.bars.length) { return 0 }

  let alignment = alignBars(fileFp, record.fingerprint)
  let good = alignment.filter(entry => entry && entry.sim >= GOOD_SIMILARITY).length
  return good / fileFp.bars.length
}

// the one range a decision's content is positioned at, in the file's own
// indices: an add/edit's own flag first (it's the most specific), else the
// proposal reference (`of`), else the captured fallback (`given`)
function decisionRange(decision) {
  if (decision.flag && Number.isInteger(decision.flag.startIndex) && Number.isInteger(decision.flag.endIndex)) {
    return {startIndex: decision.flag.startIndex, endIndex: decision.flag.endIndex}
  }
  if (decision.of) { return {startIndex: decision.of.startIndex, endIndex: decision.of.endIndex} }
  if (decision.given) { return {startIndex: decision.given.startIndex, endIndex: decision.given.endIndex} }
  return null
}

function withLocalRange(obj, startIndex, endIndex, song) {
  let numbers = measureNumbers(song)
  return {
    ...obj,
    start: numberAt(numbers, startIndex),
    end: numberAt(numbers, endIndex),
    startIndex,
    endIndex,
  }
}

function anchorFromFingerprint(fingerprint, startIndex, endIndex) {
  let bars = (fingerprint && fingerprint.bars) || []
  return {bars: bars.slice(startIndex, endIndex + 1)}
}

/**
 * Re-anchors a flags file's decisions onto a local piece: aligns the file's
 * fingerprint to the local record's (st/difficulty/align) and rewrites every
 * decision's ranges and anchor to the local copy's bars. A decision whose
 * range isn't well placed keeps the file's own ranges and is stamped
 * `unplaced`, to wait in the review rather than apply somewhere wrong.
 * @param {Object} file a parsed flags file
 * @param {Object} record the local AnnotationRecord
 * @param {Object} song the local song model, for printed numbers
 * @returns {{decisions: Object[], report: {moved: number, unplaced: number, total: number}}}
 */
export function reanchorDecisions(file, record, song) {
  let alignment = alignBars(file.piece.fingerprint, record.fingerprint)
  let fileNumbers = file.piece.fingerprint.numbers

  let decisions = []
  let moved = 0
  let unplaced = 0

  for (let decision of file.decisions) {
    let range = decisionRange(decision)
    if (!range) {
      decisions.push(decision)
      continue
    }

    let mapped = mapRange(alignment, range.startIndex, range.endIndex)

    if (mapped.place == "unplaced") {
      unplaced++
      decisions.push({
        ...decision,
        unplaced: {
          start: numberAt(fileNumbers, range.startIndex),
          end: numberAt(fileNumbers, range.endIndex),
        },
      })
      continue
    }

    let next = {...decision}
    if (next.of) { next.of = {...next.of, startIndex: mapped.startIndex, endIndex: mapped.endIndex} }
    if (next.given) { next.given = withLocalRange(next.given, mapped.startIndex, mapped.endIndex, song) }
    if (next.flag && Number.isInteger(next.flag.startIndex)) {
      next.flag = withLocalRange(next.flag, mapped.startIndex, mapped.endIndex, song)
    }
    next.anchor = anchorFromFingerprint(record.fingerprint, mapped.startIndex, mapped.endIndex)

    if (mapped.place == "moved") {
      next.moved = {
        start: numberAt(fileNumbers, range.startIndex),
        end: numberAt(fileNumbers, range.endIndex),
        by: file.by || "",
      }
      moved++
    }

    if (next.of) {
      let local = record.proposals.find(p => p.source == next.of.source &&
        p.startIndex == next.of.startIndex && p.endIndex == next.of.endIndex)
      if (local) { next.flagId = local.id }
    }

    decisions.push(next)
  }

  return {decisions, report: {moved, unplaced, total: file.decisions.length}}
}
