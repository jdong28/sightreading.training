// The score-first score page's engraving (score-first design §D4/§D5): the
// whole piece drawn once by an engraving engine (st/score_render) and cut
// into pages of whole systems, with a bar overlay button per measure
// position for the tints, labels and click handling, and a slot for the
// bar pop-up anchored to a selected bar. Draws through the engines' shared
// queue (st/components/score_card enqueueDraw), never an engine directly,
// and loads the engines bundle on demand (st/score_render/load), never
// statically.
//
// A bar's note marks (st/bar_review's marks: the notes that tend to go wrong
// filled in, once-wrong ones ringed, the key pressed instead as a grey head,
// a ▾ over a pause, and a tag or two) are put on the heads the engine drew,
// found by pitch and onset as the trainer's join finds them (st/score_render/
// card_join): the engraving only gains a class, and the rest is a layer over
// it of boxes in percent of the plate, which scales with the page. They are
// placed again whenever the page is shown (a re-engrave, a width change or a
// page turn all end in showPage) and whenever noteMarks change, so nothing
// of them is kept between draws.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {enqueueDraw} from "st/components/score_card"
import {
  scorePages, barOverlays, engraveWidthFor, ENGRAVE_MAX_WIDTH, PAGE_CHROME_PX, MIN_PAGE_PX, MIN_PAGE_SYSTEMS, SCORE_SCALE,
} from "st/score_render/score_pages"

import styles from "./score_sheet.module.css"

// the class a note head the player tends to get wrong gains, drawn in
// oxblood whatever the plate paints heads in
export const TROUBLE_CLASS = "score_note_trouble"

// the onset grid the two clocks are compared on, as the join's
const TICKS = 960
const tick = beats => Math.round(beats * TICKS)

// the size of a ring round a head, in head widths
const RING_SCALE = 1.6

// how far right of a head its ghost sits, in head widths
const GHOST_GAP = 0.25

// what a tag's text takes, to tell when two would overlap: a character, and
// the padding either side
const TAG_CHAR_PX = 5.3
const TAG_PAD_PX = 10

// how high above a column's top head its pause mark sits, in head heights
const PAUSE_RISE = 1.2

function naturalSize(svg) {
  return {
    width: svg.width && svg.width.baseVal && svg.width.baseVal.value,
    height: svg.height && svg.height.baseVal && svg.height.baseVal.value,
  }
}

function headerHeight() {
  let value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height"))
  return Number.isFinite(value) ? value : 0
}

export class ScoreSheet extends React.Component {
  static propTypes = {
    musicXML: types.string.isRequired,
    measureStarts: types.array,
    fromMeasure: types.number.isRequired,
    toMeasure: types.number.isRequired,
    engine: types.string,
    // the score scale in percent (st/score_render/score_pages SCORE_SCALE):
    // the score is engraved 100 / scale times as wide, never zoomed, so the
    // bars to a system and a page follow it
    scale: types.number,
    loadEngines: types.func.isRequired,
    // window.innerHeight by default; specs pass it, since puppeteer's
    // window is 800x600
    viewportHeight: types.number,
    // the page to show, clamped to the pages found; 0 by default
    page: types.number,
    // called with the pages (ScorePage[], st/score_render/score_pages) once
    // pagination runs or recomputes
    onPages: types.func,
    // a played bar's tint and top border, by printed bar number, see
    // st/components/sight_reading/score_view
    barInfo: types.instanceOf(Map),
    // a played bar's label, by printed bar number: {text, className}
    labels: types.instanceOf(Map),
    // tags at a bar's first position on its page: {measure, text, className}
    tags: types.array,
    selected: types.number,
    onBar: types.func,
    onTag: types.func,
    // called with the anchor style ({left|right, top|bottom}, in percent)
    // for the selected bar's pop-up, see score-first design §D6
    renderPopup: types.func,
    onError: types.func,
    // the clicked bar's note marks, see st/bar_review (barReview().marks):
    // {measure, heads: [{beat, pitch, kind}], ghosts: [{beat, pitch, played,
    // steps}], pauses: [{beat}], tags: [{beat, pitch, text, tone}]}, or null
    noteMarks: types.object,
  }

  static defaultProps = {
    engine: "osmd",
    scale: SCORE_SCALE.initial,
    tags: [],
  }

  constructor(props) {
    super(props)
    this.state = {
      drawing: true, width: 0, engraveWidth: null, naturalWidth: 0, naturalHeight: 0, pages: [],
      // the layer over the plate, see placeMarks
      marks: [],
    }
    this.rootRef = React.createRef()
    this.plateRef = React.createRef()
    this.boxRef = React.createRef()
    this.drawCount = 0
  }

