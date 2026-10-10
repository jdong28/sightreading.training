// What Claude said, checked against the score before anything is written
// (Appendix D of the plan): the shape, the text limits, each flag's range and
// evidence notes (found by pitch in the claimed bars and hand), the
// citations' links, duplicates and the budget. Pure: the song and the
// structured output in, kept proposals and rejected flags out.

import {measureNumbers, measureNumberList, measureIndexRange, staffTracks} from "st/song_sections"
import {hash8} from "st/difficulty/fingerprints"
import {outputSchema} from "./schema"

const EPSILON = 1e-6

export const MAX_FLAGS = 10
export const MAX_HARD_FLAGS = 8
export const MAX_COVERED = 0.4
export const MAX_SPAN_BARS = 8
export const MAX_CITATIONS = 3
export const SHIFTS = [0, -1, 1, -2, 2]

export const TEXT_LIMITS = {
  title: 60, reason: 220, tip: 160, analysis_note: 160, what: 80, says: 240, quote: 300, notes: 600,
}

const LEVELS = {hardest: 3, hard: 2, "worth a look": 1}
const CONFIDENCE = {high: 3, medium: 2, low: 1}
const HANDS = {right: "upper", left: "lower", both: "both"}

// ---- the shape ----

function typeOk(type, value) {
  if (type == "object") { return !!value && typeof value == "object" && !Array.isArray(value) }
  if (type == "array") { return Array.isArray(value) }
  if (type == "integer") { return Number.isInteger(value) }
  return typeof value == type
}

// the subset of JSON schema outputSchema() uses (types, enums, required keys,
// no extra keys), so the code's own check can never drift from what Claude
// Code was asked to enforce
function shapeErrors(schema, value, path, errors) {
  if (!typeOk(schema.type, value)) {
    errors.push(`${path} should be ${schema.type}`)
    return
  }

  if (schema.enum && !schema.enum.includes(value)) { errors.push(`${path} is not one of ${schema.enum.join(", ")}`) }

  if (schema.type == "object") {
    for (let key of schema.required || []) {
      if (!(key in value)) { errors.push(`${path}.${key} is missing`) }
    }
    for (let key of Object.keys(value)) {
      if (!schema.properties[key]) {
        if (schema.additionalProperties === false) { errors.push(`${path}.${key} is not allowed`) }
        continue
      }
      shapeErrors(schema.properties[key], value[key], `${path}.${key}`, errors)
    }
  }

  // array sizes are the schema's own to enforce on Claude Code's side: here
  // an answer with 14 flags is still an answer, and the budget trims it
  if (schema.type == "array") {
    value.forEach((item, idx) => shapeErrors(schema.items, item, `${path}[${idx}]`, errors))
  }
}

/**
 * The ways an output departs from the schema, none for a good one.
 * @param {*} output
 * @returns {string[]}
 */
export function checkShape(output) {
  let errors = []
  shapeErrors(outputSchema(), output, "output", errors)
  return errors
}

// ---- text ----

/**
 * Cuts text to a limit at a word boundary with "…".
 * @returns {string}
 */
export function trimText(text, limit) {
  if (text.length <= limit) { return text }

  let cut = text.slice(0, limit - 1)
  let space = cut.lastIndexOf(" ")
  if (space > limit * 0.5) { cut = cut.slice(0, space) }
  return `${cut.trimEnd()}…`
}

// ---- notes ----

const LETTER_OFFSETS = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}

/**
 * A note name as plain ASCII: ♭ ♯ 𝄪 𝄫 become b # ## bb.
 * @returns {string}
 */
export function normalizeNote(name) {
  return String(name).trim()
    .replace(/♭/g, "b").replace(/♯/g, "#").replace(/𝄪/g, "##").replace(/𝄫/g, "bb")
}

/**
 * The MIDI pitch of a note name (C4 = 60, so B#3 = 60 too), or null for one
 * that doesn't parse. Spelling never matters, only the key struck.
 * @returns {number|null}
 */
