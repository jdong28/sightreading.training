// Aligns two fingerprints bar for bar (report §3.3), so a flag re-anchors
// across a re-import with corrected notes, a pickup bar gained or lost, or a
// passage written out instead of repeated: anything short of a different
// score. Pure: the same two fingerprints always align the same way.

export const GAP_PENALTY = 0.6
const MATCH_SCALE = 2
const MATCH_OFFSET = -1

// the {hand}:{beat}:{pitchClass} tokens a bar's sketch names (fingerprints.js
// sketchString), the vocabulary barSimilarity's Jaccard index runs over
function sketchTokens(sketch) {
  let tokens = []
  for (let hand of ["upper", "lower"]) {
    let str = sketch && sketch[hand]
    if (!str) { continue }
    for (let part of str.split("|")) {
      let [beat, pitchClasses] = part.split(":")
      if (!pitchClasses) { continue }
      for (let pc of pitchClasses.split(",")) {
        tokens.push(`${hand}:${beat}:${pc}`)
      }
    }
  }
  return tokens
}

/**
 * How alike two bars are: 1 for an exact hash match or two empty bars,
 * otherwise the Jaccard index of their sketches' pitch-class-by-beat tokens,
 * which survives a single corrected note (st/difficulty/fingerprints keeps
 * sketches for exactly this).
 * @param {{hash: string, sketch: Object}} a
 * @param {{hash: string, sketch: Object}} b
 * @returns {number} 0 to 1
 */
export function barSimilarity(a, b) {
  if (a.hash == b.hash) { return 1 }

  let tokensA = new Set(sketchTokens(a.sketch))
  let tokensB = new Set(sketchTokens(b.sketch))
  if (!tokensA.size && !tokensB.size) { return 1 }
  if (!tokensA.size || !tokensB.size) { return 0 }

  let intersection = 0
  for (let token of tokensA) {
    if (tokensB.has(token)) { intersection++ }
  }
  let union = tokensA.size + tokensB.size - intersection
  return intersection / union
}

// identical bars and numbering: the fast path, which is also what makes
// alignBars(fp, fp) the identity
function identical(fromFp, toFp) {
  return fromFp.algo == toFp.algo && fromFp.numbersHash == toFp.numbersHash &&
    fromFp.bars.length == toFp.bars.length &&
    fromFp.bars.every((hash, i) => hash == toFp.bars[i])
}

/**
 * Aligns every bar of fromFp to its best match in toFp, by Needleman-Wunsch
 * over barSimilarity (match score 2*sim - 1, gap penalty GAP_PENALTY, ties
 * broken toward the diagonal, deterministically). Fingerprints of a
 * different algo are never aligned, since their bar hashes aren't
 * comparable: every bar comes back unplaced.
 * @param {Object} fromFp a fingerprint (st/difficulty/fingerprints)
 * @param {Object} toFp
 * @returns {Array<{to: number, sim: number}|null>} one entry per index of
 * fromFp.bars, in order; null is a gap, no bar of toFp lines up with it
 */
export function alignBars(fromFp, toFp) {
  if (identical(fromFp, toFp)) {
    return fromFp.bars.map((_, i) => ({to: i, sim: 1}))
  }

  if (fromFp.algo != toFp.algo) {
    return fromFp.bars.map(() => null)
  }

  let n = fromFp.bars.length
  let m = toFp.bars.length
  let fromBars = fromFp.bars.map((hash, i) => ({hash, sketch: fromFp.sketches && fromFp.sketches[i]}))
  let toBars = toFp.bars.map((hash, i) => ({hash, sketch: toFp.sketches && toFp.sketches[i]}))

  // dp[i][j]: best score aligning fromBars[0..i) with toBars[0..j).
  // move[i][j]: 0 diagonal (a match), 1 up (fromBars[i-1] is a gap),
  // 2 left (toBars[j-1] is a gap, nothing of fromBars maps there)
  let dp = Array.from({length: n + 1}, () => new Float64Array(m + 1))
  let move = Array.from({length: n + 1}, () => new Uint8Array(m + 1))

  for (let i = 1; i <= n; i++) { dp[i][0] = -GAP_PENALTY * i; move[i][0] = 1 }
  for (let j = 1; j <= m; j++) { dp[0][j] = -GAP_PENALTY * j; move[0][j] = 2 }

  let simCache = new Map()
  let simOf = (i, j) => {
    let key = i * m + j
    let cached = simCache.get(key)
    if (cached != null) { return cached }
    let sim = barSimilarity(fromBars[i], toBars[j])
    simCache.set(key, sim)
    return sim
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let diag = dp[i - 1][j - 1] + (MATCH_SCALE * simOf(i - 1, j - 1) + MATCH_OFFSET)
      let up = dp[i - 1][j] - GAP_PENALTY
      let left = dp[i][j - 1] - GAP_PENALTY

      let best = diag
      let bestMove = 0
      if (up > best + 1e-9) { best = up; bestMove = 1 }
      if (left > best + 1e-9) { best = left; bestMove = 2 }

      dp[i][j] = best
      move[i][j] = bestMove
    }
  }

  let result = new Array(n).fill(null)
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    let step = i > 0 && j > 0 ? move[i][j] : (i > 0 ? 1 : 2)
    if (step == 0) {
      result[i - 1] = {to: j - 1, sim: simOf(i - 1, j - 1)}
      i--
      j--
    } else if (step == 1) {
      result[i - 1] = null
      i--
    } else {
      j--
    }
  }

  return result
}

// the nearest mapped entry from `from` toward `limit` (inclusive), for an
// end of a range that itself lands on a gap
function nearestMapped(alignment, from, limit, dir) {
  for (let i = from; dir > 0 ? i <= limit : i >= limit; i += dir) {
    if (alignment[i]) { return alignment[i] }
  }
  return null
}

// a range is well matched when enough of its bars aligned with good
// similarity: report §3.3's "mostly the same material", not every bar exact
const PLACED_COVERAGE = 0.7
const GOOD_SIMILARITY = 0.6

/**
 * Where a decided range of fromFp's bars lands in toFp's.
 * @param {Array<{to: number, sim: number}|null>} alignment alignBars(fromFp, toFp)
 * @param {number} startIndex
 * @param {number} endIndex
 * @returns {{place: "placed"|"moved"|"unplaced", startIndex: number, endIndex: number}}
 * startIndex/endIndex are toFp's, present only when place isn't "unplaced"
 */
export function mapRange(alignment, startIndex, endIndex) {
  let entries = []
  for (let i = startIndex; i <= endIndex; i++) { entries.push(alignment[i]) }
  let mapped = entries.filter(Boolean)

  let startEntry = alignment[startIndex] || nearestMapped(alignment, startIndex, endIndex, 1)
  let endEntry = alignment[endIndex] || nearestMapped(alignment, endIndex, startIndex, -1)
  if (!startEntry || !endEntry) { return {place: "unplaced"} }

  let coverage = entries.length ? mapped.filter(e => e.sim >= GOOD_SIMILARITY).length / entries.length : 0
  if (coverage < PLACED_COVERAGE) { return {place: "unplaced"} }

  let newStart = Math.min(startEntry.to, endEntry.to)
  let newEnd = Math.max(startEntry.to, endEntry.to)
  let moved = newStart != startIndex || newEnd != endIndex

  return {place: moved ? "moved" : "placed", startIndex: newStart, endIndex: newEnd}
}
