import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Pill} from "st/components/salon"
import {AGAIN, HARD} from "st/srs/grade"
import {SELF_GRADE_DWELL_MS, selfWord} from "st/srs/self_grade"

import styles from "./self_grade_row.module.css"

// The grade row of acoustic mode (st/srs/self_grade): the player plays the
// card on screen, then grades the pass themself in place of detection. One
// tap ends the pass, except that Fell apart and Stumbled on a multi-bar card
// first ask "Where?" (the generator's selfFollowUp), since detection grades
// each bar from its own columns but a self grade is for the whole card.
// Named bars (or the card's own range) get the grade; the rest get practice
// only. The optional "What slipped?" tags are stored on the review but never
// read by the scheduler (SELF_ASPECTS in st/srs/records); they clear with
// every pass, so this component keeps no state across one (see its key in
// SightReadingPage#renderSelfGrade).
//
// The row is controlled: the page is the authority on whether "Where?" is
// open (asking) and on the grade being flashed before it is written
// (recorded), since it needs both to draw the card's bar badges and to write
// the grade once the flash ends. A grade() or chooseWhere() while recorded is
// set is ignored outright (the pass has already ended); changeGrade() isn't,
// since going back to the pills never writes anything.
//
// Nothing is graded within SELF_GRADE_DWELL_MS of the row changing what it
// shows: a pass can't have been played in that time, and the second tap of a
// double tap would otherwise answer for whatever took the place of what was
// tapped (the next card's pills, or the chip the question put under the
// pill). Change grade re-arms the dwell rather than answering for whatever
// the pills showed before it.
export default class SelfGradeRow extends React.Component {
  static propTypes = {
    grades: types.array.isRequired,
    // the "Where?" question for a failing grade on this card, from
    // generator.selfFollowUp, null for a one-measure card or Clean/Easy
    followUp: types.object,
    // the optional "What slipped?" tags offered with the grades, SELF_ASPECTS
    // (st/srs/records); left out to offer none
    aspects: types.array,
    // the failing grade whose "Where?" is open, or null for the grade pills
    asking: types.number,
    // {grade, bars} being flashed before it is written, or null
    recorded: types.object,
    onAsk: types.func.isRequired,
    onGrade: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {slipped: []}
    // when the row last changed what it shows: mounted with the card (it is
    // keyed by it) and set again as the "Where?" question takes the pills'
    // place, or change grade takes it back, the one time every way in is
    // measured from
    this.shownAt = Date.now()
  }

  /** @returns {boolean} whether what the row shows has been up long enough to answer */
  settled() {
    return Date.now() - this.shownAt >= SELF_GRADE_DWELL_MS
  }

  toggleAspect(aspect) {
    this.setState(state => ({
      slipped: state.slipped.includes(aspect) ?
        state.slipped.filter(a => a != aspect) :
        [...state.slipped, aspect],
    }))
  }

  // the one path a grade takes, from a pill or the page's hotkeys: a grade
  // with a "Where?" question asks it rather than ending the pass
  grade(grade) {
    if (this.props.recorded || !this.settled()) { return }

    if (this.props.followUp && (grade == AGAIN || grade == HARD)) {
      this.shownAt = Date.now()
      this.props.onAsk(grade)
      return
    }

    this.props.onGrade(grade, {slipped: this.state.slipped})
  }

  chooseWhere(value) {
    if (!this.settled()) { return }
    this.props.onGrade(this.props.asking, {bars: value, slipped: this.state.slipped})
  }

  // back to the pills, nothing graded, the tags kept
  changeGrade() {
    if (this.props.recorded) { return }
    this.props.onAsk(null)
    this.shownAt = Date.now()
  }

  render() {
    let {asking, followUp, aspects, recorded} = this.props

    if (asking != null && followUp) {
      return this.renderFollowUp(asking, followUp, recorded)
    }

    return <div className={styles.row} data-self-grade>
      {aspects && aspects.length > 0 && this.renderAspects(aspects, recorded)}
      <div className={styles.grades}>
        {this.props.grades.map(grade => this.renderGrade(grade, recorded))}
      </div>
    </div>
  }

  renderGrade({key, word, grade, definition}, recorded) {
    let isRecorded = !!recorded && recorded.grade == grade
    return <Pill
      key={grade}
      variant="choice"
      selected={isRecorded}
      disabled={!!recorded}
      className={classNames(styles.grade_pill, {[styles.recorded]: isRecorded})}
      onClick={e => {
        e.currentTarget.blur()
        this.grade(grade)
      }}>
      <span className={styles.grade_key} aria-hidden="true">{key}</span>
      <span className={styles.grade_word}>{isRecorded ? "✓ " : ""}{word}</span>
      <span className={styles.grade_definition}>{definition}</span>
    </Pill>
  }

  renderFollowUp(asking, followUp, recorded) {
    let chosen = value => !!recorded && JSON.stringify(value) === JSON.stringify(recorded.bars ?? null)

    return <div className={styles.row} data-self-grade-followup>
      <p className={styles.prompt}>{selfWord(asking)} — where did it go wrong?</p>
      <button
        type="button"
        className={styles.change_grade}
        disabled={!!recorded}
        onClick={e => {
          e.currentTarget.blur()
          this.changeGrade()
        }}>
        ‹ change grade
      </button>
      <div className={styles.chips}>
        {followUp.choices.map(choice =>
          <Pill
            key={choice.label}
            variant="choice"
            selected={chosen(choice.value)}
            disabled={!!recorded}
            className={styles.chip}
            onClick={e => {
              e.currentTarget.blur()
              this.chooseWhere(choice.value)
            }}>
            {choice.label}
          </Pill>)}
      </div>
    </div>
  }

  renderAspects(aspects, recorded) {
    let {slipped} = this.state
    return <div className={styles.aspects}>
      <span className={styles.aspects_label}>Before you grade, anything slip? (optional)</span>
      <div className={styles.chips}>
        {aspects.map(aspect =>
          <Pill
            key={aspect}
            variant="choice"
            selected={slipped.includes(aspect)}
            disabled={!!recorded}
            className={styles.chip}
            onClick={e => {
              e.currentTarget.blur()
              this.toggleAspect(aspect)
            }}>
            {aspect}
          </Pill>)}
      </div>
    </div>
  }
}
