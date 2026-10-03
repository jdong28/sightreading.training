// Template-written text for a flagged passage (st/difficulty/sections.js):
// a title, up to three reasons naming concrete notes and bar numbers, and a
// practice tip. No Claude, no outside sources: every sentence comes from the
// score analysis alone.

import {parseNote, noteStaffOffset, displayNoteName, barsLabel} from "st/music"

const HAND_WORD = {upper: "right", lower: "left"}

const MAX_REASONS = 3

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// a one-staff piece (a melody) has no hand to name: its reasons and flags
// speak of the line instead
function handLabel(hand, ctx, capitalized=true) {
  if (ctx && ctx.singleStaff) { return capitalized ? "The line" : "the line" }
  let word = hand ? `${HAND_WORD[hand]} hand` : "both hands"
  return capitalized ? capitalize(word) : word
}

const ORDINALS = {
  1: "a unison", 2: "a second", 3: "a third", 4: "a fourth", 5: "a fifth",
  6: "a sixth", 7: "a seventh", 8: "an octave", 9: "a ninth", 10: "a tenth",
  11: "an eleventh", 12: "a twelfth", 13: "a thirteenth", 14: "a fourteenth",
}

const NUMBER_WORDS = [
  null, "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
]

function numberWord(n) {
  return NUMBER_WORDS[n] || String(n)
}

// the diatonic distance between two note names (letters only, accidentals
// ignored), eg. "a tenth" for G2-Bb3, "almost three octaves" for F1-Eb4
export function intervalWords(low, high) {
  let n = Math.abs(noteStaffOffset(high) - noteStaffOffset(low)) + 1

  if (n <= 14) { return ORDINALS[n] || `${n - 1} steps` }
  if (n == 15) { return "two octaves" }

  let whole = Math.floor((n - 1) / 7)
  let remainder = (n - 1) % 7

  if (remainder == 0) { return `${numberWord(whole)} octaves` }
  if (remainder >= 5) { return `almost ${numberWord(whole + 1)} octaves` }
  return `over ${numberWord(whole)} octaves`
}

function formatRate(value) {
  let rounded = Math.round(value * 10) / 10
  return rounded % 1 == 0 ? String(rounded) : rounded.toFixed(1)
}

function accidentalPhrase(fifths) {
  if (!fifths) { return null }
  let count = Math.abs(fifths)
  return `${numberWord(count)} ${fifths > 0 ? "sharp" : "flat"}${count > 1 ? "s" : ""}`
}

// the key signature itself, never a mode: the analysis never reads
// MusicXML's <mode>, so it can't tell a major key from its relative minor
function signatureName(fifths) {
  return accidentalPhrase(fifths) || "no sharps or flats"
}

function magnitudeOf(kind, detail) {
  if (detail == null || detail === false) { return 0 }
  if (kind == "density") { return detail.perSecond != null ? detail.perSecond : detail.perBeat }
  if (kind == "chromatic") { return detail.count }
  if (typeof detail == "number") { return detail }
  if (typeof detail == "object" && "semitones" in detail) { return detail.semitones }
  return 1
}

// the bar in run with the strongest raw value of kind (for hand, when it is
// a hand feature), for citing a concrete bar in its sentence
function winningBar(run, kind, hand) {
  let best = null
  for (let bar of run) {
    let source = hand ? bar.hands[hand] : bar
    if (!source) { continue }

    let magnitudeSource = source[kind]
    if (!magnitudeSource && magnitudeSource !== 0) { continue }

    // holdMove's count ranks the bar; its sentence reads the richer detail
    // (the held notes and direction) features.js keeps beside it
    let detail = kind == "holdMove" ? source.holdMoveDetail : magnitudeSource
    if (!detail) { continue }

    let magnitude = magnitudeOf(kind, magnitudeSource)
    if (!best || magnitude > best.magnitude) { best = {bar, detail, magnitude} }
  }
  return best
}

