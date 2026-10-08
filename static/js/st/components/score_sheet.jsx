// The score-first score page's engraving (score-first design §D4/§D5): the
// whole piece drawn once by an engraving engine (st/score_render) and cut
// into pages of whole systems, with a bar overlay button per measure
// position for the tints, labels and click handling, and a slot for the
// bar pop-up anchored to a selected bar. Draws through the engines' shared
// queue (st/components/score_card enqueueDraw), never an engine directly,
// and loads the engines bundle on demand (st/score_render/load), never
// statically.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {enqueueDraw} from "st/components/score_card"
import {
  scorePages, barOverlays, ENGRAVE_MAX_WIDTH, PAGE_CHROME_PX, MIN_PAGE_PX,
} from "st/score_render/score_pages"

import styles from "./score_sheet.module.css"

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
  }

  static defaultProps = {
    engine: "osmd",
    tags: [],
  }

  constructor(props) {
    super(props)
    this.state = {drawing: true, width: 0, engraveWidth: null, naturalWidth: 0, naturalHeight: 0, pages: []}
    this.rootRef = React.createRef()
    this.plateRef = React.createRef()
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
    } else if (prevProps.viewportHeight != this.props.viewportHeight) {
      this.paginate()
    }

    if (prevProps.page != this.props.page) {
      this.showPage()
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

  // re-engraves only when the engrave width itself changes (floored,
  // clamped at ENGRAVE_MAX_WIDTH); otherwise only the page budget moves
  setWidth(width) {
    let engraveWidth = Math.floor(Math.min(width, ENGRAVE_MAX_WIDTH))
    let changed = engraveWidth != this.state.engraveWidth

    this.setState({width, engraveWidth}, () => changed ? this.draw() : this.paginate())
  }

  draw() {
    let count = ++this.drawCount
    let {musicXML, fromMeasure, toMeasure, measureStarts, engine} = this.props
    let width = this.state.engraveWidth || ENGRAVE_MAX_WIDTH

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

    let pages = scorePages(this.result.measures, {height: naturalHeight, budget})
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
  }

  render() {
    let page = this.currentPage()
    let overlays = page ? barOverlays(page, this.state.naturalWidth) : []

    return <div
      ref={this.rootRef}
      className={styles.sheet}
      data-score-sheet
      aria-busy={this.state.drawing}>
      <div className={classNames(styles.plate_box, {[styles.drawing]: this.state.drawing})}>
        <div ref={this.plateRef} className={styles.plate} />
        {page && this.renderOverlays(page, overlays)}
        {page && this.renderPopupSlot(page, overlays)}
      </div>
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
          {label && <span className={classNames(styles.bar_label, label.className)} style={boxStyle}>
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
