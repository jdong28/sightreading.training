// "Tonight's programme": the score page's rail plate before a planned
// session (st/srs/planner), shown at rest at the head of the trainer's
// right rail while the programme is played. It says what the programme
// holds for the piece (the reviews due
// and about how long they take, the new measures on offer, or, for a piece
// read through, how many bars are left to read; the target length, the
// measures learned), lets the target and, for a piece with flagged passages
// in force, the introduction order be changed, and suggests the piece in
// study most overdue when it is another one: one piece a session

import * as React from "react"
import * as types from "prop-types"

import {Plate, Pill} from "st/components/salon"
import {getAppStore} from "st/storage"
import {barsLabel} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"
import {mostOverduePiece, pulledPassage, READ_FIRST, HARDEST_FIRST, SCORE_ORDER} from "st/srs/planner"
import {introductionOrder, orderOffered, programmePassages} from "st/data"

import styles from "./programme_plate.module.css"

// the session lengths offered, in minutes
export const TARGET_MINUTES = [10, 20, 30]

// the order row's pills, in the order they are offered
const ORDER_PILLS = [
  {value: READ_FIRST, label: "Read through"},
  {value: HARDEST_FIRST, label: "Hardest first"},
  {value: SCORE_ORDER, label: "In score order"},
]

// one short line naming what the order does with the piece's flagged
// passages: the hardest one it pulls forward (pulledPassage, null when none
// of them is flagged hard enough to pull, where the orders differ by the
// read-through alone)
function orderDescription(order, flag) {
  if (order == SCORE_ORDER) {
    return "New bars arrive in score order, flagged passages included."
  }

  if (!flag) {
    return order == READ_FIRST ?
      "None of this piece's passages is flagged hard, so none is brought forward: it is read " +
        "through once, then its bars arrive in score order." :
      "None of this piece's passages is flagged hard, so this starts at the beginning, in score order."
  }

  let level = LEVEL_WORDS[flag.level].toLowerCase()
  let bars = barsLabel(flag.start, flag.end)

  return order == READ_FIRST ?
    `Read the piece through once, then ${bars}, the ${level} passage; the rest in score order.` :
    `Starts on ${bars}, the ${level} passage; the rest in score order.`
}

const plural = (count, word) => `${count} ${word}${count == 1 ? "" : "s"}`

export class ProgrammePlate extends React.Component {
  static propTypes = {
    // the trainer's generator, only a planned one (with summary) shows the plate
    generator: types.object.isRequired,
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    // picks another piece: the settings for it
    pickPiece: types.func,
    store: types.object,
    now: types.func,
  }

  static defaultProps = {
    now: Date.now,
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  setTarget(minutes) {
    let store = this.getStore()
    store.putPracticeSettings({...store.practiceSettings(), sessionMinutes: minutes})
      .then(() => this.forceUpdate())
      .catch(err => console.warn("Couldn't save the session length", err))
  }

  setOrder(order) {
    this.props.setSettings({...this.props.settings, introduce: order})
  }

  // the piece in study most overdue, when it isn't the one played
  suggestion() {
    let store = this.getStore()
    let id = mostOverduePiece({studies: store.studies(), items: store.items(), now: this.props.now()})
    return id && id != this.props.settings.piece ? store.piece(id) : null
  }

  // the order row: three pills (ORDER_PILLS) and one line naming what the
  // current one does with the piece's flagged passages, shown only while
  // the piece has flags in force for the drawer's hand (orderOffered)
  renderOrder() {
    let {settings} = this.props
    let order = introductionOrder(settings)
    let flag = pulledPassage(programmePassages(settings, this.getStore()))

    return <React.Fragment>
      <div className={styles.row}>
        <span>Order</span>
        <div className={styles.pills} role="group" aria-label="Order">
          {ORDER_PILLS.map(({value, label}) =>
            <Pill
              key={value}
              variant="choice"
              className={styles.small_pill}
              selected={value == order}
              onClick={() => {
                if (value != order) { this.setOrder(value) }
              }}>{label}</Pill>
          )}
        </div>
      </div>
      <p className={styles.order_description}>{orderDescription(order, flag)}</p>
    </React.Fragment>
  }

  render() {
    let {generator} = this.props
    if (!generator.summary) { return null }

    let summary = generator.summary()
    let learned = summary.measures ? summary.learned / summary.measures : 0
    let other = this.props.pickPiece && this.suggestion()

    return <Plate className={styles.plate} header="Tonight's programme">
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt>Reviews due</dt>
          <dd>
            {summary.due}
            {summary.due ? <span className={styles.detail}> · about {summary.dueMinutes} min</span> : null}
          </dd>
        </div>
        <div className={styles.figure}>
          <dt>{summary.toRead > 0 ? "To read through" : "New bars on offer"}</dt>
          <dd>{summary.toRead > 0 ? summary.toRead : summary.newMeasures}</dd>
        </div>
        <div className={styles.figure}>
          <dt>Target</dt>
          <dd>{summary.targetMinutes} <span className={styles.detail}>min, then play on</span></dd>
        </div>
      </dl>

      <div className={styles.learned}>
        <div className={styles.track} role="presentation">
          <div className={styles.fill} style={{width: `${Math.round(learned * 100)}%`}} />
        </div>
        <div className={styles.learned_label}>
          {summary.learned} of {plural(summary.measures, "bar")} learned
        </div>
      </div>

      {orderOffered(this.props.settings, this.getStore()) ? this.renderOrder() : null}

      <div className={styles.row}>
        <span>Session length</span>
        <div className={styles.pills} role="group" aria-label="Session length">
          {TARGET_MINUTES.map(minutes =>
            <Pill
              key={minutes}
              variant="choice"
              className={styles.small_pill}
              selected={minutes == summary.targetMinutes}
              onClick={() => {
                if (minutes != summary.targetMinutes) { this.setTarget(minutes) }
              }}>{minutes} min</Pill>
          )}
        </div>
      </div>

      {other ? <div className={styles.row} data-suggestion>
        <span>{other.title} has the most bars due.</span>
        <Pill
          variant="ghost"
          className={styles.small_pill}
          onClick={() => this.props.setSettings(this.props.pickPiece(this.props.settings, other.id))}>
          Practise it instead
        </Pill>
      </div> : null}
    </Plate>
  }
}

export default ProgrammePlate
