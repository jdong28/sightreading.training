// A clicked bar's own practice stats (st/bar_stats), at the head of the
// trainer's right rail, at rest: on an imported piece's score card, the
// bar the player clicked (st/components/score_card's onBar, read by
// SightReadingPage#selectBar). Shows how often it has been played and
// when, its last few grades, note accuracy, and the "From your playing"
// trouble sentence, one row per hand, for both MIDI keyboard and acoustic
// piano practice. Read-only: this plate never writes anything.

import * as React from "react"
import * as types from "prop-types"

import {Plate} from "st/components/salon"
import {barsLabel, barsHeading} from "st/music"
import {measureNumberList} from "st/song_sections"
import {sheetMusicPiece} from "st/data"
import {pieceSong} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {barStats} from "st/bar_stats"

import styles from "./bar_stats_plate.module.css"

export class BarStatsPlate extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    // the clicked bar's printed number, or null for none
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
    let played = `Played ${hand.played} ${hand.played == 1 ? "time" : "times"}` +
      (hand.lastPlayed ? ` · last played ${hand.lastPlayed}` : "")

    return <div key={hand.hand} className={styles.hand}>
      <h4 className={styles.hand_heading}>{hand.heading}</h4>
      <p>{played}</p>
      {hand.recent.length > 0 && <p>{`Recent: ${hand.recent.join(" → ")}`}</p>}
      {hand.accuracy != null && <p>{`Accuracy ${hand.accuracy}%`}</p>}
    </div>
  }

  render() {
    let {measure} = this.props
    if (measure == null) { return null }

    let piece = sheetMusicPiece(this.props.settings)
    let song = piece && pieceSong(piece)
    if (!piece || !song) { return null }

    let items = this.getStore().items(piece.id)
    let stats = barStats({
      pieceId: piece.id, measure, items, measures: measureNumberList(song), now: this.props.now(),
    })

    return <div data-bar-stats ref={this.ref}>
      <Plate
        compact
        className={styles.plate}
        header={barsHeading(measure, measure)}
        headerAside={<button
          type="button"
          className={styles.close}
          aria-label="Close the bar's stats"
          onClick={this.props.close}>
          ×
        </button>}>
        {stats.hands.map(hand => this.renderHand(hand))}
        {stats.trouble && <p className={styles.trouble}>{`From your playing: ${stats.trouble}`}</p>}
        {!stats.hands.length && !stats.trouble &&
          <p className={styles.empty}>{`No practice recorded for ${barsLabel(measure, measure)} yet.`}</p>}
      </Plate>
    </div>
  }
}

export default BarStatsPlate
