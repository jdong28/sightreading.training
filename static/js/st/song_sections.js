// Extracts a section of a song as a list of "flashcard" columns for the
// sight reading staff. Detection drops rhythm: notes that start on the same
// beat become one chord column, columns are ordered by onset, and a tied note
// is one column, never two.
//
// The columns of an imported piece also carry what the staff draws its rhythm
// with (see st/staff_rhythm): the beat each column falls on, the notated value
// of each of its notes, and the rests and tied continuation heads between it
// and the next column. None of it is ever matched against what is played.

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

// The spans of the score a head is drawn with: the beams it is joined to its
// neighbours by, and the slurs and tuplets it starts or stops (st/musicxml).
// A head carries them wherever it is drawn, so a beam group, slur or tuplet
// whose other end falls on another column, or on a head that is only drawn
// (see tieHeads), is matched without the renderer reading the song again
function notationSpans(notation) {
  return {
    beams: notation.beams || null,
    slurs: notation.slurs || null,
    tuplets: notation.tuplets || null,
    tupletNotes: notation.tupletNotes || 0,
  }
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
    ...notationSpans(notation),
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
    // it runs from, which is all the score writes on it besides the spans of
    // its own head, eg. the slur a phrase stops on a tied note
    voice: notation.voice || null,
    tuplet: tie.tuplet || notation.tuplet || 1,
    ...notationSpans(tie),
    from: idx == 0 ? note.start : ties[idx - 1].start,
    tieTo: ties[idx + 1] ? ties[idx + 1].start : null,
  }))
}

// group notes by quantized onset into pitch sorted, deduplicated columns.
// Each entry is [note, staff]; given clefsAt (see grandStaffClefs) the column
// carries the staves as column.staves, one per note (the first of notes
// sharing a pitch), and the clefs at its onset as column.clefs. When the notes
// carry the score's notation the column also carries column.beat, the beat it
// falls on, column.beats, the beats left of the extracted range after it, and
// column.notation, what each of its notes is drawn as
function groupByOnset(entries, clefsAt, {endBeat=null}={}) {
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
      notes.push({pitch, name: note.note, staff, notation: noteNotation(note)})
    }

    notes.sort((a, b) => a.pitch - b.pitch)
    let column = notes.map(note => note.name)
    let beat = byOnset.get(key)[0][0].start

    if (clefsAt) {
      column.staves = notes.map(note => note.staff)
      column.clefs = clefsAt(beat)
    }

    if (clefsAt && notes.some(note => note.notation)) {
      column.beat = beat
      column.notation = notes.map(note => note.notation)
      if (endBeat != null && isFinite(endBeat)) {
        column.beats = Math.max(0, endBeat - beat)
      }
      column.extras = doubled
    }

    return column
  })
}

// The slurs of the score as spans of beats: from the head each one starts on
// to the head it stops on, matched by the number the score writes on it and
// kept per staff, the way its rests are, so a staff never draws the other
// hand's phrasing. A slur the score never closes spans nothing
function slurSpans(entries) {
  let events = []

  for (let [note, staff] of entries) {
    let notation = note.notation
    if (!notation) { continue }

    for (let span of notation.slurs || []) {
      events.push({beat: note.start, staff: staff || null, ...span})
    }

    // a phrase can stop on a head a tie runs on to, which is drawn where the
    // tie puts it rather than at the note's own onset
    for (let tie of notation.ties || []) {
      for (let span of tie.slurs || []) {
        events.push({beat: tie.start, staff: staff || null, ...span})
      }
    }
  }

  events.sort((a, b) => a.beat - b.beat)

  let open = new Map()
  let spans = []

  for (let event of events) {
    let key = `${event.number}:${event.staff || ""}`

    if (event.type == "start") {
      open.set(key, event)
      continue
    }

    let from = open.get(key)
    open.delete(key)

    if (from) {
      spans.push({
        number: event.number,
        staff: event.staff,
        placement: from.placement || event.placement || null,
        from: from.beat,
        to: event.beat,
      })
    }
  }

  return spans
}

