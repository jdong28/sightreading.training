// "Tonight's session" (score-first design §D7): the score page's setup
// pane, always on the right at rest. Replaces the Programme drawer and
// moves the piece deck, library actions, "Tonight's programme" figures and
// the tempo group here; settings apply as they are picked, and Begin starts
// the session. Reads and writes the sheet music generator's existing inputs
// (st/data SHEET_MUSIC_GENERATOR) directly, never restating their rules.

import * as React from "react"
import * as types from "prop-types"

import {Plate, Pill} from "st/components/salon"
import NumberPicker from "st/components/number_picker"
import PdfSteps from "st/components/sight_reading/pdf_steps"
import {LEVEL_WORDS} from "st/difficulty/index"
import {barsLabel} from "st/music"
import {measureNumberList} from "st/song_sections"
import {pieceSong} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {learnedCount} from "st/bar_progress"
import {
  mostOverduePiece, pulledPassage, READ_FIRST, HARDEST_FIRST, SCORE_ORDER,
} from "st/srs/planner"
import {IN_ORDER, RANDOM_ORDER} from "st/measure_cards"
import {scoreEnginesPath} from "st/score_render/route"
import {
  SHEET_MUSIC_GENERATOR, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, WHOLE_SECTION,
  PROGRAMME_PRACTICE, FREE_PRACTICE, PLAN_CARD_MEASURES,
  sheetMusicPiece, programmeOffered, plannedPractice, sheetMusicPassages, programmePassages,
  introductionOrder, orderOffered, passageSettings, planCardMeasures, sheetMusicMeasureBounds,
  sheetMusicSectionRange, sheetMusicSectionUpdate, sheetMusicSectionLength, sheetMusicSection,
  itemHand,
} from "st/data"

import styles from "./setup_pane.module.css"

// the session lengths offered, in minutes (moved from programme_plate.jsx,
// which this pane replaces)
export const TARGET_MINUTES = [10, 20, 30]

const ORDER_PILLS = [
  {value: READ_FIRST, label: "Read through"},
  {value: HARDEST_FIRST, label: "Hardest first"},
  {value: SCORE_ORDER, label: "In score order"},
]

const plural = (count, word) => `${count} ${word}${count == 1 ? "" : "s"}`

// the lead-in bar just before a pulled flag's first playable bar, or null
// at the piece's start (st/srs/planner introduction()'s own leadIn, read
// here from the piece's measures since the planner doesn't export it)
function leadInOf(measures, flag) {
  let idx = measures.indexOf(flag.start)
  return idx > 0 ? measures[idx - 1] : null
}

// the order row's hint, with real values (score-first design §D7)
function orderHint(order, flag, measures) {
  if (!flag) {
    if (order == SCORE_ORDER) {
      return "New bars arrive in score order, flagged passages included."
    }
    return order == READ_FIRST ?
      "None of this piece's passages is flagged hard, so none is brought forward: it is read " +
        "through once, then its bars arrive in score order." :
      "None of this piece's passages is flagged hard, so this starts at the beginning, in score order."
  }

  let bars = barsLabel(flag.start, flag.end)
  let lead = leadInOf(measures, flag)
  let leadClause = lead != null ? ` from bar ${lead}` : ""

  switch (order) {
    case READ_FIRST:
      return `Plays the piece through once as practice, then ${bars}, the ` +
        `${LEVEL_WORDS[flag.level].toLowerCase()} passage,${leadClause}; the rest in score order.`
    case HARDEST_FIRST:
      return `Starts on the hard passages: ${bars} first${leadClause}.`
    default:
      return "Starts at the beginning and brings bars in score order."
  }
}

