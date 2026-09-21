// The score page: practising an imported piece. It is the sight reading
// trainer (st/components/pages/sight_reading_page) with the score's programme
// in place of the exercises': the page owns which piece, which measures and
// which hand are drilled, in its own drawer, and the trainer hands each card
// of them to the staff to draw

import * as React from "react"

import SightReadingPage from "st/components/pages/sight_reading_page"
import {ScoreDrawer} from "st/components/sight_reading/settings_panel"
import {STAVES, SHEET_MUSIC_GENERATOR, sheetMusicPiece, sheetMusicStaffFor} from "st/data"
import {pieceSong} from "st/sheet_music_deck"
import {staffTracks} from "st/song_sections"
import {
  generatorDefaultSettings, allKeySignatures, SCORE_DRILL_STORAGE_KEY
} from "st/generators"

// The staff a piece is drilled on, which the score decides in place of a
// clef setting: the grand staff for a piece with both a treble and a bass
// staff, so neither hand is skipped, the lone staff of a piece with one, and
// the grand staff for pasted notation. settings are the sheet music
// generator's, defaults filled in
export function scoreStaff(settings, staves=STAVES) {
  let piece = sheetMusicPiece(settings)
  let song = piece && pieceSong(piece)
  let name = "grand"

  if (song && !sheetMusicStaffFor(song)) {
    let {treble, bass} = staffTracks(song)
    name = bass.length && !treble.length ? "bass" : "treble"
  }

  return staves.find(staff => staff.name == name)
}

export const SCORE_PROGRAMME = {
  title: "Sheet music",
  idleTitle: {title: "Sheet music", italic: "pick a piece in the programme"},
  storageKey: SCORE_DRILL_STORAGE_KEY,
  generators: [SHEET_MUSIC_GENERATOR],
  Drawer: ScoreDrawer,
  initialStaff: () => scoreStaff(generatorDefaultSettings(SHEET_MUSIC_GENERATOR)),
  // a piece without a key the trainer can draw in is drawn in C major
  userKey: () => allKeySignatures()[0],
  staffFor: settings => scoreStaff(settings),
}

// the midi input's messages reach the trainer through the forwarded ref
const ScorePage = React.forwardRef((props, ref) =>
  <SightReadingPage ref={ref} {...props} programme={SCORE_PROGRAMME} />
)

ScorePage.displayName = "ScorePage"

export default ScorePage
