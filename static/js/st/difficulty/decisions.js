// Instructor decisions on a piece's flagged passages (stage 3): the
// append-only log kept in AnnotationRecord#decisions (st/difficulty/records),
// keyed [flagId, at] like the review log, so merging two copies (a library
// or a flags file) is a union and nothing is ever deleted, only superseded
// by a later decision.
//
// reviewFlags folds the log on every read; nothing derived here is stored.
// A decision governs a proposal when its flagId equals the proposal's id,
// or, failing that, its `of` names the same source and the same
// measure-index range: kinds drift between analyser versions can change a
// proposal's id, but never bring back a dismissed flag or duplicate an
// accepted one.

import {measureIndexRange} from "st/song_sections"

export const DECISION_ACTIONS = ["accept", "edit", "dismiss", "add", "restore"]

// the words an instructor's "what makes it hard" pills offer, the same
// vocabulary findPassages/passageKinds already groups the analyser's own
// signals into (st/difficulty/sections.KIND_OF), so a teacher's pick and the
// score's own reading of a passage read as the same thing
export const FLAG_KINDS = [
  "speed", "leaps", "stretch", "3:2", "two hands", "voicing", "pedal", "reading", "memory",
]

export const KIND_WORDS = {
  speed: "speed",
  leaps: "leaps",
  stretch: "stretch",
  "3:2": "3 against 2",
  "two hands": "two hands",
  voicing: "voicing",
  pedal: "pedal",
  reading: "reading",
  memory: "memory",
}

// the editable fields of a flag: an "edit" decision's overrides are any
// subset of these, an "add" decision's flag is all of them
const FLAG_FIELD_KEYS = [
  "start", "end", "startIndex", "endIndex", "hand", "level", "kinds", "title", "reason", "tip", "apart",
]

function validRange(start, end) {
  return Number.isInteger(start) && Number.isInteger(end) && start <= end
}

function validHand(hand) {
  return hand == "upper" || hand == "lower" || hand == "both"
}

function validLevel(level) {
  return level == 1 || level == 2 || level == 3
}

function validAnchor(anchor) {
  return !!anchor && typeof anchor == "object" &&
    Array.isArray(anchor.bars) && anchor.bars.every(bar => typeof bar == "string")
}

function validOf(of) {
  if (of == null) { return true }
  return typeof of == "object" && typeof of.source == "string" &&
    validRange(of.startIndex, of.endIndex)
}

function validGiven(given) {
  if (given == null) { return true }
  return typeof given == "object" &&
    typeof given.title == "string" &&
    Array.isArray(given.reasons) && given.reasons.every(r => typeof r == "string") &&
    typeof given.tip == "string" &&
    validHand(given.hand) && validLevel(given.level) &&
    Array.isArray(given.kinds) &&
    validRange(given.start, given.end) && validRange(given.startIndex, given.endIndex)
}

// a range an override may leave out, but never leave half of or fill with
// anything but two ordered integers: every consumer walks or slices it
// (startApartBars, anchorFor, the flags file's mapRange)
function validOptionalRange(start, end) {
  if (start === undefined && end === undefined) { return true }
  return validRange(start, end)
}

// an "edit" decision's flag is a partial override: only the editable keys,
// none of them required. An "add" decision's is the whole flag.
function validFlagObject(flag, {whole}) {
  if (flag == null) { return !whole }
  if (typeof flag != "object") { return false }
  for (let key of Object.keys(flag)) {
    if (!FLAG_FIELD_KEYS.includes(key)) { return false }
  }
  if (!whole) {
    return validOptionalRange(flag.start, flag.end) &&
      validOptionalRange(flag.startIndex, flag.endIndex)
  }

  return validRange(flag.start, flag.end) && validRange(flag.startIndex, flag.endIndex) &&
    validHand(flag.hand) && validLevel(flag.level) && Array.isArray(flag.kinds) &&
    typeof flag.title == "string" && typeof flag.reason == "string" && typeof flag.tip == "string"
}

