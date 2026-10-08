// The score-first page's rail in session (plan §D9): "This session" (the
// clock against the target, where the player stands in the piece, and
// "Up next") and "This evening" (this session's own passes, last 5, in
// place of the exercises page's list of today's sessions).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, SectionLabel} from "st/components/salon"
import {formatElapsed} from "st/components/pages/sight_reading_page"
import {romanNumeral} from "st/music"

import styles from "./session_rail.module.css"

// a session log entry's accuracy over its bars (§C1), or its self grade word
function passSummary(entry) {
  if (entry.self) {
    let words = ["", "Fell apart", "Stumbled", "Clean", "Easy"]
    return {text: words[entry.grade] || "", oxblood: entry.grade <= 2}
  }

  let columns = entry.bars.reduce((sum, b) => sum + (b.columns || 0), 0)
  let clean = entry.bars.reduce((sum, b) => sum + (b.clean || 0), 0)
  let accuracy = columns ? Math.round(100 * clean / columns) : 100
  return {text: `${accuracy}%`, oxblood: accuracy < 80}
}

function barsLabelOf(entry) {
  let {startMeasure, endMeasure, readThrough} = entry
  let bars = startMeasure == endMeasure ? `Bar ${startMeasure}` : `Bars ${startMeasure}–${endMeasure}`
  return readThrough ? `${bars}, read through` : bars
}

export class SessionRail extends React.Component {
  static propTypes = {
    elapsedSeconds: types.number.isRequired,
    sessionMinutes: types.number,
    measures: types.array.isRequired,
    sessionLog: types.array.isRequired,
    standMeasures: types.array,
    upNext: types.array,
    asideLabel: types.string,
    hardestFlag: types.object,
  }

  renderClock() {
    let {elapsedSeconds, sessionMinutes} = this.props
    let target = sessionMinutes || 0
    let fraction = target ? Math.min(1, elapsedSeconds / (target * 60)) : 0
    let playingOn = target > 0 && elapsedSeconds >= target * 60

    return <div className={styles.clock_block}>
      <div className={styles.clock_row}>
        <span className={styles.clock_value}>{formatElapsed(elapsedSeconds)}</span>
        {target ? <span className={styles.clock_target}>of {target} min</span> : null}
        <span className={styles.clock_aside}>{playingOn ? "playing on" : "then play on"}</span>
      </div>
      {target ? <div className={styles.track}>
        <div className={styles.fill} style={{width: `${Math.round(fraction * 100)}%`}} />
      </div> : null}
    </div>
  }

  renderGrid() {
    let {measures, sessionLog, standMeasures, upNext, hardestFlag} = this.props
    if (!measures.length) { return null }

    let played = new Set()
    for (let entry of sessionLog) {
      for (let bar of entry.bars) { played.add(bar.measure) }
    }
    let onStand = new Set(standMeasures || [])
    let comingUp = new Set((upNext || []).map(row => row.measure).filter(n => n != null))

    let tickMeasures = new Set([measures[0], measures[measures.length - 1]])
    if (hardestFlag) {
      tickMeasures.add(hardestFlag.start)
      tickMeasures.add(hardestFlag.end)
    }

    return <div className={styles.grid_block}>
      <div className={styles.sub_label}>Where you are in the piece</div>
      <div className={styles.grid} style={{gridTemplateColumns: `repeat(${measures.length}, minmax(0, 1fr))`}}>
        {measures.map(number => <div
          key={number}
          className={classNames(styles.cell, {
            [styles.played]: played.has(number),
            [styles.on_stand]: onStand.has(number),
            [styles.coming_up]: !onStand.has(number) && comingUp.has(number),
          })} />)}
      </div>
      <div className={styles.ticks}>
        {measures.filter(n => tickMeasures.has(n)).map(n => <span key={n}>{n}</span>)}
      </div>
      <div className={styles.grid_legend}>
        <span><i className={styles.swatch_played} />Played</span>
        <span><i className={styles.swatch_stand} />On the stand</span>
        <span><i className={styles.swatch_coming} />Coming up</span>
      </div>
    </div>
  }

  renderUpNext() {
    let {upNext} = this.props
    if (!upNext || !upNext.length) { return null }

    return <div className={styles.up_next}>
      <div className={styles.sub_label}>Up next</div>
      {upNext.slice(0, 3).map((row, idx) => <div key={idx} className={styles.up_next_row}>
        <span className={styles.up_next_label}>{row.label}</span>
        <span className={styles.up_next_detail}>{row.detail}</span>
      </div>)}
    </div>
  }

  renderEvening() {
    let rows = this.props.sessionLog.slice(-5)

    return <Plate className={styles.evening_plate}>
      <SectionLabel ornament="❧">This evening</SectionLabel>
      {rows.length ? <ol className={styles.evening_list}>
        {rows.map((entry, idx) => {
          let summary = passSummary(entry)
          return <li key={idx} className={styles.evening_row}>
            <span className={styles.numeral}>{romanNumeral(idx + 1)}</span>
            <span className={styles.evening_text}>{barsLabelOf(entry)}</span>
            <span className={classNames(styles.evening_detail, {[styles.oxblood]: summary.oxblood})}>
              {summary.text}
            </span>
          </li>
        })}
      </ol> : <p className={styles.evening_empty}>Nothing played yet</p>}
    </Plate>
  }

  render() {
    return <aside className={styles.session_rail}>
      <Plate className={styles.session_plate}>
        <div className={styles.header_row}>
          <div className={styles.header_title}>This <span className={styles.italic}>session</span></div>
          <div className={styles.header_aside}>{this.props.asideLabel}</div>
        </div>
        {this.renderClock()}
        {this.renderGrid()}
        {this.renderUpNext()}
      </Plate>
      {this.renderEvening()}
    </aside>
  }
}

export default SessionRail
