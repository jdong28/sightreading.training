// The score-first sheet music page's in-session rail (D9): "This session"
// (the clock, the piece-position grid, Up next) and "This evening" (this
// sitting's own passes, not past calendar sessions). Rendered by
// SightReadingPage in place of its own rail while state.view == "session"
// (see SCORE_PROGRAMME.SessionRail).

import * as React from "react"
import * as types from "prop-types"

import {Plate, SectionLabel} from "st/components/salon"
import {getAppStore} from "st/storage"
import {barsLabel, barsHeading, romanNumeral} from "st/music"
import {measureNumberList} from "st/song_sections"
import {flagsInForce} from "st/difficulty/records"
import {pieceSong} from "st/sheet_music_deck"
import {sheetMusicPiece, PROGRAMME_PRACTICE, introductionOrder, orderOffered} from "st/data"
import {upNextWords, READ_FIRST, HARDEST_FIRST, SCORE_ORDER} from "st/srs/planner"
import {SELF_GRADES} from "st/srs/self_grade"
import {TROUBLE_BELOW} from "st/bar_progress"

import styles from "./session_rail.module.css"

const ORDER_LABELS = {
  [READ_FIRST]: "Read through",
  [HARDEST_FIRST]: "Hardest first",
  [SCORE_ORDER]: "In score order",
}

// seconds -> "m:ss", duplicated from sight_reading_page.jsx's formatElapsed
// to keep this component free of a dependency on the trainer's own page
function formatElapsed(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0))
  let minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

// the accuracy of one session log entry over all its bars (§C1), null when
// it has no detected bar (an all-self-graded entry)
function entryAccuracy(entry) {
  let detected = entry.bars.filter(bar => bar.columns != null)
  if (!detected.length) { return null }

  let columns = detected.reduce((sum, bar) => sum + bar.columns, 0)
  let clean = detected.reduce((sum, bar) => sum + bar.clean, 0)
  return columns > 0 ? Math.round(100 * clean / columns) : null
}

