// The score-first sheet music page's engraved score (D5): draws the whole
// piece once through the shared engine queue (st/components/score_card's
// enqueueDraw), paginates it into whole systems (st/score_render/
// score_pages), and shows one page at a time by cropping the one drawn svg
// -- turning a page never redraws. Renders the page's bar overlay buttons
// (shaded, labelled, tagged) and a slot for the bar pop-up. The drawn svg
// is a DOM node the engine hands back, managed directly (like ScoreCard's
// plateRef), never through React's own children.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {enqueueDraw} from "st/components/score_card"
import {
  ENGRAVE_MAX_WIDTH, PAGE_CHROME_PX, MIN_PAGE_PX, scorePages, barOverlays,
} from "st/score_render/score_pages"

import styles from "./score_sheet.module.css"

// the svg's own CSS px per user unit (OSMD's root viewBox scales by ZOOM;
// Verovio's root has none), the same conversion score_card.jsx's
// userUnitsPerPixel does
function userUnitsPerPixel(svg) {
  let viewBox = svg.viewBox && svg.viewBox.baseVal
  if (!viewBox || !viewBox.width) { return 1 }
  let width = svg.width && svg.width.baseVal && svg.width.baseVal.value
  return width ? viewBox.width / width : 1
}

export class ScoreSheet extends React.Component {
  static propTypes = {
    musicXML: types.string,
    measureStarts: types.array,
    engine: types.string,
    loadEngines: types.func.isRequired,
    fromMeasure: types.number,
    toMeasure: types.number,
    // the window's own innerHeight by default; a spec overrides it, since
    // puppeteer's window is a fixed small size
    viewportHeight: types.number,
    page: types.number, // the page index to show, clamped internally
    // called with (pageCount, ranges) whenever pagination is (re)computed;
    // ranges[i] is {first, last}, the printed bar numbers of page i
    onPages: types.func,
    selected: types.number, // the selected bar's printed number, or null
    onBar: types.func, // (number) => void
    // the overlay fill/label for each bar position, keyed by measure index
    // (CardMeasure#index): {fill, label}
    overlaysByIndex: types.object,
    // a difficulty passage tag or free-practice section tag at a bar
    // position, keyed the same way: {text, tone: "level-1"|"level-2"|
    // "level-3"|"section", onClick?} -- a tag with onClick is a button (a
    // difficulty tag, opening the passage pane), else a plain label (the
    // section tag)
    tagsByIndex: types.object,
    children: types.node, // the bar pop-up, rendered inside the page box
    onError: types.func,
  }

  static defaultProps = {
    page: 0,
  }

  constructor(props) {
    super(props)
    this.state = {width: null, result: null, pages: null}
    this.setSlotRef = el => {
      this.slotEl = el
      this.observeBox(el)
    }
    this.drawCount = 0
  }

  componentDidMount() {
    this.draw()
  }

  componentDidUpdate(prevProps, prevState) {
    let needsRedraw = prevProps.musicXML != this.props.musicXML || prevProps.engine != this.props.engine ||
      prevProps.fromMeasure != this.props.fromMeasure || prevProps.toMeasure != this.props.toMeasure ||
      this.engraveWidth(prevState.width) != this.engraveWidth(this.state.width)

    if (needsRedraw) {
      this.draw()
    } else if (this.state.result &&
        (this.state.width != prevState.width || this.props.viewportHeight != prevProps.viewportHeight)) {
      // the budget's own inputs moved (a resize that doesn't cross the
      // engrave-width floor, or the viewport's own height changing) without
      // the drawn svg needing to change: recompute pages rather than redraw
      this.setState({pages: this.pagesOf(this.state.result)})
    }

    if (this.props.page != prevProps.page || this.state.pages != prevState.pages) {
      this.showPage(this.props.page)
    }

    let pages = this.state.pages
    if (pages && pages != prevState.pages && this.props.onPages) {
      this.props.onPages(pages.length, pages.map(page => ({
        first: page.measures[0].number, last: page.measures[page.measures.length - 1].number,
      })))
    }
  }

  componentWillUnmount() {
    this.unmounted = true
    this.observeBox(null)
  }

  observeBox(el) {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      delete this.resizeObserver
    }

