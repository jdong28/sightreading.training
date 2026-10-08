// The score-first sheet music page's bar pop-up (D6): a clicked bar's
// stats, anchored to it on the score. Pure presentation over barPopup()'s
// model (st/bar_stats); closing or picking another bar is the parent's job
// (score_view.jsx), which also supplies the anchor (computed from the
// clicked bar's own overlay box).

import * as React from "react"
import * as types from "prop-types"

import {barPopup} from "st/bar_stats"

import styles from "./bar_popup.module.css"

export class BarPopup extends React.Component {
  static propTypes = {
    pieceId: types.string.isRequired,
    measure: types.number.isRequired,
    hand: types.string.isRequired,
    items: types.array,
    flags: types.array,
    now: types.number,
    // {left, right, top, bottom}, each a CSS percent string or undefined;
    // left/right and top/bottom are mutually exclusive, see D6's anchoring
    anchor: types.object,
    onClose: types.func.isRequired,
    onPractise: types.func.isRequired,
  }

  render() {
    let {measure, hand, items = [], flags = [], now = Date.now()} = this.props
    let model = barPopup({pieceId: this.props.pieceId, measure, hand, items, flags, now})

    return <div
      role="dialog"
      aria-label={`Bar ${measure} stats`}
      className={styles.popup}
      style={this.props.anchor}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Bar <em>{measure}</em></h3>
        <span className={styles.tag} data-variant={model.tag.variant}>{model.tag.text}</span>
        <button
          type="button"
          aria-label="Close bar stats"
          className={styles.close_button}
          onClick={this.props.onClose}>×</button>
      </div>

      {model.empty ?
        <p className={styles.empty_text}>No practice recorded for bar {measure} yet.</p> :
        <>
          {model.noFullPass ?
            <p className={styles.empty_text}>No full pass through bar {measure} recorded yet.</p> :
            <>
              <div className={styles.figures}>
                <div className={styles.latest}>
                  <div className={styles.figure_label}>Latest</div>
                  <div className={styles.latest_value} data-oxblood={!!model.latest.oxblood}>{model.latest.text}</div>
                </div>
                {model.best ? <div className={styles.best}>
                  <div className={styles.figure_label}>Best</div>
                  <div className={styles.best_value}>{model.best.text}</div>
                </div> : null}
                <div className={styles.played}>Played {model.played} {model.played == 1 ? "time" : "times"}</div>
              </div>

              {model.chart ? <div
                role="img"
                aria-label={model.chart.ariaLabel}
                className={styles.chart}>
                {model.chart.points.map((point, idx) => <div
                  key={idx}
                  className={styles.chart_column}
                  style={{height: `${point.pct}%`}}
                  data-oxblood={point.pct < 80}>
                  <span className={styles.chart_value}>{point.pct}</span>
                </div>)}
                <div className={styles.chart_days}>
                  <span>{model.chart.firstDay}</span>
                  <span>{model.chart.lastDay}</span>
                </div>
              </div> : null}

              {model.selfWords ? <p className={styles.self_words}>{model.selfWords}</p> : null}
            </>}

          <div className={styles.streak}>
            <div className={styles.pips}>
              {[0, 1, 2].map(i => <span key={i} className={styles.pip} data-filled={i < model.streak.filled} />)}
            </div>
            <span aria-label={model.streak.ariaLabel}>{model.streak.label}</span>
          </div>
        </>}

      <button
        type="button"
        className={styles.practise_button}
        onClick={() => this.props.onPractise(measure)}>Practise bar {measure}</button>
    </div>
  }
}

export default BarPopup
