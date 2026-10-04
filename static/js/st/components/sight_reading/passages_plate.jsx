// "The piece at a glance": the score page's rail plate showing a piece's
// flagged passages (st/difficulty). Shown at rest in both free practice and
// today's programme, for any imported piece with flags in force, at the
// head of the trainer's right rail (see ScoreRail in score_page.jsx).
// Reasons come only from the score analysis in stage 1: no Claude, no
// outside sources, no practice records, no teacher.
// "Show the score" opens the whole shaded piece in a right-hand pane
// ("The score"). The engraving is drawn only once the pane has been opened,
// and closing the pane drops a draw of it that hasn't started; a draw already
// started on the engines' shared queue (ScoreCard) can't be aborted, so it
// still delays the next card

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import {BarStrip} from "st/components/bar_strip"
import {ScoreCard} from "st/components/score_card"
import {SidePane} from "st/components/sight_reading/settings_panel"
import {romanNumeral, barsLabel, barsHeading} from "st/music"
import {measureNumberList, measureNumberRange} from "st/song_sections"
import {sheetMusicPiece, passageSettings} from "st/data"
import {pieceSong, ensureAnnotation} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {flagsInForce} from "st/difficulty/records"
import {heat as heatLevel} from "st/difficulty/sections"
import {LEVEL_WORDS} from "st/difficulty/index"

import styles from "./passages_plate.module.css"

// whether the "The piece at a glance" plate is open, remembered per viewer
const FOLD_KEY = "st:passages_folded:v1"

function foldedState(storage=window.localStorage) {
  try {
    return storage.getItem(FOLD_KEY) == "1"
  } catch (e) {
    return false
  }
}

function storeFolded(folded, storage=window.localStorage) {
  try {
    storage.setItem(FOLD_KEY, folded ? "1" : "0")
  } catch (e) {
    // the fold just opens again next time
  }
}

// the plate column is wide enough for the passage and list plates side by
// side, else they stack. At the rail's width (see docs/design/salon-de-chopin.md)
// this never holds; it still applies to the stacked phone layout between
// 600 and 860px of the single-column trainer
const SIDE_BY_SIDE_WIDTH = 600

const HAND_LABEL = {upper: "Right hand alone", lower: "Left hand alone", both: "Hands separately"}

// a passage to practise hands separately offers the right hand first
function handPillHand(flag) {
  return flag.hand == "both" ? "upper" : flag.hand
}

const SOURCE_CHIP = {score: "Score", teacher: "Teacher", player: "You"}

export class PassagesPlate extends React.Component {
  static propTypes = {
    generator: types.object,
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    // the trainer's engine source: {status, musicXML} ready, or missing/
    // failed/loading, or null before a piece is picked
    source: types.object,
    engine: types.string,
    loadEngines: types.func,
    store: types.object,
  }

  constructor(props) {
    super(props)
    this.state = {
      selectedId: null, folded: foldedState(), width: 0, scoreFailed: false,
      scoreOpen: false, paneWidth: 0,
    }
    this.columnRef = React.createRef()
    this.paneRef = React.createRef()
    this.scoreColumnRef = React.createRef()
  }

  componentDidMount() {
    this.ensure()
    this.observeWidth()
  }

  // the column is only in the tree once the piece's annotation has loaded
  // (render returns null until then), so its width is measured whenever it
  // first appears, not only at mount
  componentDidUpdate(prevProps) {
    let piece = sheetMusicPiece(this.props.settings)
    let prevPiece = sheetMusicPiece(prevProps.settings)
    if ((piece && piece.id) != (prevPiece && prevPiece.id)) {
      this.setState({selectedId: null, scoreFailed: false, scoreOpen: false})
      this.ensure()
    }

    this.observeWidth()
    if (this.state.scoreOpen) { this.observePaneWidth() }
  }

  componentWillUnmount() {
    this.unmounted = true
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    }
    if (this.paneResizeObserver) {
      this.paneResizeObserver.disconnect()
    }
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  ensure() {
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return }

