// Extracts a section of a song as a list of "flashcard" columns for the
// sight reading staff. Detection drops rhythm: notes that start on the same
// beat become one chord column, columns are ordered by onset, and a tied note
// is one column, never two.
//
// The columns of an imported piece also carry the score's rhythm: the beat
// each column falls on, the notated value of each of its notes, and the rests
// and tied continuation heads between it and the next column, which an
// engine's card joins its drawn heads by (st/score_render/card_join). None of
// it is ever matched against what is played.

import {parseNote} from "st/music"
import SongParser from "st/song_parser"

// onsets closer than this (in beats) are treated as simultaneous so floating
// point error from time scaling never splits a chord into two columns
export const ONSET_EPSILON = 1 / 32

// beats per measure fall back to 4 when the song carries no metadata
const DEFAULT_BEATS_PER_MEASURE = 4

function beatsPerMeasure(song) {
  let bpm = song.metadata && song.metadata.beatsPerMeasure
  return bpm > 0 ? bpm : DEFAULT_BEATS_PER_MEASURE
}

// the score's bar number for each entry of metadata.measureStarts (imported
// MusicXML sets both, see parseMusicXML), or null to number measures from 1
function measureNumbers(song) {
  let starts = song.metadata && song.metadata.measureStarts
  let numbers = song.metadata && song.metadata.measureNumbers

  if (Array.isArray(starts) && Array.isArray(numbers) &&
      starts.length && numbers.length == starts.length) {
    return numbers
  }

  return null
}

// the distinct measure numbers of the song in score order, eg. [0, 1, 2] for
// a score opening with a pickup
export function measureNumberList(song) {
  let numbers = measureNumbers(song)
  if (numbers) {
    return [...new Set(numbers)]
  }

  return Array.from({length: countMeasures(song)}, (_, idx) => idx + 1)
}

// [first, last] measure numbers of the song. Scores that open with a pickup
// start at measure 0, like the numbers printed on the score.
export function measureNumberRange(song) {
  let numbers = measureNumbers(song)
  if (numbers) {
    return [numbers[0], numbers[numbers.length - 1]]
  }

  return [1, countMeasures(song)]
}

// the score's key signature in fifths at the given measure number, from
// metadata.measureKeySignatures (imported MusicXML); null for a song without
// them, eg. a piece imported before they were recorded
export function measureKeySignature(song, measure) {
  let keys = song.metadata && song.metadata.measureKeySignatures
  let numbers = measureNumbers(song)

  if (!numbers || !Array.isArray(keys) || keys.length != numbers.length) {
    return null
  }

  let idx = numbers.findIndex(n => n >= measure)
  return keys[idx < 0 ? keys.length - 1 : idx]
}

// beat range [start, end) covered by the inclusive measure range. Measures
// are numbered by the score's bar numbers when the song has them, otherwise
// from 1. Prefers explicit measure start beats when the song provides them
// (metadata.measureStarts, set by the MusicXML import), otherwise measures
// are uniform and sized by metadata.beatsPerMeasure.
export function measureBeatRange(song, startMeasure, endMeasure) {
  let starts = song.metadata && song.metadata.measureStarts
  let numbers = measureNumbers(song)

  if (numbers) {
    let startIdx = numbers.findIndex(n => n >= startMeasure)
    let endIdx = numbers.findIndex(n => n > endMeasure)
    return [
      startIdx < 0 ? Infinity : starts[startIdx],
      endIdx < 0 ? Infinity : starts[endIdx],
    ]
  }

  if (Array.isArray(starts) && starts.length) {
    let startBeat = startMeasure - 1 < starts.length ?
      starts[startMeasure - 1] : Infinity
    let endBeat = endMeasure < starts.length ? starts[endMeasure] : Infinity
    return [startBeat, endBeat]
  }

  let size = beatsPerMeasure(song)
  return [(startMeasure - 1) * size, endMeasure * size]
}

// number of measures in the song, counting a trailing partial measure
export function countMeasures(song) {
  let starts = song.metadata && song.metadata.measureStarts
  if (Array.isArray(starts) && starts.length) {
    return starts.length
  }

  if (!song.length) {
    return 0
  }

  return Math.max(1, Math.ceil(song.getStopInBeats() / beatsPerMeasure(song) - ONSET_EPSILON))
}

// What the staff draws a note with, from the notation the importer kept on it
// (st/musicxml), with the beat of the head its tie runs on to, if any
function noteNotation(note) {
  let notation = note.notation
  if (!notation) { return null }

  let next = notation.ties && notation.ties[0]

  return {
    type: notation.type,
    dots: notation.dots || 0,
    voice: notation.voice || null,
    tuplet: notation.tuplet || 1,
    tieTo: next ? next.start : null,
  }
}

