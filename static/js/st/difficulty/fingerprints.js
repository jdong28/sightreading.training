// Fingerprints a song's bars so a flagged passage survives a re-import of
// the same score (st/difficulty/index.js checks annotationStale against
// these) and so repeated material is flagged once (exactRepeats).
//
// A fingerprint never depends on anything but the song model: no Date.now(),
// no Math.random(), and onsets are rounded before hashing so floating point
// error from time scaling can never change a bar's hash between two reads of
// the same score.

import {parseNote} from "st/music"
import {staffTracks} from "st/song_sections"

export const FINGERPRINT_ALGO = 1

// onsets round to the nearest 1/48 beat (triplet sixteenths and dotted
// thirty-seconds both land exactly), so two notes the importer places a hair
// apart by floating point error hash the same
const ONSET_ROUNDING = 48

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

// FNV-1a, 8 lowercase hex chars. Synchronous (no crypto API), so the import
// path never awaits it.
export function hash8(text) {
  let hash = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

const EMPTY_BAR_HASH = hash8("")

function roundOnset(beat) {
  return Math.round(beat * ONSET_ROUNDING) / ONSET_ROUNDING
}

function handOf(trackIdx, hands) {
  if (hands.treble.includes(trackIdx)) { return "upper" }
  if (hands.bass.includes(trackIdx)) { return "lower" }
  return null
}

// the measure index whose [start, nextStart) window contains beat, or null
function measureIndexAt(starts, beat) {
  let found = null
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= beat + 1e-6) {
      found = i
    } else {
      break
    }
  }
  return found
}

function pitchClass(pitch) {
  return ((pitch % 12) + 12) % 12
}

// a deterministic string for one hand's pitch classes by beat within a
// measure, for stage 3's fuzzy alignment across editions
function sketchString(beats) {
  return [...beats.keys()].sort((a, b) => a - b)
    .map(beat => `${beat}:${[...beats.get(beat)].sort((a, b) => a - b).join(",")}`)
    .join("|")
}

// {algo, numbersHash, bars, sketches}: numbersHash changes whenever the
// score's printed numbering changes; bars is one hash per measure index, the
// sorted (hand, rounded onset, pitch) of the notes struck in it (a tied
// continuation is never struck again, so this already matches "notes
// starting in the measure"); sketches is the same measures as a looser
// per-beat pitch-class string, for stage 3
export function fingerprint(song) {
  let hands = staffTracks(song)
  let starts = (song.metadata && song.metadata.measureStarts) || []
  let numbers = (song.metadata && song.metadata.measureNumbers) || null
  let numbersHash = hash8(JSON.stringify(numbers || null))

  let barEntries = starts.map(() => [])
  let barSketches = starts.map(() => ({upper: new Map(), lower: new Map()}))

  for (let [trackIdx, track] of (song.tracks || []).entries()) {
    let hand = handOf(trackIdx, hands)
    if (!hand) { continue }

    for (let note of track) {
      let idx = measureIndexAt(starts, note.start)
      if (idx == null) { continue }

      let onset = roundOnset(note.start - starts[idx])
      let pitch = parseNote(note.note)
      barEntries[idx].push(`${hand}:${onset}:${pitch}`)

      let beat = Math.floor(onset)
      let sketch = barSketches[idx][hand]
      let classes = sketch.get(beat) || new Set()
      classes.add(pitchClass(pitch))
      sketch.set(beat, classes)
    }
  }

  let bars = barEntries.map(entries => hash8(entries.sort().join("|")))
  let sketches = barSketches.map(({upper, lower}) => ({
    upper: sketchString(upper),
    lower: sketchString(lower),
  }))

  return {algo: FINGERPRINT_ALGO, numbersHash, bars, sketches}
}

// measureIndex -> an earlier measureIndex with the exact same non-empty
// bar hash. An empty measure (no notes struck in it) is never a repeat, of
// another empty measure or anything else.
export function exactRepeats(fp) {
  let seen = new Map()
  let repeats = new Map()

  fp.bars.forEach((hash, idx) => {
    if (hash == EMPTY_BAR_HASH) { return }

    if (seen.has(hash)) {
      repeats.set(idx, seen.get(hash))
    } else {
      seen.set(hash, idx)
    }
  })

  return repeats
}