// whether a stored FlagDecision is well formed: every consumer (the fold,
// the flags file importer) can trust this instead of checking shapes itself
export function validDecision(d) {
  if (!d || typeof d != "object") { return false }
  if (typeof d.flagId != "string" || !d.flagId) { return false }
  if (!DECISION_ACTIONS.includes(d.action)) { return false }
  if (!Number.isInteger(d.at)) { return false }
  if (typeof d.by != "string") { return false }
  if (!validAnchor(d.anchor)) { return false }
  if (!validOf(d.of)) { return false }
  if (!validGiven(d.given)) { return false }

  if (d.action == "add") {
    if (d.source != "teacher" && d.source != "player") { return false }
    return validFlagObject(d.flag, {whole: true})
  }
  if (d.action == "edit") {
    return validFlagObject(d.flag, {whole: false})
  }
  return d.flag == null
}

// the fingerprint's bar hashes over a decided range, at decision time: what
// a later read compares against the live fingerprint to tell "check" (the
// same score re-imported with corrected notes) from "placed"
function anchorFor(record, startIndex, endIndex) {
  let bars = (record && record.fingerprint && record.fingerprint.bars) || []
  return {bars: bars.slice(startIndex, endIndex + 1)}
}

// a decision on a proposal carries `of` (so kinds drift can't lose the
// decision) and `given` (so a dropped proposal still has content to fall
// back to). A flag with no proposalSource (purely added) carries neither.
function ofFor(flag) {
  if (!flag.proposalSource) { return undefined }
  return {source: flag.proposalSource, startIndex: flag.startIndex, endIndex: flag.endIndex}
}

function givenFor(flag) {
  if (!flag.proposalSource) { return undefined }
  return {
    title: flag.title,
    reasons: flag.reasons || (flag.reason ? [flag.reason] : []),
    tip: flag.tip,
    level: flag.level,
    kinds: flag.kinds || [],
    hand: flag.hand,
    start: flag.start,
    end: flag.end,
    startIndex: flag.startIndex,
    endIndex: flag.endIndex,
  }
}

// drops a blank title/reason/tip (a blank field means "keep the analysis's",
// never "set it to blank"), and anything outside the editable keys
function cleanOverrides(overrides) {
  let clean = {}
  for (let key of FLAG_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(overrides || {}, key)) { continue }
    let value = overrides[key]
    if ((key == "title" || key == "reason" || key == "tip") && (value == null || value === "")) { continue }
    clean[key] = value
  }
  return clean
}

function rangeOf(flag, overrides) {
  return [
    overrides && overrides.startIndex != null ? overrides.startIndex : flag.startIndex,
    overrides && overrides.endIndex != null ? overrides.endIndex : flag.endIndex,
  ]
}

/**
 * Accepts a flag (a proposal, or a review flag from reviewFlags) as it
 * stands, with no overrides.
 * @param {Object} opts {record, flag, by, at}
 * @returns {Object} a FlagDecision
 */
export function acceptDecision({record, flag, by = "", at}) {
  return {
    flagId: flag.id, action: "accept", at, by,
    of: ofFor(flag), given: givenFor(flag),
    anchor: anchorFor(record, flag.startIndex, flag.endIndex),
  }
}

/**
 * Dismisses a flag: out of force until restored.
 * @param {Object} opts {record, flag, by, at}
 */
export function dismissDecision({record, flag, by = "", at}) {
  return {
    flagId: flag.id, action: "dismiss", at, by,
    of: ofFor(flag), given: givenFor(flag),
    anchor: anchorFor(record, flag.startIndex, flag.endIndex),
  }
}

/**
 * Restores a dismissed flag to the state it held before the dismissal.
 * @param {Object} opts {record, flag, by, at}
 */
export function restoreDecision({record, flag, by = "", at}) {
  return {
    flagId: flag.id, action: "restore", at, by,
    of: ofFor(flag), given: givenFor(flag),
    anchor: anchorFor(record, flag.startIndex, flag.endIndex),
  }
}

/**
 * Edits a flag: the latest edit's overrides replace, wholesale, whatever an
 * earlier edit set (so "Use that name" clears a renaming by simply leaving
 * title out of the next edit, rather than needing a separate clearing
 * decision kind).
 * @param {Object} opts {record, flag, overrides, by, at}
 * @param {Object} opts.overrides any of start, end, startIndex, endIndex,
 * hand, level, kinds, title, reason, tip, apart
 */
