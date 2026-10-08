// The score-first page's passage pane (plan §D7/D11(a)): a difficulty tag's
// detail, reasons, how to practise it and Edit, in a right-hand SidePane.
// The flagged list and "The score" preview stay with the old passages
// plate's trouble-spot and overview features, which this page reaches
// instead through the Score difficulty legend's "Review the passages"
// link (the existing ReviewPane). Detail markup lifted from
// passages_plate.jsx#renderDetail.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill} from "st/components/salon"
import {SidePane} from "st/components/sight_reading/settings_panel"
import {ReviewPane} from "st/components/sight_reading/review_pane"
import {romanNumeral, barsLabel, barsHeading} from "st/music"
import {sheetMusicPiece, passageSettings} from "st/data"
import {getAppStore} from "st/storage"
import {flagsInForce} from "st/difficulty/records"
import {LEVEL_WORDS} from "st/difficulty/index"

import styles from "./passage_pane.module.css"

const HAND_LABEL = {upper: "Right hand alone", lower: "Left hand alone", both: "Hands separately"}
const SOURCE_CHIP = {score: "Score", teacher: "Teacher", player: "You"}

function handPillHand(flag) {
  return flag.hand == "both" ? "upper" : flag.hand
}

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
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    flagId: types.string,
    source: types.object,
    engine: types.string,
    loadEngines: types.func,
    store: types.object,
  }

  constructor(props) {
    super(props)
    this.state = {reviewOpen: false}
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  flags() {
    let piece = sheetMusicPiece(this.props.settings)
    if (!piece) { return [] }
    return flagsInForce(this.getStore().annotation(piece.id))
  }

  flag() {
    let flags = this.flags()
    return flags.find(f => f.id == this.props.flagId) || null
  }

  practise(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag))
    this.props.close()
  }

  practiseHand(flag) {
    this.props.setSettings(passageSettings(this.props.settings, flag, handPillHand(flag)))
    this.props.close()
  }

  openReview() {
    this.setState({reviewOpen: true})
  }

  closeReview() {
    this.setState({reviewOpen: false})
  }

  renderDetail(flag, flags) {
    let num = romanNumeral(flag.num)
    let total = romanNumeral(flags.length)
    let mark = detailStatusMark(flag)
    let moved = flag.place == "moved" && flag.movedFrom

    return <Plate
      className={styles.detail_plate}
      header={`Passage ${num} of ${total}`}
      headerAside={<span className={classNames(styles.level_label, styles[`level_${flag.level}`])}>
        {LEVEL_WORDS[flag.level]}
      </span>}>
      <h3 className={styles.flag_title}>{barsHeading(flag.start, flag.end)}</h3>
      <div className={styles.flag_sub}>{flag.title}</div>
      {flag.givenTitle !== undefined &&
        <div className={styles.given_title}>The analysis called it "{flag.givenTitle}"</div>}
      {mark && <div className={styles.status_mark}>{mark}</div>}
      {moved && <div className={styles.moved_note}>
        Moved from {barsLabel(flag.movedFrom.start, flag.movedFrom.end)}
        {flag.movedFrom.by ? ` in ${flag.movedFrom.by}'s copy` : ""}
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
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.openReview()}>
          Edit
        </Pill>
      </div>
    </Plate>
  }

  render() {
    let flag = this.flag()

    return <>
      <SidePane
        side="right"
        open={!!this.props.open && !!flag}
        close={this.props.close}
        title="Passage"
        label="Passage detail"
        closeLabel="Close passage detail">
        {flag ? this.renderDetail(flag, this.flags()) : null}
      </SidePane>

      <ReviewPane
        settings={this.props.settings}
        setSettings={this.props.setSettings}
        source={this.props.source}
        engine={this.props.engine}
        loadEngines={this.props.loadEngines}
        store={this.getStore()}
        open={this.state.reviewOpen}
        close={() => this.closeReview()}
        initialFlagId={flag ? flag.id : null} />
    </>
  }
}

export default PassagePane
