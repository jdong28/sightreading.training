// The note heads of a staff (st/components/staff_notes), drawn with the
// rhythm of the score they came from when their column carries it: the head
// of the notated value, a stem per voice, flags for an eighth and shorter,
// and augmentation dots. A note without notation, which is every note of a
// generated drill and of a piece imported before the score's rhythm was kept,
// is drawn as the whole note it always was.
//
// Beams are not drawn yet, so a beamed eighth draws its own flag.

import * as React from "react"
import classNames from "classnames"
import {parseNote, noteStaffOffset} from "st/music"

import * as types from "prop-types"
import {
  noteTypeProps, headGlyph, stemDirection, voiceGroups, voicePositions,
  middleRow, NOTE_HEAD_HEIGHT, STAFF_ROW, STEM_WIDTH, STEM_LENGTH, DOT_SIZE,
  FLAG_GLYPH,
} from "st/staff_rhythm"
import styles from "st/components/staff.module.css"

// the space between a head and its first augmentation dot, and between dots
const DOT_GAP = DOT_SIZE

export default class ScoreNotes extends React.PureComponent {
  static propTypes = {
    notes: types.array.isRequired,
    keySignature: types.object.isRequired,
    upperRow: types.number,
    lowerRow: types.number,
    pixelsPerBeat: types.number,
    offsetLeft: types.number,
    scale: types.number,
    // noteClasses, staticNoteClasses
  }

  render() {
    let stems = this.stems()
    let out = this.props.notes.map((n, idx) => this.renderNote(n, idx, stems))

    if (out.length) {
      return out
    }

    return null
  }

  // the staff row a note is drawn on, spelled in the key signature
  noteRow(note) {
    return noteStaffOffset(this.props.keySignature.enharmonic(note.note))
  }

  /**
   * The stem of each voice of each column, kept on the note it is drawn from:
   * the lowest note of a group stemming up, the highest of one stemming down.
   * Only notated values that carry a stem have one, so a column of whole
   * notes, and every note without notation, has none.
   * @returns {Map} note id -> {dir, height, flags}
   */
  stems() {
    if (this.stemsFor == this.props.notes) {
      return this.stemCache
    }

    let middle = middleRow(this.props)
    let byColumn = new Map()

    for (let note of this.props.notes) {
      let key = note.getStart()
      if (!byColumn.has(key)) {
        byColumn.set(key, [])
      }
      byColumn.get(key).push(note)
    }

    let stems = new Map()

    for (let notes of byColumn.values()) {
      let rowsByVoice = new Map()
      for (let note of notes) {
        let voice = (note.notation && note.notation.voice) || 0
        if (!rowsByVoice.has(voice)) {
          rowsByVoice.set(voice, [])
        }
        rowsByVoice.get(voice).push(this.noteRow(note))
      }

      let positions = voicePositions(rowsByVoice)

      for (let group of voiceGroups(notes.map(note => note.notation))) {
        let groupNotes = group.indices.map(idx => notes[idx])
        let notation = groupNotes.map(note => note.notation).find(n => n)
        if (!notation) { continue }

        // the shortest value of the group carries the stem's flags, as the
        // one stem is drawn for all of them
        let flags = Math.max(...groupNotes.map(note =>
          noteTypeProps(note.notation && note.notation.type).flags))

        if (!groupNotes.some(note => noteTypeProps(note.notation && note.notation.type).stem)) {
          continue
        }

        let rows = groupNotes.map(note => this.noteRow(note))
        let dir = stemDirection(rows, middle, {
          stem: notation.stem,
          voicePosition: positions[group.voice],
        })

        let anchorRow = dir == "up" ? Math.min(...rows) : Math.max(...rows)
        let anchor = groupNotes[rows.indexOf(anchorRow)]
        let span = Math.max(...rows) - Math.min(...rows)

        stems.set(anchor.id, {dir, height: STEM_LENGTH + span * STAFF_ROW, flags})
      }
    }

    this.stemsFor = this.props.notes
    this.stemCache = stems
    return stems
  }

