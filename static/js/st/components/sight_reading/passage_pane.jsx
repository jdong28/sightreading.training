// The score-first sheet music page's passage pane (D4/Open question 4a): a
// flagged passage's detail (reasons, how to practise it, Practise, hands
// separately, Edit) beside the "Flagged passages" list, moved from
// passages_plate.jsx (376-466) into a right SidePane titled "Passage I of
// N", opened by a difficulty tag (ScoreView). Practise and the hand pill
// begin the session at once, like the bar pop-up's own Practise button.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import {SidePane} from "st/components/sight_reading/settings_panel"
import {romanNumeral, barsLabel, barsHeading} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"

import styles from "./passage_pane.module.css"

const HAND_LABEL = {upper: "Right hand alone", lower: "Left hand alone", both: "Hands separately"}
const SOURCE_CHIP = {score: "Score", teacher: "Teacher", player: "You"}

// a passage to practise hands separately offers the right hand first
function handPillHand(flag) {
  return flag.hand == "both" ? "upper" : flag.hand
}

// the detail plate's small instructor mark, for a flag in force a decision
// has touched (never shown for a waiting proposal)
function detailStatusMark(flag) {
  let by = flag.by ? ` by ${flag.by}` : ""
  if (flag.status == "accepted") { return "❖ Accepted" }
  if (flag.status == "edited") { return `❖ Edited${by}` }
  if (flag.status == "added") { return `❖ Added${by}` }
  return null
}

export class PassagePane extends React.Component {
  static propTypes = {
    open: types.bool,
    close: types.func.isRequired,
    flags: types.array.isRequired, // flagsInForce's list, hardest first
    selectedId: types.string,
    onSelect: types.func.isRequired,
    onPractise: types.func.isRequired, // (flag) => void, begins at once
    onPractiseHand: types.func.isRequired, // (flag) => void, begins at once
    onEdit: types.func.isRequired, // (flagId) => void, opens the review pane
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
        <Pill variant="primary" className={styles.small_pill} onClick={() => this.props.onPractise(flag)}>
          {`Practise ${barsLabel(flag.start, flag.end)}`}
        </Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.props.onPractiseHand(flag)}>
          {HAND_LABEL[flag.hand]}
        </Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.props.onEdit(flag.id)}>
          Edit
        </Pill>
      </div>
    </Plate>
  }

  renderList(flags, selected) {
    return <Plate className={styles.compact_plate} header="Flagged passages" headerAside="hardest first">
      <ul className={styles.flag_list}>
        {flags.map(flag =>
          <li
            key={flag.id}
            className={classNames({[styles.on]: flag.id == selected.id})}>
            <button type="button" onClick={() => this.props.onSelect(flag.id)}>
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
    let {flags, selectedId} = this.props
    let selected = flags.find(flag => flag.id == selectedId) || flags[0]
    if (!selected) { return null }

    return <SidePane
      side="right"
      open={this.props.open}
      close={this.props.close}
      title={`Passage ${romanNumeral(selected.num)} of ${romanNumeral(flags.length)}`}
      label="Passage detail"
      closeLabel="Close the passage pane">
      <div className={styles.pane_body}>
        {this.renderDetail(selected, flags)}
        {this.renderList(flags, selected)}
      </div>
    </SidePane>
  }
}

export default PassagePane
