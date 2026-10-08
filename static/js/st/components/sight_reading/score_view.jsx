// The score-first sheet music page at rest (plan §B/D1-D7, D11): the
// piece's own engraved score, one page at a time, shaded by learnedness,
// this session's marks or the score's difficulty, beside the setup pane
// always on the right. Clicking a bar opens its stats in a pop-up anchored
// to it; a difficulty tag opens the passage pane. Rendered by
// SightReadingPage in place of its own title/grid/rail while
// state.view == "score" (programme.ScoreView).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill, TitleBlock} from "st/components/salon"
import {ScoreSheet} from "st/components/score_sheet"
import {SetupPane} from "st/components/sight_reading/setup_pane"
import {BarPopup, POPUP_WIDTH} from "st/components/sight_reading/bar_popup"
import {PassagePane} from "st/components/sight_reading/passage_pane"
import {ReviewPane} from "st/components/sight_reading/review_pane"
import {barPopup} from "st/bar_stats"
import {learnedness, sessionMarks, endedSummary} from "st/bar_progress"
import {itemId} from "st/srs/records"
import {itemHand as settingsItemHand} from "st/data"
import {measureNumberList, measureNumberRange} from "st/song_sections"
import {pageOfBar} from "st/score_render/score_pages"
import {keyLabel} from "st/components/sight_reading/settings_panel"
import {pieceSong, ensureAnnotation} from "st/sheet_music_deck"
import {sheetMusicPiece} from "st/data"
import {getAppStore} from "st/storage"
import {flagsInForce} from "st/difficulty/records"
import {heat as heatLevel} from "st/difficulty/sections"
import {LEVEL_WORDS} from "st/difficulty/index"
import {romanNumeral} from "st/music"

import styles from "./score_view.module.css"

export const MISSING_ENGINE_SOURCE = "Shown as a grid of bars: this piece was imported before the " +
  "app kept each piece's score. Import its file again (its stats are kept) to see the engraved score."
export const FAILED_ENGINE_SOURCE = "Shown as a grid of bars: this piece's score couldn't be " +
  "engraved. Importing its file again may bring it back."

// the score column with nothing to engrave: no piece picked, or the piece
// select's first option, pasted song notation, which has no score at all
export const NO_PIECE_SCORE = "Import a MusicXML file in Tonight's session to see its score here."
export const PASTED_NOTATION_SCORE = "Pasted notation has no engraved score; it is drawn on the " +
  "trainer's staff once you begin."

const SHADES = [
  {value: "session", label: "This session"},
  {value: "learnedness", label: "Learnedness"},
  {value: "difficulty", label: "Score difficulty"},
  {value: "off", label: "Off"},
]

// a flag (st/difficulty/records.flagsInForce) covering measure, directly or
// at one of its alsoAt recurrences
function inFlag(flag, measure) {
  return (measure >= flag.start && measure <= flag.end) ||
    (flag.alsoAt || []).some(([from, to]) => measure >= from && measure <= to)
}