export class SetupPane extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    staff: types.object,
    generator: types.object,
    store: types.object,
    // picks another piece in study, see score_page.jsx's programmeOf
    pickPiece: types.func,
    mode: types.oneOf(["wait", "scroll"]),
    setMode: types.func.isRequired,
    scrollSpeed: types.number.isRequired,
    setScrollSpeed: types.func.isRequired,
    tempo: types.bool,
    setTempo: types.func.isRequired,
    acoustic: types.bool,
    onBegin: types.func.isRequired,
    now: types.func,
  }

  static defaultProps = {
    now: Date.now,
  }

  constructor(props) {
    super(props)
    this.state = {deckMessage: null}
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  deckInput() {
    return SHEET_MUSIC_GENERATOR.inputs.find(input => input.name == "piece")
  }

  updateSettings(update) {
    this.props.setSettings({...this.props.settings, ...update})
  }

  // moved from GeneratorSettings (st/components/sight_reading/settings_panel),
  // since this pane is the only place a piece is picked or the library is
  // managed now
  pickPiece(id) {
    let input = this.deckInput()
    if (!id) {
      this.updateSettings({piece: ""})
      return
    }

    let {settings} = input.pick(this.props.settings, id)
    this.updateSettings(settings)
  }

  importPiece(e) {
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    if (/\.pdf$/i.test(file.name) || file.type == "application/pdf") {
      this.setState({deckMessage: {pdf: true, fileName: file.name}})
      return
    }

    this.setState({deckMessage: {text: `Importing ${file.name}…`}})

    return file.arrayBuffer().then(data => {
      return this.deckInput().importFile(file.name, data).then(result => {
        if (result.error) {
          this.setState({deckMessage: {error: true, text: result.error}})
          return
        }

        let title = result.piece.title
        let text = result.updated ? `"${title}" was updated in the deck` :
          result.sameTitle ? `"${title}" was added as a new piece (another "${title}" is already in the deck)` :
          `"${title}" is in the deck`
        this.setState({deckMessage: {text: result.warning ? `${text}. ${result.warning}` : text}})
        this.pickPiece(result.piece.id)
      })
    }, err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  exportLibrary() {
    return this.deckInput().exportLibrary().then(result => {
      if (result.error) {
        this.setState({deckMessage: {error: true, text: result.error}})
        return
      }

      let url = URL.createObjectURL(new Blob([result.text], {type: "application/json"}))
      let link = document.createElement("a")
      link.href = url
      link.download = result.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      this.setState({deckMessage: {text: `Exported ${result.pieces} piece${result.pieces == 1 ? "" : "s"} to ${result.fileName}`}})
    })
  }

  importLibrary(e) {
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    this.setState({deckMessage: {text: `Importing ${file.name}…`}})

    return file.text().then(text => {
      return this.deckInput().importLibrary(text).then(result => {
        if (result.error) {
          this.setState({deckMessage: {error: true, text: result.error}})
          return
        }

        let message = result.warning ? `${result.message}. ${result.warning}` : result.message
        this.setState({deckMessage: {text: message}})
      })
    }, err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  importFlags(e) {
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    this.setState({deckMessage: {text: `Opening ${file.name}…`}})

    return file.text().then(text => {
      return this.deckInput().importFlags(text).then(result => {
        if (result.error) {
          this.setState({deckMessage: {error: true, text: result.error}})
          return
        }

        this.setState({deckMessage: {text: result.message}})
        this.pickPiece(result.piece.id)
      })
    }, err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  removePiece() {
    let {settings} = this.props
    let piece = sheetMusicPiece(settings)
    if (!piece) { return }

    let input = this.deckInput()
    input.removePiece(piece.id).then(result => {
      if (result.error) {
        this.setState({deckMessage: {error: true, text: result.error}})
        return
      }
      this.setState({deckMessage: {text: `Removed "${piece.title}" from the deck`}})
      this.pickPiece("")
    })
  }

  renderPiece() {
    let {settings} = this.props
    let piece = sheetMusicPiece(settings)
    let pieces = this.deckInput().pieces()
    let message = this.state.deckMessage

    return <div className={styles.group}>
      <div className={styles.group_label}>Piece</div>
      <div className={styles.piece_body}>
        {pieces.length > 0 && <div className={styles.piece_row}>
          <label className={styles.piece_select}>
            <span>{piece ? piece.title : "Choose a piece"}</span>
            <span aria-hidden="true">▾</span>
            <select
              className={styles.native_select}
              value={piece ? piece.id : ""}
              onChange={e => this.pickPiece(e.target.value)}>
              {!piece && <option value="">Choose a piece</option>}
              {pieces.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          {piece && <Pill variant="ghost" className={styles.remove} onClick={() => this.removePiece()}>Remove</Pill>}
        </div>}

        <div className={styles.links}>
          <label className={styles.file_link}>
            <span>Import MusicXML</span>
            <input
              type="file"
              accept=".musicxml,.xml,.mxl,.pdf,application/pdf,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
              onChange={e => this.importPiece(e)} />
          </label>
          <a href="#" className={styles.file_link} onClick={e => { e.preventDefault(); this.exportLibrary() }}>
            Export library
          </a>
          <label className={styles.file_link}>
            <span>Import library</span>
            <input type="file" accept=".json,application/json" onChange={e => this.importLibrary(e)} />
          </label>
          <label className={styles.file_link}>
            <span>Open flags file</span>
            <input type="file" accept=".json,application/json" onChange={e => this.importFlags(e)} />
          </label>
        </div>

        {message && message.text &&
          <div className={message.error ? styles.input_error : styles.input_notice}>{message.text}</div>}
        {message && message.pdf && <PdfSteps fileName={message.fileName} />}
        {piece && this.renderKeyHint()}
      </div>
    </div>
  }

  renderKeyHint() {
    let hint = SHEET_MUSIC_GENERATOR.keyHint && SHEET_MUSIC_GENERATOR.keyHint(this.props.settings)
    return hint ? <div className={styles.hint}>{hint}</div> : null
  }

  setPractice(practice) {
    this.updateSettings({practice})
  }

  renderSession() {
    let {settings} = this.props
    let store = this.getStore()
    let isProgramme = plannedPractice(settings, store)

    return <div className={styles.group}>
      <div className={styles.group_label}>Session</div>
      {programmeOffered(settings) && <div className={styles.pills} role="group" aria-label="Session">
        <Pill variant="choice" selected={isProgramme} onClick={() => this.setPractice(PROGRAMME_PRACTICE)}>
          Today's programme
        </Pill>
        <Pill variant="choice" selected={!isProgramme} onClick={() => this.setPractice(FREE_PRACTICE)}>
          Free practice
        </Pill>
      </div>}
      {isProgramme ? this.renderProgramme() : this.renderFreePractice()}
    </div>
  }

  renderProgramme() {
    let {settings, generator} = this.props
    let store = this.getStore()
    let piece = sheetMusicPiece(settings)
    let song = piece && pieceSong(piece)
    let summary = generator && generator.summary ? generator.summary() : null
    let hand = itemHand(settings.hand)
    let measures = song ? measureNumberList(song) : []
    let learned = song ? learnedCount(store.items(piece.id), measures, hand) : 0
    let order = introductionOrder(settings)
    let flag = pulledPassage(programmePassages(settings, store), hand)
    let other = this.props.pickPiece && this.suggestion()

    return <div className={styles.subgroup}>
      <div className={styles.figures}>
        <div className={styles.figure}>
          <div className={styles.figure_label}>Due</div>
          <div className={styles.figure_value}>{summary ? summary.due : "—"}</div>
        </div>
        <div className={styles.figure}>
          <div className={styles.figure_label}>New</div>
          <div className={styles.figure_value}>{summary ? summary.newMeasures : "—"}</div>
        </div>
        <div className={styles.figure}>
          <div className={styles.figure_label}>Learned</div>
          <div className={styles.figure_value}>
            {summary ? learned : "—"}
            {summary ? <span className={styles.figure_detail}> /{measures.length}</span> : null}
          </div>
        </div>
      </div>

      <div className={styles.hint}>
        Today's programme picks each bar: the ones due for review, new ones{" "}
        {orderOffered(settings, store) ? "in the order below" : "in score order"}, and those you missed again
        in a moment.
      </div>

      {other && <div className={styles.suggestion}>
        <span>{other.title} has the most bars due.</span>
        <Pill
          variant="ghost"
          className={styles.small_pill}
          onClick={() => this.props.setSettings(this.props.pickPiece(settings, other.id))}>
          Practise it instead
        </Pill>
      </div>}

      {orderOffered(settings, store) && <div className={styles.sub}>
        <div className={styles.sub_label}>Order</div>
        <div className={styles.pills} role="group" aria-label="Order">
          {ORDER_PILLS.map(({value, label}) =>
            <Pill
              key={value}
              variant="choice"
              className={styles.small_pill}
              selected={value == order}
              onClick={() => this.updateSettings({introduce: value})}>{label}</Pill>)}
        </div>
        <div className={styles.hint}>{orderHint(order, flag, measures)}</div>
      </div>}

      <div className={styles.sub}>
        <div className={styles.sub_label}>Length</div>
        <div className={styles.pills} role="group" aria-label="Session length">
          {TARGET_MINUTES.map(minutes =>
            <Pill
              key={minutes}
              variant="choice"
              className={styles.small_pill}
              selected={minutes == store.practiceSettings().sessionMinutes}
              onClick={() => store.putPracticeSettings({...store.practiceSettings(), sessionMinutes: minutes})
                .then(() => this.forceUpdate())}>
              {minutes} min
            </Pill>)}
        </div>
      </div>
    </div>
  }

  suggestion() {
    let store = this.getStore()
    let id = mostOverduePiece({studies: store.studies(), items: store.items(), now: this.props.now()})
    return id && id != this.props.settings.piece ? store.piece(id) : null
  }

  renderFreePractice() {
    let {settings} = this.props
    let bounds = sheetMusicMeasureBounds(settings)
    let {startMeasure, endMeasure} = sheetMusicSectionRange(settings)
    let last = bounds ? bounds[1] : endMeasure
    let staff = this.props.staff
    let columns = staff ? sheetMusicSection(staff, settings).columns.length : 0
    let flags = sheetMusicPassages(settings, this.getStore())
    let showOrder = Number(settings.measuresPerCard) >= 1

    return <div className={styles.subgroup}>
      <div className={styles.hint}>Free practice plays the bars you pick.</div>

      <div className={styles.sub}>
        <div className={styles.sub_label}>Section</div>
        <div className={styles.section_row}>
          <span>Bars</span>
          <NumberPicker
            label="start bar"
            slider={false}
            min={bounds ? bounds[0] : 0}
            max={bounds ? bounds[1] : endMeasure}
            value={startMeasure}
            onChange={value => this.updateSettings(sheetMusicSectionUpdate(settings, "startMeasure", value))} />
          <span>to</span>
          <NumberPicker
            label="end bar"
            slider={false}
            min={bounds ? bounds[0] : 0}
            max={bounds ? bounds[1] : endMeasure}
            value={endMeasure}
            onChange={value => this.updateSettings(sheetMusicSectionUpdate(settings, "endMeasure", value))} />
          <span className={styles.of_last}>of {last}</span>
        </div>
        <div className={styles.hint}>Marked in gilt on the score. Section has {plural(columns, "column")}.</div>
      </div>

      {flags.length > 0 && <div className={styles.sub}>
        <div className={styles.sub_label}>Difficult passages</div>
        <div className={styles.pills} role="group" aria-label="Difficult passages">
          {flags.map(flag =>
            <Pill
              key={flag.id}
              variant="choice"
              className={styles.small_pill}
              selected={settings.startMeasure == flag.start && settings.endMeasure == flag.end}
              onClick={() => this.updateSettings(passageSettings(settings, flag))}>
              {`${barsLabel(flag.start, flag.end)} · ${LEVEL_WORDS[flag.level]}`}
            </Pill>)}
        </div>
        <div className={styles.hint}>From the score analysis, hardest first. Picking one sets the section.</div>
      </div>}

      {showOrder && <div className={styles.sub}>
        <div className={styles.sub_label}>Card order</div>
        <div className={styles.pills} role="group" aria-label="Card order">
          <Pill
            variant="choice"
            className={styles.small_pill}
            selected={(settings.order || IN_ORDER) == IN_ORDER}
            onClick={() => this.updateSettings({order: IN_ORDER})}>In order</Pill>
          <Pill
            variant="choice"
            className={styles.small_pill}
            selected={settings.order == RANDOM_ORDER}
            onClick={() => this.updateSettings({order: RANDOM_ORDER})}>Random</Pill>
        </div>
        <div className={styles.hint}>Random picks the weakest bars more often.</div>
      </div>}
    </div>
  }

  setHand(hand) {
    this.updateSettings({hand})
  }

  renderCards() {
    let {settings} = this.props
    let isProgramme = plannedPractice(settings, this.getStore())
    let mpcInput = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "measuresPerCard")
    let {max} = mpcInput.bounds(settings)
    let mpc = settings.measuresPerCard
    let isAll = !(Number(mpc) >= 1)
    let value = isAll ? max : Math.min(max, Math.floor(Number(mpc)) || 1)

    return <div className={styles.group}>
      <div className={styles.group_label}>Cards</div>
      <div className={styles.sub}>
        <div className={styles.sub_label}>Hand</div>
        <div className={styles.pills} role="group" aria-label="Hand">
          <Pill variant="choice" className={styles.small_pill} selected={settings.hand == BOTH_HANDS}
            onClick={() => this.setHand(BOTH_HANDS)}>Both hands</Pill>
          <Pill variant="choice" className={styles.small_pill} selected={settings.hand == RIGHT_HAND}
            onClick={() => this.setHand(RIGHT_HAND)}>Right hand</Pill>
          <Pill variant="choice" className={styles.small_pill} selected={settings.hand == LEFT_HAND}
            onClick={() => this.setHand(LEFT_HAND)}>Left hand</Pill>
        </div>
      </div>

      <div className={styles.sub}>
        <div className={styles.sub_label}>Bars per card</div>
        <div className={styles.section_row}>
          <Pill variant="choice" className={styles.small_pill} selected={isAll}
            onClick={() => this.updateSettings({measuresPerCard: WHOLE_SECTION})}>all</Pill>
          <NumberPicker
            label="bars per card"
            slider={false}
            min={1}
            max={max}
            value={isAll ? null : value}
            placeholder="all"
            onChange={value => this.updateSettings({measuresPerCard: value})} />
          <span className={styles.of_last}>of {max}</span>
        </div>
        <div className={styles.hint}>
          {isProgramme ?
            "The programme plays each bar it picks with the ones after it, this many in all; " +
              `all plays ${PLAN_CARD_MEASURES}.` :
            "All plays the whole section as one card. A number shows that many bars at a time, like a flashcard."}
        </div>
      </div>
    </div>
  }

  renderTempo() {
    let {mode, scrollSpeed, tempo, acoustic} = this.props

    if (acoustic) {
      return <div className={styles.group}>
        <div className={styles.tempo_header}>
          <span className={styles.group_label}>Tempo</span>
        </div>
        <div className={styles.hint}>Acoustic piano: each card waits for your grade.</div>
      </div>
    }

    return <div className={styles.group}>
      <div className={styles.tempo_header}>
        <span className={styles.group_label}>Tempo</span>
        <span className={styles.tempo_value}>{scrollSpeed}</span>
      </div>
      <div className={styles.pills} role="group" aria-label="Mode">
        <Pill variant="choice" selected={mode == "wait"} onClick={() => this.props.setMode("wait")}>Wait</Pill>
        <Pill variant="choice" selected={mode == "scroll"} onClick={() => this.props.setMode("scroll")}>Scroll</Pill>
      </div>
      <label className={styles.speed_row}>
        <span>Speed <span className={styles.speed_value}>{scrollSpeed}</span></span>
        <input
          type="range"
          min={50}
          max={300}
          value={scrollSpeed}
          onChange={e => this.props.setScrollSpeed(Math.round(+e.target.value))}
          aria-label="Speed" />
        <span className={styles.speed_legend}><span>Largo</span><span>Presto</span></span>
      </label>
      <div className={styles.keep_row}>
        <Pill
          variant="choice"
          className={styles.small_pill}
          selected={!!tempo}
          disabled={mode != "scroll"}
          onClick={() => this.props.setTempo(!tempo)}>
          Keep tempo
        </Pill>
        <span className={styles.hint}>Scroll only: notes that pass the line unplayed are missed.</span>
      </div>
    </div>
  }

  beginLine() {
    let {settings} = this.props
    let store = this.getStore()
    let isProgramme = plannedPractice(settings, store)
    let handName = {[BOTH_HANDS]: "Both hands", [RIGHT_HAND]: "Right hand", [LEFT_HAND]: "Left hand"}[settings.hand]
    let tempoWords = this.props.acoustic ? "graded by you." :
      this.props.mode == "scroll" ? `scrolling at ${this.props.scrollSpeed}.` : "waiting for you."

    if (isProgramme) {
      let order = introductionOrder(settings)
      let orderName = {[READ_FIRST]: "read through", [HARDEST_FIRST]: "hardest first", [SCORE_ORDER]: "in score order"}[order]
      let minutes = store.practiceSettings().sessionMinutes
      let k = planCardMeasures(settings)
      return `About ${minutes} minutes of today’s programme, ${orderName}, ${handName.toLowerCase()}, ` +
        `${plural(k, "bar")} a card, ${tempoWords}`
    }

    let {startMeasure, endMeasure} = sheetMusicSectionRange(settings)
    let mpc = settings.measuresPerCard
    let isAll = !(Number(mpc) >= 1)
    let k = isAll ? sheetMusicSectionLength(settings) : Math.floor(Number(mpc))
    let order = settings.order == RANDOM_ORDER ? "weakest first" : "in order"
    let range = startMeasure == endMeasure ? `Bar ${startMeasure}` : `Bars ${startMeasure}–${endMeasure}`

    return `${range}, ${order}, ${handName.toLowerCase()}, ${plural(k, "bar")} a card, ${tempoWords}`
  }

  render() {
    let {settings} = this.props
    let piece = sheetMusicPiece(settings)
    let disabled = !piece && !(settings.song && settings.song.trim())

    return <Plate className={styles.pane}>
      <div className={styles.header}>
        <h2 className={styles.title}>Tonight's <span className={styles.title_italic}>session</span></h2>
        <span className={styles.aside}>At rest</span>
      </div>

      {this.renderPiece()}
      {piece && this.renderSession()}
      {piece && this.renderCards()}
      {piece && this.renderTempo()}

      <div className={styles.footer}>
        <p className={styles.begin_line}>{piece ? this.beginLine() : ""}</p>
        <Pill variant="primary" className={styles.begin} disabled={disabled} onClick={this.props.onBegin}>
          Begin
        </Pill>
        <div className={styles.engines_link}>
          <a href={scoreEnginesPath(settings)}>Compare engraving engines</a>
        </div>
      </div>
    </Plate>
  }
}

export default SetupPane
