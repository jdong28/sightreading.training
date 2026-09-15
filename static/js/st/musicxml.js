// MusicXML -> MultiTrackSong converter
//
// Takes an uncompressed MusicXML document (score-partwise or score-timewise)
// and converts it linearly into the song model used by the play along page.
//
// Conventions:
//   - starts and durations are in quarter note beats, the unit the rest of
//     the app uses (MusicXML <divisions> is per quarter note, so a
//     <duration> is simply divided by the active divisions)
//   - note names use the app's octave numbering, where middle C is "C5"
//     (parseNote("C5") == MIDDLE_C_PITCH), one octave higher than the
//     MusicXML/scientific numbering where middle C is octave 4
//   - every staff of a part becomes its own track, so a piano part becomes
//     two tracks, each with a clef entry from the part's <clef> elements
//   - repeats, endings, and transposition are ignored
//   - grace notes are skipped, ties are merged into one note
//
// Not supported: compressed .mxl files (zip containers). They are refused
// with a MusicXMLError so the UI can show a clear message.

import {noteName, parseNote} from "st/music"
import {MultiTrackSong, SongNote} from "st/song_note_list"

export class MusicXMLError extends Error {
  constructor(message) {
    super(message)
    this.name = "MusicXMLError"
  }
}

export const COMPRESSED_MESSAGE = "This is a compressed MusicXML (.mxl) file, which isn't supported. Export an uncompressed .musicxml or .xml file instead."

// zip archives (which is what .mxl is) start with the "PK" signature
export function isCompressedMusicXML(text) {
  return typeof text == "string" && text.startsWith("PK\u0003\u0004")
}

const EPSILON = 1e-6

function childText(el, name) {
  for (let child of el.children) {
    if (child.localName == name) {
      return child.textContent.trim()
    }
  }
  return null
}

function childEl(el, name) {
  for (let child of el.children) {
    if (child.localName == name) {
      return child
    }
  }
  return null
}

function childEls(el, name) {
  return [...el.children].filter(child => child.localName == name)
}

function hasChild(el, name) {
  return childEl(el, name) != null
}

// "3" -> 3, "3+2" -> 5 (compound time signatures)
function parseBeats(text) {
  return text.split("+").reduce((sum, part) => sum + (+part.trim() || 0), 0)
}

// The app counts quarter note beats, so a time signature's beats per measure
// is beats * 4 / beat-type. This means a 6/8 measure is 3 beats long here
// rather than its 6 notated eighth note beats, which matches what the app's
// own "ts6/8" notation command produces.
function beatsPerMeasureFor(timeEl) {
  let beats = childText(timeEl, "beats")
  let beatType = childText(timeEl, "beat-type")
  if (!beats || !beatType || !+beatType) {
    return null
  }
  return parseBeats(beats) * 4 / +beatType
}

// pitch element -> app note name like "C#5", or null if it can't be named
function pitchToNoteName(pitchEl) {
  let step = childText(pitchEl, "step")
  let octave = childText(pitchEl, "octave")
  let alter = Math.round(+(childText(pitchEl, "alter") || 0))

  if (!step || !step.match(/^[A-G]$/) || octave == null || octave === "") {
    return null
  }

  let appOctave = +octave + 1

  if (alter == 0) {
    return `${step}${appOctave}`
  }

  if (alter == 1) {
    return `${step}#${appOctave}`
  }

  if (alter == -1) {
    return `${step}b${appOctave}`
  }

  // double sharps/flats can't be spelled in the app's note names, use the
  // nearest enharmonic with the same accidental direction
  let pitch = parseNote(`${step}${appOctave}`) + alter
  return noteName(pitch, alter > 0)
}

function clefSign(clefEl) {
  let sign = (childText(clefEl, "sign") || "").toLowerCase()
  if (sign == "g" || sign == "f" || sign == "c") {
    return sign
  }
  return null
}

function tieTypes(noteEl) {
  let types = new Set()

  for (let tie of childEls(noteEl, "tie")) {
    types.add(tie.getAttribute("type"))
  }

  // some exporters only write the <tied> notation
  let notations = childEl(noteEl, "notations")
  if (notations) {
    for (let tied of childEls(notations, "tied")) {
      types.add(tied.getAttribute("type"))
    }
  }

  return types
}

