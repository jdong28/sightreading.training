// The difficulty strip (st/difficulty): one cell per printed bar, coloured
// by its heat, with brackets above for the flagged passages. Shared by the
// passages view (stage 1) and, later, the planner's path and today's
// programme (stages 2 and 3).

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {romanNumeral} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"

import styles from "./bar_strip.module.css"

const LEVEL_CLASS = {1: styles.level_1, 2: styles.level_2, 3: styles.level_3}

// the index in numbers (score order) of a printed number, the last index
// when more than one position shares it (a bar split round a repeat)
function lastIndexOfNumber(numbers, number) {
  let idx = -1
  numbers.forEach((n, i) => { if (n == number) { idx = i } })
  return idx
}

function firstIndexOfNumber(numbers, number) {
  return numbers.findIndex(n => n == number)
}

// about how many axis numbers to show, evenly spaced
const AXIS_MARKS = 5

export function BarStrip({numbers, heat, flags, selectedId, onSelect}) {
  let count = numbers.length
  if (!count) { return null }

  let axisIndices = new Set([0, count - 1])
  for (let i = 1; i < AXIS_MARKS - 1; i++) {
    axisIndices.add(Math.round(i * (count - 1) / (AXIS_MARKS - 1)))
  }

  let pct = idx => `${idx / count * 100}%`
  let widthPct = (from, to) => `${(to - from + 1) / count * 100}%`

  return <div className={styles.strip}>
    <div className={styles.brackets}>
      {flags.map((flag, flagIdx) => {
        let from = firstIndexOfNumber(numbers, flag.start)
        let to = lastIndexOfNumber(numbers, flag.end)
        if (from < 0 || to < 0) { return null }

        let bars = flag.start == flag.end ? `bar ${flag.start}` : `bars ${flag.start}–${flag.end}`
        let on = flag.id == selectedId

        return <button
          key={flag.id}
          type="button"
          className={classNames(styles.bracket, LEVEL_CLASS[flag.level], {
            [styles.on]: on,
            [styles.stagger]: flagIdx % 2 == 1,
          })}
          style={{left: pct(from), width: widthPct(from, to)}}
          aria-label={`Passage ${romanNumeral(flag.num)}, ${bars}, ${LEVEL_WORDS[flag.level]}: ${flag.title}`}
          onClick={() => onSelect && onSelect(flag.id)}>
          <span aria-hidden="true">{romanNumeral(flag.num)}</span>
        </button>
      })}
    </div>

    <div className={styles.cells} role="presentation">
      {numbers.map((number, idx) =>
        <span key={idx} className={classNames(styles.cell, styles[`heat_${heat[idx] || 0}`])} />
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
  // the flags in force (st/difficulty/records.flagsInForce)
  flags: types.array.isRequired,
  selectedId: types.string,
  onSelect: types.func,
}

export default BarStrip
