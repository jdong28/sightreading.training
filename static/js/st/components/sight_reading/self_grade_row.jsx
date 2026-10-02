import * as React from "react"
import * as types from "prop-types"

import {Pill} from "st/components/salon"
import {AGAIN, HARD} from "st/srs/grade"
import {SELF_GRADE_DWELL_MS} from "st/srs/self_grade"

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
// Nothing is graded within SELF_GRADE_DWELL_MS of the row changing what it
// shows: a pass can't have been played in that time, and the second tap of a
// double tap would otherwise answer for whatever took the place of what was
// tapped (the next card's pills, or the chip the question put under the pill).
export default class SelfGradeRow extends React.Component {
  static propTypes = {
    grades: types.array.isRequired,
    // the "Where?" question for a failing grade on this card, from
    // generator.selfFollowUp, null for a one-measure card or Clean/Easy
    followUp: types.object,
    // the optional "What slipped?" tags, SELF_ASPECTS when Q1's option C is on
    aspects: types.array,
    onGrade: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {pendingGrade: null, slipped: []}
    // when the row last changed what it shows: mounted with the card (it is
    // keyed by it) and set again as the "Where?" question takes the pills'
    // place, the one time every way in is measured from
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
  // with a "Where?" question waits for the answer rather than ending the pass
  grade(grade) {
    if (this.state.pendingGrade != null || !this.settled()) { return }

    if (this.props.followUp && (grade == AGAIN || grade == HARD)) {
      this.shownAt = Date.now()
      this.setState({pendingGrade: grade})
      return
    }

    this.props.onGrade(grade, {slipped: this.state.slipped})
  }

  chooseWhere(value) {
    if (!this.settled()) { return }

    this.props.onGrade(this.state.pendingGrade, {bars: value, slipped: this.state.slipped})
  }

  render() {
    let {followUp, aspects} = this.props
    let {pendingGrade} = this.state

    if (pendingGrade != null && followUp) {
      return this.renderFollowUp(followUp)
    }

    return <div className={styles.row} data-self-grade>
      <div className={styles.grades}>
        {this.props.grades.map(grade => this.renderGrade(grade))}
      </div>
      {aspects && aspects.length > 0 && this.renderAspects(aspects)}
    </div>
  }

  renderGrade({key, word, grade, definition}) {
    return <Pill
      key={grade}
      variant="choice"
      className={styles.grade_pill}
      onClick={e => {
        e.currentTarget.blur()
        this.grade(grade)
      }}>
      <span className={styles.grade_key} aria-hidden="true">{key}</span>
      <span className={styles.grade_word}>{word}</span>
      <span className={styles.grade_definition}>{definition}</span>
    </Pill>
  }

  renderFollowUp({prompt, choices}) {
    return <div className={styles.row} data-self-grade-followup>
      <p className={styles.prompt}>{prompt}</p>
      <div className={styles.chips}>
        {choices.map(choice =>
          <Pill
            key={choice.label}
            variant="choice"
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

  renderAspects(aspects) {
    let {slipped} = this.state
    return <div className={styles.aspects}>
      <span className={styles.aspects_label}>What slipped?</span>
      <div className={styles.chips}>
        {aspects.map(aspect =>
          <Pill
            key={aspect}
            variant="choice"
            selected={slipped.includes(aspect)}
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