// a tempo guessed from a marking is named as the estimate it is; only a
// <metronome> or <sound tempo> is the score's own mark
function tempoPhrase(tempo) {
  if (!tempo) { return "" }
  let mark = `♩ = ${Math.round(tempo.bpm)}`
  if (tempo.from == "words") {
    return ` at ${capitalize(tempo.word)}, taken as ${mark}`
  }
  return ` at ${mark}`
}

function densitySentence(detail, bar, hand, ctx) {
  let unit = ctx.tempo ? "second" : "beat"
  let rate = formatRate(ctx.tempo ? detail.perSecond : detail.perBeat)
  let tempoSuffix = tempoPhrase(ctx.tempo)

  if (ctx.isDensest) {
    return `The densest writing in the piece, ${rate} notes a ${unit}${tempoSuffix} (bar ${bar.number}).`
  }
  return `Dense writing, ${rate} notes a ${unit}${tempoSuffix}.`
}

function sweepSentence(detail, bar, hand, ctx) {
  let low = null
  let high = null
  for (let b of ctx.passage.run) {
    let sweep = b.hands[hand] && b.hands[hand].sweep
    if (!sweep) { continue }
    if (!low || parseNote(sweep.low) < parseNote(low)) { low = sweep.low }
    if (!high || parseNote(sweep.high) > parseNote(high)) { high = sweep.high }
  }
  if (!low || !high) { return null }

  let passage = ctx.passage
  let range = passage.start == passage.end ? `bar ${passage.start}` : `bars ${passage.start}–${passage.end}`
  return `${handLabel(hand, ctx)} sweeps ${displayNoteName(low)} to ${displayNoteName(high)}, ` +
    `${intervalWords(low, high)}, in ${range}.`
}

function leapSentence(detail, bar, hand, ctx) {
  return `${handLabel(hand, ctx)} leaps ${intervalWords(detail.from, detail.to)}, ` +
    `${displayNoteName(detail.from)} to ${displayNoteName(detail.to)}, in bar ${bar.number}.`
}

function spanSentence(detail, bar, hand, ctx) {
  return `${handLabel(hand, ctx)}: ${intervalWords(detail.low, detail.high)} ` +
    `(${displayNoteName(detail.low)}–${displayNoteName(detail.high)}) in bar ${bar.number}.`
}

function reachSentence(detail, bar, hand, ctx) {
  return `${handLabel(hand, ctx)} reaches ${intervalWords(detail.low, detail.high)} within a beat in bar ${bar.number}.`
}

function chordSizeSentence(detail, bar, hand, ctx) {
  return `${handLabel(hand, ctx)} plays a ${detail}-note chord in bar ${bar.number}.`
}

function chromaticSentence(detail, bar) {
  let count = detail.count == 1 ? "One note" : `${detail.count} notes`
  let suffix = detail.hasDouble ? ", a double accidental among them" : ""
  return `${count} outside the key in bar ${bar.number}${suffix}.`
}

function ledgerSentence(detail, bar) {
  return `Notes reach far off the staff in bar ${bar.number}.`
}

function keyChangeSentence(detail, bar) {
  let name = signatureName(detail.fifths)
  if (detail.seenBefore) {
    return `The key signature turns back to ${name} at bar ${bar.number}.`
  }

  return `The key signature changes to ${name} at bar ${bar.number}.`
}

function remoteKeySentence(detail, bar) {
  return `A remote key signature in bar ${bar.number}.`
}

function timeChangeSentence(detail, bar) {
  return `The meter changes in bar ${bar.number}.`
}

function clefChangeSentence(detail, bar) {
  return `The clef changes in bar ${bar.number}.`
}

function polySentence(detail, bar) {
  return `Bar ${bar.number}: triplets in the ${HAND_WORD[detail.tuplet]} hand against the ` +
    `${HAND_WORD[detail.duple]} hand's eighths, three against two.`
}

function independenceSentence(detail, bar) {
  return `Bar ${bar.number}: the hands move independently, apart from each other.`
}

function crossingSentence(detail, bar) {
  return `The hands cross in bar ${bar.number}.`
}

