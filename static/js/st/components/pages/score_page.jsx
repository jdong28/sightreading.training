// The score page: practising an imported piece. It is the sight reading
// trainer (st/components/pages/sight_reading_page) with the score's programme
// in place of the exercises': the page owns which piece, which measures and
// which hand are drilled, in its own drawer, and the trainer hands each card
// of them to the staff to draw: the piece's own score, drawn by an engraving
// engine from its source MusicXML (st/components/score_card), card by card in
// wait mode and the section on one line in scroll mode, else the app's staff.
// A piece is practised freely, a section picked in the drawer, or in today's
// programme, the planned session of st/srs/planner (the default once the
// piece is in study), which the "Tonight's programme" plate prefaces

import * as React from "react"

import SightReadingPage from "st/components/pages/sight_reading_page"
import {ScoreDrawer} from "st/components/sight_reading/settings_panel"
import {ProgrammePlate} from "st/components/sight_reading/programme_plate"
import {
  STAVES, SHEET_MUSIC_GENERATOR, PROGRAMME_PRACTICE, sheetMusicPiece, sheetMusicStaffFor
} from "st/data"
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

// the settings for playing another piece's programme
function programmeOf(settings, id) {
  let input = SHEET_MUSIC_GENERATOR.inputs.find(input => input.name == "piece")
  return {...input.pick(settings, id).settings, practice: PROGRAMME_PRACTICE}
}

// the plate before a planned session, see st/components/sight_reading/programme_plate
function ScorePreface(props) {
  return <ProgrammePlate pickPiece={programmeOf} {...props} />
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
  // a piece with its source stored is drawn from its score
  engine: "osmd",
  Preface: ScorePreface,
}

// the midi input's messages reach the trainer through the forwarded ref; a
// spec may hand it another programme, eg. without the engine
const ScorePage = React.forwardRef((props, ref) =>
  <SightReadingPage ref={ref} programme={SCORE_PROGRAMME} {...props} />
)

ScorePage.displayName = "ScorePage"

export default ScorePage
