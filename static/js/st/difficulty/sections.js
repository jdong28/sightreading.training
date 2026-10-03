// Turns st/difficulty/features.js's per-bar measurements into scores and
// groups the hardest bars into passages. The numbers here (ANALYZER_ALGO 4)
// are a first guess (report section 9): tune them freely, but bump
// ANALYZER_ALGO whenever a change would relabel an existing piece's flags,
// so a stale record is recomputed rather than silently kept.

export const ANALYZER_ALGO = 4

const MIN_ANALYSIS_BARS = 8

// z-scored, per hand where the feature is a hand feature
const WEIGHTS = {
  density: 1.0,
  reach: 0.8,
  leap: 0.8,
  sweep: 0.6,
  span: 0.6,
  chordSize: 0.4,
  holdMove: 0.4,
  held: 0.4,
  chromatic: 0.8,
  independence: 0.6,
  crossing: 0.4,
  ledger: 0.3,
}

const HAND_FEATURES = new Set(["reach", "leap", "sweep", "span", "chordSize", "holdMove", "held"])
const BAR_FEATURES = new Set(["density", "chromatic", "independence", "crossing", "ledger"])

// a run resting on a single signal, or on reading signals alone, never
// reaches Hard or Hardest on that (runRestsOnOneSignal)
const READING_KINDS = new Set(["chromatic", "ledger", "keyChange", "timeChange", "clefChange", "remoteKey"])

const KIND_OF = {
  density: "speed", grace: "speed",
  reach: "leaps", leap: "leaps", sweep: "leaps",
  span: "stretch",
  poly: "3:2",
  independence: "two hands", crossing: "two hands",
  holdMove: "voicing",
  held: "pedal",
  chromatic: "reading", ledger: "reading", chordSize: "reading",
  keyChange: "reading", timeChange: "reading", clefChange: "reading", remoteKey: "reading",
  nearRepeat: "memory",
}

function median(values) {
  if (!values.length) { return 0 }
  let sorted = [...values].sort((a, b) => a - b)
  let mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mad(values, centre) {
  return median(values.map(v => Math.abs(v - centre)))
}

function percentile(values, p) {
  if (!values.length) { return 0 }
  let sorted = [...values].sort((a, b) => a - b)
  if (sorted.length == 1) { return sorted[0] }

  let idx = p * (sorted.length - 1)
  let lower = Math.floor(idx)
  let upper = Math.ceil(idx)
  if (lower == upper) { return sorted[lower] }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x))
}

function zscore(x, values) {
  let centre = median(values)
  let spread = mad(values, centre)
  return clamp((x - centre) / (1.4826 * (spread || 1)), 0, 4)
}

function handValue(kind, hand) {
  if (!hand) { return 0 }
  if (kind == "chordSize" || kind == "holdMove") { return hand[kind] || 0 }
  let detail = hand[kind]
  return detail ? detail.semitones : 0
}

function barValue(kind, entry) {
  if (kind == "density") {
    return entry.density.perSecond != null ? entry.density.perSecond : entry.density.perBeat
  }
  if (kind == "chromatic") { return entry.chromatic.count }
  return entry[kind] || 0
}

