// The flags file (report §4.3): an instructor's decisions on a piece,
// shareable between installs and across editions numbered differently. It
// carries no proposals (each device makes its own) and re-anchors by bar
// fingerprint (st/difficulty/align) rather than by measure number, so it
// survives a pickup gained or lost, a passage written out instead of
// repeated, or a few corrected notes.

import {measureNumbers} from "st/song_sections"
import {validDecision, byAt} from "st/difficulty/decisions"
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

// Whether every range a decision carries names bars the file's own
// fingerprint has. validDecision already has them as two ordered integers;
// this is the bound only the file knows, and it belongs here because every
// consumer walks or slices those ranges afterwards (mapRange over the
// alignment, startApartBars over the printed numbers, anchorFor over the
// bars), so one range from a truncated or hand-edited file would otherwise
// run to its end rather than be clamped at each loop in turn.
function withinFingerprint(decision, fp) {
  let lastIndex = fp.bars.length - 1
  let firstNumber = fp.numbers ? fp.numbers[0] : 1
  let lastNumber = fp.numbers ? fp.numbers[lastIndex] : fp.bars.length

  let indexes = ({startIndex, endIndex}) =>
    startIndex === undefined || (startIndex >= 0 && endIndex <= lastIndex)
  let printed = ({start, end}) =>
    start === undefined || (start >= firstNumber && end <= lastNumber)

  return [decision.of, decision.given, decision.flag]
    .every(obj => !obj || (indexes(obj) && printed(obj)))
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

  let fp = data.piece.fingerprint
  return {
    data: {
      ...data,
      by: typeof data.by == "string" ? data.by : "",
      decisions: data.decisions.filter(d => validDecision(d) && withinFingerprint(d, fp)),
    },
  }
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

// whether an override carries a range at all, in either representation: a
// placed decision's every range is rewritten to the local copy's bars, so
// one naming printed bars alone is no exception, while a title-only edit
// gains no range it never had
function hasRange(obj) {
  return Number.isInteger(obj.startIndex) || Number.isInteger(obj.start)
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

// a decision exported from an install that once imported it carries that
// import's placement stamps (flagsFileFor ships the log verbatim). Only this
// alignment's own may stand, or a flag placed cleanly here reads moved or
// unplaced for ever (placeFor in st/difficulty/decisions)
function unstamped(decision) {
  let {moved, unplaced, ...rest} = decision
  return rest
}

/**
 * Re-anchors a flags file's decisions onto a local piece and merges them into
 * its decision log: aligns the file's fingerprint to the local record's
 * (st/difficulty/align) and rewrites every decision's ranges and anchor to the
 * local copy's bars. A decision whose range isn't well placed keeps the file's
 * own ranges and is stamped `unplaced`, to wait in the review rather than
 * apply somewhere wrong.
 *
 * The log is a union keyed [flagId, at] (st/difficulty/decisions), so opening
 * the same file twice writes each decision once. The one exception is a
 * decision the log holds `unplaced` that this alignment places: its placement
 * is replaced, so opening the file again once the matching edition is imported
 * puts the flag in force rather than leaving it waiting beside a second copy
 * of itself. The report counts what the merge actually changed, `already`
 * being the decisions the log held as they are.
 * @param {Object} file a parsed flags file
 * @param {Object} record the local AnnotationRecord
 * @param {Object} song the local song model, for printed numbers
 * @returns {{decisions: Object[], report: {placed: number, moved: number,
 * unplaced: number, already: number, total: number}}} decisions is the
 * piece's whole log, the file's merged in, in `at` order
 */
export function reanchorDecisions(file, record, song) {
  let alignment = alignBars(file.piece.fingerprint, record.fingerprint)
  let fileNumbers = file.piece.fingerprint.numbers
  let stored = record.decisions || []

  let kept = new Set(stored)
  let added = []
  let report = {placed: 0, moved: 0, unplaced: 0, already: 0, total: file.decisions.length}

  for (let decision of file.decisions) {
    let range = decisionRange(decision)
    let mapped = range ? mapRange(alignment, range.startIndex, range.endIndex) : null
    let place = mapped ? mapped.place : "placed"
    let next = unstamped(decision)

    if (place == "unplaced") {
      next.unplaced = {
        start: numberAt(fileNumbers, range.startIndex),
        end: numberAt(fileNumbers, range.endIndex),
      }
    } else if (mapped) {
      if (next.of) { next.of = {...next.of, startIndex: mapped.startIndex, endIndex: mapped.endIndex} }
      if (next.given) { next.given = withLocalRange(next.given, mapped.startIndex, mapped.endIndex, song) }
      if (next.flag && hasRange(next.flag)) {
        next.flag = withLocalRange(next.flag, mapped.startIndex, mapped.endIndex, song)
      }
      next.anchor = anchorFromFingerprint(record.fingerprint, mapped.startIndex, mapped.endIndex)

      if (place == "moved") {
        next.moved = {
          start: numberAt(fileNumbers, range.startIndex),
          end: numberAt(fileNumbers, range.endIndex),
          by: file.by || "",
        }
      }

      if (next.of) {
        let local = record.proposals.find(p => p.source == next.of.source &&
          p.startIndex == next.of.startIndex && p.endIndex == next.of.endIndex)
        if (local) { next.flagId = local.id }
      }
    }

    // the same decision this log already holds: under the file's own flagId
    // while an earlier import left it unplaced, under the local proposal's
    // once an import placed it
    let twin = stored.find(d => d.at == decision.at &&
      (d.flagId == decision.flagId || d.flagId == next.flagId))

    if (twin) {
      if (!twin.unplaced || place == "unplaced") {
        report.already++
        continue
      }
      kept.delete(twin)
    }

    report[place]++
    added.push(next)
  }

  return {decisions: byAt([...kept, ...added]), report}
}
