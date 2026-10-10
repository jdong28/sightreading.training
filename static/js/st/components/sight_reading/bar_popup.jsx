// The bar pop-up (score-first design §D6): a clicked bar's own stats,
// anchored to it on the score (st/components/score_sheet's renderPopup
// slot). A pure view over st/bar_stats' barPopup model; "Practise bar n"
// and closing are the caller's (st/components/sight_reading/score_view).
// Below the accuracy it says what lies behind it (st/bar_review, handed in as
// review once the bar's rows of the bar log are read): the notes that went
// wrong in words, a timing strip with no note names, and a word on the
// notes marked on the score.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {barPopup, PIP_COUNT} from "st/bar_stats"
import {Pill} from "st/components/salon"

import styles from "./bar_popup.module.css"

export class BarPopup extends React.Component {
  static propTypes = {
    pieceId: types.string.isRequired,
    measure: types.number.isRequired,
    hand: types.string.isRequired,
    items: types.array,
    flags: types.array,
    // st/bar_review's barReview, null until the bar's rows are read
    review: types.object,
    now: types.func,
    style: types.object,
    onClose: types.func.isRequired,
    onPractise: types.func.isRequired,
  }

  static defaultProps = {
    now: Date.now,
  }

  componentDidMount() {
    this.onKeyDown = e => {
      if (e.key == "Escape") { this.props.onClose() }
    }
    window.addEventListener("keydown", this.onKeyDown)
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.onKeyDown)
  }

  renderChart(chart) {
    return <div role="img" aria-label={chart.ariaLabel} className={styles.chart}>
      <div className={styles.chart_area}>
        <span className={styles.target_line} aria-hidden="true" />
        {chart.points.map((point, idx) =>
          <div key={idx} className={styles.column}>
            <span className={classNames(styles.column_value, {[styles.weak]: point.weak})}>
              {point.accuracy}
            </span>
            <span
              className={classNames(styles.column_fill, {[styles.weak]: point.weak})}
              style={{height: `${point.accuracy}px`}} />
          </div>)}
      </div>
      <div className={styles.chart_labels}>
        <span>{chart.first}</span>
        <span>{chart.last}</span>
      </div>
    </div>
  }

  // a cell of the timing strip: its note's label over a track holding the
  // tick where a steady pulse puts the note and the dot where it started
  renderCell(strip, cell) {
    return <div key={cell.index} className={classNames(styles.cell, styles[`cell_${cell.kind}`])}>
      <span className={styles.cell_label}>{cell.label}</span>
      {strip.band && <span
        className={styles.band}
        style={{left: `${strip.band.from}%`, right: `${100 - strip.band.to}%`}} />}
      <span className={styles.tick} />
      {cell.left != null && <span
        data-dot={cell.kind}
        className={classNames(styles.dot, {[styles.dot_first]: cell.kind == "first"})}
        style={{left: `${cell.left}%`}} />}
      {cell.arrow && <span
        className={classNames(styles.arrow, {[styles.arrow_early]: cell.arrow == "«"})}>{cell.arrow}</span>}
    </div>
  }

  renderStrip(strip) {
    let columns = {gridTemplateColumns: `repeat(${strip.cells.length}, minmax(0, 1fr))`}

    return <div className={styles.strip}>
      <div role="img" aria-label={strip.ariaLabel}>
        <div className={styles.cells} style={columns}>
          {strip.cells.map(cell => this.renderCell(strip, cell))}
        </div>
        {strip.words && <div className={styles.words} style={columns}>
          {strip.cells.map(cell => <span
            key={cell.index}
            className={classNames({[styles.words_off]: cell.kind == "off", [styles.words_quiet]: ["first", "skipped", "held"].includes(cell.kind)})}>
            {cell.words}
          </span>)}
        </div>}
      </div>
      <p className={styles.strip_caption}>{strip.caption}</p>
    </div>
  }

  // what lies behind the accuracy, from the bar's last rows of the bar log
  renderBehind(review) {
    if (!review || review.state == "never") { return null }

    if (review.state == "before") {
      return <p className={styles.behind_note} data-behind="before">{review.text}</p>
    }

    if (review.state == "acoustic") {
      return <section className={styles.behind} data-behind="acoustic" aria-label="What you noted">
        <div className={styles.behind_header}>
          <span className={styles.behind_label}>You noted</span>
        </div>
        {review.tags.length > 0 && <div className={styles.chips}>
          {review.tags.map(tag => <span key={tag} className={styles.chip}>{tag}</span>)}
        </div>}
        {review.text && <p className={styles.behind_note}>{review.text}</p>}
      </section>
    }

    return <section className={styles.behind} data-behind="detected" aria-label={`Behind the score of bar ${review.measure}`}>
      <div className={styles.behind_header}>
        <span className={classNames(styles.behind_label, {[styles.behind_oxblood]: review.header.behind})}>
          {review.header.left}
        </span>
        <span className={styles.behind_when}>{review.header.right}</span>
      </div>
      {review.lines.map((line, idx) => <p key={idx} className={idx == 0 ? styles.behind_first : styles.behind_line}>{line}</p>)}
      {review.strip && this.renderStrip(review.strip)}
      {review.pauseLines.map((line, idx) => <p key={`pause${idx}`} className={styles.behind_line}>{line}</p>)}
      {review.giveLine && <p className={styles.behind_line}>{review.giveLine}</p>}
    </section>
  }

  render() {
    let {pieceId, measure, hand, items, flags, style, review} = this.props
    let bar = barPopup({pieceId, measure, hand, items, flags, now: this.props.now()})

    return <div role="dialog" aria-label={`Bar ${measure} stats`} className={styles.popup} style={style}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Bar <span className={styles.heading_italic}>{measure}</span></h2>
        <span className={classNames(styles.tag, {[styles.tag_oxblood]: bar.inPassage})}>{bar.tag}</span>
        <button
          type="button"
          className={styles.close}
          aria-label="Close bar stats"
          onClick={this.props.onClose}>×</button>
      </div>

      {bar.empty && <p className={styles.empty}>No practice recorded for bar {measure} yet.</p>}

      {!bar.empty && bar.noPasses && <p className={styles.empty}>
        No full pass through bar {measure} recorded yet.
      </p>}

      {!bar.empty && !bar.noPasses && <div className={styles.row}>
        <div className={styles.figures}>
          <div className={styles.figure}>
            <span className={styles.figure_label}>Latest</span>
            <span className={classNames(styles.latest, {[styles.weak]: bar.latestWeak})}>{bar.latest}</span>
          </div>
          <div className={styles.figure}>
            <span className={styles.figure_label}>Best</span>
            <span className={styles.best}>{bar.best}</span>
          </div>
          <span className={styles.played}>Played {bar.played} {bar.played == 1 ? "time" : "times"}</span>
        </div>

        {bar.chart && this.renderChart(bar.chart)}
        {bar.selfLine && <p className={styles.self_line}>{bar.selfLine}</p>}

        <div className={styles.streak_row}>
          <div role="img" aria-label={bar.streak.label} className={styles.pips}>
            {Array.from({length: PIP_COUNT}, (_, idx) =>
              <span key={idx} className={classNames(styles.pip, {[styles.filled]: idx < bar.streak.count})} />)}
          </div>
          <span className={styles.streak_text}>{bar.streak.label}</span>
        </div>
      </div>}

      {!bar.empty && this.renderBehind(review)}

      <Pill variant="primary" className={styles.practise} onClick={this.props.onPractise}>
        {`Practise bar ${measure}`}
      </Pill>
    </div>
  }
}

export default BarPopup
