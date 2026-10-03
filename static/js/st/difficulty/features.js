// The score analysis's raw, per-bar measurements (st/difficulty/sections.js
// turns these into scores). Pure: given the same song and extras (st/difficulty
// /source.js), always returns the same numbers.

import {parseNote, noteStaffOffset, KeySignature} from "st/music"
import {staffTracks, measureNumberList, measureBeatRange} from "st/song_sections"

const EPSILON = 1e-6

// treble lines E4-F5, bass lines G2-A3: a note needing 3 or more ledger
// lines beyond either boundary is a reading hazard
const STAFF_BOUNDS = {
  g: [noteStaffOffset("E4"), noteStaffOffset("F5")],
  f: [noteStaffOffset("G2"), noteStaffOffset("A3")],
}

function ledgerLineCount(note, clefSign) {
  let bounds = STAFF_BOUNDS[clefSign] || STAFF_BOUNDS.g
  let pos = noteStaffOffset(note)
  if (pos > bounds[1]) { return Math.ceil((pos - bounds[1]) / 2) }
  if (pos < bounds[0]) { return Math.ceil((bounds[0] - pos) / 2) }
  return 0
}

// the clef in force at beat, from a track's sorted cleffs ([beat, sign]),
// else the clef the track opens with, else fallback
function clefAt(cleffs, beat, fallback) {
  if (!Array.isArray(cleffs) || !cleffs.length) { return fallback }

  let sign = fallback
  for (let [at, s] of cleffs) {
    if (at <= beat + EPSILON) {
      sign = s
    } else {
      break
    }
  }
  return sign
}

// the printed bar's measure indices: every index metadata.measureNumbers
// gives this number, so a bar split around a repeat is its two indices
function measureIndicesFor(song, number) {
  let numbers = song.metadata && song.metadata.measureNumbers
  if (Array.isArray(numbers) && numbers.length) {
    let indices = []
    numbers.forEach((n, idx) => { if (n == number) { indices.push(idx) } })
    return indices.length ? indices : [0]
  }

  return [Math.max(0, number - 1)]
}

// a hand's notes across its tracks, in score order, each carrying its pitch
// and track (for clef lookups)
function handNotes(song, trackIndices) {
  let notes = []
  for (let trackIdx of trackIndices) {
    for (let note of (song.tracks[trackIdx] || [])) {
      notes.push({
        note: note.note,
        start: note.start,
        duration: note.duration,
        pitch: parseNote(note.note),
        notation: note.notation,
        ornaments: note.ornaments,
        trackIdx,
      })
    }
  }
  notes.sort((a, b) => a.start - b.start)
  return notes
}

// consecutive notes (already sorted by start) grouped into onset chords
function groupChords(notes) {
  let chords = []
  for (let note of notes) {
    let last = chords[chords.length - 1]
    if (last && Math.abs(last.start - note.start) < EPSILON) {
      last.notes.push(note)
    } else {
      chords.push({start: note.start, notes: [note]})
    }
  }
  return chords
}

function stillSounding(note, t) {
  return note.start < t - EPSILON && note.start + note.duration > t + EPSILON
}

// still sounding, and will remain so for at least one more beat past t
function longHeld(note, t) {
  return stillSounding(note, t) && note.start + note.duration - t >= 1 - EPSILON
}

function nearestPair(chordA, chordB) {
  let best = {interval: Infinity, from: null, to: null}
  for (let a of chordA) {
    for (let b of chordB) {
      let interval = Math.abs(a.pitch - b.pitch)
      if (interval < best.interval) {
        best = {interval, from: a.note, to: b.note}
      }
    }
  }
  return best
}

function extremes(notes) {
  if (!notes.length) { return null }

  let low = notes[0]
  let high = notes[0]
  for (let note of notes) {
    if (note.pitch < low.pitch) { low = note }
    if (note.pitch > high.pitch) { high = note }
  }

  return {semitones: high.pitch - low.pitch, low: low.note, high: high.note}
}