export class SessionRail extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    liveGenerator: types.object,
    sessionLog: types.array,
    elapsedSeconds: types.number,
    acoustic: types.bool,
    store: types.object,
  }

  static defaultProps = {
    sessionLog: [],
    elapsedSeconds: 0,
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  piece() {
    return sheetMusicPiece(this.props.settings)
  }

  song() {
    let piece = this.piece()
    return piece && pieceSong(piece)
  }

  // the Up next rows (D9): the programme's own planUpcoming preview, or
  // free practice's next cards in order; none in random order or a single
  // whole-section card
  upNextRows() {
    let {settings, liveGenerator} = this.props
    if (!liveGenerator) { return [] }

    if (settings.practice == PROGRAMME_PRACTICE) {
      return (liveGenerator.upNext ? liveGenerator.upNext(3) : []).map(entry => ({
        key: entry.itemId,
        left: barsHeading(entry.measure, entry.measure),
        right: upNextWords(entry, entry.passage),
        measures: [entry.measure],
        flagged: !!entry.passage,
      }))
    }

    let entries = liveGenerator.upNext ? liveGenerator.upNext(3) : []
    if (!entries.length) { return [] }

    let total = liveGenerator.deck ? liveGenerator.deck.cards.length : entries.length
    return entries.map(entry => ({
      key: entry.number,
      left: barsHeading(entry.measures[0], entry.measures[entry.measures.length - 1]),
      right: `Card ${entry.number} of ${total}`,
      measures: entry.measures,
      flagged: false,
    }))
  }

  // the bars a pass in the log touched, for the piece-position grid's
  // Played cells
  playedMeasures() {
    let played = new Set()
    for (let entry of this.props.sessionLog) {
      for (let bar of entry.bars) { played.add(bar.measure) }
    }
    return played
  }

  renderClockRow() {
    let {settings, elapsedSeconds} = this.props
    let elapsed = formatElapsed(elapsedSeconds)

    if (settings.practice != PROGRAMME_PRACTICE) {
      return <div className={styles.clock_group}>
        <div className={styles.clock_row}>
          <span className={styles.clock_time}>{elapsed}</span>
          <span className={styles.clock_aside}>{barsLabel(settings.startMeasure, settings.endMeasure)}</span>
        </div>
      </div>
    }

    let targetMinutes = this.getStore().practiceSettings().sessionMinutes
    let targetSeconds = targetMinutes * 60
    let playingOn = elapsedSeconds >= targetSeconds
    let fill = targetSeconds > 0 ? Math.min(1, elapsedSeconds / targetSeconds) : 0

    return <div className={styles.clock_group}>
      <div className={styles.clock_row}>
        <span>
          <span className={styles.clock_time}>{elapsed}</span>
          <span className={styles.clock_target}>of {targetMinutes} min</span>
        </span>
        <span className={styles.clock_aside}>{playingOn ? "playing on" : "then play on"}</span>
      </div>
      <div className={styles.track}>
        <div className={styles.track_fill} style={{width: `${fill * 100}%`}} />
      </div>
    </div>
  }

  renderPositionGrid(upNext) {
    let song = this.song()
    if (!song) { return null }

    let numbers = measureNumberList(song)
    if (!numbers.length) { return null }

    let current = this.props.liveGenerator && this.props.liveGenerator.currentCard &&
      this.props.liveGenerator.currentCard()
    let onStand = new Set(current ? current.measures : [])
    let comingUp = new Set(upNext.flatMap(row => row.measures))
    let played = this.playedMeasures()

    let annotation = this.piece() && this.getStore().annotation(this.piece().id)
    let hardest = annotation ? flagsInForce(annotation)[0] : null
    let ticks = [numbers[0]]
    if (hardest) { ticks.push(hardest.start, hardest.end) }
    ticks.push(numbers[numbers.length - 1])

    return <div className={styles.position_group}>
      <div className={styles.group_label}>Where you are in the piece</div>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${numbers.length}, minmax(0, 1fr))`,
          gap: numbers.length > 32 ? "1px" : "3px",
        }}>
        {numbers.map(number => {
          let cell = onStand.has(number) ? styles.cell_stand :
            comingUp.has(number) ? styles.cell_coming :
            played.has(number) ? styles.cell_played : styles.cell_rest
          return <span key={number} title={`Bar ${number}`} className={[styles.cell, cell].join(" ")} />
        })}
      </div>
      <div className={styles.ticks}>
        {ticks.map((number, idx) => <span key={idx}>{number}</span>)}
      </div>
      <div className={styles.legend}>
        <span className={styles.legend_item}><span className={styles.legend_swatch_played} />Played</span>
        <span className={styles.legend_item}><span className={styles.legend_swatch_stand} />On the stand</span>
        <span className={styles.legend_item}><span className={styles.legend_swatch_coming} />Coming up</span>
      </div>
    </div>
  }

  renderUpNext(rows) {
    if (!rows.length) { return null }

    return <div className={styles.up_next_group}>
      <div className={styles.group_label}>Up next</div>
      {rows.map(row => <div key={row.key} className={styles.up_next_row}>
        <span className={styles.up_next_left}>{row.left}</span>
        <span className={row.flagged ? styles.up_next_right_flagged : styles.up_next_right}>{row.right}</span>
      </div>)}
    </div>
  }

  renderThisSession() {
    let {settings} = this.props
    let aside = settings.practice == PROGRAMME_PRACTICE ?
      (orderOffered(settings, this.getStore()) ? ORDER_LABELS[introductionOrder(settings)] : "Today's programme") :
      "Free practice"

    let upNext = this.upNextRows()

    return <Plate className={styles.plate}>
      <div className={styles.header}>
        <h2 className={styles.title}>This <em>session</em></h2>
        <span className={styles.aside}>{aside}</span>
      </div>
      {this.renderClockRow()}
      {this.renderPositionGrid(upNext)}
      {this.renderUpNext(upNext)}
    </Plate>
  }

  renderThisEvening() {
    let {sessionLog} = this.props
    if (!sessionLog.length) { return null }

    let shown = sessionLog.slice(-5)
    let start = sessionLog.length - shown.length

    return <div className={styles.evening_plate}>
      <SectionLabel ornament="❧">This evening</SectionLabel>
      {shown.map((entry, idx) => {
        let left = barsHeading(entry.startMeasure, entry.endMeasure) + (entry.readThrough ? ", read through" : "")

        let right, weak
        if (entry.self) {
          let selfGrade = SELF_GRADES.find(g => g.grade == entry.grade)
          right = selfGrade ? selfGrade.word : null
          weak = entry.grade <= 2
        } else {
          let pct = entryAccuracy(entry)
          right = pct != null ? `${pct}%` : null
          weak = pct != null && pct < TROUBLE_BELOW
        }

        return <div key={start + idx} className={styles.evening_row}>
          <span className={styles.numeral}>{romanNumeral(start + idx + 1)}</span>
          <span className={styles.evening_text}>{left}</span>
          <span className={weak ? styles.evening_detail_weak : styles.evening_detail}>{right}</span>
        </div>
      })}
    </div>
  }

  render() {
    return <div data-session-rail className={styles.session_rail}>
      {this.renderThisSession()}
      {this.renderThisEvening()}
    </div>
  }
}

export default SessionRail
