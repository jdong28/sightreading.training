// MusicXML -> MultiTrackSong converter
//
// Takes an uncompressed MusicXML document (score-partwise or score-timewise)
// and converts it linearly into the song model used by the play along page.
//
// Conventions:
//   - starts and durations are in quarter note beats, the unit the rest of
//     the app uses (MusicXML <divisions> is per quarter note, so a
//     <duration> is simply divided by the active divisions)
//   - note names keep the MusicXML octave, which is the app's numbering too:
//     middle C is "C4" (parseNote("C4") == MIDDLE_C_PITCH)
//   - every staff of a part becomes its own track, so a piano part becomes
//     two tracks, each with a clef entry from the part's <clef> elements
//   - repeats, endings, and transposition are ignored
//   - grace notes are skipped, ties are merged into one note for detection,
//     with the notes they are tied to kept as the merged note's notation.ties
//     so the staff can draw the continuation heads and their tie arcs
//   - every note keeps the notation the staff draws it with (see
//     st/staff_rhythm): the notated value, dots, tuplet ratio, voice and tie
//     flags. Rests are kept the same way, on the track of their staff, so the
//     staff can draw them at their beat
//
// Compressed .mxl files (zip containers, what MuseScore exports by default)
// are unpacked to their score's MusicXML text by readMusicXMLFile first.

import {unzipSync} from "fflate"
import {noteName, parseNote} from "st/music"
import {NOTE_TYPES, typeForBeats} from "st/staff_rhythm"
import {MultiTrackSong, SongNote} from "st/song_note_list"

export class MusicXMLError extends Error {
  constructor(message) {
    super(message)
    this.name = "MusicXMLError"
  }
}

// a compressed file that reached the parser as text, which can't be unpacked:
// read files with readMusicXMLFile from their bytes instead
export const COMPRESSED_MESSAGE = "This compressed MusicXML (.mxl) file couldn't be read. Try importing it again."

export const DAMAGED_ARCHIVE_MESSAGE = "The compressed MusicXML (.mxl) file is damaged and couldn't be opened."

export const NO_SCORE_MESSAGE = "The compressed MusicXML (.mxl) file holds no MusicXML score."

// zip archives (which is what .mxl is) start with the "PK" signature
export function isCompressedMusicXML(text) {
  return typeof text == "string" && text.startsWith("PK\u0003\u0004")
}

// a zip's first entry, or the end of an empty zip's directory
function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b &&
    ((bytes[2] == 3 && bytes[3] == 4) || (bytes[2] == 5 && bytes[3] == 6))
}

const CONTAINER_PATH = "META-INF/container.xml"

const isScoreEntry = name => !name.startsWith("META-INF/") && /\.(xml|musicxml)$/i.test(name)

// the path of the score a .mxl's container names, its first rootfile
function containerRootPath(container) {
  if (!container) { return null }

  let doc = new DOMParser().parseFromString(new TextDecoder().decode(container), "application/xml")
  let rootfile = doc.getElementsByTagName("rootfile")[0]
  return rootfile ? rootfile.getAttribute("full-path") : null
}

/**
 * A picked MusicXML file -> the score's uncompressed MusicXML text. A
 * compressed .mxl file is a zip whose META-INF/container.xml names the score;
 * without one, the first .xml or .musicxml entry outside META-INF is the
 * score. Anything else is read as UTF-8 text, as it always was.
 * @param {ArrayBuffer|Uint8Array|string} data the file's bytes, or its text
 * @returns {string}
 * @throws {MusicXMLError} for a damaged archive or one without a score
 */