    let source = this.props.source
    let own = source && source.piece && source.piece.id == piece.id &&
      source.status == "ready" && source.musicXML

    ensureAnnotation(piece.id, this.getStore(), {source: own || undefined}).then(() => {
      if (!this.unmounted) { this.forceUpdate() }
    })
  }

  observeWidth() {
    let el = this.columnRef.current
    if (!el || el == this.observedEl) { return }

    this.observedEl = el

    // measured once synchronously too: a ResizeObserver's first callback can
    // lag in a backgrounded tab, and the side-by-side rule needs a width
    let initial = el.getBoundingClientRect().width
    if (initial) { this.setState({width: initial}) }

    if (typeof ResizeObserver == "undefined") { return }

    if (this.resizeObserver) { this.resizeObserver.disconnect() }

    this.resizeObserver = new ResizeObserver(entries => {
      let width = entries[0] && entries[0].contentRect.width
      if (width && width != this.state.width) { this.setState({width}) }
    })
    this.resizeObserver.observe(el)
  }

  // the score pane's own column, measured the same way as observeWidth: the
  // overview is drawn to whatever width the pane gives it, not the rail's
  observePaneWidth() {
    let el = this.scoreColumnRef.current
    if (!el || el == this.observedPaneEl) { return }

    this.observedPaneEl = el

    let initial = el.getBoundingClientRect().width
    if (initial) { this.setState({paneWidth: initial}) }

    if (typeof ResizeObserver == "undefined") { return }

    if (this.paneResizeObserver) { this.paneResizeObserver.disconnect() }

    this.paneResizeObserver = new ResizeObserver(entries => {
      let width = entries[0] && entries[0].contentRect.width
      if (width && width != this.state.paneWidth) { this.setState({paneWidth: width}) }
    })
    this.paneResizeObserver.observe(el)
  }

  setFolded(folded) {
    this.setState({folded})
    storeFolded(folded)
  }

  // selecting from the strip or the list scrolls the pane to the passage,
  // once it is open; selecting the shaded band itself (already in view)
  // does not, and there is nothing to scroll while the pane is closed
  select(id, {scroll=false}={}) {
    this.setState({selectedId: id}, () => {
      if (scroll && this.state.scoreOpen) { this.scrollToSelected(id) }
    })
  }

  // opens the score pane, selecting a passage (the one already shown by
  // default) and scrolling to it once it is drawn
  openScore(id) {
    this.setState({scoreOpen: true, selectedId: id ?? this.state.selectedId}, () => {
      this.observePaneWidth()
      this.scrollToSelected(this.state.selectedId)
    })
  }

  closeScore() {
    this.setState({scoreOpen: false})
  }

  // the shaded rect may not be drawn yet (a pane just opened measures its
  // width only after this callback, so the overview mounts and begins its
  // draw after it), so this waits on the drawing rather than a fixed number
  // of tries: a long import's overview takes as long as it takes. It gives
  // up once the overview has settled without the band, and whenever the
  // pane, the selection or the engraving has moved on
  scrollToSelected(id) {
    let box = this.paneRef.current
    if (!box || this.unmounted || !this.state.scoreOpen ||
      !this.canShowScore() || id != this.state.selectedId) { return }

    let rect = box.querySelector(`rect[data-shade="${id}"]`)
    if (!rect) {
      let overview = box.querySelector("[data-score-overview]")
      if (!overview || overview.getAttribute("aria-busy") == "true") {
        setTimeout(() => this.scrollToSelected(id), 50)
      }
      return
    }

    let boxRect = box.getBoundingClientRect()
    let rectRect = rect.getBoundingClientRect()
    // the pane's header is pinned over the top of the scrollport, so the band
    // clears it as well as the margin above it
    let header = parseFloat(getComputedStyle(box).getPropertyValue("--drawer-header-height")) || 0
    let top = Math.max(0, rectRect.top - boxRect.top + box.scrollTop - header - 24)
    box.scrollTo({top, behavior: "smooth"})
  }

  // the trainer's own staff can always draw a piece; the shaded score needs
  // the piece's stored source MusicXML and an engine that can draw it
  canShowScore() {
    let source = this.props.source
    return !!(source && source.status == "ready" && source.musicXML) && !this.state.scoreFailed
  }

  practise(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag))
    this.closeScore()
  }

  practiseHand(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag, handPillHand(flag)))
    this.closeScore()
  }

  // the passage shown in the detail plate: the selected one, else the
  // hardest (flags is already ordered hardest first)
  selectedFlag(flags) {
    return flags.find(flag => flag.id == this.state.selectedId) || flags[0]
  }

  renderGlance(numbers, heat, flags, coveredCount, selected) {
    let aside = `${flags.length} ${flags.length == 1 ? "passage" : "passages"} · ` +
      `${coveredCount} of ${numbers.length} bars`

    return <Plate header="The piece at a glance">
      <BarStrip
        numbers={numbers}
        heat={heat}
        flags={flags}
        selectedId={selected && selected.id}
        onSelect={id => this.select(id, {scroll: true})} />

      <div className={styles.glance_row}>
        <span>{aside}</span>
        <div className={styles.glance_actions}>
          {this.canShowScore() && <button
            type="button"
            className={styles.fold_toggle}
            onClick={() => this.openScore(selected.id)}>
            Show the score
          </button>}
          <button
            type="button"
            className={styles.fold_toggle}
            onClick={() => this.setFolded(!this.state.folded)}>
            {this.state.folded ? "Show the passages" : "Hide the passages"}
          </button>
        </div>
      </div>

      {!this.state.folded && <div className={styles.legend}>
        <span>
          Each cell is a bar. Easier
          <span className={styles.ramp} aria-hidden="true">
            {[0, 1, 2, 3, 4].map(level => <i key={level} className={styles[`heat_${level}`]} />)}
          </span>
          harder, from the score analysis
        </span>
        <span className={styles.key}><b className={styles.key_hardest} />Hardest</span>
        <span className={styles.key}><b className={styles.key_hard} />Hard</span>
        <span className={styles.key}><b className={styles.key_worth} />Worth a look</span>
      </div>}
    </Plate>
  }

  // shared by the rail's detail plate and the score pane's
  renderDetail(flag, flags) {
    let num = romanNumeral(flag.num)
    let total = romanNumeral(flags.length)

    return <Plate
      className={styles.compact_plate}
      header={`Passage ${num} of ${total}`}
      headerAside={<span className={classNames(styles.level_label, styles[`level_${flag.level}`])}>
        {LEVEL_WORDS[flag.level]}
      </span>}>
      <h3 className={styles.flag_title}>{barsHeading(flag.start, flag.end)}</h3>
      <div className={styles.flag_sub}>{flag.title}</div>

      <ul className={styles.reasons}>
        {flag.lines.map((line, idx) =>
          <li key={idx}>
            <span className={styles.source_chip}>{SOURCE_CHIP[line.source] || "Score"}</span>
            {line.text}
          </li>)}
      </ul>

      <div className={styles.tip}>
        <div className={styles.tip_label}>How to practise it</div>
        <p>{flag.tip}</p>
      </div>

      <div className={styles.actions}>
        <Pill variant="primary" className={styles.small_pill} onClick={() => this.practise(flag)}>
          {`Practise ${barsLabel(flag.start, flag.end)}`}
        </Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.practiseHand(flag)}>
          {HAND_LABEL[flag.hand]}
        </Pill>
      </div>
    </Plate>
  }

  renderList(flags, selected) {
    return <Plate className={styles.compact_plate} header="Flagged passages" headerAside="hardest first">
      <ul className={styles.flag_list}>
        {flags.map(flag =>
          <li
            key={flag.id}
            className={classNames({[styles.on]: flag.id == selected.id})}>
            <button type="button" onClick={() => this.select(flag.id, {scroll: true})}>
              <span className={classNames(styles.list_num, styles[`level_${flag.level}`])}>
                {romanNumeral(flag.num)}
              </span>
              <span className={styles.list_title}>{flag.title}</span>
              <span className={styles.list_bars}>{barsHeading(flag.start, flag.end)}</span>
            </button>
          </li>)}
      </ul>
    </Plate>
  }

  // "The score" pane (st/components/sight_reading/settings_panel's SidePane,
  // right-anchored): the whole piece shaded, beside the selected passage's
  // detail with the legend as its last line, which stay on screen while the
  // score scrolls (see .pane_detail). The ScoreCard is mounted only while the
  // pane is open (this.state.scoreOpen), so closing it drops a draw that
  // hasn't started on the shared draw queue (st/components/score_card); one
  // already started can't be aborted
  renderScorePane(song, flags, selected) {
    let source = this.props.source
    let [fromMeasure, toMeasure] = measureNumberRange(song)
    let shades = flags.map(flag => ({
      id: flag.id,
      from: flag.start,
      to: flag.end,
      level: flag.level,
      on: flag.id == selected.id,
      label: `${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level].toUpperCase()}`,
    }))

    let ready = source && source.status == "ready" && source.musicXML
    let showOverview = !!(this.state.scoreOpen && this.state.paneWidth > 0 &&
      ready && !this.state.scoreFailed)

    return <SidePane
      side="right"
      open={this.state.scoreOpen}
      close={() => this.closeScore()}
      paneRef={this.paneRef}
      title="The score"
      label="The score"
      closeLabel="Close the score">
      <div className={styles.pane_body}>
        <div className={styles.pane_score} ref={this.scoreColumnRef}>
          {showOverview ?
            <ScoreCard
              overview
              musicXML={source.musicXML}
              fromMeasure={fromMeasure}
              toMeasure={toMeasure}
              hand="both"
              width={this.state.paneWidth}
              engine={this.props.engine}
              loadEngines={this.props.loadEngines}
              shades={shades}
              onShade={id => this.select(id)}
              onError={() => this.setState({scoreFailed: true})} /> :
            this.state.scoreFailed ?
              <p className={styles.pane_note}>The score couldn't be engraved.</p> : null}
        </div>
        <div className={styles.pane_detail}>
          {this.renderDetail(selected, flags)}
          {showOverview && <div className={styles.legend}>
            <span>Tap a shaded passage, or a label above it, to read why it is hard.</span>
          </div>}
        </div>
      </div>
    </SidePane>
  }

  render() {
    let piece = sheetMusicPiece(this.props.settings)
    let song = piece && pieceSong(piece)
    if (!piece || !song) { return null } // no piece picked, or pasted notation

    let record = this.getStore().annotation(piece.id)
    let flags = flagsInForce(record)
    if (!flags.length) { return null }

    let numbers = measureNumberList(song)
    let heatPct = (record.runs && record.runs.score && record.runs.score.heat) || []
    let heat = numbers.map((_, idx) => heatLevel(heatPct[idx] || 0))

    let inFlag = (flag, number) =>
      (number >= flag.start && number <= flag.end) ||
      (flag.alsoAt || []).some(([from, to]) => number >= from && number <= to)
    let coveredCount = numbers.filter(number => flags.some(flag => inFlag(flag, number))).length

    let selected = this.selectedFlag(flags)

    return <div className={styles.passages} ref={this.columnRef} data-passages-plate>
      {this.renderGlance(numbers, heat, flags, coveredCount, selected)}

      {!this.state.folded && <div className={classNames(styles.detail_row, {
        [styles.side_by_side]: this.state.width >= SIDE_BY_SIDE_WIDTH,
      })}>
        {this.renderDetail(selected, flags)}
        {this.renderList(flags, selected)}
      </div>}

      {this.renderScorePane(song, flags, selected)}
    </div>
  }
}

export default PassagesPlate
