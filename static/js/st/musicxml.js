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
//   - grace notes aren't notes of their own: they are kept, with the
//     neighbours of a trill, turn or mordent, as the ornaments of the note
//     they are played with (see addOrnaments)
//   - ties are merged into one note for detection,
//     with the notes they are tied to kept as the merged note's notation.ties
//     so an engine's drawn tied heads join the note (st/score_render)
//   - every note keeps its notation (see st/note_values): the notated value,
//     dots, tuplet ratio, voice and tie flags. Rests are kept the same way, on
//     the track of their staff
//
// Compressed .mxl files (zip containers, what MuseScore exports by default)
// are unpacked to their score's MusicXML text by readMusicXMLFile first.

import {unzipSync} from "fflate"
import {noteName, parseNote} from "st/music"
import {NOTE_TYPES, typeForBeats} from "st/note_values"
import {MultiTrackSong, SongNote} from "st/song_note_list"
import {measureNumbersFor} from "st/measure_numbers"

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

// pitch element -> {step, octave, alter}, the letter, octave and whole
// semitones altered, or null if it can't be named
function pitchParts(pitchEl) {
  let step = childText(pitchEl, "step")
  let octave = childText(pitchEl, "octave")
  let alter = Math.round(+(childText(pitchEl, "alter") || 0))

  if (!step || !step.match(/^[A-G]$/) || octave == null || octave === "") {
    return null
  }

  return {step, octave: +octave, alter}
}

