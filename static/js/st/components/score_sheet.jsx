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
    onPages: types.func, // called with the page count whenever it changes
    selected: types.number, // the selected bar's printed number, or null
    onBar: types.func, // (number) => void
    // the overlay fill/label for each bar position, keyed by measure index
    // (CardMeasure#index): {fill, label}
    overlaysByIndex: types.object,
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
    if (prevProps.musicXML != this.props.musicXML || prevProps.engine != this.props.engine ||
        prevProps.fromMeasure != this.props.fromMeasure || prevProps.toMeasure != this.props.toMeasure ||
        this.engraveWidth(prevState.width) != this.engraveWidth(this.state.width)) {
      this.draw()
    }

    if (this.props.page != prevProps.page || this.state.pages != prevState.pages) {
      this.showPage(this.props.page)
    }

    let pages = this.state.pages
    if (pages && (!prevState.pages || prevState.pages.length != pages.length) && this.props.onPages) {
      this.props.onPages(pages.length)
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
          let style = {
            left: `${overlay.left * 100}%`, width: `${overlay.width * 100}%`,
            top: `${overlay.top * 100}%`, height: `${overlay.height * 100}%`,
            background: (extra && extra.fill) || undefined,
          }

          return <button
            key={overlay.index}
            type="button"
            aria-label={`Bar ${overlay.number}`}
            aria-pressed={this.props.selected == overlay.number}
            className={styles.bar_overlay}
            style={style}
            onClick={() => this.props.onBar && this.props.onBar(overlay.number)}>
            {extra && extra.label ? <span className={styles.bar_label}>{extra.label}</span> : null}
          </button>
        })}
      </div> : null}
      {this.props.children}
    </div>
  }
}

export default ScoreSheet