// Marks every column a slur of the score is open right across — started
// before it and stopped after it, so neither of its own heads is drawn in the
// column — with that slur, as column.slurs. It is what lets a card falling
// wholly inside a long phrase draw the arc passing over it rather than losing
// the slur until its ends come round again (see slurArcs in st/staff_rhythm)
function markSlurs(columns, entries) {
  let spans = slurSpans(entries)
  if (!spans.length) { return columns }

  for (let column of columns) {
    if (column.beat == null) { continue }

    let through = spans.filter(span =>
      span.from < column.beat - ONSET_EPSILON / 2 &&
      span.to > column.beat + ONSET_EPSILON / 2)

    if (through.length) {
      column.slurs = through.map(({number, staff, placement}) =>
        ({number, staff, placement}))
    }
  }

  return columns
}

// Hands each of extras to the column it is drawn after, the last one starting
// at or before it; anything before the first column goes to it, drawn in the
// room before its head. Extras are in beat order and stay that way.
//
// A range holding no column at all — a measure every drilled hand rests
// through — keeps its extras, and the beats it covers, on the array itself, so
// a card can draw that bar's rests, bar line and number without ever handing
// the player a column to answer (see sectionCard in st/measure_cards)
function attachExtras(columns, extras, bar) {
  if (!columns.length) {
    if (bar.beat != null) {
      columns.beat = bar.beat
      columns.beats = bar.beats
      columns.extras = [...extras].sort((a, b) => a.beat - b.beat)
    }
    return columns
  }

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
// opts.staves: when set, each column carries column.staves, the grand staff
// ("upper" or "lower", see staffTracks) each of its notes is written on, and
// column.clefs, the clef sign at its onset of each staff the tracks are on
// (see grandStaffClefs). The columns then also carry column.extras, the rests
// and tied continuation heads drawn after them
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

  let grand = opts.staves ? staffTracks(song) : null

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

  // the last measure of a score has no measure after it to end on, so the
  // columns of the section take the beat the score's measures end at
  let measuresEnd = song.metadata && song.metadata.measuresEnd
  let columnsEnd = isFinite(endBeat) ? endBeat : measuresEnd

  let columns = groupByOnset(
    inRange, grand && grandStaffClefs(song, grand, trackIndices), {endBeat: columnsEnd})

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

  return attachExtras(markSlurs(columns, entries), extras, {
    beat: startBeat,
    beats: isFinite(columnsEnd) ? Math.max(0, columnsEnd - startBeat) : 0,
  })
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
    if (column.staves) {
      kept.staves = column.staves.filter((staff, idx) => keep[idx])
      kept.clefs = column.clefs
    }

    if (column.notation) {
      kept.beat = column.beat
      kept.beats = column.beats
      if (column.slurs) {
        kept.slurs = column.slurs
      }
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

  // The range held no columns at all — a measure every drilled hand rests
  // through — so it keeps what a column-less bar keeps: the extras still
  // drawn and the beats it covers (see attachExtras)
  if (!out.length && columns.beat != null) {
    out.beat = columns.beat
    out.beats = columns.beats
    out.extras = (columns.extras || []).filter(extra => {
      if (extra.kind != "head") { return true }
      let pitch = parseNote(extra.name)
      return pitch >= minPitch && pitch <= maxPitch
    })
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

// The clef signs the staves of the grand staff grand (see staffTracks) that
// trackIndices are on are drawn in, from the clefs of the first track on
// each: a function of beat, called with beats in order, giving eg. {upper,
// lower}, each the last clef starting by then, else the clef the staff opens
// with, or null for a staff without clefs
function grandStaffClefs(song, grand, trackIndices) {
  let staves = [["upper", grand.treble], ["lower", grand.bass]]
    .filter(([, tracks]) => tracks.some(idx => trackIndices.includes(idx)))
    .map(([name, tracks]) => {
      let clefs = [...(song.tracks[tracks[0]].cleffs || [])].sort((a, b) => a[0] - b[0])
      return {name, clefs, idx: 0}
    })

  return beat => {
    let out = {}
    for (let staff of staves) {
      while (staff.idx + 1 < staff.clefs.length && staff.clefs[staff.idx + 1][0] <= beat + ONSET_EPSILON / 2) {
        staff.idx += 1
      }
      out[staff.name] = staff.clefs.length ? staff.clefs[staff.idx][1] : null
    }
    return out
  }
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
