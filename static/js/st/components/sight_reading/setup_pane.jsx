// "Tonight's session": the score-first page's setup pane (plan §D7),
// always on the right at rest. Piece, Session (today's programme or free
// practice), Cards and Tempo, ending in Begin. Reads and writes the sheet
// music generator's own inputs (st/data), never restating their rules; the
// piece deck and library actions are lifted near-unchanged from
// GeneratorSettings#renderDeck (st/components/sight_reading/settings_panel).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import Select from "st/components/select"
import NumberPicker from "st/components/number_picker"
import PdfSteps from "st/components/sight_reading/pdf_steps"
import {TempoSettings} from "st/components/sight_reading/settings_panel"
import {getAppStore} from "st/storage"
import {barsLabel} from "st/music"
import {measureNumberList} from "st/song_sections"
import {LEVEL_WORDS} from "st/difficulty/index"
import {learnedCount} from "st/bar_progress"
import {scoreEnginesPath} from "st/score_render/route"
import {storeGeneratorSettings} from "st/generators"
import {
  SHEET_MUSIC_GENERATOR, sheetMusicPiece, plannedPractice, programmeOffered, orderOffered,
  sheetMusicPassages, programmePassages, sheetMusicSection, sheetMusicSectionRange,
  sheetMusicSectionUpdate, sheetMusicSectionLength, passageSettings, planCardMeasures, itemHand,
  BOTH_HANDS, RIGHT_HAND, LEFT_HAND, WHOLE_SECTION, PROGRAMME_PRACTICE, FREE_PRACTICE,
} from "st/data"
import {IN_ORDER, RANDOM_ORDER} from "st/measure_cards"
import {mostOverduePiece, pulledPassage, READ_FIRST, HARDEST_FIRST, SCORE_ORDER} from "st/srs/planner"
import {pieceSong} from "st/sheet_music_deck"

import styles from "./setup_pane.module.css"

export const TARGET_MINUTES = [10, 20, 30]

const ORDER_PILLS = [
  {value: READ_FIRST, label: "Read through"},
  {value: HARDEST_FIRST, label: "Hardest first"},
  {value: SCORE_ORDER, label: "In score order"},
]

const HAND_PILLS = [
  {value: BOTH_HANDS, label: "Both hands"},
  {value: RIGHT_HAND, label: "Right hand"},
  {value: LEFT_HAND, label: "Left hand"},
]

function orderDescription(order, flag) {
  if (order == SCORE_ORDER) {
    return "Starts at the beginning and brings bars in score order."
  }

  if (!flag) {
    return order == READ_FIRST ?
      "Plays the piece through once as practice, then its bars in score order." :
      "Starts at the beginning, in score order."
  }

  let level = LEVEL_WORDS[flag.level].toLowerCase()
  let bars = barsLabel(flag.start, flag.end)
  let fromBar = flag.start > 1 ? " from the bar before it" : ""

  return order == READ_FIRST ?
    `Plays the piece through once as practice, then ${bars}, the ${level} passage${fromBar}; ` +
      "the rest in score order." :
    `Starts on the hard passages: ${bars} first${fromBar}.`
}

const HAND_WORDS = {[BOTH_HANDS]: "both hands", [RIGHT_HAND]: "right hand alone", [LEFT_HAND]: "left hand alone"}

