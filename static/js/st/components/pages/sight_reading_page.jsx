import NoteList from "st/note_list"
import NoteMatcher from "st/note_matcher"
import ChordList from "st/chord_list"
import NoteStats, {staffClefs} from "st/note_stats"
import SlideToZero from "st/slide_to_zero"
import Keyboard, {KeyboardInput} from "st/components/keyboard"
import StatsLightbox from "st/components/sight_reading/stats_lightbox"
import DevMetricsPanel from "st/components/sight_reading/dev_metrics_panel"
import SelfGradeRow from "st/components/sight_reading/self_grade_row"
import SelfGradeReceipt from "st/components/sight_reading/self_grade_receipt"
import PlateFeedback from "st/components/sight_reading/plate_feedback"
import {SessionSummary} from "st/components/sight_reading/session_summary"
import Hotkeys from "st/components/hotkeys"

import styles from "./sight_reading_page.module.css"
import staffStyles from "st/components/staff.module.css"
import devMetricsStyles from "st/components/sight_reading/dev_metrics_panel.module.css"

import {noteName, parseNote, displayNoteName, romanNumeral} from "st/music"
import {
  STAVES, GENERATORS, sheetMusicPiece, handTracks, handSetting, drilledRange, sectionDroppedPitches, RIGHT_HAND, LEFT_HAND,
} from "st/data"
import {pieceSong, pieceSource} from "st/sheet_music_deck"
import {parseMusicXML} from "st/musicxml"
import {getAppStore} from "st/storage"
import {
  ProgrammeDrawer, generatorLabel, staffLabel, keyLabel
} from "st/components/sight_reading/settings_panel"
import {
  Plate, Pill, StatCard, TitleBlock, FleuronRule, PullQuote, SectionLabel
} from "st/components/salon"
import {HEADER_ACTIONS_ID} from "st/components/header"
import {devMetricsState, storeDevMetricsOpen} from "st/dev_metrics"
import {setTitle, gaEvent, csrfToken} from "st/globals"
import {dispatch, trigger} from "st/events"
import {NOTE_EVENTS} from "st/midi"
import {
  generatorDefaultSettings, storeCurrentDrill, currentStaffFor, currentGeneratorFor,
  currentKeySignature, currentDrillMode, currentScrollSpeed, currentScrollTempo, scoreKeySignature,
  storeGeneratorSettings, DRILL_STORAGE_KEY
} from "st/generators"
import {SELF_GRADES, SELF_GRADE_FLASH_MS} from "st/srs/self_grade"
import {SELF_ASPECTS} from "st/srs/records"
import {AGAIN} from "st/srs/grade"
import {troubleNotes, focusFromRows} from "st/session_summary"

import * as React from "react"
import {createPortal} from "react-dom"
import classNames from "classnames"
import NoSleep from "nosleep.js"

import {isMobile} from "st/browser"

import {getSession} from "st/app"

import {StaffTwo} from "st/components/staff_two"
import {ScoreCard} from "st/components/score_card"
import {loadScoreEngines} from "st/score_render/load"
import {joinable} from "st/score_render/card_join"
import {SCROLL_WAIT, TEMPO_TOLERANCE} from "st/score_render/card_scroll"

const DEFAULT_NOTE_WIDTH = 100
const DEFAULT_SPEED = 4

// the widest range a MIDI keyboard can send, used in place of a staff's own
// range while the engine draws an imported piece's columns (T1): the engine
// draws every note of the source regardless of what the staff can show, so
// detection must cover it too
const FULL_KEYBOARD_RANGE = ["A0", "C8"]

// the height the new renderer paints the staff at inside the staff plate
const STAFF_TWO_HEIGHT = 150

// both renderers draw the staff this much smaller inside the staff plate
export const PLATE_STAFF_SCALE = 0.8

// the staff's scale for the window's width: the legacy renderer draws at
// it, and StaffTwo spaces its columns by it too (see its columnDx)
function staffScale() {
  return (window.innerWidth < 1000 ? 0.8 : 1) * PLATE_STAFF_SCALE
}

// Kwiatkowski's watercolour "Chopin's Polonaise, a ball at the Hôtel Lambert
// in Paris" (1859), public domain (the author died in 1891): resized from
// https://commons.wikimedia.org/wiki/File:Kwiatkowski_Chopin%27s_Polonaise.jpg
const SALON_IMAGE = "/static/img/hotel_lambert_soiree.jpg"

export const PULL_QUOTE = "Read ahead by one column. The hands must trail the eyes, never lead them."

const HAND_LABELS = {
  [RIGHT_HAND]: "right hand",
  [LEFT_HAND]: "left hand",
}

// seconds -> "m:ss"
export function formatElapsed(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0))
  let minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

