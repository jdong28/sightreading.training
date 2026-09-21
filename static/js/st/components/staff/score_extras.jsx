// What an imported piece draws between its columns: the score's rests, at the
// beat they fall on, and the arcs of its ties and slurs, including the ones
// running off the card to a head on the card before or after it.
//
// None of this is played: the rests and the heads a tie runs on to are drawn
// where the score puts them, while the columns the player answers are
// unchanged (st/song_sections).

import * as React from "react"
import * as types from "prop-types"

import {noteStaffOffset} from "st/music"
import {
  columnExtras, tieArcs, slurArcs, restGlyph, rowCenter, headGlyph,
  stemDirection, middleRow, STAFF_ROW, STAFF_SPACE, NOTE_HEAD_HEIGHT,
  DOT_SIZE, DOT_GAP,
} from "st/staff_rhythm"
import styles from "st/components/staff.module.css"

// the middle line of a staff, which rests are drawn against, is four rows
// below its top line whatever clef it is in
const MIDDLE_LINE_ROWS = 4

// how far a tie or a slur whose other head is on another card reaches off
// this one
const TIE_STUB = STAFF_SPACE * 1.4

// how far a tie sits from the middle of its heads, and how deep it bows
const TIE_OFFSET = STAFF_SPACE * 0.5
const TIE_DEPTH = STAFF_SPACE * 0.45

// how deep a slur bows, and how far it clears the heads it arches over
// beyond where a tie sits
const SLUR_DEPTH = STAFF_SPACE * 0.9
const SLUR_CLEARANCE = STAFF_SPACE * 0.6

export default class ScoreExtras extends React.PureComponent {
  static propTypes = {
    notes: types.array.isRequired,
    heads: types.array.isRequired,
    layout: types.object.isRequired,
    offsetLeft: types.number,
    scale: types.number,
    noteWidth: types.number,
    // the stem each head is drawn with (see columnStems in st/staff_rhythm)
    stems: types.object,
    // the score staff whose rests this staff draws, null for none (see
    // restsStaff in st/components/staff_notes)
    restsStaff: types.string,
    // every column of the drill's unit, which still holds the bar the window
    // opens in the middle of (see carriedRests)
    unitColumns: types.array,
    // the bar lines the staff draws with each column, in reading order (see
    // barLineBoxes in st/components/staff_notes)
    barLines: types.array,
  }

  render() {
    let staff = this.props.restsStaff
    let rests = staff ? this.renderRests([
      ...this.carriedRests(staff),
      ...columnExtras(this.props.notes, {...this.props.layout, staff}),
    ]) : []

    let arcs = this.renderArcs()

    if (!rests.length && !arcs) {
      return null
    }

    return <div className={styles.score_extras}>{rests}{arcs}</div>
  }

  // The whole measure rests of a bar the window opens in the middle of. Every
  // other extra is drawn at its own beat and leaves the staff with the column
  // it is attached to, but a whole measure rest is drawn centred in its bar
  // (see renderRests), so it is still on the staff once that column has been
  // played: the unit the window slides over is what still holds it
  carriedRests(staff) {
    let unit = this.props.unitColumns
    let [head] = this.props.notes

    if (!unit || !head || head.measure != null || head.beat == null) { return [] }

    let out = []
    let opens = unit.findIndex(column => column && column.beat === head.beat)

    for (let idx = opens - 1; idx >= 0; idx--) {
      for (let extra of unit[idx].extras || []) {
        if (extra.kind != "rest" || !extra.wholeMeasure) { continue }
        if (staff && extra.staff && extra.staff != staff) { continue }

        out.push({...extra, columnIdx: 0})
      }

      if (unit[idx].measure != null) { break }
    }

    return out
  }

  // where an offset in column widths falls, in pixels from the staff's notes
  left(offset) {
    return (this.props.offsetLeft || 0) + offset * this.props.noteWidth
  }

  // Whether the column at idx opens a bar: the staff draws a bar line before
  // it, or it starts the card's columns over, where a looping card comes round
  // to its first bar again (see drillColumns in st/measure_cards)
  opensBar(idx) {
    let columns = this.props.notes
    if (idx <= 0) { return true }
    if (columns[idx].measure != null) { return true }

    let previous = columns[idx - 1]
    return columns[idx].beat != null && previous.beat != null &&
      columns[idx].beat <= previous.beat
  }

  // every bar line the staff draws, in reading order
  barLineXs() {
    return (this.props.barLines || []).flatMap(lines =>
      (lines || []).map(line => line.left))
  }