// Walks the measures of one part, producing measure relative events so the
// measure starts can be reconciled across parts afterwards.
function walkPart(measures, partName) {
  let part = {
    name: partName,
    staves: new Set(),
    measureDurations: [], // beats, by measure index
    beatsPerMeasureAt: [], // active time signature by measure index
    fifthsAt: [], // active key signature by measure index
    events: [],
    clefs: [],
    fifths: null,
    beatsPerMeasure: null,
  }

  let divisions = 1
  let beatsPerMeasure = null
  let fifths = null

  measures.forEach((measureEl, measureIdx) => {
    let position = 0 // in divisions, relative to measure start
    let maxPosition = 0
    let lastNoteStart = 0

    for (let el of measureEl.children) {
      switch (el.localName) {
        case "attributes": {
          let d = childText(el, "divisions")
          if (d && +d > 0) {
            divisions = +d
          }

          let key = childEl(el, "key")
          if (key) {
            let text = childText(key, "fifths")
            if (text != null && text !== "" && isFinite(+text)) {
              fifths = +text
              if (part.fifths == null) {
                part.fifths = fifths
              }
            }
          }

          let time = childEl(el, "time")
          if (time) {
            let bpm = beatsPerMeasureFor(time)
            if (bpm) {
              beatsPerMeasure = bpm
              if (part.beatsPerMeasure == null) {
                part.beatsPerMeasure = bpm
              }
            }
          }

          for (let clef of childEls(el, "clef")) {
            let sign = clefSign(clef)
            let staff = +(clef.getAttribute("number") || 1)
            part.staves.add(staff)
            if (sign) {
              part.clefs.push({
                measureIdx,
                offset: position / divisions,
                staff,
                sign,
              })
            }
          }

          break
        }
        case "backup": {
          position -= +(childText(el, "duration") || 0)
          break
        }
        case "forward": {
          position += +(childText(el, "duration") || 0)
          maxPosition = Math.max(maxPosition, position)
          break
        }
        case "note": {
          if (hasChild(el, "grace")) {
            break // grace notes have no duration, skip them
          }

          let duration = +(childText(el, "duration") || 0)
          let isChord = hasChild(el, "chord")
          let start = isChord ? lastNoteStart : position

          if (!isChord) {
            position += duration
            maxPosition = Math.max(maxPosition, position)
            lastNoteStart = start
          }

          if (hasChild(el, "rest")) {
            break
          }

          let pitchEl = childEl(el, "pitch")
          if (!pitchEl) {
            break // unpitched
          }

          let name = pitchToNoteName(pitchEl)
          if (!name || duration <= 0) {
            break
          }

          let staff = +(childText(el, "staff") || 1)
          part.staves.add(staff)

          let ties = tieTypes(el)

          part.events.push({
            measureIdx,
            offset: start / divisions,
            duration: duration / divisions,
            name,
            staff,
            tieStart: ties.has("start"),
            tieStop: ties.has("stop"),
          })
          break
        }
      }
    }

    part.measureDurations[measureIdx] = maxPosition / divisions
    part.beatsPerMeasureAt[measureIdx] = beatsPerMeasure
    part.fifthsAt[measureIdx] = fifths
  })

  if (part.staves.size == 0) {
    part.staves.add(1)
  }

  return part
}

// returns [{id, name, measures: [measureEl, ...]}, ...] for either root layout
function collectParts(root) {
  let names = {}
  let partList = childEl(root, "part-list")
  if (partList) {
    for (let scorePart of childEls(partList, "score-part")) {
      names[scorePart.getAttribute("id")] = childText(scorePart, "part-name")
    }
  }

  let parts = []
  let byId = {}

  let getPart = (id) => {
    if (!byId[id]) {
      byId[id] = {id, name: names[id] || null, measures: []}
      parts.push(byId[id])
    }
    return byId[id]
  }

  if (root.localName == "score-partwise") {
    for (let partEl of childEls(root, "part")) {
      let part = getPart(partEl.getAttribute("id"))
      part.measures.push(...childEls(partEl, "measure"))
    }
  } else if (root.localName == "score-timewise") {
    for (let measureEl of childEls(root, "measure")) {
      for (let partEl of childEls(measureEl, "part")) {
        getPart(partEl.getAttribute("id")).measures.push(partEl)
      }
    }
  } else {
    throw new MusicXMLError(`Not a MusicXML score (root element is <${root.localName}>)`)
  }

  return parts
}

function scoreTitle(root) {
  let work = childEl(root, "work")
  if (work) {
    let title = childText(work, "work-title")
    if (title) {
      return title
    }
  }

  return childText(root, "movement-title")
}

