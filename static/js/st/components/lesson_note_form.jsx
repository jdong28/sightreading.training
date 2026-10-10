// The form a note for the next lesson is written in (st/lesson_notes), shared
// by a clicked bar's window and the "For my lesson" tab: the words, a topic
// (one chip at a time, tapped again to clear), what the record says (a
// snapshot kept with the note unless unticked) and, in the tab, which piece
// the note is on. Escape closes only the form, so the window it sits in stays
// open.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Pill} from "st/components/salon"
import {LESSON_TOPICS, NOTE_MAX_CHARS, evidenceWords} from "st/lesson_notes"

import styles from "./lesson_note_form.module.css"

export class LessonNoteForm extends React.Component {
  static propTypes = {
    // the note's words when editing or adding to one
    initialText: types.string,
    initialTopic: types.string,
    // what the record says, {accuracy, line}: offered as "Attach what happened"
    evidence: types.object,
    // the pieces a note can be on, [{key, label}], and the one chosen to begin with
    pieces: types.array,
    initialPiece: types.string,
    // "Your note" by default
    label: types.string,
    saveLabel: types.string,
    // called with {text, topic, attach, piece}; may return a promise, the form
    // staying as it is (and saving once) until it settles
    onSave: types.func.isRequired,
    onCancel: types.func.isRequired,
    autoFocus: types.bool,
    className: types.string,
  }

  static defaultProps = {
    initialText: "",
    initialTopic: null,
    label: "Your note",
    saveLabel: "Save note",
    autoFocus: true,
  }

  constructor(props) {
    super(props)
    this.state = {
      text: props.initialText,
      topic: props.initialTopic,
      attach: true,
      piece: props.initialPiece ?? (props.pieces && props.pieces[0] && props.pieces[0].key),
      saving: false,
    }
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  onKeyDown(e) {
    if (e.key == "Escape") {
      e.stopPropagation()
      this.props.onCancel()
    }
  }

  async save() {
    let {text, topic, attach, piece, saving} = this.state
    if (saving || !text.trim()) { return }

    this.setState({saving: true})
    try {
      await this.props.onSave({text: text.trim(), topic, attach: attach && !!this.props.evidence, piece})
    } finally {
      if (!this.unmounted) { this.setState({saving: false}) }
    }
  }

  render() {
    let {evidence, pieces, label, saveLabel, className} = this.props
    let {text, topic, attach, piece, saving} = this.state
    let words = evidenceWords(evidence)

    return <form
      className={classNames(styles.form, className)}
      onKeyDown={e => this.onKeyDown(e)}
      onSubmit={e => { e.preventDefault(); this.save() }}>
      {pieces && pieces.length > 0 && <div className={styles.chips} role="group" aria-label="What the note is about">
        {pieces.map(option =>
          <Pill
            key={option.key}
            variant="choice"
            selected={piece == option.key}
            onClick={() => this.setState({piece: option.key})}>{option.label}</Pill>)}
      </div>}

      <label className={styles.field}>
        <span className={styles.label}>{label}</span>
        <textarea
          className={styles.text}
          rows={3}
          maxLength={NOTE_MAX_CHARS}
          autoFocus={this.props.autoFocus}
          placeholder="What do you want to ask?"
          value={text}
          onChange={e => this.setState({text: e.target.value})} />
      </label>

      <div className={styles.chips} role="group" aria-label="Topic">
        {LESSON_TOPICS.map(option =>
          <Pill
            key={option.key}
            variant="choice"
            selected={topic == option.key}
            onClick={() => this.setState({topic: topic == option.key ? null : option.key})}>{option.label}</Pill>)}
      </div>

      {words && <label className={styles.attach}>
        <input
          type="checkbox"
          checked={attach}
          onChange={e => this.setState({attach: e.target.checked})} />
        <span>Attach what happened: <strong>{words}</strong></span>
      </label>}

      <div className={styles.actions}>
        <Pill variant="primary" type="submit" className={styles.save} disabled={saving || !text.trim()}>
          {saveLabel}
        </Pill>
        <Pill variant="ghost" onClick={this.props.onCancel}>Cancel</Pill>
      </div>
    </form>
  }
}

export default LessonNoteForm