// {bar, score, top}[] for bars with notes; a bar with no notes scores 0 and
// carries no contributions (never flagged). Hand features are scored per
// hand, against that hand's own distribution across the piece.
export function scoreBars(bars) {
  let notedBars = bars.filter(entry => entry.density.notes > 0)

  let barPopulations = {}
  for (let kind of BAR_FEATURES) {
    barPopulations[kind] = notedBars.map(entry => barValue(kind, entry))
  }

  let handPopulations = {upper: {}, lower: {}}
  for (let kind of HAND_FEATURES) {
    handPopulations.upper[kind] = notedBars.map(entry => handValue(kind, entry.hands.upper))
    handPopulations.lower[kind] = notedBars.map(entry => handValue(kind, entry.hands.lower))
  }

  return bars.map(entry => {
    if (entry.density.notes == 0) {
      return {...entry, score: 0, top: []}
    }

    let contributions = []

    for (let kind of BAR_FEATURES) {
      let z = zscore(barValue(kind, entry), barPopulations[kind])
      contributions.push({kind, hand: null, contribution: z * WEIGHTS[kind], detail: entry[kind]})
    }

    for (let kind of HAND_FEATURES) {
      for (let hand of ["upper", "lower"]) {
        if (!entry.hands[hand]) { continue }
        let z = zscore(handValue(kind, entry.hands[hand]), handPopulations[hand][kind])
        contributions.push({
          kind, hand, contribution: z * WEIGHTS[kind], detail: entry.hands[hand][kind],
        })
      }
    }

    contributions.push({kind: "poly", hand: null, contribution: entry.poly ? 1.5 : 0, detail: entry.poly})
    contributions.push({
      kind: "keyChange", hand: null,
      contribution: entry.keyChange ? 1.0 : 0, detail: entry.keyChange,
    })
    contributions.push({
      kind: "remoteKey", hand: null,
      contribution: entry.remoteKey ? 0.6 : 0, detail: entry.remoteKey,
    })
    contributions.push({
      kind: "timeChange", hand: null,
      contribution: entry.timeChange ? 0.5 : 0, detail: entry.timeChange,
    })
    contributions.push({
      kind: "clefChange", hand: null,
      contribution: entry.clefChange ? 0.3 : 0, detail: entry.clefChange,
    })
    contributions.push({
      kind: "grace", hand: null,
      contribution: Math.min(1.5, 0.3 * (entry.grace || 0)), detail: entry.grace,
    })
    contributions.push({
      kind: "nearRepeat", hand: null,
      contribution: entry.nearRepeat ? 0.5 : 0, detail: entry.nearRepeat,
    })

    let score = contributions.reduce((sum, c) => sum + c.contribution, 0)
    let top = contributions
      .filter(c => c.contribution > 0.3)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 4)

    return {...entry, score, top}
  })
}

// 0-4 for the bar strip, from a bar's percentile rank
export function heat(pct) {
  if (pct >= 0.9) { return 4 }
  if (pct >= 0.7) { return 3 }
  if (pct >= 0.45) { return 2 }
  if (pct >= 0.2) { return 1 }
  return 0
}

function strength(barsInRun) {
  let sorted = [...barsInRun].sort((a, b) => b.score - a.score)
  let top2 = sorted.slice(0, 2)
  return top2.reduce((sum, b) => sum + b.score, 0) / top2.length
}

// splits a run longer than 8 bars at its weakest bar at least 2 bars from
// either end, recursively
function splitRun(run) {
  if (run.length <= 8) { return [run] }

  let weakestIdx = -1
  let weakestScore = Infinity
  for (let i = 2; i < run.length - 2; i++) {
    if (run[i].score < weakestScore) {
      weakestScore = run[i].score
      weakestIdx = i
    }
  }

  if (weakestIdx < 0) { return [run] }

  let left = run.slice(0, weakestIdx)
  let right = run.slice(weakestIdx + 1)
  return [...splitRun(left), ...splitRun(right)]
}

// every hand-feature contribution of a bar (not just its top 4), for the
// passage's hand share
function barAllHandContributions(bar) {
  // top only keeps the four largest contributions; the hand share needs
  // every hand contribution, so recompute from the bar's own hand features
  let out = []
  for (let kind of HAND_FEATURES) {
    for (let hand of ["upper", "lower"]) {
      if (!bar.hands[hand]) { continue }
      let value = handValue(kind, bar.hands[hand])
      if (value > 0) { out.push({hand, contribution: value}) }
    }
  }
  return out
}

function passageHand(run, hasLower) {
  if (!hasLower) { return "both" }

  let totals = {upper: 0, lower: 0}
  for (let bar of run) {
    for (let {hand, contribution} of barAllHandContributions(bar)) {
      totals[hand] += contribution
    }
  }

  let sum = totals.upper + totals.lower
  if (!sum) { return "both" }
  if (totals.upper / sum >= 2 / 3) { return "upper" }
  if (totals.lower / sum >= 2 / 3) { return "lower" }
  return "both"
}