export function editDecision({record, flag, overrides, by = "", at}) {
  let clean = cleanOverrides(overrides)
  let [startIndex, endIndex] = rangeOf(flag, clean)
  return {
    flagId: flag.id, action: "edit", at, by,
    of: ofFor(flag), given: givenFor(flag), flag: clean,
    anchor: anchorFor(record, startIndex, endIndex),
  }
}

let addSeq = 0

// a new id for an added flag, made once at the add: base-36 time plus a few
// random characters, so two adds in the same millisecond never collide
function newFlagId(at) {
  addSeq = (addSeq + 1) % 1296
  let salt = addSeq.toString(36).padStart(2, "0")
  let rand = Math.random().toString(36).slice(2, 4)
  return `added:${at.toString(36)}${salt}${rand}`
}

/**
 * Adds a flag the analysis never proposed: a teacher's own mark, or a
 * player's promoted trouble spot.
 * @param {Object} opts {record, flag, by, at, source} source is "teacher"
 * or "player"; flag is the whole flag (start, end, startIndex, endIndex,
 * hand, level, kinds, title, reason, tip, apart)
 */
export function addDecision({record, flag, by = "", at, source = "teacher"}) {
  let whole = {
    start: flag.start, end: flag.end, startIndex: flag.startIndex, endIndex: flag.endIndex,
    hand: flag.hand, level: flag.level, kinds: flag.kinds || [],
    title: flag.title, reason: flag.reason || "", tip: flag.tip || "",
    apart: !!flag.apart,
  }
  return {
    flagId: newFlagId(at), action: "add", at, by, source, flag: whole,
    anchor: anchorFor(record, flag.startIndex, flag.endIndex),
  }
}

/**
 * Promotes a player's own trouble spot (st/difficulty/trouble) to a flag in
 * force, waiting for the teacher (decision 8). A spot names printed bars, so
 * the song turns them into the measure indices every other producer of a
 * flag's range means (measureIndexRange, never a position in the printed
 * numbers: a bar split around a repeat has one number over two indices).
 * @param {Object} opts {record, spot, song, by, at}
 */
export function promoteTroubleSpot({record, spot, song, by = "", at}) {
  let [startIndex, endIndex] = measureIndexRange(song, spot.start, spot.end)
  return addDecision({
    record,
    flag: {
      start: spot.start, end: spot.end, startIndex, endIndex,
      hand: spot.hand || "both", level: 1, kinds: [],
      title: "Your trouble spot",
      reason: spot.text || "",
      tip: "Slowly, a bar at a time, then join it to its neighbours",
      apart: false,
    },
    by, at, source: "player",
  })
}

// decisions sorted by at, stable (ties keep their log order)
export function byAt(decisions) {
  return decisions
    .map((d, index) => ({d, index}))
    .sort((a, b) => a.d.at - b.d.at || a.index - b.index)
    .map(({d}) => d)
}

/**
 * Unions a batch of decisions into a record's log, keyed [flagId, at], like
 * a library merge of the review log: importing the same decisions twice
 * adds nothing, and nothing already in the log is ever removed.
 * @param {Object} record an AnnotationRecord, or null
 * @param {Object[]} decisions FlagDecisions to add
 * @returns {Object} record with `decisions` set to the union, in at order
 */
export function withDecisions(record, decisions) {
  let existing = (record && record.decisions) || []
  let seen = new Set(existing.map(d => `${d.flagId}\u0000${d.at}`))
  let added = decisions.filter(d => {
    let key = `${d.flagId}\u0000${d.at}`
    if (seen.has(key)) { return false }
    seen.add(key)
    return true
  })
  return {...record, decisions: byAt([...existing, ...added])}
}

