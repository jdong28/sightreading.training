// The score-first sheet music page's own engraving: the whole piece drawn
// once by an engraving engine (st/score_render), paginated into whole
// systems a page (st/score_render/score_pages), one page shown at a time by
// cropping the same drawn svg rather than redrawing it. Bars are tinted,
// labelled and clicked through absolutely positioned overlay buttons (the
// hit-testing is the DOM's), and tagged (a difficulty flag, a free-practice
// section marker). Never joins or marks heads: this is the score page's own
// sheet, not the trainer's drilled card (st/components/score_card), and
// draws through the same shared one-engine-at-a-time queue (enqueueDraw).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {enqueueDraw} from "st/components/score_card"
import {scorePages, barOverlays, ENGRAVE_MAX_WIDTH, PAGE_CHROME_PX, MIN_PAGE_PX} from "st/score_render/score_pages"

import styles from "./score_sheet.module.css"

// OSMD's root viewBox scales a box's CSS px by this to its own user units
// (Verovio's root has none, so its ratio is 1); see userUnitsPerPixel in
// st/components/score_card, duplicated here for a sheet drawn outside a
// ScoreCard
function naturalSize(svg) {
  return {
    width: svg.width && svg.width.baseVal && svg.width.baseVal.value,
    height: svg.height && svg.height.baseVal && svg.height.baseVal.value,
  }
}

function userUnitsPerPixel(svg) {
  let viewBox = svg.viewBox && svg.viewBox.baseVal
  if (!viewBox || !viewBox.width) { return 1 }
  let {width} = naturalSize(svg)
  return width ? viewBox.width / width : 1
}

function headerHeightPx() {
  if (typeof getComputedStyle == "undefined") { return 108 }
  let value = getComputedStyle(document.documentElement).getPropertyValue("--header-height")
  let n = parseFloat(value)
  return Number.isFinite(n) ? n : 108
}

export class ScoreSheet extends React.Component {
  static propTypes = {
    musicXML: types.string.isRequired,
    fromMeasure: types.number.isRequired,
    toMeasure: types.number.isRequired,
    measureStarts: types.array,
    engine: types.string.isRequired,
    loadEngines: types.func.isRequired,
    // the window's own height by default; a spec gives puppeteer's
    viewportHeight: types.number,
    // the page to show, 0-based; clamped to the pages actually paginated
    page: types.number,
    // called with the new pages (st/score_render/score_pages) whenever they
    // are recomputed, so the parent can clamp page and know the count
    onPages: types.func,
    // (measureNumber) => {tint, label, labelVariant, tag, sectionBorder},
    // all optional: tint/labelVariant are CSS class suffixes (score_sheet.
    // module.css's tint_{x}/label_{x}), tag {text, level, onClick}
    decorate: types.func,
    selected: types.number,
    onBar: types.func,
    onError: types.func,
    // a function (overlaysByMeasure: Map<number, {left,top,width,height} %>)
    // => node, rendered inside the page box, eg. the bar pop-up
    children: types.func,
  }

  static defaultProps = {
    viewportHeight: typeof window != "undefined" ? window.innerHeight : 800,
    page: 0,
    decorate: () => ({}),
  }

  constructor(props) {
    super(props)
    this.state = {result: null, drawing: true, failed: false, pages: [], boxWidth: 0}
    this.rootRef = React.createRef()
    this.boxRef = React.createRef()
    this.plateRef = React.createRef()
    this.drawCount = 0
  }

  componentDidMount() {
    this.observeWidth()
    this.draw()
  }

  componentDidUpdate(prevProps, prevState) {
    this.observeWidth()

    // a box width that fluctuates without crossing an engrave width (eg.
    // scrollbar gutter changes, both still clamped to ENGRAVE_MAX_WIDTH)
    // only repaginates, never redraws: redrawing changes the svg's own
    // size, which could otherwise feed back into another resize
    let redrawKeys = ["musicXML", "fromMeasure", "toMeasure", "engine", "measureStarts"]
    let propsChanged = redrawKeys.some(key => prevProps[key] != this.props[key])
    let engraveChanged = prevState.boxWidth != this.state.boxWidth && this.engraveWidth() != this.drawnWidth

    if (propsChanged || engraveChanged) {
      this.draw()
    } else if (prevState.boxWidth != this.state.boxWidth || prevProps.viewportHeight != this.props.viewportHeight) {
      this.recomputePages()
    }

    if (this.state.result && (prevProps.page != this.props.page || prevState.pages != this.state.pages)) {
      this.showPage()
    }
  }

  componentWillUnmount() {
    this.unmounted = true
    if (this.resizeObserver) { this.resizeObserver.disconnect() }
  }

  observeWidth() {
    let el = this.boxRef.current
    if (!el || el == this.observedEl) { return }
    this.observedEl = el

    let initial = el.getBoundingClientRect().width
    if (initial && initial != this.state.boxWidth) { this.setState({boxWidth: initial}) }

    if (typeof ResizeObserver == "undefined") { return }
    if (this.resizeObserver) { this.resizeObserver.disconnect() }
    this.resizeObserver = new ResizeObserver(entries => {
      let width = entries[0] && entries[0].contentRect.width
      if (width && width != this.state.boxWidth) { this.setState({boxWidth: width}) }
    })
    this.resizeObserver.observe(el)
  }

  engraveWidth() {
    let box = this.state.boxWidth || ENGRAVE_MAX_WIDTH
    return Math.max(1, Math.floor(Math.min(box, ENGRAVE_MAX_WIDTH)))
  }