// one hand's features for one bar, given its full note list and the
// previous bar's last chord (for the cross-barline leap) and the sounding
// notes at each of this bar's onsets (for holdMove/held)
function handBarFeatures(allNotes, barStart, barEnd, previousChord) {
  let barNotes = allNotes.filter(n => n.start >= barStart - EPSILON && n.start < barEnd - EPSILON)
  let chords = groupChords(barNotes)

  let struck = barNotes.map(n => ({note: n.note, start: n.start, duration: n.duration}))

  let span = null
  for (let chord of chords) {
    if (chord.notes.length < 2) { continue }
    let candidate = extremes(chord.notes)
    if (!span || candidate.semitones > span.semitones) { span = candidate }
  }

  let reach = null
  for (let chord of chords) {
    let windowNotes = barNotes.filter(n => n.start >= chord.start - EPSILON && n.start < chord.start + 1 - EPSILON)
    if (windowNotes.length < 2) { continue }
    let candidate = extremes(windowNotes)
    if (!reach || candidate.semitones > reach.semitones) { reach = candidate }
  }

  let sweep = extremes(barNotes)

  let chordSize = chords.reduce((max, chord) => Math.max(max, chord.notes.length), 0)

  let sequence = previousChord ? [previousChord, ...chords] : chords
  let leap = null
  for (let i = 1; i < sequence.length; i++) {
    let candidate = nearestPair(sequence[i - 1].notes, sequence[i].notes)
    if (candidate.interval > 0 && (!leap || candidate.interval > leap.semitones)) {
      leap = {semitones: candidate.interval, from: candidate.from, to: candidate.to}
    }
  }

  let holdMove = 0
  let holdMoveDetail = null
  let held = null

  for (let chord of chords) {
    let sounding = allNotes.filter(n => stillSounding(n, chord.start))
    let longHeldNotes = allNotes.filter(n => longHeld(n, chord.start))

    if (longHeldNotes.length) {
      holdMove += 1
      if (!holdMoveDetail || longHeldNotes.length > holdMoveDetail.heldNotes.length) {
        let aboveCount = chord.notes.filter(c =>
          longHeldNotes.every(h => c.pitch > h.pitch)).length
        holdMoveDetail = {
          heldNotes: longHeldNotes.map(n => n.note),
          above: aboveCount >= chord.notes.length / 2,
        }
      }
    }

    if (sounding.length) {
      let candidate = heldSpan(chord.notes, sounding)
      if (!held || candidate.semitones > held.semitones) { held = candidate }
    }
  }

  return {struck, span, reach, leap, sweep, chordSize, holdMove, holdMoveDetail, held}
}

// the widest-spanning pair of a newly struck note and an already-sounding
// (held) one, with which is which and whether the struck note sits below
// the held one (for "holds X while it drops to Y")
function heldSpan(chordNotes, soundingNotes) {
  let best = null
  for (let s of soundingNotes) {
    for (let c of chordNotes) {
      let semitones = Math.abs(s.pitch - c.pitch)
      if (!best || semitones > best.semitones) {
        best = {semitones, heldNote: s.note, struckNote: c.note, below: c.pitch < s.pitch}
      }
    }
  }
  return best
}

function tupletRatio(note) {
  return (note.notation && note.notation.tuplet) || 1
}

function polyFeature(upperBarNotes, lowerBarNotes, barStart) {
  if (!upperBarNotes.length || !lowerBarNotes.length) { return false }

  let beatsOf = notes => {
    let tuplet = new Set()
    let duple = new Map()
    for (let note of notes) {
      let beat = Math.floor(note.start - barStart + EPSILON)
      if (Math.abs(tupletRatio(note) - 1) > EPSILON) {
        tuplet.add(beat)
      } else {
        duple.set(beat, (duple.get(beat) || 0) + 1)
      }
    }
    return {tuplet, duple: new Set([...duple].filter(([, n]) => n >= 2).map(([b]) => b))}
  }

  let upper = beatsOf(upperBarNotes)
  let lower = beatsOf(lowerBarNotes)

  for (let beat of upper.tuplet) {
    if (lower.tuplet.has(beat)) { continue }
    if (lower.duple.has(beat)) { return {tuplet: "upper", duple: "lower"} }
  }
  for (let beat of lower.tuplet) {
    if (upper.tuplet.has(beat)) { continue }
    if (upper.duple.has(beat)) { return {tuplet: "lower", duple: "upper"} }
  }
  return false
}

