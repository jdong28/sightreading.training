// The score-first page's bar pop-up (plan §D6): a clicked bar's stats,
// anchored to it on the score. Pure presentation over barPopup's model
// (st/bar_stats); the score view positions it (anchor) and supplies the
// model, built fresh from the cached items each time a bar is clicked.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import styles from "./bar_popup.module.css"

// the pop-up's own width, in step with bar_popup.module.css (border-box, so
// its padding is inside it): the score view anchors it to a bar only in a
// page box wide enough to hold it there (st/components/sight_reading/
// score_view)
export const POPUP_WIDTH = 300

function Chart({chart}) {
  if (!chart) { return null }

  return <div className={styles.chart_block}>
    <div
      className={styles.chart}
      role="img"
      aria-label={chart.ariaLabel}>
      <div className={styles.chart_target} aria-hidden="true" />
      {chart.values.map((v, idx) => <div key={idx} className={styles.chart_col} aria-hidden="true">
        <span className={styles.chart_value}>{v.value}%</span>
        <div
          className={classNames(styles.chart_bar, {[styles.trouble]: v.trouble})}
          style={{height: `${v.value}%`}} />
      </div>)}
    </div>
    <div className={styles.chart_labels} aria-hidden="true">
      <span>{chart.firstLabel}</span>
      <span>{chart.lastLabel}</span>
    </div>
  </div>
}

function Streak({streak}) {
  return <div className={styles.streak_row}>
    <div className={styles.pips} aria-hidden="true">
      {[0, 1, 2].map(i => <span
        key={i}
        className={classNames(styles.pip, {[styles.filled]: i < streak.filled})} />)}
    </div>
    <span className={styles.streak_label} aria-label={streak.ariaLabel}>{streak.label}</span>
  </div>
}

export class BarPopup extends React.Component {
  static propTypes = {
    model: types.object.isRequired,
    style: types.object,
    onClose: types.func.isRequired,
    onPractise: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.onKeyDown = e => {
      if (e.key == "Escape") { this.props.onClose() }
    }
  }

  componentDidMount() {
    document.addEventListener("keydown", this.onKeyDown)
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this.onKeyDown)
  }

  renderFigures() {
    let {model} = this.props
    let {figures, played} = model

    let latest = figures.latest.value != null ? `${figures.latest.value}%` : figures.latest.word
    let best = figures.best.value != null ? `${figures.best.value}%` : figures.best.word

    return <div className={styles.figures_row}>
      <div className={styles.figure_block}>
        <div className={styles.figure_label}>Latest</div>
        <div className={classNames(styles.figure_value, {[styles.oxblood]: figures.latest.trouble})}>{latest}</div>
      </div>
      <div className={styles.figure_block}>
        <div className={styles.figure_label}>Best</div>
        <div className={classNames(styles.figure_value_small, {[styles.oxblood]: figures.best.trouble})}>{best}</div>
      </div>
      <div className={styles.played_text}>Played {played} time{played == 1 ? "" : "s"}</div>
    </div>
  }

  render() {
    let {model} = this.props

    return <div
      role="dialog"
      aria-label={`Bar ${model.measure} stats`}
      className={styles.bar_popup}
      style={this.props.style}>
      <div className={styles.header_row}>
        <div className={styles.header_title}>
          Bar <span className={styles.header_measure}>{model.measure}</span>
        </div>
        <div className={classNames(styles.header_tag, {[styles.flag]: model.tag.variant == "flag"})}>
          {model.tag.text}
        </div>
        <button type="button" className={styles.close_button} aria-label="Close bar stats" onClick={this.props.onClose}>
          ×
        </button>
      </div>

      {model.state == "empty" || model.state == "no-passes" ? <p className={styles.empty_text}>{model.notice}</p> : null}

      {model.state == "played" ? <>
        {model.figures ? this.renderFigures() : null}
        <Chart chart={model.chart} />
        {model.selfLine ? <p className={styles.self_line}>{model.selfLine}</p> : null}
        <Streak streak={model.streak} />
      </> : null}

      {model.state == "no-passes" ? <Streak streak={model.streak} /> : null}

      <button type="button" className={styles.practise_button} onClick={this.props.onPractise}>
        {`Practise bar ${model.measure}`}
      </button>
    </div>
  }
}

export default BarPopup
