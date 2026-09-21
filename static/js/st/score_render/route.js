// The engraving engines page's route, kept apart from the page so other
// pages can link to it without bundling the page or the engines

import {RIGHT_HAND, LEFT_HAND} from "st/data"

// the page opened on the piece, measures and hand of the sheet music
// generator's settings
export function scoreEnginesPath(settings={}) {
  let params = new URLSearchParams()
  if (settings.piece) { params.set("piece", settings.piece) }
  if (settings.startMeasure != null) { params.set("from", settings.startMeasure) }
  if (settings.endMeasure != null) { params.set("to", settings.endMeasure) }
  if (settings.hand == RIGHT_HAND) { params.set("hand", "upper") }
  if (settings.hand == LEFT_HAND) { params.set("hand", "lower") }
  let query = params.toString()
  return `/score-engines${query ? `?${query}` : ""}`
}
