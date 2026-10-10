// The score-first score page at rest (score-first design §D1-D7, D11): the
// piece's own engraved score, one page of whole systems at a time, shaded
// by learnedness, the session just played, or the score's own difficulty,
// beside "Tonight's session" (st/components/sight_reading/setup_pane),
// always on the right. Clicking a bar opens its stats
// (st/components/sight_reading/bar_popup) anchored to it. Renders in place
// of the trainer's own grid while SightReadingPage's state.view == "score"
// (programme.ScoreView, see score_page.jsx's SCORE_PROGRAMME).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import {ScoreSheet} from "st/components/score_sheet"
import {SetupPane} from "st/components/sight_reading/setup_pane"
import {BarPopup} from "st/components/sight_reading/bar_popup"
import {PassagePane} from "st/components/sight_reading/passage_pane"
import {ReviewPane} from "st/components/sight_reading/review_pane"
import {keyLabel} from "st/components/sight_reading/settings_panel"
import {romanNumeral, barsLabel} from "st/music"
import {measureNumberList, measureNumberRange} from "st/song_sections"
import {pieceSong, ensureAnnotation} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {flagsInForce} from "st/difficulty/records"
import {heat as heatLevel} from "st/difficulty/sections"
import {LEVEL_WORDS} from "st/difficulty/index"
import {learnedness, sessionMarks, endedSummary} from "st/bar_progress"
import {sheetMusicPiece, itemHand, plannedPractice, passageSettings} from "st/data"

import styles from "./score_view.module.css"

export const SCORE_VIEW_NO_SOURCE = "Shown as a grid of bars: this piece was imported before the app " +
  "kept each piece's score. Import its file again (its stats are kept) to see the engraved score."

export const SCORE_VIEW_FAILED = "Shown as a grid of bars: this piece's score couldn't be engraved. " +
  "Importing its file again may bring it back."

const LEARN_BG = ["var(--salon-learn-0)", "var(--salon-learn-1)", "var(--salon-learn-2)", "var(--salon-learn-3)"]
const LEARN_EDGE = ["var(--salon-rule)", "var(--salon-rule-strong)", "var(--salon-gilt-mid)", "var(--salon-gilt-deep)"]
const HEAT_BG = [
  "transparent", "var(--salon-heat-tint-1)", "var(--salon-heat-tint-2)", "var(--salon-heat-tint-3)",
  "var(--salon-heat-tint-4)",
]
const MARK_BG = {clean: "var(--salon-mark-clean)", near: "var(--salon-mark-near)", trouble: "var(--salon-mark-trouble)"}

const plural = (count, word) => `${count} ${word}${count == 1 ? "" : "s"}`