    if (!el) { return }

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.measureBox())
      this.resizeObserver.observe(el)
    }

    this.measureBox()
  }

  measureBox() {
    let el = this.slotEl
    if (!el || this.unmounted) { return }

    let width = el.clientWidth
    if (width && width != this.state.width) {
      this.setState({width})
    }
  }

  engraveWidth(width = this.state.width) {
    return width ? Math.floor(Math.min(width, ENGRAVE_MAX_WIDTH)) : null
  }

  // the viewport headroom a page is budgeted: viewportHeight less the
  // header and the chrome around the page (title row, plate padding,
  // toolbar, legend, pager), never under MIN_PAGE_PX, converted from
  // viewport (displayed) px to the engine's own natural px
  budgetPx(width = this.state.width) {
    let viewportHeight = this.props.viewportHeight ?? (typeof window != "undefined" ? window.innerHeight : 800)
    let headerHeight = 0
    if (typeof document != "undefined" && document.documentElement) {
      let raw = getComputedStyle(document.documentElement).getPropertyValue("--header-height")
      headerHeight = parseFloat(raw) || 0
    }

    let budgetDisplayed = Math.max(MIN_PAGE_PX, viewportHeight - headerHeight - PAGE_CHROME_PX)
    let engraveWidth = this.engraveWidth(width)
    if (!engraveWidth || !width) { return budgetDisplayed }

    return budgetDisplayed / (width / engraveWidth)
  }

  draw() {
    let {musicXML, engine, fromMeasure, toMeasure, loadEngines} = this.props
    let width = this.engraveWidth()
    if (!musicXML || !engine || fromMeasure == null || toMeasure == null || !width) { return }

    let count = ++this.drawCount
    let stale = () => count != this.drawCount || this.unmounted

    enqueueDraw(stale, () => loadEngines().then(bundle => bundle.ENGINES[engine].renderCard({
      musicXML, fromMeasure, toMeasure, hand: "both", staves: null, width,
      measureStarts: this.props.measureStarts,
    })).then(result => {
      if (stale()) { return }

      result.svg.setAttribute("width", "100%")
      if (this.slotEl) { this.slotEl.replaceChildren(result.svg) }

      this.setState({result, pages: this.pagesOf(result)}, () => this.showPage(this.props.page))
    }), error => {
      if (!stale() && this.props.onError) { this.props.onError(error) }
    })
  }

  pagesOf(result) {
    let height = result.svg.height && result.svg.height.baseVal && result.svg.height.baseVal.value
    if (!height) { return [] }
    return scorePages(result.measures, {height, budget: this.budgetPx()})
  }

  showPage(index) {
    let {result, pages} = this.state
    let svg = this.slotEl && this.slotEl.firstElementChild
    if (!result || !svg || !pages || !pages.length) { return }

    let page = pages[Math.max(0, Math.min(index, pages.length - 1))]
    let k = userUnitsPerPixel(result.svg)
    let vbWidth = result.svg.viewBox.baseVal.width

    svg.setAttribute("viewBox", `0 ${page.top * k} ${vbWidth} ${(page.bottom - page.top) * k}`)
    svg.setAttribute("height", `${page.bottom - page.top}`)
  }

  render() {
    let {result, pages, width} = this.state
    let page = pages && pages.length ? pages[Math.max(0, Math.min(this.props.page, pages.length - 1))] : null

    return <div className={styles.page_box} aria-busy={!result}>
      <div ref={this.setSlotRef} className={styles.svg_slot} />
      {page && width ? <div className={styles.overlays}>
        {barOverlays(page, width).map(overlay => {
          let extra = this.props.overlaysByIndex && this.props.overlaysByIndex[overlay.index]
          let tag = this.props.tagsByIndex && this.props.tagsByIndex[overlay.index]
          let selected = this.props.selected == overlay.number
          let boxStyle = {
            left: `${overlay.left * 100}%`, width: `${overlay.width * 100}%`,
            top: `${overlay.top * 100}%`, height: `${overlay.height * 100}%`,
          }
          // a selected bar's own tint and border (the CSS [aria-pressed]
          // rule) must win over the shade's own fill, an inline style that
          // would otherwise always beat it
          let fillStyle = selected ? undefined : {background: (extra && extra.fill) || undefined}

          return <div key={overlay.index} className={styles.bar_box} style={boxStyle}>
            <button
              type="button"
              aria-label={`Bar ${overlay.number}`}
              aria-pressed={selected}
              className={styles.bar_overlay}
              style={fillStyle}
              onClick={() => this.props.onBar && this.props.onBar(overlay.number)} />
            {tag || (extra && extra.label) ? <div className={styles.overlay_marks}>
              {extra && extra.label ? <span className={styles.bar_label}>{extra.label}</span> : null}
              {tag ? (tag.onClick ?
                <button
                  type="button"
                  className={classNames(styles.tag, styles[`tag_${tag.tone}`])}
                  onClick={tag.onClick}>{tag.text}</button> :
                <span className={classNames(styles.tag, styles[`tag_${tag.tone}`])}>{tag.text}</span>) : null}
            </div> : null}
          </div>
        })}
      </div> : null}
      {this.props.children}
    </div>
  }
}

export default ScoreSheet
