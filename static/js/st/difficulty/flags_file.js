// The flags file (report §4.3): an instructor's decisions on a piece,
// shareable between installs and across editions numbered differently. The
// app's own export carries no proposals (each device makes its own) and
// re-anchors by bar fingerprint (st/difficulty/align) rather than by measure
// number, so it survives a pickup gained or lost, a passage written out
// instead of repeated, or a few corrected notes.
//
// Version 2 is what the offline Claude command (tools/claude-flags) writes:
// the same file plus `proposals`, Claude's passages (source "claude" only),
// and a `run` block naming the model and prompt that made them. The app reads
// both and only ever writes version 1.

import {measureNumbers} from "st/song_sections"
import {validDecision, byAt} from "st/difficulty/decisions"
import {cleanClaudeProposal} from "st/difficulty/records"
import {alignBars, mapRange, GOOD_SIMILARITY} from "st/difficulty/align"

export const FLAGS_FORMAT = "sightreading-flags"
// the newest version this app reads
export const FLAGS_VERSION = 2
// what flagsFileFor writes: decisions only
export const DECISIONS_FILE_VERSION = 1

// generous enough for hundreds of bars' sketches (report §4.3 estimates
// 10-20KB for 100 bars); still a hard cap on untrusted input
export const MAX_FLAGS_FILE_BYTES = 1024 * 1024
export const MAX_FLAGS_FILE_DECISIONS = 2000
export const MAX_FLAGS_FILE_PROPOSALS = 50

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
    version: DECISIONS_FILE_VERSION,
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

// a Claude proposal whose every range (its own, its evidence bars) lies within
// the file's fingerprint, its evidence items that don't dropped: null when its
// own range doesn't
function claudeProposalWithin(proposal, fp) {
  let lastIndex = fp.bars.length - 1
  let firstNumber = fp.numbers ? fp.numbers[0] : 1
  let lastNumber = fp.numbers ? fp.numbers[lastIndex] : fp.bars.length

  let inside = ({startIndex, endIndex, start, end}) =>
    startIndex >= 0 && endIndex <= lastIndex && start >= firstNumber && end <= lastNumber
  if (!inside(proposal)) { return null }

  if (proposal.evidence) {
    let evidence = proposal.evidence.filter(item => item.index <= lastIndex &&
      item.index >= proposal.startIndex && item.index <= proposal.endIndex)
    return {...proposal, evidence}
  }
  return proposal
}

