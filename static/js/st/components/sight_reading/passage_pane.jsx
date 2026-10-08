// The passage pane (score-first design §F): a flagged passage's detail
// (reasons, how to practise it, Practise, hands-separately, Edit) and the
// flagged list, in a right SidePane opened by a difficulty tag on the
// score. Moved from the old "piece at a glance" rail plate
// (passages_plate.jsx), minus the glance strip and "Show the score" (the
// page is the score now, shaded by difficulty). Practise and the hand pill
// begin the session at once, like the bar pop-up's.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import {SidePane} from "st/components/sight_reading/settings_panel"
import {romanNumeral, barsLabel, barsHeading} from "st/music"
import {passageSettings} from "st/data"
import {LEVEL_WORDS} from "st/difficulty/index"

import styles from "./passage_pane.module.css"

const HAND_LABEL = {upper: "Right hand alone", lower: "Left hand alone", both: "Hands separately"}
const SOURCE_CHIP = {score: "Score", teacher: "Teacher", player: "You"}

// a passage to practise hands separately offers the right hand first
function handPillHand(flag) {
  return flag.hand == "both" ? "upper" : flag.hand
}

// the instructor's small mark for a flag a decision has touched, never
// shown for a waiting proposal
function detailStatusMark(flag) {
  let by = flag.by ? ` by ${flag.by}` : ""
  if (flag.status == "accepted") { return "❖ Accepted" }
  if (flag.status == "edited") { return `❖ Edited${by}` }
  if (flag.status == "added") { return `❖ Added${by}` }
  return null
}

export class PassagePane extends React.Component {
  static propTypes = {
    flags: types.array.isRequired,
    initialFlagId: types.string,
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    // begins the session at once, after Practise/the hand pill applies
    // the settings
    onBegin: types.func.isRequired,
    onEdit: types.func,
    open: types.bool,
    close: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {selectedId: props.initialFlagId || null}
  }

  componentDidUpdate(prevProps) {
    if (this.props.open && (!prevProps.open || this.props.initialFlagId != prevProps.initialFlagId)) {
      this.setState({selectedId: this.props.initialFlagId || null})
    }
  }

  select(id) {
    this.setState({selectedId: id})
  }

  practise(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag))
    this.props.onBegin()
  }

  practiseHand(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag, handPillHand(flag)))
    this.props.onBegin()
  }

  renderDetail(flag, flags) {
    let num = romanNumeral(flag.num)
    let total = romanNumeral(flags.length)
    let mark = detailStatusMark(flag)
    let moved = flag.place == "moved" && flag.movedFrom

    return <Plate
      className={styles.compact_plate}
      header={`Passage ${num} of ${total}`}
      headerAside={<span className={classNames(styles.level_label, styles[`level_${flag.level}`])}>
        {LEVEL_WORDS[flag.level]}
      </span>}>
      <h3 className={styles.flag_title}>{barsHeading(flag.start, flag.end)}</h3>
      <div className={styles.flag_sub}>{flag.title}</div>
      {flag.givenTitle !== undefined &&
        <div className={styles.given_title}>The analysis called it “{flag.givenTitle}”</div>}
      {mark && <div className={styles.status_mark}>{mark}</div>}
      {moved && <div className={styles.moved_note}>
        Moved from {barsLabel(flag.movedFrom.start, flag.movedFrom.end)}
        {flag.movedFrom.by ? ` in ${flag.movedFrom.by}’s copy` : ""}
      </div>}

      <ul className={styles.reasons}>
        {flag.lines.map((line, idx) =>
          <li key={idx}>
            <span className={styles.source_chip}>{SOURCE_CHIP[line.source] || "Score"}</span>
            {line.text}
          </li>)}
      </ul>

      <div className={styles.tip}>
        <div className={styles.tip_label}>How to practise it</div>
        <p>{flag.tip}</p>
      </div>

      <div className={styles.actions}>
        <Pill variant="primary" className={styles.small_pill} onClick={() => this.practise(flag)}>
          {`Practise ${barsLabel(flag.start, flag.end)}`}
        </Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.practiseHand(flag)}>
          {HAND_LABEL[flag.hand]}
        </Pill>
        {this.props.onEdit && <Pill variant="ghost" className={styles.small_pill} onClick={() => this.props.onEdit(flag.id)}>
          Edit
        </Pill>}
      </div>
    </Plate>
  }

  renderList(flags, selectedId) {
    return <Plate className={styles.compact_plate} header="Flagged passages" headerAside="hardest first">
      <ul className={styles.flag_list}>
        {flags.map(flag =>
          <li key={flag.id} className={classNames({[styles.on]: flag.id == selectedId})}>
            <button type="button" onClick={() => this.select(flag.id)}>
              <span className={classNames(styles.list_num, styles[`level_${flag.level}`])}>
                {romanNumeral(flag.num)}
              </span>
              <span className={styles.list_title}>{flag.title}</span>
              <span className={styles.list_bars}>{barsHeading(flag.start, flag.end)}</span>
            </button>
          </li>)}
      </ul>
    </Plate>
  }

  render() {
    let {flags} = this.props
    if (!flags.length) { return null }

    let selected = flags.find(flag => flag.id == this.state.selectedId) || flags[0]

    return <SidePane
      side="right"
      open={this.props.open}
      close={this.props.close}
      title={`Passage ${romanNumeral(selected.num)} of ${romanNumeral(flags.length)}`}
      label="Passage"
      closeLabel="Close the passage">
      <div className={styles.body}>
        {this.renderDetail(selected, flags)}
        {this.renderList(flags, selected.id)}
      </div>
    </SidePane>
  }
}

export default PassagePane