function graceSentence(detail, bar) {
  return `Grace notes decorate bar ${bar.number}.`
}

function holdMoveSentence(detail, bar, hand, ctx) {
  let names = detail.heldNotes.map(displayNoteName)
  let namesStr = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]
  let pronoun = detail.heldNotes.length > 1 ? "them" : "it"
  return `${handLabel(hand, ctx)} holds ${namesStr} while it moves ${detail.above ? "above" : "below"} ${pronoun}.`
}

function heldSentence(detail, bar, hand, ctx) {
  let verb = detail.below ? "drops to" : "rises to"
  return `${handLabel(hand, ctx)} holds ${displayNoteName(detail.heldNote)} while it ${verb} ` +
    `${displayNoteName(detail.struckNote)}: the held notes need the pedal.`
}

function nearRepeatSentence(detail, bar) {
  return `Bar ${bar.number} nearly repeats bar ${detail.of}, but changes: a classic memory slip.`
}

// poly carries its own hands in {tuplet, duple}; "pedal" (held), "voicing"
// (holdMove) and the leap family read ctx.singleStaff through handLabel, so
// a one-staff piece's reasons never name a hand
const SENTENCES = {
  density: densitySentence,
  sweep: sweepSentence,
  leap: leapSentence,
  span: spanSentence,
  reach: reachSentence,
  chordSize: chordSizeSentence,
  chromatic: chromaticSentence,
  ledger: ledgerSentence,
  keyChange: keyChangeSentence,
  remoteKey: remoteKeySentence,
  timeChange: timeChangeSentence,
  clefChange: clefChangeSentence,
  poly: polySentence,
  independence: independenceSentence,
  crossing: crossingSentence,
  grace: graceSentence,
  holdMove: holdMoveSentence,
  held: heldSentence,
  nearRepeat: nearRepeatSentence,
}

const TITLES = {
  density: () => "The densest bars",
  sweep: (hand, ctx) => ctx.singleStaff ? "Wide sweeps" : `Wide sweeps in the ${HAND_WORD[hand]} hand`,
  leap: (hand, ctx) => ctx.singleStaff ? "Wide leaps" : `Wide leaps in the ${HAND_WORD[hand]} hand`,
  span: (hand, ctx) => ctx.singleStaff ? "A stretch" : `A stretch in the ${HAND_WORD[hand]} hand`,
  reach: (hand, ctx) => ctx.singleStaff ? "A wide reach" : `A wide reach in the ${HAND_WORD[hand]} hand`,
  chordSize: (hand, ctx) => ctx.singleStaff ? "Big chords" : `Big chords in the ${HAND_WORD[hand]} hand`,
  chromatic: () => "Chromatic reading",
  ledger: () => "Ledger lines",
  keyChange: () => "The key change",
  remoteKey: () => "A remote key",
  timeChange: () => "A change of meter",
  clefChange: () => "A clef change",
  poly: () => "Three against two",
  independence: () => "Hands apart",
  crossing: () => "Hands crossing",
  grace: () => "Ornaments",
  holdMove: (hand, ctx) => ctx.singleStaff ? "Hold and move" : `Hold and move in the ${HAND_WORD[hand]} hand`,
  held: () => "Held notes for the pedal",
  nearRepeat: () => "A near repeat",
}

const TIPS = {
  speed: () => "Slowly and evenly first, then bring it up to tempo in steps.",
  leaps: (hand, ctx) => (!ctx.singleStaff && (hand == "upper" || hand == "lower")) ?
    `${handLabel(hand, ctx)} alone and slowly, eyes on each landing note, then add the ` +
      `${HAND_WORD[hand == "upper" ? "lower" : "upper"]} hand.` :
    "Slowly and eyes on each landing note, then up to tempo.",
  stretch: () => "Roll the chord if it doesn't reach, landing on the top note.",
  "3:2": () => "Count the triplets against a spoken one-and-two-and, hands separately, then together slowly.",
  "two hands": () => "Hands separately until each is secure, then together slowly.",
  voicing: () => "Hold the long notes and keep the moving ones light, hands separately first.",
  pedal: () => "Catch the held notes in the pedal, then practise the move alone.",
  reading: () => "Name the accidentals and the key before you play it.",
  memory: (hand, ctx, nearRepeatDetail) => nearRepeatDetail && nearRepeatDetail.of ?
    `Play it beside bar ${nearRepeatDetail.of} and name what changes.` :
    "Play it beside the earlier bar and name what changes.",
}

