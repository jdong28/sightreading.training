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
import {STAVES, GENERATORS, sheetMusicPiece, RIGHT_HAND, LEFT_HAND} from "st/data"
import {pieceSong} from "st/sheet_music_deck"
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
  currentKeySignature, currentDrillMode, currentScrollSpeed, scoreKeySignature
} from "st/generators"

import * as React from "react"
import {createPortal} from "react-dom"
import classNames from "classnames"
import NoSleep from "nosleep.js"

import {isMobile} from "st/browser"

import {getSession} from "st/app"

import {StaffTwo} from "st/components/staff_two"
import {fitNoteWidth, fitStaffScale, minNoteWidth} from "st/components/staff_notes"
import {columnAdvances, columnSpan} from "st/staff_rhythm"
import {drillColumns} from "st/measure_cards"

const DEFAULT_NOTE_WIDTH = 100
const DEFAULT_SPEED = 4

// the height the new renderer paints the staff at inside the staff plate
const STAFF_TWO_HEIGHT = 150

// both renderers draw the staff this much smaller inside the staff plate
export const PLATE_STAFF_SCALE = 0.8

// A piece's card (or whole section) is fitted to the plate: its columns are
// squeezed down to the card's minNoteWidth, then the staff shrinks down to
// MIN_FIT_SCALE, the smallest staff still worth reading, which fits a card of
// up to six of the score's busiest bars. A card that still doesn't fit, the
// densest eight bar ones, runs on past the plate's edge
export const MIN_FIT_SCALE = 0.4

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

