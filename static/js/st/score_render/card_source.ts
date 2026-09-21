// What both engines are handed for a card, worked out once from the source
// MusicXML: every note tagged with an id (Verovio keeps it as the drawn
// note's id, and OSMD's notes are matched back to it), the table of those
// notes' pitch, onset, staff and voice as the score writes them, the
// positions of the card's measures, and, when one hand is drawn alone, the
// score with the other staff taken out

import type {Hand} from "./types"

export interface SourceNote {
  id: string
  pitch: number
  onsetBeats: number
  staff: number
  voice: number
}

export interface PreparedCard {
  xml: string
  // positions of the card's first and last measure among the score's
  // measures, 0-based, the numbering both engines' measure ranges use
  firstIndex: number
  lastIndex: number
  // the pitched notes of the whole score by id
  notes: Map<string, SourceNote>
  // the onset of each of the first part's measures, in quarter notes from
  // the start of the score, by position
  measureStarts: number[]
}

export const NOTE_ID_PREFIX = "srn"

const STEP_SEMITONES: {[step: string]: number} = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}

function childText(el: Element, name: string): string | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName == name) {
      return (child.textContent || "").trim()
    }
  }
  return null
}

function hasChild(el: Element, name: string): boolean {
  return Array.from(el.children).some(child => child.tagName == name)
}

function childNumber(el: Element, name: string, fallback: number): number {
  const text = childText(el, name)
  const value = text == null ? NaN : Number(text)
  return Number.isFinite(value) ? value : fallback
}

function directChildren(el: Element, name: string): Element[] {
  return Array.from(el.children).filter(child => child.tagName == name)
}

export function parseMusicXML(text: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, "application/xml")
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) {
    throw new Error("The score's MusicXML can't be read")
  }
  if (doc.documentElement.tagName != "score-partwise") {
    throw new Error(`Only partwise MusicXML can be drawn, not ${doc.documentElement.tagName}`)
  }
  return doc
}

// the MIDI number of a <pitch>, null for rests and unpitched notes
export function notePitch(note: Element): number | null {
  const pitch = directChildren(note, "pitch")[0]
  if (!pitch) { return null }

  const step = STEP_SEMITONES[childText(pitch, "step") || ""]
  const octave = childNumber(pitch, "octave", NaN)
  if (step == null || !Number.isFinite(octave)) { return null }

  return (octave + 1) * 12 + step + Math.round(childNumber(pitch, "alter", 0))
}

function parts(doc: XMLDocument): Element[] {
  return directChildren(doc.documentElement, "part")
}

// The 0-based positions of the first measure numbered from or later and the
// last numbered to or earlier, by the first part's printed numbers (a
// number like "12a" counts as 12); null when no measure falls in the range
export function measurePositions(doc: XMLDocument, from: number, to: number): [number, number] | null {
  const part = parts(doc)[0]
  if (!part) { return null }

  const numbers = directChildren(part, "measure")
    .map(measure => parseInt(measure.getAttribute("number") || "", 10))

  let first = -1
  let last = -1
  numbers.forEach((number, idx) => {
    if (Number.isNaN(number) || number < from || number > to) { return }
    if (first < 0) { first = idx }
    last = idx
  })

  return first < 0 ? null : [first, last]
}

// Tags every note with an id and reads each pitched note's onset, in quarter
// notes from the start of the score, walking the <backup>s and <forward>s of
// each part's measures
export function tagNotes(doc: XMLDocument): {notes: Map<string, SourceNote>, measureStarts: number[]} {
  const table = new Map<string, SourceNote>()
  const measureStarts: number[] = []
  let count = 0

  parts(doc).forEach((part, partIdx) => {
    let divisions = 1
    let measureStart = 0

    for (const measure of directChildren(part, "measure")) {
      if (partIdx == 0) { measureStarts.push(measureStart) }
      let position = 0
      let measureLength = 0
      let chordOnset = 0

      for (const el of Array.from(measure.children)) {
        switch (el.tagName) {
          case "attributes": {
            divisions = childNumber(el, "divisions", divisions) || divisions
            break
          }
          case "backup": {
            position -= childNumber(el, "duration", 0)
            break
          }
          case "forward": {
            position += childNumber(el, "duration", 0)
            break
          }
          case "note": {
            const id = `${NOTE_ID_PREFIX}${count++}`
            el.setAttribute("id", id)

            const grace = hasChild(el, "grace")
            let onset = position
            if (hasChild(el, "chord")) {
              onset = chordOnset
            } else {
              chordOnset = position
              if (!grace) {
                position += childNumber(el, "duration", 0)
              }
            }

            const pitch = notePitch(el)
            if (pitch != null) {
              table.set(id, {
                id,
                pitch,
                onsetBeats: measureStart + onset / divisions,
                staff: childNumber(el, "staff", 1),
                voice: childNumber(el, "voice", 1),
              })
            }
            break
          }
        }

        measureLength = Math.max(measureLength, position)
      }

      measureStart += measureLength / divisions
    }
  })

  return {notes: table, measureStarts}
}