// The bar numbers printed on the score, by measure index. Notation software
// doesn't count implicit measures: a leading pickup is measure 0 and the
// second half of a bar split around a repeat keeps the number of the first.
// Some exporters mark a pickup only by numbering it 0.
function measureNumbersFor(measureEls, measureCount) {
  let numbers = []
  let number = 0

  for (let i = 0; i < measureCount; i++) {
    let el = measureEls[i]
    if (el && el.localName == "part") {
      el = el.parentElement
    }

    let implicit = el && (el.getAttribute("implicit") == "yes" ||
      (i == 0 && (el.getAttribute("number") || "").trim() == "0"))

    if (!implicit) {
      number += 1
    }

    numbers.push(number)
  }

  return numbers
}

// Converts MusicXML text into a MultiTrackSong. Throws MusicXMLError on
// input that can't be converted.
export function parseMusicXML(text) {
  if (isCompressedMusicXML(text)) {
    throw new MusicXMLError(COMPRESSED_MESSAGE)
  }

  if (typeof text != "string" || !text.trim()) {
    throw new MusicXMLError("The file is empty")
  }

  let doc = new DOMParser().parseFromString(text, "application/xml")
  let root = doc.documentElement

  if (!root || root.localName == "parsererror" || doc.getElementsByTagName("parsererror").length) {
    throw new MusicXMLError("The file isn't well-formed XML")
  }

  let rawParts = collectParts(root)
  let parts = rawParts.map(p => walkPart(p.measures, p.name))

  if (!parts.length) {
    throw new MusicXMLError("The score has no parts")
  }

  let firstPart = parts[0]
  let beatsPerMeasure = firstPart.beatsPerMeasure ||
    parts.map(p => p.beatsPerMeasure).find(b => b) || 4

  // measure lengths come from the content (so pickup measures stay short),
  // reconciled across parts so every part shares the same measure starts
  let measureCount = Math.max(...parts.map(p => p.measureDurations.length))
  let measureStarts = []
  let start = 0

  for (let i = 0; i < measureCount; i++) {
    measureStarts.push(start)

    let length = Math.max(...parts.map(p => p.measureDurations[i] || 0))
    if (length <= EPSILON) {
      // an empty measure takes the length of the active time signature
      length = parts.map(p => p.beatsPerMeasureAt[i]).find(b => b) || beatsPerMeasure
    }

    start += length
  }

  // the key signature in fifths as the score writes it (the trainer only
  // draws -6 to 5), in effect at each measure
  let keyPart = parts.find(p => p.fifths != null)
  let keySignature = keyPart ? keyPart.fifths : 0
  let measureKeySignatures = []

  for (let i = 0; i < measureCount; i++) {
    let atMeasure = keyPart && keyPart.fifthsAt[i]
    measureKeySignatures.push(atMeasure != null ? atMeasure :
      (i > 0 ? measureKeySignatures[i - 1] : keySignature))
  }

  let song = new MultiTrackSong()
  song.metadata = {
    keySignature,
    beatsPerMeasure,
    measureStarts,
    measureNumbers: measureNumbersFor(rawParts[0].measures, measureCount),
    measureKeySignatures,
    measuresEnd: start,
  }

  let title = scoreTitle(root)
  if (title) {
    song.metadata.title = title
  }

  let trackIdx = 0

  for (let part of parts) {
    let staves = [...part.staves].sort((a, b) => a - b)
    let trackByStaff = {}

    for (let staff of staves) {
      let track = song.getTrack(trackIdx)
      trackByStaff[staff] = trackIdx

      if (part.name) {
        track.trackName = staves.length > 1 ?
          `${part.name} (staff ${staff})` : part.name
      }

      trackIdx += 1
    }

    for (let clef of part.clefs) {
      let track = song.getTrack(trackByStaff[clef.staff])
      if (!track.cleffs) {
        track.cleffs = []
      }
      track.cleffs.push([measureStarts[clef.measureIdx] + clef.offset, clef.sign])
    }

    // a tie start waiting for its stop, keyed by track and note name
    let pendingTies = {}

    for (let event of part.events) {
      let track = trackByStaff[event.staff]
      let noteStart = measureStarts[event.measureIdx] + event.offset
      let key = `${track}:${event.name}`

      if (event.tieStop) {
        let pending = pendingTies[key]
        if (pending && Math.abs(pending.getStop() - noteStart) < EPSILON) {
          pending.duration += event.duration
          if (!event.tieStart) {
            delete pendingTies[key]
          }
          continue
        }
      }

      let note = new SongNote(event.name, noteStart, event.duration)
      song.pushWithTrack(note, track)

      if (event.tieStart) {
        pendingTies[key] = note
      }
    }
  }

  // a staff with nothing but rests would have no notes and can't pick a
  // staff to render on, so leave it out
  song.tracks = song.tracks.filter(track => track.length > 0)

  return song
}