  // The room the card gives the bar holding the column at idx, in pixels:
  // from that bar's first column back to the column before it, where its line
  // is drawn, out to where the next bar of the card starts. At either end of
  // the card it is the room the card's own columns hold
  cardRoom(idx) {
    let {offsets, advances} = this.props.layout
    let columns = this.props.notes
    let last = columns.length - 1

    let start = 0
    for (let at = Math.min(idx, last); at > 0; at--) {
      if (this.opensBar(at)) {
        start = at
        break
      }
    }

    let end = this.left(offsets[last] + advances[last])
    for (let at = start + 1; at <= last; at++) {
      if (this.opensBar(at) || columns[at].beat == null) {
        end = this.left(offsets[at])
        break
      }
    }

    // back to the column the bar's line is drawn after, so that line counts
    // as one of the bar's own; the card's first bar reaches back past its
    // notes, where its own line is drawn
    return [start > 0 ? this.left(offsets[start - 1]) : -Infinity,
      this.left(offsets[start]), end]
  }

  // The room the bar a rest fills spans, in pixels: between the bar lines the
  // staff draws either side of it, which a bar's own leading rests pull back
  // from its first head, and at either end of the card the room its columns
  // hold. A rest carried onto the staff from a bar that opened before the
  // window has no place of its own, so its bar runs from where the window does
  barRoom(rest) {
    let [low, from, end] = this.cardRoom(rest.columnIdx)
    let at = rest.offset != null ? this.left(rest.offset) : from

    let lines = this.barLineXs().filter(x => x >= low && x <= end)
    let before = lines.filter(x => x <= at + 0.5)
    let after = lines.filter(x => x > at + 0.5)

    let start = before.length ? Math.max(...before) : from
    let stop = after.length ? Math.min(...after) : end

    return [start, stop - start]
  }

  // The augmentation dots of a rest, after its glyph and against the middle
  // line, as they are drawn on a head
  renderRestDots(rest, key, {left, width, scale, glyph}) {
    let dots = rest.wholeMeasure ? 0 : (rest.dots || 0)
    let size = DOT_SIZE * scale
    let out = []
    // the rest's own row, and the space above it when that row is a line, so
    // a dot is never drawn on a staff line
    let row = MIDDLE_LINE_ROWS - glyph.row
    let against = (row % 2 == 0 ? row - 1 : row) * STAFF_ROW * scale

    for (let i = 0; i < dots; i++) {
      out.push(<img
        key={`${key}-dot-${i}`}
        className={styles.rest_dot}
        style={{
          left: `${left + width + (DOT_GAP + i * (DOT_SIZE + DOT_GAP)) * scale}px`,
          top: `${against - size / 2}px`,
          width: `${size}px`,
          height: `${size}px`,
        }}
        src="/static/svg/aug_dot.svg" />)
    }

    return out
  }

  // The rests of the score, each at its beat, with its dots. A whole measure
  // rest is the whole rest glyph centred in the bar it fills, as it is on
  // paper, whatever the meter and whatever the bar's own length spells
  renderRests(extras) {
    let scale = this.props.scale || 1
    let out = []

    extras.filter(extra => extra.kind == "rest").forEach((rest, idx) => {
      let type = rest.wholeMeasure ? "whole" : rest.type
      let glyph = restGlyph(type)
      let width = glyph.width * scale
      let height = glyph.height * scale

      let left = this.left(rest.offset)
      if (rest.wholeMeasure) {
        // a whole measure rest fills a bar, so it is centred in the room the
        // bar holds rather than drawn at the beat it starts on
        let [from, room] = this.barRoom(rest)
        left = from + (room - width) / 2
      }

      let line = (MIDDLE_LINE_ROWS - glyph.row) * STAFF_ROW * scale

      out.push(<img
        key={`rest-${idx}`}
        className={styles.rest}
        data-rest-type={type}
        style={{
          left: `${left}px`,
          top: `${line - glyph.anchor * height}px`,
          width: `${width}px`,
          height: `${height}px`,
        }}
        src={glyph.src} />)

      out.push(...this.renderRestDots(rest, `rest-${idx}`, {left, width, scale, glyph}))
    })

    return out
  }

  // the clef props the column at idx is drawn in
  columnClef(idx) {
    return (this.props.columnClefs && this.props.columnClefs[idx]) || this.props
  }

