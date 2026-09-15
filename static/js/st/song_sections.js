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

// group notes by quantized onset into pitch sorted, deduplicated columns.
// Each entry is [note, staff]; withStaves the column carries the staves as
// column.staves, one per note (the first of notes sharing a pitch)
function groupByOnset(entries, withStaves) {
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

    for (let [note, staff] of byOnset.get(key)) {
      let pitch = parseNote(note.note)
      if (seen.has(pitch)) { continue }
      seen.add(pitch)
      notes.push({pitch, name: note.note, staff})
    }

    notes.sort((a, b) => a.pitch - b.pitch)
    let column = notes.map(note => note.name)
    if (withStaves) {
      column.staves = notes.map(note => note.staff)
    }
    return column
  })
}

// song: MultiTrackSong (or any SongNoteList)
// opts.startMeasure, opts.endMeasure: inclusive measure range, numbered as
// in measureBeatRange
// opts.track: track index, or array of track indices, to keep, or
// null/undefined for all tracks
// opts.staves: when set, each column carries column.staves, the grand staff
// ("upper" or "lower", see staffTracks) each of its notes is written on
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
  } else if (opts.staves) {
    trackIndices = (song.tracks || []).map((track, idx) => idx)
  }

  let entries
  if (trackIndices) {
    let grand = opts.staves ? staffTracks(song) : null
    entries = trackIndices.flatMap(idx => {
      let staff = grand ? (grand.bass.includes(idx) ? "lower" : "upper") : null
      return [...((song.tracks && song.tracks[idx]) || [])].map(note => [note, staff])
    })
  } else {
    entries = [...song].map(note => [note, null])
  }

  let [startBeat, endBeat] = measureBeatRange(song, startMeasure, endMeasure)

  let inRange = entries.filter(([note]) =>
    note.start >= startBeat - ONSET_EPSILON / 2 &&
    note.start < endBeat - ONSET_EPSILON / 2
  )

  return groupByOnset(inRange, !!opts.staves)
}

// Drops notes that fall outside [min, max] pitch (note names), removing
// columns that become empty. Returns [columns, droppedCount].
export function filterColumnsToRange(columns, min, max) {
  let minPitch = parseNote(min)
  let maxPitch = parseNote(max)
  let dropped = 0

  let out = []
  for (let column of columns) {
    let keep = column.map(note => {
      let pitch = parseNote(note)
      let inRange = pitch >= minPitch && pitch <= maxPitch
      if (!inRange) { dropped++ }
      return inRange
    })

    let kept = column.filter((note, idx) => keep[idx])
    if (column.staves) {
      kept.staves = column.staves.filter((staff, idx) => keep[idx])
    }

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

// the clef sign of a track in effect at beat: its last clef entry starting
// by then, else the clef it opens with. null without clefs
function trackClefAt(track, beat) {
  let clefs = track && track.cleffs
  if (!Array.isArray(clefs) || !clefs.length) {
    return null
  }

  let current = null
  for (let clef of clefs) {
    if (clef[0] <= beat + ONSET_EPSILON / 2 && (!current || clef[0] >= current[0])) {
      current = clef
    }
  }

  return current ? current[1] : openingClef(track)
}

// The clef sign each staff of the grand staff is drawn in at beat, eg. the
// start of a measure: {upper, lower}, taken from the first track on
// that staff (see staffTracks), null for a staff without clefs
export function grandStaffClefs(song, beat) {
  let grand = staffTracks(song)
  let clefOf = tracks => tracks.length ? trackClefAt(song.tracks[tracks[0]], beat) : null
  return {upper: clefOf(grand.treble), lower: clefOf(grand.bass)}
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
