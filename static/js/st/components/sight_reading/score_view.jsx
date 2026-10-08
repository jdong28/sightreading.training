// The score-first sheet music page's at-rest view (D1-D7, D11): the piece's
// engraved score, paginated, shaded by learnedness/difficulty/the last
// session, with a bar pop-up on click, beside the "Tonight's session" setup
// pane always on the right. Rendered by SightReadingPage in place of its
// own grid while state.view == "score" (see SCORE_PROGRAMME.ScoreView).

import * as React from "react"
import * as types from "prop-types"

import {Plate, Pill, TitleBlock} from "st/components/salon"
import {ScoreSheet} from "st/components/score_sheet"
import {BarPopup} from "st/components/sight_reading/bar_popup"
import {SetupPane} from "st/components/sight_reading/setup_pane"
import {PassagePane} from "st/components/sight_reading/passage_pane"
import {ReviewPane} from "st/components/sight_reading/review_pane"
import {learnedness, learnedCount, sessionMarks, TROUBLE_BELOW} from "st/bar_progress"
import {itemId} from "st/srs/records"
import {heat as heatLevel} from "st/difficulty/sections"
import {flagsInForce} from "st/difficulty/records"
import {ensureAnnotation, pieceSong} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {measureNumberList} from "st/song_sections"
import {romanNumeral, barsLabel} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"
import {sheetMusicPiece, passageSettings, itemHand, FREE_PRACTICE} from "st/data"

import styles from "./score_view.module.css"

export const SCORE_VIEW_NO_SOURCE = "Shown as a grid of bars: this piece was imported before the " +
  "app kept each piece's score. Import its file again (its stats are kept) to see the engraved score."
export const SCORE_VIEW_FAILED = "Shown as a grid of bars: this piece's score couldn't be engraved. " +
  "Importing its file again may bring it back."

const SHADES = [
  {value: "session", label: "This session"},
  {value: "learnedness", label: "Learnedness"},
  {value: "difficulty", label: "Score difficulty"},
  {value: "off", label: "Off"},
]

