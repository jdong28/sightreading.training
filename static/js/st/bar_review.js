// What lies behind a clicked bar's percentage (the "mistakes behind each
// bar's score" of the practice record design): a pure reader over the bar's
// last rows of the bar log (st/srs/records BarLogRecord, read from the store
// when the bar is clicked) that gives the window its words, its timing strip
// and the marks the score draws on the bar's notes. The % itself stays what
// it was, right notes only (item.passes, see st/bar_stats): this says which
// notes went wrong, were skipped or went by unplayed, which key was pressed
// instead, and how each note started against a steady pulse at the player's
// own pace, which is never in the %. Nothing here names a note: the owner
// reads beats, not C3 and D5, so a note is told by its beat, and a wrong key
// by where it lies against the written one.
//
// A note is the same across passes when its beat and pitch match; a bar
// without the score's rhythm has the column's place in its stead, and is
// never marked on the score. Everything is derived from the rows given, so
// the old bars (before the log) have none, and say so.

import {noteName, parseNote, noteStaffOffset} from "st/music"
import {daysAgo} from "st/srs/planner"

// how many of a bar's last rows are read
export const BAR_REVIEW_WINDOW = 5

// a note that went wrong in this many of them is filled in on the score as
// one the player tends to get wrong; once is a ring: a slip, not a habit
export const HABIT_PASSES = 2

// the share of a note's expected gap its start may be off by and still count
// as steady (the strip's shading)
export const STEADY_BAND = 0.25

// a ghost head is only drawn this many staff steps either side of the note it
// stands for
export const GHOST_RANGE = 6

// how far from the centre of its cell, in half widths, the dot of a note
// started far off the pulse stands beside its arrow
const ARROW_REACH = 0.76

// notes of a strip are told in words under it up to this many, past it the
// caption names the worst
const WORDS_UNDER = 6

const COSTLY = ["wrong", "skipped", "scrolled"]
const PHRASE = {wrong: "went wrong", skipped: "was skipped", scrolled: "went by unplayed"}
const TAG_WORD = {wrong: "wrong", skipped: "skipped", scrolled: "unplayed"}
const BLACK_KEYS = [1, 3, 6, 8, 10]

// the grid the score's beats are compared on, as the engines' join does
const TICKS = 960
const tick = beat => Math.round(beat * TICKS)

const lower = words => words.charAt(0).toLowerCase() + words.slice(1)
const upper = words => words.charAt(0).toUpperCase() + words.slice(1)
const seconds = ms => (ms / 1000).toFixed(1)
const clamp = (n, low, high) => Math.min(high, Math.max(low, n))

/**
 * What a note of a bar is called: "Beat 3" on a whole beat, "The & of beat 2"
 * on a half, else "Note 4" by its place in the bar, and "Note 4 of 6" where
 * the score's rhythm isn't known.
 * @param {number|null} beat the note's beat on the song's clock, null
 * without rhythm
 * @param {number} barStart the bar's first beat
 * @param {number} index the note's place in the bar, from 0
 * @param {number} columns the notes of the bar
 * @returns {string}
 */
export function beatLabel(beat, barStart, index, columns) {
  if (beat == null) { return `Note ${index + 1} of ${columns}` }

  let q = beat - barStart
  if (Math.abs(q - Math.round(q)) < 0.002) { return `Beat ${Math.round(q) + 1}` }
  if (Math.abs(q * 2 - Math.round(q * 2)) < 0.004) { return `The & of beat ${Math.floor(q + 0.002) + 1}` }
  return `Note ${index + 1}`
}

/**
 * How far a key pressed lies from the one the score writes, in words.
 * @param {number} played MIDI pitch
 * @param {number} written MIDI pitch
 * @returns {string} eg. "the black key just above", "the same note an
 * octave lower", "3 keys below"
 */
export function keyWords(played, written) {
  let d = played - written
  let direction = d > 0 ? "above" : "below"

  if (Math.abs(d) == 1) {
    let colour = BLACK_KEYS.includes(((played % 12) + 12) % 12) ? "black" : "white"
    return `the ${colour} key just ${direction}`
  }

  if (Math.abs(d) == 12) { return `the same note an octave ${d > 0 ? "higher" : "lower"}` }
  return `${Math.abs(d)} keys ${direction}`
}

/**
 * The staff steps from a written note up to a key pressed: the key is spelled
 * the way that lies nearest the written note (sharp or flat), so a black key
 * a step above a natural is drawn on the same line as the natural above it.
 * @param {number} played MIDI pitch
 * @param {number} written MIDI pitch
 * @returns {number} positive above the written note
 */
export function ghostSteps(played, written) {
  let target = noteStaffOffset(noteName(written, true))
  let steps = [true, false].map(sharp => noteStaffOffset(noteName(played, sharp)) - target)
  return steps.reduce((best, step) => Math.abs(step) < Math.abs(best) ? step : best)
}

