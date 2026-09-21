import * as React from "react"

import * as types from "prop-types"
import {parseNote, noteStaffOffset, MIDDLE_C_PITCH} from "st/music"

import {SongNoteList, SongNote} from "st/song_note_list"
import LedgerLines, {LEDGER_OVERHANG} from "st/components/staff/ledger_lines"
import ScoreNotes from "st/components/staff/score_notes"
import ScoreBeams from "st/components/staff/score_beams"
import ScoreExtras from "st/components/staff/score_extras"
import {
  columnLayout, columnExtras, beforeOffset, afterOffset, headKey, OPENING_EXTRA_ROOM,
  noteTypeProps, HEAD_GLYPHS, STAFF_HEIGHT, NOTE_HEAD_HEIGHT,
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

// Whether a head the staff draws on a column is one that column already plays:
// another voice sounds the same note at the same onset, so the score writes
// the two side by side and the drawn head sits beside the played one (see
// renderNote in st/components/staff) rather than joining its chord
export function doubledHead(column, extra, props) {
  if (!column || column.beat !== extra.beat) { return false }

  let [columnNotes] = staffColumnNotes(column, props)
  return columnNotes.includes(extra.name)
}

// The score staff whose rests a staff drawn over columns draws, or null for
// none: the side GrandStaff hands it, else, on a lone treble or bass staff,
// the one score staff of the drill, which a column's own clefs name whatever
// window is on the staff (the staves of the drill's hands, see grandStaffClefs
// in st/song_sections). A lone staff reading both staves of the score draws
// the notes of either hand, so no rest on it could say which hand it belongs to
export function restsStaff(columns, staff) {
  if (staff) { return staff }

  for (let column of columns || []) {
    let staves = column && column.clefs ? Object.keys(column.clefs) : []
    if (staves.length) {
      return staves.length == 1 ? staves[0] : null
    }
  }

  return null
}

// Whether a staff drawing columns draws any of the score's rests, which is
// what its layout keeps room for and what drags a bar line back to the rest
// its bar opens with, and so the unit the columns are spaced in: the page fits
// and slides a card by the same choice (see restsDrawn in
// st/components/pages/sight_reading_page)
export function drawsRests(columns, staff) {
  return restsStaff(columns, staff) != null
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

// onsets closer than this are the same beat, so a bar line never falls on the
// wrong side of what opens its bar
const BAR_BEAT_EPSILON = 1e-6

/**
 * Where the bar lines the staff draws with each column fall, in pixels: one
 * for the bar the column itself opens, and one for each column-less bar the
 * card carries before it — a measure every drilled hand rests through, which
 * is drawn without ever handing the player a column (see cardColumn in
 * st/measure_cards).
 *
 * The line of the bar a column opens sits on the boundary between the last
 * thing the bar before it draws and the first thing of its own, which for a
 * bar opening on a rest is that rest, since the rest belongs to the bar the
 * line opens; it is never more than a column width back from what it opens,
 * so a long note's room can't drag it away from its bar. A bar without a
 * column of its own is drawn wherever its own first beat falls in the room
 * kept before the column after it (see beforeOffset), whether or not the
 * score prints anything inside it.
 * @param {Object} props the staff's
 * @param {number} offsetLeft where the notes start, in pixels
 * @param {Object} layout see columnLayout in st/staff_rhythm
 * @returns {Object[][]} per column, its lines in reading order, each
 * {measure, beat, left}
 */
export function barLineBoxes(props, offsetLeft, layout) {
  let noteWidth = props.noteWidth
  let headWidth = NOTE_HEAD_WIDTH * (props.scale || 1)
  let offsets = layout.offsets
  let at = offset => offsetLeft + offset * noteWidth

  // every staff's extras, so the two staves of a grand staff draw the same
  // lines however the score shares the notes out between them
  let byColumn = new Map()
  for (let extra of columnExtras(props.notes, layout)) {
    if (!byColumn.has(extra.columnIdx)) {
      byColumn.set(extra.columnIdx, [])
    }
    byColumn.get(extra.columnIdx).push(extra)
  }

  return props.notes.map((column, idx) => {
    let columnBeat = column.beat ?? Infinity
    let carried = (column.bars || [])
      .map(bar => ({measure: bar.number, beat: bar.beat, beats: bar.beats}))
      .sort((a, b) => a.beat - b.beat)

    // the bars a card ends on are drawn after its last column, never before it
    let bars = carried.filter(bar => bar.beat < columnBeat)
    let trailing = carried.filter(bar => bar.beat >= columnBeat)

    if (column.measure != null) {
      // the bar the column itself opens starts where the column-less bar
      // before it leaves off, so the first thing drawn from there on is what
      // its line opens: a rest its bar opens with, else the column's own head
      bars.push({measure: column.measure, own: true})
    }

    bars.push(...trailing)

    if (!bars.length) { return [] }

    let columnAt = at(offsets[idx])
    let points = [{beat: -Infinity, x: idx > 0 ? at(offsets[idx - 1]) + headWidth : offsetLeft}]

    for (let extra of byColumn.get(idx) || []) {
      points.push({beat: extra.beat, x: at(extra.offset)})
    }

    points.push({beat: columnBeat, x: columnAt})

    let low = -Infinity

    return bars.map(bar => {
      let beat = bar.own ?
        Math.min(columnBeat, ...points
          .filter(point => point.beat > low - BAR_BEAT_EPSILON)
          .map(point => point.beat)) :
        bar.beat

      low = bar.own ? beat : bar.beat + (bar.beats || 0)

      if (!bar.own) {
        // A bar of its own that holds no column: it opens where its own first
        // beat falls, and its line is drawn in the room kept in front of that
        let offset = beat >= columnBeat ?
          afterOffset(props.notes, layout, idx, beat) :
          beforeOffset(props.notes, layout, idx, beat)

        return {
          measure: bar.measure,
          beat,
          left: Math.round(at(offset - OPENING_EXTRA_ROOM / 2)),
        }
      }

      let opensBar = point => point.beat >= beat - BAR_BEAT_EPSILON
      let before = points.filter(point => !opensBar(point)).map(point => point.x)
      let opens = Math.min(columnAt, ...points.filter(opensBar).map(point => point.x))
      let previous = before.length ? Math.max(...before) : offsetLeft

      // The bar the column opens is drawn on the boundary before it, at most
      // one column width back so a long note's room never drags the line away
      // from the bar it opens. A bar opening on a rest puts the line before
      // that rest instead, since the rest belongs to the bar
      let gap = idx > 0 ? Math.min(1, offsets[idx] - offsets[idx - 1]) : 1
      let own = columnAt - (gap * noteWidth - headWidth) / 2
      let line = opens < columnAt - 0.5 ? Math.min(own, (previous + opens) / 2) : own

      return {measure: bar.measure, beat, left: Math.round(line)}
    })
  })
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
  let layout = columnLayout(props.notes, props.unitColumns,
    {rests: drawsRests(props.unitColumns || props.notes, props.staff)})
  let offsets = layout.offsets
  let barLines = barLineBoxes(props, offsetLeft, layout)
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
    // the bars drawn before the column, the last of which the clef change has
    // to stay clear of; the ones a card ends on are drawn after it
    let lines = barLines[idx].filter(line => line.beat <= (column.beat ?? Infinity))
    if (lines.length) {
      space = Math.min(space, lines[lines.length - 1].left - margin - start)
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
    // the stem of each head of that unit, by headKey (see unitStems in
    // st/components/staves)
    stems: types.object,
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
      this.layoutCache = columnLayout(this.props.notes, this.props.unitColumns,
        {rests: drawsRests(this.props.unitColumns || this.props.notes, this.props.staff)})
    }

    return this.layoutCache
  }

  render() {
    let layout = this.columnLayout()
    let [songNotes, noteClasses] = this.convertToSongNotes(layout)
    let heldSongNotes = this.convertHeldToSongNotes(layout)

    let scale = this.props.scale || 1
    let offsetLeft = keySignatureWidth(this.props.keySignature) * scale
    // where the staff draws a bar line before each column that opens a bar,
    // null for the columns it draws none before: the lines themselves and the
    // room a bar's whole measure rest fills are both measured from these, so
    // the rest is centred between the lines it is drawn under
    let barLines = barLineBoxes(this.props, offsetLeft, layout)

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

    // the stem of every head the staff draws, worked out over the whole unit
    // (see unitStems in st/components/staves), so the notes, their flags and
    // the ties bowing away from them all agree on which way each one turns
    // however much of that unit is on the staff
    let stems = new Map()
    for (let note of songNotes) {
      let stem = this.props.stems &&
        this.props.stems.get(headKey(note.beat, note.note, note.notation))

      if (stem) {
        stems.set(note.id, stem)
      }
    }

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
          stems={stems}
          pixelsPerBeat={this.props.noteWidth}
          scale={scale}
        />,

        <ScoreNotes key={`held_notes-${idx}`}
          offsetLeft={offsetLeft}
          keySignature={this.props.keySignature}
          upperRow={clef.upperRow}
          lowerRow={clef.lowerRow}
          notes={held}
          stems={stems}
          staticNoteClasses={styles.held}
          pixelsPerBeat={this.props.noteWidth}
          scale={scale}
        />,
      ])}

      <ScoreBeams
        offsetLeft={offsetLeft}
        keySignature={this.props.keySignature}
        columnClefs={this.props.columnClefs}
        upperRow={this.props.upperRow}
        lowerRow={this.props.lowerRow}
        heads={songNotes}
        stems={stems}
        noteWidth={this.props.noteWidth}
        scale={scale} />

      <ScoreExtras
        {...this.props}
        offsetLeft={offsetLeft}
        scale={scale}
        layout={layout}
        stems={stems}
        barLines={barLines}
        restsStaff={restsStaff(this.props.unitColumns || this.props.notes, this.props.staff)}
        heads={songNotes} />

      {this.renderBarLines(barLines)}
      {this.renderAnnotations(layout)}
    </div>
  }

  // The notes held down that aren't in the head column, drawn on it so they
  // show against the column being judged
  convertHeldToSongNotes(layout) {
    if (!this.props.heldNotes) {
      return []
    }

    let notes = new SongNoteList()
    let dur = 40 / this.props.noteWidth
    let head = (layout.offsets && layout.offsets[0]) || 0

    Object.keys(this.props.heldNotes)
      .filter((note) => !this.props.notes.inHead(note))
      .forEach((note, idx) => {
        notes.push(new SongNote(note, head, dur))
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
      sNote.doubled = doubledHead(this.props.notes[head.columnIdx], head, this.props)

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

  // A bar line before each column that starts a measure, and before each
  // column-less bar drawn ahead of one, on the boundary halfway between what
  // the bar before it draws last and what its own bar opens with, so it moves
  // with its bar. The bar number is written above it, on the upper staff only
  // of a grand staff
  renderBarLines(barLines) {
    let showNumbers = this.props.showAnnotations !== false

    let out = []
    barLines.forEach((lines, idx) => {
      lines.forEach((line, at) => {
        out.push(<div
          key={`bar-line-${idx}-${at}`}
          className={styles.bar_line}
          style={{left: `${line.left}px`}}
          data-measure={line.measure}
          data-label={showNumbers ? line.measure : null} />)
      })
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