export function readMusicXMLFile(data) {
  if (typeof data == "string") {
    return data
  }

  let bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (!isZip(bytes)) {
    return new TextDecoder().decode(bytes)
  }

  // only the entries that can be the score are unpacked, not the images or
  // PDF an archive may also hold
  let unzip = filter => {
    try {
      return unzipSync(bytes, {filter: file => filter(file.name)})
    } catch (e) {
      throw new MusicXMLError(DAMAGED_ARCHIVE_MESSAGE)
    }
  }

  let rootPath = containerRootPath(unzip(name => name == CONTAINER_PATH)[CONTAINER_PATH])
  let entries = unzip(name => name == rootPath || isScoreEntry(name))

  let path = rootPath && entries[rootPath] ? rootPath : Object.keys(entries).find(isScoreEntry)

  if (!path) {
    throw new MusicXMLError(NO_SCORE_MESSAGE)
  }

  return new TextDecoder().decode(entries[path])
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

// The app only knows key signatures from 6 flats to 5 sharps
// (KeySignature.allKeySignatures), so spell the remaining ones
// enharmonically. Note names are unaffected since they come from <alter>.
function normalizeFifths(fifths) {
  if (fifths > 5) {
    return fifths - 12
  }
  if (fifths < -6) {
    return fifths + 12
  }
  return fifths
}

// pitch element -> app note name like "C#4", or null if it can't be named
function pitchToNoteName(pitchEl) {
  let step = childText(pitchEl, "step")
  let octave = childText(pitchEl, "octave")
  let alter = Math.round(+(childText(pitchEl, "alter") || 0))

  if (!step || !step.match(/^[A-G]$/) || octave == null || octave === "") {
    return null
  }

  octave = +octave

  if (alter == 0) {
    return `${step}${octave}`
  }

  if (alter == 1) {
    return `${step}#${octave}`
  }

  if (alter == -1) {
    return `${step}b${octave}`
  }

  // double sharps/flats can't be spelled in the app's note names, use the
  // nearest enharmonic with the same accidental direction
  let pitch = parseNote(`${step}${octave}`) + alter
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

// The notated value of a note or rest: its <type> when the score writes one,
// else the value its duration spells. Returns {type, dots}, the notated value
// and the number of augmentation dots, or null when neither can be named.
function notatedValue(el, beats, ratio) {
  let dots = childEls(el, "dot").length
  let type = childText(el, "type")

  if (type && NOTE_TYPES[type]) {
    return {type, dots}
  }

  // a tuplet is played shorter than it is written: its duration is the
  // notated value over the ratio, so the value is the duration times it
  return typeForBeats(beats * ratio)
}

// actual-notes / normal-notes of a <time-modification>, eg. 3/2 for a
// triplet, or 1 for a note played as it is written
function timeModification(el) {
  let mod = childEl(el, "time-modification")
  if (!mod) { return 1 }

  let actual = +(childText(mod, "actual-notes") || 0)
  let normal = +(childText(mod, "normal-notes") || 0)
  return actual > 0 && normal > 0 ? actual / normal : 1
}

// The rests the score hides (MuseScore writes the invisible rests it pads a
// voice with this way) are parsed but never drawn
function isHidden(el) {
  return el.getAttribute("print-object") == "no"
}

// The notated value of a note or rest event, the drawing data of
// st/staff_rhythm: its value and dots, and the tuplet ratio it is played at
// (1 for a plain note). The stem the score writes is the direction of a beam,
// so the staff works out its own (see stemDirection in st/staff_rhythm)
function notationOf(el, duration) {
  let ratio = timeModification(el)
  let value = notatedValue(el, duration, ratio) || {type: "quarter", dots: 0}

  let out = {type: value.type}

  if (value.dots) {
    out.dots = value.dots
  }

  // the tuplet brackets and beams of part 2 (sr-score-beams-slurs-q2) are the
  // ratio's consumer; nothing draws it yet
  if (ratio != 1) {
    out.tuplet = ratio
  }

  return out
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
    rests: [],
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
            if (duration > 0) {
              let staff = +(childText(el, "staff") || 1)
              part.staves.add(staff)
              part.rests.push({
                measureIdx,
                offset: start / divisions,
                staff,
                // a whole measure rest is drawn centered in its bar whatever
                // the meter, so it keeps no notated value of its own
                wholeMeasure: childEl(el, "rest").getAttribute("measure") == "yes",
                hidden: isHidden(el),
                ...notationOf(el, duration / divisions),
              })
            }
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
          // the voice a note is written in, which the staff turns its stem by
          // (see columnStems in st/staff_rhythm). A rest is drawn at a fixed
          // staff position whatever voice writes it, so it keeps none
          let voice = +(childText(el, "voice") || 0)

          part.events.push({
            measureIdx,
            offset: start / divisions,
            duration: duration / divisions,
            name,
            staff,
            tieStart: ties.has("start"),
            tieStop: ties.has("stop"),
            ...notationOf(el, duration / divisions),
            ...(voice ? {voice} : null),
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
  let firstFifths = keyPart ? keyPart.fifths : 0
  let measureKeySignatures = []

  for (let i = 0; i < measureCount; i++) {
    let atMeasure = keyPart && keyPart.fifthsAt[i]
    measureKeySignatures.push(atMeasure != null ? atMeasure :
      (i > 0 ? measureKeySignatures[i - 1] : firstFifths))
  }

  let song = new MultiTrackSong()
  song.metadata = {
    keySignature: normalizeFifths(firstFifths),
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

    for (let rest of part.rests) {
      let track = song.getTrack(trackByStaff[rest.staff])
      if (!track.rests) {
        track.rests = []
      }
      track.rests.push({
        start: measureStarts[rest.measureIdx] + rest.offset,
        type: rest.type,
        dots: rest.dots,
        wholeMeasure: rest.wholeMeasure,
        hidden: rest.hidden,
      })
    }

    // a tie start waiting for its stop, keyed by track and note name
    let pendingTies = {}

    // the notation of an event, as the staff draws it (see st/staff_rhythm)
    let notationFor = event => ({
      type: event.type,
      dots: event.dots,
      voice: event.voice,
      tuplet: event.tuplet,
    })

    for (let event of part.events) {
      let track = trackByStaff[event.staff]
      let noteStart = measureStarts[event.measureIdx] + event.offset
      let key = `${track}:${event.name}`

      if (event.tieStop) {
        let pending = pendingTies[key]
        if (pending && Math.abs(pending.getStop() - noteStart) < EPSILON) {
          pending.duration += event.duration
          // the note the tie runs to is drawn as its own head, tied to the
          // one before it, though only the merged note is played
          pending.notation.ties.push({start: noteStart, ...notationFor(event)})
          if (!event.tieStart) {
            delete pendingTies[key]
          }
          continue
        }
      }

      let note = new SongNote(event.name, noteStart, event.duration)
      note.notation = {...notationFor(event), ties: []}
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