// folds one flag's decisions (already in at order) into its status and the
// content a later decision overrides
function foldGroup(group) {
  let status = "waiting"
  let overrideFlag = null
  let addedFlag = null
  let addedSource = null
  let dismissedFrom = null
  let movedFrom = null
  let by = ""

  for (let d of group) {
    by = d.by || by
    if (d.action == "add") {
      status = d.source == "player" ? "waiting" : "added"
      addedFlag = d.flag
      addedSource = d.source
      overrideFlag = null
    } else if (d.action == "accept") {
      status = "accepted"
    } else if (d.action == "edit") {
      status = status == "added" ? "added" : "edited"
      overrideFlag = d.flag
    } else if (d.action == "dismiss") {
      dismissedFrom = status
      status = "dismissed"
    } else if (d.action == "restore") {
      status = dismissedFrom || "waiting"
      dismissedFrom = null
    }
    if (d.moved) { movedFrom = d.moved }
  }

  return {status, overrideFlag, addedFlag, addedSource, by, movedFrom}
}

// "placed" | "moved" | "check" | "unplaced" (report §3.3): unplaced is
// stamped at import, check compares the decision's own anchor against the
// record's live fingerprint over the same indices (a local re-import with a
// corrected note, report §3.3 Case 1)
function placeFor(record, group, {startIndex, endIndex}) {
  if (!group || !group.length) { return "placed" }

  let last = group[group.length - 1]
  if (last.unplaced) { return "unplaced" }

  let moved = group.some(d => d.moved)
  let anchored = [...group].reverse().find(d => d.anchor && d.anchor.bars.length)

  let bars = record && record.fingerprint && record.fingerprint.bars
  if (anchored && Array.isArray(bars)) {
    let live = bars.slice(startIndex, endIndex + 1)
    let same = live.length == anchored.anchor.bars.length &&
      live.every((hash, idx) => hash == anchored.anchor.bars[idx])
    if (!same) { return "check" }
  }

  return moved ? "moved" : "placed"
}

function contentFrom(source) {
  return {
    title: source.title,
    reasons: source.reasons || [],
    tip: source.tip,
    hand: source.hand,
    level: source.level,
    kinds: source.kinds || [],
    start: source.start,
    end: source.end,
    startIndex: source.startIndex,
    endIndex: source.endIndex,
  }
}

// one review flag: a proposal (live or, via `given`, dropped) folded with
// its decisions, or a flag the log alone holds (an add)
function buildFlag(record, {proposal, given, group}) {
  let {status, overrideFlag, addedFlag, addedSource, by, movedFrom} = foldGroup(group || [])

  let base
  let proposalSource = null
  let teacherLine = null

  if (proposal) {
    base = contentFrom(proposal)
    proposalSource = proposal.source
  } else if (given) {
    base = contentFrom(given)
    proposalSource = "score"
  } else {
    base = contentFrom(addedFlag)
    teacherLine = addedFlag.reason || null
  }

  let id = (group && group[0] && group[0].flagId) || (proposal && proposal.id)
  let givenTitle
  let title = base.title
  let tip = base.tip
  let hand = base.hand
  let level = base.level
  let kinds = base.kinds
  let start = base.start
  let end = base.end
  let startIndex = base.startIndex
  let endIndex = base.endIndex
  let apart = !proposal && !given ? !!addedFlag.apart : false

  if (overrideFlag) {
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "title")) {
      givenTitle = title
      title = overrideFlag.title
    }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "tip")) { tip = overrideFlag.tip }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "hand")) { hand = overrideFlag.hand }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "level")) { level = overrideFlag.level }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "kinds")) { kinds = overrideFlag.kinds }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "start")) { start = overrideFlag.start }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "end")) { end = overrideFlag.end }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "startIndex")) { startIndex = overrideFlag.startIndex }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "endIndex")) { endIndex = overrideFlag.endIndex }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "apart")) { apart = overrideFlag.apart }
    if (Object.prototype.hasOwnProperty.call(overrideFlag, "reason")) { teacherLine = overrideFlag.reason }
  }

  let lines = []
  if (teacherLine) { lines.push({source: "teacher", text: teacherLine}) }
  for (let reason of base.reasons || []) { lines.push({source: "score", text: reason}) }

  let sources = new Set()
  if (proposalSource) { sources.add(proposalSource) }
  if (addedSource) { sources.add(addedSource) }
  if (group && group.some(d => ["accept", "edit", "dismiss", "restore"].includes(d.action))) {
    sources.add("teacher")
  }

  return {
    id, status, sources: [...sources],
    start, end, startIndex, endIndex, hand, level, kinds, title,
    ...(givenTitle !== undefined ? {givenTitle} : {}),
    lines, tip, apart,
    alsoAt: proposal ? proposal.alsoAt : undefined,
    strength: proposal ? proposal.strength : undefined,
    place: placeFor(record, group, {startIndex, endIndex}),
    ...(movedFrom ? {movedFrom} : {}),
    by,
    proposalSource,
  }
}