export class SetupPane extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    generator: types.object,
    currentStaff: types.object,
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
    store: types.object,
  }

  constructor(props) {
    super(props)
    this.state = {deckMessage: null}
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  updateSettings(update) {
    let generator = SHEET_MUSIC_GENERATOR
    if (generator.storageKey) {
      storeGeneratorSettings(generator.storageKey, {...this.props.settings, ...update})
    }
    this.props.setSettings({...this.props.settings, ...update})
  }

  // Piece group's deck, lifted from GeneratorSettings#renderDeck
  pickPiece(id) {
    let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
    if (!id) {
      this.updateSettings({piece: ""})
      return
    }

    let {settings, staff} = input.pick(this.props.settings, id)
    this.props.setSettings(settings)

    let singleStaff = ["treble", "bass"].includes(this.props.currentStaff && this.props.currentStaff.name)
    let staffObj = staff && (this.props.staves || []).find(s => s.name == staff)
    if (singleStaff && staffObj && this.props.setStaff && this.props.currentStaff != staffObj) {
      this.props.setStaff(staffObj)
    }
  }

  importPiece(e) {
    let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    if (/\.pdf$/i.test(file.name) || file.type == "application/pdf") {
      this.setState({deckMessage: {pdf: true, fileName: file.name}})
      return
    }

    this.setState({deckMessage: {text: `Importing ${file.name}…`}})

    return file.arrayBuffer().then(data => input.importFile(file.name, data).then(result => {
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
    }), err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  exportLibrary() {
    let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
    return input.exportLibrary().then(result => {
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

      this.setState({
        deckMessage: {text: `Exported ${result.pieces} piece${result.pieces == 1 ? "" : "s"} to ${result.fileName}`},
      })
    })
  }

  importLibrary(e) {
    let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    this.setState({deckMessage: {text: `Importing ${file.name}…`}})

    return file.text().then(text => input.importLibrary(text).then(result => {
      if (result.error) {
        this.setState({deckMessage: {error: true, text: result.error}})
        return
      }
      let message = result.warning ? `${result.message}. ${result.warning}` : result.message
      this.setState({deckMessage: {text: message}})
    }), err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  importFlags(e) {
    let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    this.setState({deckMessage: {text: `Opening ${file.name}…`}})

    return file.text().then(text => input.importFlags(text).then(result => {
      if (result.error) {
        this.setState({deckMessage: {error: true, text: result.error}})
        return
      }
      this.setState({deckMessage: {text: result.message}})
      this.pickPiece(result.piece.id)
    }), err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  renderPiece() {
    let {settings} = this.props
    let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
    let pieces = input.pieces()
    let currentValue = settings.piece || ""
    if (!pieces.some(piece => piece.id == currentValue)) { currentValue = "" }

    let options = [{name: input.emptyLabel || "None", value: ""}]
      .concat(pieces.map(piece => ({name: piece.title, value: piece.id})))

    let message = this.state.deckMessage
    let piece = sheetMusicPiece(settings)
    let keyHint = piece && !piece.song?.metadata?.measureKeySignatures ?
      "Re-import to follow the score key" : null

    return <div className={styles.group}>
      <div className={styles.group_label}>Piece</div>
      <div className={styles.piece_row}>
        <Select
          className={styles.select_component}
          value={currentValue}
          options={options}
          onChange={id => {
            this.setState({deckMessage: null})
            this.pickPiece(id)
          }} />
        {currentValue ? <Pill
          variant="ghost"
          className={styles.small_pill}
          onClick={() => {
            let found = pieces.find(p => p.id == currentValue)
            input.removePiece(currentValue).then(result => {
              if (result.error) {
                this.setState({deckMessage: {error: true, text: result.error}})
                return
              }
              this.setState({deckMessage: {text: `Removed "${found.title}" from the deck`}})
              this.pickPiece("")
            })
          }}>Remove</Pill> : null}
      </div>

      <div className={styles.piece_links}>
        <label className={styles.file_link}>
          Import MusicXML
          <input
            type="file"
            accept=".musicxml,.xml,.mxl,.pdf,application/pdf,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
            onChange={e => this.importPiece(e)} />
        </label>
        <button type="button" className={styles.link_button} onClick={() => this.exportLibrary()}>Export library</button>
        <label className={styles.file_link}>
          Import library
          <input type="file" accept=".json,application/json" onChange={e => this.importLibrary(e)} />
        </label>
        <label className={styles.file_link}>
          Open flags file
          <input type="file" accept=".json,application/json" onChange={e => this.importFlags(e)} />
        </label>
      </div>

      {message && message.text ?
        <div className={message.error ? styles.input_error : styles.input_notice}>{message.text}</div> : null}
      {message && message.pdf ? <PdfSteps fileName={message.fileName} /> : null}
      {keyHint ? <div className={styles.input_hint}>{keyHint}</div> : null}

      {currentValue ? null : this.renderNotation()}
    </div>
  }

  // "Pasted song notation", the piece select's first option: the notation
  // itself and the track to drill of it, the generator's own song and track
  // inputs. A pasted song has no score to engrave, no study and no cards,
  // so the rest of the pane offers free practice of its measures alone
  renderNotation() {
    let {settings} = this.props
    let songInput = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "song")
    let trackInput = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "track")
    let tracks = trackInput.values(settings)
    let track = tracks.some(option => option.name == settings.track) ? settings.track : trackInput.default

    return <div className={styles.subgroup}>
      <div className={styles.sub_label}>{songInput.label}</div>
      <textarea
        className={styles.text_input}
        aria-label={songInput.label}
        rows={8}
        spellCheck={false}
        value={settings.song || ""}
        onChange={e => this.props.setSettings({...settings, song: e.target.value})} />
      <p className={styles.input_hint}>{songInput.hint}</p>

      {/* only the parsed song's own tracks are worth choosing between */}
      {tracks.length > 1 ? <div className={styles.subgroup}>
        <div className={styles.sub_label}>Track</div>
        <div className={styles.pills}>
          {tracks.map(({name}) => <Pill
            key={name}
            variant="choice"
            className={styles.choice_pill}
            selected={name == track}
            onClick={() => this.props.setSettings({...settings, track: name})}>{name}</Pill>)}
        </div>
      </div> : null}
    </div>
  }

  // the piece in study most overdue, when it isn't the one played
  suggestion() {
    let store = this.getStore()
    let id = mostOverduePiece({studies: store.studies(), items: store.items(), now: Date.now()})
    return id && id != this.props.settings.piece ? store.piece(id) : null
  }

  setTarget(minutes) {
    let store = this.getStore()
    store.putPracticeSettings({...store.practiceSettings(), sessionMinutes: minutes})
      .then(() => this.forceUpdate())
      .catch(err => console.warn("Couldn't save the session length", err))
  }

  renderProgramme() {
    let {settings, generator} = this.props
    let summary = generator && generator.summary ? generator.summary() : null
    let piece = sheetMusicPiece(settings)
    let song = piece && pieceSong(piece)
    let measures = song ? measureNumberList(song).length : 0
    let learned = song ? learnedCount(this.getStore().items(piece.id), measureNumberList(song), itemHand(settings.hand)) : 0

    let order = settings.introduce
    let flag = pulledPassage(programmePassages(settings, this.getStore()))
    let other = this.suggestion()

    return <>
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
            {learned}<span className={styles.figure_value_small}> /{measures}</span>
          </div>
        </div>
      </div>

      <p className={styles.input_hint}>
        {"Today's programme picks each bar: the ones due for review, new ones " +
          `${orderOffered(settings, this.getStore()) ? "in the order below" : "in score order"}, and those you ` +
          "missed again in a moment."}
      </p>

      {other ? <div className={styles.suggestion_row}>
        <span>{other.title} has the most bars due.</span>
        <button
          type="button"
          className={styles.link_button}
          onClick={() => {
            let input = SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == "piece")
            this.props.setSettings(input.pick(settings, other.id).settings)
          }}>Practise it instead</button>
      </div> : null}

      {orderOffered(settings, this.getStore()) ? <div className={styles.subgroup}>
        <div className={styles.sub_label}>Order</div>
        <div className={styles.pills}>
          {ORDER_PILLS.map(({value, label}) => <Pill
            key={value}
            variant="choice"
            className={styles.choice_pill}
            selected={value == order}
            onClick={() => this.props.setSettings({...settings, introduce: value})}>{label}</Pill>)}
        </div>
        <p className={styles.input_hint}>{orderDescription(order, flag)}</p>
      </div> : null}

      <div className={styles.subgroup}>
        <div className={styles.sub_label}>Length</div>
        <div className={styles.pills}>
          {TARGET_MINUTES.map(minutes => <Pill
            key={minutes}
            variant="choice"
            className={styles.choice_pill}
            selected={summary && minutes == summary.targetMinutes}
            onClick={() => this.setTarget(minutes)}>{minutes} min</Pill>)}
        </div>
      </div>
    </>
  }

  renderFreePractice() {
    let {settings, currentStaff} = this.props
    let range = sheetMusicSectionRange(settings)
    let piece = sheetMusicPiece(settings)
    let song = piece && pieceSong(piece)
    let bounds = song ? measureNumberList(song) : []
    let last = bounds.length ? bounds[bounds.length - 1] : range.endMeasure
    let section = currentStaff ? sheetMusicSection(currentStaff, settings) : {columns: []}
    let passages = sheetMusicPassages(settings, this.getStore())
    let measuresPerCard = settings.measuresPerCard

    return <>
      <p className={styles.input_hint}>Free practice plays the bars you pick.</p>

      <div className={styles.subgroup}>
        <div className={styles.sub_label}>Section</div>
        <div className={styles.section_row}>
          <span>Bars</span>
          <NumberPicker
            label="Start measure"
            slider={false}
            min={bounds[0] ?? 0}
            max={bounds[bounds.length - 1] ?? 9999}
            value={range.startMeasure}
            onChange={value => this.props.setSettings({
              ...settings, ...sheetMusicSectionUpdate(settings, "startMeasure", value),
            })} />
          <span>to</span>
          <NumberPicker
            label="End measure"
            slider={false}
            min={bounds[0] ?? 0}
            max={bounds[bounds.length - 1] ?? 9999}
            value={range.endMeasure}
            onChange={value => this.props.setSettings({
              ...settings, ...sheetMusicSectionUpdate(settings, "endMeasure", value),
            })} />
          <span className={styles.of_last}>of {last}</span>
        </div>
        <p className={styles.input_hint}>
          {piece ?
            `Marked in gilt on the score. Section has ${section.columns.length} columns.` +
              (section.skipped ? ` ${section.skipped}.` : "") :
            // pasted notation has no score to mark, and may not parse at
            // all: the generator's own status says what it made of it
            section.status}
        </p>
      </div>

      {passages.length > 0 ? <div className={styles.subgroup}>
        <div className={styles.sub_label}>Difficult passages</div>
        <div className={styles.pills}>
          {passages.map(flag => <Pill
            key={flag.id}
            variant="choice"
            className={styles.choice_pill}
            onClick={() => this.props.setSettings(passageSettings(settings, flag))}>
            {barsLabel(flag.start, flag.end)} · {LEVEL_WORDS[flag.level]}
          </Pill>)}
        </div>
        <p className={styles.input_hint}>From the score analysis, hardest first. Picking one sets the section.</p>
      </div> : null}

      {piece && Number(measuresPerCard) >= 1 ? <div className={styles.subgroup}>
        <div className={styles.sub_label}>Card order</div>
        <div className={styles.pills}>
          {[[IN_ORDER, "In order"], [RANDOM_ORDER, "Random"]].map(([value, label]) => <Pill
            key={value}
            variant="choice"
            className={styles.choice_pill}
            selected={(settings.order || IN_ORDER) == value}
            onClick={() => this.props.setSettings({...settings, order: value})}>{label}</Pill>)}
        </div>
        <p className={styles.input_hint}>Random picks the weakest bars more often.</p>
      </div> : null}
    </>
  }

  // nothing to practise yet: no piece picked and no notation pasted. The
  // pane then shows the Piece group alone (plan D11), and Begin is disabled
  nothingToPlay() {
    let {settings} = this.props
    return !sheetMusicPiece(settings) && !(settings.song || "").trim()
  }

  renderSession() {
    let {settings} = this.props
    if (this.nothingToPlay()) { return null }

    // pasted notation is never in study, so plannedPractice is false for it
    // and the group offers free practice alone
    let planned = plannedPractice(settings, this.getStore())

    return <div className={styles.group}>
      <div className={styles.group_header}>
        <div className={styles.group_label}>Tonight's <span className={styles.italic}>session</span></div>
      </div>

      {programmeOffered(settings) ? <div className={styles.pills}>
        <Pill
          variant="choice"
          className={styles.choice_pill}
          selected={planned}
          onClick={() => this.props.setSettings({...settings, practice: PROGRAMME_PRACTICE})}>
          Today's programme
        </Pill>
        <Pill
          variant="choice"
          className={styles.choice_pill}
          selected={!planned}
          onClick={() => this.props.setSettings({...settings, practice: FREE_PRACTICE})}>
          Free practice
        </Pill>
      </div> : null}

      {planned ? this.renderProgramme() : this.renderFreePractice()}
    </div>
  }

  renderCards() {
    let {settings} = this.props
    if (!sheetMusicPiece(settings)) { return null }

    let planned = plannedPractice(settings, this.getStore())
    let measuresPerCard = settings.measuresPerCard
    let isAll = !(Number(measuresPerCard) >= 1)
    let bounds = planned ?
      (() => {
        let piece = sheetMusicPiece(settings)
        let song = piece && pieceSong(piece)
        return song ? measureNumberList(song).length : 1
      })() : sheetMusicSectionLength(settings)

    return <div className={styles.group}>
      <div className={styles.sub_label}>Hand</div>
      <div className={styles.pills}>
        {HAND_PILLS.map(({value, label}) => <Pill
          key={value}
          variant="choice"
          className={styles.choice_pill}
          selected={(settings.hand || BOTH_HANDS) == value}
          onClick={() => this.props.setSettings({...settings, hand: value})}>{label}</Pill>)}
      </div>

      <div className={styles.subgroup}>
        <div className={styles.sub_label}>Bars per card</div>
        <div className={styles.pills}>
          <Pill
            variant="choice"
            className={styles.choice_pill}
            selected={isAll}
            onClick={() => this.props.setSettings({...settings, measuresPerCard: WHOLE_SECTION})}>all</Pill>
          <NumberPicker
            label="Bars per card"
            slider={false}
            min={1}
            max={bounds}
            value={isAll ? null : Number(measuresPerCard)}
            placeholder="all"
            caption={`of ${bounds}`}
            onChange={value => this.props.setSettings({...settings, measuresPerCard: value})} />
        </div>
        <p className={styles.input_hint}>
          {planned ?
            "The programme plays each bar it picks with the ones after it, this many in all; all plays " +
              `${planCardMeasures(settings)}.` :
            "All plays the whole section as one card. A number shows that many bars at a time, like a flashcard."}
        </p>
      </div>
    </div>
  }

  renderTempo() {
    return <div className={styles.group}>
      <div className={styles.tempo_header}>
        <div className={styles.group_label}>Tempo</div>
        {!this.props.acoustic ? <div className={styles.tempo_value}>Speed {this.props.scrollSpeed}</div> : null}
      </div>

      {this.props.acoustic ?
        <p className={styles.input_hint}>Acoustic piano: each card waits for your grade</p> :
        <TempoSettings
          mode={this.props.mode}
          setMode={this.props.setMode}
          scrollSpeed={this.props.scrollSpeed}
          setScrollSpeed={this.props.setScrollSpeed}
          tempo={this.props.tempo}
          setTempo={this.props.setTempo} />}
    </div>
  }

  beginLine() {
    let {settings} = this.props
    let planned = plannedPractice(settings, this.getStore())
    let tempoWords = this.props.acoustic ? "graded by you." :
      this.props.mode == "scroll" ? `scrolling at ${this.props.scrollSpeed}.` : "waiting for you."
    let hand = HAND_WORDS[settings.hand || BOTH_HANDS]

    if (planned) {
      let store = this.getStore()
      let minutes = store.practiceSettings().sessionMinutes
      let order = ORDER_PILLS.find(p => p.value == settings.introduce)
      return `About ${minutes} minutes of today's programme` +
        (order ? `, ${order.label.toLowerCase()}` : "") +
        `, ${hand}, ${planCardMeasures(settings)} bar(s) a card, ${tempoWords}`
    }

    let range = sheetMusicSectionRange(settings)
    let bars = range.startMeasure == range.endMeasure ?
      `Bar ${range.startMeasure}` : `Bars ${range.startMeasure}–${range.endMeasure}`
    let measuresPerCard = settings.measuresPerCard
    let isAll = !(Number(measuresPerCard) >= 1)
    let order = isAll ? "as one card" : (settings.order || IN_ORDER) == RANDOM_ORDER ? "weakest first" : "in order"
    let k = isAll ? sheetMusicSectionLength(settings) : Number(measuresPerCard)

    return `${bars}, ${order}, ${hand}, ${k} bar(s) a card, ${tempoWords}`
  }

  render() {
    let {settings} = this.props
    let disabled = this.nothingToPlay()

    return <div data-setup-pane>
      <Plate className={styles.setup_pane} compact>
        <div className={styles.header_row}>
          <div className={styles.header_title}>Tonight's <span className={styles.italic}>session</span></div>
          <div className={styles.header_aside}>At rest</div>
        </div>

        {this.renderPiece()}
        {this.renderSession()}
        {this.renderCards()}
        {this.renderTempo()}

        <div className={styles.footer}>
          <p className={styles.begin_line}>{this.beginLine()}</p>
          <Pill
            variant="primary"
            className={styles.begin_button}
            disabled={disabled}
            onClick={() => this.props.begin()}>Begin</Pill>
          <a className={styles.engines_link} href={scoreEnginesPath(settings)}>Compare engraving engines</a>
        </div>
      </Plate>
    </div>
  }
}

export default SetupPane
