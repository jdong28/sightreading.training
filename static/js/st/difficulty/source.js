// Reads the handful of things the score analysis needs from a piece's stored
// source MusicXML that the song model drops on import: the tempo (st/musicxml
// never keeps one) and how many notes were written with a double accidental
// (the importer respells them to the nearest single-accidental enharmonic,
// st/musicxml's spellNote, so the song model can't say "a double sharp among
// them" on its own).
//
// Never throws: a piece may have no stored source, or the source may fail to
// parse, and neither should ever fail an import or a page.

import {NOTE_TYPES} from "st/note_values"

function childText(el, name) {
  for (let child of el.children) {
    if (child.localName == name) { return child.textContent.trim() }
  }
  return null
}

function childEl(el, name) {
  for (let child of el.children) {
    if (child.localName == name) { return child }
  }
  return null
}

function childEls(el, name) {
  return [...el.children].filter(child => child.localName == name)
}

// the first part's <measure> elements in document order, for either root
// layout, matching st/musicxml's collectParts
function firstPartMeasures(root) {
  if (root.localName == "score-partwise") {
    let partEl = childEl(root, "part")
    return partEl ? childEls(partEl, "measure") : []
  }

  if (root.localName == "score-timewise") {
    let measures = childEls(root, "measure")
    let firstId = null
    let out = []
    for (let measureEl of measures) {
      let partEl = childEl(measureEl, "part")
      if (!partEl) { continue }
      if (firstId == null) { firstId = partEl.getAttribute("id") }
      if (partEl.getAttribute("id") == firstId) { out.push(measureEl) }
    }
    return out
  }

  return []
}

const TEMPO_WORDS = [
  ["largo", 50], ["adagio", 66], ["andantino", 88], ["andante", 80],
  ["moderato", 100], ["allegretto", 108], ["allegro", 132],
  ["vivace", 156], ["presto", 168],
]

// a tempo word at the start of text (case-insensitive), eg. "Andantino
// sognando" -> 88; checked longest-first so "andantino" never matches as
// "andante"
function tempoFromWords(text) {
  let lower = text.trim().toLowerCase()
  let byLength = [...TEMPO_WORDS].sort((a, b) => b[0].length - a[0].length)
  for (let [word, bpm] of byLength) {
    if (lower.startsWith(word)) { return bpm }
  }
  return null
}

// <beat-unit> (+ an optional <beat-unit-dot>) -> quarter notes, eg. "quarter"
// -> 1, dotted "quarter" -> 1.5
function beatUnitBeats(metronomeEl) {
  let unit = childText(metronomeEl, "beat-unit")
  let beats = unit && NOTE_TYPES[unit] && NOTE_TYPES[unit].beats
  if (!beats) { return null }

  return childEl(metronomeEl, "beat-unit-dot") ? beats * 1.5 : beats
}

// the first explicit tempo marking only (never averaged, never the latest):
// a <metronome>, else the first <sound tempo>, else the first recognised
// tempo word. {bpm, from: "metronome" | "sound" | "words", text} or null.
function firstTempo(root) {
  for (let direction of root.getElementsByTagName("direction")) {
    for (let metronome of direction.getElementsByTagName("metronome")) {
      let unitBeats = beatUnitBeats(metronome)
      let perMinute = +(childText(metronome, "per-minute") || 0)
      if (unitBeats && perMinute > 0) {
        return {bpm: Math.round(perMinute * unitBeats), from: "metronome", text: null}
      }
    }
  }

  for (let direction of root.getElementsByTagName("direction")) {
    let sound = childEl(direction, "sound")
    let tempo = sound && +(sound.getAttribute("tempo") || 0)
    if (tempo > 0) {
      return {bpm: Math.round(tempo), from: "sound", text: null}
    }
  }

  for (let direction of root.getElementsByTagName("direction")) {
    for (let words of direction.getElementsByTagName("words")) {
      let text = words.textContent || ""
      let bpm = tempoFromWords(text)
      if (bpm != null) {
        return {bpm, from: "words", text: text.trim()}
      }
    }
  }

  return null
}

// notes per measure index (part 1's measure order, as measureNumbersFor
// counts) whose <pitch><alter> is a double sharp or flat
function doubleAccidentalsByMeasure(measures) {
  return measures.map(measureEl => {
    let count = 0
    for (let noteEl of childEls(measureEl, "note")) {
      let pitchEl = childEl(noteEl, "pitch")
      if (!pitchEl) { continue }
      let alter = Math.round(+(childText(pitchEl, "alter") || 0))
      if (Math.abs(alter) == 2) { count += 1 }
    }
    return count
  })
}

// {tempo, doubleAccidentals} from a piece's stored source MusicXML text, or
// {tempo: null, doubleAccidentals: []} for no source or one that can't be
// read. Never throws.
export function scoreExtras(musicXML) {
  if (typeof musicXML != "string" || !musicXML.trim()) {
    return {tempo: null, doubleAccidentals: []}
  }

  try {
    let doc = new DOMParser().parseFromString(musicXML, "application/xml")
    let root = doc.documentElement

    if (!root || root.localName == "parsererror" || doc.getElementsByTagName("parsererror").length) {
      return {tempo: null, doubleAccidentals: []}
    }

    let measures = firstPartMeasures(root)

    return {
      tempo: firstTempo(root),
      doubleAccidentals: doubleAccidentalsByMeasure(measures),
    }
  } catch (e) {
    return {tempo: null, doubleAccidentals: []}
  }
}
