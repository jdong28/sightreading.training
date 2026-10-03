// The trainer's card drawn by an engraving engine (st/score_render) from the
// piece's source MusicXML, in place of the app's own staff. The engine draws
// the card's measures once; the columns the trainer detects are joined to the
// drawn heads (card_join), and from then on the drill only moves classes on
// those heads: the column at the head of the drill, the ones done and the ones
// missed. The engines bundle is loaded on demand, never with the app.
// In scroll mode the card is a system drawn on one line (system), which the
// trainer's slider moves under a fixed hit line (setOffset), placing the
// column at the head of the drill by where its heads are drawn
// (st/score_render/card_scroll). A system the drill comes back to (eg. the
// section after a hand-alone scaffold bar of today's programme) is re-joined
// to its kept drawing rather than drawn again (see systemCache in draw)

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {loadScoreEngines} from "st/score_render/load"
import {joinCard, markCard} from "st/score_render/card_join"
import {scrollTrack, scrollAdvance, scrollOffset} from "st/score_render/card_scroll"
import {placeBadges} from "st/score_render/card_badges"
import {shadeBands} from "st/score_render/card_shade"

import styles from "./score_card.module.css"

// an engine draws one card at a time (OSMD keeps one score loaded), so the
// cards of every ScoreCard are drawn one after another
let drawing = Promise.resolve()

// a content key of a badges prop, so componentDidUpdate only replaces them
// on a real change (a new array every render of engineCard() otherwise loops)
const badgeKey = badges => (badges || []).map(b => `${b.column}:${b.on}`).join(",")

// how many systems ScoreCard keeps drawn, so a return to one re-joins it
// rather than drawing it again
const KEPT_SYSTEMS = 3

// what a system is drawn from, keyed so an equal-by-value staves array (the
// page's handStaves cache hands back new arrays) still matches a kept one.
// The score itself is left out: a kept system is only ever looked up or
// inserted after the cache is filtered to the score it was drawn from
function systemKey(props) {
  let {engine, measureStarts, fromMeasure, toMeasure, hand, staves} = props
  return JSON.stringify({engine, measureStarts, fromMeasure, toMeasure, hand, staves: staves ?? null})
}

// A deep, independent copy of a drawn system: OSMD's own "system" display is
// one instance it keeps and redraws into (osmd.ts), so the svg and note
// elements a render hands back are only good until the engine draws again,
// even for an unrelated card. A kept system must own a copy nothing later
// reuses or mutates
function cloneResult({svg, notes, measures}) {
  let originals = [...svg.querySelectorAll("*")]
  let clone = svg.cloneNode(true)
  let copies = clone.querySelectorAll("*")
  let indexOf = new Map(originals.map((el, idx) => [el, idx]))
  return {svg: clone, notes: notes.map(note => ({...note, el: copies[indexOf.get(note.el)]})), measures}
}

const SVG_NS = "http://www.w3.org/2000/svg"

// an overview's shade rects carry this attribute (their shade's id), so a
// redrawn shade can find and clear the last one's
const DATA_SHADE = "data-shade"

// the drawn svg's own size in CSS pixels, the space CardMeasure boxes are
// measured in: its width/height attributes, which both engines set
function naturalSize(svg) {
  return {
    width: svg.width && svg.width.baseVal && svg.width.baseVal.value,
    height: svg.height && svg.height.baseVal && svg.height.baseVal.value,
  }
}

