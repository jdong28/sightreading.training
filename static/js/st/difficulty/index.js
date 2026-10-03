// Score analysis entry point (report 2.2, 2.6): a piece's flagged
// passages, worked out from its own score, free and offline. Pure: the same
// song, source and `at` always give the same record, ids included.

import {measureNumberList} from "st/song_sections"
import {fingerprint, exactRepeats} from "st/difficulty/fingerprints"
import {scoreExtras} from "st/difficulty/source"
import {barFeatures} from "st/difficulty/features"
import {scoreBars, findPassages, percentileRank, ANALYZER_ALGO} from "st/difficulty/sections"
import {passageReasons, rankedSignals} from "st/difficulty/reasons"
import {flagProposalId} from "st/difficulty/records"

export {ANALYZER_ALGO}

export const LEVEL_WORDS = {1: "Worth a look", 2: "Hard", 3: "Hardest"}

// a bar's percentile rank among the bars that strike a note, as scoreBars
// and findPassages rank them: a bar with nothing struck in it is the floor,
// never a middling cell on the strip
function heatRanks(scored) {
  let noted = scored.filter(bar => bar.density.notes > 0).map(bar => bar.score)
  return scored.map(bar => {
    if (!noted.length || !(bar.density.notes > 0)) { return 0 }
    return Math.round(percentileRank(bar.score, noted) * 100) / 100
  })
}

// {fingerprint, proposals, runs} for a song (and, when the piece has one,
// its stored source MusicXML text). `at` is the caller's clock (the module
// never reads Date.now() itself), so the same inputs always give the same
// output.
export function analyzePiece({song, source, at}) {
  let extras = scoreExtras(source)
  let fp = fingerprint(song)
  let scored = scoreBars(barFeatures(song, extras))
  let repeats = exactRepeats(fp)
  let passages = findPassages(scored, {repeats})
  let heat = heatRanks(scored)

  let proposals = passages.map(passage => {
    let {title, reason, reasons, tip} = passageReasons(passage, {tempo: extras.tempo, bars: scored})

    let proposal = {
      id: flagProposalId(passage.start, passage.end, passage.kinds),
      source: "score",
      start: passage.start,
      end: passage.end,
      startIndex: passage.startIndex,
      endIndex: passage.endIndex,
      hand: passage.hand,
      level: passage.level,
      kinds: passage.kinds,
      title,
      reason,
      reasons,
      tip,
      signals: rankedSignals(passage.run).slice(0, 6),
      strength: passage.strength,
    }

    if (passage.alsoAt && passage.alsoAt.length) {
      proposal.alsoAt = passage.alsoAt
    }

    return proposal
  })

  return {
    fingerprint: fp,
    proposals,
    runs: {
      score: {algo: ANALYZER_ALGO, at, source: !!(source && source.trim()), tempo: extras.tempo, heat},
    },
  }
}

// the record after folding a fresh analysis into a previous one (report
// 3.4): a run replaces only its own source's proposals, every other
// source's proposals and every decision are kept
export function annotationWith(previous, pieceId, analysis) {
  let decisions = previous ? previous.decisions : []
  let otherProposals = previous ? previous.proposals.filter(p => p.source != "score") : []
  let runs = {...(previous ? previous.runs : {}), score: analysis.runs.score}

  return {
    pieceId,
    fingerprint: analysis.fingerprint,
    proposals: [...analysis.proposals, ...otherProposals],
    decisions,
    runs,
  }
}

// whether a stored record needs recomputing: missing, a different analyzer
// version, the song's bars changed since, the heat strip no longer matches
// the bar count, or the piece gained a source the record was made without
export function annotationStale(record, song, {hasSource} = {}) {
  if (!record) { return true }
  if (!record.runs || !record.runs.score || record.runs.score.algo != ANALYZER_ALGO) { return true }

  let fp = fingerprint(song)
  let stored = record.fingerprint

  if (!stored || stored.algo != fp.algo || stored.numbersHash != fp.numbersHash) { return true }
  if (!Array.isArray(stored.bars) || stored.bars.length != fp.bars.length) { return true }
  for (let i = 0; i < fp.bars.length; i++) {
    if (stored.bars[i] != fp.bars[i]) { return true }
  }

  let barCount = measureNumberList(song).length
  if (!Array.isArray(record.runs.score.heat) || record.runs.score.heat.length != barCount) { return true }

  if (hasSource && !record.runs.score.source) { return true }

  return false
}
