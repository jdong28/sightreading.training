import NoteList from "st/note_list"
import ChordList from "st/chord_list"
import NoteStats from "st/note_stats"
import SlideToZero from "st/slide_to_zero"
import Keyboard from "st/components/keyboard"
import StatsLightbox from "st/components/sight_reading/stats_lightbox"
import Hotkeys from "st/components/hotkeys"

import styles from "./sight_reading_page.module.css"
import staffStyles from "st/components/staff.module.css"

import {noteName, parseNote} from "st/music"
import {STAVES, GENERATORS, sheetMusicPiece, handTracks, RIGHT_HAND, LEFT_HAND} from "st/data"
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
import {setTitle, gaEvent, csrfToken} from "st/globals"
import {dispatch, trigger} from "st/events"
import {NOTE_EVENTS} from "st/midi"
import {
  generatorDefaultSettings, storeCurrentDrill, currentStaffFor, currentGeneratorFor,
  currentKeySignature, currentDrillMode, currentScrollSpeed, scoreKeySignature,
  DRILL_STORAGE_KEY
} from "st/generators"

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
import {SCROLL_WAIT} from "st/score_render/card_scroll"

const DEFAULT_NOTE_WIDTH = 100
const DEFAULT_SPEED = 4

// the height the new renderer paints the staff at inside the staff plate
const STAFF_TWO_HEIGHT = 150

// both renderers draw the staff this much smaller inside the staff plate
export const PLATE_STAFF_SCALE = 0.8

// the legacy renderer's scale for the window's width
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

export function romanNumeral(n) {
  let out = ""
  for (let [value, numeral] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
    while (n >= value) {
      out += numeral
      n -= value
    }
  }
  return out
}