// a letter, octave and alteration -> app note name like "C#4"
function spellNote({step, octave, alter}) {
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

const STEPS = "CDEFGAB"

// the letters a key signature sharpens, in the order it adds them; a flat key
// flattens them from the end
const SHARPS = "FCGDAEB"

// the alteration a key signature of fifths gives a letter
function keyAlter(fifths, step) {
  let idx = SHARPS.indexOf(step)
  if (fifths > 0) {
    return idx < fifths ? 1 : 0
  }
  if (fifths < 0) {
    return SHARPS.length - 1 - idx < -fifths ? -1 : 0
  }
  return 0
}

// the letter and octave a diatonic step above (by 1) or below (by -1)
function stepFrom({step, octave}, by) {
  let idx = STEPS.indexOf(step) + by
  return {
    step: STEPS[(idx + STEPS.length) % STEPS.length],
    octave: octave + Math.floor(idx / STEPS.length),
  }
}

// The ornaments that alternate a note with its neighbours, by the neighbours
// they play: the upper, the lower, or both
const ORNAMENT_NEIGHBOURS = {
  "trill-mark": ["upper"],
  "shake": ["upper"],
  "inverted-mordent": ["upper"],
  "mordent": ["lower"],
  "turn": ["upper", "lower"],
  "delayed-turn": ["upper", "lower"],
  "inverted-turn": ["upper", "lower"],
  "delayed-inverted-turn": ["upper", "lower"],
  "vertical-turn": ["upper", "lower"],
  "inverted-vertical-turn": ["upper", "lower"],
}

// the alteration an <accidental-mark> writes on an ornament's neighbour
const ACCIDENTAL_MARKS = {
  "sharp": 1, "natural": 0, "flat": -1, "double-sharp": 2, "sharp-sharp": 2,
  "flat-flat": -2, "natural-sharp": 1, "natural-flat": -1,
}

// The neighbours a note's trill, turn or mordent plays, as
// [{side: "upper" | "lower", alter}], alter being the accidental mark written
// on that side, or null for the one in force. Empty for a note without one.
// An <ornaments> element lists each ornament followed by its accidental marks:
// a mark with placement alters the side it names, one without it the next side
// still unaltered in written order (a turn's upper then its lower), and a mark
// with no side left to take alters nothing
function ornamentNeighbours(noteEl) {
  let neighbours = []

  for (let notations of childEls(noteEl, "notations")) {
    for (let ornaments of childEls(notations, "ornaments")) {
      let last = null

      for (let el of ornaments.children) {
        let sides = ORNAMENT_NEIGHBOURS[el.localName]
        if (sides) {
          last = sides.map(side => ({side, alter: null}))
          neighbours.push(...last)
          continue
        }

        let alter = ACCIDENTAL_MARKS[el.localName == "accidental-mark" ? el.textContent.trim() : null]
        if (!last || alter == null) { continue }

        let placement = el.getAttribute("placement")
        let side = placement == "below" ? "lower" : placement == "above" ? "upper" : null
        let neighbour = side ?
          last.find(n => n.side == side) :
          last.find(n => n.alter == null)
        if (neighbour && neighbour.alter == null) {
          neighbour.alter = alter
        }
      }
    }
  }

  return neighbours
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

// The notated value of a note or rest event (see st/note_values): its value
// and dots, and the tuplet ratio it is played at (1 for a plain note). The
// stem the score writes is the direction of a beam, so it isn't kept
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

  // grace notes waiting for the note they lead into, by voice, as {at, names}
  // of the position they are written at. A grace note is written in the
  // measure of the note it leads into, so none is kept past the end of one
  let pendingGraces = new Map()

  measures.forEach((measureEl, measureIdx) => {
    let position = 0 // in divisions, relative to measure start
    let maxPosition = 0
    let lastNoteStart = 0

    // the measure's pitched notes in the order written, for the accidentals
    // in force, and the notes with a trill, turn or mordent to spell the
    // neighbours of once the whole measure is read
    let written = []
    let ornamented = []

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
          let staff = +(childText(el, "staff") || 1)
          // the voice a note is written in, which tells two voices' heads on
          // one pitch apart (see joinCard in st/score_render/card_join). A
          // rest keeps none
          let voice = +(childText(el, "voice") || 0)

          if (hasChild(el, "grace")) {
            // a grace note has no duration, so it isn't a note of its own: it
            // is kept with the note it leads into, the next of its voice,
            // whichever staff either is written on
            let gracePitch = childEl(el, "pitch")
            let parts = gracePitch && pitchParts(gracePitch)
            if (parts) {
              written.push({staff, ...parts, at: position})
              let pending = pendingGraces.get(voice)
              let names = pending && pending.at == position ? pending.names : []
              pendingGraces.set(voice, {at: position, names: [...names, spellNote(parts)]})
            }
            break
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

          let parts = pitchParts(pitchEl)
          if (!parts || duration <= 0) {
            break
          }

          part.staves.add(staff)
          written.push({staff, ...parts, at: start})

          let ties = tieTypes(el)

          let event = {
            measureIdx,
            offset: start / divisions,
            duration: duration / divisions,
            name: spellNote(parts),
            staff,
            tieStart: ties.has("start"),
            tieStop: ties.has("stop"),
            ...notationOf(el, duration / divisions),
            ...(voice ? {voice} : null),
          }

          // only a note the graces lead into takes them: one written after
          // them, never one an earlier <backup> put before them
          let graces = pendingGraces.get(voice)
          if (graces && graces.at <= start) {
            event.graces = graces.names
            pendingGraces.delete(voice)
          }

          let neighbours = ornamentNeighbours(el)
          if (neighbours.length) {
            ornamented.push({event, staff, parts, neighbours, at: start, idx: written.length - 1, fifths})
          }

          part.events.push(event)
          break
        }
      }
    }

    // A neighbour takes the accidental mark written for it, else the
    // alteration of the last note on its letter and octave written on the
    // staff before the ornament in the measure (an accidental in force), else
    // the key signature's
    for (let {event, staff, parts, neighbours, at, idx, fifths} of ornamented) {
      event.neighbours = neighbours.map(({side, alter}) => {
        let neighbour = stepFrom(parts, side == "upper" ? 1 : -1)
        let inForce = written.filter((note, noteIdx) =>
          note.staff == staff && note.step == neighbour.step && note.octave == neighbour.octave &&
          (note.at < at || (note.at == at && noteIdx < idx))
        ).sort((a, b) => a.at - b.at).pop()

        return spellNote({
          ...neighbour,
          alter: alter ?? (inForce ? inForce.alter : keyAlter(fifths, neighbour.step)),
        })
      })
    }

    pendingGraces.clear()

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

// Keeps the ornaments of a note event on the song note it is played as (a
// tied note gathers those of the notes it is tied to): note.ornaments.graces,
// the grace notes leading into it, and note.ornaments.neighbours, the notes
// its trill, turn or mordent alternates it with. Neither is played for the
// note, so neither is required, but a player playing them as written doesn't
// slip (see column.allowed in st/song_sections). An ornament written on a
// tie's continuation, at, sounds from there on rather than over the whole
// merged note: note.ornaments.at, the beat its neighbours start at, kept only
// when no segment before it carried an ornament of its own
function addOrnaments(note, event, at) {
  let ornamented = !!(note.ornaments && note.ornaments.neighbours)

  for (let field of ["graces", "neighbours"]) {
    let names = event[field]
    if (!names || !names.length) { continue }

    note.ornaments = note.ornaments || {}
    let kept = note.ornaments[field] || []
    note.ornaments[field] = [...kept, ...names.filter(name => !kept.includes(name))]
  }

  if (!event.neighbours || !event.neighbours.length) { return }

  if (at > note.start && !ornamented) {
    note.ornaments.at = at
  }
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

  for (let [partIdx, part] of parts.entries()) {
    let staves = [...part.staves].sort((a, b) => a - b)
    let trackByStaff = {}

    for (let staff of staves) {
      let track = song.getTrack(trackIdx)
      trackByStaff[staff] = trackIdx
      // the score staff the track reads, which an engine draws it from (see
      // st/score_render); not stored with the song
      track.scoreStaff = {part: rawParts[partIdx].id, staff}

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

    // the notation of an event (see notationOf)
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
          addOrnaments(pending, event, noteStart)
          if (!event.tieStart) {
            delete pendingTies[key]
          }
          continue
        }
      }

      let note = new SongNote(event.name, noteStart, event.duration)
      note.notation = {...notationFor(event), ties: []}
      addOrnaments(note, event, noteStart)
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
