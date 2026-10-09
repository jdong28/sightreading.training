// The bar pop-up (score-first design §D6): a clicked bar's own stats,
// anchored to it on the score (st/components/score_sheet's renderPopup
// slot). A pure view over st/bar_stats' barPopup model; "Practise bar n"
// and closing are the caller's (st/components/sight_reading/score_view).

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

  render() {
    let {pieceId, measure, hand, items, flags, style} = this.props
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

      <Pill variant="primary" className={styles.practise} onClick={this.props.onPractise}>
        {`Practise bar ${measure}`}
      </Pill>
    </div>
  }
}

export default BarPopup
