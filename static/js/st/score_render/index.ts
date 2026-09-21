// The engines bundle (score_engines.js): both engraving engines behind the
// card contract of ./types. It is its own entry, loaded only by the pages
// that draw with an engine (see ./load.js), so no other page downloads an
// engine

import {osmdEngine} from "./osmd"
import {verovio, verovioReady} from "./verovio"
import type {ScoreEngine} from "./types"

export type {CardOptions, CardNote, CardResult, Hand, ScoreStaff, ScoreEngine} from "./types"
export {prepareCard, keepStaff, measurePositions, tagNotes} from "./card_source"

export const ENGINES: {[key: string]: ScoreEngine} = {
  osmd: osmdEngine,
  verovio,
}

// resolves once every engine can draw, so a first card's time is the
// engine's drawing, not its download
export async function enginesReady(): Promise<void> {
  await verovioReady()
}