export function handStaff(hand: Hand): number | null {
  return hand == "upper" ? 1 : hand == "lower" ? 2 : null
}

function staffOf(el: Element): string {
  return childText(el, "staff") || "1"
}

function setStaff(el: Element, staff: string) {
  for (const child of directChildren(el, "staff")) {
    child.textContent = staff
  }
}

// a <forward> of the given duration in a voice, holding its time where a
// note of the other staff was (OSMD advances a voice only over a forward of
// that voice)
function voiceForward(doc: XMLDocument, duration: number, voice: string | null): Element {
  const forward = doc.createElement("forward")
  const durationEl = doc.createElement("duration")
  durationEl.textContent = String(duration)
  forward.appendChild(durationEl)
  if (voice != null) {
    const voiceEl = doc.createElement("voice")
    voiceEl.textContent = voice
    forward.appendChild(voiceEl)
  }
  return forward
}

// Draws one staff of the score alone: every note of the other staff is
// taken out (a chord it leads is replaced by a <forward> of its duration, so
// the notes after it keep their onsets), directions written for the other
// staff go with them, and the part is left with one staff in the kept one's
// clef, key and layout
export function keepStaff(doc: XMLDocument, keep: number) {
  const kept = String(keep)

  for (const part of parts(doc)) {
    for (const measure of directChildren(part, "measure")) {
      let chord: Element[] = []
      const chords: Element[][] = []
      for (const el of Array.from(measure.children)) {
        if (el.tagName != "note") { continue }
        if (!hasChild(el, "chord") || !chord.length) {
          chord = []
          chords.push(chord)
        }
        chord.push(el)
      }

      for (const notes of chords) {
        const keeping = notes.filter(note => staffOf(note) == kept)
        const lead = notes[0]

        if (!keeping.length) {
          const duration = childNumber(lead, "duration", 0)
          if (!hasChild(lead, "grace") && duration > 0) {
            measure.insertBefore(voiceForward(doc, duration, childText(lead, "voice")), lead)
          }
        } else if (keeping[0] != lead) {
          // a chord across the staves led from the dropped one
          for (const chordEl of directChildren(keeping[0], "chord")) {
            keeping[0].removeChild(chordEl)
          }
        }

        for (const note of notes) {
          if (keeping.includes(note)) {
            setStaff(note, "1")
          } else {
            measure.removeChild(note)
          }
        }
      }

      for (const el of directChildren(measure, "direction")) {
        if (!hasChild(el, "staff")) { continue }
        if (staffOf(el) == kept) {
          setStaff(el, "1")
        } else {
          measure.removeChild(el)
        }
      }

      for (const el of [...directChildren(measure, "backup"), ...directChildren(measure, "forward")]) {
        setStaff(el, "1")
      }

      const numbered = [
        ...directChildren(measure, "attributes").flatMap(attributes => Array.from(attributes.children)),
        ...directChildren(measure, "print").flatMap(print => directChildren(print, "staff-layout")),
      ]

      for (const el of numbered) {
        if (el.tagName == "staves") {
          el.textContent = "1"
          continue
        }

        const number = el.getAttribute("number")
        if (number == null) { continue }
        if (number == kept) {
          el.removeAttribute("number")
        } else {
          el.parentNode?.removeChild(el)
        }
      }
    }
  }
}

export function prepareCard(musicXML: string, {fromMeasure, toMeasure, hand}: {
  fromMeasure: number, toMeasure: number, hand: Hand
}): PreparedCard {
  const doc = parseMusicXML(musicXML)
  const positions = measurePositions(doc, Math.min(fromMeasure, toMeasure), Math.max(fromMeasure, toMeasure))
  if (!positions) {
    throw new Error(`The score has no measures ${fromMeasure}–${toMeasure}`)
  }

  const {notes, measureStarts} = tagNotes(doc)
  const keep = handStaff(hand)
  if (keep != null) {
    keepStaff(doc, keep)
  }

  return {
    xml: new XMLSerializer().serializeToString(doc),
    firstIndex: positions[0],
    lastIndex: positions[1],
    notes,
    measureStarts,
  }
}

// rounds an onset so a note matched from another engine's arithmetic lands
// on the same key
export function onsetKey(staff: number, pitch: number, onsetBeats: number): string {
  return `${staff}:${pitch}:${Math.round(onsetBeats * 960)}`
}