export default class SightReadingPage extends React.Component {
  constructor(props) {
    super(props);

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
    this.userKey = currentKeySignature()

    this.state = {
      newRenderer: props.useStaffTwo || false,
      noteShaking: false,
      anyOctave: false,

      // the set of notes that are currently held down
      heldNotes: {},

      // the set of notes that have been touched since holding any one note.
      // Resets to empty when all notes are released
      touchedNotes: {},

      scrollSpeed: currentScrollSpeed(),

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

    if (prevState.currentStaff != this.state.currentStaff ||
        prevState.currentGenerator != this.state.currentGenerator ||
        prevState.currentGeneratorSettings != this.state.currentGeneratorSettings ||
        prevState.stats != this.state.stats)
    {
      this.flushSectionPractice()
    }
  }

  componentDidMount() {
    setTitle()

    this.setStaff(currentStaffFor(STAVES), () => {
      if (currentDrillMode() == "scroll") {
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
  // the columns of a piece's card are fitted to
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

  // The columns of the card on the staff, kept while it is the current one
  // so the staff is handed the same unit as its notes slide through it, with
  // the wrap back to its start when the card loops (see drillColumns)
  unitColumns({card, number}) {
    let loop = number == null
    if (this.unitColumnsCard != card || this.unitColumnsLoop != loop) {
      this.unitColumnsCard = card
      this.unitColumnsLoop = loop
      this.unitColumnsCache = drillColumns(card, {loop})
    }

    return this.unitColumnsCache
  }

  // The legacy staff's scale, column width and unit: the columns of the
  // piece's card (or whole section) on the staff, which fix its margins in
  // every mode. In wait mode the card is also fitted to the plate so every
  // note of it shows: the scale fits every card of the drill, so the staff
  // keeps its size from card to card, and the columns fit the card on it
  staffLayout() {
    let {scale, noteWidth, staffWidth, keySignature} = this.state
    let current = this.currentCard()
    let unitColumns = current ? this.unitColumns(current) : null

    if (!current || this.state.mode != "wait") {
      return {scale, noteWidth, unitColumns}
    }

    // the room a card needs, in the unit the staff draws it with, so the plate
    // is fitted to what is drawn (see drillColumns and st/staff_rhythm)
    let loop = current.number == null
    let spanOf = card => columnSpan(card.columns,
      card == current.card ? unitColumns : drillColumns(card, {loop}))

    scale = Math.min(...this.state.notes.generator.cards.map(card =>
      fitStaffScale(staffWidth, spanOf(card), {
        scale, keySignature, minWidth: minNoteWidth(card.columns, keySignature), minScale: MIN_FIT_SCALE,
      })))

    noteWidth = fitNoteWidth(staffWidth, spanOf(current.card), {
      scale, keySignature, maxWidth: noteWidth, minWidth: minNoteWidth(current.card.columns, keySignature),
    })

    return {scale, noteWidth, unitColumns}
  }

  // How many column widths the staff slides when the head column of notes is
  // done with, which is one for every column of a drill without the score's
  // rhythm and a long note's own room in an imported piece
  columnAdvance(notes) {
    if (!notes || !notes.length) { return 1 }

    let current = this.currentCard()
    let [advance] = columnAdvances(notes, current ? this.unitColumns(current) : null)
    return advance > 0 ? advance : 1
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
          this.setState({heldNotes: {}, touchedNotes: {}})
          break
        }

        let missed = column.filter((n) => !this.state.heldNotes[n]);

        gaEvent("sight_reading", "note", "miss");
        this.state.stats.missNotes(missed);

        this.setState({
          noteShaking: true,
          heldNotes: {},
          touchedNotes: {},
        });

        setTimeout(() => this.setState({noteShaking: false}), 500);
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

  // called on every noteOn
  // return true to trigger redraw
  checkPress() {
    switch (this.state.currentGenerator.mode) {
      case "notes": {
        // presses batched into one render (eg. a chord's note-ons in one MIDI
        // packet) all see the same head, only the first one may advance it
        if (this.advancedNotes == this.state.notes) {
          return false
        }

        let touched = Object.keys(this.state.touchedNotes);
        if (this.state.notes.matchesHead(touched, this.state.anyOctave)) {
          gaEvent("sight_reading", "note", "hit");

          this.advancedNotes = this.state.notes
          let advance = this.columnAdvance(this.state.notes)
          let notes = this.state.notes.clone()
          notes.shift();
          notes.pushRandom();
          this.state.stats.hitNotes(touched);

          this.setState({
            notes,
            noteShaking: false,
            heldNotes: {},
            touchedNotes: {}
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
    }), () => this.checkPress())
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

    storeCurrentDrill({mode})

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
        onUpdate: value => {
          if (value < 0.5) {
            this.state.slider.value = 0.5
            this.state.slider.cancel()
          }

          this.setOffset(value)
        },
        onLoop: function() {
          let column = this.state.notes.currentColumn()
          // notes scrolling past at rest aren't misses
          if (column.length && this.state.session) {
            this.state.stats.missNotes(column);
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
    storeCurrentDrill({key: k.name()})
    this.setState({
      keySignature: k,
      notes: null
    })
  }

  setGenerator(generator, settings) {
    storeCurrentDrill({generator: generator.name})

    this.setState({
      currentGenerator: generator,
      currentGeneratorSettings: settings,
    })
  }

  setStaff(staff, callback) {
    if (this.state.currentStaff == staff) {
      return
    }

    storeCurrentDrill({staff: staff.name})

    let update = {
      currentStaff: staff,
      notes: null,
    }

    // if the current generator is not compatible with new staff change it
    if (!this.state.currentGenerator || (this.state.currentGenerator.mode != staff.mode)) {
      update.currentGenerator = currentGeneratorFor(GENERATORS, staff.mode)
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

  // Adds the notes played on the piece section drilled since the last flush
  // to its stats in the local store, then starts counting for the current
  // section. Called when the section, generator or stats change and when the
  // session is recorded, so every note counts once
  flushSectionPractice() {
    let practice = this.takeSectionPractice()
    if (!practice) { return }

    getAppStore().recordSectionPractice(practice)
      .catch(err => console.warn("Couldn't save the section stats", err))
  }

  // The practice on the drilled section since the last flush, if any
  takeSectionPractice() {
    let mark = this.sectionMark
    let stats = this.state.stats

    this.sectionMark = {
      section: this.currentPieceSection(),
      stats,
      hits: stats.hits,
      misses: stats.misses,
    }

    if (!mark || !mark.section) { return null }

    let hits = mark.stats.hits - mark.hits
    let misses = mark.stats.misses - mark.misses
    if (!hits && !misses) { return null }

    let {pieceId, startMeasure, endMeasure} = mark.section
    return {pieceId, startMeasure, endMeasure, hits, misses, at: mark.stats.endedAt}
  }

  // Writes the current session to the local store, replacing what an earlier
  // call wrote for it, together with the section practice in one write that
  // starts right away, as the page may be going away. Nothing is written
  // before a note is played. Returns a promise settling once written, or
  // nothing when there was nothing to write
  recordSession() {
    let sectionPractice = this.takeSectionPractice()

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
      if (sectionPractice) {
        getAppStore().recordSectionPractice(sectionPractice)
          .catch(err => console.warn("Couldn't save the section stats", err))
      }
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

      <ProgrammeDrawer
        open={this.state.settingsOpen}
        close={this.closeSettings}
        apply={this.applySettings}
        staves={STAVES}
        generators={GENERATORS}
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
          storeCurrentDrill({speed: scrollSpeed})
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
      } else {
        let {scale, noteWidth, unitColumns} = this.staffLayout()
        staff = this.state.currentStaff.render.call(this, {
          heldNotes: this.state.heldNotes,
          notes: this.state.notes,
          keySignature: this.state.keySignature,
          noteWidth,
          noteShaking: this.state.noteShaking,
          scale,
          unitColumns,
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
        className={classNames(staffStyles.staff_wrapper, styles.staff_wrapper)}>
        {staff}
      </div>
    </Plate>
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