export class ScoreView extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    generator: types.object,
    currentStaff: types.object,
    // the key the trainer draws the piece in (D2's eyebrow)
    keySignature: types.object.isRequired,
    staves: types.array,
    setStaff: types.func,
    acoustic: types.bool,
    mode: types.oneOf(["wait", "scroll"]),
    setMode: types.func,
    scrollSpeed: types.number,
    setScrollSpeed: types.func,
    tempo: types.bool,
    setTempo: types.func,
    begin: types.func.isRequired,
    ended: types.object,
    onPlayOn: types.func.isRequired,
    onDone: types.func.isRequired,
    engine: types.string,
    loadEngines: types.func,
    viewportHeight: types.number,
    store: types.object,
    now: types.func,
  }

  static defaultProps = {
    now: Date.now,
  }

  constructor(props) {
    super(props)
    this.state = {
      // the page remounts fresh on every return from the session (see
      // render()'s inScoreView ternary on SightReadingPage), so an ended
      // strip already in props at mount must start the shade on it too,
      // not just componentDidUpdate's later transitions
      shade: props.ended ? "session" : "learnedness",
      page: 0,
      pages: [],
      selectedBar: null,
      passageFlagId: null,
      passagePaneOpen: false,
      engineFailed: false,
      reviewOpen: false,
      reviewFlagId: null,
    }
  }

  componentDidMount() {
    this.ensure()
  }

  componentDidUpdate(prevProps) {
    let piece = sheetMusicPiece(this.props.settings)
    let prevPiece = sheetMusicPiece(prevProps.settings)
    if ((piece && piece.id) != (prevPiece && prevPiece.id)) {
      this.setState({selectedBar: null, page: 0, engineFailed: false})
      this.ensure()
    }

    if (prevProps.ended != this.props.ended) {
      this.setState({shade: this.props.ended ? "session" : "learnedness"})
    }
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  ensure() {
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return }

    let source = this.engineSource()
    let own = source && source.status == "ready" && source.musicXML
    ensureAnnotation(piece.id, this.getStore(), {source: own || undefined}).then(() => {
      if (!this.unmounted) { this.forceUpdate() }
    })
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  engineSource() {
    // the trainer keeps this on its own state; the score view reads it
    // through a thin prop the page forwards (see ScoreView's caller)
    return this.props.source
  }

  setupHand() {
    return settingsItemHand(this.props.settings.hand)
  }

  selectBar(measure) {
    this.setState({selectedBar: measure, passagePaneOpen: false})
  }

  closeBar() {
    this.setState({selectedBar: null})
  }

  openPassage(flagId) {
    this.setState({passagePaneOpen: true, passageFlagId: flagId, selectedBar: null})
  }

  closePassage() {
    this.setState({passagePaneOpen: false})
  }

  // the page's one review pane, opened either bare from the difficulty
  // legend or on a flag from the passage pane's Edit
  openReview(flagId) {
    this.setState({reviewOpen: true, reviewFlagId: flagId || null})
  }

  closeReview() {
    this.setState({reviewOpen: false})
  }

  practiseBar(measure) {
    this.setState({selectedBar: null})
    this.props.setSettings({
      ...this.props.settings,
      practice: "free practice",
      startMeasure: measure,
      endMeasure: measure,
      measuresPerCard: "all",
    })
    this.props.begin()
  }

  // the per-bar decoration for the active shade: tint, label, a difficulty
  // tag, and the free-practice section's gilt top border
  decorationsFor(song, flags) {
    let {settings} = this.props
    let decorations = new Map()
    let numbers = measureNumberList(song)

    if (this.state.shade == "learnedness") {
      let items = this.getStore().items(sheetMusicPiece(settings).id)
      let hand = this.setupHand()
      for (let measure of numbers) {
        let item = items.find(i => i.id == itemId({pieceId: sheetMusicPiece(settings).id, hand, startMeasure: measure, endMeasure: measure}))
        let learned = learnedness(item)
        if (!learned.played) { continue }
        decorations.set(measure, {
          tint: `learn-${learned.count}`,
          label: learned.count >= 3 ? "Learned" : `${learned.count} of 3`,
          labelVariant: learned.count >= 3 ? "learned" : null,
        })
      }
    } else if (this.state.shade == "session" && this.props.ended) {
      let marks = sessionMarks(this.props.ended.log)
      for (let [measure, mark] of marks) {
        decorations.set(measure, {tint: mark.tint, label: mark.label, labelVariant: mark.tint})
      }
    } else if (this.state.shade == "difficulty") {
      let record = this.getStore().annotation(sheetMusicPiece(settings).id)
      let heatPct = (record && record.runs && record.runs.score && record.runs.score.heat) || []
      numbers.forEach((measure, idx) => {
        let level = heatLevel(heatPct[idx] || 0)
        if (level > 0) { decorations.set(measure, {tint: `heat-${level}`}) }
      })

      for (let flag of flags) {
        let existing = decorations.get(flag.start) || {}
        decorations.set(flag.start, {
          ...existing,
          tag: {
            text: `${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level]} · ${flag.start == flag.end ? `bar ${flag.start}` : `bars ${flag.start}–${flag.end}`}`,
            level: flag.level,
            onClick: () => this.openPassage(flag.id),
          },
        })
      }
    }

    // free practice's section, marked in gilt, in every shade but difficulty
    if (this.state.shade != "difficulty" && this.props.settings.practice != "programme") {
      let {startMeasure, endMeasure} = this.props.settings
      for (let measure = startMeasure; measure <= endMeasure; measure++) {
        let existing = decorations.get(measure) || {}
        decorations.set(measure, {...existing, sectionBorder: true})
      }
    }

    return decorations
  }

  // "Page p of P · bars X–Y" (singular "bar X" for a one-bar page), the
  // current page's own printed bar range after its index/count
  pageLabel() {
    let {page, pages} = this.state
    let count = Math.max(1, pages.length)
    let current = pages[page]
    let label = `Page ${page + 1} of ${count}`
    if (!current || !current.measures.length) { return label }

    let first = current.measures[0].number
    let last = current.measures[current.measures.length - 1].number
    return `${label} · ${first == last ? `bar ${first}` : `bars ${first}–${last}`}`
  }

  renderToolbar(pageLabel) {
    return <div className={styles.toolbar}>
      <div className={styles.page_label}>{pageLabel}</div>
      <div className={styles.shade_group} role="group" aria-label="Shade bars by">
        <span className={styles.shade_caption}>Shade</span>
        {SHADES.filter(s => s.value != "session" || this.props.ended).map(s => <Pill
          key={s.value}
          variant="choice"
          className={styles.shade_pill}
          selected={this.state.shade == s.value}
          aria-pressed={this.state.shade == s.value}
          onClick={() => this.setState({shade: s.value})}>{s.label}</Pill>)}
      </div>
    </div>
  }

  renderLegend() {
    let {shade} = this.state
    let acoustic = this.props.acoustic

    if (shade == "off") { return null }

    if (shade == "learnedness") {
      return <div className={styles.legend}>
        <span className={styles.swatch} data-level="0" />Not played yet
        <span className={styles.swatch} data-level="1" />Started
        <span className={styles.swatch} data-level="2" />1 clean pass
        <span className={styles.swatch} data-level="3" />2 in a row
        <span className={styles.swatch} data-level="4" />
        {acoustic ? "Learned, 3 clean in a row" : "Learned, 3 in a row at 100%"}
      </div>
    }

    if (shade == "session") {
      return <div className={styles.legend}>
        {acoustic ? <>
          <span className={styles.swatch} data-tint="clean" />Clean every pass
          <span className={styles.swatch} data-tint="near" />Clean on 80% of passes or more
          <span className={styles.swatch} data-tint="trouble" />Clean on under 80% of passes
        </> : <>
          <span className={styles.swatch} data-tint="clean" />Clean, 100%
          <span className={styles.swatch} data-tint="near" />Nearly, 80% or more
          <span className={styles.swatch} data-tint="trouble" />Trouble, under 80%
        </>}
        <span className={styles.swatch} />Not played this session
      </div>
    }

    return <div className={styles.legend}>
      <span className={styles.swatch} />Easier
      <span className={styles.swatch} />
      <span className={styles.swatch} />Harder, from the score analysis
      <button type="button" className={styles.review_link} onClick={() => this.openReview(null)}>
        Review the passages
      </button>
    </div>
  }

  renderEndedStrip(summary) {
    return <div className={styles.ended_strip}>
      <div className={styles.ended_left}>
        <div className={styles.ended_eyebrow}>Session ended</div>
        <div className={styles.ended_headline}>
          {summary.headline}
          <span className={styles.ended_headline_unit}> {summary.headlineUnit}</span>
        </div>
      </div>
      <div className={styles.ended_middle}>
        {summary.comparison ? <p>{summary.comparison}</p> : null}
        <p>{summary.detail}</p>
      </div>
      <div className={styles.ended_actions}>
        <Pill variant="ghost" className={styles.ended_pill} onClick={this.props.onPlayOn}>Play on</Pill>
        <Pill variant="primary" className={styles.ended_pill} onClick={this.props.onDone}>Done</Pill>
      </div>
    </div>
  }

  renderBarGrid(numbers, decorations) {
    return <Plate className={styles.grid_plate}>
      <div className={styles.bar_grid}>
        {numbers.map(number => {
          let deco = decorations.get(number) || {}
          return <button
            key={number}
            type="button"
            className={classNames(styles.grid_cell, {[styles[`tint_${deco.tint}`]]: deco.tint})}
            onClick={() => this.selectBar(number)}>{number}</button>
        })}
      </div>
    </Plate>
  }

  // the title row and score column, while a piece with a song is picked;
  // null otherwise (render() shows the empty state instead). Kept out of
  // render() itself so the overall tree (and SetupPane/PassagePane/
  // ReviewPane's place in it) never changes shape as a piece is picked or
  // cleared: a piece becoming set must not remount SetupPane, or a message
  // it just set (e.g. "is in the deck") is lost with the old instance
  renderPiece(piece, song) {
    let {settings} = this.props
    let source = this.engineSource()
    let numbers = measureNumberList(song)
    let [fromMeasure, toMeasure] = measureNumberRange(song)
    let flags = flagsInForce(this.getStore().annotation(piece.id))
    let decorations = this.decorationsFor(song, flags)
    let ended = this.props.ended
    let summary = ended ? endedSummary({
      record: ended.record, log: ended.log, acoustic: this.props.acoustic,
      previous: this.getStore().recentSessions().filter(s =>
        s.settings && s.settings.piece == piece.id && s.startedAt < (ended.record ? ended.record.startedAt : Date.now()) &&
        (s.notesRead || s.misses)).sort((a, b) => b.startedAt - a.startedAt)[0],
    }) : null

    let noSource = !source || source.status == "missing"
    let failed = this.state.engineFailed
    let hasEngine = !!this.props.engine && source && source.status == "ready" && source.musicXML && !failed

    return <>
      <div className={styles.title_row}>
        <TitleBlock
          eyebrow={`Sheet music · ${numbers.length} ${numbers.length == 1 ? "bar" : "bars"} · ${
            this.props.currentStaff ? this.props.currentStaff.name : "grand"} staff · ${
            keyLabel(this.props.keySignature)} major`}
          title={piece.title}
          italic="the score" />
        <div className={styles.title_note}>Click any bar for its stats</div>
      </div>

      {ended && summary ? this.renderEndedStrip(summary) : null}

      <Plate className={styles.score_plate}>
        {this.renderToolbar(this.pageLabel())}

        {hasEngine ? <ScoreSheet
          musicXML={source.musicXML}
          measureStarts={source.measureStarts}
          fromMeasure={fromMeasure}
          toMeasure={toMeasure}
          engine={this.props.engine}
          loadEngines={this.props.loadEngines}
          viewportHeight={this.props.viewportHeight}
          page={this.state.page}
          onPages={pages => this.setState(state => {
            let shown = state.pages[state.page]
            let first = shown && shown.measures[0]
            return {
              pages,
              page: first ? pageOfBar(pages, first.number) :
                Math.max(0, Math.min(state.page, pages.length - 1)),
            }
          })}
          decorate={n => decorations.get(n) || {}}
          selected={this.state.selectedBar}
          onBar={n => this.selectBar(n)}
          onError={() => this.setState({engineFailed: true})}>
          {(overlays, boxWidth) => {
            if (this.state.selectedBar == null) { return null }
            let overlay = overlays.get(this.state.selectedBar)
            if (!overlay) { return null }

            let model = barPopup({
              pieceId: piece.id, measure: this.state.selectedBar, hand: this.setupHand(),
              items: this.getStore().items(piece.id), flags, now: this.props.now(),
            })

            let left = overlay.left + overlay.width / 2 < 50
            let above = overlay.systems > 1 && overlay.system == overlay.systems - 1
            // a box narrower than two pop-ups can't hold one anchored to a
            // bar, since the anchor sits at the bar's own edge and so as
            // far in as the box's middle: there (a phone) the pop-up spans
            // the box instead of hanging off one side of it
            let spans = boxWidth > 0 && boxWidth < POPUP_WIDTH * 2
            let style = {
              ...(spans ? {left: 0, right: 0, width: "auto"} :
                left ? {left: `${overlay.left}%`} : {right: `${100 - (overlay.left + overlay.width)}%`}),
              ...(above ? {bottom: `${100 - overlay.top}%`} : {top: `${overlay.top + overlay.height}%`}),
            }

            return <BarPopup
              model={model}
              style={style}
              onClose={() => this.closeBar()}
              onPractise={() => this.practiseBar(this.state.selectedBar)} />
          }}
        </ScoreSheet> : this.renderBarGrid(numbers, decorations)}

        {noSource || failed ? <p className={styles.fallback_note}>
          {failed ? FAILED_ENGINE_SOURCE : MISSING_ENGINE_SOURCE}
        </p> : null}

        {this.renderLegend()}

        {hasEngine ? <div className={styles.pager}>
          <Pill
            variant="ghost"
            className={styles.pager_pill}
            disabled={this.state.page <= 0}
            onClick={() => this.setState(state => ({page: Math.max(0, state.page - 1)}))}>
            ‹ Previous page
          </Pill>
          <span className={styles.pager_label}>{this.pageLabel()}</span>
          <Pill
            variant="ghost"
            className={styles.pager_pill}
            disabled={this.state.page >= this.state.pages.length - 1}
            onClick={() => this.setState(state => ({page: Math.min(state.pages.length - 1, state.page + 1)}))}>
            Next page ›
          </Pill>
        </div> : null}
      </Plate>

      <PassagePane
        open={this.state.passagePaneOpen}
        close={() => this.closePassage()}
        settings={settings}
        setSettings={this.props.setSettings}
        flagId={this.state.passageFlagId}
        openReview={flagId => this.openReview(flagId)}
        store={this.getStore()} />

      <ReviewPane
        settings={settings}
        setSettings={this.props.setSettings}
        source={source}
        engine={this.props.engine}
        loadEngines={this.props.loadEngines}
        store={this.getStore()}
        open={this.state.reviewOpen}
        close={() => this.closeReview()}
        initialFlagId={this.state.reviewFlagId} />
    </>
  }

  render() {
    let {settings} = this.props
    let piece = sheetMusicPiece(settings)
    let song = piece && pieceSong(piece)

    return <div className={styles.score_view}>
      {!piece || !song ?
        <TitleBlock eyebrow="Sheet music" title="Sheet music" italic="import a piece to begin" /> : null}

      <div className={styles.columns}>
        <div className={styles.score_column}>
          {piece && song ? this.renderPiece(piece, song) : <Plate>
            <p className={styles.empty_text}>
              {(settings.song || "").trim() ? PASTED_NOTATION_SCORE : NO_PIECE_SCORE}
            </p>
          </Plate>}
        </div>

        <SetupPane {...this.props} />
      </div>
    </div>
  }
}

export default ScoreView