function independenceFeature(upperBarNotes, lowerBarNotes) {
  if (!upperBarNotes.length || !lowerBarNotes.length) { return 0 }

  let onsets = new Map() // rounded onset -> {upper, lower}
  let key = start => Math.round(start * 48) / 48

  for (let note of upperBarNotes) {
    let k = key(note.start)
    let entry = onsets.get(k) || {upper: false, lower: false}
    entry.upper = true
    onsets.set(k, entry)
  }
  for (let note of lowerBarNotes) {
    let k = key(note.start)
    let entry = onsets.get(k) || {upper: false, lower: false}
    entry.lower = true
    onsets.set(k, entry)
  }

  let total = onsets.size
  let soloCount = [...onsets.values()].filter(e => e.upper != e.lower).length
  return total ? soloCount / total : 0
}

function crossingFeature(upperBarNotes, lowerBarNotes) {
  let lowerByOnset = groupChords(lowerBarNotes)
  let count = 0

  for (let upperChord of groupChords(upperBarNotes)) {
    let lowerChord = lowerByOnset.find(c => Math.abs(c.start - upperChord.start) < EPSILON)
    if (!lowerChord) { continue }

    let upperMin = Math.min(...upperChord.notes.map(n => n.pitch))
    let lowerMax = Math.max(...lowerChord.notes.map(n => n.pitch))
    if (upperMin < lowerMax) { count += 1 }
  }

  return count
}

function graceFeature(barNotes) {
  return barNotes.reduce((sum, note) =>
    sum + ((note.ornaments && note.ornaments.graces) ? note.ornaments.graces.length : 0), 0)
}

function chromaticFeature(barNotes, fifths, doubleAccidentals) {
  let key = KeySignature.forCount(fifths) || KeySignature.forCount(0)
  let count = barNotes.reduce((sum, note) =>
    sum + (key.accidentalsForNote(note.note) != null ? 1 : 0), 0)
  let doubled = doubleAccidentals.reduce((sum, n) => sum + (n || 0), 0)
  return {count, hasDouble: doubled > 0}
}

function ledgerFeature(barNotesWithClef) {
  return barNotesWithClef.reduce((sum, {note, clef}) =>
    sum + (ledgerLineCount(note, clef) >= 3 ? 1 : 0), 0)
}

// a bar-relative set, for near-repeat comparison
function barSignature(upperBarNotes, lowerBarNotes, barStart) {
  let key = (hand, note) => `${hand}:${Math.round((note.start - barStart) * 48) / 48}:${note.pitch}`
  let set = new Set()
  for (let note of upperBarNotes) { set.add(key("upper", note)) }
  for (let note of lowerBarNotes) { set.add(key("lower", note)) }
  return set
}

function jaccard(a, b) {
  if (!a.size && !b.size) { return 0 }
  let intersection = 0
  for (let item of a) { if (b.has(item)) { intersection += 1 } }
  let union = a.size + b.size - intersection
  return union ? intersection / union : 0
}

function setsEqual(a, b) {
  if (a.size != b.size) { return false }
  for (let item of a) { if (!b.has(item)) { return false } }
  return true
}