// the rounded percentage of notes read, or null before any note is played
export function accuracyPercent(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

function measuresLabel(start, end) {
  return start == end ? `measure ${start}` : `measures ${start}–${end}`
}

// eg. "Card 3 · measures 5–6 of 1–16", or the measures of the whole section
// without a card number
export function cardLabel(card, cardNumber, section) {
  if (!card || cardNumber == null) {
    return measuresLabel(section.startMeasure, section.endMeasure)
  }

  let range = section.startMeasure == section.endMeasure ?
    `${section.startMeasure}` : `${section.startMeasure}–${section.endMeasure}`

  return `Card ${cardNumber} · ${measuresLabel(card.startMeasure, card.endMeasure)} of ${range}`
}

// What a trainer page drills. The trainer (the page's detection, cards,
// modes, stats and staff) is the same on every page; a programme
// says which generators it offers, how their settings are picked and where
// they're kept. This one, the default, is the exercises page's: a staff,
// exercise and key picked in the programme drawer or on /setup. The score
// page's, which drills an imported piece, is in st/components/pages/score_page
export const EXERCISES_PROGRAMME = {
  // the document title, the app's own when not set
  title: null,
  // where storeCurrentDrill keeps the page's staff, generator, key, mode and
  // scroll speed
  storageKey: DRILL_STORAGE_KEY,
  generators: GENERATORS,
  // the settings drawer, handed the trainer's settings and their setters
  Drawer: ProgrammeDrawer,
  // the staff the page opens on
  initialStaff: () => currentStaffFor(STAVES),
  // the key drawn when the generator doesn't draw in its own
  userKey: () => currentKeySignature(),
  // draws the staff with StaffTwo (at height 150 inside the plate) rather
  // than the legacy renderer; the score page leaves this unset, so its
  // engine cards and app-staff fallback are unaffected
  staffTwo: true,
  // the session summary card's (st/components/sight_reading/session_summary)
  // "Practise these notes" switches to this generator, focused on the rows
  // shown (see practiseNotes); unset, as the score page leaves it, hides
  // that pill, since the sheet music generator can't take a seed
  focusGenerator: GENERATORS.find(generator => generator.name == "random"),
  // the session summary's "New programme" destination, a path rendered as
  // a link; unset, as the score page leaves it, closes the card and opens
  // the programme drawer instead (see newProgramme)
  newProgramme: "/setup",

  // Optional:
  // idleTitle, the page title's {title, italic} while no piece is drilled, in
  // place of the exercise's name and key.
  // staffFor(settings), the staff the generator's settings (defaults filled
  // in) are drawn on, which then follows them in place of a clef setting.
  // engine, the key of the engraving engine (st/score_render) that draws an
  // imported piece's cards from its source MusicXML, in place of the app's
  // own staff (see engineCard): in wait mode card by card, in scroll mode the
  // whole section on one line, save a bar today's programme offers as one
  // hand alone, drawn as its own one-bar system
  // ScoreView, a component the trainer renders in place of its own grid
  // while state.view == "score" (at rest, see the score page): the score
  // itself beside "Tonight's session", replacing the drawer and the rail.
  // Unset here, so the trainer renders as today, which is also how specs
  // reach its internals on the score page: they pass
  // {...SCORE_PROGRAMME, ScoreView: null}.
  // SessionRail, a component rendered as the trainer's rail in place of
  // renderRail() while a ScoreView page is in session (see the score page's
  // "This session"), handed the current settings and generator, the
  // session log and the elapsed seconds.
  // restPauses, true for Rest to pause in place (pauseSession/
  // resumeSession) rather than end the session, with End session added to
  // end it outright, returning to the score view; see the score page.
  // scoreLayout, true for a wider trainer and flex columns in place of the
  // grid (see the score page), which sets .score_layout on the page root.
  //
  // A generator may also name what it plays (all optional): sectionLabel(),
  // the title's words for its measures; cardLabel(), the plate's for its
  // card; statusLine(), the status line while the session runs; caption(), a
  // line under the staff after a pass through its card; selfReceipt(), what
  // a self-graded pass recorded (st/srs/self_grade), which replaces caption()
  // in acoustic mode.
  // selfGrading, true to opt into acoustic mode (st/srs/self_grade) while the
  // instrument setting is acoustic: nothing is detected, the player plays
  // the card and grades the pass themself. This page ignores it.
}

export const MISSING_ENGINE_SOURCE = "Drawn on the trainer's staff: this piece was imported " +
  "before the app kept each piece's score. Import its file again in the programme (its stats are " +
  "kept) to practise from the engraved score."

export const FAILED_ENGINE_SOURCE = "Drawn on the trainer's staff: this piece's score couldn't be " +
  "engraved. Importing its file again in the programme (its stats are kept) may bring the score back."

// the score staff each track of the score's song model reads (see
// st/musicxml), null when the score can't be read
function trackStaves(musicXML) {
  try {
    return parseMusicXML(musicXML).tracks.map(track => track.scoreStaff)
  } catch (err) {
    console.warn("Couldn't read the piece's score", err)
    return null
  }
}

export default class SightReadingPage extends React.Component {
  static defaultProps = {
    programme: EXERCISES_PROGRAMME,
    // where an imported piece's source MusicXML is read, and the engines
    // that draw it are loaded, for the programme's engine
    readSource: pieceSource,
    loadEngines: loadScoreEngines,
  }

  constructor(props) {
    super(props);

    this.programme = props.programme

    this.pressNote = this.pressNote.bind(this)
    this.releaseNote = this.releaseNote.bind(this)
    this.onFullscreenChange = this.onFullscreenChange.bind(this)
    this.onPageHide = () => this.recordSession()
    this.onResize = () => {
      let scale = staffScale()
      if (scale != this.state.scale) {
        this.setState({scale})
      }
    }
    this.setStaffWrapper = el => this.observeStaffWrapper(el)
    // the engine's card is the staff the slider moves, from where it is now
    this.setEngineStaff = card => {
      this.staff = card
      if (card && this.state.slider) { card.setOffset(this.state.slider.value) }
    }
    this.openSettings = () => this.setState({settingsOpen: true})
    this.closeSettings = () => this.setState({settingsOpen: false})
    this.applySettings = () => {
      this.closeSettings()
      if (this.state.currentGenerator) {
        this.refreshNoteList()
      }
    }
    // Rest/Resume, the transport's one pill: on a page with restPauses
    // (the score page) it pauses and resumes in place; elsewhere Rest ends
    // the session outright, as today
    this.toggleSession = e => {
      // so the space bar skips a note instead of pressing the pill again
      if (e && e.currentTarget) { e.currentTarget.blur() }
      if (this.programme.restPauses) {
        if (this.state.paused) {
          this.resumeSession()
        } else if (this.state.session) {
          this.pauseSession()
        } else {
          this.begin()
        }
        return
      }
      if (this.state.session) {
        this.restSession()
      } else {
        this.beginSession()
      }
    }
    this.begin = this.begin.bind(this)
    this.pauseSession = this.pauseSession.bind(this)
    this.resumeSession = this.resumeSession.bind(this)
    this.endSession = this.endSession.bind(this)
    this.playOn = this.playOn.bind(this)
    this.skipReadThrough = this.skipReadThrough.bind(this)
    this.dismissEnded = this.dismissEnded.bind(this)
    this.setCurrentSettings = this.setCurrentSettings.bind(this)

    // the grade row of acoustic mode, which the grade hotkeys go through
    this.selfGradeRow = React.createRef()

    // the grade tapped, flashed for SELF_GRADE_FLASH_MS before it is written
    // (see selfGrade/writeSelfGrade): {grade, opts, time, generator, timer}
    this.pendingSelfGrade = null
    // set while a self grade is being written, see writeSelfGrade
    this.grading = false

    // D4(c), the "Keep tempo" setting: whether anything has been played
    // since Begin or the drill was last rebuilt, read by headWaits so an
    // opening column still waits however long the setting is on (see
    // followHead)
    this.playedThisSegment = false

    // the session summary card is a native <dialog>, but its own controls
    // (eg. the "See all progress" link) aren't input/button/textarea, so
    // Hotkeys would otherwise still send space/1-4 through to the drill
    // underneath while it's open
    this.keyMap = {
      " ": e => { if (!this.state.summary && !this.scoreAtRest()) { this.skipCurrentNote() } },
      "1": e => { if (!this.state.summary && !this.scoreAtRest()) { this.selfGradeHotkey(1) } },
      "2": e => { if (!this.state.summary && !this.scoreAtRest()) { this.selfGradeHotkey(2) } },
      "3": e => { if (!this.state.summary && !this.scoreAtRest()) { this.selfGradeHotkey(3) } },
      "4": e => { if (!this.state.summary && !this.scoreAtRest()) { this.selfGradeHotkey(4) } },
    }

    // the key the user picked, drawn unless the generator sets its own
    this.userKey = this.programme.userKey()

    // Detection lives in the matcher (st/note_matcher): every MIDI event is
    // fed to it synchronously, one at a time, and it owns the keys down, the
    // keys touched and the head column. The page renders what it returns
    this.matcher = new NoteMatcher(null, {onEvent: event => this.applyEvent(event)})

    // the developer metrics panel, enabled with ?devMetrics=1 (see
    // st/dev_metrics): invisible unless enabled, and then toggled from the
    // header
    let devMetrics = devMetricsState()
    this.devMetrics = devMetrics.enabled
    this.toggleDevMetrics = () => {
      let devMetricsOpen = !this.state.devMetricsOpen
      storeDevMetricsOpen(devMetricsOpen)
      this.setState({devMetricsOpen})
    }

    this.state = {
      newRenderer: props.useStaffTwo || !!this.programme.staffTwo,
      noteShaking: false,
      anyOctave: false,

      // the matcher's keys down and keys touched, mirrored here for the
      // staff and the keyboard to draw. The matcher is what judges them
      heldNotes: {},
      touchedNotes: {},

      scrollSpeed: currentScrollSpeed(this.programme.storageKey),
      // D4(c): the scroll-mode "Keep tempo" setting, off by default
      tempo: currentScrollTempo(this.programme.storageKey),

      noteWidth: DEFAULT_NOTE_WIDTH,

      bufferSize: 10,
      keyboardOpen: false,
      settingsOpen: false,
      scale: staffScale(),
      // the width the staff wrapper gives the staff, measured once mounted
      staffWidth: null,
      stats: this.newStats(),
      keySignature: this.userKey,

      // the session runs from Begin until Rest; notes played at rest are
      // ignored
      session: false,
      sessionStartedAt: null,
      clockNow: null,

      // restPauses pages (the score page) only: whether Rest paused rather
      // than ended the session (see pauseSession/resumeSession), the score
      // view ("score") or the session ("session") is showing, the record of
      // a session just ended (null at rest, see endSession/dismissEnded),
      // every pass reported since Begin (see setOnPass in refreshNoteList),
      // and the time spent paused so far, and since when if paused now
      view: this.programme.ScoreView ? "score" : "session",
      paused: false,
      ended: null,
      sessionLog: [],
      pausedMs: 0,
      pausedAt: null,

      // the session summary card (st/components/sight_reading/session_summary),
      // opened by Rest alone: null, or {record, eyebrow} (see openSummary)
      summary: null,

      // the source MusicXML of the drilled piece, for the programme's
      // engine: {piece, status: "loading" | "ready" | "missing" | "failed",
      // musicXML, measureStarts}
      engineSource: null,
      // the columns of the engine card a miss was counted on this pass
      engineMissed: [],
      // the pitches the app staff's fallback drops from the drilled section
      // (see droppedStaffNote)
      droppedPitches: new Set(),

      devMetricsOpen: devMetrics.open,

      // acoustic mode: bumped whenever the drill is refilled (see
      // refreshNoteList), which every graded pass and every rebuild of the
      // drill does, so the grade row (keyed by it) starts fresh for the card
      // the refill puts up (see renderSelfGrade)
      cardSeq: 0,
      // acoustic mode: the failing grade whose "Where?" the row has open, or
      // null for the grade pills (see selfAsk)
      selfAsking: null,
      // acoustic mode: {grade, bars} being flashed before it is written (see
      // selfGrade/writeSelfGrade), or null
      selfRecorded: null,

      // bumped once per judgement (a wrong key or chord) to re-light the
      // plate's ink smudge (see PlateFeedback and countMiss)
      smudges: 0,
    }
  }

  // whether the score page's score view is showing (the setup pane, not
  // the session): never true on a page without one (EXERCISES_PROGRAMME)
  scoreAtRest() {
    return !!this.programme.ScoreView && this.state.view == "score"
  }

  // TODO trigger this as watching component
  componentDidUpdate(prevProps, prevState) {
    this.syncMatcher()

    // the instrument setting toggled on a page that can self-grade: nothing
    // detected so far belongs to the rebuilt drill, and its stored mode comes
    // back when detection does. A page that ignores the setting keeps playing
    if (prevProps.acoustic != this.props.acoustic && this.programme.selfGrading) {
      if (!this.selfGraded() && currentDrillMode(this.programme.storageKey) == "scroll") {
        this.enterScrollMode()
      } else {
        this.enterWaitMode()
      }

      this.matcher.clear()
      this.setState({heldNotes: {}, touchedNotes: {}})
      this.refreshNoteList()
    } else if (this.state.mode == "scroll" && this.selfGraded()) {
      // self-graded practice is always wait mode: nothing is detected to
      // scroll by, whether the generator was already self-grading at mount or
      // became one with the piece now on the staff
      this.enterWaitMode()
    }

    // transitioning to new staff or generator or key signature
    if (prevState.currentStaff != this.state.currentStaff ||
        prevState.currentGenerator != this.state.currentGenerator ||
        prevState.currentGeneratorSettings != this.state.currentGeneratorSettings ||
        prevState.keySignature != this.state.keySignature)
    {
      // an imported piece is drawn in the score's key, which isn't stored
      let key = scoreKeySignature(this.state.currentGenerator, this.state.currentStaff, this.state.currentGeneratorSettings) ||
        this.userKey
      if (key.name() != this.state.keySignature.name()) {
        this.setState({keySignature: key, notes: null})
      } else {
        this.refreshNoteList()
      }
    }

    // a rebuilt drill abandons the pass the old generator was collecting
    let before = prevState.notes && prevState.notes.generator
    if (before && before != (this.state.notes && this.state.notes.generator)) {
      this.flushPractice(before)
      this.stopGenerator(before)
    }

    this.updateEngineCard(prevState)
  }

  // Keeps the engine card's inputs in step with the drill: the source of the
  // drilled piece read, and the card the engine draws
  updateEngineCard(prevState) {
    if (!this.programme.engine) { return }

    let drewBefore = this.engineCards(prevState)

    this.loadEngineSource()

    // a piece whose columns can't be joined (stored without the score's
    // rhythm), or whose drilled hand's staves can't be told in the score, is
    // drawn by the app's staff throughout
    let current = this.engineCards() && this.currentCard()
    if (current && (!joinable(current.card.columns) || this.engineStaves() === undefined)) {
      this.setState({engineSource: {...this.state.engineSource, status: "failed"}})
      return
    }

    // whole-keyboard detection (T1) depends on whether the engine actually
    // draws the piece, and today's programme offers a hand alone only once
    // the staff that draws it is known (see handsApart): rebuild the drill
    // when the source settles, whatever it settles to, and whenever the
    // engine takes the piece over or hands it back
    let settled = prevState.engineSource?.status == "loading" &&
      this.state.engineSource?.status != "loading"
    if (settled || drewBefore != this.engineCards()) {
      this.refreshNoteList()
    }
  }

  // The misses marked on the engine card belong to the pass of it being
  // played: the head moving on to another card, back round to this one's
  // start, or on to a rebuilt drill starts it clean. The reset is queued
  // with the advance that caused it, so a miss judged after it in the same
  // MIDI packet keeps its mark
  advanceEngineMarks(from, to) {
    if (!this.programme.engine) { return }

    let before = this.cardHead(from)
    let after = this.cardHead(to)

    if (before.generator != after.generator || before.index == null ||
        after.index == null || after.index <= before.index)
    {
      this.setState(state => state.engineMissed.length ? {engineMissed: []} : null)
    }
  }

  // The matcher advances the note list the page renders, so the two hold the
  // same list: every other change to it (a rebuilt drill, a skipped column,
  // a spec's own list) is adopted here, along with the options detection
  // reads
  syncMatcher() {
    let {notes, currentGenerator, anyOctave} = this.state
    if (notes !== this.matcher.notes) {
      this.matcher.setNotes(notes)
    }
    this.matcher.mode = currentGenerator ? currentGenerator.mode : "notes"
    this.matcher.anyOctave = anyOctave
    this.matcher.scroll = this.state.mode == "scroll"
    this.matcher.tempo = this.tempoMode()
  }

  // D4(c): whether the trainer's "Keep tempo" setting is in effect for the
  // head column: a column that scrolls past the hit line by the tolerance
  // is missed and the slider moves on. False outside scroll mode, and for
  // the chord drill (ChordList has no currentColumn, so it never scrolls
  // past). A generator's own tempoMode() hook (the seam for Learning 4's
  // tempo rung) takes over when it answers with a boolean, else the setting
  tempoMode() {
    if (this.state.mode != "scroll") { return false }
    if (!this.state.currentGenerator || this.state.currentGenerator.mode != "notes") { return false }

    let generator = this.currentNotesGenerator()
    let hook = generator && generator.tempoMode && generator.tempoMode()
    if (typeof hook == "boolean") { return hook }

    return !!this.state.tempo
  }

  // D4(c): whether the head column isn't being read yet: at rest, or
  // nothing played since Begin or the drill was rebuilt
  // (this.playedThisSegment). The staff starts such a column over on the
  // hit line, as it stands with the setting off (see followHead)
  headRests() {
    return !this.state.session || !this.playedThisSegment
  }

  // D4(c): whether the head column still waits at the line (as D4(a)
  // always does) rather than scroll past it: it isn't being read yet
  // (headRests), or it opens a card or a lap of a looping card (cardIndex
  // 0). A generator without cardIndex (the random-note exercises, pasted
  // notation) is therefore only ever exempt by headRests
  headWaits() {
    if (this.headRests()) { return true }

    let notes = this.matcher.notes
    let column = notes && notes.length ? notes.currentColumn() : []
    return column.cardIndex === 0
  }

  // D4(c): keeps the slider's floor and the matcher's line arrival in step
  // with the head column. Called after every change of head or session,
  // never on every render: while a waiting column stands at the floor,
  // followLine would otherwise keep moving its arrival forward, resetting
  // its lateness (the slider rests there, so no frame of it moves either).
  // Off, this restores wait-at-the-line (D4(a)) and never touches onLine,
  // so that behaviour stays bit-identical. On, a column not being read yet
  // (headRests: at rest, at Begin, on a rebuilt drill) is carried back to
  // the line the same way, since there is no reading of it to keep the
  // staff where it stands for; a column handed over mid-list that waits
  // keeps its floor where the staff already stands, with the loop point
  // kept below that floor so a slider the floor holds never loops however
  // far past the line the floor sits; a scrolling column's floor is lifted
  // (null) and the slider's loop point moves to the tolerance short of the
  // line, restarting the animation if it had stopped. Either way the matcher
  // is told when the new head reaches, or reached, the line, which can be in
  // the past
  followHead() {
    // wait mode's slider has nothing to do with the hit line: leave it alone
    if (this.state.mode != "scroll") { return }

    let slider = this.state.slider
    if (!slider) { return }

    if (!this.tempoMode()) {
      slider.floor = SCROLL_WAIT
      slider.passAt = 0
      // the floor may have been lifted below the line while the setting was
      // on, where nothing is animating to carry the head back up to it
      slider.checkAndStart()
      return
    }

    if (this.headRests()) {
      slider.floor = SCROLL_WAIT
      slider.passAt = 0
      slider.checkAndStart()
    } else if (this.headWaits()) {
      slider.floor = Math.min(SCROLL_WAIT, slider.value)
      slider.passAt = slider.floor - TEMPO_TOLERANCE
    } else {
      slider.floor = null
      slider.passAt = SCROLL_WAIT - TEMPO_TOLERANCE
      slider.checkAndStart()
    }

    this.followLine(slider.value)
  }

  // D4(c): tells the matcher when the head column reaches, or reached, the
  // hit line, read off where the staff stands: a column short of the line
  // arrives in the future, one already past it arrived in the past. Told on
  // every change of head (followHead) and on every frame that moves the
  // staff, which gives the same answer frame after frame while it slides at
  // its speed and so carries the crossing along with a frame gap the slider
  // dropped rather than played out (FRAME_GAP_PAUSE_MS in st/slide_to_zero,
  // a hidden tab). A frame the floor held still isn't one: the column stands
  // where it stood and its crossing stays behind it (see SlideToZero)
  followLine(value) {
    this.matcher.onLine(this.matcher.now() +
      (value - SCROLL_WAIT) * 1000 / this.state.slider.speed)
  }

  // the generator of notes and the index in its card of their head column
  cardHead(notes) {
    let index = notes && notes.length ? notes.currentColumn().cardIndex : null
    return {generator: notes && notes.generator, index: index ?? null}
  }

  // reads the drilled piece's source MusicXML, once for each piece
  loadEngineSource() {
    let settings = this.currentSettings()
    let piece = this.currentPieceSection() ? sheetMusicPiece(settings) : null
    let source = this.state.engineSource

    if (!piece) {
      if (source) { this.setState({engineSource: null}) }
      return
    }

    if (source && source.piece == piece) { return }

    this.setState({engineSource: {piece, status: "loading"}})

    let measureStarts = pieceSong(piece).metadata?.measureStarts || null
    this.props.readSource(piece.id)
      .catch(err => {
        console.warn("Couldn't read the piece's score", err)
        return null
      })
      .then(musicXML => {
        if (this.unmounted || this.state.engineSource?.piece != piece) { return }
        this.setState({engineSource: {
          piece,
          status: musicXML ? "ready" : "missing",
          musicXML,
          measureStarts,
          trackStaves: musicXML ? trackStaves(musicXML) : null,
        }})
      })
  }

  // whether the drill's cards are drawn by the programme's engine: an
  // imported piece whose source is stored. Takes state so a caller can also
  // ask of a previous render (see updateEngineCard)
  engineCards(state=this.state) {
    let source = state.engineSource
    return !!(this.programme.engine && state.mode &&
      source && source.status == "ready" && this.currentPieceSection())
  }

  // whether the plate waits before it knows which staff draws the card: on
  // the piece's source, or on the plate's width for the engine
  engineCardPending() {
    let source = this.state.engineSource
    if (!this.programme.engine || !this.state.mode || !source) { return false }
    return source.status == "loading" || (this.engineCards() && !this.state.staffWidth)
  }

  // The hand setting the card at the head is drawn with: the hand alone
  // today's programme offers it as, else the settings'
  cardHand() {
    let current = this.currentCard()
    let hand = current && current.card.hand
    return hand ? handSetting(hand) : this.currentSettings().hand
  }

  // The score staves a hand setting's tracks read: null for every staff,
  // undefined when the stored song's tracks can't be told among the score's
  handStaves(hand) {
    let settings = this.currentSettings()
    let song = pieceSong(sheetMusicPiece(settings))
    let tracks = handTracks(song, hand)
    if (!tracks) { return null }

    let all = this.state.engineSource?.trackStaves
    if (!all || all.length != song.tracks.length) { return undefined }

    let cache = this.engineStavesCache
    if (!cache || cache.all != all || cache.tracks != tracks.join(",")) {
      cache = this.engineStavesCache = {
        all, tracks: tracks.join(","), staves: tracks.map(idx => all[idx]),
      }
    }
    return cache.staves
  }

  // The staves the engine draws: the card's own hand, the session's unless
  // today's programme offers the card as one hand alone
  engineStaves() {
    return this.handStaves(this.cardHand())
  }

  // Whether a bar may be offered as one hand alone (the hand scaffold of
  // today's programme): only where the staff drawing the cards can draw one
  // hand of the piece by itself, which the engine can't where the score
  // can't tell that hand's staves from the rest. Nothing is offered apart
  // until the piece's source has settled and the staff is known. Read on
  // every plan, so it leaves the one slot of the staves cache to the card
  // being drawn
  handsApart() {
    let source = this.state.engineSource
    if (this.programme.engine && (!source || source.status == "loading")) { return false }
    if (!this.engineCards()) { return true }

    let song = pieceSong(sheetMusicPiece(this.currentSettings()))
    return !!(song && source.trackStaves && source.trackStaves.length == song.tracks.length)
  }

  // The engine card's props for the card at the head of the drill, or null
  // when the app's staff draws it. In scroll mode the engine draws the whole
  // section on one line, which the slider moves along from card to card, save
  // a bar today's programme offers as one hand alone: that bar alone, of that
  // hand's staves, is its own one-bar system
  engineCard() {
    if (!this.engineCards()) { return null }

    let current = this.currentCard()
    let width = this.state.staffWidth
    let staves = this.engineStaves()
    if (!current || !width || !joinable(current.card.columns) || staves === undefined) { return null }

    let {card} = current
    let source = this.state.engineSource
    // acoustic mode never awaits a key, so no column is marked as the head
    let self = this.selfGraded()
    let head = self ? null : this.cardHead(this.state.notes).index
    let system = this.state.mode == "scroll"
    let drawn = system && !card.hand ? this.currentPieceSection() : card

    return {
      engine: this.programme.engine,
      musicXML: source.musicXML,
      measureStarts: source.measureStarts,
      fromMeasure: drawn.startMeasure,
      toMeasure: drawn.endMeasure,
      system,
      slider: system ? this.state.slider : null,
      hand: "both",
      staves,
      width,
      columns: card.columns,
      head,
      missed: self ? [] : this.state.engineMissed,
      badges: self ? this.selfGradeBadges(card) : null,
    }
  }

  // Bar badges over the engine card while acoustic mode's "Where?" is open
  // or its answer is being flashed (st/score_render/card_badges): one per
  // bar the follow-up names, lit once the grade going to it is known
  // (chosen, or every bar for Throughout). Null otherwise, including on the
  // app staff's fallback, which never draws them (Q1 of the design report)
  selfGradeBadges(card) {
    let {selfAsking, selfRecorded} = this.state
    if (selfAsking == null && selfRecorded?.bars === undefined) { return null }

    let generator = this.currentNotesGenerator()
    let followUp = generator.selfFollowUp && generator.selfFollowUp(AGAIN)
    if (!followUp) { return null }

    let chosen = selfRecorded ? selfRecorded.bars : undefined

    return followUp.choices.filter(choice => choice.value).map(({value: [n]}) => ({
      column: card.columnMeasures.findIndex(i => card.measures[i] == n),
      label: `Bar ${n}`,
      on: chosen === undefined ? false : (chosen ? chosen.includes(n) : true),
    }))
  }

  componentDidMount() {
    setTitle(this.programme.title)

    this.setStaff(this.programme.initialStaff(), () => {
      if (currentDrillMode(this.programme.storageKey) == "scroll") {
        this.enterScrollMode()
      } else {
        this.enterWaitMode()
      }
    })

    // the Programme pill goes in the header's top row when there is one
    this.setState({headerActions: document.getElementById(HEADER_ACTIONS_ID)})

    dispatch(this, {
      saveGeneratorPreset: (e, form) => {
        if (this.state.savingPreset) {
          return;
        }

        let preset = JSON.stringify({
          type: "notes",
          name: this.state.currentGenerator.name,
          settings: this.state.currentGeneratorSettings,
        })

        this.setState({savingPreset: true})

        let request = new XMLHttpRequest()
        request.open("POST", "/new-preset.json")
        let data = new FormData(form)
        data.append("csrf_token", csrfToken())
        data.append("preset", preset)
        request.send(data)

        request.onload = (e) => {
          let res = JSON.parse(request.responseText)
          this.setState({savingPreset: false})
        }
      }
    })

    document.addEventListener("webkitfullscreenchange", this.onFullscreenChange)
    // closing the tab doesn't unmount the page
    window.addEventListener("pagehide", this.onPageHide)
    window.addEventListener("resize", this.onResize)
  }

  componentWillUnmount() {
    this.unmounted = true
    document.removeEventListener("webkitfullscreenchange", this.onFullscreenChange)
    window.removeEventListener("pagehide", this.onPageHide)
    window.removeEventListener("resize", this.onResize)
    this.observeStaffWrapper(null)
    this.stopClock()

    if (this.ornamentTimer) {
      clearTimeout(this.ornamentTimer)
      this.ornamentTimer = null
    }

    this.recordSession()
    this.stopGenerator(this.state.notes && this.state.notes.generator)

    if (this.state.slider) {
      this.state.slider.cancel()
    }

    if (this.nosleep && this.state.fullscreen) {
      this.nosleep.disable()
    }
  }

  onFullscreenChange(event) {
    if (document.webkitIsFullScreen) {
      console.log("is mobile", isMobile())
      if (isMobile()) {
        this.nosleep = this.nosleep || new NoSleep()
        this.nosleep.enable()
      }
    } else {
      if (this.nosleep) {
        this.nosleep.disable()
      }
    }

    this.setState({
      fullscreen: document.webkitIsFullScreen
    })
  }

  // the staff a generator builds its columns for (T1): the whole keyboard
  // while an imported piece is drawn by the engine, since the engine draws
  // every note of its source whatever the staff can show; the staff's own
  // range otherwise, so a generator's own notes and the app staff's
  // fallback for a piece it can't engrave stay within what it can draw
  columnStaff() {
    let staff = this.state.currentStaff
    return staff && this.engineCards() ? {...staff, range: FULL_KEYBOARD_RANGE} : staff
  }

  // D5(a): whether a pressed note is one the app staff's fallback had to
  // drop from the drilled section, outside the staff's own range. The engine
  // path (T1) never drops a note, so this only applies while the app staff
  // draws in its place (a piece with no stored source, or an engine failure)
  droppedStaffNote(note) {
    return this.state.droppedPitches.has(parseNote(note))
  }

  // This generates a new set of notes, appropriate for when the generator or
  // generator parameters have changed in some say. Pass the drill on the
  // staff to fill it again from that same drill rather than build it afresh,
  // eg. once today's programme has a card to show
  refreshNoteList(keepGenerator=null) {
    // a pending self grade would otherwise be lost: the generator it belongs
    // to is about to be rebuilt (never the soft refresh after a grade or
    // today's programme's own replan, which pass keepGenerator)
    if (!keepGenerator) {
      this.writeSelfGrade()
    }

    let generator = this.state.currentGenerator

    let generatorSettings = {
      ...generatorDefaultSettings(
        generator,
        this.state.currentStaff
      ),
      ...this.state.currentGeneratorSettings
    }

    let staff = this.columnStaff()
    let generatorInstance = keepGenerator || generator.create.call(
      generator,
      staff,
      this.state.keySignature,
      generatorSettings
    )
    let droppedPitches = generator.name == "sheet music" ?
      sectionDroppedPitches(staff, generatorSettings) : new Set()

    // the measure cards grade each pass by the drill it is played in: a
    // self grade in acoustic mode, else the detected mode and speed
    if (!keepGenerator && generatorInstance.setDrill) {
      generatorInstance.setDrill(() => this.selfGraded() ?
        {mode: "self"} :
        {mode: this.state.mode, speed: this.state.scrollSpeed, tempo: this.tempoMode() ? TEMPO_TOLERANCE : null})
    }

    // today's programme offers a bar as one hand alone only where the staff
    // drawing it can draw that hand by itself
    if (!keepGenerator && generatorInstance.setHandsApart) {
      generatorInstance.setHandsApart(() => this.handsApart())
    }

    // restPauses pages (the score page): the session log every finished
    // pass joins, see st/measure_cards#setOnPass
    if (!keepGenerator && generatorInstance.setOnPass && this.programme.restPauses) {
      generatorInstance.setOnPass(entry =>
        this.setState(state => ({sessionLog: [...state.sessionLog, entry]})))
    }

    // today's programme reads the log when a bar that can split is failing,
    // so the staff is filled again from the card it then picks
    if (!keepGenerator && generatorInstance.ready) {
      generatorInstance.ready.then(replanned => {
        if (replanned && !this.unmounted && this.state.notes?.generator == generatorInstance) {
          this.refreshNoteList(generatorInstance)
        }
      })
    }

    var notes

    switch (generator.mode) {
      case "notes":
        notes = new NoteList([], { generator: generatorInstance })
        break
      case "chords":
        notes = new ChordList([], { generator: generatorInstance })
        break
    }

    if (!notes) {
      throw new Error(`unknown generator mode: ${generator.mode}`)
    }

    // enough columns to show the whole of any card of a piece, a passage of
    // tonight's study and its lead-in among them
    let cardColumnCounts = (generatorInstance.cards || []).map(card => card.columns.length)
    let studyColumns = generatorInstance.maxCardColumns ? generatorInstance.maxCardColumns() : 0
    notes.fillBuffer(Math.max(this.state.bufferSize, studyColumns, ...cardColumnCounts))

    // the matcher judges against the new list from the next event on, before
    // the render that draws it
    this.matcher.setNotes(notes)
    this.matcher.mode = generator.mode
    this.advanceEngineMarks(this.state.notes, notes)

    // D4(c): the drill was rebuilt, so its first column waits however long
    // the tempo setting is on
    this.playedThisSegment = false
    this.followHead()

    // the grade row of acoustic mode is keyed by this, so a rebuilt drill
    // starts it fresh, as a graded pass does; selfAsking/selfRecorded go with
    // it, since the card they described is gone
    return this.setState(state => ({
      notes, droppedPitches, cardSeq: state.cardSeq + 1,
      selfAsking: null, selfRecorded: null,
    }))
  }

  // keeps the measurements of the staff wrapper up to date: its width,
  // which an engine draws a piece's card to, and the scroll-mode hit
  // band's centre (see measureStaffWrapper)
  observeStaffWrapper(el) {
    if (this.staffResizeObserver) {
      this.staffResizeObserver.disconnect()
      delete this.staffResizeObserver
    }

    this.staffWrapper = el
    if (!el) { return }

    if (window.ResizeObserver) {
      this.staffResizeObserver = new ResizeObserver(() => this.measureStaffWrapper())
      this.staffResizeObserver.observe(el)
    }

    this.measureStaffWrapper()
  }

  measureStaffWrapper() {
    let el = this.staffWrapper
    if (!el || this.unmounted) { return }

    let padding = parseFloat(window.getComputedStyle(el).paddingLeft) || 0
    let staffWidth = el.clientWidth - padding
    // the scroll-mode hit band's centre (sight_reading_page.module.css's
    // .scroll_mode .staff_wrapper::before), in StaffTwo's own pixels: the
    // band is centred on the wrapper's full (padded) box, and StaffTwo's
    // box starts after the left padding
    let hitX = el.clientWidth / 2 - padding
    if (staffWidth != this.state.staffWidth || hitX != this.state.hitX) {
      this.setState({staffWidth, hitX})
    }
  }

  // the drawn heads of the column at the head of the drill, which the
  // plate's ink smudge marks: the staff's own, else the staff wrapper
  // (mid-staff), see PlateFeedback
  headElements() {
    let heads = this.staff ? this.staff.headElements() : []
    return heads.length ? heads : [this.staffWrapper].filter(Boolean)
  }

  // the card (or whole section) of the imported piece whose columns are on
  // the staff, with its place in the deck, if any
  currentCard() {
    if (!this.currentPieceSection()) { return null }

    let generator = this.state.notes && this.state.notes.generator
    let card = generator && generator.currentCard && generator.currentCard()
    if (!card) { return null }

    return {card, number: generator.currentCardNumber()}
  }

  // How many column widths the staff slides when the head column of notes is
  // done with: one on the app's staff, which draws its columns a width apart,
  // and on an engine's system the gap it drew between the columns
  columnAdvance(notes) {
    if (!notes || !notes.length) { return 1 }

    let drawn = this.staff && this.staff.scrollAdvance &&
      this.staff.scrollAdvance(notes.currentColumn(), notes[1])
    return drawn != null ? drawn : 1
  }

  // Begin: a fresh session in new stats, with the elapsed clock running
  beginSession() {
    if (this.state.session) { return }

    // today's programme plans again here, so a piece whose every bar rested
    // in the sitting before is offered again in this one
    let playing = this.state.notes && this.state.notes.generator
    if (playing && playing.replan && playing.replan()) {
      this.refreshNoteList(playing)
    }

    this.matcher.clear()
    // D4(c): the first column waits however long the tempo setting is on
    this.playedThisSegment = false
    this.restartSession({
      session: true,
      heldNotes: {},
      touchedNotes: {},
      // defensive only: the modal normally hides Begin
      summary: null,
    })
    this.followHead()
  }

  // saves the stats so far and counts afresh from now, clock included
  restartSession(update) {
    let now = Date.now()
    this.startClock()

    this.setState({
      ...update,
      sessionStartedAt: now,
      clockNow: now,
      stats: this.closeSession(),
    })
  }

  // Clear stats: a running session restarts, at rest the stats start over
  clearStats() {
    if (this.state.session) {
      this.restartSession()
    } else {
      this.setState({stats: this.closeSession()})
    }
  }

  // Rest: stops the clock and saves the session, keeping its figures on the
  // stat cards until the next Begin
  restSession() {
    if (!this.state.session) { return }

    this.stopClock()

    this.matcher.clear()
    this.setState({
      session: false,
      clockNow: Date.now(),
      heldNotes: {},
      touchedNotes: {},
    }, () => this.followHead())

    let recorded = this.recordSession()
    if (recorded) {
      // shows the session in the evening's list once it is stored
      recorded.saving.then(() => {
        if (!this.unmounted) { this.forceUpdate() }
      })
      // built from exactly what was written, never read back: a second
      // record could miss a flashing self grade recordSession already
      // flushed into this one (sibling PR #54)
      this.openSummary(recorded.session)
    }
  }

  // Opens the session summary card from the record just written. The
  // eyebrow is the trainer's own title at the moment of Rest, since the
  // record keeps no key signature to rebuild it from
  openSummary(session) {
    let {title, italic} = this.titleParts()
    let eyebrow = [title, italic].filter(Boolean).join(" · ")
    this.setState({summary: {record: session, eyebrow}})
  }

  closeSummary() {
    this.setState({summary: null})
  }

  // Begin, on a restPauses page (the setup pane, the bar pop-up's or the
  // passage pane's Practise): clears the strip and the session log, shows
  // the session view and begins as beginSession always has. Any settings
  // picked just before this call land in the same batch, so the drill
  // componentDidUpdate rebuilds from them is already the new one by the
  // time a note can be played
  begin() {
    this.lastRecord = null
    this.setState({ended: null, sessionLog: [], view: "session"})
    this.beginSession()
  }

  // Rest, on a restPauses page: pauses in place rather than ending the
  // session. Order matters (see the pitfalls in AGENTS.md): record first,
  // as a session already at rest is left alone, then stop the clock
  pauseSession() {
    if (!this.state.session) { return }

    this.recordSession()
    this.stopClock()
    let pausedAt = Date.now()
    this.matcher.clear()
    this.setState({
      session: false, paused: true, pausedAt, heldNotes: {}, touchedNotes: {},
    }, () => this.followHead())
  }

  // Resume (or Play on, from endSession), from a pause at pausedAt: keeps
  // the same NoteStats, so the record it was recorded under is rewritten
  // later, and replans as beginSession does
  resumeFrom(pausedAt) {
    let pausedMs = this.state.pausedMs + Math.max(0, Date.now() - pausedAt)

    let playing = this.state.notes && this.state.notes.generator
    if (playing && playing.replan && playing.replan()) {
      this.refreshNoteList(playing)
    }

    this.matcher.clear()
    this.playedThisSegment = false
    this.startClock()
    this.setState({
      session: true, paused: false, pausedMs, clockNow: Date.now(),
    }, () => this.followHead())
  }

  resumeSession() {
    if (!this.state.paused) { return }
    this.resumeFrom(this.state.pausedAt)
  }

  // Skips the read-through of today's programme (see
  // PlanGenerator#skipReadThrough), at rest or in session: the pass in
  // progress is abandoned like any, its practice written, and the staff
  // is filled from the card that follows
  skipReadThrough() {
    let generator = this.currentNotesGenerator()
    if (!generator || !generator.skipReadThrough) { return }

    this.flushPractice(generator)
    generator.skipReadThrough()
    this.refreshNoteList(generator)
  }

  // A stand-in for endSession's ended strip when the log has entries but
  // the current NoteStats has nothing to write (a mid-session reset left
  // recordSession() with a null session): the strip's own bar marks and
  // bar count come from the log, not this record, which only supplies the
  // figures endedSummary reads off it directly (st/bar_progress)
  emptyEndedRecord() {
    return {notesRead: 0, misses: 0, startedAt: this.state.sessionStartedAt, elapsedSeconds: this.elapsedSeconds()}
  }

  // End session, running or paused: records the session if it was still
  // running (a paused one was already recorded at pauseSession), builds the
  // ended strip from the record that leaves (this.lastRecord, never read
  // back), and returns to the score view. The learnedness tints wait on the
  // generator's own in-flight write (finishing) before they force a re-render
  endSession() {
    if (this.state.session) {
      this.recordSession()
    }

    this.stopClock()
    this.endedPausedAt = Date.now()
    // ending from a pause folds its open stretch into pausedMs now, so Play
    // on's own pause (endedPausedAt to then) is the only one resumeFrom
    // still has to add: otherwise the time already spent paused before End
    // session would count as playing time once the session resumes
    let pausedMs = this.state.paused ?
      this.state.pausedMs + Math.max(0, this.endedPausedAt - this.state.pausedAt) : this.state.pausedMs

    // the strip shows whenever there is something to show it for (D10): a
    // written record, or, short of that, a session log a reset of the
    // stats mid-session left recordSession() with nothing current to write
    let session = this.lastRecord ? this.lastRecord.session : null
    let ended = session || (this.state.sessionLog.length ? this.emptyEndedRecord() : null)

    this.setState({
      session: false, paused: false, pausedMs, view: "score", ended,
    })

    let generator = this.currentNotesGenerator()
    let finishing = (generator && generator.finishing) || Promise.resolve()
    let saving = (this.lastRecord && this.lastRecord.saving) || Promise.resolve()
    Promise.all([finishing, saving]).then(() => {
      if (!this.unmounted) { this.forceUpdate() }
    })
  }

  // Play on, from the session-ended strip: the time since End session
  // counts as paused
  playOn() {
    let pausedAt = this.endedPausedAt ?? Date.now()
    this.setState({ended: null, view: "session"})
    this.resumeFrom(pausedAt)
  }

  // Done, from the session-ended strip: only the strip goes
  dismissEnded() {
    this.setState({ended: null})
  }

  // "Practise these notes": closes the card and switches to the programme's
  // focusGenerator (eg. Random notes), focused on the card's weak rows
  // (focusFromRows), same staff and key, staying at rest. Unreachable
  // without a focusGenerator (the pill is hidden, see renderSummary) or
  // without a weak row (chord sessions have none)
  practiseNotes() {
    let summary = this.state.summary
    if (!summary) { return }

    let focus = focusFromRows(troubleNotes(summary.record))

    this.closeSummary()

    // only notes mode has anything to seed (chord sessions have no rows,
    // so this is unreachable, but the generator switch below assumes it)
    if (!this.state.currentGenerator || this.state.currentGenerator.mode != "notes") { return }

    let generator = this.programme.focusGenerator
    if (!generator) { return }

    let settings = this.state.currentGenerator == generator ? this.state.currentGeneratorSettings : {}
    this.setGenerator(generator, {...settings, focus})
  }

  // "New programme" where the programme has no destination of its own (see
  // EXERCISES_PROGRAMME.newProgramme): closes the card and opens the
  // programme drawer, eg. the score page, which can't pick a piece from
  // /setup
  newProgramme() {
    this.closeSummary()
    this.openSettings()
  }

  startClock() {
    this.stopClock()
    this.clockTimer = window.setInterval(() => {
      this.setState({clockNow: Date.now()})
    }, 1000)
  }

  stopClock() {
    if (this.clockTimer) {
      window.clearInterval(this.clockTimer)
      delete this.clockTimer
    }
  }

  elapsedSeconds() {
    let {sessionStartedAt, clockNow, pausedMs, paused, pausedAt} = this.state
    if (sessionStartedAt == null || clockNow == null) { return 0 }
    let pausedNow = paused && pausedAt != null ? clockNow - pausedAt : 0
    return Math.floor((clockNow - sessionStartedAt - pausedMs - pausedNow) / 1000)
  }

  // Judges one MIDI event through the matcher: it tells the page each
  // judgement as it makes it, so a miss reaches the stats before the column
  // it was counted on is shifted off the list, and what they all did to the
  // drill is rendered in one update
  judge(judgement) {
    this.matchUpdate = {}
    let result = judgement()
    let update = this.matchUpdate
    this.matchUpdate = null

    this.scheduleOrnamentTick()

    if (!result) { return }

    this.setState({
      ...update,
      heldNotes: result.held,
      touchedNotes: result.touched,
    })
  }

  // An ornament key pending between the ornament going on and a real strike
  // (st/note_matcher) is settled by the next key down, or, with none coming,
  // by this timer once ORNAMENT_GAP has passed (ruling out eg. a looping
  // card's last column ending on the ornament's own pitches): the matcher
  // owns the rule (tick), this only schedules the call for when it is due
  scheduleOrnamentTick() {
    if (this.ornamentTimer) {
      clearTimeout(this.ornamentTimer)
      this.ornamentTimer = null
    }

    let due = this.matcher.pendingUntil()
    if (due == null) { return }

    this.ornamentTimer = setTimeout(() => {
      this.ornamentTimer = null
      this.judge(() => this.matcher.tick(this.matcher.now()))
    }, Math.max(0, due - this.matcher.now()))
  }

  // Renders one judgement of the matcher's: the stats, the staff's marks,
  // the slider and the sets the page draws
  applyEvent(event) {
    let update = this.matchUpdate

    switch (event.type) {
      case "miss":
        this.countMiss(event, update)
        break

      case "hit":
        gaEvent("sight_reading", "note", "hit")
        // the column's measurements reached the measure cards' attempt with
        // the column as the matcher removed it (see NoteList#shift)
        this.state.stats.hitNotes(event.hitNotes)
        // a measure card's column is already counted by clef there
        // (columnClefs, keyed on cardIndex, cardColumn in st/measure_cards);
        // this covers every other column, which carries none (see
        // staffClefs)
        if (event.from[0].cardIndex == null) {
          this.state.stats.countClefs(staffClefs(this.state.currentStaff?.name, event.hitNotes), "hit")
        }
        update.notes = this.matcher.notes
        // the keys it credited, for the developer metrics panel
        if (this.devMetrics) { this.lastHit = event }
        // one column at a time: a hit may complete the next column too, from
        // its keys played early
        this.advanceEngineMarks(event.from, event.to)
        // a slip's shake plays out over the next column
        if (!event.stray) { update.noteShaking = false }
        this.state.slider.add(this.columnAdvance(event.from))
        this.playedThisSegment = true
        this.followHead()
        break

      case "scrolled":
        // D4(c): the head column scrolled past the hit line (see
        // NoteMatcher#scrollPast); its miss, if any, arrived as an ordinary
        // "miss" event just before this one
        update.notes = this.matcher.notes
        this.advanceEngineMarks(event.from, event.to)
        // as the hit above: the room the column leaving the staff held, then
        // the new head's own arrival at the line, before the keys struck
        // early for it complete and measure it
        this.state.slider.add(this.columnAdvance(event.from))
        this.followHead()
        break

      case "chordHit":
        gaEvent("sight_reading", "chord", "hit")
        this.state.stats.hitNotes([])
        update.notes = this.matcher.notes
        this.advanceEngineMarks(event.from, this.matcher.notes)
        update.noteShaking = false
        this.state.slider.add(1)
        this.playedThisSegment = true
        this.followHead()
        break

      case "chordMiss":
        gaEvent("sight_reading", "chord", "miss")
        this.state.stats.missNotes([])
        update.noteShaking = true
        update.smudges = (update.smudges ?? this.state.smudges) + 1
        setTimeout(() => this.setState({noteShaking: false}), 500);
        break
    }
  }

  // The miss the matcher counted on the head column, at most once however
  // many slips it takes to complete it: counted says whether the stats take
  // it as the column's miss, as a further slip in the same column (the
  // measure cards' grade counts every try gone wrong), or as neither. The
  // column is marked on an engine card and the notes shake
  countMiss(event, update) {
    if (event.counted == "miss") {
      gaEvent("sight_reading", "note", "miss");
      this.state.stats.missNotes(event.missed, event.blamed, event.wrongKeys);
      if (event.missed.cardIndex == null) {
        this.state.stats.countClefs(staffClefs(this.state.currentStaff?.name, event.blamed || event.missed), "miss")
      }
    } else if (event.counted == "slip") {
      this.state.stats.slipNotes(event.missed, event.blamed, event.wrongKeys)
    }

    this.markMissedCard(this.cardHead(event.notes).index)

    update.noteShaking = true
    // every wrong key gets ink, whatever event.counted is: the stats still
    // count only what they count today (see PlateFeedback)
    update.smudges = (update.smudges ?? this.state.smudges) + 1
    setTimeout(() => this.setState({noteShaking: false}), 500);
  }

  // Marks a column missed on the engine card. Every miss of one MIDI packet
  // is judged against its own head, so the marks are added one at a time
  // over the state as it stands, never over a batch's stale copy
  markMissedCard(index) {
    if (index == null) { return }

    this.setState(state => state.engineMissed.includes(index)
      ? null
      : {engineMissed: [...state.engineMissed, index]})
  }

  skipCurrentNote() {
    // nothing is detected in acoustic mode, so there is no column to skip
    if (this.selfGraded()) {
      return
    }

    // Only support notes mode (not chords)
    if (this.state.currentGenerator?.mode !== "notes") {
      return
    }

    if (!this.state.notes || this.state.notes.length === 0) {
      return
    }

    const currentNotes = this.state.notes.currentColumn()

    // Play notes via MIDI output if available
    if (this.props.midiOutput && currentNotes.length > 0) {
      for (const note of currentNotes) {
        const pitch = parseNote(note)
        this.props.midiOutput.noteOn(pitch, 100)
      }

      setTimeout(() => {
        for (const note of currentNotes) {
          const pitch = parseNote(note)
          this.props.midiOutput.noteOff(pitch)
        }
      }, 300)
    }

    // Advance to next note
    let advance = this.columnAdvance(this.state.notes)
    let notes = this.state.notes.clone()
    notes.shift()
    notes.pushRandom()

    // the keys still down stay held; the next column is played afresh
    this.matcher.setNotes(notes)
    this.matcher.clearTouched()
    this.advanceEngineMarks(this.state.notes, notes)

    this.setState({
      notes,
      noteShaking: false,
      touchedNotes: {}
    })

    this.state.slider.add(advance)
    this.followHead()
  }

  // A key went down, with the timeStamp of the MIDI event that brought it
  // (the on-screen keyboard has none). The guards that aren't the matching
  // rules stay here; everything the press does to the drill is the matcher's
  pressNote(note, timeStamp) {
    // nothing is detected in acoustic mode: the player grades the pass themself
    if (this.selfGraded()) {
      return
    }

    // key presses at rest aren't judged
    if (!this.state.session) {
      return
    }

    switch (this.state.currentGenerator.mode) {
      case "notes": {
        // D5(a): a note the app staff's fallback had to drop from an
        // imported piece's section is neither required nor a wrong key
        if (this.droppedStaffNote(note)) { return }
        break
      }
      case "chords": {
        let ignoreAbove = this.state.currentGeneratorSettings.ignoreAbove
        if (ignoreAbove != null) {
          console.log(parseNote(note), ignoreAbove, parseNote(note) > ignoreAbove)
          if (parseNote(note) > ignoreAbove) {
            return
          }
        }
        break
      }
    }

    this.judge(() => this.matcher.noteOn(note, timeStamp))
  }

  // A key came up. In notes mode the matcher judges nothing on it; the chord
  // drill's release check runs at most once an event, when the last key down
  // comes up
  releaseNote(note, timeStamp) {
    if (this.selfGraded()) { return }
    this.judge(() => this.matcher.noteOff(note, timeStamp))
  }

  onMidiMessage(message) {
    // nothing is detected in acoustic mode: the player grades the pass themself
    if (this.selfGraded()) {
      return
    }

    let [raw, pitch, velocity] = message.data;

    let cmd = raw >> 4,
      channel = raw & 0xf,
      type = raw & 0xf0;

    let n = noteName(pitch)

    // console.debug("midi", pitch, velocity, NOTE_EVENTS[type])

    // each message is matched synchronously, in the order it arrived, so a
    // packet's notes are judged as the same notes spread out in time are
    let timeStamp = message.timeStamp

    if (NOTE_EVENTS[type] == "noteOn") {
      if (velocity == 0) {
        this.releaseNote(n, timeStamp);
      } else if (!document.hidden) { // ignore when the browser tab isn't active
        this.pressNote(n, timeStamp);
      }
    }

    if (NOTE_EVENTS[type] == "noteOff") {
      this.releaseNote(n, timeStamp);
    }
  }

  setMode(mode) {
    if (mode == this.state.mode) { return }

    storeCurrentDrill({mode}, this.programme.storageKey)

    if (mode == "scroll") {
      this.enterScrollMode()
    } else {
      this.enterWaitMode()
    }
  }

  // D4(c): the "Keep tempo" setting, applied live from the next head (a
  // pass that straddles the change isn't graded, see
  // MeasureCardGenerator#finishPass)
  setTempo(on) {
    storeCurrentDrill({tempo: !!on}, this.programme.storageKey)
    this.setState({tempo: !!on}, () => this.followHead())
  }

  enterWaitMode() {
    if (this.state.slider) {
      this.state.slider.cancel();
    }

    this.setState({
      mode: "wait",
      noteWidth: DEFAULT_NOTE_WIDTH,
      slider: new SlideToZero({
        speed: DEFAULT_SPEED,
        onUpdate: this.setOffset.bind(this)
      })
    })
  }

  enterScrollMode() {
    let noteWidth = DEFAULT_NOTE_WIDTH * 2;

    if (this.state.slider) {
      this.state.slider.cancel();
    }

    // D4(c): the drill's mode changed, so its first column on the line waits
    // however long the tempo setting is on
    this.playedThisSegment = false

    this.setState({
      mode: "scroll",
      noteWidth: noteWidth,
      slider: new SlideToZero({
        speed: this.state.scrollSpeed / 100,
        loopPhase: 1,
        initialValue: 4,
        // the head column waits on the line, never looping past it, until
        // followHead lifts the floor in tempo mode (D4(c))
        floor: SCROLL_WAIT,
        onUpdate: value => {
          this.setOffset(value)
          if (this.tempoMode()) { this.followLine(value) }
        },
        // the matcher times how long each column stands on the hit line
        // before it is played (its late), which is recorded and never a miss
        onStart: () => this.matcher.onLine(null),
        // the staff has come to rest with the head on the line, so the head
        // is on it from now — unless followHead already dated its arrival
        // earlier, having found it past the line as it became the head
        // (D4(c)): an arrival already in the past is the one it kept
        onStop: () => this.matcher.onLine(
          Math.min(this.matcher.onLineSince ?? Infinity, this.matcher.now())),
        // D4(c): fires only in tempo mode (the floor otherwise prevents the
        // slider ever looping) when the head column has scrolled past the
        // tolerance, judged through the matcher (NoteMatcher#scrollPast) so
        // every detection rule stays there
        onLoop: function() {
          // the loop raised the value by loopPhase: put it back, so the room
          // the column leaving the staff held is added by the handler of the
          // judgement that actually shifts it off the list ("scrolled", or
          // "hit" when the keys held settle it), exactly once either way
          let slider = this.state.slider
          slider.value -= slider.loopPhase

          let now = this.matcher.now()
          this.judge(() => this.matcher.scrollPast(now, {miss: this.state.session}))
        }.bind(this)
      })
    }, () => this.followHead());
  }

  setKeySignature(k) {
    this.userKey = k
    storeCurrentDrill({key: k.name()}, this.programme.storageKey)
    this.setState({
      keySignature: k,
      notes: null
    })
  }

  setGenerator(generator, settings) {
    storeCurrentDrill({generator: generator.name}, this.programme.storageKey)

    let update = {
      currentGenerator: generator,
      currentGeneratorSettings: settings,
    }

    // eg. the score page's staff follows the piece
    let staff = this.programme.staffFor && this.programme.staffFor({
      ...generatorDefaultSettings(generator, this.state.currentStaff),
      ...settings,
    })

    if (staff && staff != this.state.currentStaff) {
      storeCurrentDrill({staff: staff.name}, this.programme.storageKey)
      update.currentStaff = staff
      update.notes = null
    }

    this.setState(update)
  }

  // the settings setter the score-first score view and its session rail
  // write the generator's settings through (st/components/sight_reading/
  // score_view, session_rail), same as the old Rail's setSettings
  setCurrentSettings(settings) {
    let generator = this.state.currentGenerator
    if (generator.storageKey) {
      storeGeneratorSettings(generator.storageKey, settings)
    }
    this.setGenerator(generator, settings)
  }

  setStaff(staff, callback) {
    if (this.state.currentStaff == staff) {
      return
    }

    storeCurrentDrill({staff: staff.name}, this.programme.storageKey)

    let update = {
      currentStaff: staff,
      notes: null,
    }

    // if the current generator is not compatible with new staff change it
    if (!this.state.currentGenerator || (this.state.currentGenerator.mode != staff.mode)) {
      update.currentGenerator = currentGeneratorFor(this.programme.generators, staff.mode, this.programme.storageKey)
      update.currentGeneratorSettings = {}
    }

    // The state change will trigger a call to this.refreshNoteList via
    // componentDidUpdate
    this.setState(update, callback)
    return update
  }

  // this is how slider offset is set
  setOffset(value) {
    if (!this.staff) { return; }
    this.staff.setOffset(value);
  }

  toggleFullscreen() {
    let el = this.refs.page_container
    if (el.webkitRequestFullscreen) {
      if (this.state.fullscreen) {
        document.webkitExitFullscreen()
        return
      }

      el.webkitRequestFullscreen()
      if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
        window.screen.orientation.lock("landscape")
      }
    }
  }

  toggleKeyboard() {
    this.setState({keyboardOpen: !this.state.keyboardOpen});
  }

  // the generator settings in effect, defaults included
  currentSettings() {
    let generator = this.state.currentGenerator
    if (!generator) { return {} }

    return {
      ...generatorDefaultSettings(generator, this.state.currentStaff),
      ...this.state.currentGeneratorSettings,
    }
  }

  // the imported piece section the sheet music generator drills, if any
  currentPieceSection() {
    if (this.state.currentGenerator?.name != "sheet music") {
      return null
    }

    let settings = this.currentSettings()
    let piece = sheetMusicPiece(settings)
    if (!piece) {
      return null
    }

    return {
      pieceId: piece.id,
      pieceTitle: piece.title,
      ...drilledRange(settings),
    }
  }

  // Adds the practice on the pass the generator abandons (see
  // MeasureCardGenerator#takePractice) to the local store
  flushPractice(generator) {
    this.savePractice(this.takePractice(generator))
  }

  // a generator no longer drilled stops listening to the notes played
  stopGenerator(generator) {
    if (generator && generator.stop) {
      generator.stop()
    }
  }

  savePractice(practices) {
    for (let practice of practices) {
      getAppStore().recordSectionPractice(practice)
        .catch(err => console.warn("Couldn't save the section stats", err))
    }
  }

  // The practice on the pass of the imported piece the generator abandons,
  // the current one by default: the session is recorded at Begin, Rest and
  // when the page is left, and only a pass played between them is graded
  takePractice(generator=this.state.notes && this.state.notes.generator) {
    return (generator && generator.takePractice && generator.takePractice()) || []
  }

  // Writes the current session to the local store, replacing what an earlier
  // call wrote for it, together with the section practice in one write that
  // starts right away, as the page may be going away. Nothing is written
  // before a note is played. Returns {session, saving}, saving a promise
  // settling once written, or null when there was nothing to write
  recordSession() {
    // a grade still flashing has to land before takePractice abandons the
    // pass it belongs to, and before stats.sessionRecord counts the passes
    this.writeSelfGrade()

    // the pass a "Where?" question was asked of is abandoned below, so the
    // question goes with it: Rest, Begin and Clear stats all leave the next
    // sitting on the grade pills rather than a question nobody answered
    if (!this.unmounted && this.state.selfAsking != null) {
      this.setState({selfAsking: null, selfRecorded: null})
    }

    let sectionPractice = this.takePractice()

    // a session already recorded at rest is left alone: recording it again
    // would relabel it with whatever staff or generator is current now
    if (!this.state.session) {
      this.savePractice(sectionPractice)
      return null
    }

    let settings = this.currentSettings()
    let section = this.currentPieceSection()
    if (section) {
      settings = {...settings, pieceTitle: section.pieceTitle}
    }

    let session = this.state.stats.sessionRecord({
      staff: this.state.currentStaff?.name,
      generator: this.state.currentGenerator?.name,
      settings,
      // the session clock, Begin to now, less time paused (restPauses
      // pages only; pausedMs is always 0 elsewhere): activeSeconds leaves
      // out pauses too, but acoustic mode barely marks activity at all, so
      // this is the only clock the summary card and progress screen can
      // read (see the elapsedSeconds doc on SessionRecord in st/storage)
      elapsedSeconds: Math.floor((Date.now() - this.state.sessionStartedAt - this.state.pausedMs) / 1000),
    })

    if (!session) {
      this.savePractice(sectionPractice)
      return null
    }

    let saving = getAppStore().putSession(session, {sectionPractice})
      .catch(err => console.warn("Couldn't save the practice session", err))

    let result = {session, saving}
    this.lastRecord = result
    return result
  }

  newStats() {
    let session = getSession()
    return new NoteStats(session && session.currentUser, {sessionGap: Infinity})
  }

  // Records the session played on the current staff and generator, returning
  // the stats for the next one
  closeSession() {
    this.recordSession()
    // the stats start over, so the column under way may count a miss again
    this.matcher.forgetMisses()
    return this.newStats()
  }

  openStatsLightbox() {
    trigger(this, "showLightbox",
      <StatsLightbox
        resetStats={() => this.clearStats()}
        stats={this.state.stats} />)
  }

  render() {
    let scoreAtRest = this.scoreAtRest()

    return <div
      ref="page_container"
      className={classNames(styles.sight_reading_page, {
        [styles.fullscreen]: this.state.fullscreen,
        [styles.scroll_mode]: this.state.mode == "scroll",
        [styles.wait_mode]: this.state.mode == "wait",
        [styles.score_layout]: this.programme.scoreLayout,
    })}>
      <div className={styles.trainer_scroller}>
        <main className={styles.trainer}>
          {scoreAtRest ? this.renderScoreView() : <React.Fragment>
            {this.programme.Drawer && this.renderProgrammeButton()}
            {this.renderTitle()}

            <div className={styles.trainer_grid}>
              <div className={styles.trainer_main}>
                {this.renderStaffPlate()}
                {this.renderSelfGrade()}
                {this.renderTransport()}
                {this.renderStatCards()}
              </div>
              {this.programme.SessionRail ? <this.programme.SessionRail
                settings={this.currentSettings()}
                generator={this.currentNotesGenerator()}
                sessionLog={this.state.sessionLog}
                elapsedSeconds={this.elapsedSeconds()}
                onSkipReadThrough={this.skipReadThrough} /> : this.renderRail()}
            </div>
          </React.Fragment>}
        </main>
      </div>

      {(!this.programme.ScoreView || !scoreAtRest) && this.renderKeyboardFooter()}

      {this.programme.Drawer && <this.programme.Drawer
        open={this.state.settingsOpen}
        close={this.closeSettings}
        apply={this.applySettings}
        staves={STAVES}
        generators={this.programme.generators}
        saveGeneratorPreset={this.state.savingPreset}

        currentGenerator={this.state.currentGenerator}
        currentGeneratorSettings={this.state.currentGeneratorSettings}
        currentStaff={this.state.currentStaff}
        currentKey={this.state.keySignature}

        setGenerator={this._setGenerator ||= this.setGenerator.bind(this)}

        setKeySignature={this._setKeySignature ||= this.setKeySignature.bind(this)}
        setStaff={this._setStaff ||= this.setStaff.bind(this)}

        mode={this.state.mode}
        setMode={this._setMode ||= this.setMode.bind(this)}
        scrollSpeed={this.state.scrollSpeed}
        setScrollSpeed={this._setScrollSpeed ||= scrollSpeed => {
          storeCurrentDrill({speed: scrollSpeed}, this.programme.storageKey)
          this.setState({scrollSpeed})
        }}
        tempo={this.state.tempo}
        setTempo={this._setTempo ||= on => this.setTempo(on)}
        acoustic={this.selfGraded()}
      />}

      {this.renderDevMetrics()}

      <Hotkeys keyMap={this.keyMap} />
      {this.renderSummary()}
    </div>;
  }

  // the score-first score page at rest (score-first design §D1-D7, D11):
  // the setup pane replaces the drawer, and the score itself replaces the
  // trainer's own grid; see st/components/sight_reading/score_view
  renderScoreView() {
    let ScoreView = this.programme.ScoreView

    return <ScoreView
      settings={this.currentSettings()}
      setSettings={this.setCurrentSettings}
      staff={this.state.currentStaff}
      columnStaff={this.columnStaff()}
      keySignature={this.state.keySignature}
      generator={this.currentNotesGenerator()}
      source={this.state.engineSource}
      engine={this.programme.engine}
      loadEngines={this.props.loadEngines}
      pickPiece={this.programme.pickPiece}
      mode={this.state.mode}
      setMode={this._setMode ||= this.setMode.bind(this)}
      scrollSpeed={this.state.scrollSpeed}
      setScrollSpeed={this._setScrollSpeed ||= scrollSpeed => {
        storeCurrentDrill({speed: scrollSpeed}, this.programme.storageKey)
        this.setState({scrollSpeed})
      }}
      tempo={this.state.tempo}
      setTempo={this._setTempo ||= on => this.setTempo(on)}
      acoustic={this.selfGraded()}
      ended={this.state.ended}
      sessionLog={this.state.sessionLog}
      idleTitle={this.programme.idleTitle}
      onBegin={this.begin}
      onPlayOn={this.playOn}
      onSkipReadThrough={this.skipReadThrough}
      onDismissEnded={this.dismissEnded} />
  }

  // The session summary card (st/components/sight_reading/session_summary),
  // opened by Rest alone (see openSummary). Rendered last, after the stat
  // cards, so existing specs that find the Accuracy card with
  // el.querySelector("[role=button]") keep finding it
  renderSummary() {
    if (!this.state.summary) { return null }

    let {record, eyebrow} = this.state.summary

    return <SessionSummary
      record={record}
      eyebrow={eyebrow}
      onPractise={this.programme.focusGenerator ?
        (this._practiseNotes ||= () => this.practiseNotes()) : null}
      onNewProgramme={this.programme.newProgramme ?
        null : (this._newProgramme ||= () => this.newProgramme())}
      newProgrammeTo={this.programme.newProgramme}
      onClose={this._closeSummary ||= () => this.closeSummary()}
    />
  }

  // the developer metrics panel and its pill in the header, only when
  // enabled (see st/dev_metrics)
  renderDevMetrics() {
    // nothing is detected in acoustic mode, so there is nothing to measure
    if (!this.devMetrics || this.selfGraded()) { return null }

    let pill = <Pill
      variant="ghost"
      className={devMetricsStyles.metrics_pill}
      aria-pressed={!!this.state.devMetricsOpen}
      onClick={this.toggleDevMetrics}>
      Metrics
    </Pill>

    return <>
      {this.state.headerActions && !this.state.fullscreen ?
        createPortal(pill, this.state.headerActions) :
        <div className={devMetricsStyles.floating_toggle}>{pill}</div>}
      {this.state.devMetricsOpen && <DevMetricsPanel
        generator={this.currentNotesGenerator()}
        matcher={this.matcher}
        lastHit={this.lastHit}
        session={!!this.state.session}
        close={this.toggleDevMetrics}
      />}
    </>
  }

  // in the header's top row, or atop the trainer when there's no header or
  // the trainer is fullscreen
  renderProgrammeButton() {
    let pill = <Pill
      variant="ghost"
      className={styles.programme_pill}
      aria-label="Programme"
      aria-expanded={!!this.state.settingsOpen}
      onClick={this.openSettings}>
      <span className={styles.hairlines} aria-hidden="true"><span /><span /><span /></span>
      <span className={styles.programme_label}>Programme</span>
    </Pill>

    if (this.state.headerActions && !this.state.fullscreen) {
      return createPortal(pill, this.state.headerActions)
    }

    return <div className={styles.programme_row}>{pill}</div>
  }

  // the generator of the notes on the staff
  currentNotesGenerator() {
    return (this.state.notes && this.state.notes.generator) || null
  }

  // Acoustic mode (st/srs/self_grade): the instrument setting is acoustic,
  // the programme opts in, and the generator on the staff can record the
  // player's own grade. Detection is off throughout and the drill stays in
  // wait mode. A generator without selfGrade (pasted notation, a section with
  // no notes) has nothing to grade, so it stays detected even with the
  // instrument toggle on, and the whole page with it.
  selfGraded() {
    let generator = this.currentNotesGenerator()
    return !!(this.props.acoustic && this.programme.selfGrading &&
      generator && generator.selfGrade)
  }

  // Opens ("Where?") or closes (change grade, grade null) the follow-up
  // question for a failing grade, which SelfGradeRow asks before ending the
  // pass: nothing is written or graded here, only what the row and the
  // engine card's badges (see selfGradeBadges) show
  selfAsk(grade) {
    this.setState({selfAsking: grade})
  }

  // Begins ending the pass with the player's own grade (SelfGradeRow), in
  // place of detection: shows the tapped pill recorded, with every other
  // pill and tag disabled (the row's own doing, from state.selfRecorded),
  // for SELF_GRADE_FLASH_MS, today's double-tap guard made visible. Only
  // then does writeSelfGrade tell the generator and the session stats, and
  // refill the staff from the next card, stamped with this tap's time. A
  // pass takes one grade, and the deck moves on only as it is written, so a
  // repeated tap or key press during the flash is dropped by the guard
  // below, and once it before that by the row's own dwell.
  selfGrade(grade, opts={}) {
    let generator = this.currentNotesGenerator()
    if (this.pendingSelfGrade || !this.selfGraded() || !generator) { return }

    let time = Date.now()
    let timer = window.setTimeout(() => this.writeSelfGrade(), SELF_GRADE_FLASH_MS)
    this.pendingSelfGrade = {grade, opts, time, generator, timer}
    this.setState({selfRecorded: {grade, bars: opts.bars}})
  }

  // Writes the grade flashing, if any, through to the generator it belongs
  // to and the session stats, then refills the staff from the next card.
  // Called by the flash timer, and by every path that would otherwise lose a
  // grade already given: recordSession (Rest, page leave, Clear stats and
  // Begin) and a rebuilt drill (refreshNoteList, keepGenerator null). Drops
  // the grade instead when the generator it belongs to is no longer the one
  // on the staff, or acoustic mode has been switched off mid-flash: its
  // practice goes through the usual abandoned-pass path (flushPractice)
  // rather than being written as a detected pass.
  writeSelfGrade() {
    let pending = this.pendingSelfGrade
    if (!pending || this.grading) { return }

    window.clearTimeout(pending.timer)
    this.grading = true
    try {
      this.pendingSelfGrade = null
      if (pending.generator != this.currentNotesGenerator() || !this.selfGraded()) { return }

      let time = pending.time
      pending.generator.selfGrade(pending.grade, {...pending.opts, sessionId: this.state.stats.id, time})
      this.state.stats.selfGraded(pending.grade, time)
      if (!this.unmounted) { this.refreshNoteList(pending.generator) }
    } finally {
      this.grading = false
      if (!this.unmounted) { this.setState({selfAsking: null, selfRecorded: null}) }
    }
  }

  // Hotkeys "1"-"4", only while a session is running in acoustic mode: each
  // goes through the grade row itself, the one path a tap on its pill takes,
  // so a grade with a "Where?" question asks it from the keyboard too
  selfGradeHotkey(grade) {
    if (!this.selfGraded() || !this.state.session) { return }

    let row = this.selfGradeRow.current
    if (row) { row.grade(grade) }
  }

  titleParts() {
    let section = this.currentPieceSection()
    if (section) {
      let hand = HAND_LABELS[this.currentSettings().hand] || "both hands"
      let generator = this.currentNotesGenerator()
      let measures = generator && generator.sectionLabel ? generator.sectionLabel() :
        measuresLabel(section.startMeasure, section.endMeasure)
      return {
        title: section.pieceTitle,
        italic: `${measures}, ${hand}`,
      }
    }

    if (this.programme.idleTitle) {
      let settings = this.currentSettings()
      if (settings.song?.trim()) {
        return {
          title: "Pasted song notation",
          italic: measuresLabel(settings.startMeasure, settings.endMeasure),
        }
      }

      return this.programme.idleTitle
    }

    let generator = this.state.currentGenerator
    if (!generator) { return {} }

    let key = this.state.keySignature
    return {
      title: generatorLabel(generator),
      italic: key.isChromatic() ? "chromatic" : `in ${keyLabel(key)} major`,
    }
  }

  renderTitle() {
    let {title, italic} = this.titleParts()
    // a restPauses page (the score page) only reaches renderTitle in
    // session, never at rest (ScoreView takes its place there), so its
    // eyebrow names the piece it's in session on rather than the salon
    let section = this.currentPieceSection()
    let eyebrow = this.programme.restPauses && section ?
      `In session · ${section.pieceTitle}` : "Salon de Paris · 1836"

    return <div className={styles.title}>
      <TitleBlock eyebrow={eyebrow} title={title} italic={italic} />
      <FleuronRule />
    </div>
  }

  // the staff and key, or the imported piece's metre and measures
  plateLabel() {
    let section = this.currentPieceSection()
    if (section) {
      let song = pieceSong(sheetMusicPiece(this.currentSettings()))
      let beats = song && song.metadata && song.metadata.beatsPerMeasure
      let {card, number} = this.currentCard() || {}
      let generator = this.currentNotesGenerator()
      let measures = generator && generator.cardLabel && card ? generator.cardLabel() :
        cardLabel(card, number, section)
      return beats ? `${beats} ♩ a bar · ${measures}` : measures
    }

    let staff = this.state.currentStaff
    if (!staff) { return null }

    let key = this.state.keySignature
    return `${staffLabel(staff)} · ${key.isChromatic() ? "chromatic" : `${keyLabel(key)} major`}`
  }

  // the next note to read while the session runs
  statusLine() {
    if (!this.state.session) {
      return "At rest"
    }

    let notes = this.state.notes
    if (!notes || !notes.length) {
      return "No notes to read"
    }

    let line = notes.generator && notes.generator.statusLine && notes.generator.statusLine()
    if (line) {
      return line
    }

    if (this.selfGraded()) {
      return "Play the card through, then grade it"
    }

    if (this.state.currentGenerator?.mode == "chords") {
      return `Next · ${notes[0]}`
    }

    let column = notes.currentColumn()
    return `Next · ${column.map(displayNoteName).join(" ")}`
  }

  renderStaffPlate() {
    let staff
    let engineCard = this.engineCard()

    if (this.state.currentStaff) {
      // new renderer with mode notes only
      if (this.state.newRenderer && this.state.currentStaff.mode == "notes") {
        staff = <StaffTwo
           ref= {staff => this.staff = staff}
           type = {this.state.currentStaff.name}
           heldNotes = {this.state.heldNotes}
           notes = {this.state.notes}
           keySignature = {this.state.keySignature}
           noteWidth = {this.state.noteWidth}
           noteShaking = {this.state.noteShaking}
           scale = {this.state.scale}
           height = {STAFF_TWO_HEIGHT}
           maxScale = {0.3 * PLATE_STAFF_SCALE}
           range = {this.state.currentStaff.range}
           hitX = {this.state.mode == "scroll" ? this.state.hitX : null}
          />
      } else if (engineCard) {
        staff = <ScoreCard
          ref={this.setEngineStaff}
          {...engineCard}
          loadEngines={this.props.loadEngines}
          onError={this._onEngineError ||= () => this.setState({
            engineSource: {...this.state.engineSource, status: "failed"},
          })} />
      } else if (this.engineCardPending()) {
        staff = null
      } else {
        staff = this.state.currentStaff.render.call(this, {
          heldNotes: this.state.heldNotes,
          notes: this.state.notes,
          keySignature: this.state.keySignature,
          noteWidth: this.state.noteWidth,
          noteShaking: this.state.noteShaking,
          scale: this.state.scale,
        })
      }
    }

    return <Plate className={styles.staff_plate}>
      <div className={styles.plate_header}>
        <span>{this.plateLabel()}</span>
        <span className={styles.plate_status} aria-live="polite">{this.statusLine()}</span>
      </div>
      <div
        ref={this.setStaffWrapper}
        className={classNames(staffStyles.staff_wrapper, styles.staff_wrapper, {
          [styles.engine_system]: engineCard && engineCard.system,
          [styles.paused]: this.programme.restPauses && this.state.paused,
        })}>
        {staff}
      </div>
      {this.renderPausedBanner()}
      {this.renderCaption()}
      {this.renderEngineSourceNote()}
      {this.renderFeedback()}
    </Plate>
  }

  // the "At rest" banner inside the staff plate, below the card, on a
  // restPauses page while paused
  renderPausedBanner() {
    if (!this.programme.restPauses || !this.state.paused) { return null }

    return <div className={styles.paused_banner}>
      <p className={styles.paused_text}>
        At rest. The clock is stopped and the card waits here; resume when you are ready.
      </p>
      <Pill variant="primary" className={styles.resume_pill} onClick={this.resumeSession}>Resume</Pill>
      <Pill variant="ghost" className={styles.end_session_pill} onClick={this.endSession}>End session</Pill>
    </div>
  }

  // the generator's word on the card just played, eg. when it comes back;
  // null in acoustic mode, where the receipt (renderSelfGrade) says it instead
  renderCaption() {
    if (this.selfGraded()) { return null }

    let generator = this.currentNotesGenerator()
    let caption = this.state.session && generator && generator.caption && generator.caption()
    return caption ? <p className={styles.plate_note} data-caption>{caption}</p> : null
  }

  // the plate's gentle feedback state (see PlateFeedback): an ink smudge at
  // the head column on every wrong key. Hidden in acoustic mode, where
  // nothing is detected to react to
  renderFeedback() {
    if (this.selfGraded()) { return null }

    return <PlateFeedback
      smudge={this.state.smudges}
      locateHead={() => this.headElements()} />
  }

  // why a piece is drawn on the app's staff rather than from its score
  renderEngineSourceNote() {
    let source = this.state.engineSource
    if (!this.programme.engine || !source) { return null }

    let note = {missing: MISSING_ENGINE_SOURCE, failed: FAILED_ENGINE_SOURCE}[source.status]
    return note ? <p className={styles.plate_note} data-engine-note>{note}</p> : null
  }

  // the receipt and the grade row (acoustic mode) between the staff plate
  // and the transport, else the at-rest note. The receipt is up for the
  // whole session, even once the programme has no more cards, so the last
  // pass's receipt stays visible; the row (keyed by cardSeq, so it starts
  // fresh for every new pass, including a looping card: no stale "What
  // slipped?" tags or a pending "Where?" question) only while there is one
  renderSelfGrade() {
    if (!this.selfGraded()) { return null }

    if (!this.state.session) {
      return <p className={styles.plate_note} data-self-grade-rest>
        Acoustic piano: press Begin, play the card, then grade it.
      </p>
    }

    let generator = this.currentNotesGenerator()
    let followUp = generator.selfFollowUp ? generator.selfFollowUp(AGAIN) : null

    return <>
      <SelfGradeReceipt receipt={generator.selfReceipt ? generator.selfReceipt() : null} />
      {generator.currentCard() && <SelfGradeRow
        ref={this.selfGradeRow}
        key={this.state.cardSeq}
        grades={SELF_GRADES}
        followUp={followUp}
        aspects={SELF_ASPECTS}
        asking={this.state.selfAsking}
        recorded={this.state.selfRecorded}
        onAsk={this._onSelfAsk ||= grade => this.selfAsk(grade)}
        onGrade={this._onSelfGrade ||= (grade, opts) => this.selfGrade(grade, opts)}
      />}
    </>
  }

  renderTransport() {
    let fullscreenButton
    if (document.body.webkitRequestFullscreen && !this.state.fullscreen) {
      fullscreenButton = <Pill
        variant="ghost"
        className={styles.transport_pill}
        onClick={e => this.toggleFullscreen()}>Fullscreen</Pill>
    }

    let keyboardToggle
    if (this.state.currentStaff && this.state.currentStaff.mode == "notes" && !this.selfGraded()) {
      keyboardToggle = <Pill
        variant="ghost"
        className={styles.transport_pill}
        aria-pressed={!this.state.keyboardOpen}
        onClick={this.toggleKeyboard.bind(this)}>
        {this.state.keyboardOpen ? "Hide keyboard" : "Show keyboard"}
      </Pill>
    }

    let restPauses = this.programme.restPauses
    let sessionLabel = this.state.paused ? "Resume" : this.state.session ? "Rest" : "Begin"

    return <div className={styles.transport}>
      <Pill
        variant="primary"
        className={classNames(styles.session_pill, {[styles.resume_pill]: restPauses && this.state.paused})}
        aria-pressed={this.state.session}
        onClick={this.toggleSession}>{sessionLabel}</Pill>
      {restPauses && <Pill
        variant="ghost"
        className={styles.end_session_pill}
        onClick={this.endSession}>End session</Pill>}
      <Pill
        variant="ghost"
        className={styles.transport_pill}
        disabled={!this.state.currentGenerator}
        onClick={() => this.refreshNoteList()}>New passage</Pill>
      {keyboardToggle}
      {fullscreenButton}
      <span className={styles.tempo_readout}>
        {this.selfGraded() ? "Self-graded" : <>
          {this.state.mode == "scroll" ? "Scroll" : "Wait"}
          {this.tempoMode() ? <>
            {" "}<span className={styles.gilt} aria-hidden="true">·</span>{" "}in tempo
          </> : null}
          {" "}<span className={styles.gilt} aria-hidden="true">·</span>{" "}
          speed {this.state.scrollSpeed}
        </>}
      </span>
    </div>
  }

  renderStatCards() {
    let stats = this.state.stats

    // live MIDI figures (accuracy, notes read, best streak) don't apply:
    // nothing is detected, so they would only mislead
    if (this.selfGraded()) {
      return <div className={styles.stat_cards}>
        <StatCard className={styles.stat_card} label="Elapsed" value={formatElapsed(this.elapsedSeconds())} />
        <StatCard className={styles.stat_card} label="Passes" value={stats.passes} />
        <StatCard className={styles.stat_card} label="Clean" value={stats.cleanPasses} />
      </div>
    }

    let accuracy = accuracyPercent(stats.hits, stats.misses)

    return <div className={styles.stat_cards}>
      <StatCard
        className={styles.stat_card}
        label="Elapsed"
        value={formatElapsed(this.elapsedSeconds())} />

      <div
        role="button"
        tabIndex={0}
        className={styles.stat_button}
        title="Session stats"
        onClick={() => this.openStatsLightbox()}
        onKeyDown={e => {
          if (e.key == "Enter" || e.key == " ") {
            // Hotkeys listens on window, so without this the space bar would
            // also reach skipCurrentNote via the keyMap
            e.preventDefault()
            e.stopPropagation()
            this.openStatsLightbox()
          }
        }}>
        <StatCard
          className={styles.stat_card}
          label="Accuracy"
          accent
          value={accuracy == null ? "—" : accuracy}
          suffix={accuracy == null ? null : "%"} />
      </div>

      <StatCard className={styles.stat_card} label="Notes read" value={stats.hits} />
      <StatCard className={styles.stat_card} label="Best streak" value={stats.bestStreak} />
    </div>
  }

  // the last sessions started today saved to the local store, newest last
  eveningSessions() {
    let now = new Date()
    let today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return getAppStore().recentSessions().filter(s => s.startedAt >= today).slice(-3)
  }

  renderRail() {
    let sessions = this.eveningSessions()

    let evening
    if (sessions.length) {
      evening = <ol className={styles.evening_list}>
        {sessions.map((session, idx) => {
          let staff = STAVES.find(s => s.name == session.staff)
          let generator = GENERATORS.find(g =>
            g.name == session.generator && (!staff || g.mode == staff.mode))

          let exercise = session.settings?.pieceTitle ||
            (generator ? generatorLabel(generator) : session.generator)

          let parts = [staff ? `${staffLabel(staff)} staff` : session.staff, exercise].filter(Boolean)
          // a sitting that detected notes and graded passes of its own (the
          // instrument toggled part way through) is summed up by both
          let accuracy = accuracyPercent(session.notesRead, session.misses)
          let {selfGraded} = session
          let graded = selfGraded ?
            `${selfGraded.passes} ${selfGraded.passes == 1 ? "pass" : "passes"} graded` +
              (selfGraded.clean ? ` · ${selfGraded.clean} clean` : "") :
            null
          let detail = [accuracy == null ? null : `${accuracy}% accuracy`, graded]
            .filter(Boolean).join(" · ") || "No notes read"

          return <li key={session.id} className={styles.evening_row}>
            <span className={styles.numeral}>{romanNumeral(idx + 1)}</span>
            <span className={styles.evening_text}>
              {parts.join(", ")}
              <span className={styles.evening_detail}>{detail}</span>
            </span>
          </li>
        })}
      </ol>
    } else {
      evening = <p className={styles.evening_empty}>Nothing played yet</p>
    }

    return <aside className={styles.rail}>
      <figure className={styles.engraving}>
        <div className={styles.engraving_slot}>
          <img
            src={SALON_IMAGE}
            alt="A ball at the Hôtel Lambert in Paris, Chopin at the piano" />
        </div>
        <figcaption className={styles.engraving_caption}>Soirée at the Hôtel Lambert</figcaption>
      </figure>

      <div className={styles.evening}>
        <SectionLabel ornament="❧">This evening</SectionLabel>
        {evening}
      </div>

      <PullQuote>{PULL_QUOTE}</PullQuote>
    </aside>
  }

  renderKeyboardFooter() {
    let staff = this.state.currentStaff
    // nothing is detected in acoustic mode: neither the on-screen keyboard
    // nor its typing input, which maps keys "2"-"9" that would collide with
    // the grade hotkeys "1"-"4"
    let hasKeyboard = staff && staff.mode == "notes" && !this.selfGraded()
    let open = hasKeyboard && this.state.keyboardOpen

    let content
    if (open) {
      let [lower, upper] = staff.range
      let held = Object.keys(this.state.heldNotes)

      content = <div className={styles.keyboard_inner}>
        <div className={styles.keyboard_label}>
          <span>Pleyel upright — {lower} to {upper}</span>
          <span>Held {held.length ? held.join(" · ") : "—"}</span>
        </div>
        <div className={styles.keyboard_well}>
          <Keyboard
            className={styles.keyboard}
            lower={lower}
            upper={upper}
            midiOutput={this.props.midiOutput}
            heldNotes={this.state.heldNotes}
            onKeyDown={this.pressNote}
            onKeyUp={this.releaseNote} />
        </div>
      </div>
    }

    return <footer className={classNames(styles.keyboard_footer, {[styles.collapsed]: !open})}>
      <div className={styles.piano_lid} aria-hidden="true" />
      {// the keys drawn bring their own typing input, so the hidden keyboard
       // keeps the computer keyboard playable with this one
       hasKeyboard && !open ? <KeyboardInput
        midiOutput={this.props.midiOutput}
        onKeyDown={this.pressNote}
        onKeyUp={this.releaseNote} /> : null}
      {content}
    </footer>
  }
}
