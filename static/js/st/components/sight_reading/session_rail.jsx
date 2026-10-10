// "This session" (score-first design §D9): the score page's rail while a
// session runs, in place of the default rail (SightReadingPage#renderRail).
// Shows the session's progress through the piece, the programme's "Up
// next" (or free practice's next few cards, in order), and "This evening"'s
// last few passes from the page's session log. While a session runs, notes for
// the next lesson (st/lesson_notes) are only quiet marks here: a pill that
// flags the bars on the stand with no typing, and your note and the teacher's
// answer for those bars as two lines, never a pop-up.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill, SectionLabel} from "st/components/salon"
import {romanNumeral, barsLabel} from "st/music"
import {measureNumberList} from "st/song_sections"
import {pieceSong} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {pulledPassage, READ_THROUGH} from "st/srs/planner"
import {TROUBLE_BELOW} from "st/bar_progress"
import {selfWord} from "st/srs/self_grade"
import {GOOD} from "st/srs/grade"
import {newLessonNote, readEvidence, notesOnBars, answersOnBars, noteDate} from "st/lesson_notes"
import {
  sheetMusicPiece, plannedPractice, orderOffered, programmePassages, introductionOrder, itemHand,
} from "st/data"

import styles from "./session_rail.module.css"

// how long the flag's answer stays up, in ms
const STATUS_MS = 4000

const INTRODUCTION_LABELS = {"read through": "Read through", "hardest first": "Hardest first", "in score order": "In score order"}

function formatElapsed(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0))
  let minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

// the next few cards of a deck walked in order, from one after the current,
// wrapping once: {startMeasure, endMeasure}[]
function nextCardsInOrder(generator, count) {
  let cards = generator.cards || []
  let deck = generator.deck
  if (!cards.length || !deck || deck.index == null) { return [] }

  let upcoming = []
  for (let i = 1; i <= cards.length && upcoming.length < count; i++) {
    let idx = (deck.index + i) % cards.length
    if (idx == deck.index) { break }
    let card = cards[idx]
    if (card.columns.length) { upcoming.push({card, number: idx + 1, of: cards.length}) }
  }
  return upcoming
}

