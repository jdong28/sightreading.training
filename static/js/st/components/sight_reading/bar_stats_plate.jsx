// A clicked bar's own playing stats (st/bar_stats), at the head of the
// score page's rail, at rest: how often and when the bar was played, its
// last few grades, note accuracy, and the "From your playing" trouble-spot
// sentence, one row per hand. Read-only, from both instrument settings'
// records alike. See ScoreRail in st/components/pages/score_page.

import * as React from "react"
import * as types from "prop-types"

import {Plate} from "st/components/salon"
import {barsHeading} from "st/music"
import {sheetMusicPiece} from "st/data"
import {pieceSong} from "st/sheet_music_deck"
import {measureNumberList} from "st/song_sections"
import {getAppStore} from "st/storage"
import {barStats} from "st/bar_stats"

import styles from "./bar_stats_plate.module.css"

export class BarStatsPlate extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    // the printed bar number clicked, or null for none
    measure: types.number,
    close: types.func.isRequired,
    store: types.object,
    now: types.func,
  }

  static defaultProps = {
    now: Date.now,
  }

  constructor(props) {
    super(props)
    this.ref = React.createRef()
  }

  componentDidMount() {
    this.scrollIntoView()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.measure != this.props.measure && this.props.measure != null) {
      this.scrollIntoView()
    }
  }

  scrollIntoView() {
    if (this.ref.current) {
      this.ref.current.scrollIntoView({block: "nearest", behavior: "smooth"})
    }
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  renderHand(hand) {
    let playedWord = hand.played == 1 ? "time" : "times"
    let played = `Played ${hand.played} ${playedWord}` +
      (hand.lastPlayed ? ` · last played ${hand.lastPlayed}` : "")

    return <div key={hand.hand} className={styles.hand_block}>
      <h3 className={styles.hand_heading}>{hand.heading}</h3>
      <p className={styles.stat_line}>{played}</p>
      {hand.recent.length > 0 &&
        <p className={styles.stat_line}>{`Recent: ${hand.recent.join(" → ")}`}</p>}
      {hand.accuracy != null &&
        <p className={styles.stat_line}>{`Accuracy ${hand.accuracy}%`}</p>}
    </div>
  }

  render() {
    let {measure} = this.props
    if (measure == null) { return null }

    let piece = sheetMusicPiece(this.props.settings)
    let song = piece && pieceSong(piece)
    if (!piece || !song) { return null }

    let stats = barStats({
      pieceId: piece.id,
      measure,
      items: this.getStore().items(piece.id),
      measures: measureNumberList(song),
      now: this.props.now(),
    })

    return <div data-bar-stats ref={this.ref}>
      <Plate
        className={styles.bar_stats_plate}
        compact
        header={barsHeading(measure, measure)}
        headerAside={<button
          type="button"
          className={styles.close_button}
          aria-label="Close the bar's stats"
          onClick={this.props.close}>×</button>}>
        {stats.hands.map(hand => this.renderHand(hand))}
        {stats.trouble &&
          <p className={styles.trouble_text}>{`From your playing: ${stats.trouble}`}</p>}
        {!stats.hands.length && !stats.trouble &&
          <p className={styles.empty_text}>{`No practice recorded for bar ${measure} yet.`}</p>}
      </Plate>
    </div>
  }
}

export default BarStatsPlate
