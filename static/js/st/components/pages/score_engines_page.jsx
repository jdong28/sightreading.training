// The engraving engines page (/score-engines): one card of an imported
// piece's source score drawn by both engines behind st/score_render, stacked,
// so an engine can be chosen with the music in front of you. The engines are
// loaded when this page opens (st/score_render/load), never by another page.
// Hovering or clicking a drawn note reads it back through the card's notes,
// the same way for both engines; nothing here is played or scored

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"
import {useSearchParams} from "react-router-dom"

import {setTitle} from "st/globals"
import {RIGHT_HAND, LEFT_HAND} from "st/data"
import {noteName} from "st/music"
import {loadDeck, pieceSong, pieceSource} from "st/sheet_music_deck"
import {measureNumberRange} from "st/song_sections"
import {loadScoreEngines} from "st/score_render/load"
import {Pill, SectionLabel, TitleBlock, DoubleRule} from "st/components/salon"

import styles from "./score_engines_page.module.css"

// the trainer's staff plate, normal and fullscreen
export const PLATE_WIDTHS = [
  {width: 644, label: "Normal"},
  {width: 926, label: "Fullscreen"},
]

export const HANDS = [
  {hand: "both", label: "Both hands"},
  {hand: "upper", label: "Upper staff"},
  {hand: "lower", label: "Lower staff"},
]

// the engines by their key in the engines bundle, in the order drawn
export const ENGINE_ORDER = ["osmd", "verovio"]

export const MISSING_SOURCE_MESSAGE = "This piece was imported before the app kept each piece's score, " +
  "so there is no MusicXML for the engines to draw. Import its file again on the sheet music page " +
  "(its stats are kept) and it will draw here."

const DEFAULT_CARD_MEASURES = 8

// the page opened on the piece, measures and hand of the sheet music
// generator's settings
export function scoreEnginesPath(settings={}) {
  let params = new URLSearchParams()
  if (settings.piece) { params.set("piece", settings.piece) }
  if (settings.startMeasure != null) { params.set("from", settings.startMeasure) }
  if (settings.endMeasure != null) { params.set("to", settings.endMeasure) }
  if (settings.hand == RIGHT_HAND) { params.set("hand", "upper") }
  if (settings.hand == LEFT_HAND) { params.set("hand", "lower") }
  let query = params.toString()
  return `/score-engines${query ? `?${query}` : ""}`
}

// the card first drawn for a song: its first bar (past a pickup) and the
// seven after it
export function defaultMeasures(song) {
  let [first, last] = song ? measureNumberRange(song) : [1, 1]
  let from = last >= 1 ? Math.max(first, 1) : first
  return {from, to: Math.max(from, Math.min(from + DEFAULT_CARD_MEASURES - 1, last))}
}

function readMeasure(value) {
  let number = parseInt(value, 10)
  return Number.isFinite(number) ? number : null
}

function formatBeats(beats) {
  return String(Math.round(beats * 1000) / 1000)
}

// what the page says about a drawn note, the same for either engine
export function describeNote(note) {
  return {
    name: noteName(note.pitch),
    pitch: note.pitch,
    onset: formatBeats(note.onsetBeats),
    staff: note.staff == 1 ? "upper" : note.staff == 2 ? "lower" : `staff ${note.staff}`,
    voice: note.voice,
  }
}

const ACTIVE_CLASS = "score_note_active"

// one engine's rendering of the card on its plate, with the note under the
// pointer (or the last clicked) read back through the card's notes
export class EngineCard extends React.Component {
  static propTypes = {
    engine: types.object.isRequired,
    result: types.object,
    error: types.string,
    renderMs: types.number,
    width: types.number.isRequired,
    activeId: types.string,
    onActivate: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.plateRef = React.createRef()
  }

