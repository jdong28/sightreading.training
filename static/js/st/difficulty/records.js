// The stored shapes of a piece's flagged passages (report 3.1): one
// AnnotationRecord per piece, holding every source's FlagProposals (stage 1
// only ever writes the "score" source) and the instructor's decisions
// (always [] until stage 3).

import {hash8} from "st/difficulty/fingerprints"

function validProposal(p) {
  return !!p && typeof p.id == "string" &&
    typeof p.source == "string" &&
    Number.isFinite(p.start) && Number.isFinite(p.end) &&
    Number.isFinite(p.startIndex) && Number.isFinite(p.endIndex) &&
    (p.hand == "upper" || p.hand == "lower" || p.hand == "both") &&
    (p.level == 1 || p.level == 2 || p.level == 3) &&
    Array.isArray(p.kinds) &&
    typeof p.title == "string" &&
    typeof p.reason == "string" &&
    Array.isArray(p.reasons) &&
    typeof p.tip == "string"
}

export function validAnnotation(record) {
  if (!record || typeof record != "object") { return false }
  if (record.pieceId == null) { return false }
  if (!record.fingerprint || typeof record.fingerprint != "object") { return false }
  if (!Array.isArray(record.fingerprint.bars)) { return false }
  if (!Array.isArray(record.proposals) || !record.proposals.every(validProposal)) { return false }
  if (!Array.isArray(record.decisions)) { return false }
  if (!record.runs || typeof record.runs != "object") { return false }
  return true
}

// stable across re-analyses of the same passage: same bars, same kinds ->
// same id, so a re-import of the same score keeps a flag's identity
export function flagProposalId(start, end, kinds) {
  return `score:${start}-${end}:${hash8([...kinds].sort().join("+"))}`
}

// the proposals in force, sorted level descending then by strength,
// numbered from 1. Stage 1 never applies decisions; stage 3 reconciles them
// here. Nothing is stored: callers derive this on every read.
export function flagsInForce(record) {
  if (!record) { return [] }

  return [...record.proposals]
    .sort((a, b) => {
      if (b.level != a.level) { return b.level - a.level }
      return (b.strength || 0) - (a.strength || 0)
    })
    .map((proposal, idx) => ({...proposal, num: idx + 1}))
}
