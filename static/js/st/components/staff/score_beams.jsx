// The beams and tuplets an imported piece draws over its stems: the beam
// groups the score writes, drawn as one band per level instead of a flag on
// every head, and the number (with a bracket, unless the beam already marks
// the group out) over a tuplet.
//
// Every group is worked out once over the drill's unit (see columnStems in
// st/staff_rhythm, handed here as the stem of each head), so a beam holds its
// slope and its stem directions as the window slides through the card. The
// window only ever draws the part of a group it holds: a group cut by the
// card's edge runs its beam off that side, the way a tie running off the card
// draws a stub (see tieArcs).

import * as React from "react"
import * as types from "prop-types"

import {noteStaffOffset} from "st/music"
import {
  rowCenter, headGlyph, NOTE_HEAD_HEIGHT, STEM_WIDTH,
  BEAM_THICKNESS, BEAM_GAP, BEAM_STUB, BEAM_HOOK,
  TUPLET_OFFSET, TUPLET_SIZE, TUPLET_HOOK,
} from "st/staff_rhythm"
import styles from "st/components/staff.module.css"

// the number of a tuplet is written in the middle of its bracket, so the
// bracket is drawn as two runs with this much of its width left for the number
const TUPLET_LABEL_ROOM = 1.6

export default class ScoreBeams extends React.PureComponent {
  static propTypes = {
    // every head the staff draws, as StaffNotes#convertToSongNotes builds them
    heads: types.array.isRequired,
    keySignature: types.object.isRequired,
    // the stem each head is drawn with (see columnStems in st/staff_rhythm)
    stems: types.object,
    offsetLeft: types.number,
    noteWidth: types.number,
    scale: types.number,
    // the clef props each column is drawn in (see Staff#clefProps)
    columnClefs: types.array,
  }

  // the clef props the column at idx is drawn in
  columnClef(idx) {
    return (this.props.columnClefs && this.props.columnClefs[idx]) || this.props
  }

  /**
   * The far end of every stem on the staff that carries a beam or a tuplet,
   * in the pixels of the staff's scale: where a beam is drawn from, and what
   * a tuplet's bracket sits beyond.
   * @returns {Object[]} {x, y, dir, beam, tuplet}
   */
  anchors() {
    let scale = this.props.scale || 1
    let key = this.props.keySignature
    let stems = this.props.stems
    let out = []

    if (!stems) { return out }

    for (let note of this.props.heads) {
      let stem = stems.get(note.id)
      if (!stem || !stem.height || (!stem.beam && !stem.tuplet)) { continue }

      let clef = this.columnClef(note.columnIdx)
      let row = noteStaffOffset(key.enharmonic(note.note))
      let width = headGlyph(note.notation && note.notation.type, NOTE_HEAD_HEIGHT * scale).width
      // a head another voice doubles is drawn a head's width to the right of
      // the played one, and its stem with it (see renderNote in ScoreNotes)
      let left = (this.props.offsetLeft || 0) + note.getStart() * this.props.noteWidth +
        (note.doubled ? width : 0)

      let stemWidth = STEM_WIDTH * scale
      let center = rowCenter(row, clef) * scale

      out.push({
        x: stem.dir == "up" ? left + width - stemWidth / 2 : left + stemWidth / 2,
        y: center + (stem.dir == "up" ? -1 : 1) * stem.height * scale,
        dir: stem.dir,
        beam: stem.beam,
        tuplet: stem.tuplet,
      })
    }

    return out
  }

  // The anchors of each group of `key`, in the order the staff draws them.
  // A looping card comes round to its own first columns while its last ones
  // are still on the staff, so one group can be drawn more than once: each
  // run of it is its own entry, and the ones the wrap cuts run off the edge
  groupsBy(anchors, key) {
    let runs = new Map()
    let byGroup = new Map()

    for (let anchor of [...anchors].sort((a, b) => a.x - b.x)) {
      let span = anchor[key]
      if (!span) { continue }

      let run = byGroup.get(span.group)
      if (!run || span.index <= run[run.length - 1][key].index) {
        run = []
        byGroup.set(span.group, run)
        runs.set(`${span.group}#${runs.size}`, run)
      }

      run.push(anchor)
    }

    return runs
  }

  // How steeply a group's beam climbs, in pixels of y to a pixel of x, from
  // the stems of it the staff holds: zero for a group only one stem of which
  // is on the staff, which is all a hook or a stub needs
  slopeOf(group) {
    let first = group[0]
    let last = group[group.length - 1]
    let run = last.x - first.x

    return run > 0 ? (last.y - first.y) / run : 0
  }