export class SessionRail extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    generator: types.object,
    sessionLog: types.array,
    elapsedSeconds: types.number,
    store: types.object,
    // skips the programme's read-through, offered while it is being played
    onSkipReadThrough: types.func,
  }

  static defaultProps = {
    sessionLog: [],
    elapsedSeconds: 0,
  }

  state = {flagStatus: null}

  componentWillUnmount() {
    clearTimeout(this.statusTimer)
    this.unmounted = true
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  // says something about the flag for a few seconds
  say(flagStatus) {
    if (this.unmounted) { return }

    clearTimeout(this.statusTimer)
    this.setState({flagStatus})
    this.statusTimer = setTimeout(() => this.setState({flagStatus: null}), STATUS_MS)
  }

  // Flags the bars on the stand for the lesson with no words, the evidence
  // read from the bar log. The pill is blurred at once, or the space bar
  // (which skips a note) would press it again
  flagForLesson(e) {
    e.currentTarget.blur()

    let {settings, generator} = this.props
    let store = this.getStore()
    let piece = sheetMusicPiece(settings)
    let current = generator && generator.currentCard ? generator.currentCard() : null
    if (!piece || !current || this.flagging) { return }

    let {startMeasure: start, endMeasure: end} = current
    let flagged = store.lessonNotes().some(note => note.status == "open" && note.source == "session" &&
      note.text == "" && note.pieceId == piece.id && note.start == start && note.end == end)
    if (flagged) {
      this.say("Already flagged for your lesson.")
      return
    }

    this.flagging = true
    readEvidence(store, {pieceId: piece.id, hand: itemHand(settings.hand), start, end, song: pieceSong(piece)})
      .then(evidence => store.putLessonNote(newLessonNote({
        source: "session", pieceId: piece.id, pieceTitle: piece.title, start, end,
        hand: itemHand(settings.hand), evidence,
      })))
      .then(() => this.say(`Flagged ${barsLabel(start, end)} for your lesson. Add words later, at rest.`))
      .catch(err => {
        console.warn("Couldn't flag the bars for the lesson", err)
        this.say("Couldn't flag these bars for your lesson.")
      })
      .finally(() => { this.flagging = false })
  }

  // your note and the teacher's answer for the bars on the stand, the newest
  // of each, as the rail's quiet lines
  lessonLines(piece, start, end) {
    if (!piece || start == null) { return [] }

    let all = this.getStore().lessonNotes()
    let [note] = notesOnBars(all, piece.id, start, end)
    let [answer] = answersOnBars(all, piece.id, start, end)

    return [
      ...(note ? [{
        id: note.id, label: `Your note · ${barsLabel(note.start, note.end)}`, text: note.text,
      }] : []),
      ...(answer ? [{
        id: `answer-${answer.id}`, label: `Teacher, ${noteDate(answer.discussedAt)} · ${barsLabel(answer.start, answer.end)}`,
        text: answer.answer, answer: true,
      }] : []),
    ]
  }

  render() {
    let {settings, generator} = this.props
    let store = this.getStore()
    let piece = sheetMusicPiece(settings)
    let song = piece && pieceSong(piece)

    return <aside className={styles.rail}>
      {this.renderThisSession(piece, song, store)}
      {this.renderUpNext(generator, song)}
      {this.renderThisEvening()}
    </aside>
  }

  renderThisSession(piece, song, store) {
    let {settings, generator, elapsedSeconds} = this.props
    let isProgramme = piece && plannedPractice(settings, store)
    let study = isProgramme && generator && generator.study ? generator.study() : null
    let reading = !!generator && !!generator.deck && !!generator.deck.entry &&
      generator.deck.entry.reason == READ_THROUGH
    let aside = study && !study.learned ? "Tonight's study" : isProgramme ?
      (orderOffered(settings, store) ? INTRODUCTION_LABELS[introductionOrder(settings)] : "Today's programme") :
      "Free practice"

    let sessionMinutes = store.practiceSettings().sessionMinutes
    let target = sessionMinutes * 60
    let playingOn = elapsedSeconds >= target

    let measures = song ? measureNumberList(song) : []
    let current = generator && generator.currentCard ? generator.currentCard() : null
    let {startMeasure, endMeasure} = current || {}

    return <Plate className={styles.plate}>
      <div className={styles.header}>
        <h2 className={styles.title}>This <span className={styles.title_italic}>session</span></h2>
        <span className={styles.aside}>{aside}</span>
      </div>

      <div className={styles.clock_group}>
        {isProgramme ? <React.Fragment>
          <div className={styles.clock_row}>
            <span className={styles.clock}>
              {formatElapsed(elapsedSeconds)}{" "}
              <span className={styles.clock_target}>of {sessionMinutes} min</span>
            </span>
            <span className={styles.clock_note}>{playingOn ? "playing on" : "then play on"}</span>
          </div>
          <div className={styles.track}>
            <div className={styles.fill} style={{width: `${Math.min(1, elapsedSeconds / target) * 100}%`}} />
          </div>
          {reading && this.props.onSkipReadThrough && <Pill
            className={styles.skip_pill} onClick={this.props.onSkipReadThrough}>Skip the read-through</Pill>}
        </React.Fragment> : <div className={styles.clock_row}>
          <span className={styles.clock}>{formatElapsed(elapsedSeconds)}</span>
          {startMeasure != null && <span className={styles.clock_note}>
            {startMeasure == endMeasure ? `bar ${startMeasure}` : `bars ${startMeasure}–${endMeasure}`}
          </span>}
        </div>}
      </div>

      {piece && startMeasure != null && this.renderFlag(piece, startMeasure, endMeasure)}

      {measures.length > 0 && this.renderPieceMap(measures, startMeasure, endMeasure)}
    </Plate>
  }

  renderFlag(piece, start, end) {
    let lines = this.lessonLines(piece, start, end)

    return <div className={styles.flag_group}>
      <div className={styles.stand_row}>
        <span className={styles.stand_text}>On the stand: {barsLabel(start, end)}</span>
        <Pill variant="ghost" className={styles.flag_pill} onClick={e => this.flagForLesson(e)}>
          ❧ Flag for lesson
        </Pill>
      </div>
      {this.state.flagStatus && <p className={styles.flag_status} role="status">{this.state.flagStatus}</p>}
      {lines.map(line => <div key={line.id} className={classNames(styles.lesson_line, {[styles.lesson_answer]: line.answer})}>
        <span className={styles.lesson_label}>{line.label}</span>
        <span className={styles.lesson_text}>{line.text}</span>
      </div>)}
    </div>
  }

  renderPieceMap(measures, standStart, standEnd) {
    let {sessionLog} = this.props
    let played = new Set(sessionLog.flatMap(entry => entry.bars.map(bar => bar.measure)))
    let upcoming = new Set() // "coming up" isn't tracked without a plan preview here; left plain

    let first = measures[0]
    let last = measures[measures.length - 1]
    let flag = pulledPassage(programmePassages(this.props.settings, this.getStore()))
    let ticks = new Set([first, last, ...(flag ? [flag.start, flag.end] : [])])

    return <div className={styles.map_group}>
      <div className={styles.sub_label}>Where you are in the piece</div>
      <div className={styles.grid} style={{gridTemplateColumns: `repeat(${measures.length}, minmax(0,1fr))`}}>
        {measures.map(measure => {
          let onStand = standStart != null && measure >= standStart && measure <= standEnd
          return <span
            key={measure}
            title={`Bar ${measure}`}
            className={classNames(styles.cell, {
              [styles.played]: played.has(measure) && !onStand,
              [styles.on_stand]: onStand,
              [styles.coming_up]: upcoming.has(measure) && !onStand,
            })} />
        })}
      </div>
      <div className={styles.ticks}>
        {measures.filter(m => ticks.has(m)).map(m => <span key={m}>{m}</span>)}
      </div>
      <div className={styles.legend}>
        <span><span className={classNames(styles.swatch, styles.played)} />Played</span>
        <span><span className={classNames(styles.swatch, styles.on_stand)} />On the stand</span>
        <span><span className={classNames(styles.swatch, styles.coming_up)} />Coming up</span>
      </div>
    </div>
  }

  renderUpNext(generator, song) {
    if (!generator) { return null }

    let store = this.getStore()
    let isProgramme = plannedPractice(this.props.settings, store)
    let rows = []

    if (isProgramme && generator.upNext) {
      rows = generator.upNext(3).map(({measure, words, bars}) => ({
        left: bars && bars[0] != bars[1] ? `Bars ${bars[0]}–${bars[1]}` : `Bar ${measure}`,
        right: words, strong: words.includes("passage"),
      }))
    } else if (!isProgramme && (this.props.settings.order || "in order") != "random" &&
        generator.cards && generator.cards.length > 1) {
      rows = nextCardsInOrder(generator, 3).map(({card, number, of}) => ({
        left: card.startMeasure == card.endMeasure ? `Bar ${card.startMeasure}` :
          `Bars ${card.startMeasure}–${card.endMeasure}`,
        right: `Card ${number} of ${of}`,
      }))
    }

    if (!rows.length) { return null }

    return <Plate className={styles.plate} compact>
      <div className={styles.sub_label}>Up next</div>
      <ul className={styles.up_next_list}>
        {rows.map((row, idx) =>
          <li key={idx} className={classNames(styles.up_next_row, {[styles.strong]: row.strong})}>
            <span className={styles.up_next_bar}>{row.left}</span>
            <span className={styles.up_next_words}>{row.right}</span>
          </li>)}
      </ul>
    </Plate>
  }

  renderThisEvening() {
    let rows = this.props.sessionLog.slice(-5).map(entry => {
      let bars = entry.startMeasure == entry.endMeasure ?
        `Bar ${entry.startMeasure}` : `Bars ${entry.startMeasure}–${entry.endMeasure}`
      let left = entry.readThrough ? `${bars}, read through` : bars

      let right, weak
      if (entry.self) {
        right = selfWord(entry.grade)
        weak = entry.grade < GOOD
      } else {
        let total = entry.bars.reduce((sum, bar) => sum + (bar.columns || 0), 0)
        let clean = entry.bars.reduce((sum, bar) => sum + (bar.clean || 0), 0)
        let accuracy = total ? Math.round(100 * clean / total) : null
        right = accuracy == null ? "—" : `${accuracy}%`
        weak = accuracy != null && accuracy < TROUBLE_BELOW
      }

      return {left, right, weak}
    })

    return <div className={styles.evening}>
      <SectionLabel ornament="❧">This evening</SectionLabel>
      {rows.length ? <ol className={styles.evening_list}>
        {rows.map((row, idx) =>
          <li key={idx} className={styles.evening_row}>
            <span className={styles.numeral}>{romanNumeral(idx + 1)}</span>
            <span className={styles.evening_text}>{row.left}</span>
            <span className={classNames(styles.evening_detail, {[styles.weak]: row.weak})}>{row.right}</span>
          </li>)}
      </ol> : <p className={styles.evening_empty}>Nothing played yet</p>}
    </div>
  }
}

export default SessionRail