  componentDidMount() {
    this.placeSvg()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.result != this.props.result) {
      this.placeSvg()
    } else if (prevProps.activeId != this.props.activeId) {
      this.markActive()
    }
  }

  placeSvg() {
    let plate = this.plateRef.current
    if (!plate) { return }
    plate.replaceChildren()
    let result = this.props.result
    this.notesByEl = new Map()
    if (!result) { return }

    for (let note of result.notes) {
      this.notesByEl.set(note.el, note)
    }
    plate.appendChild(result.svg)
    this.markActive()
  }

  markActive() {
    let result = this.props.result
    if (!result) { return }
    for (let note of result.notes) {
      note.el.classList.toggle(ACTIVE_CLASS, note.id == this.props.activeId)
    }
  }

  // the card note whose drawn element holds the event's target
  noteAt(target) {
    let plate = this.plateRef.current
    for (let el = target; el && el != plate; el = el.parentNode) {
      let note = this.notesByEl && this.notesByEl.get(el)
      if (note) { return note }
    }
    return null
  }

  activeNote() {
    let result = this.props.result
    return result && result.notes.find(note => note.id == this.props.activeId)
  }

  render() {
    let {engine, result, error, renderMs, width} = this.props
    let active = this.activeNote()

    return <section className={styles.engine} data-engine={engine.key}>
      <div className={styles.engine_header}>
        <span className={styles.engine_name}>{engine.name}</span>
        <span className={styles.engine_meta}>{engine.version} · {engine.licence}</span>
        <span className={styles.render_time} data-render-time>
          {renderMs != null ? `${Math.round(renderMs)} ms` : error ? "failed" : "drawing…"}
        </span>
      </div>
      <div className={styles.plate_scroll}>
        <div
          ref={this.plateRef}
          className={classNames(styles.plate, styles[`engine_${engine.key}`])}
          style={{width: `${width}px`}}
          onMouseOver={e => {
            let note = this.noteAt(e.target)
            if (note) { this.props.onActivate(note.id, false) }
          }}
          onClick={e => {
            let note = this.noteAt(e.target)
            this.props.onActivate(note ? note.id : null, true)
          }}
        />
      </div>
      {error ? <p className={styles.error} role="alert">{engine.name} couldn't draw the card: {error}</p> : null}
      <p className={styles.readout} aria-live="polite" data-readout>
        {active ? this.renderReadout(active) :
          result ? `${result.notes.length} notes drawn. Point at or click a note to read it back.` : " "}
      </p>
    </section>
  }

  renderReadout(note) {
    let d = describeNote(note)
    return <>
      <strong className={styles.note_name}>{d.name}</strong>
      {` · MIDI ${d.pitch} · onset ${d.onset} beats · ${d.staff} staff · voice ${d.voice}`}
    </>
  }
}

export class ScoreEnginesPage extends React.Component {
  static propTypes = {
    // the piece, measures, hand and width to open with, eg. from the
    // sheet music page's link
    initial: types.object,
    loadEngines: types.func,
    readSource: types.func,
    deck: types.func,
  }

  static defaultProps = {
    initial: {},
    loadEngines: loadScoreEngines,
    readSource: pieceSource,
    deck: loadDeck,
  }

  constructor(props) {
    super(props)
    let pieces = props.deck().pieces
    let initial = props.initial || {}
    let piece = pieces.find(p => p.id == initial.piece) || pieces[0] || null
    let measures = defaultMeasures(piece && pieceSong(piece))

    this.state = {
      pieceId: piece ? piece.id : null,
      from: initial.from ?? measures.from,
      to: initial.to ?? measures.to,
      hand: HANDS.some(h => h.hand == initial.hand) ? initial.hand : "both",
      width: PLATE_WIDTHS.some(w => w.width == initial.width) ? initial.width : PLATE_WIDTHS[0].width,
      source: undefined,
      engines: null,
      loadError: null,
      cards: {},
      activeId: null,
      pinned: false,
    }
    this.drawCount = 0
  }

  componentDidMount() {
    setTitle("Engraving engines")
    this.mounted = true
    this.loadEngines()
    this.readSource()
  }

  componentWillUnmount() {
    this.mounted = false
  }

  componentDidUpdate(prevProps, prevState) {
    let s = this.state
    if (prevState.pieceId != s.pieceId) {
      this.readSource()
      return
    }

    if (prevState.engines != s.engines || prevState.source != s.source ||
      prevState.from != s.from || prevState.to != s.to ||
      prevState.hand != s.hand || prevState.width != s.width) {
      this.draw()
    }
  }

  async loadEngines() {
    let start = performance.now()
    try {
      let bundle = await this.props.loadEngines()
      await bundle.enginesReady()
      if (!this.mounted) { return }
      this.setState({
        engines: ENGINE_ORDER.map(key => ({key, ...bundle.ENGINES[key]})),
        loadMs: performance.now() - start,
      })
    } catch (e) {
      if (!this.mounted) { return }
      this.setState({loadError: String((e && e.message) || e)})
    }
  }

  async readSource() {
    let pieceId = this.state.pieceId
    this.setState({source: undefined, cards: {}, activeId: null, pinned: false})
    if (!pieceId) { return }

    let source = await this.props.readSource(pieceId)
    if (!this.mounted || this.state.pieceId != pieceId) { return }
    this.setState({source})
  }

  // draws the card with each engine in turn, keeping only the latest draw
  async draw() {
    let {engines, source, from, to, hand, width} = this.state
    if (!engines || !source || from == null || to == null) { return }

    let drawId = ++this.drawCount
    this.setState({cards: {}, activeId: this.state.pinned ? this.state.activeId : null})

    for (let engine of engines) {
      // let the page paint between the engines' drawing
      await new Promise(resolve => setTimeout(resolve, 0))
      if (drawId != this.drawCount || !this.mounted) { return }

      let card
      let start = performance.now()
      try {
        let result = await engine.renderCard({musicXML: source, fromMeasure: from, toMeasure: to, hand, width})
        card = {result, renderMs: performance.now() - start}
      } catch (e) {
        console.warn(`${engine.name} couldn't draw the card:`, e)
        card = {error: String((e && e.message) || e)}
      }

      if (drawId != this.drawCount || !this.mounted) { return }
      this.setState(state => ({cards: {...state.cards, [engine.key]: card}}))
    }
  }

