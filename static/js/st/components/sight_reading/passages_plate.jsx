// "The piece at a glance": the score page's preface showing a piece's
// flagged passages (st/difficulty), mockup screen I ("The difficult
// passages"). Shown at rest in both free practice and today's programme,
// for any imported piece with flags in force. Reasons come only from the
// score analysis in stage 1: no Claude, no outside sources, no practice
// records, no teacher.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import {BarStrip} from "st/components/bar_strip"
import {ScoreCard} from "st/components/score_card"
import {romanNumeral} from "st/music"
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
// side, else they stack
const SIDE_BY_SIDE_WIDTH = 600

const HAND_LABEL = {upper: "Right hand alone", lower: "Left hand alone", both: "Hands separately"}

// a both-hands passage starts with the right hand (the mockup's "right
// hand first")
function handPillHand(flag) {
  return flag.hand == "both" ? "upper" : flag.hand
}

function barsLabel(start, end) {
  return start == end ? `bar ${start}` : `bars ${start}–${end}`
}

function barsHeading(start, end) {
  let label = barsLabel(start, end)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

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
    this.state = {selectedId: null, folded: foldedState(), width: 0, scoreFailed: false}
    this.columnRef = React.createRef()
    this.scoreScrollRef = React.createRef()
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
      this.setState({selectedId: null, scoreFailed: false})
      this.ensure()
    }

    this.observeWidth()
  }

  componentWillUnmount() {
    this.unmounted = true
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    }
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  ensure() {
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return }

    ensureAnnotation(piece.id, this.getStore()).then(() => {
      if (!this.unmounted) { this.forceUpdate() }
    })
  }

  observeWidth() {
    let el = this.columnRef.current
    if (!el || el == this.observedEl) { return }

    this.observedEl = el

    // measured once synchronously too: a ResizeObserver's first callback can
    // lag in a backgrounded tab, and the score plate needs a width to draw to
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

  setFolded(folded) {
    this.setState({folded})
    storeFolded(folded)
  }

  // selecting from the strip or the list scrolls the score box to the
  // passage; selecting the shaded band itself (already in view) does not
  select(id, {scroll=false}={}) {
    this.setState({selectedId: id}, () => {
      if (scroll) { this.scrollToSelected(id) }
    })
  }

  // the shaded rect may not be drawn yet (an overview width change can make
  // the card redraw asynchronously instead of just restyling), so this
  // tries a few times rather than only right after the selection's setState
  scrollToSelected(id, triesLeft=20) {
    let box = this.scoreScrollRef.current
    if (!box) { return }

    let rect = box.querySelector(`rect[data-shade="${id}"]`)
    if (!rect) {
      if (triesLeft > 0 && !this.unmounted) {
        setTimeout(() => this.scrollToSelected(id, triesLeft - 1), 50)
      }
      return
    }

    let boxRect = box.getBoundingClientRect()
    let rectRect = rect.getBoundingClientRect()
    let top = Math.max(0, rectRect.top - boxRect.top + box.scrollTop - 24)
    box.scrollTo({top, behavior: "smooth"})
  }

  practise(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag))
  }

  practiseHand(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag, handPillHand(flag)))
  }

  // the passage shown in the detail plate: the selected one, else the
  // hardest (flags is already ordered hardest first)
  selectedFlag(flags) {
    return flags.find(flag => flag.id == this.state.selectedId) || flags[0]
  }

  renderGlance(numbers, heat, flags, coveredCount, selected) {
    let aside = `${flags.length} ${flags.length == 1 ? "passage" : "passages"} · ` +
      `${coveredCount} of ${numbers.length} bars`

    return <Plate
      className={styles.glance_plate}
      header="The piece at a glance"
      headerAside={<span className={styles.glance_aside}>
        {aside}
        <button
          type="button"
          className={styles.fold_toggle}
          onClick={() => this.setFolded(!this.state.folded)}>
          {this.state.folded ? "Show the passages" : "Hide the passages"}
        </button>
      </span>}>
      <BarStrip
        numbers={numbers}
        heat={heat}
        flags={flags}
        selectedId={selected && selected.id}
        onSelect={id => this.select(id, {scroll: true})} />

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
        {flag.reasons.map((reason, idx) =>
          <li key={idx}>
            <span className={styles.source_chip}>Score</span>
            {reason}
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
              <span className={styles.list_bars}>{`${flag.start}–${flag.end}`}</span>
            </button>
          </li>)}
      </ul>
    </Plate>
  }

  renderScore(song, flags, selected) {
    let source = this.props.source
    if (!source || source.status != "ready" || !source.musicXML) { return null }
    if (this.state.scoreFailed) { return null }
    if (!this.state.width) { return null }

    let [fromMeasure, toMeasure] = measureNumberRange(song)
    let shades = flags.map(flag => ({
      id: flag.id,
      from: flag.start,
      to: flag.end,
      level: flag.level,
      on: flag.id == selected.id,
      label: `${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level].toUpperCase()}`,
    }))

    return <Plate
      className={styles.score_plate}
      header="The score · your imported MusicXML"
      headerAside={barsHeading(selected.start, selected.end)}>
      <div className={styles.score_scroll} ref={this.scoreScrollRef}>
        <ScoreCard
          overview
          musicXML={source.musicXML}
          fromMeasure={fromMeasure}
          toMeasure={toMeasure}
          hand="both"
          width={this.state.width}
          engine={this.props.engine}
          loadEngines={this.props.loadEngines}
          shades={shades}
          onShade={id => this.select(id)}
          onError={() => this.setState({scoreFailed: true})} />
      </div>
      <div className={styles.legend}>
        <span>Tap a shaded passage, or a bracket above the strip, to read why it is hard.</span>
      </div>
    </Plate>
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

    let coveredBars = new Set()
    for (let flag of flags) {
      for (let n = flag.start; n <= flag.end; n++) { coveredBars.add(n) }
      for (let [from, to] of flag.alsoAt || []) {
        for (let n = from; n <= to; n++) { coveredBars.add(n) }
      }
    }

    let selected = this.selectedFlag(flags)

    return <div className={styles.passages} ref={this.columnRef} data-passages-plate>
      {this.renderGlance(numbers, heat, flags, coveredBars.size, selected)}

      {!this.state.folded && <div className={classNames(styles.detail_row, {
        [styles.side_by_side]: this.state.width >= SIDE_BY_SIDE_WIDTH,
      })}>
        {this.renderDetail(selected, flags)}
        {this.renderList(flags, selected)}
      </div>}

      {!this.state.folded && this.renderScore(song, flags, selected)}
    </div>
  }
}

export default PassagesPlate
