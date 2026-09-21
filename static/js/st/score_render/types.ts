// The contract every engraving engine behind st/score_render implements: a
// card is a measure range of a piece's source MusicXML drawn to a plate
// width, a system the same range drawn on one line however long, and every
// note head either draws comes back with what the trainer needs to find it
// again

export type Hand = "both" | "upper" | "lower"

// one staff of the score: its part's id and the staff's number in it, from 1
export interface ScoreStaff {
  part: string
  staff: number
}

export interface CardOptions {
  musicXML: string
  // the score's printed bar numbers, inclusive (a leading pickup is 0)
  fromMeasure: number
  toMeasure: number
  // upper and lower are the part's first and second staff, drawn alone
  hand: Hand
  // the staves drawn, in place of hand's: every other staff is taken out,
  // and a part none of whose staves is drawn with it
  staves?: ScoreStaff[] | null
  // the plate width in CSS pixels, eg. 644 or 926
  width: number
  // the start of each of the score's measures by position, in quarter notes,
  // eg. the song model's metadata.measureStarts: the notes' onsets are then
  // counted on the same clock as the columns the trainer detects (see
  // ./card_join). Left out, measures start where the first part ends them
  measureStarts?: number[] | null
}

// a system is drawn on one line, so it has no plate width to fit
export type SystemOptions = Omit<CardOptions, "width">

export interface CardNote {
  // the same note has the same id whichever engine drew it
  id: string
  // MIDI note number, middle C is 60
  pitch: number
  // quarter notes from the start of the score
  onsetBeats: number
  // the score staff the note is on, 1 upper, 2 lower, even when one hand is
  // drawn alone
  staff: number
  // the MusicXML voice
  voice: number
  // the drawn head, live in the returned svg
  el: SVGGElement
}

export interface CardResult {
  svg: SVGSVGElement
  notes: CardNote[]
}

export interface ScoreEngine {
  name: string
  version: string
  licence: string
  renderCard(opts: CardOptions): Promise<CardResult>
  // the range as one system with no line breaks, its svg as wide as the
  // music needs, for a trainer that slides it past a fixed line
  renderSystem(opts: SystemOptions): Promise<CardResult>
}