function waitingFlag(proposal) {
  return {
    id: proposal.id, status: "waiting", sources: [proposal.source],
    start: proposal.start, end: proposal.end,
    startIndex: proposal.startIndex, endIndex: proposal.endIndex,
    hand: proposal.hand, level: proposal.level, kinds: proposal.kinds || [],
    title: proposal.title,
    lines: (proposal.reasons || []).map(text => ({source: "score", text})),
    tip: proposal.tip, apart: false,
    alsoAt: proposal.alsoAt, strength: proposal.strength,
    place: "placed", by: "",
    proposalSource: proposal.source,
  }
}

// a group governs a proposal when a decision's flagId equals its id, or,
// failing that, some decision's `of` names the same source and index range
function groupKeyForProposal(groups, proposal) {
  if (groups.has(proposal.id)) { return proposal.id }
  for (let [key, group] of groups) {
    let withOf = group.find(d => d.of)
    if (withOf && withOf.of.source == proposal.source &&
        withOf.of.startIndex == proposal.startIndex && withOf.of.endIndex == proposal.endIndex) {
      return key
    }
  }
  return null
}

function orderAndNumber(flags) {
  return [...flags]
    .sort((a, b) => {
      if (b.level != a.level) { return b.level - a.level }
      if ((b.strength || 0) != (a.strength || 0)) { return (b.strength || 0) - (a.strength || 0) }
      return a.start - b.start
    })
    .map((flag, idx) => ({...flag, num: idx + 1}))
}

/**
 * Every flag of a piece, decided or not: the fold of its proposals and its
 * decision log (§2 of the plan). Nothing is stored; this is worked out on
 * every read, the same way flagsInForce always has been.
 * @param {Object} record an AnnotationRecord
 * @returns {Object[]} sorted level desc, then strength desc, then start,
 * numbered from 1 (see flagsInForce)
 */
export function reviewFlags(record) {
  if (!record) { return [] }

  let proposals = record.proposals || []
  let decisions = byAt(record.decisions || [])

  let groups = new Map()
  for (let d of decisions) {
    let list = groups.get(d.flagId)
    if (!list) { list = []; groups.set(d.flagId, list) }
    list.push(d)
  }

  let claimed = new Set()
  let flags = []

  for (let proposal of proposals) {
    let key = groupKeyForProposal(groups, proposal)
    if (key) {
      claimed.add(key)
      flags.push(buildFlag(record, {proposal, group: groups.get(key)}))
    } else {
      flags.push(waitingFlag(proposal))
    }
  }

  for (let [key, group] of groups) {
    if (claimed.has(key)) { continue }

    let first = group[0]
    if (first.action == "add") {
      flags.push(buildFlag(record, {group}))
    } else {
      let given = [...group].reverse().find(d => d.given)
      if (given) {
        flags.push(buildFlag(record, {given: given.given, group}))
      }
    }
  }

  return orderAndNumber(flags)
}

/**
 * The bars a flag in force asks to start hands apart (decision 6), and the
 * hand(s) each names: a flag of one hand gives that hand alone; a flag of
 * both gives the right hand first, then the left, the same order a
 * both-hands "practise hands separately" pill already offers
 * (handPillHand in passages_plate.jsx).
 * @param {Object[]} flags flags in force (st/difficulty/records.flagsInForce)
 * @returns {Map<number, string[]>} measure number -> hand(s), only flags
 * ticked "start this passage hands separately"
 */
export function startApartBars(flags) {
  let map = new Map()
  for (let flag of flags) {
    if (!flag.apart) { continue }
    let hands = flag.hand == "both" ? ["upper", "lower"] : [flag.hand]
    for (let number = flag.start; number <= flag.end; number++) {
      map.set(number, hands)
    }
  }
  return map
}