// eg. "C#4" -> "C♯4", in the app's octave numbering like the keyboard labels
function displayNoteName(note) {
  return String(note).replace("#", "♯").replace(/^([A-G])b/, "$1♭")
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

  // Optional:
  // idleTitle, the page title's {title, italic} while no piece is drilled, in
  // place of the exercise's name and key.
  // staffFor(settings), the staff the generator's settings (defaults filled
  // in) are drawn on, which then follows them in place of a clef setting.
  // engine, the key of the engraving engine (st/score_render) that draws an
  // imported piece's cards from its source MusicXML, in place of the app's
  // own staff (see engineCard): in wait mode card by card, in scroll mode the
  // whole section on one line
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
    this.toggleSession = e => {
      // so the space bar skips a note instead of pressing the pill again
      if (e && e.currentTarget) { e.currentTarget.blur() }
      if (this.state.session) {
        this.restSession()
      } else {
        this.beginSession()
      }
    }

    this.keyMap = {
      " ": e => this.skipCurrentNote(),
    }

    // the key the user picked, drawn unless the generator sets its own
    this.userKey = this.programme.userKey()

    this.state = {
      newRenderer: props.useStaffTwo || false,
      noteShaking: false,
      anyOctave: false,

      // the set of notes that are currently held down
      heldNotes: {},

      // the set of notes that have been touched since holding any one note.
      // Resets to empty when all notes are released
      touchedNotes: {},

      scrollSpeed: currentScrollSpeed(this.programme.storageKey),

      noteWidth: DEFAULT_NOTE_WIDTH,

      bufferSize: 10,
      keyboardOpen: true,
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

      // the source MusicXML of the drilled piece, for the programme's
      // engine: {piece, status: "loading" | "ready" | "missing" | "failed",
      // musicXML, measureStarts}
      engineSource: null,
      // the columns of the engine card a miss was counted on this pass
      engineMissed: [],
    }
  }

  // TODO trigger this as watching component
  componentDidUpdate(prevProps, prevState) {
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
  // drilled piece read, and the misses marked on the card cleared when a new
  // pass of it starts
  updateEngineCard(prevState) {
    if (!this.programme.engine) { return }

    this.loadEngineSource()

    // a card whose columns can't be joined (a piece stored without the
    // score's rhythm), or whose hand's staves can't be told in the score, is
    // drawn by the app's staff
    let current = this.engineCards() && this.currentCard()
    if (current && (!joinable(current.card.columns) || this.engineStaves() === undefined)) {
      this.setState({engineSource: {...this.state.engineSource, status: "failed"}})
      return
    }

    if (prevState.notes != this.state.notes && this.state.engineMissed.length) {
      let before = this.cardHead(prevState.notes)
      let after = this.cardHead(this.state.notes)
      if (before.generator != after.generator || before.index == null ||
          after.index == null || after.index <= before.index)
      {
        this.setState({engineMissed: []})
      }
    }
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
  // imported piece whose source is stored
  engineCards() {
    let source = this.state.engineSource
    return !!(this.programme.engine && this.state.mode &&
      source && source.status == "ready" && this.currentPieceSection())
  }

  // whether the plate waits before it knows which staff draws the card: on
  // the piece's source, or on the plate's width for the engine
  engineCardPending() {
    let source = this.state.engineSource
    if (!this.programme.engine || !this.state.mode || !source) { return false }
    return source.status == "loading" || (this.engineCards() && !this.state.staffWidth)
  }

  // The score staves the drill's tracks read, the ones the engine draws:
  // null for every staff, undefined when the stored song's tracks can't be
  // told among the score's
  engineStaves() {
    let settings = this.currentSettings()
    let song = pieceSong(sheetMusicPiece(settings))
    let tracks = handTracks(song, settings.hand)
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

  // The engine card's props for the card at the head of the drill, or null
  // when the app's staff draws it. In scroll mode the engine draws the whole
  // section on one line, which the slider moves along from card to card
  engineCard() {
    if (!this.engineCards()) { return null }

    let current = this.currentCard()
    let width = this.state.staffWidth
    let staves = this.engineStaves()
    if (!current || !width || !joinable(current.card.columns) || staves === undefined) { return null }

    let {card} = current
    let source = this.state.engineSource
    let head = this.cardHead(this.state.notes).index
    let system = this.state.mode == "scroll"
    let drawn = system ? this.currentPieceSection() : card

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
      missed: this.state.engineMissed,
    }
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

  // This generates a new set of notes, appropriate for when the generator or
  // generator parameters have changed in some say
  refreshNoteList() {
    let generator = this.state.currentGenerator

    let generatorSettings = {
      ...generatorDefaultSettings(
        generator,
        this.state.currentStaff
      ),
      ...this.state.currentGeneratorSettings
    }

    let generatorInstance = generator.create.call(
      generator,
      this.state.currentStaff,
      this.state.keySignature,
      generatorSettings
    )

    // the measure cards grade each pass by the drill it is played in
    if (generatorInstance.setDrill) {
      generatorInstance.setDrill(() => ({mode: this.state.mode, speed: this.state.scrollSpeed}))
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

    // enough columns to show the whole of any card of a piece
    let cardColumnCounts = (generatorInstance.cards || []).map(card => card.columns.length)
    notes.fillBuffer(Math.max(this.state.bufferSize, ...cardColumnCounts))
    return this.setState({ notes: notes })
  }

  // keeps state.staffWidth up to date with the staff wrapper's width, which
  // an engine draws a piece's card to
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
    if (staffWidth != this.state.staffWidth) {
      this.setState({staffWidth})
    }
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

    this.restartSession({
      session: true,
      heldNotes: {},
      touchedNotes: {},
    })
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

    this.setState({
      session: false,
      clockNow: Date.now(),
      heldNotes: {},
      touchedNotes: {},
    })

    let saving = this.recordSession()
    if (saving) {
      // shows the session in the evening's list once it is stored
      saving.then(() => {
        if (!this.unmounted) { this.forceUpdate() }
      })
    }
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
    let {sessionStartedAt, clockNow} = this.state
    if (sessionStartedAt == null || clockNow == null) { return 0 }
    return Math.floor((clockNow - sessionStartedAt) / 1000)
  }

  // called when held notes reaches 0
  checkRelease() {
    switch (this.state.currentGenerator.mode) {
      case "notes": {
        let column = this.state.notes.currentColumn()

        if (column.length == 0) {
          this.slipped = false
          this.setState({heldNotes: {}, touchedNotes: {}})
          break
        }

        // every key is up without the column matched: it counts as missed
        // (once) and is played afresh from the next key down
        this.missColumn(column.filter((n) => !this.state.heldNotes[n]))
        this.slipped = false
        this.setState({heldNotes: {}, touchedNotes: {}})
        break
      }

      case "chords": {
        let touched = Object.keys(this.state.touchedNotes);

        if (this.state.notes.matchesHead(touched) && touched.length > 2) {
          gaEvent("sight_reading", "chord", "hit");
          let notes = this.state.notes.clone()

          notes.shift()
          notes.pushRandom()

          this.state.stats.hitNotes([])

          this.setState({
            notes,
            noteShaking: false,
            heldNotes: {},
            touchedNotes: {},
          })

          this.state.slider.add(1)
        } else {
          gaEvent("sight_reading", "chord", "miss");

          this.state.stats.missNotes([])

          this.setState({
            noteShaking: true,
            heldNotes: {},
            touchedNotes: {},
          })

          setTimeout(() => this.setState({noteShaking: false}), 500);
        }
        break
      }
    }
  }

  // called on every noteOn with the note pressed
  // return true to trigger redraw
  checkPress(note) {
    switch (this.state.currentGenerator.mode) {
      case "notes": {
        let {notes, anyOctave} = this.state

        // presses batched into one render (eg. a chord's note-ons in one MIDI
        // packet) all see the same head, only the first one may advance it
        if (this.advancedNotes == notes) {
          return false
        }

        // nothing to play (eg. an empty section): no key is a slip, as no
        // release is a miss
        if (!notes.currentColumn().length) {
          return false
        }

        let touched = Object.keys(this.state.touchedNotes);
        let matched = notes.matchesHead(touched, anyOctave)

        // pressing a key outside the column is a slip: the column counts as
        // missed, but the keys touched still go on to complete it. A slip
        // batched with the notes completing the column is counted before
        // the hit, whichever press is checked first
        let stray = notes.strayNotes(touched, anyOctave)
        if (stray.includes(note) || (matched && stray.length && this.missedNotes != notes)) {
          this.missColumn(notes.currentColumn())
        }

        if (matched) {
          gaEvent("sight_reading", "note", "hit");

          this.advancedNotes = notes
          this.slipped = false
          let advance = this.columnAdvance(notes)
          notes = notes.clone()
          notes.shift();
          notes.pushRandom();
          this.state.stats.hitNotes(touched.filter((n) => !stray.includes(n)));

          this.setState({
            notes,
            heldNotes: {},
            touchedNotes: {},
            // a slip's shake plays out over the next column
            ...(stray.length ? {} : {noteShaking: false}),
          })

          this.state.slider.add(advance)

          return true
        } else {
          return false
        }
      }

      case "chords": {
        // chords only check on release
        return false
      }
    }
  }

  // Counts the head column of notes as missed, at most once however many
  // slips and releases it takes to complete it, shaking the notes and
  // marking the column on an engine card each time. missed are the column's
  // notes the stats count against
  missColumn(missed) {
    if (this.missedNotes != this.state.notes) {
      this.missedNotes = this.state.notes
      gaEvent("sight_reading", "note", "miss");
      this.state.stats.missNotes(missed);
    } else if (!this.slipped) {
      // the grade of the measure cards counts every try gone wrong
      this.state.stats.slipNotes(missed)
    }
    // one slip a try, from a key down to every key up
    this.slipped = true

    let {index} = this.cardHead(this.state.notes)
    let engineMissed = this.state.engineMissed
    if (index != null && !engineMissed.includes(index)) {
      engineMissed = [...engineMissed, index]
    }

    this.setState({noteShaking: true, engineMissed})
    setTimeout(() => this.setState({noteShaking: false}), 500);
  }

  skipCurrentNote() {
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

    this.setState({
      notes,
      noteShaking: false,
      heldNotes: {},
      touchedNotes: {}
    })

    this.state.slider.add(advance)
  }

  pressNote(note) {
    // key presses at rest aren't judged
    if (!this.state.session) {
      return
    }

    switch (this.state.currentGenerator.mode) {
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

    this.setState((s) => ({
      heldNotes: {...s.heldNotes, [note]: true},
      touchedNotes: {...s.touchedNotes, [note]: true}
    }), () => this.checkPress(note))
  }

  releaseNote(note) {
    // note might no longer be considered held if we just moved to next note
    if (this.state.heldNotes[note]) {
      const heldNotes = {...this.state.heldNotes}
      delete heldNotes[note]

      this.setState((s) => {
        const heldNotes = {...s.heldNotes}
        delete heldNotes[note]
        return { heldNotes }
      }, () => {
        if (Object.keys(this.state.heldNotes).length == 0) {
          this.checkRelease()
        }
      })
    }
  }

  onMidiMessage(message) {
    let [raw, pitch, velocity] = message.data;

    let cmd = raw >> 4,
      channel = raw & 0xf,
      type = raw & 0xf0;

    let n = noteName(pitch)

    // console.debug("midi", pitch, velocity, NOTE_EVENTS[type])

    if (NOTE_EVENTS[type] == "noteOn") {
      if (velocity == 0) {
        this.releaseNote(n);
      } else if (!document.hidden) { // ignore when the browser tab isn't active
        this.pressNote(n);
      }
    }

    if (NOTE_EVENTS[type] == "noteOff") {
      this.releaseNote(n);
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

    this.setState({
      mode: "scroll",
      noteWidth: noteWidth,
      slider: new SlideToZero({
        speed: this.state.scrollSpeed / 100,
        loopPhase: 1,
        initialValue: 4,
        // the head column waits on the line, never looping past it
        floor: SCROLL_WAIT,
        onUpdate: value => this.setOffset(value),
        onLoop: function() {
          let column = this.state.notes.currentColumn()
          // notes scrolling past at rest aren't misses
          if (column.length && this.state.session) {
            this.state.stats.missNotes(column);

            let index = column.cardIndex
            if (index != null && !this.state.engineMissed.includes(index)) {
              this.setState({engineMissed: [...this.state.engineMissed, index]})
            }
          }
          // the room the column leaving the staff held, which the notes slide
          // by, so a long note holds the staff for as many beats as the score
          // gives it
          let advance = this.columnAdvance(this.state.notes)
          let notes = this.state.notes.clone()
          notes.shift();
          notes.pushRandom();
          this.setState({ notes })

          let slider = this.state.slider
          slider.value += advance - slider.loopPhase
          slider.loopPhase = advance
        }.bind(this)
      })
    });
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
      startMeasure: settings.startMeasure,
      endMeasure: settings.endMeasure,
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
  // before a note is played. Returns a promise settling once written, or
  // nothing when there was nothing to write
  recordSession() {
    let sectionPractice = this.takePractice()

    let settings = this.currentSettings()
    let section = this.currentPieceSection()
    if (section) {
      settings = {...settings, pieceTitle: section.pieceTitle}
    }

    let session = this.state.stats.sessionRecord({
      staff: this.state.currentStaff?.name,
      generator: this.state.currentGenerator?.name,
      settings,
    })

    if (!session) {
      this.savePractice(sectionPractice)
      return
    }

    return getAppStore().putSession(session, {sectionPractice})
      .catch(err => console.warn("Couldn't save the practice session", err))
  }

  newStats() {
    let session = getSession()
    return new NoteStats(session && session.currentUser, {sessionGap: Infinity})
  }

  // Records the session played on the current staff and generator, returning
  // the stats for the next one
  closeSession() {
    this.recordSession()
    this.missedNotes = null
    return this.newStats()
  }

  openStatsLightbox() {
    trigger(this, "showLightbox",
      <StatsLightbox
        resetStats={() => this.clearStats()}
        stats={this.state.stats} />)
  }

  render() {
    return <div
      ref="page_container"
      className={classNames(styles.sight_reading_page, {
        [styles.fullscreen]: this.state.fullscreen,
        [styles.scroll_mode]: this.state.mode == "scroll",
        [styles.wait_mode]: this.state.mode == "wait",
    })}>
      <div className={styles.trainer_scroller}>
        <main className={styles.trainer}>
          {this.renderProgrammeButton()}
          {this.renderTitle()}

          <div className={styles.trainer_grid}>
            <div className={styles.trainer_main}>
              {this.renderStaffPlate()}
              {this.renderTransport()}
              {this.renderStatCards()}
            </div>
            {this.renderRail()}
          </div>
        </main>
      </div>

      {this.renderKeyboardFooter()}

      <this.programme.Drawer
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
      />

      <Hotkeys keyMap={this.keyMap} />
    </div>;
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

  titleParts() {
    let section = this.currentPieceSection()
    if (section) {
      let hand = HAND_LABELS[this.currentSettings().hand] || "both hands"
      return {
        title: section.pieceTitle,
        italic: `${measuresLabel(section.startMeasure, section.endMeasure)}, ${hand}`,
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

    return <div className={styles.title}>
      <TitleBlock eyebrow="Salon de Paris · 1836" title={title} italic={italic} />
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
      let measures = cardLabel(card, number, section)
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
        })}>
        {staff}
      </div>
      {this.renderEngineSourceNote()}
    </Plate>
  }

  // why a piece is drawn on the app's staff rather than from its score
  renderEngineSourceNote() {
    let source = this.state.engineSource
    if (!this.programme.engine || !source) { return null }

    let note = {missing: MISSING_ENGINE_SOURCE, failed: FAILED_ENGINE_SOURCE}[source.status]
    return note ? <p className={styles.plate_note} data-engine-note>{note}</p> : null
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
    if (this.state.currentStaff && this.state.currentStaff.mode == "notes") {
      keyboardToggle = <Pill
        variant="ghost"
        className={styles.transport_pill}
        aria-pressed={!this.state.keyboardOpen}
        onClick={this.toggleKeyboard.bind(this)}>
        {this.state.keyboardOpen ? "Hide keyboard" : "Show keyboard"}
      </Pill>
    }

    return <div className={styles.transport}>
      <Pill
        variant="primary"
        className={styles.session_pill}
        aria-pressed={this.state.session}
        onClick={this.toggleSession}>{this.state.session ? "Rest" : "Begin"}</Pill>
      <Pill
        variant="ghost"
        className={styles.transport_pill}
        disabled={!this.state.currentGenerator}
        onClick={() => this.refreshNoteList()}>New passage</Pill>
      {keyboardToggle}
      {fullscreenButton}
      <span className={styles.tempo_readout}>
        {this.state.mode == "scroll" ? "Scroll" : "Wait"}
        {" "}<span className={styles.gilt} aria-hidden="true">·</span>{" "}
        speed {this.state.scrollSpeed}
      </span>
    </div>
  }

  renderStatCards() {
    let stats = this.state.stats
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
            e.preventDefault()
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
          let accuracy = accuracyPercent(session.notesRead, session.misses)

          return <li key={session.id} className={styles.evening_row}>
            <span className={styles.numeral}>{romanNumeral(idx + 1)}</span>
            <span className={styles.evening_text}>
              {parts.join(", ")}
              <span className={styles.evening_detail}>
                {accuracy == null ? "No notes read" : `${accuracy}% accuracy`}
              </span>
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
    let hasKeyboard = staff && staff.mode == "notes"
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
      {content}
    </footer>
  }
}