// the run block of a version 2 file, kept to the fields the app shows
function cleanRun(run) {
  if (!run || typeof run != "object") { return null }
  let text = key => typeof run[key] == "string" ? run[key] : ""
  let int = key => Number.isInteger(run[key]) ? run[key] : 0
  return {
    source: "claude",
    model: text("model"), effort: text("effort"), web: !!run.web,
    promptVersion: int("promptVersion"), schemaVersion: int("schemaVersion"), compactVersion: int("compactVersion"),
    cli: text("cli"), at: int("at"),
  }
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
  let {proposals: rawProposals, run: rawRun, ...rest} = data

  let proposals = []
  let run = null
  if (data.version >= 2) {
    if (rawProposals != null && !Array.isArray(rawProposals)) { return {error: "This isn't a flags file."} }
    if ((rawProposals || []).length > MAX_FLAGS_FILE_PROPOSALS) {
      return {error: "This flags file is too large to open."}
    }
    proposals = (rawProposals || [])
      .map(p => { let clean = cleanClaudeProposal(p); return clean && claudeProposalWithin(clean, fp) })
      .filter(Boolean)
    // proposals always come with the run that made them, even one a hand-edit left out
    run = cleanRun(rawRun || (proposals.length ? {} : null))
  }

  return {
    data: {
      ...rest,
      by: typeof data.by == "string" ? data.by : "",
      decisions: data.decisions.filter(d => validDecision(d) && withinFingerprint(d, fp)),
      proposals,
      ...(run ? {run} : {}),
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

// the range of the flag a decision with none of its own governs (an accept,
// dismiss or restore of a flag the log alone holds, which has no proposal to
// name): that of the nearest decision of the same flag before it that has one,
// else after it. Without it the decision would keep the exporting copy's
// anchor, and read "check" on a copy whose bars merely differ in a corrected
// note, or placed where its flag is not
function governedRange(decisions, decision) {
  let same = decisions
    .filter(other => other != decision && other.flagId == decision.flagId && decisionRange(other))
    .sort((a, b) => a.at - b.at)
  let before = same.filter(other => other.at <= decision.at)
  let sibling = before.length ? before[before.length - 1] : same[0]
  return sibling ? decisionRange(sibling) : null
}

// whether an override carries a range at all, in either representation: a
// placed decision's every range is rewritten to the local copy's bars, so
// one naming printed bars alone is no exception, while a title-only edit
// gains no range it never had
function hasRange(obj) {
  return Number.isInteger(obj.startIndex) || Number.isInteger(obj.start)
}

// where a field's own bars land locally, or null when it has no index range
// or that range doesn't place. Each range-bearing field is re-anchored from
// its own bars, never from the decision's content range: `of` names the
// proposal the local rematch is keyed on (groupKeyForProposal in
// st/difficulty/decisions), which an edit narrowing the flag would otherwise
// overwrite with the narrowed range and never find again
function ownRange(alignment, obj) {
  if (!obj || !Number.isInteger(obj.startIndex) || !Number.isInteger(obj.endIndex)) { return null }
  let mapped = mapRange(alignment, obj.startIndex, obj.endIndex)
  return mapped.place == "unplaced" ? null : mapped
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
 * @param {Array} [alignment] alignBars(file's fingerprint, record's), when the
 * caller already made it (the full bar-for-bar DP is not free)
 * @returns {{decisions: Object[], report: {placed: number, moved: number,
 * unplaced: number, already: number, total: number}}} decisions is the
 * piece's whole log, the file's merged in, in `at` order
 */
export function reanchorDecisions(file, record, song, alignment) {
  alignment = alignment || alignBars(file.piece.fingerprint, record.fingerprint)
  let fileNumbers = file.piece.fingerprint.numbers
  let stored = record.decisions || []

  let kept = new Set(stored)
  let added = []
  let report = {placed: 0, moved: 0, unplaced: 0, already: 0, total: file.decisions.length}

  for (let decision of file.decisions) {
    let range = decisionRange(decision) || governedRange(file.decisions, decision)
    let mapped = range ? mapRange(alignment, range.startIndex, range.endIndex) : null
    let place = mapped ? mapped.place : "placed"
    let next = unstamped(decision)
    // a decision that names no bars at all (its flag is nowhere in the file)
    // anchors nothing, rather than the exporting copy's bars
    if (!range) { next.anchor = {bars: []} }

    if (place == "unplaced") {
      next.unplaced = {
        start: numberAt(fileNumbers, range.startIndex),
        end: numberAt(fileNumbers, range.endIndex),
      }
    } else if (mapped) {
      let ofAt = ownRange(alignment, next.of)
      let givenAt = ownRange(alignment, next.given)

      if (ofAt) { next.of = {...next.of, startIndex: ofAt.startIndex, endIndex: ofAt.endIndex} }
      if (givenAt) { next.given = withLocalRange(next.given, givenAt.startIndex, givenAt.endIndex, song) }
      if (next.flag && hasRange(next.flag)) {
        let flagAt = ownRange(alignment, next.flag) || mapped
        next.flag = withLocalRange(next.flag, flagAt.startIndex, flagAt.endIndex, song)
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

/**
 * Re-anchors a version 2 file's Claude proposals onto a local piece: every
 * proposal's range, and each evidence bar, is rewritten to the local copy's
 * bars through the same alignment decisions use. One whose range doesn't
 * place is dropped and counted (a proposal has nothing to wait in the review
 * with, unlike a decision), so what a run leaves is only what the copy has.
 * @param {Object} file a parsed flags file
 * @param {Object} record the local AnnotationRecord
 * @param {Object} song the local song model, for printed numbers
 * @param {Array} [alignment] alignBars(file's fingerprint, record's)
 * @returns {{proposals: Object[], report: {placed: number, moved: number, unplaced: number}}}
 */
export function reanchorProposals(file, record, song, alignment) {
  alignment = alignment || alignBars(file.piece.fingerprint, record.fingerprint)
  let numbers = measureNumbers(song)
  let proposals = []
  let report = {placed: 0, moved: 0, unplaced: 0}

  for (let proposal of file.proposals || []) {
    let mapped = mapRange(alignment, proposal.startIndex, proposal.endIndex)
    if (mapped.place == "unplaced") { report.unplaced++; continue }
    report[mapped.place]++

    let next = {
      ...proposal,
      start: numberAt(numbers, mapped.startIndex),
      end: numberAt(numbers, mapped.endIndex),
      startIndex: mapped.startIndex,
      endIndex: mapped.endIndex,
    }

    if (proposal.claude && proposal.claude.claimed) {
      // the bars Claude named move with the proposal, so "named 20–22, notes
      // in 21–23" still reads right in an edition numbered differently
      let offset = next.start - proposal.start
      let {start, end} = proposal.claude.claimed
      next.claude = {...proposal.claude, claimed: {start: start + offset, end: end + offset}}
    }

    if (proposal.evidence) {
      next.evidence = proposal.evidence
        .map(item => {
          let at = mapRange(alignment, item.index, item.index)
          if (at.place == "unplaced" || at.startIndex < mapped.startIndex || at.startIndex > mapped.endIndex) { return null }
          return {...item, index: at.startIndex, bar: numberAt(numbers, at.startIndex)}
        })
        .filter(Boolean)
    }
    proposals.push(next)
  }

  return {proposals, report}
}
