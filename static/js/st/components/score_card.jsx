// The trainer's card drawn by an engraving engine (st/score_render) from the
// piece's source MusicXML, in place of the app's own staff. The engine draws
// the card's measures once; the columns the trainer detects are joined to the
// drawn heads (card_join), and from then on the drill only moves classes on
// those heads: the column at the head of the drill, the ones done and the ones
// missed. The engines bundle is loaded on demand, never with the app.
// In scroll mode the card is a system drawn on one line (system), which the
// trainer's slider moves under a fixed hit line (setOffset), placing the
// column at the head of the drill by where its heads are drawn
// (st/score_render/card_scroll)

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {loadScoreEngines} from "st/score_render/load"
import {joinCard, markCard} from "st/score_render/card_join"
import {scrollTrack, scrollAdvance, scrollOffset} from "st/score_render/card_scroll"

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
    // the score staves drawn, in place of hand's (see st/score_render/types)
    staves: types.array,
    // the plate's width, which a card is drawn to and a system's hit line is
    // centred in
    width: types.number.isRequired,
    // draws the measures as one system to slide past the hit line, for
    // scroll mode
    system: types.bool,
    // the trainer's slider (st/slide_to_zero) that moves a system, read
    // whenever the column at the head of the drill moves on: a hit adds to
    // it at once, but it only calls setOffset on its next frame
    slider: types.object,
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
    this.stripRef = React.createRef()
    this.state = {drawing: true}
    this.drawCount = 0
  }

  componentDidMount() {
    this.draw()
  }

  componentDidUpdate(prevProps) {
    let p = this.props
    // a system is drawn on one line whatever the plate's width
    let redraw = ["musicXML", "fromMeasure", "toMeasure", "hand", "staves", "measureStarts", "engine", "system"]
      .some(name => prevProps[name] != p[name]) || (!p.system && prevProps.width != p.width)

    if (redraw) {
      this.draw()
    } else if (prevProps.columns != p.columns) {
      this.join()
    } else if (prevProps.head != p.head || prevProps.missed != p.missed) {
      this.mark()
    } else if (prevProps.width != p.width) {
      this.place()
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
    this.track = null
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
    let {musicXML, fromMeasure, toMeasure, hand, staves, width, measureStarts, engine, system} = this.props

    let bundle = await this.props.loadEngines()
    let result = system ?
      await bundle.ENGINES[engine].renderSystem({
        musicXML, fromMeasure, toMeasure, hand, staves, measureStarts,
      }) :
      await bundle.ENGINES[engine].renderCard({
        musicXML, fromMeasure, toMeasure, hand, staves, width, measureStarts,
      })

    // a later draw or an unmount has overtaken this one
    if (stale()) { return }

    this.result = result
    let into = system ? this.stripRef.current : this.plateRef.current
    into.replaceChildren(result.svg)
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

    // the heads of the columns this card had, eg. a system's earlier card
    if (this.cardJoin) {
      markCard(this.cardJoin, {head: null, missed: []})
    }

    this.cardJoin = cardJoin
    if (this.props.system) {
      let svg = this.result.svg
      let left = svg.getBoundingClientRect().left
      let xOf = el => {
        let rect = el.getBoundingClientRect()
        return rect.left + rect.width / 2 - left
      }
      this.track = scrollTrack(columns, cardJoin, this.result.notes, xOf)
    }

    this.mark()
    if (this.props.onDrawn) {
      this.props.onDrawn({join: this.cardJoin, result: this.result})
    }
  }

  mark() {
    if (!this.cardJoin) { return }
    let head = this.props.head ?? null
    markCard(this.cardJoin, {head, missed: this.props.missed})

    if (this.props.system) {
      this.place()
      return
    }

    // a card of many systems runs past the plate's scroller: the column to
    // play is scrolled to when it moves onto a system out of view
    let el = head == null ? null : this.cardJoin.heads[head]?.[0]
    if (el && el.scrollIntoView) {
      el.scrollIntoView({block: "nearest", inline: "nearest", behavior: "smooth"})
    }
  }

  // The trainer's slider, in units of the drawn system's mean onset gap (see
  // st/score_render/card_scroll): the column at the head of the drill is
  // placed that far past the hit line
  setOffset(value) {
    this.offsetValue = value
    this.place()
  }

  // how many of the slider's units the system moves on as the drill's column
  // is done with and next follows it, or null before the system is drawn
  scrollAdvance(column, next) {
    if (!this.track || !column) { return null }
    return scrollAdvance(this.track, column, next)
  }

  // where the system's hit line is, in the middle of the plate
  hitX() {
    return this.props.width / 2
  }

  place() {
    let strip = this.stripRef.current
    let column = this.props.columns[this.props.head ?? -1]
    let value = this.props.slider ? this.props.slider.value : this.offsetValue
    if (!this.track || !strip || !column || column.beat == null || value == null) { return }

    let offset = scrollOffset(this.track, column.beat, value, this.hitX())
    if (offset != null) {
      strip.style.transform = `translate3d(${offset}px, 0, 0)`
    }
  }

  render() {
    let plate
    if (this.props.system) {
      plate = <div key="system" ref={this.plateRef} className={classNames(styles.plate, styles.system)}>
        <div ref={this.stripRef} className={styles.strip} />
        <div className={styles.hit_line} style={{left: this.hitX()}} data-hit-line />
      </div>
    } else {
      plate = <div key="card" ref={this.plateRef} className={styles.plate} />
    }

    return <div
      className={classNames(styles.score_card, {[styles.drawing]: this.state.drawing})}
      data-score-card
      aria-busy={this.state.drawing}>
      {plate}
    </div>
  }
}

export default ScoreCard