export class ScoreView extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    staff: types.object,
    keySignature: types.object,
    generator: types.object,
    source: types.object,
    engine: types.string,
    loadEngines: types.func,
    store: types.object,
    pickPiece: types.func,
    mode: types.oneOf(["wait", "scroll"]),
    setMode: types.func.isRequired,
    scrollSpeed: types.number.isRequired,
    setScrollSpeed: types.func.isRequired,
    tempo: types.bool,
    setTempo: types.func.isRequired,
    acoustic: types.bool,
    // the record of the session just ended, or null at rest; see
    // SightReadingPage#endSession and NoteStats#sessionRecord
    ended: types.object,
    sessionLog: types.array,
    idleTitle: types.object,
    viewportHeight: types.number,
    onBegin: types.func.isRequired,
    onPlayOn: types.func.isRequired,
    onDismissEnded: types.func.isRequired,
    // skips the programme's read-through, see SightReadingPage#skipReadThrough
    onSkipReadThrough: types.func,
  }

  static defaultProps = {
    sessionLog: [],
  }

  constructor(props) {
    super(props)
    this.state = {
      // the trainer's view and ScoreView remount together (they are
      // structurally different trees), so a fresh mount after End session
      // must start on "session" directly; componentDidUpdate's own
      // transition watch only catches a later Done/Play on/Begin within
      // the same mount
      shade: props.ended ? "session" : "practice",
      page: 0,
      pages: [],
      selectedBar: null,
      scoreFailed: false,
      passageOpen: false,
      passageFlagId: null,
      reviewOpen: false,
      reviewFlagId: null,
    }
  }

  componentDidMount() {
    this.ensureAnnotation()
  }

  componentDidUpdate(prevProps) {
    let piece = sheetMusicPiece(this.props.settings)
    let prevPiece = sheetMusicPiece(prevProps.settings)
    if ((piece && piece.id) != (prevPiece && prevPiece.id)) {
      this.setState({page: 0, pages: [], selectedBar: null, scoreFailed: false})
      this.ensureAnnotation()
    }

    if (!prevProps.ended && this.props.ended) {
      this.setState({shade: "session"})
    } else if (prevProps.ended && !this.props.ended) {
      this.setState({shade: "practice"})
    }
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  ensureAnnotation() {
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return }

    let source = this.props.source
    let own = source && source.piece && source.piece.id == piece.id && source.status == "ready" && source.musicXML

    ensureAnnotation(piece.id, this.getStore(), {source: own || undefined}).then(() => {
      if (!this.unmounted) { this.forceUpdate() }
    })
  }

  setShade(shade) {
    this.setState({shade})
  }

  setPage(page) {
    this.setState({page, selectedBar: null})
  }

  selectBar(measure) {
    this.setState(state => ({selectedBar: state.selectedBar == measure ? null : measure}))
  }

  practiseBar(measure) {
    this.props.setSettings(passageSettings(this.props.settings, {start: measure, end: measure}))
    this.setState({selectedBar: null})
    this.props.onBegin()
  }

  openPassageAt(measure) {
    let store = this.getStore()
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return }

    let flags = flagsInForce(store.annotation(piece.id))
    let flag = flags.find(f => measure >= f.start && measure <= f.end ||
      (f.alsoAt || []).some(([from, to]) => measure >= from && measure <= to))
    if (flag) { this.setState({passageOpen: true, passageFlagId: flag.id}) }
  }

  openReview(id) {
    this.setState({reviewOpen: true, passageOpen: false, reviewFlagId: id || null})
  }

  // a bar's tint, top border and label under the active shade (score-first
  // design §C2/§C3, build notes 2 and 5), plus the difficulty tags and the
  // free-practice section tag
  buildBarInfo(piece, song) {
    let {settings} = this.props
    let store = this.getStore()
    let hand = itemHand(settings.hand)
    let measures = measureNumberList(song)
    let byMeasure = new Map()
    for (let item of store.items(piece.id)) {
      if (item.hand == hand && item.startMeasure == item.endMeasure && !item.beats) {
        byMeasure.set(item.startMeasure, item)
      }
    }

    let barInfo = new Map()
    let labels = new Map()
    let tags = []
    let record = store.annotation(piece.id)
    let flags = flagsInForce(record)

    if (this.state.shade == "practice") {
      for (let measure of measures) {
        let learned = learnedness(byMeasure.get(measure) || null)
        if (learned == null) { continue }
        barInfo.set(measure, {fill: LEARN_BG[learned]})
        labels.set(measure, {
          text: learned == 3 ? "Learned" : `${learned} of 3`,
          className: classNames(styles.label, {[styles.label_learned]: learned == 3}),
        })
      }
    } else if (this.state.shade == "difficulty") {
      let heatPct = (record && record.runs && record.runs.score && record.runs.score.heat) || []
      measures.forEach((measure, idx) => {
        let level = heatLevel(heatPct[idx] || 0)
        if (level) { barInfo.set(measure, {fill: HEAT_BG[level]}) }
      })
      for (let flag of flags) {
        tags.push({
          measure: flag.start,
          text: `${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level]} · ${barsLabel(flag.start, flag.end)}`,
          className: flag.level == 3 ? styles.tag_oxblood : flag.level == 2 ? styles.tag_gilt : styles.tag_muted,
        })
      }
    } else if (this.state.shade == "session") {
      for (let [measure, mark] of sessionMarks(this.props.sessionLog)) {
        barInfo.set(measure, {fill: MARK_BG[mark.kind]})
        labels.set(measure, {text: mark.label, className: classNames(styles.label, styles[`label_${mark.kind}`])})
      }
    }

    // tonight's study: the passage being learned outlined in oxblood, with a
    // tag at its first bar, and each passage that flows in gilt (under the
    // shades that leave the top border free)
    let study = plannedPractice(settings, store) && this.props.generator && this.props.generator.study ?
      this.props.generator.study() : null
    if (study && ["practice", "off"].includes(this.state.shade)) {
      let outline = (bars, color) => {
        for (let measure of bars) {
          barInfo.set(measure, {...(barInfo.get(measure) || {}), topBorder: color})
        }
      }

      for (let {start, end, flowed} of study.path) {
        if (flowed) { outline(measures.filter(measure => measure >= start && measure <= end), "var(--salon-gilt)") }
      }

      if (study.passage && !study.learned) {
        let {bars} = study.passage
        outline(bars, "var(--salon-oxblood)")
        tags.push({
          measure: bars[0],
          text: `Tonight's study · ${barsLabel(bars[0], bars[bars.length - 1])}`,
          className: styles.tag_oxblood,
        })
      }
    }

    if (!plannedPractice(settings, store) && this.state.shade != "difficulty") {
      let {startMeasure, endMeasure} = settings
      for (let measure of measures) {
        if (measure >= startMeasure && measure <= endMeasure) {
          barInfo.set(measure, {...(barInfo.get(measure) || {}), topBorder: "var(--salon-gilt)"})
        }
      }
      if (measures.includes(startMeasure)) {
        tags.push({measure: startMeasure, text: `Section · bars ${startMeasure}–${endMeasure}`, className: styles.tag_section})
      }
    }

    return {barInfo, labels, tags}
  }

  renderTitle(piece, song) {
    let measures = measureNumberList(song)
    let staffName = this.props.staff ? this.props.staff.name : "grand"
    let keyName = this.props.keySignature ? keyLabel(this.props.keySignature) : "C"

    return <div className={styles.title_row}>
      <div className={styles.title_block}>
        <div className={styles.eyebrow}>
          {`Sheet music · ${plural(measures.length, "bar")} · ${staffName} staff · ${keyName} major`}
        </div>
        <h1 className={styles.heading}>{piece.title} <span className={styles.heading_italic}>the score</span></h1>
      </div>
      <div className={styles.title_note}>Click any bar for its stats</div>
    </div>
  }

  renderEndedStrip(piece) {
    let store = this.getStore()
    let summary = endedSummary({
      record: this.props.ended, pieceId: piece.id, sessions: store.recentSessions(), log: this.props.sessionLog,
    })

    return <div className={styles.ended_strip}>
      <div className={styles.ended_left}>
        <div className={styles.ended_eyebrow}>Session ended</div>
        <div className={styles.ended_headline}>
          {summary.headline} <span className={styles.ended_headline_italic}>{summary.headlineItalic}</span>
        </div>
      </div>
      <div className={styles.ended_detail}>
        {summary.comparison && <span>{summary.comparison}<br /></span>}
        {summary.detail}
      </div>
      <div className={styles.ended_actions}>
        <Pill variant="ghost" onClick={this.props.onPlayOn}>Play on</Pill>
        <Pill variant="primary" onClick={this.props.onDismissEnded}>Done</Pill>
      </div>
    </div>
  }

  pageBarsLabel(page) {
    if (!page || !page.measures.length) { return "" }
    let numbers = page.measures.map(m => m.number)
    let first = numbers[0]
    let last = numbers[numbers.length - 1]
    return first == last ? `bar ${first}` : `bars ${first}–${last}`
  }

  renderToolbar(pages, ready) {
    let page = pages[this.state.page]

    return <div className={styles.toolbar}>
      <span className={styles.page_label}>
        {ready && page ? `Page ${this.state.page + 1} of ${pages.length} · ${this.pageBarsLabel(page)}` : ""}
      </span>
      <div className={styles.shade_group} role="group" aria-label="Shade bars by">
        <span className={styles.shade_label}>Shade</span>
        {this.props.ended && <Pill
          variant="choice"
          className={styles.shade_pill}
          selected={this.state.shade == "session"}
          onClick={() => this.setShade("session")}>This session</Pill>}
        <Pill variant="choice" className={styles.shade_pill} selected={this.state.shade == "practice"}
          onClick={() => this.setShade("practice")}>Learnedness</Pill>
        <Pill variant="choice" className={styles.shade_pill} selected={this.state.shade == "difficulty"}
          onClick={() => this.setShade("difficulty")}>Score difficulty</Pill>
        <Pill variant="choice" className={styles.shade_pill} selected={this.state.shade == "off"}
          onClick={() => this.setShade("off")}>Off</Pill>
      </div>
    </div>
  }

  renderLegend() {
    let {shade} = this.state
    let acoustic = this.props.acoustic
    if (shade == "off") { return null }

    if (shade == "difficulty") {
      return <div className={styles.legend}>
        <span>
          Each cell is a bar. Easier
          <span className={styles.ramp} aria-hidden="true">
            {HEAT_BG.slice(1).map((bg, idx) => <i key={idx} style={{background: bg}} />)}
          </span>
          harder, from the score analysis.
        </span>
        <button type="button" className={styles.review_link} onClick={() => this.openReview()}>
          Review the passages
        </button>
      </div>
    }

    let items = shade == "session" ? (acoustic ? [
      ["clean", "Clean every pass"], ["near", "Clean on 80% of passes or more"],
      ["trouble", "Clean on under 80% of passes"], [null, "Not played this session"],
    ] : [
      ["clean", "Clean, 100%"], ["near", "Nearly, 80% or more"],
      ["trouble", "Trouble, under 80%"], [null, "Not played this session"],
    ]) : [
      [null, "Not played yet"], ["learn0", "Started"], ["learn1", "1 clean pass"], ["learn2", "2 in a row"],
      ["learn3", acoustic ? "Learned, 3 clean in a row" : "Learned, 3 in a row at 100%"],
    ]

    let swatch = key => {
      if (key == null) { return {background: "var(--salon-paper)", borderColor: "var(--salon-rule-light)"} }
      if (key.startsWith("learn")) {
        let level = +key.slice(5)
        return {background: LEARN_BG[level], borderColor: LEARN_EDGE[level]}
      }
      return {background: MARK_BG[key], borderColor: "var(--salon-rule-strong)"}
    }

    return <div className={styles.legend}>
      {items.map(([key, label], idx) =>
        <span key={idx} className={styles.legend_item}>
          <span className={styles.swatch} style={swatch(key)} />{label}
        </span>)}
    </div>
  }

  renderPager(pages) {
    let page = this.state.page

    return <div className={styles.pager}>
      <Pill
        variant="ghost"
        className={styles.pager_pill}
        disabled={page <= 0}
        onClick={() => this.setPage(page - 1)}>‹ Previous page</Pill>
      <span className={styles.pager_label}>Page <span className={styles.pager_num}>{page + 1}</span> of {pages.length || 1}</span>
      <Pill
        variant="ghost"
        className={styles.pager_pill}
        disabled={page >= pages.length - 1}
        onClick={() => this.setPage(page + 1)}>Next page ›</Pill>
    </div>
  }

  renderBarPopup(piece, style) {
    let measure = this.state.selectedBar
    if (measure == null) { return null }

    let store = this.getStore()
    let hand = itemHand(this.props.settings.hand)

    return <BarPopup
      pieceId={piece.id}
      measure={measure}
      hand={hand}
      items={store.items(piece.id)}
      flags={flagsInForce(store.annotation(piece.id))}
      style={style}
      onClose={() => this.setState({selectedBar: null})}
      onPractise={() => this.practiseBar(measure)} />
  }

  renderGrid(piece, song) {
    let measures = measureNumberList(song)
    let {barInfo, labels} = this.buildBarInfo(piece, song)

    return <div className={styles.grid}>
      {measures.map(measure => {
        let info = barInfo.get(measure) || {}
        let label = labels.get(measure)
        let selected = this.state.selectedBar == measure

        return <div key={measure} className={styles.grid_cell_wrap}>
          <button
            type="button"
            aria-label={`Bar ${measure}`}
            aria-pressed={selected}
            className={classNames(styles.grid_cell, {[styles.selected]: selected})}
            style={{
              background: selected ? undefined : info.fill,
              ...(info.topBorder ? {borderTopWidth: "4px", borderTopStyle: "solid", borderTopColor: info.topBorder} : {}),
            }}
            onClick={() => this.selectBar(measure)}>
            {measure}
          </button>
          {label && <span className={label.className}>{label.text}</span>}
          {selected && this.renderBarPopup(piece, {top: "100%", left: 0})}
        </div>
      })}
    </div>
  }

  renderScorePlate(piece, song) {
    let source = this.props.source
    let loading = !!(source && source.status == "loading")
    let failed = this.state.scoreFailed || (source && source.status == "failed")
    let ready = !!(source && source.status == "ready" && source.musicXML) && !this.state.scoreFailed
    let pages = this.state.pages
    let [fromMeasure, toMeasure] = measureNumberRange(song)

    return <Plate className={styles.score_plate}>
      {this.renderToolbar(pages, ready)}
      <div className={classNames(styles.page_wrap, {[styles.loading]: loading})} aria-busy={loading}>
        {loading ? null : ready ? <ScoreSheet
          musicXML={source.musicXML}
          measureStarts={source.measureStarts}
          fromMeasure={fromMeasure}
          toMeasure={toMeasure}
          engine={this.props.engine}
          loadEngines={this.props.loadEngines}
          viewportHeight={this.props.viewportHeight}
          page={this.state.page}
          onPages={pages => this.setState(state => ({pages, page: Math.min(state.page, Math.max(0, pages.length - 1))}))}
          {...this.buildBarInfo(piece, song)}
          selected={this.state.selectedBar}
          onBar={measure => this.selectBar(measure)}
          onTag={measure => this.openPassageAt(measure)}
          renderPopup={style => this.renderBarPopup(piece, style)}
          onError={() => this.setState({scoreFailed: true})} /> : this.renderGrid(piece, song)}
      </div>
      {this.renderLegend()}
      {ready && this.renderPager(pages)}
      {!loading && !ready &&
        <p className={styles.engine_note}>{failed ? SCORE_VIEW_FAILED : SCORE_VIEW_NO_SOURCE}</p>}
    </Plate>
  }

  renderSetupPane() {
    return <SetupPane
      settings={this.props.settings}
      setSettings={this.props.setSettings}
      staff={this.props.staff}
      store={this.getStore()}
      generator={this.props.generator}
      pickPiece={this.props.pickPiece}
      mode={this.props.mode}
      setMode={this.props.setMode}
      scrollSpeed={this.props.scrollSpeed}
      setScrollSpeed={this.props.setScrollSpeed}
      tempo={this.props.tempo}
      setTempo={this.props.setTempo}
      acoustic={this.props.acoustic}
      onBegin={this.props.onBegin}
      onSkipReadThrough={this.props.onSkipReadThrough} />
  }

  renderPassagePane(piece) {
    let flags = flagsInForce(this.getStore().annotation(piece.id))

    return <PassagePane
      flags={flags}
      initialFlagId={this.state.passageFlagId}
      settings={this.props.settings}
      setSettings={this.props.setSettings}
      onBegin={this.props.onBegin}
      onEdit={id => this.openReview(id)}
      open={this.state.passageOpen}
      close={() => this.setState({passageOpen: false})} />
  }

  renderReviewPane() {
    return <ReviewPane
      settings={this.props.settings}
      setSettings={this.props.setSettings}
      source={this.props.source}
      engine={this.props.engine}
      loadEngines={this.props.loadEngines}
      store={this.getStore()}
      open={this.state.reviewOpen}
      close={() => this.setState({reviewOpen: false})}
      initialFlagId={this.state.reviewFlagId} />
  }

  // no piece picked: the empty state (D11), or pasted notation (open
  // question 4d) once it has content, which plays but is never engraved
  renderNoPiece() {
    let hasSong = !!(this.props.settings.song && this.props.settings.song.trim())
    let {title, italic} = hasSong ?
      {title: "Pasted song notation", italic: null} :
      (this.props.idleTitle || {title: "Sheet music", italic: "import a piece to begin"})
    let message = hasSong ?
      "Pasted notation has no engraved score; it is drawn on the trainer's staff once you begin." :
      "Import a MusicXML file in Tonight's session to see its score here."

    return <React.Fragment>
      <div className={styles.title_row}>
        <div className={styles.title_block}>
          <h1 className={styles.heading}>
            {title}{italic ? <> <span className={styles.heading_italic}>{italic}</span></> : null}
          </h1>
        </div>
      </div>
      <div className={styles.columns}>
        <section className={styles.score_column} aria-label="The score">
          <Plate>{message}</Plate>
        </section>
        <aside className={styles.setup_column}>{this.renderSetupPane()}</aside>
      </div>
    </React.Fragment>
  }

  render() {
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return this.renderNoPiece() }

    let song = pieceSong(piece)
    if (!song) { return this.renderNoPiece() }

    return <React.Fragment>
      {this.renderTitle(piece, song)}
      <div className={styles.columns}>
        <section className={styles.score_column} aria-label="The score">
          {this.props.ended && this.renderEndedStrip(piece)}
          {this.renderScorePlate(piece, song)}
        </section>
        <aside className={styles.setup_column}>{this.renderSetupPane()}</aside>
      </div>
      {this.renderPassagePane(piece)}
      {this.renderReviewPane()}
    </React.Fragment>
  }
}

export default ScoreView
