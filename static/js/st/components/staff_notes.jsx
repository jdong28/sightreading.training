import * as React from "react"

import * as types from "prop-types"
import {parseNote, noteStaffOffset, MIDDLE_C_PITCH} from "st/music"

import {SongNoteList, SongNote} from "st/song_note_list"
import LedgerLines, {LEDGER_OVERHANG} from "st/components/staff/ledger_lines"
import ScoreNotes from "st/components/staff/score_notes"
import ScoreExtras from "st/components/staff/score_extras"
import {
  columnLayout, columnOffsets, columnExtras, noteTypeProps, HEAD_GLYPHS,
  STAFF_HEIGHT, NOTE_HEAD_HEIGHT,
} from "st/staff_rhythm"
import styles from "st/components/staff.module.css"

// The unscaled horizontal layout of the notes on a staff (st/components/staves),
// which the staff's scale multiplies. See .staff_notes, .key_signature and
// .group_offset in staff.module.css
export const STAFF_NOTES_LEFT = 120
export const KEY_SIGNATURE_SPACING = 20
// a whole note head is 20% of the staff, noteheads.s0.svg is 1.69:1
export const NOTE_HEAD_WIDTH = NOTE_HEAD_HEIGHT * 1.69
// how far a sharp, the widest accidental, reaches left of its note head: it
// ends 10% of a head short of it and is three heads tall, sharp.svg is 245:1024
export const ACCIDENTAL_WIDTH = NOTE_HEAD_WIDTH * 0.1 + NOTE_HEAD_HEIGHT * 3 * 245 / 1024
// how far right a note a second away from the one below it in its column sits
export const GROUP_OFFSET = 30

// the space between an accidental and the note heads of the column before it
const ACCIDENTAL_GAP = 4
// the space kept between the note heads of columns that draw no accidental
const NOTE_HEAD_GAP = 6

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

// How the score writes each of the notes a staff draws in a column (see
// staffColumnNotes), or null for a column without the score's notation
export function columnNotation(column, columnNotes, {staff}) {
  if (!Array.isArray(column) || !column.notation) { return null }

  let notation = column.notation
  if (column.staves && staff) {
    notation = notation.filter((n, idx) => column.staves[idx] == staff)
  }

  return notation.length == columnNotes.length ? notation : null
}

// the width of the widest head the columns draw: a whole note's, unless
// every note of the card is a half or shorter, whose heads are narrower
export function columnsHeadWidth(columns) {
  let widest = columns.some(column => !column.notation ||
    column.notation.some(notation => noteTypeProps(notation && notation.type).head == "whole"))

  let glyph = widest ? HEAD_GLYPHS.whole : HEAD_GLYPHS.half
  return NOTE_HEAD_HEIGHT * glyph.aspect
}