  componentDidMount() {
    this.observeWidth()
  }

  componentDidUpdate(prevProps) {
    this.observeWidth()

    let redraw = ["musicXML", "fromMeasure", "toMeasure", "measureStarts", "engine"]
      .some(name => prevProps[name] != this.props[name])

    if (redraw) {
      this.draw()
    } else if (prevProps.scale != this.props.scale && this.state.width) {
      // a new engrave width, so a draw, unless the width is as it was
      this.setWidth(this.state.width)
    } else if (prevProps.viewportHeight != this.props.viewportHeight) {
      this.paginate()
    }

    if (prevProps.page != this.props.page) {
      this.showPage()
    } else if (prevProps.noteMarks != this.props.noteMarks) {
      this.placeMarks()
    }
  }

  componentWillUnmount() {
    this.unmounted = true
    if (this.resizeObserver) { this.resizeObserver.disconnect() }
  }

  observeWidth() {
    let el = this.rootRef.current
    if (!el || el == this.observedEl) { return }
    this.observedEl = el

    let initial = el.getBoundingClientRect().width
    if (initial) { this.setWidth(initial) }

    if (typeof ResizeObserver == "undefined") { return }

    this.resizeObserver = new ResizeObserver(entries => {
      let width = entries[0] && entries[0].contentRect.width
      if (width) { this.setWidth(width) }
    })
    this.resizeObserver.observe(el)
  }

  // re-engraves only when the engrave width itself changes (floored, the
  // column's clamped at ENGRAVE_MAX_WIDTH and widened by the scale, see
  // engraveWidthFor); otherwise only the page budget moves
  setWidth(width) {
    let engraveWidth = engraveWidthFor(width, this.props.scale)
    let changed = engraveWidth != this.state.engraveWidth

    this.setState({width, engraveWidth}, () => changed ? this.draw() : this.paginate())
  }

  draw() {
    let count = ++this.drawCount
    let {musicXML, fromMeasure, toMeasure, measureStarts, engine} = this.props
    let width = this.state.engraveWidth || engraveWidthFor(ENGRAVE_MAX_WIDTH, this.props.scale)

    this.setState({drawing: true})
    let stale = () => count != this.drawCount || this.unmounted

    return enqueueDraw(stale, async () => {
      let bundle = await this.props.loadEngines()
      let result = await bundle.ENGINES[engine].renderCard({
        musicXML, fromMeasure, toMeasure, hand: "both", staves: null, width, measureStarts,
      })
      if (stale()) { return }

      // an engine always reports measures; guarded all the same against a
      // test double that doesn't, so a malformed result never crashes the
      // page rather than failing through onError
      this.result = {...result, measures: result.measures || []}
      let into = this.plateRef.current
      if (into) { into.replaceChildren(result.svg) }

      let {width: naturalWidth, height: naturalHeight} = naturalSize(result.svg)
      this.setState({drawing: false, naturalWidth, naturalHeight}, () => this.paginate())
    }, error => {
      if (!this.unmounted) { this.setState({drawing: false}) }
      if (this.props.onError) { this.props.onError(error) }
    })
  }

  paginate() {
    if (!this.result || !this.state.naturalHeight) { return }

    let {naturalHeight, engraveWidth, width} = this.state
    let displayedWidth = width || engraveWidth
    let ratio = engraveWidth ? displayedWidth / engraveWidth : 1
    let viewportHeight = this.props.viewportHeight ?? window.innerHeight
    let displayBudget = Math.max(MIN_PAGE_PX, viewportHeight - headerHeight() - PAGE_CHROME_PX)
    let budget = ratio ? displayBudget / ratio : displayBudget

    let pages = scorePages(this.result.measures, {height: naturalHeight, budget, minSystems: MIN_PAGE_SYSTEMS})
    this.setState({pages}, () => {
      if (this.props.onPages) { this.props.onPages(pages) }
      this.showPage()
    })
  }

  currentPage() {
    let {pages} = this.state
    if (!pages.length) { return null }
    return pages[this.props.page ?? 0] || pages[0]
  }

