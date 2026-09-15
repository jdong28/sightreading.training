import * as React from "react"

import * as types from "prop-types"
import {parseNote, noteStaffOffset, MIDDLE_C_PITCH} from "st/music"

import {SongNoteList, SongNote} from "st/song_note_list"
import LedgerLines, {LEDGER_OVERHANG} from "st/components/staff/ledger_lines"
import WholeNotes from "st/components/staff/whole_notes"
import styles from "st/components/staff.module.css"

// The unscaled horizontal layout of the notes on a staff (st/components/staves),
// which the staff's scale multiplies. See .staff_notes, .key_signature and
// .group_offset in staff.module.css
export const STAFF_NOTES_LEFT = 120
export const KEY_SIGNATURE_SPACING = 20
// a whole note head is 20% of the 120px staff, noteheads.s0.svg is 1.69:1
export const NOTE_HEAD_WIDTH = 120 * 0.2 * 1.69
// how far right a note a second away from the one below it in its column sits
export const GROUP_OFFSET = 30

// room right of the last column: its note head, a stacked second's offset and
// the ledger lines' overhang
const LAST_COLUMN_WIDTH = NOTE_HEAD_WIDTH + GROUP_OFFSET + LEDGER_OVERHANG

// the space a key signature takes before the first column, unscaled
export function keySignatureWidth(keySignature) {
  let count = Math.abs(keySignature ? keySignature.count : 0)
  return count > 0 ? (count + 1) * KEY_SIGNATURE_SPACING : 0
}

// the unscaled width a staff wrapper needs besides the span of the columns
function fixedWidth(keySignature) {
  return STAFF_NOTES_LEFT + keySignatureWidth(keySignature) + LAST_COLUMN_WIDTH
}

// The width of a column, unscaled like the staff's noteWidth, that fits
// columns spanning span columns in a staff wrapper of staffWidth
// pixels drawn at scale. No wider than maxWidth, and no narrower than
// minWidth, when the columns run on past the edge
export function fitNoteWidth(staffWidth, span, {scale=1, keySignature=null, maxWidth, minWidth}) {
  if (!(staffWidth > 0) || !(span > 0)) {
    return maxWidth
  }

  let width = Math.floor((staffWidth / scale - fixedWidth(keySignature)) / span)
  return Math.max(minWidth, Math.min(maxWidth, width))
}

// The scale, at most scale and no less than minScale, at which columns
// spanning span fit a staff wrapper of staffWidth pixels at minWidth apart
export function fitStaffScale(staffWidth, span, {scale=1, keySignature=null, minWidth, minScale}) {
  if (!(staffWidth > 0) || !(span > 0)) {
    return scale
  }

  let fit = staffWidth / (fixedWidth(keySignature) + span * minWidth)
  return Math.max(Math.min(minScale, scale), Math.min(scale, fit))
}

export default class StaffNotes extends React.Component {
  static propTypes = {
    keySignature: types.object.isRequired,
    noteWidth: types.number.isRequired,
    notes: types.array.isRequired,

    upperRow: types.number.isRequired,
    lowerRow: types.number.isRequired,
    heldNotes: types.object.isRequired,
    noteShaking: types.bool,
  }

  render() {
    let [songNotes, noteClasses] = this.convertToSongNotes()
    let heldSongNotes = this.convertHeldToSongNotes()

    let scale = this.props.scale || 1
    let offsetLeft = keySignatureWidth(this.props.keySignature) * scale

    return <div ref="notes" className={this.classNames()}>
      <LedgerLines key="ledger_lines"
        offsetLeft={offsetLeft}
        upperRow={this.props.upperRow}
        lowerRow={this.props.lowerRow}
        notes={songNotes.concat(heldSongNotes)}
        pixelsPerBeat={this.props.noteWidth}
        scale={scale}
      />

      <WholeNotes key="notes"
        offsetLeft={offsetLeft}
        keySignature={this.props.keySignature}
        upperRow={this.props.upperRow}
        lowerRow={this.props.lowerRow}
        notes={songNotes}
        noteClasses={noteClasses}
        pixelsPerBeat={this.props.noteWidth}
      />

      <WholeNotes key="held_notes"
        offsetLeft={offsetLeft}
        keySignature={this.props.keySignature}
        upperRow={this.props.upperRow}
        lowerRow={this.props.lowerRow}
        notes={heldSongNotes}
        staticNoteClasses={styles.held}
        pixelsPerBeat={this.props.noteWidth}
      />

      {this.renderBarLines(offsetLeft)}
      {this.renderAnnotations()}
    </div>
  }

