// The score page: practising an imported piece. It is the sight reading
// trainer (st/components/pages/sight_reading_page) with the score's programme
// in place of the exercises': the page owns which piece, which measures and
// which hand are drilled, in its setup pane (always on the right, never a
// drawer), and the trainer hands each card of them to the staff to draw: the
// piece's own score, drawn by an engraving engine from its source MusicXML
// (st/components/score_card), card by card in wait mode and the section on
// one line in scroll mode, save a bar today's programme offers as one hand
// alone, drawn as its own one-bar system of that hand, else the app's staff.
// At rest the page is the piece's own score (st/components/sight_reading/
// score_view), paginated a page of whole systems at a time and shaded by
// learnedness, this session's marks or the score's difficulty; Begin
// replaces it with the session, where Rest only pauses and End session
// returns to the score with the session marked on it.
// A piece is practised freely, a section picked in the setup pane, or in
// today's programme, the planned session of st/srs/planner (the default
// once the piece is in study)

import * as React from "react"

import SightReadingPage from "st/components/pages/sight_reading_page"
import {ScoreView} from "st/components/sight_reading/score_view"
import {SessionRail} from "st/components/sight_reading/session_rail"
import {
  STAVES, SHEET_MUSIC_GENERATOR, sheetMusicPiece, sheetMusicStaffFor
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

export const SCORE_PROGRAMME = {
  title: "Sheet music",
  idleTitle: {title: "Sheet music", italic: "import a piece to begin"},
  storageKey: SCORE_DRILL_STORAGE_KEY,
  generators: [SHEET_MUSIC_GENERATOR],
  // no Programme pill or drawer: the setup pane, always on the right at
  // rest (ScoreView), replaces it
  Drawer: null,
  initialStaff: () => scoreStaff(generatorDefaultSettings(SHEET_MUSIC_GENERATOR)),
  // a piece without a key the trainer can draw in is drawn in C major
  userKey: () => allKeySignatures()[0],
  staffFor: settings => scoreStaff(settings),
  // a piece with its source stored is drawn from its score
  engine: "osmd",
  // the score view at rest, the session rail in session (restPauses, below)
  ScoreView,
  SessionRail,
  // Rest only pauses; End session is a separate action, back to ScoreView
  restPauses: true,
  // the design's wider frame (score left, setup pane right), see
  // sight_reading_page.module.css's .score_layout
  scoreLayout: true,
  // opts into acoustic mode (st/srs/self_grade): a self-graded pass in place
  // of detection, while the instrument setting is acoustic
  selfGrading: true,
  // no focusGenerator (the sheet music generator can't take a weak-note
  // seed, see SightReadingPage#practiseNotes) and no newProgramme: this
  // page never opens the exercises page's session summary at all
  // (restPauses), so neither applies
}

// the midi input's messages reach the trainer through the forwarded ref; a
// spec may hand it another programme, eg. without the engine
const ScorePage = React.forwardRef((props, ref) =>
  <SightReadingPage ref={ref} programme={SCORE_PROGRAMME} {...props} />
)

ScorePage.displayName = "ScorePage"

export default ScorePage