function clockTime(at) {
  let date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function whenWords(at, now) {
  let day = now == null ? "today" : daysAgo(at, now)
  return day == "today" ? clockTime(at) : `${day}, ${clockTime(at)}`
}

function noteOf(name) {
  try { return parseNote(name) } catch (e) { return null }
}

const costlyMarks = row => (row.marks || []).filter(mark => COSTLY.includes(mark[1]))
const pausedMarks = row => (row.marks || []).filter(mark => mark[1] == "hesitated")

// how a cell of the strip started against the pulse, null for a note not
// struck at all or the first struck of the pass
function cellOf(row, idx, pulse) {
  let ioi = row.iois[idx]
  if (ioi == null || pulse == null) { return null }

  let gap = row.gaps[idx]
  let expected = (gap != null && gap > 0 ? gap : 1) * pulse
  let r = ioi / expected - 1
  return {r, delta: ioi - expected, expected}
}

// whether a pass has anything the strip would show: a note started outside
// the steady band, or paused on
function hasTiming(row, give) {
  if (row.mode == "self" || row.pulse == null) { return false }
  if (!give && pausedMarks(row).length) { return true }
  return row.iois.some((ioi, idx) => {
    let cell = cellOf(row, idx, row.pulse)
    return cell && Math.abs(cell.r) > STEADY_BAND
  })
}

function timingWords(cell, slipped) {
  let steady = Math.abs(cell.r) <= STEADY_BAND
  let words = steady ? "on time" : cell.delta > 0 ? `${seconds(cell.delta)} s late` : `${seconds(-cell.delta)} s early`
  return slipped ? `${words}, after a slip` : words
}

// the strip of one pass: a cell a note, its dot against the tick of where a
// steady pulse puts it
function stripOf(row, {barStart, give}) {
  let rhythm = row.beats.every(beat => beat != null)
  let marks = row.marks || []
  let pulse = row.pulse
  let columns = row.columns
  let slipped = new Set(marks.filter(mark => mark[1] == "wrong").map(mark => mark[0]))
  let skipped = new Set(marks.filter(mark => mark[1] == "skipped" || mark[1] == "scrolled").map(mark => mark[0]))
  let firstBar = row.measure == row.card[0]
  let few = columns <= WORDS_UNDER

  let cells = Array.from({length: columns}, (_, idx) => {
    let beat = row.beats[idx]
    let q = beat == null ? null : beat - barStart
    let label = q != null && Math.abs(q - Math.round(q)) < 0.002 ? (few ? `BEAT ${Math.round(q) + 1}` : `${Math.round(q) + 1}`) :
      q != null && Math.abs(q * 2 - Math.round(q * 2)) < 0.004 ? "&" : "·"
    let name = beatLabel(beat, barStart, idx, columns)
    let cell = {index: idx, label, name, kind: "steady", left: 50, arrow: null, words: null, delta: 0}

    if (skipped.has(idx)) {
      return {...cell, kind: "skipped", left: null, words: "skipped"}
    }

    let timing = cellOf(row, idx, pulse)
    if (!timing) {
      // struck at nothing before it: the first note of the pass, or a note the
      // keys held already sounded (held) and so has no start of its own
      let first = firstBar && !Array.from({length: idx}, (_, i) => row.iois[i] != null).some(Boolean)
      return first ? {...cell, kind: "first", left: 50, words: "first note"} :
        {...cell, kind: "held", left: null, words: "held"}
    }

    let off = !give && Math.abs(timing.r) > STEADY_BAND
    let paused = !give && marks.some(mark => mark[1] == "hesitated" && mark[0] == idx)
    // past 90% of the way off the strip the dot stops short of the edge and an
    // arrow takes it, as the design draws it
    let arrow = timing.r > 0.9 ? "»" : timing.r < -0.9 ? "«" : null
    let reach = arrow ? ARROW_REACH : 0.9

    return {
      ...cell,
      kind: off || paused ? "off" : "steady",
      left: 50 + 50 * clamp(timing.r, -reach, reach),
      arrow,
      delta: timing.delta,
      r: timing.r,
      words: give ? null : timingWords(timing, slipped.has(idx)),
    }
  })

  let off = cells.filter(cell => cell.kind == "off")
  let perBeat = rhythm ? "a beat" : "a note"
  let pace = `${(pulse / 1000).toFixed(2)} s ${perBeat}`

  let caption = give ?
    `Where each note started, at your own pace (${pace}). Timing is not in the %.` :
    `Against a steady pulse at your own pace (${pace}): inside the shading is steady. Timing is not in the %.`

  if (!give && !few) {
    let struck = cells.filter(cell => cell.r != null)
    let worst = struck.reduce((far, cell) => !far || Math.abs(cell.r) > Math.abs(far.r) ? cell : far, null)
    if (worst && Math.abs(worst.r) > STEADY_BAND) {
      caption += ` Furthest from the pulse: ${lower(worst.name)}, ${worst.words}.`
    }
  }

  let ariaLabel
  if (give) {
    ariaLabel = "Where each note started; timing isn't judged on this bar"
  } else if (!off.length) {
    ariaLabel = "Every note started on time"
  } else {
    let told = off.filter(cell => cell.r != null).map(cell =>
      `${cell.name} started ${seconds(Math.abs(cell.delta))} seconds ${cell.delta > 0 ? "late" : "early"}`)
    let others = cells.length - off.length > 0 ? "; the others on time" : ""
    ariaLabel = `${told.join(" and ")}${others}`
  }

  return {
    cells, caption, ariaLabel, give, pace,
    // the shading of the steady band, in % of the strip's width
    band: give ? null : {from: 50 - 50 * STEADY_BAND, to: 50 + 50 * STEADY_BAND},
    words: few && !give,
  }
}

// the most frequent of a list of {pitch, count, last}, ties to the latest
function mostFrequent(keys) {
  return [...keys.values()].reduce((best, key) =>
    !best || key.count > best.count || (key.count == best.count && key.last > best.last) ? key : best, null)
}

/**
 * The window of a clicked bar.
 * @param {Object} opts
 * @param {Object[]} opts.rows the bar's bar log rows, any number (the last
 * BAR_REVIEW_WINDOW are read)
 * @param {Object|null} opts.item the bar's single-bar item under the hand,
 * which says whether it was played before the log began
 * @param {number} opts.measure
 * @param {number} opts.barStart the bar's first beat on the song's clock
 * @param {boolean} [opts.give] the score asks for give in this bar (see
 * st/score_give): its timing isn't judged
 * @param {boolean} [opts.engraved] the score is engraved, so the notes can
 * be marked on it
 * @param {number} [opts.now]
 * @returns {Object} {state, ...}: "never" (nothing played), "before" (played,
 * but not since the log began), "acoustic" (the newest pass was graded by
 * the player: tags) or "detected" (header, lines, strip, marks, see below)
 */
export function barReview({rows, item=null, measure, barStart, give=false, engraved=false, now}) {
  let window = [...rows].sort((a, b) => a.at - b.at).slice(-BAR_REVIEW_WINDOW)

  if (!window.length) {
    return item && item.attempts > 0 ?
      {state: "before", measure, text: "Beat-by-beat details start with the passes you play from now on. Earlier passes kept only their score."} :
      {state: "never", measure}
  }

  let newest = window[window.length - 1]
  if (newest.mode == "self") {
    let tags = newest.slipped || []
    return {
      state: "acoustic", measure, tags: tags.map(upper),
      text: tags.length ?
        "Nothing is detected on an acoustic piano: these are your own \"What slipped?\" tags." : null,
    }
  }

  let detected = window.filter(row => row.mode != "self")
  let m = detected.length
  let newestIdx = m - 1
  let pct = newest.columns ? Math.round(100 * newest.clean / newest.columns) : 100

  // every note gone wrong, by where it lies in the bar
  let groups = new Map()
  detected.forEach((row, ri) => {
    for (let [idx, kind, notes, keys] of costlyMarks(row)) {
      let beat = row.beats[idx]
      let id = beat == null ? `i${idx}` : `b${tick(beat)}`
      let group = groups.get(id)
      if (!group) {
        group = {id, beat, index: idx, columns: row.columns, rows: new Set(), kind, last: ri, notes: new Map()}
        groups.set(id, group)
      }

      group.rows.add(ri)
      group.kind = kind
      group.last = ri
      group.index = idx
      group.columns = row.columns

      for (let note of notes) {
        let entry = group.notes.get(note)
        if (!entry) {
          entry = {name: note, pitch: noteOf(note), rows: new Set(), keys: new Map()}
          group.notes.set(note, entry)
        }
        entry.rows.add(ri)
      }

      // the key pressed instead is put against the nearest written note
      for (let keyName of keys) {
        let key = noteOf(keyName)
        let near = notes.map(note => ({note, pitch: noteOf(note)})).filter(n => n.pitch != null && key != null)
          .map(n => ({...n, steps: ghostSteps(key, n.pitch)}))
          .reduce((best, n) => !best || Math.abs(n.steps) < Math.abs(best.steps) ? n : best, null)
        if (!near || Math.abs(near.steps) > GHOST_RANGE) { continue }

        let held = group.notes.get(near.note).keys
        let seen = held.get(key) || {pitch: key, count: 0, last: -1}
        held.set(key, {...seen, count: seen.count + 1, last: row.at})
      }
    }
  })

  let ranked = [...groups.values()].sort((a, b) =>
    b.rows.size - a.rows.size || b.last - a.last || (a.beat ?? a.index) - (b.beat ?? b.index))

  let markable = engraved
  let habitual = group => [...group.notes.values()].some(note => note.rows.size >= HABIT_PASSES)
  let labelOf = group => beatLabel(group.beat, barStart, group.index, group.columns)
  let marked = group => markable && group.beat != null

  let times = group => {
    let n = group.rows.size
    return m == 1 ? "in your last pass" : n == m ? `in all ${m} of your last passes` :
      n == 1 ? `once in your last ${m} passes` : `in ${n} of your last ${m} passes`
  }

  let lines = []
  let worst = ranked[0]
  if (worst) {
    let tail = !marked(worst) ? "." : habitual(worst) ? ", filled in on the score." : ", ringed on the score."
    lines.push(`${labelOf(worst)} ${PHRASE[worst.kind]} ${times(worst)}${tail}`)

    let others = ranked.slice(1, 3).map(group => lower(labelOf(group)))
    if (others.length) { lines.push(`Also ${others.join(" and ")}.`) }
  } else {
    lines.push(`Every note right in your last ${m == 1 ? "pass" : `${m} passes`}.` +
      (engraved ? " Nothing to colour on the score." : ""))
  }

  // the note marks of the score
  let heads = []
  let ghosts = []
  for (let group of ranked) {
    if (group.beat == null) { continue }

    for (let note of group.notes.values()) {
      if (note.pitch == null) { continue }
      heads.push({beat: group.beat, pitch: note.pitch, kind: note.rows.size >= HABIT_PASSES ? "habit" : "once"})

      let key = mostFrequent(note.keys)
      if (key) { ghosts.push({beat: group.beat, pitch: note.pitch, played: key.pitch, steps: ghostSteps(key.pitch, note.pitch)}) }
    }
  }

  if (markable && worst) {
    let worstGhosts = ghosts.filter(ghost => worst.beat != null && tick(ghost.beat) == tick(worst.beat))
    if (marked(worst) && worstGhosts.length) {
      lines.push(`The grey head beside it is the key you pressed instead: ${
        worstGhosts.map(ghost => keyWords(ghost.played, ghost.pitch)).join(" and ")}.`)
    }

    if (ranked.every(group => !habitual(group))) {
      lines.push("Ringed rather than filled: once is a slip, not a habit.")
    }
  }

  // the strip shows the newest pass, unless it was steady and an earlier one
  // paused somewhere
  let shown = null
  if (hasTiming(newest, give)) {
    shown = newest
  } else if (!give) {
    shown = [...detected].reverse().find(row => row != newest && pausedMarks(row).length && row.pulse != null) || null
  }

  let strip = shown ? stripOf(shown, {barStart, give}) : null
  let pauses = shown && !give ? pausedMarks(shown) : []
  let pauseLines = pauses.map(([idx, , , , , ms]) => {
    let label = beatLabel(shown.beats[idx], barStart, idx, shown.columns)
    let onScore = markable && shown.beats[idx] != null
    return `${label} paused ${seconds(ms)} s before it started${onScore ? ", marked ▾ on the score" : ""}.`
  })

  let tags = []
  if (worst && marked(worst)) {
    let lowest = [...worst.notes.values()].filter(note => note.pitch != null).sort((a, b) => a.pitch - b.pitch)[0]
    let n = worst.rows.size
    let word = TAG_WORD[worst.kind]
    if (lowest) {
      tags.push({
        beat: worst.beat, pitch: lowest.pitch, tone: "oxblood",
        text: n >= HABIT_PASSES ? `${word} ${n} of ${m}` : m == 1 ? `${word} once` : `${word} once in ${m}`,
      })
    }
  }

  let pauseMarks = markable ? pauses.filter(mark => shown.beats[mark[0]] != null).map(mark => ({
    beat: shown.beats[mark[0]], ms: mark[5],
  })) : []
  if (pauseMarks.length && tags.length < 2) {
    tags.push({beat: pauseMarks[0].beat, pitch: null, tone: "gilt", text: `${seconds(pauseMarks[0].ms)} s pause`})
  }

  let right = `${shown && shown != newest ? "Earlier" : "Latest"} pass · ${whenWords((shown || newest).at, now)}`

  return {
    state: "detected",
    measure,
    pct,
    passes: m,
    header: {
      left: pct < 100 ? `Behind the ${pct}%` : strip ? "Every note right · timing" : "Every note right",
      behind: pct < 100,
      right,
    },
    lines,
    strip,
    pauseLines,
    giveLine: strip && give ? "The score asks for give here (a fermata or a rit.), so this bar's timing isn't judged." : null,
    marks: markable ? {
      measure, heads, ghosts, pauses: pauseMarks.map(mark => ({beat: mark.beat})), tags,
    } : null,
  }
}
