// "Tonight's programme": the score page's preface to a planned session
// (st/srs/planner), shown at rest above the staff while the programme is
// played. It says what the programme holds for the piece (the reviews due
// and about how long they take, the new measures on offer, the target
// length, the measures learned), lets the target be changed, and suggests
// the piece in study most overdue when it is another one: one piece a session

import * as React from "react"
import * as types from "prop-types"

import {Plate, Pill} from "st/components/salon"
import {getAppStore} from "st/storage"
import {mostOverduePiece} from "st/srs/planner"

import styles from "./programme_plate.module.css"

// the session lengths offered, in minutes
export const TARGET_MINUTES = [10, 20, 30]

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

  // the piece in study most overdue, when it isn't the one played
  suggestion() {
    let store = this.getStore()
    let id = mostOverduePiece({studies: store.studies(), items: store.items(), now: this.props.now()})
    return id && id != this.props.settings.piece ? store.piece(id) : null
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
          <dt>New bars on offer</dt>
          <dd>{summary.newMeasures}</dd>
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