function passageKinds(run) {
  let totals = new Map()
  for (let bar of run) {
    for (let c of bar.top) {
      if (c.kind == "span" && !(c.detail && c.detail.semitones >= 13)) { continue }
      let kind = KIND_OF[c.kind]
      if (!kind) { continue }
      totals.set(kind, (totals.get(kind) || 0) + c.contribution)
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([kind]) => kind)
}

function levelFor(peakPercentile, restsOnOneSignal) {
  if (restsOnOneSignal) { return 1 }
  if (peakPercentile >= 0.9) { return 3 }
  if (peakPercentile >= 0.7) { return 2 }
  return 1
}

// whether a run's evidence keeps it at Worth a look however high it scores
// (report 2.6): a run resting on a single signal, or on reading signals
// alone, never reaches Hard or Hardest on that
function runRestsOnOneSignal(run) {
  let signals = new Set()
  for (let bar of run) {
    for (let c of bar.top) { signals.add(c.kind) }
  }
  if (signals.size <= 1) { return true }
  return [...signals].every(kind => READING_KINDS.has(kind))
}

function barPercentile(bar, notedScores) {
  let sorted = [...notedScores].sort((a, b) => a - b)
  let rank = sorted.filter(s => s <= bar.score).length
  return sorted.length ? rank / sorted.length : 0
}

function buildRuns(scored, threshold) {
  let hot = scored.map(bar => bar.score >= threshold && bar.score > 0)
  let runs = []
  let current = null

  for (let i = 0; i < scored.length; i++) {
    if (hot[i]) {
      if (!current) { current = [] }
      current.push(scored[i])
    } else if (current) {
      // bridge a single cool bar between two hot bars
      if (hot[i + 1]) {
        current.push(scored[i])
      } else {
        runs.push(current)
        current = null
      }
    }
  }
  if (current) { runs.push(current) }

  return runs
}

// finds the flagged passages of an already-scored piece (see scoreBars).
// {repeats}: fingerprints.exactRepeats(fingerprint(song)), measure index ->
// earlier measure index, for merging exact repeats (decision 7).
export function findPassages(scored, {repeats} = {}) {
  let notedBars = scored.filter(bar => bar.density.notes > 0)
  if (notedBars.length < MIN_ANALYSIS_BARS) { return [] }

  let notedScores = notedBars.map(b => b.score)
  if (Math.max(...notedScores) <= median(notedScores) + 1e-9) { return [] }

  let hasLower = scored.some(bar => bar.hands.lower)
  let floorCount = Math.floor(notedBars.length / 4)
  let budget = Math.ceil(notedBars.length / 3)

  // the strictest threshold that flags at least floorCount bars, else the
  // one that flagged the most: a looser threshold whose runs the budget
  // drops wholesale must never lose the passages a stricter one found
  let result = []
  let mostFlagged = 0
  for (let pct of [0.7, 0.65, 0.6]) {
    let threshold = percentile(notedScores, pct)
    let candidate = passagesAtThreshold(scored, notedScores, threshold, budget)
    let flaggedBars = candidate.reduce((sum, p) => sum + p.run.length, 0)
    if (flaggedBars > mostFlagged) {
      mostFlagged = flaggedBars
      result = candidate
    }
    if (flaggedBars >= floorCount) { break }
  }

  let passages = result

  // hand and kinds
  passages = passages.map(p => ({
    ...p,
    hand: passageHand(p.run, hasLower),
    kinds: passageKinds(p.run),
  }))

  if (repeats && repeats.size) {
    passages = mergeRepeats(passages, repeats)
  }

  // Hardest and Hard together at most eight; weaker ones beyond eight
  // become Worth a look
  let ranked = passages.filter(p => p.level >= 2).sort((a, b) => b.strength - a.strength)
  ranked.slice(8).forEach(p => { p.level = 1 })

  return passages.sort((a, b) => b.strength - a.strength)
}

// the measure indices of a passage's bars, each as the index of the earliest
// bar with the same content (fingerprints.exactRepeats), so two passages of
// the same material carry the same indices however often it is written
function materialIndices(passage, repeats) {
  let out = new Set()
  for (let bar of passage.run) {
    if (!bar.indices) { continue }
    for (let idx of rangeIndices(bar)) {
      out.add(repeats.has(idx) ? repeats.get(idx) : idx)
    }
  }
  return out
}

function coversMaterial(outer, inner) {
  for (let idx of inner) {
    if (!outer.has(idx)) { return false }
  }
  return true
}

// the carrier's own bars whose material is the given one: the part of it
// that the dropped passage repeats, which is the whole of it for a
// whole-passage repeat
function recurringRange(carrier, material, repeats) {
  let numbers = []
  for (let bar of carrier.run) {
    if (!bar.indices) { continue }
    let recurs = rangeIndices(bar)
      .some(idx => material.has(repeats.has(idx) ? repeats.get(idx) : idx))
    if (recurs) { numbers.push(bar.number) }
  }
  return numbers.length ?
    [Math.min(...numbers), Math.max(...numbers)] : [carrier.start, carrier.end]
}

// repeated material is flagged once (decision 7): a passage whose bars all
// repeat the material of an earlier passage is dropped, and that passage
// keeps the recurrence as alsoAt — {bars} where it recurs, {of} the bars of
// the carrier that do, which a reason words as "also at" when it is the
// whole passage and "bars X–Y recur at" when it is only part of it. The
// match is on the material itself, never on where it was first written, so
// the first time it appears need not be flagged for the later copies to
// merge into one passage.
function mergeRepeats(passages, repeats) {
  let byStart = [...passages].sort((a, b) => a.startIndex - b.startIndex)
  let material = new Map(byStart.map(p => [p, materialIndices(p, repeats)]))
  let kept = []

  for (let p of byStart) {
    let mine = material.get(p)
    let carrier = mine.size ?
      byStart.find(other => coversMaterial(material.get(other), mine)) : p

    if (carrier == p) {
      kept.push(p)
    } else {
      carrier.alsoAt = [...(carrier.alsoAt || []), {
        bars: [p.start, p.end],
        of: recurringRange(carrier, mine, repeats),
      }]
    }
  }

  return kept
}

function rangeIndices(bar) {
  let [first, last] = bar.indices
  let out = []
  for (let i = first; i <= last; i++) { out.push(i) }
  return out
}

function passagesAtThreshold(scored, notedScores, threshold, budget) {
  let runs = buildRuns(scored, threshold)
  let split = runs.flatMap(splitRun)

  let candidates = split
    .filter(run => run.length > 1 || barPercentile(run[0], notedScores) >= 0.9)
    .map(run => {
      let str = strength(run)
      let peakPct = Math.max(...run.map(bar => barPercentile(bar, notedScores)))
      let restsOnOneSignal = runRestsOnOneSignal(run)
      return {
        run,
        start: run[0].number,
        end: run[run.length - 1].number,
        startIndex: run[0].indices[0],
        endIndex: run[run.length - 1].indices[1],
        strength: str,
        level: levelFor(peakPct, restsOnOneSignal),
      }
    })
    .sort((a, b) => b.strength - a.strength)

  let budgeted = []
  let flaggedBars = 0
  // keep the strongest passages first; when trimming to budget, Worth a
  // look passages are the first to go
  let ordered = [...candidates].sort((a, b) => {
    if (a.level != b.level) { return b.level - a.level }
    return b.strength - a.strength
  })

  for (let candidate of ordered) {
    let bars = candidate.run.length
    if (flaggedBars + bars > budget) { continue }
    budgeted.push(candidate)
    flaggedBars += bars
  }

  return budgeted
}