// a box in CSS pixels -> the svg's own user units (OSMD's root viewBox
// scales them down by ZOOM; Verovio's root has none, so its units are
// already pixels)
function userUnitsPerPixel(svg) {
  let viewBox = svg.viewBox && svg.viewBox.baseVal
  if (!viewBox || !viewBox.width) { return 1 }
  let {width} = naturalSize(svg)
  return width ? viewBox.width / width : 1
}

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
    // the card's columns, as extractSectionColumns gives them; left out for
    // an overview, which never joins or marks heads
    columns: types.array,
    // the index of the column at the head of the drill, null for none
    head: types.number,
    // the indices of the columns a miss was counted on
    missed: types.array,
    // bar badges to draw over the card during acoustic mode's "Where?" (see
    // st/score_render/card_badges), one per bar, in bar order; left out or
    // empty for none
    badges: types.array,
    engine: types.string,
    loadEngines: types.func,
    // called with the error when the engine can't draw the card
    onError: types.func,
    // called with {join, result} once a card is drawn
    onDrawn: types.func,
    // draws the card to be read, not played: no columns, no join, no marks;
    // its root is [data-score-overview], never [data-score-card], so it is
    // never found by a selector looking for the trainer's own card. Shaded
    // by shades, each {id, from, to, level, on, label} (st/score_render/
    // card_shade); a changed shades prop restyles in place without redrawing
    overview: types.bool,
    shades: types.array,
    // called with a shade's id when its band or label is clicked
    onShade: types.func,
  }

  static defaultProps = {
    engine: "osmd",
    loadEngines: loadScoreEngines,
    columns: [],
    missed: [],
    shades: [],
  }

  constructor(props) {
    super(props)
    this.rootRef = React.createRef()
    this.plateRef = React.createRef()
    this.stripRef = React.createRef()
    this.badgesRef = React.createRef()
    this.state = {drawing: true, bands: []}
    this.drawCount = 0
    // systems kept drawn, most recently used first: {key, musicXML, svg, result}
    this.systemCache = []
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
    } else if (p.overview) {
      if (prevProps.shades != p.shades) {
        this.shade()
      }
    } else if (prevProps.columns != p.columns) {
      this.join()
    } else if (prevProps.head != p.head || prevProps.missed != p.missed) {
      this.mark()
    } else if (prevProps.width != p.width) {
      this.place()
    }

    // a badge change (eg. a chosen bar lighting up) can arrive with a columns
    // change, so this stays outside the if/else chain above
    if (badgeKey(prevProps.badges) != badgeKey(p.badges)) {
      this.placeBadges()
    }
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  draw() {
    let count = ++this.drawCount
    let p = this.props

    // a kept system belongs to the score it was drawn from; once that score
    // moves on, so do they
    this.systemCache = this.systemCache.filter(entry => entry.musicXML == p.musicXML)
    let cached = p.system ? this.systemCache.find(entry => entry.key == systemKey(p)) : null

    // the drawn card stays up until the next is drawn, but no longer follows
    // the drill, whose columns are the next card's
    this.result = null
    this.cardJoin = null
    this.track = null

    if (cached) {
      this.systemCache = [cached, ...this.systemCache.filter(entry => entry != cached)]
      // a kept system comes back with none of the current/done/missed classes
      // it was last drilled with: the card it comes back to is one of its bars,
      // so its own join only ever marks that bar's heads
      markCard({heads: cached.result.notes.map(note => [note.el]), unmatched: []},
        {head: null, missed: []})
      this.result = cached.result
      let strip = this.stripRef.current
      if (strip) { strip.replaceChildren(cached.svg) }
      this.setState({drawing: false})
      this.join()
      return Promise.resolve()
    }

    this.setState({drawing: true})
    this.clearBadges()

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
    if (system) {
      let kept = cloneResult(result)
      this.systemCache = this.systemCache.filter(entry => entry.musicXML == musicXML)
      this.systemCache.unshift({key: systemKey(this.props), musicXML, svg: kept.svg, result: kept})
      this.systemCache = this.systemCache.slice(0, KEPT_SYSTEMS)
    }
    let into = system ? this.stripRef.current : this.plateRef.current
    into.replaceChildren(result.svg)
    this.setState({drawing: false})

    if (this.props.overview) {
      this.shade()
    } else {
      this.join()
    }
  }

  // Shades the drawn measures for an overview (see card_shade), as <rect>s
  // inside the svg, under the music: classes only, no fill/stroke
  // attributes, which score_card.module.css's blanket recolouring skips, and
  // inserted after the engine's own background rect, which it makes
  // transparent. The bands also drive the HTML label layer (render), which
  // tracks the svg's drawn size in percentages rather than its own text
  // shrinking with it.
  shade() {
    if (!this.result) { return }
    let svg = this.result.svg
    let bands = shadeBands(this.result.measures, this.props.shades)
    let ratio = userUnitsPerPixel(svg)

    for (let el of svg.querySelectorAll(`[${DATA_SHADE}]`)) {
      el.remove()
    }

    let background = svg.firstElementChild
    let after = background
    for (let band of bands) {
      let rect = document.createElementNS(SVG_NS, "rect")
      rect.setAttribute(DATA_SHADE, band.id)
      rect.setAttribute("x", band.box.x * ratio)
      rect.setAttribute("y", band.box.y * ratio)
      rect.setAttribute("width", band.box.width * ratio)
      rect.setAttribute("height", band.box.height * ratio)
      rect.setAttribute("class", classNames(
        styles.score_shade, styles[`shade_level_${band.level}`], {[styles.on]: band.on}))
      rect.addEventListener("click", () => {
        if (this.props.onShade) { this.props.onShade(band.id) }
      })

      if (after && after.nextSibling) {
        svg.insertBefore(rect, after.nextSibling)
      } else {
        svg.appendChild(rect)
      }
      after = rect
    }

    this.setState({bands})
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
    this.placeBadges()
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

  clearBadges() {
    let container = this.badgesRef.current
    if (container) { container.style.display = "none" }
  }

  // Positions the badges and tints over the card's named bars (see
  // st/score_render/card_badges), imperatively: the overlay is never driven
  // through state, since engineCard() builds a new badges array every
  // render. Acoustic mode is always wait mode, never a system (D5(a)/Q1 of
  // the design report), so a system draws none
  placeBadges() {
    let container = this.badgesRef.current
    let badges = this.props.badges
    let root = this.rootRef.current

    if (!container || !root || !badges || !badges.length || !this.cardJoin || this.props.system) {
      this.clearBadges()
      return
    }

    let rootRect = root.getBoundingClientRect()
    let relative = rect => ({
      left: rect.left - rootRect.left, top: rect.top - rootRect.top,
      right: rect.right - rootRect.left, bottom: rect.bottom - rootRect.top,
    })
    let columnRects = this.props.columns.map((column, i) =>
      (this.cardJoin.heads[i] || []).map(el => relative(el.getBoundingClientRect())))

    let placements = placeBadges(badges, columnRects)
    container.style.display = "block"

    placements.forEach((placement, i) => {
      let tint = container.querySelector(`[data-bar-tint="${i}"]`)
      if (tint) {
        tint.style.left = `${placement.tint.left}px`
        tint.style.top = `${placement.tint.top}px`
        tint.style.width = `${placement.tint.width}px`
        tint.style.height = `${placement.tint.height}px`
      }

      let pill = container.querySelector(`[data-bar-badge="${i}"]`)
      if (pill) {
        pill.style.left = `${placement.left}px`
        pill.style.top = `${placement.top}px`
      }
    })
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

  // the drawn heads of the column at the head of the drill, which the
  // plate's ink smudge marks (see PlateFeedback): [] before the card is
  // joined, or with no column at the head
  headElements() {
    return this.cardJoin && this.props.head != null ? this.cardJoin.heads[this.props.head] || [] : []
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

  // the HTML overlay of a shaded band's label, in percentages of the svg's
  // own drawn size so it tracks any scaling the plate applies and never
  // shrinks below the 11px floor the way embedded svg text would
  renderShadeLabels() {
    if (!this.result) { return null }
    let {width, height} = naturalSize(this.result.svg)
    if (!width || !height) { return null }

    return this.state.bands.filter(band => band.label).map(band => (
      <button
        key={band.id}
        type="button"
        className={classNames(styles.shade_label, styles[`shade_level_${band.level}`], {[styles.on]: band.on})}
        style={{left: `${band.box.x / width * 100}%`, top: `${band.box.y / height * 100}%`}}
        onClick={() => this.props.onShade && this.props.onShade(band.id)}>
        {band.label}
      </button>
    ))
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

    let rootProps = this.props.overview ? {"data-score-overview": true} : {"data-score-card": true}

    return <div
      ref={this.rootRef}
      className={classNames(styles.score_card, {[styles.drawing]: this.state.drawing})}
      {...rootProps}
      aria-busy={this.state.drawing}>
      {plate}
      {this.renderBadges()}
      {this.props.overview && <div className={styles.shade_labels}>{this.renderShadeLabels()}</div>}
    </div>
  }

  renderBadges() {
    let badges = this.props.badges
    if (!badges || !badges.length) { return null }

    return <div ref={this.badgesRef} className={styles.badges} aria-hidden="true">
      {badges.map((badge, i) => <React.Fragment key={i}>
        {badge.on && <div className={styles.bar_tint} data-bar-tint={i} />}
        <div
          className={classNames(styles.bar_badge, {[styles.bar_badge_on]: badge.on})}
          data-bar-badge={i}>
          {badge.label}
        </div>
      </React.Fragment>)}
    </div>
  }
}

export default ScoreCard