  showPage() {
    if (!this.result) { return }
    let page = this.currentPage()
    if (!page) { return }

    let svg = this.result.svg
    let viewBox = svg.viewBox && svg.viewBox.baseVal
    let vbWidth = viewBox ? viewBox.width : this.state.naturalWidth
    let k = viewBox && this.state.naturalWidth ? viewBox.width / this.state.naturalWidth : 1

    svg.setAttribute("viewBox", `0 ${page.top * k} ${vbWidth} ${(page.bottom - page.top) * k}`)
    svg.setAttribute("height", `${page.bottom - page.top}`)

    this.placeMarks()
  }

  // The clicked bar's note marks, on the page as it is now: the class on the
  // heads, and the boxes of the layer over the plate in percent of it. The
  // heads found by pitch and onset (a tick either side), none for a note the
  // engine drew on another page (outside the box) or not at all
  placeMarks() {
    let plate = this.plateRef.current
    let box = this.boxRef.current
    if (!plate) { return }

    for (let el of plate.querySelectorAll(`.${TROUBLE_CLASS}`)) {
      el.classList.remove(TROUBLE_CLASS)
    }

    let marks = this.props.noteMarks
    let placed = []
    let page = this.currentPage()

    // the marks of a bar not on this page are none: its heads are in the
    // engraving all the same, drawn on another page
    if (marks && this.result && box && page && page.measures.some(measure => measure.number == marks.measure)) {
      let boxRect = box.getBoundingClientRect()
      let pct = (value, size) => size ? value / size * 100 : 0

      // a head's box in percent of the plate box
      let boxOf = el => {
        let rect = el.getBoundingClientRect()
        return {
          left: pct(rect.left - boxRect.left, boxRect.width), top: pct(rect.top - boxRect.top, boxRect.height),
          width: pct(rect.width, boxRect.width), height: pct(rect.height, boxRect.height),
        }
      }
      let visible = rect => rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top + rect.height <= 100 &&
        rect.left >= 0 && rect.left + rect.width <= 100

      let headsAt = (beat, pitch) => this.result.notes.filter(note =>
        (pitch == null || note.pitch == pitch) && Math.abs(tick(note.onsetBeats) - tick(beat)) <= 1)

      for (let {beat, pitch, kind} of marks.heads || []) {
        for (let note of headsAt(beat, pitch)) {
          if (kind == "habit") { note.el.classList.add(TROUBLE_CLASS) }
        }

        let head = headsAt(beat, pitch).map(note => boxOf(note.el)).find(visible)
        if (head && kind == "once") {
          // a circle round the head, wide in percent of the box as high in
          // pixels, which the plate's two sizes tell apart
          let w = Math.max(head.width, head.height * boxRect.height / boxRect.width) * RING_SCALE
          let h = w * boxRect.width / boxRect.height
          placed.push({
            kind: "ring", left: head.left + head.width / 2 - w / 2, top: head.top + head.height / 2 - h / 2,
            width: w, height: h,
          })
        }
      }

      for (let {beat, pitch, steps} of marks.ghosts || []) {
        let head = headsAt(beat, pitch).map(note => boxOf(note.el)).find(visible)
        if (!head) { continue }

        placed.push({
          kind: "ghost",
          left: head.left + head.width * (1 + GHOST_GAP), top: head.top - steps * head.height / 2,
          width: head.width, height: head.height,
        })
      }

      for (let {beat} of marks.pauses || []) {
        let heads = headsAt(beat).map(note => boxOf(note.el)).filter(visible)
        if (!heads.length) { continue }

        let top = heads.reduce((best, head) => head.top < best.top ? head : best)
        placed.push({kind: "pause", left: top.left + top.width / 2, top: top.top - top.height * PAUSE_RISE, text: "▾"})
      }

      // the tags sit at the bottom of the bar's system band, under the head
      let overlay = barOverlays(page, this.state.naturalWidth).find(o => o.number == marks.measure)
      if (overlay) {
        let tags = []
        for (let {beat, pitch, text, tone} of marks.tags || []) {
          let head = headsAt(beat, pitch).map(note => boxOf(note.el)).find(visible)
          if (!head) { continue }

          let left = Math.min(92, Math.max(8, head.left + head.width / 2))
          let wide = mark => (mark.text.length * TAG_CHAR_PX + TAG_PAD_PX) / boxRect.width * 100
          let stacked = tags.some(other => Math.abs(other.left - left) < (wide(other) + wide({text})) / 2 + 1)
          let mark = {kind: "tag", tone, left, top: overlay.top + overlay.height, text, stacked}
          tags.push(mark)
          placed.push(mark)
        }
      }
    }

    if (JSON.stringify(placed) != JSON.stringify(this.state.marks)) {
      this.setState({marks: placed})
    }
  }