  // The band a beam of `level` fills between two stem ends, as the four
  // corners of its quadrilateral: the first beam hangs off the end of the
  // stems and the rest stack back along them, towards the heads
  band(level, dir, scale, x1, y1, x2, y2) {
    let thickness = BEAM_THICKNESS * scale
    let step = (level - 1) * (thickness + BEAM_GAP * scale)
    let into = dir == "up" ? 1 : -1

    let near1 = y1 + into * step
    let near2 = y2 + into * step

    return `M${x1.toFixed(1)} ${near1.toFixed(1)}L${x2.toFixed(1)} ${near2.toFixed(1)}` +
      `L${x2.toFixed(1)} ${(near2 + into * thickness).toFixed(1)}` +
      `L${x1.toFixed(1)} ${(near1 + into * thickness).toFixed(1)}Z`
  }

  // The beams of one group: one band a level, drawn between the stems of it
  // the staff holds. A run whose first or last stem is not on the staff — the
  // card's edge cuts the group, or the score beams it on past this card —
  // runs its band off that side, and a level only one stem is short enough
  // for draws the hook the score writes
  renderGroup(id, group, scale) {
    let {segments} = group[0].beam
    let dir = group[0].dir
    let slope = this.slopeOf(group)
    let stub = BEAM_STUB * scale
    let hook = BEAM_HOOK * scale
    let out = []

    segments.forEach((segment, idx) => {
      let held = group.filter(anchor =>
        anchor.beam.index >= segment.from && anchor.beam.index <= segment.to)

      if (!held.length) { return }

      let first = held[0]
      let last = held[held.length - 1]
      let [x1, x2] = [first.x, last.x]

      if (segment.openStart || first.beam.index > segment.from) {
        x1 -= stub
      }

      if (segment.openEnd || last.beam.index < segment.to) {
        x2 += stub
      }

      if (x2 - x1 < hook / 2 && segment.hook) {
        // a lone short note's partial beam, pointing the way the score writes it
        if (segment.hook == "backward") {
          x1 = x2 - hook
        } else {
          x2 = x1 + hook
        }
      }

      out.push(<path
        key={`${id}-${idx}`}
        className={styles.beam}
        data-beam={segment.level}
        d={this.band(segment.level, dir, scale,
          x1, first.y + (x1 - first.x) * slope,
          x2, last.y + (x2 - last.x) * slope)} />)
    })

    return out
  }

  // The number of each tuplet, centred over the stems it is written across,
  // with the bracket that marks out a group the beams don't already
  renderTuplet(id, group, scale) {
    let {notes, bracket} = group[0].tuplet
    let dir = group[0].dir
    let out = []

    let beamed = group.some(anchor => anchor.beam)
    let past = (TUPLET_OFFSET + (beamed ? BEAM_THICKNESS : 0)) * scale
    let size = TUPLET_SIZE * scale

    let ends = group.map(anchor => anchor.y)
    let y = dir == "up" ?
      Math.min(...ends) - past : Math.max(...ends) + past

    let x1 = group[0].x
    let x2 = group[group.length - 1].x
    let middle = (x1 + x2) / 2

    out.push(<text
      key={`${id}-number`}
      className={styles.tuplet_number}
      data-tuplet={notes}
      x={middle.toFixed(1)}
      y={(y + (dir == "up" ? 0 : size)).toFixed(1)}
      style={{fontSize: `${size}px`}}
      textAnchor="middle">{notes}</text>)

    if (bracket && x2 > x1) {
      let room = size * TUPLET_LABEL_ROOM / 2
      let line = y + (dir == "up" ? -size / 3 : size * 2 / 3)
      let hook = line + (dir == "up" ? 1 : -1) * TUPLET_HOOK * scale
      let at = (from, to) => `M${from.toFixed(1)} ${hook.toFixed(1)}` +
        `L${from.toFixed(1)} ${line.toFixed(1)}L${to.toFixed(1)} ${line.toFixed(1)}`

      out.push(<path
        key={`${id}-bracket`}
        className={styles.tuplet_bracket}
        d={at(x1, middle - room)} />)
      out.push(<path
        key={`${id}-bracket-end`}
        className={styles.tuplet_bracket}
        d={`M${x2.toFixed(1)} ${hook.toFixed(1)}L${x2.toFixed(1)} ${line.toFixed(1)}` +
          `L${(middle + room).toFixed(1)} ${line.toFixed(1)}`} />)
    }

    return out
  }

  render() {
    let scale = this.props.scale || 1
    let anchors = this.anchors()

    if (!anchors.length) { return null }

    let out = []

    for (let [id, group] of this.groupsBy(anchors, "beam")) {
      out.push(...this.renderGroup(id, group, scale))
    }

    for (let [id, group] of this.groupsBy(anchors, "tuplet")) {
      out.push(...this.renderTuplet(id, group, scale))
    }

    if (!out.length) { return null }

    return <svg className={styles.beams}>{out}</svg>
  }
}