  convertHeldToSongNotes() {
    if (!this.props.heldNotes) {
      return []
    }

    let notes = new SongNoteList()
    let dur = 40 / this.props.noteWidth

    // notes that are held down but aren't correct
    Object.keys(this.props.heldNotes)
      .filter((note) => !this.props.notes.inHead(note))
      .forEach((note, idx) => {
        notes.push(new SongNote(note, 0, dur))
      })

    return this.filterVisibleNotes(notes)
  }

  // filter notes so only the ones visible for this staff returned
  filterVisibleNotes(notes) {
    if (notes.length == 0) {
      return notes
    }

    if (!this.props.filterPitch) {
      return notes
    }

    let out = new SongNoteList()
    notes.forEach(n => {
      let pitch = parseNote(n.note)
      if (this.props.filterPitch(pitch)) {
        out.push(n)
      }
    })

    return out
  }

  convertToSongNotes() {
    let notes = new SongNoteList()
    let beat = 0
    let dur = 40 / this.props.noteWidth

    let noteClasses = {}

    let toRow = n =>
      noteStaffOffset(this.props.keySignature.enharmonic(n))

    let appendClass = (note, cls) => {
      let mappedClass = styles[cls] || cls
      if (noteClasses[note.id]) {
        noteClasses[note.id].push(mappedClass)
      } else {
        noteClasses[note.id] = [mappedClass]
      }
    }

    this.props.notes.forEach((column, columnIdx) => {
      let withClasses = (note) => {
        if (columnIdx == 0) {
          if (this.props.noteShaking) {
            appendClass(note, "noteshake")
          }

          if (this.props.heldNotes[note.note]) {
            appendClass(note, "held")
          }
        }

        return note
      }

      if (Array.isArray(column)) {
        let tuples = column.map(n =>
          [toRow(n), n]
        )

        let lastRow = null
        let offset = 0
        tuples.forEach(([row, n]) => {
          if (lastRow && Math.abs(lastRow - row) == 1) {
            if (offset == 0) {
              offset = 1
            } else {
              offset = 0
            }
          } else {
            offset = 0
          }

          let sNote = new SongNote(n, beat, dur)

          if (offset == 1) {
            appendClass(sNote, "group_offset")
          }

          lastRow = row
          notes.push(withClasses(sNote))
        })

      } else {
        notes.push(withClasses(new SongNote(column, beat, dur)))
      }

      beat += 1
    })

    return [this.filterVisibleNotes(notes), noteClasses]
  }

  classNames()  {
    return styles.staff_notes
  }

  setOffset(amount) {
    this.refs.notes.style.transform = `translate3d(${amount}px, 0, 0)`;
  }

  // A bar line before each column that starts a measure, on the boundary
  // halfway between the previous column's note head and the column, so it
  // moves with its column. The bar number is written above it, on the upper
  // staff only of a grand staff
  renderBarLines(offsetLeft) {
    let noteWidth = this.props.noteWidth
    let headWidth = NOTE_HEAD_WIDTH * (this.props.scale || 1)
    let before = (noteWidth - headWidth) / 2
    let showNumbers = this.props.showAnnotations !== false

    let out = []
    this.props.notes.forEach((column, idx) => {
      if (column.measure == null) { return }

      out.push(<div
        key={`bar-line-${idx}`}
        className={styles.bar_line}
        style={{left: `${Math.round(offsetLeft + idx * noteWidth - before)}px`}}
        data-measure={column.measure}
        data-label={showNumbers ? column.measure : null} />)
    })

    return out
  }

  renderAnnotations() {
    if (this.props.showAnnotations === false) {
      return null
    }

    let out = []
    this.props.notes.forEach((column, idx) => {
      if (column.annotation) {
        let style = {
          top: "-60%",
          left: `${idx * this.props.noteWidth}px`
        }
        out.push(<div
          style={style}
          className={styles.annotation}
          key={`annotation-${idx}`}>
          {column.annotation}
        </div>)
      }
    })

    return out
  }
}