// {total, kind, hand} for each signal that contributed to the passage's
// score, strongest first
export function rankedSignals(run) {
  let totals = new Map()
  for (let bar of run) {
    for (let c of bar.top) {
      let key = `${c.kind}|${c.hand || ""}`
      let existing = totals.get(key)
      if (existing) {
        existing.total += c.contribution
      } else {
        totals.set(key, {kind: c.kind, hand: c.hand, total: c.contribution})
      }
    }
  }
  return [...totals.values()].sort((a, b) => b.total - a.total)
}

// every range a passage recurs at, named in one sentence: "Also at bars
// 7–8, 13–14 and 19–20.", so none of them goes unsaid
function recurrenceSentence(ranges) {
  if (!ranges.length) { return null }
  if (ranges.length == 1) { return `Also at ${barsLabel(ranges[0][0], ranges[0][1])}.` }

  let parts = ranges.map(([from, to]) => from == to ? `${from}` : `${from}–${to}`)
  let last = parts.pop()
  return `Also at bars ${parts.join(", ")} and ${last}.`
}

// {title, reason, reasons, tip} for a passage (st/difficulty/sections.js),
// given the piece's tempo (st/difficulty/source.js) and the full scored bars
// (for "the piece's densest bar" and whether the piece has one staff)
export function passageReasons(passage, {tempo, bars} = {}) {
  let singleStaff = !bars.some(b => b.hands.lower)
  let ctx = {tempo, passage, singleStaff}

  let signals = rankedSignals(passage.run)
  let maxDensity = Math.max(0, ...bars.map(b =>
    tempo ? (b.density.perSecond || 0) : (b.density.perBeat || 0)))

  // up to three sentences, and a passage that recurs always ends with every
  // bar range it recurs at, so its own reasons give way to that rather than
  // crowd it out
  let recurrence = recurrenceSentence(passage.alsoAt || [])
  let maxSignals = recurrence ? MAX_REASONS - 1 : MAX_REASONS

  let reasons = []
  let leadDetail = null

  for (let signal of signals) {
    if (reasons.length >= maxSignals) { break }

    let sentenceFn = SENTENCES[signal.kind]
    if (!sentenceFn) { continue }

    if (signal.kind == "sweep") {
      let sentence = sweepSentence(null, null, signal.hand, ctx)
      if (!sentence) { continue }
      reasons.push(sentence)
      if (!leadDetail) { leadDetail = {kind: signal.kind, hand: signal.hand, detail: null} }
      continue
    }

    let found = winningBar(passage.run, signal.kind, signal.hand)
    if (!found) { continue }

    let isDensest = signal.kind == "density" &&
      magnitudeOf("density", found.detail) >= maxDensity - 1e-9
    let sentence = sentenceFn(found.detail, found.bar, signal.hand, {...ctx, isDensest})
    reasons.push(sentence)
    if (!leadDetail) { leadDetail = {kind: signal.kind, hand: signal.hand, detail: found.detail} }
  }

  let title = leadDetail ?
    (TITLES[leadDetail.kind] ? TITLES[leadDetail.kind](leadDetail.hand, ctx) : "A difficult passage") :
    "A difficult passage"

  if (recurrence) { reasons.push(recurrence) }

  let leadKind = passage.kinds[0]
  let tipFn = TIPS[leadKind] || TIPS.reading
  let nearRepeatDetail = leadDetail && leadDetail.kind == "nearRepeat" ? leadDetail.detail : null
  let tip = tipFn(passage.hand, ctx, nearRepeatDetail)

  return {
    title,
    reason: reasons.join(" "),
    reasons,
    tip,
  }
}
