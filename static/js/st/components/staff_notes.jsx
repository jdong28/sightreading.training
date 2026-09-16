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
const STAFF_HEIGHT = 120
// a whole note head is 20% of the staff, noteheads.s0.svg is 1.69:1
const NOTE_HEAD_HEIGHT = STAFF_HEIGHT * 0.2
export const NOTE_HEAD_WIDTH = NOTE_HEAD_HEIGHT * 1.69
// how far a sharp, the widest accidental, reaches left of its note head: it
// ends 10% of a head short of it and is three heads tall, sharp.svg is 245:1024
export const ACCIDENTAL_WIDTH = NOTE_HEAD_WIDTH * 0.1 + NOTE_HEAD_HEIGHT * 3 * 245 / 1024
// how far right a note a second away from the one below it in its column sits
export const GROUP_OFFSET = 30

// the space between an accidental and the note heads of the column before it
const ACCIDENTAL_GAP = 4

// the space a clef change keeps from the note heads and accidentals around it
const CLEF_CHANGE_MARGIN = 2
// the narrowest clef change drawn on the staff, else a small one goes above it
const MIN_CLEF_CHANGE_WIDTH = 10
// the size of a clef change above the staff, as a share of its full size
const ABOVE_STAFF_CLEF_CHANGE = 0.3

// room right of the last column: its note head, a stacked second's offset and
// the ledger lines' overhang
const LAST_COLUMN_WIDTH = NOTE_HEAD_WIDTH + GROUP_OFFSET + LEDGER_OVERHANG

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
// the group offset: the score's notes for this staff when the column carries
// its staves, else the notes of the column the staff's pitch filter keeps
export function staffColumnNotes(column, {staff, keySignature, filterPitch}) {
  if (Array.isArray(column) && column.staves && staff) {
    let onStaff = column.filter((n, idx) => column.staves[idx] == staff)
    return [onStaff, groupOffsets(onStaff, keySignature)]
  }

  let notes = Array.isArray(column) ? column : [column]
  let offsets = groupOffsets(notes, keySignature)

  if (!filterPitch) {
    return [notes, offsets]
  }

  let keep = notes.map(n => filterPitch(parseNote(n)))
  return [notes.filter((n, idx) => keep[idx]), offsets.filter((o, idx) => keep[idx])]
}

