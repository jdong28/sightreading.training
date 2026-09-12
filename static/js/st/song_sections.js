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

// beat range [start, end) covered by the inclusive 1-based measure range.
// Prefers explicit measure start beats when the song provides them (a later
// import task may set metadata.measureStarts), otherwise measures are
// uniform and sized by metadata.beatsPerMeasure.
export function measureBeatRange(song, startMeasure, endMeasure) {
  let starts = song.metadata && song.metadata.measureStarts

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
// opts.startMeasure, opts.endMeasure: 1-based inclusive measure range
// opts.track: track index to keep, or null/undefined for all tracks
// returns array of columns, each an ascending array of note names
export function extractSectionColumns(song, opts={}) {
  let startMeasure = Math.max(1, Math.floor(opts.startMeasure || 1))
  let endMeasure = Math.floor(opts.endMeasure == null ? Infinity : opts.endMeasure)

  if (endMeasure < startMeasure) {
    return []
  }

  let notes = song
  if (opts.track != null && opts.track !== "") {
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

// Parses song notation, caching the last result since the settings panel and
// the generator both need the same song. Returns {song} or {error}.
let lastParse = null

export function parseSongText(text) {
  if (lastParse && lastParse.text === text) {
    return lastParse.result
  }

  let result
  if (!text || !text.trim()) {
    result = {song: null, error: null}
  } else {
    try {
      result = {song: SongParser.load(text), error: null}
    } catch (e) {
      result = {song: null, error: e.message || String(e)}
    }
  }

  lastParse = {text, result}
  return result
}
