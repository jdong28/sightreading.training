// Extracts a section of a song as a list of "flashcard" columns for the
// sight reading staff. Rhythm is dropped: notes that start on the same beat
// become one chord column, and columns are ordered by onset.

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

// [first, last] measure numbers of the song. Scores that open with a pickup
// start at measure 0, like the numbers printed on the score.
export function measureNumberRange(song) {
  let numbers = measureNumbers(song)
  if (numbers) {
    return [numbers[0], numbers[numbers.length - 1]]
  }

  return [1, countMeasures(song)]
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

// group notes by quantized onset into pitch sorted, deduplicated columns
function groupByOnset(notes) {
  let byOnset = new Map()

  for (let note of notes) {
    let key = Math.round(note.start / ONSET_EPSILON)
    if (!byOnset.has(key)) {
      byOnset.set(key, [])
    }
    byOnset.get(key).push(note)
  }

  let keys = [...byOnset.keys()].sort((a, b) => a - b)

  return keys.map(key => {
    let seen = new Set()
    let column = []

    for (let note of byOnset.get(key)) {
      let pitch = parseNote(note.note)
      if (seen.has(pitch)) { continue }
      seen.add(pitch)
      column.push([pitch, note.note])
    }

    column.sort(([a], [b]) => a - b)
    return column.map(([, name]) => name)
  })
}

// song: MultiTrackSong (or any SongNoteList)
// opts.startMeasure, opts.endMeasure: inclusive measure range, numbered as
// in measureBeatRange
// opts.track: track index, or array of track indices, to keep, or
// null/undefined for all tracks
// returns array of columns, each an ascending array of note names
export function extractSectionColumns(song, opts={}) {
  let [firstMeasure] = measureNumberRange(song)
  let startMeasure = Math.max(firstMeasure, Math.floor(opts.startMeasure == null ? firstMeasure : opts.startMeasure) || 0)
  let endMeasure = Math.floor(opts.endMeasure == null ? Infinity : opts.endMeasure)

  if (endMeasure < startMeasure) {
    return []
  }

  let notes = song
  if (Array.isArray(opts.track)) {
    notes = opts.track.flatMap(idx => [...((song.tracks && song.tracks[idx]) || [])])
  } else if (opts.track != null && opts.track !== "") {
    notes = (song.tracks && song.tracks[opts.track]) || []
  }

  let [startBeat, endBeat] = measureBeatRange(song, startMeasure, endMeasure)

  let inRange = [...notes].filter(note =>
    note.start >= startBeat - ONSET_EPSILON / 2 &&
    note.start < endBeat - ONSET_EPSILON / 2
  )

  return groupByOnset(inRange)
}

// Drops notes that fall outside [min, max] pitch (note names), removing
// columns that become empty. Returns [columns, droppedCount].
export function filterColumnsToRange(columns, min, max) {
  let minPitch = parseNote(min)
  let maxPitch = parseNote(max)
  let dropped = 0

  let out = []
  for (let column of columns) {
    let kept = column.filter(note => {
      let pitch = parseNote(note)
      let inRange = pitch >= minPitch && pitch <= maxPitch
      if (!inRange) { dropped++ }
      return inRange
    })

    if (kept.length) {
      out.push(kept)
    }
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
export function staffTracks(song) {
  let out = {treble: [], bass: []}
  let position = 0

  let tracks = song.tracks || []
  tracks.forEach((track, idx) => {
    if (!track || !track.length) { return }

    let clef = openingClef(track)
    if (clef == "g") {
      out.treble.push(idx)
    } else if (clef == "f") {
      out.bass.push(idx)
    } else {
      out[position == 0 ? "treble" : "bass"].push(idx)
    }

    position += 1
  })

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