// The narrowest column, unscaled like the staff's noteWidth, that keeps an
// accidental clear of the note heads of the column before it: a head, pushed
// right by the group offset when any column has a stacked second, then the
// accidental and a little space. Columns whose notes are all spelled by the
// key signature draw no accidental and only keep the heads apart, so a piece
// written in its own key fits more of itself on the staff
export function minNoteWidth(columns, keySignature) {
  let stacked = columns.some(column => groupOffsets(column, keySignature).includes(true))
  let accidental = columns.some(column => column.some(note =>
    keySignature.accidentalsForNote(keySignature.enharmonic(note)) != null))

  return Math.ceil(columnsHeadWidth(columns) + (stacked ? GROUP_OFFSET : 0) +
    (accidental ? ACCIDENTAL_WIDTH + ACCIDENTAL_GAP : NOTE_HEAD_GAP))
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

// Where the bar line before the column at idx is drawn: on the boundary
// between it and the column before, at most one column width back so a long
// note's room never drags the line away from the bar it opens
function barLineLeft(props, offsetLeft, idx, offsets) {
  let noteWidth = props.noteWidth
  let headWidth = NOTE_HEAD_WIDTH * (props.scale || 1)
  let at = offsets[idx]
  let gap = idx > 0 ? Math.min(1, at - offsets[idx - 1]) : 1
  return Math.round(offsetLeft + at * noteWidth - (gap * noteWidth - headWidth) / 2)
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
  let offsets = columnOffsets(props.notes, props.unitColumns)
  let columnClef = idx => (props.columnClefs && props.columnClefs[idx]) || props

  let out = []
  let previous = null

  props.notes.forEach((column, idx) => {
    let beforeColumn = previous
    previous = column

    let clef = columnClef(idx)
    if (idx == 0 || clef.cleffImage == columnClef(idx - 1).cleffImage) { return }

    let [before, groupOffset] = staffColumnNotes(beforeColumn, props)
    let offset = groupOffset.includes(true) ? GROUP_OFFSET * scale : 0

    let glyph = clef.changeGlyph
    let gap = (offsets[idx] - offsets[idx - 1]) * noteWidth
    let start = offsetLeft + offsets[idx - 1] * noteWidth + NOTE_HEAD_WIDTH * scale + offset + margin
    let space = gap - (NOTE_HEAD_WIDTH + ACCIDENTAL_WIDTH) * scale - 2 * margin - offset
    if (column.measure != null) {
      space = Math.min(space, barLineLeft(props, offsetLeft, idx, offsets) - margin - start)
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
    // every column of the drill's unit, which fixes the beat proportional
    // layout while the notes slide through the staff (see st/staff_rhythm)
    unitColumns: types.array,
  }

  /**
   * Where the columns on the staff are drawn, in column widths from the
   * first, and how many beats a column width is. The layout is measured over
   * the whole unit so it holds still as the notes slide through the staff.
   * @returns {{offsets: number[], unit: number|null}}
   */
  columnLayout() {
    if (this.layoutFor != this.props.notes || this.layoutUnit != this.props.unitColumns) {
      this.layoutFor = this.props.notes
      this.layoutUnit = this.props.unitColumns
      this.layoutCache = columnLayout(this.props.notes, this.props.unitColumns)
    }

    return this.layoutCache
  }

  render() {
    let layout = this.columnLayout()
    let [songNotes, noteClasses] = this.convertToSongNotes(layout)
    let heldSongNotes = this.convertHeldToSongNotes()

    let scale = this.props.scale || 1
    let offsetLeft = keySignatureWidth(this.props.keySignature) * scale

    // the notes, by the clef of their column, which places them
    let byClef = new Map()
    let group = (note, key) => {
      let clef = this.columnClef(note.columnIdx)
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

        <ScoreNotes key={`notes-${idx}`}
          offsetLeft={offsetLeft}
          keySignature={this.props.keySignature}
          upperRow={clef.upperRow}
          lowerRow={clef.lowerRow}
          notes={notes}
          noteClasses={noteClasses}
          pixelsPerBeat={this.props.noteWidth}
          scale={scale}
        />,

        <ScoreNotes key={`held_notes-${idx}`}
          offsetLeft={offsetLeft}
          keySignature={this.props.keySignature}
          upperRow={clef.upperRow}
          lowerRow={clef.lowerRow}
          notes={held}
          staticNoteClasses={styles.held}
          pixelsPerBeat={this.props.noteWidth}
          scale={scale}
        />,
      ])}

      <ScoreExtras
        {...this.props}
        offsetLeft={offsetLeft}
        scale={scale}
        layout={layout}
        heads={songNotes} />

      {this.renderBarLines(offsetLeft, layout)}
      {this.renderAnnotations(layout)}
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

  // Every head the staff draws: the notes of its columns, then the heads the
  // ties of the piece run on to, which are drawn where they fall but are
  // never played. Each carries the column it belongs to and, for an imported
  // piece, its beat and how the score writes it
  convertToSongNotes(layout) {
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
      let notation = columnNotation(column, columnNotes, this.props)

      columnNotes.forEach((n, idx) => {
        let sNote = new SongNote(n, layout.offsets[columnIdx], dur)
        sNote.columnIdx = columnIdx

        if (notation && notation[idx]) {
          sNote.notation = notation[idx]
          sNote.beat = column.beat
        }

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

    for (let head of columnExtras(this.props.notes, {...layout, staff: this.props.staff})) {
      if (head.kind != "head") { continue }

      let sNote = new SongNote(head.name, head.offset, dur)
      sNote.columnIdx = head.columnIdx
      sNote.notation = head
      sNote.beat = head.beat
      sNote.tiedFrom = head.from ?? null

      // a head another voice sounds at the same beat sits beside the one
      // that is played, as the score writes the two voices
      sNote.doubled = notes.some(note =>
        note.note == sNote.note && note.getStart() == sNote.getStart())

      notes.push(sNote)
    }

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
  renderBarLines(offsetLeft, {offsets}) {
    let showNumbers = this.props.showAnnotations !== false

    let out = []
    this.props.notes.forEach((column, idx) => {
      if (column.measure == null) { return }

      out.push(<div
        key={`bar-line-${idx}`}
        className={styles.bar_line}
        style={{left: `${barLineLeft(this.props, offsetLeft, idx, offsets)}px`}}
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

  renderAnnotations({offsets}) {
    if (this.props.showAnnotations === false) {
      return null
    }

    let out = []
    this.props.notes.forEach((column, idx) => {
      if (column.annotation) {
        let style = {
          top: "-60%",
          left: `${offsets[idx] * this.props.noteWidth}px`
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