// A head the staff draws though nothing is played for it: a note another
// voice already put in the column, or one a tie runs on to
function drawnHead(note, staff, extra) {
  return {kind: "head", name: note.note, staff, ...noteNotation(note), ...extra}
}

// The heads a note's ties run on to, which are drawn but never played: one
// entry per continuation, each tied to the one before it
function tieHeads(note, staff) {
  let ties = (note.notation && note.notation.ties) || []

  let notation = note.notation || {}

  return ties.map((tie, idx) => ({
    kind: "head",
    beat: tie.start,
    name: note.note,
    staff,
    type: tie.type,
    dots: tie.dots || 0,
    // a tie's continuation is the same voice, drawn the same way, as the note
    // it runs from, which is all the score writes on it
    voice: notation.voice || null,
    tuplet: notation.tuplet || 1,
    from: idx == 0 ? note.start : ties[idx - 1].start,
    tieTo: ties[idx + 1] ? ties[idx + 1].start : null,
  }))
}

// group notes by quantized onset into pitch sorted, deduplicated columns.
// Each entry is [note, staff]; given withNotation, when the notes carry the
// score's notation the column also carries column.beat, the beat it falls on,
// column.notation, what each of its notes is drawn as, and column.extras
function groupByOnset(entries, withNotation) {
  let byOnset = new Map()

  for (let entry of entries) {
    let key = Math.round(entry[0].start / ONSET_EPSILON)
    if (!byOnset.has(key)) {
      byOnset.set(key, [])
    }
    byOnset.get(key).push(entry)
  }

  let keys = [...byOnset.keys()].sort((a, b) => a - b)

  return keys.map(key => {
    let seen = new Set()
    let notes = []

    // a pitch sounded by two voices at once is one column to play, but the
    // score writes each voice's note, so the other is drawn beside it
    let doubled = []

    for (let [note, staff] of byOnset.get(key)) {
      let pitch = parseNote(note.note)
      if (seen.has(pitch)) {
        if (note.notation) {
          doubled.push(drawnHead(note, staff, {beat: note.start}))
        }
        continue
      }
      seen.add(pitch)
      notes.push({pitch, name: note.note, notation: noteNotation(note)})
    }

    notes.sort((a, b) => a.pitch - b.pitch)
    let column = notes.map(note => note.name)
    let beat = byOnset.get(key)[0][0].start

    if (withNotation && notes.some(note => note.notation)) {
      column.beat = beat
      column.notation = notes.map(note => note.notation)
      column.extras = doubled
    }

    return column
  })
}

// Hands each of extras to the column it is drawn after, the last one starting
// at or before it; anything before the first column goes to it, drawn in the
// room before its head. Extras are in beat order and stay that way
function attachExtras(columns, extras) {
  let drawn = columns.filter(column => column.extras)
  if (!drawn.length) { return columns }

  for (let extra of [...extras].sort((a, b) => a.beat - b.beat)) {
    let idx = 0
    while (idx + 1 < drawn.length && drawn[idx + 1].beat <= extra.beat + ONSET_EPSILON / 2) {
      idx += 1
    }
    drawn[idx].extras.push(extra)
  }

  return columns
}

// song: MultiTrackSong (or any SongNoteList)
// opts.startMeasure, opts.endMeasure: inclusive measure range, numbered as
// in measureBeatRange
// opts.track: track index, or array of track indices, to keep, or
// null/undefined for all tracks
// opts.notation: when set, the columns of notes carrying the score's notation
// carry column.beat, column.notation and column.extras, the rests and tied
// continuation heads drawn after them, each on the grand staff ("upper" or
// "lower", see staffTracks) it is written on
// returns array of columns, each an ascending array of note names
export function extractSectionColumns(song, opts={}) {
  let [firstMeasure] = measureNumberRange(song)
  let startMeasure = Math.max(firstMeasure, Math.floor(opts.startMeasure == null ? firstMeasure : opts.startMeasure) || 0)
  let endMeasure = Math.floor(opts.endMeasure == null ? Infinity : opts.endMeasure)

  if (endMeasure < startMeasure) {
    return []
  }

  let trackIndices = null
  if (Array.isArray(opts.track)) {
    trackIndices = opts.track
  } else if (opts.track != null && opts.track !== "") {
    trackIndices = [opts.track]
  } else if (opts.notation) {
    trackIndices = (song.tracks || []).map((track, idx) => idx)
  }

  let grand = opts.notation ? staffTracks(song) : null

  let entries
  if (trackIndices) {
    entries = trackIndices.flatMap(idx => {
      let staff = grand ? (grand.bass.includes(idx) ? "lower" : "upper") : null
      return [...((song.tracks && song.tracks[idx]) || [])].map(note => [note, staff])
    })
  } else {
    entries = [...song].map(note => [note, null])
  }

  let [startBeat, endBeat] = measureBeatRange(song, startMeasure, endMeasure)

  let inBeatRange = beat =>
    beat >= startBeat - ONSET_EPSILON / 2 && beat < endBeat - ONSET_EPSILON / 2

  let inRange = entries.filter(([note]) => inBeatRange(note.start))

  let columns = groupByOnset(inRange, !!grand)

  if (!grand) {
    return columns
  }

  // The heads a tie runs on to are drawn wherever they fall, even when the
  // note they are tied from is in an earlier measure of the piece, so they
  // are collected from every note of the tracks rather than from the range
  let extras = entries
    .flatMap(([note, staff]) => tieHeads(note, staff))
    .filter(head => inBeatRange(head.beat))

  for (let idx of trackIndices) {
    let track = (song.tracks && song.tracks[idx]) || []
    let staff = grand.bass.includes(idx) ? "lower" : "upper"

    for (let rest of track.rests || []) {
      // rests the score hides (a voice's padding) are not drawn
      if (rest.hidden || !inBeatRange(rest.start)) { continue }
      extras.push({kind: "rest", beat: rest.start, staff, ...rest})
    }
  }

  return attachExtras(columns, extras)
}

