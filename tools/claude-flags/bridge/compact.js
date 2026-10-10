// The compact score and the user message (COMPACT_VERSION 1): what Claude is
// sent for a piece. Built from the song as the app stores it, so the bar
// numbers Claude reads are the ones the app's own passages use.

import {noteName, parseNote} from "st/music"
import {measureNumbers, measureNumberList, staffTracks} from "st/song_sections"
import {scoreExtras} from "st/difficulty/source"
import {LEVEL_WORDS} from "st/difficulty/index"
import {KIND_WORDS} from "st/difficulty/decisions"

const EPSILON = 1e-6

// "Eb major or C minor" for a key signature in fifths, or null past 7
const MAJOR_KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"]
const MINOR_KEYS = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"]

export function keyWords(fifths) {
  if (!Number.isInteger(fifths) || Math.abs(fifths) > 7) { return `a key signature of ${fifths} fifths` }
  return `${MAJOR_KEYS[fifths + 7]} major or ${MINOR_KEYS[fifths + 7]} minor`
}

const round3 = value => Math.round(value * 1000) / 1000
const beatsText = value => String(round3(value))

function childEls(el, name) {
  return [...el.children].filter(child => child.localName == name)
}

// the first part's <measure> elements in document order, for either root
// layout (the same pick st/difficulty/source makes)
function firstPartMeasures(root) {
  if (root.localName == "score-partwise") {
    let partEl = childEls(root, "part")[0]
    return partEl ? childEls(partEl, "measure") : []
  }

  if (root.localName == "score-timewise") {
    let firstId = null
    let out = []
    for (let measureEl of childEls(root, "measure")) {
      let partEl = childEls(measureEl, "part")[0]
      if (!partEl) { continue }
      if (firstId == null) { firstId = partEl.getAttribute("id") }
      if (partEl.getAttribute("id") == firstId) { out.push(measureEl) }
    }
    return out
  }

  return []
}

function sourceRoot(source) {
  if (typeof source != "string" || !source.trim()) { return null }

  try {
    let doc = new DOMParser().parseFromString(source, "application/xml")
    let root = doc.documentElement
    if (!root || root.localName == "parsererror" || doc.getElementsByTagName("parsererror").length) { return null }
    return root
  } catch (e) {
    return null
  }
}

// the composer the file names, or null
export function composerOf(source) {
  let root = sourceRoot(source)
  if (!root) { return null }

  for (let creator of root.getElementsByTagName("creator")) {
    if ((creator.getAttribute("type") || "").toLowerCase() == "composer") {
      let name = (creator.textContent || "").replace(/\s+/g, " ").trim()
      if (name) { return name }
    }
  }
  return null
}