  // the stem, its flags and the augmentation dots drawn on a note, in the
  // pixels of the staff's scale
  renderRhythm(note, stem, headWidth, scale) {
    let parts = []
    let dots = (note.notation && note.notation.dots) || 0

    if (stem) {
      let width = STEM_WIDTH * scale
      let flags = []

      for (let i = 0; i < stem.flags; i++) {
        flags.push(<img
          key={`flag-${i}`}
          className={styles.flag}
          style={{
            [stem.dir == "up" ? "top" : "bottom"]: `${i * FLAG_GLYPH.spacing * scale}px`,
            width: `${FLAG_GLYPH.width * scale}px`,
            height: `${FLAG_GLYPH.height * scale}px`,
          }}
          src={FLAG_GLYPH.src} />)
      }

      parts.push(<div
        key="stem"
        className={styles.stem}
        data-stem={stem.dir}
        style={{
          left: stem.dir == "up" ? `${headWidth - width}px` : 0,
          [stem.dir == "up" ? "bottom" : "top"]: "50%",
          width: `${width}px`,
          height: `${stem.height * scale}px`,
        }}>{flags}</div>)
    }

    for (let i = 0; i < dots; i++) {
      parts.push(<img
        key={`dot-${i}`}
        className={styles.aug_dot}
        style={{
          left: `${headWidth + DOT_GAP * scale + i * (DOT_SIZE + DOT_GAP) * scale}px`,
          width: `${DOT_SIZE * scale}px`,
          height: `${DOT_SIZE * scale}px`,
        }}
        src="/static/svg/aug_dot.svg" />)
    }

    return parts
  }

  renderNote(note, idx, stems) {
    const props = this.props
    let key = props.keySignature
    let scale = props.scale || 1

    let noteName = key.enharmonic(note.note)

    let pitch = parseNote(noteName)
    let row = noteStaffOffset(noteName)

    let fromTop = props.upperRow - row;
    let offsetLeft = props.offsetLeft || 0
    let left = offsetLeft + note.getStart() * this.props.pixelsPerBeat

    let style = {
      top: `${Math.floor(fromTop * 25/2)}%`,
      left: `${left}px`
    }

    // a head another voice doubles is written beside the one that is played
    if (note.doubled) {
      style.marginLeft = `${headGlyph(note.notation && note.notation.type, NOTE_HEAD_HEIGHT * scale).width}px`
    }

    let outside = row > props.upperRow || row < props.lowerRow
    let accidentals = key.accidentalsForNote(noteName)

    let noteClasses = null
    if (props.noteClasses) {
      noteClasses = props.noteClasses[note.id]
    }

    // a note without notation keeps the whole note the staff always drew
    let type = note.notation ? note.notation.type : "whole"

    let head = noteTypeProps(type).head
    let glyph = headGlyph(type, NOTE_HEAD_HEIGHT * scale)

    let classes = classNames(styles.note, {
      [styles.whole_note]: head == "whole",
      [styles.is_flat]: accidentals == -1,
      [styles.is_sharp]: accidentals == 1,
      [styles.is_natural]: accidentals == 0,
      [styles.outside]: outside,
      [styles.tied_head]: !!note.tiedFrom,
    }, noteClasses, props.staticNoteClasses)

    let parts = [
      <img key="head" className={styles.primary} src={glyph.src} />
    ]

    if (accidentals == 0) {
      parts.push(<img key="natural" className={classNames(styles.accidental, styles.natural)} src="/static/svg/natural.svg" />)
    }

    if (accidentals == -1) {
      parts.push(<img key="flat" className={classNames(styles.accidental, styles.flat)} src="/static/svg/flat.svg" />)
    }

    if (accidentals == 1) {
      parts.push(<img key="sharp" className={classNames(styles.accidental, styles.sharp)} src="/static/svg/sharp.svg" />)
    }

    parts.push(...this.renderRhythm(note, stems.get(note.id), glyph.width, scale))

    return <div
      key={`note-${idx}`}
      style={style}
      data-note={note.note}
      data-midi-note={pitch}
      data-note-type={note.notation ? type : null}
      data-head={head}
      className={classes}
      >{parts}</div>
  }
}
