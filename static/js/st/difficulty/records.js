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

function validProposal(p) {
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

// the flags in force: reviewFlags (st/difficulty/decisions) minus dismissed
// and unplaced, sorted level descending then by strength, numbered from 1.
// Nothing is stored: callers (stage 2's introduce, the drawer's quick picks,
// BarStrip) derive this on every read, as they always have.
export function flagsInForce(record) {
  return reviewFlags(record)
    .filter(flag => flag.status != "dismissed" && flag.place != "unplaced")
    .map((flag, idx) => ({...flag, num: idx + 1}))
}