  activate(id, click) {
    if (click) {
      this.setState(state => ({
        activeId: id,
        pinned: !!id && !(state.pinned && state.activeId == id),
      }))
    } else if (!this.state.pinned) {
      this.setState({activeId: id})
    }
  }

  setPiece(pieceId) {
    let piece = this.props.deck().pieces.find(p => p.id == pieceId)
    let measures = defaultMeasures(piece && pieceSong(piece))
    this.setState({pieceId, from: measures.from, to: measures.to})
  }

  render() {
    let pieces = this.props.deck().pieces

    return <main className={styles.score_engines_page}>
      <TitleBlock eyebrow="Sheet music" title="Engraving" italic="engines" />
      <p className={styles.lede}>
        The same card of your score drawn by OpenSheetMusicDisplay and by Verovio,
        from the MusicXML you imported. Point at a note to read it back.
      </p>
      <DoubleRule />
      {pieces.length ? this.renderControls(pieces) : <p className={styles.notice}>
        No pieces imported yet. Import a MusicXML score on the sheet music page first.
      </p>}
      {this.renderCards()}
    </main>
  }

  renderControls(pieces) {
    let {pieceId, from, to, hand, width} = this.state
    let piece = pieces.find(p => p.id == pieceId)
    let song = piece && pieceSong(piece)
    let [first, last] = song ? measureNumberRange(song) : [null, null]

    return <form className={styles.controls} onSubmit={e => e.preventDefault()}>
      <label className={styles.field}>
        <SectionLabel rule={false}>Piece</SectionLabel>
        <select
          name="piece"
          value={pieceId || ""}
          onChange={e => this.setPiece(e.target.value)}>
          {pieces.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </label>

      <div className={styles.field}>
        <SectionLabel rule={false}>Measures</SectionLabel>
        <div className={styles.measures}>
          <input
            type="number" name="from" aria-label="From measure"
            min={first ?? undefined} max={last ?? undefined}
            value={from ?? ""}
            onChange={e => this.setState({from: readMeasure(e.target.value)})} />
          <span>to</span>
          <input
            type="number" name="to" aria-label="To measure"
            min={first ?? undefined} max={last ?? undefined}
            value={to ?? ""}
            onChange={e => this.setState({to: readMeasure(e.target.value)})} />
          {song ? <span className={styles.hint}>of {first}–{last}</span> : null}
        </div>
      </div>

      <div className={styles.field}>
        <SectionLabel rule={false}>Hand</SectionLabel>
        <div className={styles.pills}>
          {HANDS.map(h => <Pill key={h.hand} variant="choice" selected={hand == h.hand}
            onClick={() => this.setState({hand: h.hand})}>{h.label}</Pill>)}
        </div>
      </div>

      <div className={styles.field}>
        <SectionLabel rule={false}>Plate</SectionLabel>
        <div className={styles.pills}>
          {PLATE_WIDTHS.map(w => <Pill key={w.width} variant="choice" selected={width == w.width}
            onClick={() => this.setState({width: w.width})}>{w.label} · {w.width}px</Pill>)}
        </div>
      </div>
    </form>
  }

  renderCards() {
    let {pieceId, source, engines, loadError, loadMs, cards, width, activeId} = this.state
    if (!pieceId) { return null }

    if (source === null) {
      return <p className={styles.notice} role="status" data-missing-source>{MISSING_SOURCE_MESSAGE}</p>
    }

    if (loadError) {
      return <p className={styles.error} role="alert">The engines couldn't be loaded: {loadError}</p>
    }

    if (!engines || source === undefined) {
      return <p className={styles.notice}>Loading the engines…</p>
    }

    return <div className={styles.cards}>
      <p className={styles.hint}>Engines loaded in {Math.round(loadMs)} ms; each card's time is its drawing alone.</p>
      {engines.map(engine => {
        let card = cards[engine.key] || {}
        return <EngineCard
          key={engine.key}
          engine={engine}
          result={card.result}
          error={card.error}
          renderMs={card.renderMs}
          width={width}
          activeId={activeId}
          onActivate={(id, click) => this.activate(id, click)} />
      })}
    </div>
  }
}

// the route's page, opened on the piece, measures, hand and width in its query
export default function ScoreEnginesRoute(props) {
  let [params] = useSearchParams()
  let initial = {
    piece: params.get("piece") || undefined,
    from: readMeasure(params.get("from")) ?? undefined,
    to: readMeasure(params.get("to")) ?? undefined,
    hand: params.get("hand") || undefined,
    width: readMeasure(params.get("width")) ?? undefined,
  }
  return <ScoreEnginesPage initial={initial} {...props} />
}
