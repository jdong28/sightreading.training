// The difficulty strip (st/difficulty): one cell per printed bar, coloured
// by its heat, with brackets above for the flagged passages. Shared by the
// passages view (stage 1) and, later, the planner's path and today's
// programme (stages 2 and 3).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {romanNumeral, barsLabel} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"

import styles from "./bar_strip.module.css"

const LEVEL_CLASS = {1: styles.level_1, 2: styles.level_2, 3: styles.level_3}

// the cell index of a printed bar number. numbers is measureNumberList's
// list, one entry per printed number (a bar split round a repeat is one
// number there), so a number is at one index or at none
function indexOfNumber(numbers, number) {
  return numbers.findIndex(n => n == number)
}

// about how many axis numbers to show, evenly spaced
const AXIS_MARKS = 5

export function BarStrip({numbers, heat, flags, selectedId, onSelect, picking=false, onPick}) {
  let [pickAnchor, setPickAnchor] = React.useState(null)
  let dragMoved = React.useRef(false)
  let cellsRef = React.useRef(null)

  // picking is a prop that can go false mid-pick (the review pane closing,
  // or Cancel), so a stale anchor never lingers into the next time it opens
  React.useEffect(() => {
    if (!picking) { setPickAnchor(null) }
  }, [picking])

  let count = numbers.length
  if (!count) { return null }

  let axisIndices = new Set([0, count - 1])
  for (let i = 1; i < AXIS_MARKS - 1; i++) {
    axisIndices.add(Math.round(i * (count - 1) / (AXIS_MARKS - 1)))
  }

  let pct = idx => `${idx / count * 100}%`
  let widthPct = (from, to) => `${(to - from + 1) / count * 100}%`

  let commitPick = (a, b) => {
    let from = Math.min(a, b)
    let to = Math.max(a, b)
    setPickAnchor(null)
    onPick && onPick(numbers[from], numbers[to])
  }

  // the cell under the pointer, from the cells' own rect (they are equal
  // width): a drag's capture retargets every move and up to the cell it
  // started in, so the handler's own index is the anchor's throughout
  let cellAt = e => {
    let el = cellsRef.current
    let rect = el && el.getBoundingClientRect()
    if (!rect || !rect.width) { return null }
    let idx = Math.floor((e.clientX - rect.left) / rect.width * count)
    return Math.min(count - 1, Math.max(0, idx))
  }

  let cellDown = (e, idx) => {
    if (!picking) { return }
    dragMoved.current = false
    if (pickAnchor == null) {
      setPickAnchor(idx)
    } else {
      commitPick(pickAnchor, idx)
    }

    // the release may land off the strip; capture keeps it coming here, so a
    // drag always ends in cellUp rather than leaving the anchor behind. The
    // pointer isn't always one the browser is tracking
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (err) {}
  }

  let cellMove = e => {
    if (!picking || pickAnchor == null) { return }
    let idx = cellAt(e)
    if (idx != null && idx != pickAnchor) { dragMoved.current = true }
  }

  let cellUp = e => {
    if (!picking || pickAnchor == null || !dragMoved.current) { return }
    let idx = cellAt(e)
    if (idx != null) { commitPick(pickAnchor, idx) }
  }

  return <div className={styles.strip}>
    <div className={styles.brackets}>
      {flags.map((flag, flagIdx) => {
        let from = indexOfNumber(numbers, flag.start)
        let to = indexOfNumber(numbers, flag.end)
        if (from < 0 || to < 0) { return null }

        let bars = barsLabel(flag.start, flag.end)
        let on = flag.id == selectedId

        return <button
          key={flag.id}
          type="button"
          className={classNames(styles.bracket, LEVEL_CLASS[flag.level], {
            [styles.on]: on,
            [styles.stagger]: flagIdx % 2 == 1,
            [styles.waiting]: flag.status == "waiting",
          })}
          style={{left: pct(from), width: widthPct(from, to)}}
          aria-label={`Passage ${romanNumeral(flag.num)}, ${bars}, ${LEVEL_WORDS[flag.level]}: ${flag.title}`}
          onClick={() => onSelect && onSelect(flag.id)}>
          <span aria-hidden="true">{romanNumeral(flag.num)}</span>
        </button>
      })}
    </div>

    <div
      className={classNames(styles.cells, {[styles.picking]: picking})}
      role="presentation"
      ref={cellsRef}>
      {numbers.map((number, idx) =>
        <span
          key={idx}
          className={classNames(styles.cell, styles[`heat_${heat[idx] || 0}`], {
            [styles.pick_anchor]: picking && idx == pickAnchor,
          })}
          onPointerDown={e => cellDown(e, idx)}
          onPointerMove={e => cellMove(e)}
          onPointerUp={e => cellUp(e)} />
      )}
    </div>

    <div className={styles.axis}>
      {numbers.map((number, idx) => axisIndices.has(idx) ?
        <span key={idx} className={styles.axis_label} style={{left: pct(idx)}}>{number}</span> : null)}
    </div>
  </div>
}

BarStrip.propTypes = {
  // the piece's printed bar numbers, in score order
  numbers: types.array.isRequired,
  // one 0-4 heat level per entry of numbers (st/difficulty/sections.heat)
  heat: types.array.isRequired,
  // the flags shown (st/difficulty/records.flagsInForce, or, in the review
  // pane, reviewFlags): a waiting one's bracket is dotted
  flags: types.array.isRequired,
  selectedId: types.string,
  onSelect: types.func,
  // pick mode (the review pane's "Mark a passage"): drag across cells, or
  // tap the first then the last, to call onPick(fromNumber, toNumber)
  picking: types.bool,
  onPick: types.func,
}

export default BarStrip
