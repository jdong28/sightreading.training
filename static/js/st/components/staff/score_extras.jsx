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
  columnExtras, tieArcs, restGlyph, rowCenter, headGlyph,
  STAFF_ROW, STAFF_SPACE, NOTE_HEAD_HEIGHT,
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
  }

  render() {
    let extras = columnExtras(this.props.notes, {
      ...this.props.layout,
      staff: this.props.staff,
    })

    let rests = this.renderRests(extras)
    let ties = this.renderTies()

    if (!rests.length && !ties) {
      return null
    }

    return <div className={styles.score_extras}>{rests}{ties}</div>
  }

  // where an offset in column widths falls, in pixels from the staff's notes
  left(offset) {
    return (this.props.offsetLeft || 0) + offset * this.props.noteWidth
  }

  // The rests of the score, each at its beat. A whole measure rest is centred
  // in the bar it fills, as it is on paper, whatever the meter
  renderRests(extras) {
    let scale = this.props.scale || 1
    let advances = this.props.layout.advances

    return extras.filter(extra => extra.kind == "rest").map((rest, idx) => {
      let glyph = restGlyph(rest.type)
      let width = glyph.width * scale
      let height = glyph.height * scale

      let left = this.left(rest.offset)
      if (rest.wholeMeasure) {
        // a whole measure rest is centred in the room its bar holds
        left += (advances[rest.columnIdx] * this.props.noteWidth - width) / 2
      }

      let line = (MIDDLE_LINE_ROWS - glyph.row) * STAFF_ROW * scale

      return <img
        key={`rest-${idx}`}
        className={styles.rest}
        data-rest-type={rest.type}
        style={{
          left: `${left}px`,
          top: `${line - glyph.anchor * height}px`,
          width: `${width}px`,
          height: `${height}px`,
        }}
        src={glyph.src} />
    })
  }

  // the clef props the column at idx is drawn in
  columnClef(idx) {
    return (this.props.columnClefs && this.props.columnClefs[idx]) || this.props
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
          stem: note.notation.stem,
          tieTo: note.notation.tieTo,
          tieFrom: note.tiedFrom ?? null,
        }
      })

    if (!heads.length) { return null }

    let width = heads[0].width
    let arcs = tieArcs(heads, TIE_STUB * scale)
    if (!arcs.length) { return null }

    return <svg className={styles.ties} key="ties">
      {arcs.map((arc, idx) => {
        let bow = arc.dir == "up" ? -1 : 1
        let x1 = arc.x1 + width * TIE_START
        let x2 = arc.x2 + width * TIE_END
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
