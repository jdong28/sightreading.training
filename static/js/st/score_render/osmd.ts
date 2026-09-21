// The card contract drawn by OpenSheetMusicDisplay (BSD-3-Clause), bundled
// into the engines bundle. OSMD lays a score out in a container it measures,
// so each loaded score keeps an offscreen host of the plate's width; its
// notes carry no MusicXML ids, so each drawn head is matched back to the
// note table of card_source by staff, pitch and onset

import {OpenSheetMusicDisplay} from "opensheetmusicdisplay"

import {prepareCard, onsetKey} from "./card_source"
import type {SourceNote} from "./card_source"
import type {CardOptions, CardResult, CardNote, ScoreEngine} from "./types"

export const OSMD_VERSION = "2.1.3"

// OSMD's staff space is 10px at zoom 1
const ZOOM = 0.8

let osmd: OpenSheetMusicDisplay | null = null
let host: HTMLDivElement | null = null
let loadedXML: string | null = null

function engine(width: number): OpenSheetMusicDisplay {
  if (!host) {
    host = document.createElement("div")
    host.setAttribute("aria-hidden", "true")
    Object.assign(host.style, {
      position: "absolute", left: "-100000px", top: "0", visibility: "hidden",
    })
    document.body.appendChild(host)
  }
  host.style.width = `${width}px`

  if (!osmd) {
    osmd = new OpenSheetMusicDisplay(host, {
      autoResize: false,
      backend: "svg",
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMeasureNumbers: true,
      followCursor: false,
    })
  }
  return osmd
}

// the notes of the table by where OSMD will say they are
function notesByOnset(notes: Map<string, SourceNote>): Map<string, SourceNote[]> {
  const byOnset = new Map<string, SourceNote[]>()
  for (const note of notes.values()) {
    const key = onsetKey(note.staff, note.pitch, note.onsetBeats)
    if (!byOnset.has(key)) { byOnset.set(key, []) }
    byOnset.get(key)!.push(note)
  }
  return byOnset
}

// the head of a graphical note: its own notehead group among its chord's
// (VexFlow draws them in the order of its keys, which vfnoteIndex counts), or
// the whole VexFlow note when it has none
function headElement(graphicalNote: any): SVGGElement | null {
  const heads = graphicalNote.getNoteheadSVGs ? graphicalNote.getNoteheadSVGs() : null
  if (heads && heads.length) {
    return (heads[graphicalNote.vfnoteIndex] || heads[0]) as SVGGElement
  }
  return graphicalNote.getSVGGElement ? graphicalNote.getSVGGElement() : null
}

async function renderCard(opts: CardOptions): Promise<CardResult> {
  const card = prepareCard(opts.musicXML, opts)
  const display = engine(opts.width)

  if (card.xml != loadedXML) {
    loadedXML = null
    await display.load(card.xml)
    loadedXML = card.xml
  }

  display.zoom = ZOOM
  // OSMD's own measure options count positions but shift them for a
  // leading pickup, so the range is set by position on its rules directly
  const rules = display.EngravingRules
  rules.MinMeasureToDrawNumber = 0
  rules.MaxMeasureToDrawNumber = 0
  rules.MinMeasureToDrawIndex = card.firstIndex
  rules.MaxMeasureToDrawIndex = card.lastIndex
  display.render()

  const svg = host!.querySelector("svg")
  if (!svg) {
    throw new Error("OSMD drew nothing")
  }

  const instruments = display.Sheet.Instruments
  const byOnset = notesByOnset(card.notes)
  const notes: CardNote[] = []
  let unmatched = 0

  for (const measures of display.GraphicSheet.MeasureList) {
    for (const measure of measures) {
      if (!measure) { continue }
      for (const staffEntry of measure.staffEntries) {
        for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const graphicalNote of voiceEntry.notes) {
            const source = graphicalNote.sourceNote
            if (!source || source.isRest() || !source.Pitch) { continue }

            const el = headElement(graphicalNote)
            if (!el || !svg.contains(el)) { continue }

            const instrument = source.ParentStaff.ParentInstrument
            const staffIdx = instrument.Staves.indexOf(source.ParentStaff)
            const staff = card.partStaves[instruments.indexOf(instrument)]?.[staffIdx] ?? staffIdx + 1
            // OSMD's half tones count from C0
            const pitch = source.Pitch.getHalfTone() + 12
            // OSMD sums its own measure lengths, which a measure ending in a
            // <forward> shortens, so only its offset within the measure is
            // taken, from the measure's start in the score
            const sourceMeasure = source.SourceMeasure
            const offset = source.getAbsoluteTimestamp().RealValue - sourceMeasure.AbsoluteTimestamp.RealValue
            const measureStart = card.measureStarts[sourceMeasure.measureListIndex]
            const onsetBeats = (measureStart ?? sourceMeasure.AbsoluteTimestamp.RealValue * 4) + offset * 4

            const match = byOnset.get(onsetKey(staff, pitch, onsetBeats))?.shift()
            if (match) {
              notes.push({...match, el})
            } else {
              notes.push({
                id: `osmd-unmatched-${unmatched++}`,
                pitch, onsetBeats, staff,
                voice: source.ParentVoiceEntry.ParentVoice.VoiceId,
                el,
              })
            }
          }
        }
      }
    }
  }

  // the card leaves OSMD's host, which the next render draws into afresh
  svg.remove()
  return {svg, notes}
}

export const osmdEngine: ScoreEngine = {
  name: "OpenSheetMusicDisplay",
  version: OSMD_VERSION,
  licence: "BSD-3-Clause",
  renderCard,
}
