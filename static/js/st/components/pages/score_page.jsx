// The score page: practising an imported piece. It is the sight reading
// trainer (st/components/pages/sight_reading_page) with the score's
// programme in place of the exercises': the page owns which piece, which
// measures and which hand are drilled, and the trainer hands each card of
// them to the staff to draw: the piece's own score, drawn by an engraving
// engine from its source MusicXML (st/components/score_card), card by card
// in wait mode and the section on one line in scroll mode, save a bar
// today's programme offers as one hand alone, drawn as its own one-bar
// system of that hand, else the app's staff.
//
// At rest the page is the score itself (score-first design,
// st/components/sight_reading/score_view), one page of whole systems at a
// time, beside "Tonight's session" (setup_pane), which replaces the old
// Programme drawer and rail plates. Begin replaces the view with the
// session (session_rail in place of the default rail); Rest pauses in
// place (restPauses) and End session returns to the score view with the
// session's accuracy marked on each bar played.
//
// A piece is practised freely, a section picked in the setup pane, or in
// today's programme, the planned session of st/srs/planner (the default
// once the piece is in study)

import * as React from "react"
import {useSearchParams} from "react-router-dom"

import SightReadingPage from "st/components/pages/sight_reading_page"
import {ScoreView} from "st/components/sight_reading/score_view"
import {SessionRail} from "st/components/sight_reading/session_rail"
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

// the settings for playing another piece's programme, see the setup pane's
// suggestion ("{title} has the most bars due")
export function programmeOf(settings, id) {
  let input = SHEET_MUSIC_GENERATOR.inputs.find(input => input.name == "piece")
  return {...input.pick(settings, id).settings, practice: PROGRAMME_PRACTICE}
}

export const SCORE_PROGRAMME = {
  title: "Sheet music",
  idleTitle: {title: "Sheet music", italic: "import a piece to begin"},
  storageKey: SCORE_DRILL_STORAGE_KEY,
  generators: [SHEET_MUSIC_GENERATOR],
  Drawer: null,
  ScoreView,
  SessionRail,
  restPauses: true,
  scoreLayout: true,
  initialStaff: () => scoreStaff(generatorDefaultSettings(SHEET_MUSIC_GENERATOR)),
  // a piece without a key the trainer can draw in is drawn in C major
  userKey: () => allKeySignatures()[0],
  staffFor: settings => scoreStaff(settings),
  // a piece with its source stored is drawn from its score
  engine: "osmd",
  // opts into acoustic mode (st/srs/self_grade): a self-graded pass in place
  // of detection, while the instrument setting is acoustic
  selfGrading: true,
  pickPiece: programmeOf,
  // no focusGenerator: the sheet music generator can't take a weak-note
  // seed, see SightReadingPage#practiseNotes. The page never rests into the
  // exercises' rest strip (restPauses): its End session leaves the ended
  // strip on the score instead
}

// the midi input's messages reach the trainer through the forwarded ref; a
// spec may hand it another programme, eg. without the engine.
// /sheet-music?bar=N asks for bar N's window to be opened, which Today's bars
// do: used once, then taken out of the address (replacing the history entry),
// as the score view is drawn again after every Begin and End session
const ScorePage = React.forwardRef((props, ref) => {
  let [params, setParams] = useSearchParams()
  let bar = params.get("bar")
  let openBar = bar != null && /^\d+$/.test(bar) ? Number(bar) : undefined
  let onBarOpened = React.useCallback(() => {
    setParams(current => {
      current.delete("bar")
      return current
    }, {replace: true})
  }, [setParams])

  return <SightReadingPage ref={ref} programme={SCORE_PROGRAMME} openBar={openBar} onBarOpened={onBarOpened} {...props} />
})

ScorePage.displayName = "ScorePage"

export default ScorePage
