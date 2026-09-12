// Generates song notation (the text the song editor and SongParser use) from
// a song model, so an imported song can be edited and saved like any other.
//
// The notation positions notes with a cursor, so every track is written as
// one block of voices separated by "|" (which rewinds the cursor to the
// block start). Each voice is a run of notes and rests that never overlap.
// The time scale is set so the cursor unit is a fraction of a beat that
// every start and duration is a whole multiple of: 1/12 of a beat covers
// sixteenths and triplets, 1/24 and 1/48 cover 32nd and 64th notes. A song
// that needs a finer grid (quintuplets, swing offsets) can't be written
// faithfully and throws SerializeError.
//
// Every note carries an explicit accidental (+, - or =) so the result does
// not depend on the key signature's default accidentals.

import {MultiTrackSong} from "st/song_note_list"

export class SerializeError extends Error {
  constructor(message) {
    super(message)
    this.name = "SerializeError"
  }
}

// cursor units per quarter note beat, coarsest first
const RESOLUTIONS = [12, 24, 48]

const EPSILON = 1e-4

function isWhole(value) {
  return Math.abs(value - Math.round(value)) < EPSILON
}

function noteCode(name) {
  let match = name.match(/^([A-G])(#|b)?(\d+)$/)
  if (!match) {
    throw new SerializeError(`Can't write note ${name}`)
  }

  let [, letter, accidental, octave] = match

  if (+octave > 9) {
    throw new SerializeError(`Note ${name} is out of the notation's range`)
  }

  let mark = "="
  if (accidental == "#") {
    mark = "+"
  } else if (accidental == "b") {
    mark = "-"
  }

  return `${letter.toLowerCase()}${mark}${octave}`
}

// beatsPerMeasure -> [beats, beatType] with the coarsest beat type that fits
function timeSignatureFor(beatsPerMeasure) {
  for (let beatType of [4, 8, 16]) {
    let beats = beatsPerMeasure * beatType / 4
    if (beats > 0 && isWhole(beats)) {
      return [Math.round(beats), beatType]
    }
  }

  throw new SerializeError(`Can't write a time signature with ${beatsPerMeasure} beats per measure`)
}

// finds the coarsest resolution where all starts and durations are whole units
function resolutionFor(notes) {
  for (let unitsPerBeat of RESOLUTIONS) {
    let fits = notes.every(note =>
      isWhole(note.start * unitsPerBeat) && isWhole(note.duration * unitsPerBeat))

    if (fits) {
      return unitsPerBeat
    }
  }

  throw new SerializeError("The rhythm is finer than the notation can express (64th notes and triplets are the limit)")
}

// group notes that share a start and duration into chords, then pack the
// chords into non-overlapping voices
function packVoices(notes, unitsPerBeat) {
  let chords = {}
  let items = []

  for (let note of notes) {
    let start = Math.round(note.start * unitsPerBeat)
    let duration = Math.round(note.duration * unitsPerBeat)

    if (duration <= 0) {
      continue
    }

    let key = `${start}:${duration}`
    if (!chords[key]) {
      chords[key] = {start, duration, notes: []}
      items.push(chords[key])
    }

    chords[key].notes.push(note.note)
  }

  items.sort((a, b) => a.start - b.start || a.duration - b.duration)

  let voices = []

  for (let item of items) {
    let best = null

    for (let voice of voices) {
      if (voice.end <= item.start && (!best || voice.end > best.end)) {
        best = voice
      }
    }

    if (!best) {
      best = {end: 0, items: []}
      voices.push(best)
    }

    best.items.push(item)
    best.end = item.start + item.duration
  }

  return voices
}

function voiceCode(voice) {
  let out = []
  let cursor = 0

  for (let item of voice.items) {
    if (item.start > cursor) {
      out.push(`r${item.start - cursor}`)
    }

    let notes = item.notes.map(name => `${noteCode(name)}.${item.duration}`)

    if (notes.length == 1) {
      out.push(notes[0])
    } else {
      out.push(`{${notes.join(" | ")}}`)
    }

    cursor = item.start + item.duration
  }

  return out.join(" ")
}

// Returns notation text for the song. Throws SerializeError when the song
// can't be written faithfully.
export function serializeSong(song) {
  let metadata = song.metadata || {}
  let beatsPerMeasure = metadata.beatsPerMeasure || 4
  let keySignature = metadata.keySignature || 0

  let [beats, beatType] = timeSignatureFor(beatsPerMeasure)
  let beatsPerNote = 4 / beatType

  let tracks = song instanceof MultiTrackSong && song.tracks.length ?
    song.tracks : [song]

  let allNotes = [].concat(...tracks.map(track => [...(track || [])]))
  let unitsPerBeat = resolutionFor(allNotes)

  // cursor unit is beatsPerNote * timeScale, so timeScale = 1 / (unitsPerBeat * beatsPerNote)
  // which is 1 / (3 * 2^halvings), written as one "tt" and that many "dt"
  let halvings = Math.log2(unitsPerBeat * beatsPerNote / 3)
  if (!isWhole(halvings) || halvings < 0) {
    throw new SerializeError("Can't express the time scale")
  }

  let lines = [
    `ks${keySignature} ts${beats}/${beatType}`,
    ["tt", ...new Array(Math.round(halvings)).fill("dt")].join(" "),
  ]

  tracks.forEach((track, idx) => {
    if (!track || !track.length) {
      return
    }

    // rewind to the song start before the clef so it is recorded at beat 0
    let header = [`t${idx}`, "m0"]
    if (track.cleffs && track.cleffs.length) {
      header.push(`/${track.cleffs[0][1]}`)
    }

    lines.push("")
    lines.push(header.join(" "))
    lines.push("{")

    packVoices([...track], unitsPerBeat).forEach((voice, voiceIdx) => {
      lines.push(`  ${voiceIdx == 0 ? " " : "|"} ${voiceCode(voice)}`)
    })

    lines.push("}")
  })

  return lines.join("\n") + "\n"
}