  // the direction of the stem the staff draws on a head, if it has one
  headStem(note) {
    let stem = this.props.stems && this.props.stems.get(note.id)
    return stem ? stem.dir : null
  }

  // Every head on the staff as the arcs of its ties and slurs are anchored
  // on it, in the pixels of the staff's scale
  arcHeads() {
    let scale = this.props.scale || 1
    let key = this.props.keySignature

    return this.props.heads.map(note => {
      let clef = this.columnClef(note.columnIdx)
      let row = noteStaffOffset(key.enharmonic(note.note))
      let width = headGlyph(note.notation && note.notation.type, NOTE_HEAD_HEIGHT * scale).width

      return {
        beat: note.beat,
        name: note.note,
        // a head another voice doubles is drawn a head's width to the right
        // of the played one (see renderNote in st/components/staff), and the
        // arc meets it where it is drawn
        x: this.left(note.getStart()) + (note.doubled ? width : 0),
        y: rowCenter(row, clef) * scale,
        width,
        // the stem the staff draws on the head; a value with no stem bows
        // its arcs away from the middle line, as a single voice's stem turns
        // there
        stem: this.headStem(note) || stemDirection([row], middleRow(clef)),
        slurs: (note.notation && note.notation.slurs) || null,
        tieTo: note.notation ? note.notation.tieTo : null,
        tieFrom: note.tiedFrom ?? null,
      }
    })
  }

  // The path of one arc, bowed away from the stems of the heads it joins and,
  // for a slur, arched past the heads it spans
  arcPath(arc, key, scale, cls, depth) {
    let bow = arc.dir == "up" ? -1 : 1
    let {x1, x2} = arc
    let y1 = arc.y1 + bow * TIE_OFFSET * scale
    let y2 = arc.y2 + bow * TIE_OFFSET * scale
    let mid = (y1 + y2) / 2
    let cy = mid + bow * depth * scale

    // the quadratic's own middle sits half way between its ends and its
    // control point, so a head is cleared by a control point twice as far out
    // as the apex has to reach
    if (arc.clear != null) {
      let over = 2 * (arc.clear + bow * (TIE_OFFSET + SLUR_CLEARANCE) * scale) - mid
      cy = bow < 0 ? Math.min(cy, over) : Math.max(cy, over)
    }

    return <path
      key={key}
      className={cls}
      data-tie={arc.dir}
      d={`M${x1.toFixed(1)} ${y1.toFixed(1)}Q${((x1 + x2) / 2).toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`} />
  }

  // The arcs between the heads on the staff: the ties of the score, which
  // join two heads of one pitch, and its slurs, which join different ones and
  // arch clear of everything between. An arc with no head to run to on this
  // card runs off its edge instead
  renderArcs() {
    let scale = this.props.scale || 1
    let heads = this.arcHeads()

    if (!heads.length) { return null }

    let left = this.props.offsetLeft || 0
    let ties = tieArcs(heads.filter(head => head.tieTo != null || head.tieFrom != null),
      TIE_STUB * scale, {left})
    let slurs = slurArcs(heads, TIE_STUB * scale,
      {left, through: this.passingSlurs()})

    if (!ties.length && !slurs.length) { return null }

    return <svg className={styles.ties} key="ties">
      {ties.map((arc, idx) => this.arcPath(arc, `tie-${idx}`, scale, styles.tie, TIE_DEPTH))}
      {slurs.map((arc, idx) => this.arcPath(arc, `slur-${idx}`, scale, styles.slur, SLUR_DEPTH))}
    </svg>
  }

  // The slurs of the score open right across every column on the staff: both
  // heads they run between are drawn on other cards, so nothing here marks
  // them and the arc is drawn passing over the whole staff (see slurArcs). A
  // staff reading one score staff draws only that staff's slurs, as it draws
  // only its rests
  passingSlurs() {
    let columns = this.props.notes
    if (!columns || !columns.length) { return [] }

    let staff = this.props.staff
    let keyOf = span => `${span.number}:${span.staff || ""}`
    let open = new Map()

    for (let span of columns[0].slurs || []) {
      if (staff && span.staff && span.staff != staff) { continue }
      open.set(keyOf(span), span)
    }

    for (let idx = 1; idx < columns.length && open.size; idx++) {
      let here = new Set((columns[idx].slurs || []).map(keyOf))
      for (let key of [...open.keys()]) {
        if (!here.has(key)) { open.delete(key) }
      }
    }

    return [...open.values()]
  }
}
