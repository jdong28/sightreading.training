// The stored shapes of a piece's flagged passages: one AnnotationRecord per
// piece, holding every source's FlagProposals (stage 1 only ever writes the
// "score" source) and the instructor's decisions (st/difficulty/decisions),
// live since stage 3: an append-only log a new analysis never overwrites.

import {hash8} from "st/difficulty/fingerprints"
import {validDecision, reviewFlags} from "st/difficulty/decisions"

// a [start, end] of printed bar numbers: whole numbers, in order, so every
// consumer that walks a range walks a bounded one
function validRange(range) {
  return Array.isArray(range) && range.length == 2 &&
    range.every(Number.isInteger) && range[0] <= range[1]
}

export function validProposal(p) {
  return !!p && typeof p.id == "string" &&
    typeof p.source == "string" &&
    validRange([p.start, p.end]) &&
    validRange([p.startIndex, p.endIndex]) &&
    (p.hand == "upper" || p.hand == "lower" || p.hand == "both") &&
    (p.level == 1 || p.level == 2 || p.level == 3) &&
    Array.isArray(p.kinds) &&
    (p.alsoAt == null || (Array.isArray(p.alsoAt) && p.alsoAt.every(validRange))) &&
    typeof p.title == "string" &&
    typeof p.reason == "string" &&
    Array.isArray(p.reasons) && p.reasons.every(r => typeof r == "string") &&
    typeof p.tip == "string"
}

export const MAX_CLAUDE_CITATIONS = 3
export const MAX_CLAUDE_EVIDENCE = 4

// Claude's output is untrusted text from outside the app: a link is only
// ever an http(s) one (never `javascript:` or `data:`), and it is only ever
// drawn as React text, never as markup
export function safeUrl(url) {
  if (typeof url != "string" || url.length > 2000) { return null }
  try {
    let parsed = new URL(url)
    return parsed.protocol == "https:" || parsed.protocol == "http:" ? parsed.href : null
  } catch (e) {
    return null
  }
}

function cleanEvidence(item) {
  if (!item || typeof item != "object") { return null }
  if (!Number.isInteger(item.bar) || !Number.isInteger(item.index) || item.index < 0) { return null }
  if (item.hand != "upper" && item.hand != "lower") { return null }
  if (!Array.isArray(item.notes) || !item.notes.length || !item.notes.every(n => typeof n == "string")) { return null }
  return {bar: item.bar, index: item.index, hand: item.hand, notes: item.notes, what: typeof item.what == "string" ? item.what : ""}
}

function cleanCitation(item) {
  if (!item || typeof item != "object") { return null }
  let url = safeUrl(item.url)
  if (!url || typeof item.title != "string" || !item.title.trim()) { return null }
  let text = key => typeof item[key] == "string" ? item[key] : ""
  // the app never fetches a page, so no citation of Claude's is ever verified
  return {url, title: item.title, says: text("says"), quote: text("quote"), sourceBars: text("sourceBars"), verified: false}
}

function cleanClaudeNote(claude) {
  if (!claude || typeof claude != "object") { return undefined }
  let note = {
    confidence: ["low", "medium", "high"].includes(claude.confidence) ? claude.confidence : "medium",
    analysis: ["agrees", "in part", "disagrees", "new"].includes(claude.analysis) ? claude.analysis : "new",
    analysisNote: typeof claude.analysisNote == "string" ? claude.analysisNote : "",
  }
  if (Number.isInteger(claude.shift) && claude.shift != 0 && validRange([claude.claimed && claude.claimed.start, claude.claimed && claude.claimed.end])) {
    note.shift = claude.shift
    note.claimed = {start: claude.claimed.start, end: claude.claimed.end}
  }
  return note
}

/**
 * A Claude proposal as the app will hold it, or null when it isn't one: a
 * stored FlagProposal of source "claude" (validProposal) with the extras only
 * Claude's carry, each cleaned rather than trusted. Evidence and citations
 * that don't hold are dropped item by item (the proposal stays); more than
 * MAX_CLAUDE_CITATIONS citations keep the first few; `verified` is always false.
 * @param {Object} p
 * @returns {Object|null}
 */
export function cleanClaudeProposal(p) {
  if (!validProposal(p) || p.source != "claude") { return null }

  let {evidence, citations, claude, ...rest} = p
  let clean = {...rest}

  if (Array.isArray(evidence)) {
    clean.evidence = evidence.map(cleanEvidence).filter(Boolean).slice(0, MAX_CLAUDE_EVIDENCE)
  }
  if (Array.isArray(citations)) {
    clean.citations = citations.map(cleanCitation).filter(Boolean).slice(0, MAX_CLAUDE_CITATIONS)
  }
  let note = cleanClaudeNote(claude)
  if (note) { clean.claude = note }
  return clean
}

export function validAnnotation(record) {
  if (!record || typeof record != "object") { return false }
  if (record.pieceId == null) { return false }
  if (!record.fingerprint || typeof record.fingerprint != "object") { return false }
  if (!Array.isArray(record.fingerprint.bars)) { return false }
  if (!Array.isArray(record.proposals) || !record.proposals.every(validProposal)) { return false }
  if (!Array.isArray(record.decisions) || !record.decisions.every(validDecision)) { return false }
  if (!record.runs || typeof record.runs != "object") { return false }
  return true
}

// stable across re-analyses of the same passage: same bars, same kinds ->
// same id, so a re-import of the same score keeps a flag's identity
export function flagProposalId(start, end, kinds) {
  return `score:${start}-${end}:${hash8([...kinds].sort().join("+"))}`
}

// whether a review flag shapes practice: not dismissed, not unplaced, and not
// a Claude proposal still waiting for a person (design decisions 3 and 4:
// Claude proposes, a person decides, so it can't reorder the plan unseen).
// A score proposal waiting is in force, as it always has been.
export function inForce(flag) {
  return flag.status != "dismissed" && flag.place != "unplaced" &&
    !(flag.status == "waiting" && flag.proposalSource == "claude")
}

// the flags in force: reviewFlags (st/difficulty/decisions) filtered by
// inForce, sorted level descending then by strength, numbered from 1.
// Nothing is stored: callers (stage 2's introduce, the drawer's quick picks,
// BarStrip) derive this on every read, as they always have.
export function flagsInForce(record) {
  return reviewFlags(record)
    .filter(inForce)
    .map((flag, idx) => ({...flag, num: idx + 1}))
}