  render() {
    let page = this.currentPage()
    let overlays = page ? barOverlays(page, this.state.naturalWidth) : []

    return <div
      ref={this.rootRef}
      className={styles.sheet}
      data-score-sheet
      aria-busy={this.state.drawing}>
      <div ref={this.boxRef} className={classNames(styles.plate_box, {[styles.drawing]: this.state.drawing})}>
        <div ref={this.plateRef} className={styles.plate} />
        {page && this.renderOverlays(page, overlays)}
        {this.renderMarks()}
        {page && this.renderPopupSlot(page, overlays)}
      </div>
    </div>
  }

  // the layer of a bar's note marks over the plate, never in the way of a
  // click
  renderMarks() {
    return <div className={styles.marks} aria-hidden="true">
      {this.state.marks.map((mark, idx) => {
        let style = {left: `${mark.left}%`, top: `${mark.top}%`}
        if (mark.width != null) { style = {...style, width: `${mark.width}%`, height: `${mark.height}%`} }

        return <span
          key={idx}
          data-mark={mark.kind}
          className={classNames(styles.mark, styles[`mark_${mark.kind}`], {
            [styles.tag_oxblood]: mark.tone == "oxblood", [styles.tag_gilt]: mark.tone == "gilt",
            [styles.tag_stacked]: mark.stacked,
          })}
          style={style}>{mark.text}</span>
      })}
    </div>
  }

  renderOverlays(page, overlays) {
    let {barInfo, labels, selected} = this.props

    return <React.Fragment>
      {overlays.map((overlay, idx) => {
        let info = (barInfo && barInfo.get(overlay.number)) || {}
        let label = labels && labels.get(overlay.number)
        let isSelected = selected === overlay.number
        let boxStyle = {
          left: `${overlay.left}%`, top: `${overlay.top}%`,
          width: `${overlay.width}%`, height: `${overlay.height}%`,
        }

        return <React.Fragment key={idx}>
          <button
            type="button"
            aria-label={`Bar ${overlay.number}`}
            aria-pressed={isSelected}
            className={classNames(styles.bar_overlay, {[styles.selected]: isSelected})}
            style={{
              ...boxStyle,
              background: isSelected ? undefined : info.fill || "transparent",
              borderTopWidth: info.topBorder ? "4px" : undefined,
              borderTopColor: info.topBorder || undefined,
            }}
            onClick={() => this.props.onBar && this.props.onBar(overlay.number)} />
          {label && <span
            className={classNames(styles.bar_label, label.className)}
            style={{left: boxStyle.left, top: boxStyle.top}}>
            {label.text}
          </span>}
        </React.Fragment>
      })}
      {this.renderTags(page, overlays)}
    </React.Fragment>
  }

  renderTags(page, overlays) {
    let numbers = new Set(page.measures.map(m => m.number))
    return (this.props.tags || [])
      .filter(tag => numbers.has(tag.measure))
      .map((tag, idx) => {
        let overlay = overlays.find(o => o.number == tag.measure)
        if (!overlay) { return null }

        return <button
          key={idx}
          type="button"
          className={classNames(styles.bar_tag, tag.className)}
          style={{left: `${overlay.left}%`, top: `${overlay.top}%`}}
          onClick={() => this.props.onTag && this.props.onTag(tag.measure)}>
          {tag.text}
        </button>
      })
  }

  // the bar pop-up's anchor (score-first design §D6): left of the box
  // when the bar's centre is left of the page's middle, else right; below
  // the bar, except when its system is the last on a page of two or more,
  // where it opens above
  renderPopupSlot(page, overlays) {
    let {selected, renderPopup} = this.props
    if (selected == null || !renderPopup) { return null }

    let overlay = overlays.find(o => o.number == selected)
    if (!overlay) { return null }

    let lastBand = page.bands[page.bands.length - 1]
    let lastTop = lastBand ? (lastBand.top - page.top) / (page.bottom - page.top) * 100 : null
    let onLastSystem = lastTop != null && Math.abs(overlay.top - lastTop) < 0.01

    let horiz = overlay.left + overlay.width / 2 < 50 ?
      {left: `${overlay.left}%`} : {right: `${100 - overlay.left - overlay.width}%`}
    let vert = onLastSystem && page.bands.length > 1 ?
      {bottom: `${100 - overlay.top}%`} : {top: `${overlay.top + overlay.height}%`}

    return renderPopup({...horiz, ...vert})
  }
}

export default ScoreSheet
