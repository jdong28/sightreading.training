// What an imported piece draws between its columns: the score's rests, at the
// beat they fall on, and the arcs of its ties, including the ones running off
// the card to a head on the card before or after it.
//
// None of this is played: the rests and the heads a tie runs on to are drawn
// where the score puts them, while the columns the player answers are
// unchanged (st/song_sections).

import * as React from "react"
import * as types from "prop-types"

import {noteStaffOffset} from "st/music"
import {
  columnExtras, tieArcs, restGlyph, rowCenter, headGlyph, stemDirection,
  middleRow, STAFF_ROW, STAFF_SPACE, NOTE_HEAD_HEIGHT, DOT_SIZE, DOT_GAP,
} from "st/staff_rhythm"
import styles from "st/components/staff.module.css"

// the middle line of a staff, which rests are drawn against, is four rows
// below its top line whatever clef it is in
const MIDDLE_LINE_ROWS = 4

// how far a tie whose other head is on another card reaches off this one
const TIE_STUB = STAFF_SPACE * 1.4

// where a tie leaves and meets a head, as a share of the head's width
const TIE_START = 0.75
const TIE_END = 0.25

// how far a tie sits from the middle of its heads, and how deep it bows
const TIE_OFFSET = STAFF_SPACE * 0.5
const TIE_DEPTH = STAFF_SPACE * 0.45

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
    // the score staff a lone treble or bass staff stands for (see extrasStaff)
    scoreStaff: types.string,
  }

  render() {
    let extras = columnExtras(this.props.notes, {
      ...this.props.layout,
      staff: this.extrasStaff(),
    })

    let rests = this.renderRests(extras)
    let ties = this.renderTies()

    if (!rests.length && !ties) {
      return null
    }

    return <div className={styles.score_extras}>{rests}{ties}</div>
  }

  // The score staff whose rests and tied heads this staff draws: the side
  // GrandStaff hands it, else, on a lone treble or bass staff, its own side of
  // the score, but only once the card holds both sides' extras — a drill of one
  // hand carries that hand's rests alone (extractSectionColumns collects them
  // for the tracks it drills), and they are read on whichever staff shows them
  extrasStaff() {
    if (this.props.staff) { return this.props.staff }

    let staves = new Set()
    for (let column of this.props.notes) {
      for (let extra of column.extras || []) {
        if (extra.staff) {
          staves.add(extra.staff)
        }
      }
    }

    return staves.size > 1 ? this.props.scoreStaff : null
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

  // The room the bar holding the column at idx spans, in column widths: from
  // the last column that opens a bar to the next one, the empty columns the
  // staff is padded with after a card, or the end of the room the columns hold
  barRoom(idx) {
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

    let end = offsets[last] + advances[last]
    for (let at = start + 1; at <= last; at++) {
      if (this.opensBar(at) || columns[at].beat == null) {
        end = offsets[at]
        break
      }
    }

    return [offsets[start], end - offsets[start]]
  }

  // The augmentation dots of a rest, after its glyph and against the middle
  // line, as they are drawn on a head
  renderRestDots(rest, key, {left, width, scale}) {
    let dots = rest.wholeMeasure ? 0 : (rest.dots || 0)
    let size = DOT_SIZE * scale
    let out = []

    for (let i = 0; i < dots; i++) {
      out.push(<img
        key={`${key}-dot-${i}`}
        className={styles.rest_dot}
        style={{
          left: `${left + width + (DOT_GAP + i * (DOT_SIZE + DOT_GAP)) * scale}px`,
          top: `${MIDDLE_LINE_ROWS * STAFF_ROW * scale - size / 2}px`,
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
        let [from, room] = this.barRoom(rest.columnIdx)
        left = this.left(from) + (room * this.props.noteWidth - width) / 2
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

      out.push(...this.renderRestDots(rest, `rest-${idx}`, {left, width, scale}))
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

  // The tie arcs between the heads on the staff, bowing away from the stems
  // they belong to. A tie with no head to run to on this card runs off its
  // edge instead
  renderTies() {
    let scale = this.props.scale || 1
    let key = this.props.keySignature

    let heads = this.props.heads
      .filter(note => note.notation && (note.notation.tieTo != null || note.tiedFrom != null))
      .map(note => {
        let clef = this.columnClef(note.columnIdx)
        let row = noteStaffOffset(key.enharmonic(note.note))
        let width = headGlyph(note.notation.type, NOTE_HEAD_HEIGHT * scale).width

        return {
          beat: note.beat,
          name: note.note,
          x: this.left(note.getStart()),
          y: rowCenter(row, clef) * scale,
          width,
          // the stem the staff draws on the head; a value with no stem bows
          // its tie away from the middle line, as a single voice's stem turns
          // there
          stem: this.headStem(note) || stemDirection([row], middleRow(clef)),
          tieTo: note.notation.tieTo,
          tieFrom: note.tiedFrom ?? null,
        }
      })

    if (!heads.length) { return null }

    let arcs = tieArcs(heads, TIE_STUB * scale, {left: this.props.offsetLeft || 0})
    if (!arcs.length) { return null }

    return <svg className={styles.ties} key="ties">
      {arcs.map((arc, idx) => {
        let bow = arc.dir == "up" ? -1 : 1
        // each end is anchored on the head it joins, whose width is its own
        // notated value's (see headGlyph)
        let x1 = arc.x1 + arc.w1 * TIE_START
        let x2 = arc.x2 + arc.w2 * TIE_END
        let y1 = arc.y1 + bow * TIE_OFFSET * scale
        let y2 = arc.y2 + bow * TIE_OFFSET * scale
        let cy = (y1 + y2) / 2 + bow * TIE_DEPTH * scale

        return <path
          key={`tie-${idx}`}
          className={styles.tie}
          data-tie={arc.dir}
          d={`M${x1.toFixed(1)} ${y1.toFixed(1)}Q${((x1 + x2) / 2).toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`} />
      })}
    </svg>
  }
}