export class ScoreView extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    liveGenerator: types.object,
    generator: types.object,
    currentStaff: types.object,
    staves: types.array,
    keySignature: types.object,
    mode: types.oneOf(["wait", "scroll"]),
    setMode: types.func,
    scrollSpeed: types.number,
    setScrollSpeed: types.func,
    tempo: types.bool,
    setTempo: types.func,
    source: types.object,
    engine: types.string,
    loadEngines: types.func,
    acoustic: types.bool,
    ended: types.object,
    sessionLog: types.array,
    begin: types.func.isRequired,
    playOn: types.func.isRequired,
    dismissEnded: types.func.isRequired,
    pickPiece: types.func,
    viewportHeight: types.number,
    store: types.object,
    now: types.func,
  }

  static defaultProps = {
    now: Date.now,
    sessionLog: [],
  }

  constructor(props) {
    super(props)
    this.state = {
      selectedBar: null, page: 0, pageCount: 1, shade: "learnedness", sheetFailed: false,
      passageOpen: false, passageSelectedId: null, reviewOpen: false, reviewFlagId: null,
    }
  }

  componentDidMount() {
    this.ensureAnnotation()
  }

  componentDidUpdate(prevProps) {
    let piece = sheetMusicPiece(this.props.settings)
    let prevPiece = sheetMusicPiece(prevProps.settings)
    if ((piece && piece.id) != (prevPiece && prevPiece.id)) {
      this.setState({selectedBar: null, page: 0, sheetFailed: false})
      this.ensureAnnotation()
    }

    if (prevProps.ended != this.props.ended && this.props.ended) {
      this.setState({shade: "session"})
    } else if (prevProps.ended && !this.props.ended) {
      this.setState({shade: "learnedness"})
    }
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

  componentWillUnmount() {
    this.unmounted = true
  }

  piece() {
    return sheetMusicPiece(this.props.settings)
  }

  song() {
    let piece = this.piece()
    return piece && pieceSong(piece)
  }

  measures() {
    let song = this.song()
    return song ? measureNumberList(song) : []
  }

  openBar = number => this.setState({selectedBar: number})
  closeBar = () => this.setState({selectedBar: null})
  setShade = shade => this.setState({shade})
  setPage = page => this.setState({page})

  practiseBar = number => {
    this.props.setSettings(passageSettings(this.props.settings, {start: number, end: number}))
    this.setState({selectedBar: null})
    this.props.begin()
  }

  openPassage = id => this.setState({passageOpen: true, passageSelectedId: id})
  closePassage = () => this.setState({passageOpen: false})
  selectPassage = id => this.setState({passageSelectedId: id})

  // Practise and the hand pill begin the session at once, like the bar
  // pop-up's own Practise button (Open question 4a)
  practisePassage = flag => {
    this.props.setSettings(passageSettings(this.props.settings, flag))
    this.setState({passageOpen: false})
    this.props.begin()
  }

  practisePassageHand = flag => {
    // a passage to practise hands separately offers the right hand first
    let hand = flag.hand == "both" ? "upper" : flag.hand
    this.props.setSettings(passageSettings(this.props.settings, flag, hand))
    this.setState({passageOpen: false})
    this.props.begin()
  }

  editPassage = id => this.setState({passageOpen: false, reviewOpen: true, reviewFlagId: id})
  openReview = () => this.setState({reviewOpen: true, reviewFlagId: null})
  closeReview = () => this.setState({reviewOpen: false, reviewFlagId: null})

  flagsInForce() {
    let piece = this.piece()
    let annotation = piece && this.getStore().annotation(piece.id)
    return annotation ? flagsInForce(annotation) : []
  }

  // the difficulty tag or free-practice section tag at a bar position,
  // keyed by measure index, for ScoreSheet's tagsByIndex (D4): a passage tag
  // per flag in force in Score difficulty, else, in free practice, the
  // section's own tag in any other shade (Off included)
  tagsByIndex(numbers) {
    let {shade} = this.state
    let settings = this.props.settings
    let tags = {}

    if (shade == "difficulty") {
      for (let flag of this.flagsInForce()) {
        let idx = numbers.indexOf(flag.start)
        if (idx == -1) { continue }
        tags[idx] = {
          text: `${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level]} · ${barsLabel(flag.start, flag.end)}`,
          tone: `level-${flag.level}`,
          onClick: () => this.openPassage(flag.id),
        }
      }
    } else if (settings.practice == FREE_PRACTICE) {
      let idx = numbers.indexOf(settings.startMeasure)
      if (idx != -1) {
        tags[idx] = {text: `Section · ${barsLabel(settings.startMeasure, settings.endMeasure)}`, tone: "section"}
      }
    }

    return tags
  }

  // the overlay fill/label for every drawn bar position, keyed by measure
  // index, for the active shade (D4/C2/C3)
  overlaysByIndex(song) {
    let {shade} = this.state
    if (shade == "off" || !song) { return {} }

    let hand = this.props.settings.hand || "both hands"
    let items = this.getStore().items(this.piece().id)
    let pieceId = this.piece().id
    let numbers = measureNumberList(song)

    let marks = shade == "session" ? sessionMarks(this.props.sessionLog) : null
    let record = shade == "difficulty" ? this.getStore().annotation(pieceId) : null
    let heatPct = (record && record.runs && record.runs.score && record.runs.score.heat) || []

    let byIndex = {}
    numbers.forEach((number, idx) => {
      if (shade == "learnedness") {
        let item = items.find(i => i.id == itemId({pieceId, hand: itemHand(hand), startMeasure: number, endMeasure: number}))
        let count = learnedness(item)
        let played = !!item && item.attempts > 0
        if (played) {
          byIndex[idx] = {fill: `var(--salon-learn-${count})`, label: count >= 3 ? "Learned" : `${count} of 3`}
        }
      } else if (shade == "session") {
        let mark = marks.get(number)
        if (mark) {
          byIndex[idx] = {
            fill: `var(--salon-mark-${mark.mark})`, label: mark.label,
          }
        }
      } else if (shade == "difficulty") {
        let level = heatLevel(heatPct[idx] || 0)
        if (level > 0) {
          byIndex[idx] = {fill: `var(--salon-heat-tint-${level})`}
        }
      }
    })

    return byIndex
  }

  renderEndedStrip() {
    let {ended} = this.props
    if (!ended) { return null }

    return <div className={styles.ended_strip} data-ended-strip>
      <div className={styles.ended_left}>
        <div className={styles.ended_label}>Session ended</div>
        <div className={styles.ended_headline}>
          {ended.headline} <em>{ended.headlineSuffix}</em>
        </div>
      </div>
      <div className={styles.ended_middle}>
        {ended.comparison ? <p>{ended.comparison}</p> : null}
        <p>{ended.second}</p>
      </div>
      <div className={styles.ended_buttons}>
        <Pill variant="ghost" className={styles.small_pill} onClick={this.props.playOn}>Play on</Pill>
        <Pill variant="primary" className={styles.small_pill} onClick={this.props.dismissEnded}>Done</Pill>
      </div>
    </div>
  }

  renderLegend() {
    let {shade} = this.state
    if (shade == "off") { return null }

    let acoustic = this.props.acoustic
    let items = shade == "learnedness" ? [
      ["var(--salon-learn-0)", "Not played yet"],
      ["var(--salon-learn-1)", "Started"],
      ["var(--salon-learn-2)", "1 clean pass"],
      ["var(--salon-learn-3)", "2 in a row"],
      ["var(--salon-gilt-deep)", acoustic ? "Learned, 3 clean in a row" : "Learned, 3 in a row at 100%"],
    ] : shade == "session" ? [
      ["var(--salon-mark-clean)", acoustic ? "Clean every pass" : "Clean, 100%"],
      ["var(--salon-mark-near)", acoustic ? `Clean on ${TROUBLE_BELOW}% of passes or more` : `Nearly, ${TROUBLE_BELOW}% or more`],
      ["var(--salon-mark-trouble)", acoustic ? `Clean on under ${TROUBLE_BELOW}% of passes` : `Trouble, under ${TROUBLE_BELOW}%`],
      [null, "Not played this session"],
    ] : [
      ["var(--salon-heat-tint-1)", "Easier"],
      ["var(--salon-heat-tint-2)", ""],
      ["var(--salon-heat-tint-3)", ""],
      ["var(--salon-heat-tint-4)", "Harder, from the score analysis"],
    ]

    return <div className={styles.legend}>
      {items.map(([color, label], idx) => <span key={idx} className={styles.legend_item}>
        {color ? <span className={styles.swatch} style={{background: color}} /> : null}
        {label}
      </span>)}
      {shade == "difficulty" ? <button type="button" className={styles.review_link} onClick={this.openReview}>
        Review the passages
      </button> : null}
    </div>
  }

  render() {
    let {settings} = this.props
    let piece = this.piece()
    let song = this.song()
    let noPiece = !piece && !settings.song?.trim()

    if (noPiece) {
      return <div className={styles.score_view} data-score-view>
        <div className={styles.title_row}>
          <TitleBlock eyebrow="Sheet music" title="Sheet music" italic="import a piece to begin" />
        </div>
        <div className={styles.columns}>
          <Plate className={styles.score_plate}>
            <p className={styles.empty_note}>Import a MusicXML file in Tonight's session to see its score here.</p>
          </Plate>
          <div className={styles.setup_column}>
            <SetupPane
              settings={settings} setSettings={this.props.setSettings} generator={this.props.generator}
              liveGenerator={this.props.liveGenerator} currentStaff={this.props.currentStaff} staves={this.props.staves}
              keySignature={this.props.keySignature} mode={this.props.mode} setMode={this.props.setMode}
              scrollSpeed={this.props.scrollSpeed} setScrollSpeed={this.props.setScrollSpeed}
              tempo={this.props.tempo} setTempo={this.props.setTempo} acoustic={this.props.acoustic}
              begin={this.props.begin} pickPiece={this.props.pickPiece} store={this.props.store} />
          </div>
        </div>
      </div>
    }

    let numbers = measureNumberList(song)
    let hand = this.props.settings.hand || "both hands"
    let learned = piece ? learnedCount(this.getStore().items(piece.id), numbers, itemHand(hand)) : 0
    let noSource = this.props.source && this.props.source.status == "missing"
    let failed = (this.props.source && this.props.source.status == "failed") || this.state.sheetFailed
    let selected = this.state.selectedBar

    return <div className={styles.score_view} data-score-view>
      <div className={styles.title_row}>
        <TitleBlock
          eyebrow={`Sheet music · ${numbers.length} ${numbers.length == 1 ? "bar" : "bars"} · ` +
            `${this.props.currentStaff ? this.props.currentStaff.name : "grand"} staff · ` +
            `${this.props.keySignature ? this.props.keySignature.name() : "C"} major`}
          title={piece.title}
          italic="the score" />
        <p className={styles.rest_note}>Click any bar for its stats</p>
      </div>

      {this.renderEndedStrip()}

      <div className={styles.columns}>
        <Plate className={styles.score_plate}>
          <div className={styles.toolbar}>
            <span className={styles.page_indicator}>
              Page {this.state.page + 1} of {this.state.pageCount}
            </span>
            <div className={styles.shade_group} role="group" aria-label="Shade bars by">
              <span className={styles.shade_label}>Shade</span>
              {SHADES.filter(s => s.value != "session" || !!this.props.ended || this.state.shade == "session").map(s =>
                <Pill
                  key={s.value}
                  variant="choice"
                  className={styles.small_pill}
                  selected={this.state.shade == s.value}
                  aria-pressed={this.state.shade == s.value}
                  onClick={() => this.setShade(s.value)}>{s.label}</Pill>)}
            </div>
          </div>

          {noSource || failed ? <div className={styles.grid_fallback}>
            <div className={styles.bar_grid}>
              {numbers.map(number => <button
                key={number}
                type="button"
                aria-label={`Bar ${number}`}
                className={styles.grid_cell}
                aria-pressed={selected == number}
                onClick={() => this.openBar(number)}>{number}</button>)}
            </div>
            <p className={styles.engine_note}>{noSource ? SCORE_VIEW_NO_SOURCE : SCORE_VIEW_FAILED}</p>
          </div> : <ScoreSheet
            musicXML={this.props.source && this.props.source.musicXML}
            measureStarts={this.props.source && this.props.source.measureStarts}
            engine={this.props.engine}
            loadEngines={this.props.loadEngines}
            fromMeasure={numbers[0]}
            toMeasure={numbers[numbers.length - 1]}
            viewportHeight={this.props.viewportHeight}
            page={this.state.page}
            onPages={pageCount => this.setState({pageCount})}
            selected={selected}
            onBar={this.openBar}
            overlaysByIndex={this.overlaysByIndex(song)}
            tagsByIndex={this.tagsByIndex(numbers)}
            onError={() => this.setState({sheetFailed: true})}>
            {selected != null ? <BarPopup
              pieceId={piece.id}
              measure={selected}
              hand={itemHand(hand)}
              items={this.getStore().items(piece.id)}
              flags={this.flagsInForce()}
              now={this.props.now()}
              onClose={this.closeBar}
              onPractise={this.practiseBar} /> : null}
          </ScoreSheet>}

          {this.renderLegend()}

          <div className={styles.pager}>
            <Pill
              variant="ghost"
              className={styles.pager_pill}
              disabled={this.state.page <= 0}
              onClick={() => this.setPage(this.state.page - 1)}>‹ Previous page</Pill>
            <span className={styles.pager_label}>Page {this.state.page + 1} of {this.state.pageCount}</span>
            <Pill
              variant="ghost"
              className={styles.pager_pill}
              disabled={this.state.page >= this.state.pageCount - 1}
              onClick={() => this.setPage(this.state.page + 1)}>Next page ›</Pill>
          </div>
        </Plate>

        <div className={styles.setup_column}>
          <SetupPane
            settings={settings} setSettings={this.props.setSettings} generator={this.props.generator}
            liveGenerator={this.props.liveGenerator} currentStaff={this.props.currentStaff} staves={this.props.staves}
            keySignature={this.props.keySignature} mode={this.props.mode} setMode={this.props.setMode}
            scrollSpeed={this.props.scrollSpeed} setScrollSpeed={this.props.setScrollSpeed}
            tempo={this.props.tempo} setTempo={this.props.setTempo} acoustic={this.props.acoustic}
            begin={this.props.begin} pickPiece={this.props.pickPiece} store={this.props.store} />
        </div>
      </div>

      <PassagePane
        flags={this.flagsInForce()}
        selectedId={this.state.passageSelectedId}
        open={this.state.passageOpen}
        close={this.closePassage}
        onSelect={this.selectPassage}
        onPractise={this.practisePassage}
        onPractiseHand={this.practisePassageHand}
        onEdit={this.editPassage} />

      <ReviewPane
        settings={settings}
        setSettings={this.props.setSettings}
        source={this.props.source}
        engine={this.props.engine}
        loadEngines={this.props.loadEngines}
        store={this.props.store}
        open={this.state.reviewOpen}
        close={this.closeReview}
        initialFlagId={this.state.reviewFlagId} />
    </div>
  }
}

export default ScoreView
