// The session summary card, section 4 of docs/design/salon-de-chopin.md: a
// modal shown at Rest, built from the SessionRecord the trainer just wrote
// (see st/note_stats.js#sessionRecord and st/session_summary.js, which does
// all the deriving this component only renders).

import * as React from "react"
import * as types from "prop-types"
import {Link} from "react-router-dom"

import {Plate, Pill, StatCard, TitleBlock, FleuronRule, SectionLabel} from "st/components/salon"
import {displayNoteName} from "st/music"
import {summaryCards, troubleNotes, summaryInsight} from "st/session_summary"

import styles from "./session_summary.module.css"

export class SessionSummary extends React.Component {
  static propTypes = {
    record: types.object.isRequired,
    eyebrow: types.node,
    // null/omitted hides the "Practise these notes" pill, eg. on a page
    // whose generator can't take a seed
    onPractise: types.func,
    // exactly one of these: a path renders "New programme" as a link
    // (Pill to=), a function as a button
    onNewProgramme: types.func,
    newProgrammeTo: types.string,
    progressTo: types.string,
    onClose: types.func.isRequired,
  }

  static defaultProps = {
    progressTo: "/stats",
  }

  componentDidMount() {
    let dialog = this.dialogRef.current
    if (!dialog) { return }

    dialog.showModal()

    // "cancel" (Esc) doesn't bubble, and isn't among the events React wires
    // up for a JSX handler (see st/components/lightbox.jsx, the same
    // pattern): listen on the node itself
    this.cancelListener = e => {
      e.preventDefault()
      this.props.onClose()
    }
    dialog.addEventListener("cancel", this.cancelListener)
  }

  componentWillUnmount() {
    let dialog = this.dialogRef.current
    if (!dialog) { return }

    if (this.cancelListener) {
      dialog.removeEventListener("cancel", this.cancelListener)
    }
    if (dialog.open) {
      dialog.close()
    }
  }

  render() {
    let {record} = this.props
    let rows = troubleNotes(record)
    let insight = summaryInsight(record, rows)

    return <dialog
      ref={this.dialogRef ||= React.createRef()}
      className={styles.dialog}>
      <Plate className={styles.plate}>
        <button
          type="button"
          className={styles.dismiss}
          aria-label="Back to the trainer"
          onClick={this.props.onClose}>×</button>

        <TitleBlock
          className={styles.title}
          eyebrow={this.props.eyebrow}
          title="The session is"
          italic="ended" />
        <FleuronRule />

        <div className={styles.stat_cards}>
          {summaryCards(record).map(card =>
            <StatCard key={card.label} warm className={styles.stat_card} {...card} />)}
        </div>

        {rows.length ? this.renderTrouble(rows) : null}

        {insight ? <p className={styles.insight}>{insight}</p> : null}

        <div className={styles.actions}>
          {this.props.onPractise && rows.length ? <Pill
            variant="primary"
            className={styles.action}
            onClick={this.props.onPractise}>Practise these notes</Pill> : null}

          {this.props.newProgrammeTo ? <Pill
            variant="ghost"
            className={styles.action}
            to={this.props.newProgrammeTo}>New programme</Pill> : <Pill
            variant="ghost"
            className={styles.action}
            onClick={this.props.onNewProgramme}>New programme</Pill>}

          <Link className={styles.progress_link} to={this.props.progressTo}>
            See all progress →
          </Link>
        </div>
      </Plate>
    </dialog>
  }

  renderTrouble(rows) {
    return <div className={styles.trouble}>
      <SectionLabel rule>Notes that gave trouble</SectionLabel>
      {rows.map(row =>
        <div key={row.note} className={styles.trouble_row}>
          <span className={styles.trouble_note}>{displayNoteName(row.note)}</span>
          <span className={styles.trouble_context}>
            {row.misses} {row.misses == 1 ? "miss" : "misses"}
          </span>
          <div className={styles.track} role="presentation">
            <div
              className={styles.fill}
              data-weak={row.weak}
              style={{width: `${row.accuracy}%`}} />
          </div>
          <span className={styles.trouble_percent}>{row.accuracy}%</span>
        </div>)}
    </div>
  }
}

export default SessionSummary