export function noteMidi(name) {
  let parsed = normalizeNote(name).match(/^([A-Ga-g])(##|#|bb|b)?(-?\d+)$/)
  if (!parsed) { return null }

  let [, letter, accidental, octave] = parsed
  let alter = accidental == "##" ? 2 : accidental == "#" ? 1 : accidental == "bb" ? -2 : accidental == "b" ? -1 : 0
  return (parseInt(octave, 10) + 1) * 12 + LETTER_OFFSETS[letter.toUpperCase()] + alter
}

// ---- the song ----

// what the checks need to know of a song: its bars, and each hand's notes
function songIndex(song) {
  let md = song.metadata || {}
  let starts = md.measureStarts || []
  let printed = measureNumbers(song) || starts.map((_, idx) => idx + 1)
  let numbers = measureNumberList(song)
  let hands = staffTracks(song)

  let notesOf = trackIndices => {
    let notes = []
    for (let idx of trackIndices) {
      for (let note of (song.tracks[idx] || [])) {
        let midi = noteMidi(note.note)
        if (midi != null) { notes.push({midi, start: note.start, stop: note.start + note.duration}) }
      }
    }
    return notes
  }

  return {
    starts, printed, numbers,
    ends: starts.map((start, idx) => idx + 1 < starts.length ? starts[idx + 1] : (md.measuresEnd || start + (md.beatsPerMeasure || 4))),
    right: notesOf(hands.treble),
    left: notesOf(hands.bass),
  }
}

function indicesOfBar(index, bar) {
  let out = []
  index.printed.forEach((number, idx) => { if (number == bar) { out.push(idx) } })
  return out
}

// whether a hand strikes a pitch in a measure index, or has it sounding
// there from earlier (a tied note is struck once)
function holdsAt(index, notes, midi, idx) {
  let start = index.starts[idx]
  let end = index.ends[idx]
  return notes.some(note => note.midi == midi && (
    (note.start >= start - EPSILON && note.start < end - EPSILON) ||
    (note.start < start - EPSILON && note.stop > start + EPSILON)))
}

// the measure index of bar where every one of the item's notes is held, or
// where the first of them is (a split bar's notes may sit in either half),
// or -1 when some note is nowhere in the bar
function barIndexFor(index, item, bar) {
  let notes = item.hand == "right" ? index.right : index.left
  let indices = indicesOfBar(index, bar)

  let together = indices.find(idx => item.midis.every(midi => holdsAt(index, notes, midi, idx)))
  if (together != null) { return together }

  let found = item.midis.map(midi => indices.find(idx => holdsAt(index, notes, midi, idx)))
  return found.every(idx => idx != null) ? Math.min(...found) : -1
}

// the bar `shift` places away in the piece's list of printed numbers
function shiftedBar(index, bar, shift) {
  let pos = index.numbers.indexOf(bar)
  return pos < 0 ? null : (index.numbers[pos + shift] ?? null)
}

// ---- one flag ----

function reject(flag, reason) {
  return {rejected: {flag: {start: flag.start, end: flag.end, title: flag.title}, reason}}
}

// the evidence items that hold, with the range they put the flag at; or
// {error} when too few do. Items are {hand, midis (null when a note didn't
// parse), bar, notes, what}
function checkEvidence(index, flag, items) {
  let startPos = index.numbers.indexOf(flag.start)
  let endPos = index.numbers.indexOf(flag.end)

  let heldAt = (item, shift) => {
    if (!item.midis) { return null }
    let bar = shiftedBar(index, item.bar, shift)
    if (bar == null) { return null }
    let idx = barIndexFor(index, item, bar)
    return idx < 0 ? null : {bar, idx}
  }

  let inside = (bar, first, last) => {
    let pos = index.numbers.indexOf(bar)
    return pos >= first && pos <= last
  }

  for (let shift of SHIFTS) {
    let held = items.map(item => heldAt(item, shift))
    let first = startPos + shift
    let last = endPos + shift
    if (first < 0 || last >= index.numbers.length) { continue }

    // with no shift, whichever items hold stay; with one, every item must
    let usable = shift == 0 ? held.some(Boolean) : held.every(Boolean)
    if (!usable) { continue }

    let kept = items
      .map((item, idx) => ({item, found: held[idx]}))
      .filter(({found}) => found && inside(found.bar, first, last))

    return {kept, shift, start: index.numbers[first], end: index.numbers[last]}
  }

  return {error: "evidence-not-found"}
}

function citationsOf(raw) {
  let kept = []
  let dropped = 0
  for (let citation of raw) {
    let url = null
    try {
      let parsed = new URL(citation.url)
      if (parsed.protocol == "https:" || parsed.protocol == "http:") { url = parsed.href }
    } catch (e) {
      // a link that doesn't parse is dropped below
    }

    if (!url || !citation.title.trim() || kept.length >= MAX_CITATIONS) { dropped++; continue }
    kept.push({
      url, title: citation.title, says: citation.says, quote: citation.quote,
      sourceBars: citation.source_bars, verified: false,
    })
  }
  return {kept, dropped}
}

function proposalId(start, end, kinds) {
  return `claude:${start}-${end}:${hash8([...kinds].sort().join("+"))}`
}

// ---- the whole output ----

/**
 * Checks a structured output against a song.
 * @param {Object} song the song as the app stores it
 * @param {Object} output Claude's structured output
 * @returns {{error: string}|{kept: Object[], rejected: Object[], trimmed: Object[],
 * shifted: number, citationsDropped: number, work: string, notes: string}}
 * kept are FlagProposals (st/difficulty/records) of source "claude"; error
 * means the output didn't have the shape asked for
 */
export function verifyOutput(song, output) {
  let errors = checkShape(output)
  if (errors.length) { return {error: `invalid output: ${errors.slice(0, 5).join("; ")}`} }

  let index = songIndex(song)
  let rejected = []
  let trimmed = []
  let citationsDropped = 0
  let survivors = []

  let trim = (flagLabel, object, field, key = field) => {
    let value = object[field]
    if (value.length > TEXT_LIMITS[key]) {
      trimmed.push({flag: flagLabel, field: key, from: value.length})
      object[field] = trimText(value, TEXT_LIMITS[key])
    }
  }

  for (let source of output.flags) {
    let flag = JSON.parse(JSON.stringify(source))
    let label = `${flag.start}–${flag.end}`
    let fail = reason => { rejected.push(reject(flag, reason).rejected) }

    for (let field of ["title", "reason", "tip", "analysis_note"]) { trim(label, flag, field) }
    flag.evidence.forEach(item => trim(label, item, "what"))
    flag.citations.forEach(citation => { trim(label, citation, "says"); trim(label, citation, "quote") })

    if (!flag.title.trim() || !flag.reason.trim()) { fail("empty-text"); continue }
    if (!flag.kinds.length) { fail("no-kinds"); continue }

    if (!index.numbers.includes(flag.start) || !index.numbers.includes(flag.end) || flag.start > flag.end) {
      fail("bad-range"); continue
    }

    let [startIndex, endIndex] = measureIndexRange(song, flag.start, flag.end)
    if (endIndex - startIndex + 1 > MAX_SPAN_BARS) { fail("too-long"); continue }

    let items = flag.evidence.map(item => ({
      hand: item.hand, bar: item.bar, what: item.what, notes: item.notes.map(normalizeNote),
      midis: item.notes.every(name => noteMidi(name) != null) ? item.notes.map(noteMidi) : null,
    }))

    let found = checkEvidence(index, flag, items)
    if (found.error) { fail(found.error); continue }

    // at least one item and at least half of them
    if (!found.kept.length || found.kept.length * 2 < items.length) { fail("evidence-not-found"); continue }
    if (flag.hand != "both" && !found.kept.some(({item}) => item.hand == flag.hand)) { fail("hand-not-evidenced"); continue }

    let citations = citationsOf(flag.citations)
    citationsDropped += citations.dropped

    let [firstIndex, lastIndex] = measureIndexRange(song, found.start, found.end)
    let claude = {confidence: flag.confidence, analysis: flag.analysis, analysisNote: flag.analysis_note}
    if (found.shift != 0) {
      claude.shift = found.shift
      claude.claimed = {start: flag.start, end: flag.end}
    }

    let kinds = [...new Set(flag.kinds)].slice(0, 4)
    survivors.push({
      level: flag.level, confidence: flag.confidence,
      proposal: {
        id: proposalId(found.start, found.end, kinds), source: "claude",
        start: found.start, end: found.end, startIndex: firstIndex, endIndex: lastIndex,
        hand: HANDS[flag.hand], level: LEVELS[flag.level], kinds,
        title: flag.title, reason: flag.reason, reasons: [flag.reason], tip: flag.tip,
        evidence: found.kept.map(({item, found: at}) => ({
          bar: at.bar, index: at.idx, hand: HANDS[item.hand], notes: item.notes, what: item.what,
        })),
        citations: citations.kept,
        claude,
      },
    })
  }

  // a second flag on a range already taken
  let taken = new Set()
  let unique = []
  for (let entry of survivors) {
    let key = `${entry.proposal.start}-${entry.proposal.end}`
    if (taken.has(key)) {
      rejected.push({flag: {start: entry.proposal.start, end: entry.proposal.end, title: entry.proposal.title}, reason: "duplicate"})
      continue
    }
    taken.add(key)
    unique.push(entry)
  }

  // the budget: hardest first, then the surest, then the earliest
  unique.sort((a, b) =>
    LEVELS[b.level] - LEVELS[a.level] ||
    CONFIDENCE[b.confidence] - CONFIDENCE[a.confidence] ||
    a.proposal.start - b.proposal.start)

  let kept = []
  let covered = new Set()
  let hard = 0
  for (let entry of unique) {
    let {proposal} = entry
    let bars = index.numbers.slice(index.numbers.indexOf(proposal.start), index.numbers.indexOf(proposal.end) + 1)
    let after = new Set([...covered, ...bars])
    let isHard = LEVELS[entry.level] >= 2

    let over = kept.length >= MAX_FLAGS ||
      (isHard && hard >= MAX_HARD_FLAGS) ||
      (kept.length > 0 && after.size > MAX_COVERED * index.numbers.length)
    if (over) {
      rejected.push({flag: {start: proposal.start, end: proposal.end, title: proposal.title}, reason: "over-budget"})
      continue
    }

    kept.push(proposal)
    covered = after
    if (isHard) { hard++ }
  }

  kept.sort((a, b) => a.start - b.start || a.end - b.end)

  let notes = output.notes
  if (notes.length > TEXT_LIMITS.notes) {
    trimmed.push({flag: "notes", field: "notes", from: notes.length})
    notes = trimText(notes, TEXT_LIMITS.notes)
  }

  return {
    kept, rejected, trimmed,
    shifted: kept.filter(p => p.claude.shift).length,
    citationsDropped,
    work: output.work, notes,
  }
}
