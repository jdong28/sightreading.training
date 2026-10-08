// "Tonight's session": the score-first sheet music page's setup pane (D7),
// always on the right at rest. Reads and writes settings through the sheet
// music generator's existing inputs (st/data's SHEET_MUSIC_GENERATOR),
// reusing GeneratorSettings for each field so this never restates its
// rules: a filtered copy of the generator (same inputs array, narrowed to
// the names a group shows) renders just that group's fields. The
// programme figures, order and session-length rows carry the logic
// programme_plate.jsx used to (deleted; its only page was this one).

import * as React from "react"
import * as types from "prop-types"

import {Plate, Pill} from "st/components/salon"
import {GeneratorSettings, TempoSettings} from "st/components/sight_reading/settings_panel"
import {getAppStore} from "st/storage"
import {barsLabel} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"
import {scoreEnginesPath} from "st/score_render/route"
import {
  mostOverduePiece, pulledPassage, READ_FIRST, HARDEST_FIRST, SCORE_ORDER,
} from "st/srs/planner"
import {
  SHEET_MUSIC_GENERATOR, sheetMusicPiece, introductionOrder, orderOffered, programmePassages,
  plannedPractice, programmeOffered, sheetMusicSection, sheetMusicSectionRange, planCardMeasures,
  BOTH_HANDS, RIGHT_HAND, LEFT_HAND, WHOLE_SECTION,
} from "st/data"

import styles from "./setup_pane.module.css"

// the session lengths offered, in minutes (moved from programme_plate.jsx)
export const TARGET_MINUTES = [10, 20, 30]

const ORDER_PILLS = [
  {value: READ_FIRST, label: "Read through"},
  {value: HARDEST_FIRST, label: "Hardest first"},
  {value: SCORE_ORDER, label: "In score order"},
]

const plural = (count, word) => `${count} ${word}${count == 1 ? "" : "s"}`

// one short line naming what the order does with the piece's flagged
// passages (moved from programme_plate.jsx's orderDescription)
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
  let fromBar = flag.start > 1 ? ` from bar ${flag.start - 1}` : ""

  return order == READ_FIRST ?
    `Plays the piece through once as practice, then ${bars}, the ${level} passage, ` +
      "from the bar before it; the rest in score order." :
    `Starts on ${bars}, the ${level} passage${fromBar}.`
}

// a filtered copy of the sheet music generator, its inputs narrowed to the
// given names: GeneratorSettings renders just those fields, reading and
// writing the same full settings (see GeneratorSettings#cachedSettings).
// status is dropped: it is the same "N columns" line regardless of which
// fields a narrowed copy shows, and this pane says it itself once, in the
// Section hint (D7)
function narrowedGenerator(names) {
  return {
    ...SHEET_MUSIC_GENERATOR, status: undefined,
    inputs: SHEET_MUSIC_GENERATOR.inputs.filter(input => names.includes(input.name)),
  }
}

const PIECE_INPUTS = narrowedGenerator(["piece"])
const PRACTICE_INPUTS = narrowedGenerator(["practice"])
// the "introduce" field's own values are READ_FIRST/HARDEST_FIRST/SCORE_ORDER
// (lowercase, for storage and the begin line's prose); its pills show
// ORDER_PILLS' capitalized labels instead (D7), matching the artboard
const ORDER_INPUTS = {
  ...narrowedGenerator(["introduce"]),
  inputs: narrowedGenerator(["introduce"]).inputs.map(input => ({
    ...input,
    values: ORDER_PILLS.map(p => ({name: p.value, label: p.label})),
  })),
}
const SECTION_INPUTS = narrowedGenerator(["startMeasure", "endMeasure"])
const PASSAGE_INPUTS = narrowedGenerator(["passage"])
const SONG_INPUTS = narrowedGenerator(["song", "track"])
const HAND_INPUTS = narrowedGenerator(["hand"])
const CARDS_INPUTS = narrowedGenerator(["measuresPerCard"])
const CARD_ORDER_INPUTS = narrowedGenerator(["order"])

// the begin line's words for the tempo, see D7's formula
function tempoWords({acoustic, mode, scrollSpeed}) {
  if (acoustic) { return "graded by you." }
  return mode == "scroll" ? `scrolling at ${scrollSpeed}.` : "waiting for you."
}