// Drops notes that fall outside [min, max] pitch (note names), removing
// columns that become empty. Returns [columns, droppedCount].
export function filterColumnsToRange(columns, min, max) {
  let minPitch = parseNote(min)
  let maxPitch = parseNote(max)
  let dropped = 0

  let out = []
  // the extras of columns dropped whole, drawn with the next column kept
  let carried = []

  for (let column of columns) {
    let keep = column.map(note => {
      let pitch = parseNote(note)
      let inRange = pitch >= minPitch && pitch <= maxPitch
      if (!inRange) { dropped++ }
      return inRange
    })

    let kept = column.filter((note, idx) => keep[idx])
    if (column.notation) {
      kept.beat = column.beat
      kept.notation = column.notation.filter((notation, idx) => keep[idx])
      // a tied head of a note the staff can't show goes with it
      kept.extras = [...carried, ...(column.extras || [])].filter(extra => {
        if (extra.kind != "head") { return true }
        let pitch = parseNote(extra.name)
        return pitch >= minPitch && pitch <= maxPitch
      })
    }

    if (kept.length) {
      carried = []
      out.push(kept)
    } else {
      carried = kept.extras || []
    }
  }

  // the extras of a last column dropped whole go with the column before it,
  // where they are drawn after its onset, rather than being lost with it
  if (carried.length && out.length) {
    let last = out[out.length - 1]
    last.extras = [...(last.extras || []), ...carried]
  }

  return [out, dropped]
}

// the clef sign ("g", "f", "c") a track opens with, or null without clefs
function openingClef(track) {
  let clefs = track && track.cleffs
  if (!Array.isArray(clefs) || !clefs.length) {
    return null
  }

  let [, sign] = clefs.reduce((first, clef) => clef[0] < first[0] ? clef : first)
  return sign
}

// Splits the song's tracks into the staves of a grand staff:
// {treble: [trackIdx...], bass: [trackIdx...]}. A track goes by the clef it
// opens with; a track without a treble or bass clef goes by track order,
// the first track with notes to the treble staff and the rest to the bass.
// When the clefs put every track on one staff (eg. both staves of a piano
// part opening in treble clef), all tracks go by track order.
export function staffTracks(song) {
  let out = {treble: [], bass: []}
  let byOrder = {treble: [], bass: []}

  let tracks = song.tracks || []
  tracks.forEach((track, idx) => {
    if (!track || !track.length) { return }

    let orderStaff = byOrder.treble.length ? "bass" : "treble"
    byOrder[orderStaff].push(idx)

    let clef = openingClef(track)
    if (clef == "g") {
      out.treble.push(idx)
    } else if (clef == "f") {
      out.bass.push(idx)
    } else {
      out[orderStaff].push(idx)
    }
  })

  if (byOrder.bass.length && (!out.treble.length || !out.bass.length)) {
    return byOrder
  }

  return out
}

class NoAutoChords {
  addChords() {}
}

// Parses song notation. Returns {song} or {error}.
export function parseSongText(text) {
  if (!text || !text.trim()) {
    return {song: null, error: null}
  }

  try {
    return {song: SongParser.load(text, {autoChords: NoAutoChords}), error: null}
  } catch (e) {
    return {song: null, error: e.message || String(e)}
  }
}