// one entry per printed bar: {number, indices, beats, hands: {upper, lower}}
// plus bar-level density/chromatic/ledger/poly/independence/crossing/grace/
// keyChange/remoteKey/timeChange/clefChange/nearRepeat. A one-staff piece
// (a melody) gets hands.lower == null throughout.
export function barFeatures(song, extras = {tempo: null, doubleAccidentals: []}) {
  let hands = staffTracks(song)
  let hasLower = hands.bass.length > 0 && hands.treble.length > 0

  let upperNotes = handNotes(song, hands.treble.length ? hands.treble : hands.bass)
  let lowerNotes = hasLower ? handNotes(song, hands.bass) : []

  let upperChords = groupChords(upperNotes)
  let lowerChords = groupChords(lowerNotes)

  let numbers = measureNumberList(song)
  let entries = []

  let seenKeys = new Set()
  let lastFullBarBeats = null
  let previousFifths = null

  for (let i = 0; i < numbers.length; i++) {
    let number = numbers[i]
    let indices = measureIndicesFor(song, number)
    let [beatsStart, beatsEnd] = measureBeatRange(song, number, number)
    if (!isFinite(beatsEnd)) {
      let measuresEnd = song.metadata && song.metadata.measuresEnd
      beatsEnd = isFinite(measuresEnd) && measuresEnd > beatsStart ? measuresEnd : beatsStart
    }
    if (!(beatsEnd > beatsStart)) { continue }

    let previousUpperChord = [...upperChords].reverse().find(c => c.start < beatsStart - EPSILON) || null
    let previousLowerChord = [...lowerChords].reverse().find(c => c.start < beatsStart - EPSILON) || null

    let upperHand = handBarFeatures(upperNotes, beatsStart, beatsEnd, previousUpperChord)
    let lowerHand = hasLower ? handBarFeatures(lowerNotes, beatsStart, beatsEnd, previousLowerChord) : null

    let upperBarNotes = upperNotes.filter(n => n.start >= beatsStart - EPSILON && n.start < beatsEnd - EPSILON)
    let lowerBarNotes = lowerNotes.filter(n => n.start >= beatsStart - EPSILON && n.start < beatsEnd - EPSILON)
    let allBarNotes = [...upperBarNotes, ...lowerBarNotes]

    let barBeats = beatsEnd - beatsStart
    let notesCount = allBarNotes.length
    let perBeat = barBeats > 0 ? notesCount / barBeats : 0
    let perSecond = extras.tempo ? perBeat * extras.tempo.bpm / 60 : null

    let fifths = song.metadata && song.metadata.measureKeySignatures ?
      song.metadata.measureKeySignatures[indices[0]] : 0
    if (fifths == null) { fifths = previousFifths != null ? previousFifths : 0 }

    let keyChange = previousFifths != null && fifths != previousFifths ?
      {fifths, seenBefore: seenKeys.has(fifths)} : false
    let remoteKey = Math.abs(fifths) >= 4

    let isPickup = number == 0
    let isLast = i == numbers.length - 1
    let timeChange = (!isPickup && !isLast && lastFullBarBeats != null &&
      Math.abs(barBeats - lastFullBarBeats) > EPSILON)

    let clefChange = false
    for (let trackIndices of [hands.treble, hands.bass]) {
      for (let trackIdx of trackIndices) {
        let cleffs = [...((song.tracks[trackIdx] && song.tracks[trackIdx].cleffs) || [])]
          .sort((a, b) => a[0] - b[0])
        for (let j = 0; j < cleffs.length; j++) {
          let [at, sign] = cleffs[j]
          if (at >= beatsStart - EPSILON && at < beatsEnd - EPSILON) {
            let previousSign = j > 0 ? cleffs[j - 1][1] : null
            if (previousSign && previousSign != sign) { clefChange = true }
          }
        }
      }
    }

    let doubleAccidentals = indices.map(idx => extras.doubleAccidentals[idx] || 0)
    let chromatic = chromaticFeature(allBarNotes, fifths, doubleAccidentals)

    let barNotesWithClef = [
      ...upperBarNotes.map(n => ({note: n.note, clef: clefAt(
        song.tracks[n.trackIdx] && song.tracks[n.trackIdx].cleffs, n.start, "g")})),
      ...lowerBarNotes.map(n => ({note: n.note, clef: clefAt(
        song.tracks[n.trackIdx] && song.tracks[n.trackIdx].cleffs, n.start, "f")})),
    ]
    let ledger = ledgerFeature(barNotesWithClef)

    let poly = polyFeature(upperBarNotes, lowerBarNotes, beatsStart)
    let independence = independenceFeature(upperBarNotes, lowerBarNotes)
    let crossing = crossingFeature(upperBarNotes, lowerBarNotes)
    let grace = graceFeature(allBarNotes)

    let signature = barSignature(upperBarNotes, lowerBarNotes, beatsStart)
    let nearRepeat = false
    if (signature.size) {
      for (let j = 0; j < entries.length; j++) {
        let earlier = entries[j]
        if (!earlier.signature.size) { continue }
        if (setsEqual(signature, earlier.signature)) { continue }
        if (jaccard(signature, earlier.signature) >= 0.75) {
          nearRepeat = {of: earlier.number}
          break
        }
      }
    }

    entries.push({
      number,
      indices: [indices[0], indices[indices.length - 1]],
      beats: [beatsStart, beatsEnd],
      hands: {upper: upperHand, lower: lowerHand},
      density: {notes: notesCount, perBeat, perSecond},
      chromatic,
      ledger,
      poly,
      independence,
      crossing,
      grace,
      keyChange,
      remoteKey,
      timeChange,
      clefChange,
      nearRepeat,
      signature,
    })

    seenKeys.add(fifths)
    if (!isPickup && !isLast) { lastFullBarBeats = barBeats }
    previousFifths = fifths
  }

  // the signature is bookkeeping only, never part of the public shape
  return entries.map(({signature, ...entry}) => entry)
}