function cleanWords(text) {
  let words = text.replace(/\s+/g, " ").replace(/"/g, "'").trim()
  return words.length > 40 ? `${words.slice(0, 39)}…` : words
}

// the score's words, dynamics and pedal marks per measure index, from the
// first part's <measure> elements, or null when their count isn't the
// song's (st/difficulty/source makes the same index-for-index assumption)
export function barMarks(source, measureCount) {
  let root = sourceRoot(source)
  if (!root) { return null }

  let measures = firstPartMeasures(root)
  if (measures.length != measureCount) { return null }

  return measures.map(measureEl => {
    let marks = []
    for (let direction of childEls(measureEl, "direction")) {
      for (let type of childEls(direction, "direction-type")) {
        for (let child of type.children) {
          if (child.localName == "words") {
            let words = cleanWords(child.textContent || "")
            if (words) { marks.push(`"${words}"`) }
          } else if (child.localName == "dynamics") {
            for (let dynamic of child.children) { marks.push(dynamic.localName) }
          } else if (child.localName == "pedal") {
            let kind = child.getAttribute("type")
            if (kind == "start") { marks.push("ped") }
            else if (kind == "stop") { marks.push("*") }
            else if (kind == "change") { marks.push("*ped") }
          } else if (child.localName == "wedge") {
            let kind = child.getAttribute("type")
            if (kind == "crescendo") { marks.push("cresc") }
            else if (kind == "diminuendo") { marks.push("dim") }
          }
        }
      }
    }
    return marks
  })
}

// how long each measure index is, in quarter-note beats
function barLengths(song, starts) {
  let md = song.metadata || {}
  return starts.map((start, idx) => {
    if (idx + 1 < starts.length) { return starts[idx + 1] - start }
    if (typeof md.measuresEnd == "number" && md.measuresEnd > start) { return md.measuresEnd - start }
    return md.beatsPerMeasure || 4
  })
}

// each hand's notes with the song's own pitch, in score order
function handNotes(song, trackIndices) {
  let notes = []
  for (let trackIdx of trackIndices) {
    for (let note of (song.tracks[trackIdx] || [])) {
      notes.push({
        pitch: parseNote(note.note), start: note.start, duration: note.duration,
        tuplet: !!(note.notation && note.notation.tuplet && note.notation.tuplet != 1),
        graces: (note.ornaments && note.ornaments.graces) || [],
        ornamented: !!(note.ornaments && note.ornaments.neighbours && note.ornaments.neighbours.length),
      })
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return notes
}

// the clef sign a hand has at each beat it changes, from its tracks' cleffs
function clefChanges(song, trackIndices) {
  let changes = []
  let last = null
  let all = []
  for (let trackIdx of trackIndices) {
    for (let [beat, sign] of ((song.tracks[trackIdx] || {}).cleffs || [])) { all.push([beat, sign]) }
  }
  all.sort((a, b) => a[0] - b[0])
  for (let [beat, sign] of all) {
    if (last != null && sign != last) { changes.push({beat, sign}) }
    last = sign
  }
  return changes
}

// one hand's events in one bar: "onset:pitch/duration", "+" joining the
// notes struck together. A chord whose notes last equally shows the one
// duration at the end (1:C4+E4+G4/2), else every note its own (1:C4/2+E4/1)
function barEvents(notes, start, end, flats) {
  let inBar = notes.filter(note => note.start >= start - EPSILON && note.start < end - EPSILON)
  let events = []
  let idx = 0

  while (idx < inBar.length) {
    let first = inBar[idx]
    let chord = [first]
    idx++
    while (idx < inBar.length && Math.abs(inBar[idx].start - first.start) < EPSILON) { chord.push(inBar[idx]); idx++ }

    let equal = chord.every(note => Math.abs(note.duration - first.duration) < EPSILON)
    let tail = note => `${note.tuplet ? "t" : ""}${note.start + note.duration > end + EPSILON ? "~" : ""}${note.ornamented ? "tr" : ""}`
    let name = note => `${note.graces.length ? `gr(${note.graces.join(",")})` : ""}${noteName(note.pitch, !flats)}`

    let text
    if (equal) {
      let marks = chord.map(tail).join("")
      text = `${chord.map(name).join("+")}/${beatsText(first.duration)}${marks}`
    } else {
      text = chord.map(note => `${name(note)}/${beatsText(note.duration)}${tail(note)}`).join("+")
    }
    events.push(`${beatsText(first.start - start)}:${text}`)
  }

  return events
}

/**
 * The compact text of a song's bars (Appendix F of the plan): one "m<number>"
 * line per measure index, with its marks, then a line per hand.
 * @param {Object} opts {song, source}
 * @returns {{text: string, marksKnown: boolean, numbers: number[], metre: number, bars: number}}
 */
export function compactScore({song, source}) {
  let md = song.metadata || {}
  let starts = md.measureStarts || []
  let printed = measureNumbers(song) || starts.map((_, idx) => idx + 1)
  let keys = md.measureKeySignatures || starts.map(() => md.keySignature || 0)
  let lengths = barLengths(song, starts)
  let hands = staffTracks(song)
  let right = handNotes(song, hands.treble)
  let left = handNotes(song, hands.bass)
  let rightClefs = clefChanges(song, hands.treble)
  let leftClefs = clefChanges(song, hands.bass)
  let marks = barMarks(source, starts.length)

  // the metre of the first full bar, so a pickup shows as the short bar it is
  let pickup = printed[0] == 0
  let metre = lengths[pickup && lengths.length > 1 ? 1 : 0] || md.beatsPerMeasure || 4

  let lines = []
  let prevLen = metre
  let prevKey = keys[0]
  let seen = new Set()

  starts.forEach((start, idx) => {
    let number = printed[idx]
    let end = start + lengths[idx]
    let split = seen.has(number)
    seen.add(number)

    let head = [`m${number}${split ? "'" : ""}`]
    if (idx > 0 && keys[idx] != prevKey) { head.push(`key=${keys[idx]}`) }
    if (Math.abs(lengths[idx] - prevLen) > EPSILON) { head.push(`len=${beatsText(lengths[idx])}`) }

    let clefs = []
    let rightChange = rightClefs.filter(change => change.beat >= start - EPSILON && change.beat < end - EPSILON).pop()
    let leftChange = leftClefs.filter(change => change.beat >= start - EPSILON && change.beat < end - EPSILON).pop()
    if (rightChange) { clefs.push(`R=${rightChange.sign}`) }
    if (leftChange) { clefs.push(`L=${leftChange.sign}`) }
    if (clefs.length) { head.push(`clef ${clefs.join(" ")}`) }

    if (marks && marks[idx].length) { head.push(marks[idx].join(" ")) }
    lines.push(head.join(" "))

    let flats = keys[idx] < 0
    let rightEvents = barEvents(right, start, end, flats)
    let leftEvents = barEvents(left, start, end, flats)
    lines.push(`R: ${rightEvents.length ? rightEvents.join(" ") : "-"}`)
    lines.push(`L: ${leftEvents.length ? leftEvents.join(" ") : "-"}`)

    prevLen = lengths[idx]
    prevKey = keys[idx]
  })

  return {
    text: lines.join("\n"),
    marksKnown: !!marks,
    numbers: measureNumberList(song),
    metre,
    bars: measureNumberList(song).length,
  }
}

const HAND_WORDS = {both: "both hands", upper: "right hand", lower: "left hand"}

function rangeWords(numbers) {
  let out = []
  let idx = 0
  while (idx < numbers.length) {
    let end = idx
    while (end + 1 < numbers.length && numbers[end + 1] == numbers[end] + 1) { end++ }
    out.push(end == idx ? `${numbers[idx]}` : `${numbers[idx]}–${numbers[end]}`)
    idx = end + 1
  }
  return out.join(", ")
}

// the app's own flags and its hardest bars, as the user message states them
export function analysisText(analysis, numbers) {
  let proposals = [...analysis.proposals].sort((a, b) =>
    b.level - a.level || (b.strength || 0) - (a.strength || 0) || a.start - b.start)

  let lines = proposals.length ? proposals.map(p => {
    let range = p.start == p.end ? `bar ${p.start}` : `bars ${p.start}–${p.end}`
    let kinds = p.kinds.map(kind => KIND_WORDS[kind] || kind).join(", ")
    return `- ${range}, ${LEVEL_WORDS[p.level].toLowerCase()}, ${HAND_WORDS[p.hand]}: ${kinds}. ${p.reasons.join(" ")}`
  }) : ["- none"]

  let heat = (analysis.runs.score && analysis.runs.score.heat) || []
  let hardest = numbers.filter((_, idx) => (heat[idx] || 0) >= 0.75)
  lines.push(`Its hardest bars (top quarter by its per-bar score): ${hardest.length ? rangeWords(hardest) : "none"}`)
  return lines.join("\n")
}

const SCORE_RULES =
  "\"m<number>\" starts a bar; its line also shows a key change (key=<fifths>), a new bar length " +
  "(len=<beats>), a clef change (clef R=g L=f), and the score's words, dynamics and pedal marks " +
  "(ped / *). Then one line per hand: \"R:\" the upper staff, \"L:\" the lower. Each event is " +
  "onset:pitch/duration in quarter-note beats from the start of the bar; \"+\" joins notes struck " +
  "together (a chord whose notes last equally shows one duration at the end, C4+E4+G4/2; otherwise " +
  "each note shows its own); \"t\" marks a tuplet note; \"~\" a note tied over the bar line (it sounds " +
  "on into the next bar without being struck again); \"gr(C5,D5)\" grace notes before a note; \"tr\" a " +
  "trill, turn or mordent. A bar split in two by a repeat prints as m12 and m12'."

/**
 * The whole user message for a piece.
 * @param {Object} opts {title, composer, fileName, compact, analysis, source, web}
 * @returns {string}
 */
export function userMessage({title, composer, fileName, song, compact, analysis, source, web}) {
  let md = song.metadata || {}
  let numbers = compact.numbers
  let first = numbers[0]
  let last = numbers[numbers.length - 1]
  let keys = md.measureKeySignatures
  let fifths = keys && keys.length ? keys[0] : (md.keySignature || 0)

  let tempo = scoreExtras(source).tempo
  let tempoText = "not marked"
  if (tempo) {
    tempoText = tempo.from == "words" ?
      `"${tempo.word}", about ♩ = ${tempo.bpm} (a guess from the word)` : `♩ = ${tempo.bpm}`
  }

  let header = [
    `# ${title}`,
    `Composer: ${composer || "unknown"}. File: ${fileName || "unknown"}.`,
    `Bars ${first}–${last} (${compact.bars} bars${first == 0 ? "; bar 0 is a pickup" : ""}). ` +
      `Key: ${keyWords(fifths)} (${fifths} fifths). ` +
      `Metre: ${beatsText(compact.metre)} quarter-note beats a bar. Tempo: ${tempoText}.` +
      (compact.marksKnown ? "" : " The score's words, dynamics and pedal marks are not shown for this piece."),
  ]

  let parts = [
    header.join("\n"),
    `## The score\n${SCORE_RULES}\n${compact.text}`,
    `## The app's score analysis\nIts flags, hardest first:\n${analysisText(analysis, numbers)}`,
  ]
  if (!web) { parts.push("Web tools are off for this run: give no citations.") }
  return `${parts.join("\n\n")}\n`
}
