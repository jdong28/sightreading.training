// The contract every engraving engine behind st/score_render implements: a
// card is a measure range of a piece's source MusicXML drawn to a plate
// width, and every note head it draws comes back with what the trainer
// needs to find it again

export type Hand = "both" | "upper" | "lower"

export interface CardOptions {
  musicXML: string
  // the score's printed bar numbers, inclusive (a leading pickup is 0)
  fromMeasure: number
  toMeasure: number
  // upper and lower are the part's first and second staff, drawn alone
  hand: Hand
  // the plate width in CSS pixels, eg. 644 or 926
  width: number
  // the start of each of the score's measures by position, in quarter notes,
  // eg. the song model's metadata.measureStarts: the notes' onsets are then
  // counted on the same clock as the columns the trainer detects (see
  // ./card_join). Left out, measures start where the first part ends them
  measureStarts?: number[] | null
}

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
}