// The narrowest column, unscaled like the staff's noteWidth, that keeps an
// accidental clear of the note heads of the column before it: a head, pushed
// right by the group offset when any column has a stacked second, then the
// accidental and a little space
export function minNoteWidth(columns, keySignature) {
  let stacked = columns.some(column => groupOffsets(column, keySignature).includes(true))
  return Math.ceil(NOTE_HEAD_WIDTH + (stacked ? GROUP_OFFSET : 0) + ACCIDENTAL_WIDTH + ACCIDENTAL_GAP)
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

// where the bar line before the column at idx is drawn
function barLineLeft(props, offsetLeft, idx) {
  let noteWidth = props.noteWidth
  let headWidth = NOTE_HEAD_WIDTH * (props.scale || 1)
  return Math.round(offsetLeft + idx * noteWidth - (noteWidth - headWidth) / 2)
}

// The boxes of the small clefs a staff draws where the clef of its columns
// changes (see Staff#clefProps), in pixels from the top left of its notes, so
// the staff can make room for the ones that reach above its lines. Each sits
// beneath the notes in the gap before the column that changes it: between the
// note heads of the column before (pushed right by a stacked second's offset)
// and the room for an accidental of the column, or the column's bar line, and
// no bigger than the clef heading the staff. A gap too narrow for it holds a
// smaller clef above the staff and the note heads of the column before,
// ending where the gap does
export function clefChangeBoxes(props) {
  let scale = props.scale || 1
  let noteWidth = props.noteWidth
  let offsetLeft = keySignatureWidth(props.keySignature) * scale
  let staffHeight = STAFF_HEIGHT * scale
  let margin = CLEF_CHANGE_MARGIN * scale
  let room = noteWidth - (NOTE_HEAD_WIDTH + ACCIDENTAL_WIDTH) * scale - 2 * margin
  let columnClef = idx => (props.columnClefs && props.columnClefs[idx]) || props

  let out = []
  let previous = null

  props.notes.forEach((column, idx) => {
    let beforeColumn = previous
    previous = column

    let clef = columnClef(idx)
    if (idx == 0 || clef.cleffImage == columnClef(idx - 1).cleffImage) { return }

    let [before, offsets] = staffColumnNotes(beforeColumn, props)
    let offset = offsets.includes(true) ? GROUP_OFFSET * scale : 0

    let glyph = clef.changeGlyph
    let start = offsetLeft + (idx - 1) * noteWidth + NOTE_HEAD_WIDTH * scale + offset + margin
    let space = room - offset
    if (column.measure != null) {
      space = Math.min(space, barLineLeft(props, offsetLeft, idx) - margin - start)
    }
    let fullHeight = glyph.height * staffHeight
    let width = Math.min(fullHeight * glyph.aspect, space)

    if (width >= MIN_CLEF_CHANGE_WIDTH * scale) {
      let height = width / glyph.aspect
      out.push({
        idx, clef, width, height,
        left: start + (space - width) / 2,
        top: glyph.line * staffHeight - glyph.anchor * height,
      })
      return
    }

    let beforeClef = columnClef(idx - 1)
    let headsTop = Math.min(0, ...before.map(name => {
      let row = noteStaffOffset(props.keySignature.enharmonic(name))
      return (beforeClef.upperRow - row) * staffHeight / 8 - NOTE_HEAD_HEIGHT * scale / 2
    }))

    let height = fullHeight * ABOVE_STAFF_CLEF_CHANGE
    width = height * glyph.aspect
    out.push({idx, clef, width, height, left: start + space - width, top: headsTop - margin - height})
  })

  return out
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
    // the clef props (upperRow, lowerRow, cleffImage, staffClass) each column
    // is drawn in, when they differ from the staff's (see Staff#clefProps)
    columnClefs: types.array,
  }

  render() {
    let [songNotes, noteClasses] = this.convertToSongNotes()
    let heldSongNotes = this.convertHeldToSongNotes()

    let scale = this.props.scale || 1
    let offsetLeft = keySignatureWidth(this.props.keySignature) * scale

    // the notes, by the clef of their column, which places them
    let byClef = new Map()
    let group = (note, key) => {
      let clef = this.columnClef(note.getStart())
      if (!byClef.has(clef.cleffImage)) {
        byClef.set(clef.cleffImage, {clef, notes: [], held: []})
      }
      byClef.get(clef.cleffImage)[key].push(note)
    }
    songNotes.forEach(note => group(note, "notes"))
    heldSongNotes.forEach(note => group(note, "held"))

    return <div ref="notes" className={this.classNames()}>
      {this.renderClefChanges()}
      {[...byClef.values()].map(({clef, notes, held}, idx) => [
        <LedgerLines key={`ledger_lines-${idx}`}
          offsetLeft={offsetLeft}
          upperRow={clef.upperRow}
          lowerRow={clef.lowerRow}
          notes={notes.concat(held)}
          pixelsPerBeat={this.props.noteWidth}
          scale={scale}
        />,

        <WholeNotes key={`notes-${idx}`}
          offsetLeft={offsetLeft}
          keySignature={this.props.keySignature}
          upperRow={clef.upperRow}
          lowerRow={clef.lowerRow}
          notes={notes}
          noteClasses={noteClasses}
          pixelsPerBeat={this.props.noteWidth}
        />,

        <WholeNotes key={`held_notes-${idx}`}
          offsetLeft={offsetLeft}
          keySignature={this.props.keySignature}
          upperRow={clef.upperRow}
          lowerRow={clef.lowerRow}
          notes={held}
          staticNoteClasses={styles.held}
          pixelsPerBeat={this.props.noteWidth}
        />,
      ])}

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

  // the clef props the column at idx is drawn in
  columnClef(idx) {
    return (this.props.columnClefs && this.props.columnClefs[idx]) || this.props
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

    let appendClass = (note, cls) => {
      let mappedClass = styles[cls] || cls
      if (noteClasses[note.id]) {
        noteClasses[note.id].push(mappedClass)
      } else {
        noteClasses[note.id] = [mappedClass]
      }
    }

    this.props.notes.forEach((column, columnIdx) => {
      let [columnNotes, offsets] = staffColumnNotes(column, this.props)

      columnNotes.forEach((n, idx) => {
        let sNote = new SongNote(n, beat, dur)

        if (offsets[idx]) {
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

      beat += 1
    })

    return [notes, noteClasses]
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
    let showNumbers = this.props.showAnnotations !== false

    let out = []
    this.props.notes.forEach((column, idx) => {
      if (column.measure == null) { return }

      out.push(<div
        key={`bar-line-${idx}`}
        className={styles.bar_line}
        style={{left: `${barLineLeft(this.props, offsetLeft, idx)}px`}}
        data-measure={column.measure}
        data-label={showNumbers ? column.measure : null} />)
    })

    return out
  }

  // the small clefs where the clef of this staff changes (see clefChangeBoxes)
  renderClefChanges() {
    return clefChangeBoxes(this.props).map(box => <img
      key={`clef-change-${box.idx}`}
      className={styles.clef_change}
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      src={box.clef.cleffImage} />)
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
