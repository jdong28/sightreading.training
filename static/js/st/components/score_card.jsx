// The trainer's card drawn by an engraving engine (st/score_render) from the
// piece's source MusicXML, in place of the app's own staff. The engine draws
// the card's measures once; the columns the trainer detects are joined to the
// drawn heads (card_join), and from then on the drill only moves classes on
// those heads: the column at the head of the drill, the ones done and the ones
// missed. The engines bundle is loaded on demand, never with the app

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {loadScoreEngines} from "st/score_render/load"
import {joinCard, markCard} from "st/score_render/card_join"

import styles from "./score_card.module.css"

// an engine draws one card at a time (OSMD keeps one score loaded), so the
// cards of every ScoreCard are drawn one after another
let drawing = Promise.resolve()

export class ScoreCard extends React.Component {
  static propTypes = {
    musicXML: types.string.isRequired,
    // the card's printed bar numbers, inclusive
    fromMeasure: types.number.isRequired,
    toMeasure: types.number.isRequired,
    hand: types.oneOf(["both", "upper", "lower"]).isRequired,
    width: types.number.isRequired,
    // the song model's measure starts, the clock the columns are timed on
    measureStarts: types.array,
    // the card's columns, as extractSectionColumns gives them
    columns: types.array.isRequired,
    // the index of the column at the head of the drill, null for none
    head: types.number,
    // the indices of the columns a miss was counted on
    missed: types.array,
    engine: types.string,
    loadEngines: types.func,
    // called with the error when the engine can't draw the card
    onError: types.func,
    // called with {join, result} once a card is drawn
    onDrawn: types.func,
  }

  static defaultProps = {
    engine: "osmd",
    loadEngines: loadScoreEngines,
    missed: [],
  }

  constructor(props) {
    super(props)
    this.plateRef = React.createRef()
    this.state = {drawing: true}
    this.drawCount = 0
  }

  componentDidMount() {
    this.draw()
  }

  componentDidUpdate(prevProps) {
    let p = this.props
    let redraw = ["musicXML", "fromMeasure", "toMeasure", "hand", "width", "measureStarts", "engine"]
      .some(name => prevProps[name] != p[name])

    if (redraw) {
      this.draw()
    } else if (prevProps.columns != p.columns) {
      this.join()
    } else if (prevProps.head != p.head || prevProps.missed != p.missed) {
      this.mark()
    }
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  draw() {
    let count = ++this.drawCount
    // the drawn card stays up until the next is drawn, but no longer follows
    // the drill, whose columns are the next card's
    this.result = null
    this.cardJoin = null
    this.setState({drawing: true})

    let stale = () => count != this.drawCount || this.unmounted
    drawing = drawing
      .then(() => stale() ? null : this.drawNow(stale))
      .catch(error => stale() ? null : this.fail(error))
    return drawing
  }

  fail(error) {
    console.warn("The engine couldn't draw the card", error)
    if (this.props.onError) { this.props.onError(error) }
  }

  async drawNow(stale) {
    let {musicXML, fromMeasure, toMeasure, hand, width, measureStarts, engine} = this.props

    let bundle = await this.props.loadEngines()
    let result = await bundle.ENGINES[engine].renderCard({
      musicXML, fromMeasure, toMeasure, hand, width, measureStarts,
    })

    // a later draw or an unmount has overtaken this one
    if (stale()) { return }

    this.result = result
    let plate = this.plateRef.current
    plate.replaceChildren(result.svg)
    this.setState({drawing: false})
    this.join()
  }

  join() {
    if (!this.result) { return }
    let {columns} = this.props
    let cardJoin = joinCard(columns, this.result.notes)
    // a card whose notes the engine drew none of (eg. the hand's notes are
    // on a staff the engine's hand doesn't keep) can't be played from it
    if (columns.some(column => column.length) && cardJoin.heads.every(heads => !heads.length)) {
      this.result = null
      this.fail(new Error("None of the card's notes were drawn"))
      return
    }

    this.cardJoin = cardJoin
    this.mark()
    if (this.props.onDrawn) {
      this.props.onDrawn({join: this.cardJoin, result: this.result})
    }
  }

  mark() {
    if (!this.cardJoin) { return }
    let head = this.props.head ?? null
    markCard(this.cardJoin, {head, missed: this.props.missed})

    // a card of many systems runs past the plate's scroller: the column to
    // play is scrolled to when it moves onto a system out of view
    let el = head == null ? null : this.cardJoin.heads[head]?.[0]
    if (el && el.scrollIntoView) {
      el.scrollIntoView({block: "nearest", inline: "nearest", behavior: "smooth"})
    }
  }

  render() {
    return <div
      className={classNames(styles.score_card, {[styles.drawing]: this.state.drawing})}
      data-score-card
      aria-busy={this.state.drawing}>
      <div ref={this.plateRef} className={styles.plate} />
    </div>
  }
}

export default ScoreCard