  // redraws at the current engrave width; componentDidMount and
  // componentDidUpdate are the only callers, and only when musicXML/the
  // drawn range/the engine changed or the engrave width itself did, so
  // this never needs to decide for itself whether a redraw is due
  draw() {
    let engraveWidth = this.engraveWidth()
    let count = ++this.drawCount
    let stale = () => count != this.drawCount || this.unmounted
    this.setState({drawing: true, failed: false})

    enqueueDraw(stale, async () => {
      let bundle = await this.props.loadEngines()
      let result = await bundle.ENGINES[this.props.engine].renderCard({
        musicXML: this.props.musicXML,
        fromMeasure: this.props.fromMeasure,
        toMeasure: this.props.toMeasure,
        hand: "both",
        staves: null,
        width: engraveWidth,
        measureStarts: this.props.measureStarts,
      })

      if (stale()) { return }
      this.drawnWidth = engraveWidth
      this.setState({result, drawing: false}, () => {
        let into = this.plateRef.current
        if (into) { into.replaceChildren(result.svg) }
        this.drawnSize = naturalSize(result.svg)
        this.recomputePages()
      })
    }, error => {
      if (stale()) { return }
      this.setState({drawing: false, failed: true})
      if (this.props.onError) { this.props.onError(error) }
    })
  }

  // paginates the drawing measured in draw(), before showPage crops it
  recomputePages() {
    let {result} = this.state
    if (!result || !Array.isArray(result.measures) || !this.drawnSize) { return }

    let {width, height} = this.drawnSize
    if (!width || !height) { return }

    let displayed = this.state.boxWidth || width
    let budget = Math.max(MIN_PAGE_PX, this.props.viewportHeight - headerHeightPx() - PAGE_CHROME_PX)
    let naturalBudget = budget / (displayed / width)

    let pages = scorePages(result.measures, {height, width, budget: naturalBudget})
    this.setState({pages})
    if (this.props.onPages) { this.props.onPages(pages) }
  }

  currentPage() {
    let {pages} = this.state
    if (!pages.length) { return null }
    let index = Math.max(0, Math.min(this.props.page, pages.length - 1))
    return pages[index]
  }

  // crops the one drawn svg to the current page: sets its viewBox to that
  // page's natural-px band (converted to the svg's own user units) and its
  // height attribute, so turning a page never redraws
  showPage() {
    let svg = this.state.result && this.state.result.svg
    let page = this.currentPage()
    if (!svg || !page) { return }

    let vb = svg.viewBox && svg.viewBox.baseVal
    let k = userUnitsPerPixel(svg)
    if (vb) {
      svg.setAttribute("viewBox", `0 ${page.top * k} ${vb.width} ${(page.bottom - page.top) * k}`)
    }
    svg.setAttribute("height", `${page.bottom - page.top}`)
  }

  // the current page's bar overlays, keyed by printed measure number (a
  // split bar's second position overwrites the first; callers that need
  // both read this.state.pages/barOverlays themselves)
  overlaysByMeasure() {
    let page = this.currentPage()
    if (!page) { return new Map() }
    return new Map(barOverlays(page).map(overlay => [overlay.number, overlay]))
  }

  onBoxClick(e, overlay) {
    if (this.props.onBar) { this.props.onBar(overlay.number) }
  }

  renderOverlays() {
    let page = this.currentPage()
    if (!page) { return null }

    return barOverlays(page).map((overlay, idx) => {
      let deco = this.props.decorate(overlay.number) || {}
      let selected = this.props.selected === overlay.number

      let style = {
        left: `${overlay.left}%`, top: `${overlay.top}%`,
        width: `${overlay.width}%`, height: `${overlay.height}%`,
      }

      return <React.Fragment key={`${overlay.number}-${idx}`}>
        <button
          type="button"
          aria-label={`Bar ${overlay.number}`}
          aria-pressed={selected}
          className={classNames(styles.bar_overlay, {
            [styles[`tint_${deco.tint}`]]: deco.tint,
            [styles.selected]: selected,
          })}
          style={style}
          onClick={e => this.onBoxClick(e, overlay)} />
        {deco.label ? <div
          className={classNames(styles.bar_label, {[styles[`label_${deco.labelVariant}`]]: deco.labelVariant})}
          style={{left: `${overlay.left}%`, top: `${overlay.top}%`}}>
          {deco.label}
        </div> : null}
        {deco.tag ? <button
          type="button"
          className={classNames(styles.bar_tag, styles[`tag_level_${deco.tag.level}`])}
          style={{left: `${overlay.left}%`, top: `${overlay.top}%`}}
          onClick={deco.tag.onClick}>
          {deco.tag.text}
        </button> : null}
        {deco.sectionBorder ? <div
          className={styles.section_border}
          style={{left: `${overlay.left}%`, width: `${overlay.width}%`, top: `${overlay.top}%`}} /> : null}
      </React.Fragment>
    })
  }

  render() {
    let {drawing, failed} = this.state

    return <div ref={this.rootRef} className={styles.score_sheet} aria-busy={drawing}>
      <div ref={this.boxRef} className={styles.page_box}>
        <div ref={this.plateRef} className={styles.plate} />
        {!failed ? this.renderOverlays() : null}
        {typeof this.props.children == "function" ? this.props.children(this.overlaysByMeasure()) : null}
      </div>
    </div>
  }
}

export default ScoreSheet