export class SetupPane extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    generator: types.object, // the trainer's static generator descriptor
    liveGenerator: types.object, // the live PlanGenerator/MeasureCardGenerator, for summary()
    currentStaff: types.object,
    staves: types.array,
    keySignature: types.object,
    mode: types.oneOf(["wait", "scroll"]),
    setMode: types.func,
    scrollSpeed: types.number,
    setScrollSpeed: types.func,
    tempo: types.bool,
    setTempo: types.func,
    acoustic: types.bool,
    begin: types.func.isRequired,
    pickPiece: types.func, // the setup pane's most-overdue suggestion
    store: types.object,
    now: types.func,
  }

  static defaultProps = {
    now: Date.now,
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  settingsProps() {
    return {
      currentSettings: this.props.settings,
      setGenerator: (generator, settings) => this.props.setSettings(settings),
      currentKey: this.props.keySignature,
      currentStaff: this.props.currentStaff,
      staves: this.props.staves,
      classes: styles,
    }
  }

  // for a single-input GeneratorSettings whose own sub-label already names
  // it (Session's "session" pills, Cards' "hand"/"measuresPerCard"): hides
  // the field's own repeated label, kept by default for groups with no
  // sub-label of their own
  unlabelledProps() {
    return {...this.settingsProps(), classes: {...styles, input_label: styles.hidden_label}}
  }

  setTarget(minutes) {
    let store = this.getStore()
    store.putPracticeSettings({...store.practiceSettings(), sessionMinutes: minutes})
      .then(() => this.forceUpdate())
      .catch(err => console.warn("Couldn't save the session length", err))
  }

  // the piece in study most overdue, when it isn't the one played
  suggestion() {
    let store = this.getStore()
    let id = mostOverduePiece({studies: store.studies(), items: store.items(), now: this.props.now()})
    return id && id != this.props.settings.piece ? store.piece(id) : null
  }

  renderPieceGroup() {
    let generator = this.props.generator
    let keyHint = generator && generator.keyHint ? generator.keyHint(this.props.settings) : null

    return <div className={styles.group}>
      <div className={styles.group_label}>Piece</div>
      <GeneratorSettings generator={PIECE_INPUTS} {...this.settingsProps()} />
      {keyHint ? <div className={styles.input_hint}>{keyHint}</div> : null}
    </div>
  }

  renderOrderRow() {
    let {settings} = this.props
    let order = introductionOrder(settings)
    let flag = pulledPassage(programmePassages(settings, this.getStore()))

    return <div className={styles.sub_group}>
      <div className={styles.sub_label}>Order</div>
      <GeneratorSettings generator={ORDER_INPUTS} {...this.unlabelledProps()} />
      <p className={styles.order_description}>{orderDescription(order, flag)}</p>
    </div>
  }

  renderProgrammeFigures() {
    let liveGenerator = this.props.liveGenerator
    let summary = liveGenerator && liveGenerator.summary ? liveGenerator.summary() : null

    return <div className={styles.figures}>
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
          {summary ? summary.learned : "—"}
          {summary ? <span className={styles.figure_detail}> /{summary.measures}</span> : null}
        </div>
      </div>
    </div>
  }

  renderSessionGroup() {
    let {settings} = this.props
    let store = this.getStore()
    let planned = plannedPractice(settings, store)
    let suggestion = this.props.pickPiece && this.suggestion()
    let targetMinutes = store.practiceSettings().sessionMinutes

    return <div className={styles.group}>
      <div className={styles.group_label}>Session</div>
      {programmeOffered(settings, store) ?
        <GeneratorSettings generator={PRACTICE_INPUTS} {...this.unlabelledProps()} /> : null}

      {planned ? <>
        {this.renderProgrammeFigures()}
        <p className={styles.hint}>
          Today's programme picks each bar: the ones due for review, new ones{" "}
          {orderOffered(settings, store) ? "in the order below" : "in score order"},{" "}
          and those you missed again in a moment.
        </p>
        {suggestion ? <div className={styles.suggestion}>
          <span>{suggestion.title} has the most bars due.</span>
          <Pill
            variant="ghost"
            className={styles.small_pill}
            onClick={() => this.props.setSettings(this.props.pickPiece(settings, suggestion.id))}>
            Practise it instead
          </Pill>
        </div> : null}
        {orderOffered(settings, store) ? this.renderOrderRow() : null}
        <div className={styles.sub_group}>
          <div className={styles.sub_label}>Length</div>
          <div className={styles.pills} role="group" aria-label="Session length">
            {TARGET_MINUTES.map(minutes =>
              <Pill
                key={minutes}
                variant="choice"
                className={styles.small_pill}
                selected={minutes == targetMinutes}
                onClick={() => {
                  if (minutes != targetMinutes) { this.setTarget(minutes) }
                }}>{minutes} min</Pill>
            )}
          </div>
        </div>
      </> : this.renderFreePractice()}
    </div>
  }

  renderFreePractice() {
    let {settings} = this.props
    let hasPiece = !!sheetMusicPiece(settings)

    return <div className={styles.sub_group}>
      {hasPiece ? <>
        <div className={styles.sub_label}>Section</div>
        <GeneratorSettings generator={SECTION_INPUTS} {...this.unlabelledProps()} />
        <p className={styles.hint}>
          Marked in gilt on the score. Section has {sheetMusicSection(this.props.currentStaff, settings).columns.length} columns.
        </p>
        <div className={styles.sub_label}>Difficult passages</div>
        <GeneratorSettings generator={PASSAGE_INPUTS} {...this.unlabelledProps()} />
      </> : <GeneratorSettings generator={SONG_INPUTS} {...this.settingsProps()} />}
      {hasPiece && Number(settings.measuresPerCard) >= 1 ? <>
        <div className={styles.sub_label}>Card order</div>
        <GeneratorSettings generator={CARD_ORDER_INPUTS} {...this.unlabelledProps()} />
      </> : null}
    </div>
  }

  renderCardsGroup() {
    if (!sheetMusicPiece(this.props.settings)) { return null }

    return <div className={styles.group}>
      <div className={styles.group_label}>Cards</div>
      <div className={styles.sub_label}>Hand</div>
      <GeneratorSettings generator={HAND_INPUTS} {...this.unlabelledProps()} />
      <div className={styles.sub_label}>Bars per card</div>
      <GeneratorSettings generator={CARDS_INPUTS} {...this.unlabelledProps()} />
    </div>
  }

  renderTempoGroup() {
    if (this.props.acoustic) {
      return <div className={styles.group}>
        <div className={styles.group_label}>Tempo</div>
        <p className={styles.hint}>Acoustic piano: each card waits for your grade</p>
      </div>
    }

    return <div className={styles.group}>
      <TempoSettings
        mode={this.props.mode}
        setMode={this.props.setMode}
        scrollSpeed={this.props.scrollSpeed}
        setScrollSpeed={this.props.setScrollSpeed}
        tempo={this.props.tempo}
        setTempo={this.props.setTempo} />
    </div>
  }

  beginLine() {
    let {settings, acoustic, mode, scrollSpeed} = this.props
    let store = this.getStore()
    let planned = plannedPractice(settings, store)
    let hand = settings.hand == RIGHT_HAND ? "right hand" : settings.hand == LEFT_HAND ? "left hand" : "both hands"
    let tempo = tempoWords({acoustic, mode, scrollSpeed})

    if (planned) {
      let minutes = store.practiceSettings().sessionMinutes
      let order = introductionOrder(settings)
      let orderName = ORDER_PILLS.find(p => p.value == order)?.label.toLowerCase()
      return `About ${minutes} minutes of today's programme, ${orderOffered(settings, store) ?
        `${orderName}, ` : ""}${hand}, ${planCardMeasures(settings)} bar(s) a card, ${tempo}`
    }

    let {startMeasure, endMeasure} = sheetMusicSectionRange(settings)
    let range = startMeasure == endMeasure ? `Bar ${startMeasure}` : `Bars ${startMeasure}–${endMeasure}`
    let order = settings.order == "random" ? "weakest first" : "in order"
    let k = Number(settings.measuresPerCard) >= 1 ?
      Math.floor(Number(settings.measuresPerCard)) : endMeasure - startMeasure + 1
    let cardWords = settings.measuresPerCard == WHOLE_SECTION ? "as one card" : order

    return `${range}, ${cardWords}, ${hand}, ${k} bar(s) a card, ${tempo}`
  }

  render() {
    let {settings} = this.props

    // the trainer's own staff settles moments after mount (componentDidMount);
    // the fields below all read the current staff, so render just the header
    // until it has
    if (!this.props.currentStaff) {
      return <Plate className={styles.setup_pane}>
        <div className={styles.header}>
          <h2 className={styles.title}>Tonight's <em>session</em></h2>
          <span className={styles.aside}>At rest</span>
        </div>
      </Plate>
    }

    let piece = sheetMusicPiece(settings)
    let noPiece = !piece && !settings.song?.trim()

    return <Plate className={styles.setup_pane}>
      <div className={styles.header}>
        <h2 className={styles.title}>Tonight's <em>session</em></h2>
        <span className={styles.aside}>At rest</span>
      </div>

      {this.renderPieceGroup()}
      {noPiece ? null : <>
        {this.renderSessionGroup()}
        {this.renderCardsGroup()}
        {this.renderTempoGroup()}
      </>}

      <div className={styles.footer}>
        <p className={styles.begin_line}>{this.beginLine()}</p>
        <Pill
          variant="primary"
          className={styles.begin_button}
          disabled={noPiece}
          onClick={this.props.begin}>Begin</Pill>
        <a className={styles.engines_link} href={scoreEnginesPath(settings)}>Compare engraving engines</a>
      </div>
    </Plate>
  }
}

export default SetupPane
