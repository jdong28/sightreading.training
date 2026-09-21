import * as React from "react"

import * as types from "prop-types"
import {parseNote, noteStaffOffset} from "st/music"

import {SongNoteList, SongNote} from "st/song_note_list"
import LedgerLines from "st/components/staff/ledger_lines"
import WholeNotes from "st/components/staff/whole_notes"
import styles from "st/components/staff.module.css"

// The unscaled spacing of a key signature's accidentals, which the staff's
// scale multiplies. See .key_signature in staff.module.css
export const KEY_SIGNATURE_SPACING = 20

// the space a key signature takes before the first column, unscaled
export function keySignatureWidth(keySignature) {
  let count = Math.abs(keySignature ? keySignature.count : 0)
  return count > 0 ? (count + 1) * KEY_SIGNATURE_SPACING : 0
}

// Whether each note of a column is pushed right by the group offset: the
// upper note of a second stacked on the note before it
export function groupOffsets(column, keySignature) {
  let lastRow = null
  let offset = false
  return column.map(note => {
    let row = noteStaffOffset(keySignature.enharmonic(note))
    offset = lastRow && Math.abs(lastRow - row) == 1 ? !offset : false
    lastRow = row
    return offset
  })
}

// The notes of a column a staff draws, and whether each is pushed right by
// the group offset: the notes of the column the staff's pitch filter keeps
export function staffColumnNotes(column, {keySignature, filterPitch}) {
  let notes = Array.isArray(column) ? column : [column]
  let offsets = groupOffsets(notes, keySignature)

  if (!filterPitch) {
    return [notes, offsets]
  }

  let keep = notes.map(n => filterPitch(parseNote(n)))
  return [notes.filter((n, idx) => keep[idx]), offsets.filter((o, idx) => keep[idx])]
}

// The columns of a drill drawn one column width apart, each note a whole note
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

      {this.renderAnnotations()}
    </div>
  }

  // The notes held down that aren't in the head column, drawn on it so they
  // show against the column being judged
  convertHeldToSongNotes() {
    if (!this.props.heldNotes) {
      return []
    }

    let notes = new SongNoteList()
    let dur = 40 / this.props.noteWidth

    Object.keys(this.props.heldNotes)
      .filter((note) => !this.props.notes.inHead(note))
      .forEach((note) => {
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

  // every head the staff draws, one column width a column
  convertToSongNotes() {
    let notes = new SongNoteList()
    let dur = 40 / this.props.noteWidth

    let noteClasses = {}

    let appendClass = (note, cls) => {
      let mappedClass = styles[cls] || cls
      if (noteClasses[note.id]) {
        noteClasses[note.id].push(mappedClass)
      } else {
        noteClasses[note.id] = [mappedClass]
      }
    }

    this.props.notes.forEach((column, columnIdx) => {
      let [columnNotes, groupOffset] = staffColumnNotes(column, this.props)

      columnNotes.forEach((n, idx) => {
        let sNote = new SongNote(n, columnIdx, dur)

        if (groupOffset[idx]) {
          appendClass(sNote, "group_offset")
        }

        if (columnIdx == 0) {
          if (this.props.noteShaking) {
            appendClass(sNote, "noteshake")
          }

          if (this.props.heldNotes[sNote.note]) {
            appendClass(sNote, "held")
          }
        }

        notes.push(sNote)
      })
    })

    return [notes, noteClasses]
  }

  classNames()  {
    return styles.staff_notes
  }

  setOffset(amount) {
    this.refs.notes.style.transform = `translate3d(${amount}px, 0, 0)`;
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
