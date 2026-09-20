// The rhythm notation the staff draws: notated values, the beat proportional
// horizontal layout of a card's columns, and the stems, flags, dots, rests
// and tie arcs a column of an imported piece is drawn with.
//
// Detection never looks at any of this: a column is still matched by its note
// names alone (st/note_list), and note lengths, ties and tuplets are never
// judged. This module only says how the notes already in a column are drawn,
// so an imported score looks like the score it came from.
//
// Columns carry the drawing data as `notation` (one entry per note of the
// column) and `extras` (the rests and tied continuation heads between this
// column and the next); see extractSectionColumns in st/song_sections.

// Every notated value, in quarter note beats, with the head it is drawn with
// ("whole", "half" or "filled"), whether it carries a stem and how many flags
// a single (unbeamed) note of it draws
export const NOTE_TYPES = {
  breve: {beats: 8, head: "whole", stem: false, flags: 0},
  whole: {beats: 4, head: "whole", stem: false, flags: 0},
  half: {beats: 2, head: "half", stem: true, flags: 0},
  quarter: {beats: 1, head: "filled", stem: true, flags: 0},
  eighth: {beats: 0.5, head: "filled", stem: true, flags: 1},
  "16th": {beats: 0.25, head: "filled", stem: true, flags: 2},
  "32nd": {beats: 0.125, head: "filled", stem: true, flags: 3},
  "64th": {beats: 0.0625, head: "filled", stem: true, flags: 4},
  "128th": {beats: 0.03125, head: "filled", stem: true, flags: 5},
}

// the values a duration is spelled with, longest first
const TYPES_BY_LENGTH = Object.keys(NOTE_TYPES)
  .sort((a, b) => NOTE_TYPES[b].beats - NOTE_TYPES[a].beats)

// the most augmentation dots a duration is spelled with
const MAX_DOTS = 2

const BEAT_EPSILON = 1e-6

// how much longer dots make a note: one dot is 1.5x, two 1.75x
function dotFactor(dots) {
  return 2 - Math.pow(2, -(dots || 0))
}

// The notated value a duration in beats is written as: {type, dots}, exact
// when the duration spells one (with up to two dots), else the longest value
// that fits, so an unusual duration is still drawn as a note. Null for a
// duration that is zero or negative.
export function typeForBeats(beats) {
  if (!(beats > 0)) { return null }

  for (let type of TYPES_BY_LENGTH) {
    for (let dots = 0; dots <= MAX_DOTS; dots++) {
      if (Math.abs(NOTE_TYPES[type].beats * dotFactor(dots) - beats) < BEAT_EPSILON) {
        return {type, dots}
      }
    }
  }

  let type = TYPES_BY_LENGTH.find(name => NOTE_TYPES[name].beats <= beats + BEAT_EPSILON)
  return {type: type || TYPES_BY_LENGTH[TYPES_BY_LENGTH.length - 1], dots: 0}
}

// how the notated value type is drawn, falling back to a quarter note
export function noteTypeProps(type) {
  return NOTE_TYPES[type] || NOTE_TYPES.quarter
}

// How long a column holds the staff before the next one, in beats: up to the
// next column's onset, or, for the last column, the beats the column itself
// was extracted with. A column drawn again, where a looping card wraps back to
// its start, holds the staff for as long as the column it repeats, never the
// beats the card has left after that column. Columns without beats, eg. a
// generated drill, hold one column each
function columnBeats(columns, idx) {
  let column = columns[idx]
  if (!column || column.beat == null) { return null }

  let next = columns[idx + 1]
  if (next && next.beat > column.beat) {
    return next.beat - column.beat
  }

  let repeated = columns.findIndex(other => other && other.beat === column.beat)
  if (repeated >= 0 && repeated < idx) {
    return columnBeats(columns, repeated)
  }

  if (!(column.beats > 0)) { return null }

  // a looping card wraps from here back to an earlier column, which comes
  // round with the extras that lead it, so the gap holds their beats too
  return column.beats + columnLead(next)
}

// The most beats a column's own extras fall before it: the rest a bar opens
// with, or a head a tie runs on to from a column the staff can't show
function columnLead(column) {
  let most = 0

  if (!column || column.beat == null) { return most }

  for (let extra of column.extras || []) {
    let before = column.beat - extra.beat
    if (before > most) {
      most = before
    }
  }

  return most
}

// How close two heads are ever drawn, in column widths. A run of notes
// shorter than the section moves in, a triplet or a group of sixteenths, is
// squeezed up to here and no further, so the heads stay clear of each other
// and a bar of them can't drag the card off the staff plate
export const MIN_COLUMN_ADVANCE = 0.75

// How a note's room grows with its length, the way an engraver spaces a
// system: not in proportion to the length but well under it, so a note twice
// as long as its neighbours takes about half again their room rather than
// twice it, and a whole note among eighths doesn't swallow the bar. Because the
// unit is the mean gap, a card of even notes spans exactly one column width a
// note, as a drill without the score's rhythm does; an uneven card can span
// more than its column count, which a dense run held at MIN_COLUMN_ADVANCE
// under a long note does, and the staff takes that up by shrinking towards
// MIN_FIT_SCALE (st/components/pages/sight_reading_page)
export const SPACING_EXPONENT = 0.55

// The beat a column width measures: the mean gap between the columns, so a
// section of even notes draws a column width apart, exactly as a drill
// without the score's rhythm does. Null when no column carries its beats
export function columnUnit(columns) {
  let total = 0
  let gaps = 0

  for (let idx = 0; idx < columns.length; idx++) {
    let beats = columnBeats(columns, idx)
    if (beats > 0) {
      total += beats
      gaps += 1
    }
  }

  return gaps ? total / gaps : null
}

// How many column widths each column holds the staff for, measured over
// unitColumns (the whole card, so the layout holds still as the notes slide
// through the staff). Every column holds one width when the columns carry no
// beats, which is what a generated drill and a piece imported before the
// score's rhythm was kept draw
export function columnAdvances(columns, unitColumns=columns) {
  let unit = columnUnit(unitColumns && unitColumns.length ? unitColumns : columns)
  if (!unit) {
    return columns.map(() => 1)
  }

  return columns.map((column, idx) => {
    let beats = columnBeats(columns, idx)
    if (!(beats > 0)) { return 1 }
    return roomFor(beats, unit)
  })
}

// The room a gap of that many beats holds, in column widths, where a column
// width is unit beats (see SPACING_EXPONENT and MIN_COLUMN_ADVANCE)
function roomFor(beats, unit) {
  if (!(beats > 0) || !(unit > 0)) { return 0 }
  return Math.max(Math.pow(beats / unit, SPACING_EXPONENT), MIN_COLUMN_ADVANCE)
}

// The most beats any column's extras fall before it (see columnLead). The most
// of them, because any column of a card can become the head of the window on
// the staff, and the room before the head holds still as the window slides.
// Zero when every extra falls after its column's own onset
function leadBeats(columns) {
  let most = 0

  for (let column of columns || []) {
    most = Math.max(most, columnLead(column))
  }

  return most
}

// The room a card keeps left of the leftmost extra it leads with, in column
// widths, so the tie a head there runs on from is drawn in front of it rather
// than clamped onto its own head. A column is never narrower than a note head
// (see minNoteWidth in st/components/staff_notes) and a tie's stub is about a
// head wide (TIE_STUB in st/components/staff/score_extras)
const LEAD_STUB_ROOM = 1

// Whether the extra leading its column by the most beats is a head a tie runs
// on to rather than a rest: only a head draws a tie back past itself, so only
// then is the stub's room kept
function leadsWithTiedHead(columns, lead) {
  if (!(lead > 0)) { return false }

  for (let column of columns || []) {
    if (!column || column.beat == null) { continue }

    for (let extra of column.extras || []) {
      if (extra.kind == "head" &&
        Math.abs(column.beat - extra.beat - lead) < BEAT_EPSILON) {
        return true
      }
    }
  }

  return false
}

/**
 * Where the columns are drawn and how much room each one holds. The first
 * column is offset by the room its card keeps for the extras that fall before
 * one of its columns, so a bar opening on a rest draws it there rather than
 * over the clef or the head of its own bar.
 * @param {Array} columns the columns on the staff
 * @param {Array} [unitColumns] the whole card the columns are a window of
 * @returns {{offsets: number[], advances: number[], gaps: Array, unit:
 * number|null, leadBeats: number, leadFrom: number}} offsets and advances in
 * column widths, gaps the beats each column holds, leadBeats the beats the
 * reserved room holds and leadFrom where it starts, which is past the staff's
 * own notes when a tie runs on to the head that leads (see LEAD_STUB_ROOM)
 */
export function columnLayout(columns, unitColumns) {
  let advances = columnAdvances(columns, unitColumns)
  let unitOf = unitColumns && unitColumns.length ? unitColumns : columns
  let unit = columnUnit(unitOf)
  // measured over the card, not the window, so the room holds still as the
  // notes slide through the staff
  let beats = leadBeats(unitOf)
  let from = leadsWithTiedHead(unitOf, beats) ? LEAD_STUB_ROOM : 0
  let offsets = []
  let at = from + roomFor(beats, unit)

  for (let advance of advances) {
    offsets.push(at)
    at += advance
  }

  return {
    offsets,
    advances,
    gaps: columns.map((column, idx) => columnBeats(columns, idx)),
    unit,
    leadBeats: beats,
    leadFrom: from,
  }
}

// Where each column is drawn, in column widths from the first one (see
// columnAdvances)
export function columnOffsets(columns, unitColumns) {
  return columnLayout(columns, unitColumns).offsets
}

// The room the columns need in column widths, what a card is fitted to the
// staff plate by: up to the last column, from the staff's notes rather than
// from the first column, so the room reserved before it is fitted too, and
// measured in the unit the staff draws the card with (see columnAdvances)
export function columnSpan(columns, unitColumns) {
  if (!columns || columns.length < 2) { return 0 }
  let offsets = columnOffsets(columns, unitColumns)
  return offsets[offsets.length - 1]
}

// The stem direction of a group of notes sharing a staff, a column and a
// voice: away from the voice the group is not (an upper voice stems up and a
// lower voice down), else away from the middle line, which is what a single
// voice does. A voice's position is its place in the bar, not in the column
// (see columnStems), so a voice turns its stems the same way right through a
// bar the other voice only strikes part of, as it is written on paper. The
// direction the score writes is not kept at all (st/musicxml): it is the
// direction of the beam the note belongs to, and until beams are drawn a lone
// note under it would stem the wrong way and hang its flag over the notes
// around it
// rows: the staff rows of the group's notes
// middleRow: the staff's middle line
// opts.voicePosition: "upper" or "lower" when two voices share the staff
export function stemDirection(rows, middleRow, {voicePosition}={}) {
  if (voicePosition) {
    return voicePosition == "upper" ? "up" : "down"
  }

  // the note furthest from the middle line decides, as it does on paper, and
  // a note on the line itself stems down
  let furthest = rows.reduce((far, row) =>
    Math.abs(row - middleRow) > Math.abs(far - middleRow) ? row : far, middleRow)

  return furthest >= middleRow ? "down" : "up"
}

// Where each voice of a staff's bar sits relative to the others, by the notes
// it holds: {voice: "upper"|"lower"} when two or more voices share the bar,
// so their stems point away from each other, else an empty object
// rowsByVoice: Map of voice -> the staff rows of its notes
function voicePositions(rowsByVoice) {
  let voices = [...rowsByVoice.keys()]
  if (voices.length < 2) { return {} }

  let highest = voice => Math.max(...rowsByVoice.get(voice))
  // the higher notes are the upper voice; voices on the same notes keep the
  // order the score writes them in, where the upper voice comes first
  let sorted = [...voices].sort((a, b) => highest(b) - highest(a) || a - b)

  let out = {}
  sorted.forEach((voice, idx) => {
    out[voice] = idx == 0 ? "upper" : "lower"
  })

  return out
}

/**
 * The stem the staff draws each head with, so everything drawn from a stem —
 * its flags, and the ties bowing away from it — agrees with it. The heads one
 * voice strikes at once share one stem, drawn from the lowest note of a group
 * stemming up and the highest of one stemming down; the others carry only the
 * direction it turns. A voice's position is settled over the whole bar, so
 * every stem of a voice sharing a bar with another turns the same way, rather
 * than only in the columns where the other voice also strikes. Only notated
 * values that carry a stem have one, so a column of whole notes, and every
 * head without notation, has none.
 * @param {Object[]} heads the heads one staff draws, each {bar, column, row,
 * middleRow, notation}: the bar and the column it is struck in, the staff row
 * it is drawn on, the middle line of its own column's clef, and how the score
 * writes it
 * @returns {Array} one entry per head, in the order they were given: null for
 * a head with no stem, else {dir}, with {height, flags} on the head that
 * carries its group's stem
 */
export function columnStems(heads) {
  let stems = heads.map(() => null)
  let voiceOf = head => (head.notation && head.notation.voice) || 0

  let bars = new Map()
  heads.forEach((head, idx) => {
    let bar = head.bar ?? null
    if (!bars.has(bar)) {
      bars.set(bar, [])
    }
    bars.get(bar).push(idx)
  })

  for (let bar of bars.values()) {
    let rowsByVoice = new Map()
    for (let idx of bar) {
      let voice = voiceOf(heads[idx])
      if (!rowsByVoice.has(voice)) {
        rowsByVoice.set(voice, [])
      }
      rowsByVoice.get(voice).push(heads[idx].row)
    }

    let positions = voicePositions(rowsByVoice)

    // the heads of one voice struck at once, which share the stem
    let groups = new Map()
    for (let idx of bar) {
      let key = `${heads[idx].column}/${voiceOf(heads[idx])}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push(idx)
    }

    for (let group of groups.values()) {
      let notations = group.map(idx => heads[idx].notation)
      if (!notations.some(notation => notation && noteTypeProps(notation.type).stem)) {
        continue
      }

      // the shortest value of the group carries the stem's flags, as the
      // one stem is drawn for all of them
      let flags = Math.max(...notations.map(notation =>
        noteTypeProps(notation && notation.type).flags))

      let rows = group.map(idx => heads[idx].row)
      let dir = stemDirection(rows, heads[group[0]].middleRow,
        {voicePosition: positions[voiceOf(heads[group[0]])]})

      let anchorRow = dir == "up" ? Math.min(...rows) : Math.max(...rows)
      let anchor = group[rows.indexOf(anchorRow)]
      let span = Math.max(...rows) - Math.min(...rows)

      for (let idx of group) {
        stems[idx] = idx == anchor ?
          {dir, height: STEM_LENGTH + span * STAFF_ROW, flags} : {dir}
      }
    }
  }

  return stems
}

// The bar each column belongs to: the printed measure number in force at it,
// which the column opening a bar carries (see cardColumn in st/measure_cards),
// so a looping card's wrap back to its first column shares that column's bar.
// Null for columns that carry no bar lines, eg. a generated drill
export function columnBars(columns) {
  let bar = null

  return (columns || []).map(column => {
    if (column && column.measure != null) {
      bar = column.measure
    }
    return bar
  })
}

// What names a head across the unit the staff works its stems out over and the
// window it draws of that unit: the onset it is struck on, the note it is and
// the voice that writes it, which is what tells two voices' heads on one pitch
// apart
export function headKey(beat, name, notation) {
  return `${beat}/${name}/${(notation && notation.voice) || 0}`
}

// The unscaled geometry the staff draws rhythm with, in the pixels of a
// DEFAULT_HEIGHT staff (st/components/staves), which the staff's scale
// multiplies like every other offset in staff.module.css
export const STAFF_HEIGHT = 120
// the space between two staff lines, and the step between two staff rows
export const STAFF_SPACE = STAFF_HEIGHT / 4
export const STAFF_ROW = STAFF_HEIGHT / 8
// a note head is 20% of the staff tall, see .note in staff.module.css
export const NOTE_HEAD_HEIGHT = STAFF_HEIGHT * 0.2
export const STEM_WIDTH = STAFF_SPACE * 0.13
// a stem is three and a half spaces long, as it is on paper
const STEM_LENGTH = STAFF_SPACE * 3.5
export const DOT_SIZE = STAFF_SPACE * 0.26
// the space between a head or rest and its first augmentation dot, and between dots
export const DOT_GAP = DOT_SIZE
// how far a head hangs above the line of its row, see .note's transform
const HEAD_ABOVE_ROW = 0.47

// the glyph, and how wide it is for its height, of each head
export const HEAD_GLYPHS = {
  whole: {src: "/static/svg/noteheads.s0.svg", aspect: 465.648 / 275.721},
  half: {src: "/static/svg/notehead_half.svg", aspect: 121.6 / 92.11},
  filled: {src: "/static/svg/notehead_filled.svg", aspect: 121.6 / 92.11},
}

// One flag of an up stem, mirrored for a down stem: its size in spaces and
// how far apart a value's flags are stacked along the stem
export const FLAG_GLYPH = {
  src: "/static/svg/flag.svg",
  width: STAFF_SPACE * 1.1,
  height: STAFF_SPACE * 2.25,
  spacing: STAFF_SPACE * 0.8,
}

// The rests, by notated value: the glyph, its size in unscaled pixels, the
// staff row it is drawn against counting from the middle line, and where on
// the glyph that row falls (0 its top, 1 its bottom)
const REST_GLYPHS = {
  whole: {src: "/static/svg/rest_whole.svg", width: STAFF_SPACE * 1.2, height: STAFF_SPACE * 0.5, row: 2, anchor: 0},
  half: {src: "/static/svg/rest_half.svg", width: STAFF_SPACE * 1.2, height: STAFF_SPACE * 0.5, row: 0, anchor: 1},
  quarter: {src: "/static/svg/rest_quarter.svg", width: STAFF_SPACE * 0.9, height: STAFF_SPACE * 2.5, row: 0, anchor: 0.5},
  eighth: {src: "/static/svg/rest_eighth.svg", width: STAFF_SPACE, height: STAFF_SPACE * 1.7, row: 0, anchor: 0.5},
  "16th": {src: "/static/svg/rest_16th.svg", width: STAFF_SPACE, height: STAFF_SPACE * 2.5, row: 0, anchor: 0.5},
}

// the rest glyph a notated value is drawn with; values shorter than a
// sixteenth, which the drill never shows on its own, borrow its glyph
export function restGlyph(type) {
  return REST_GLYPHS[type] || REST_GLYPHS["16th"]
}

// the head glyph and the width, for a head of headHeight pixels, of a value
export function headGlyph(type, headHeight) {
  let glyph = HEAD_GLYPHS[noteTypeProps(type).head] || HEAD_GLYPHS.whole
  return {src: glyph.src, width: headHeight * glyph.aspect}
}

// The middle line of a staff drawn with clef props, the row a rest is drawn
// against and the row a single voice's stems turn at
export function middleRow({upperRow, lowerRow}) {
  return (upperRow + lowerRow) / 2
}

// How far the head of a note on row sits below the top of the staff, in
// unscaled pixels, measured to the middle of the head
export function rowCenter(row, {upperRow}) {
  return (upperRow - row) * STAFF_ROW + (0.5 - HEAD_ABOVE_ROW) * NOTE_HEAD_HEIGHT
}

/**
 * The rests and tied continuation heads the columns draw between them, placed
 * in the beat proportional layout.
 * @param {Array} columns the columns on the staff, each with its extras
 * @param {Object} opts
 * @param {number[]} opts.offsets where each column is drawn, in column widths
 * @param {number[]} opts.advances the room each column holds, in column widths
 * @param {number[]} opts.gaps the beats each column holds
 * @param {string} [opts.staff] the grand staff being drawn, when it is one of two
 * @returns {Object[]} each extra with `offset`, its own place in column widths
 */
export function columnExtras(columns, {offsets, advances, gaps, unit, leadBeats, leadFrom, staff}) {
  if (!offsets || !advances) { return [] }

  let out = []

  columns.forEach((column, idx) => {
    let beats = gaps && gaps[idx]

    for (let extra of column.extras || []) {
      if (staff && extra.staff && extra.staff != staff) { continue }

      let before = column.beat - extra.beat

      if (before > 0) {
        // An extra falling before its column: the rest a bar opens with, or
        // one carried onto this column from a column the staff can't show. It
        // keeps its share of the room before the column, which for the first
        // one is the room the layout reserves (see columnLayout), and never
        // falls back past the column before it
        let from = idx > 0 ? offsets[idx - 1] : (leadFrom || 0)
        let span = idx > 0 ? gaps[idx - 1] : leadBeats
        let room = offsets[idx] - from
        let at = span > 0 ? offsets[idx] - room * before / span : from

        out.push({...extra, columnIdx: idx, offset: Math.max(from, at)})
        continue
      }

      // a beat of the column's own room, so a head or rest between two
      // columns keeps its place however that column is spaced; a column
      // whose room isn't known goes by the card's own beat to a column width
      let into = beats > 0 ?
        advances[idx] * -before / beats :
        -before / (unit > 0 ? unit : 1)

      out.push({...extra, columnIdx: idx, offset: offsets[idx] + into})
    }
  })

  return out
}

// How far left of its own column, in column widths, the extras a column opens
// its bar with reach: the leftmost extra placed before the column (see
// columnExtras), and zero for a column whose extras all fall after its onset.
// Every staff's extras count, so the bar line the staves draw on the boundary
// is the same one on each of them
export function extrasBefore(columns, layout) {
  let out = columns.map(() => 0)

  for (let extra of columnExtras(columns, layout)) {
    let back = layout.offsets[extra.columnIdx] - extra.offset
    if (back > out[extra.columnIdx]) {
      out[extra.columnIdx] = back
    }
  }

  return out
}

// where a tie leaves and meets a head, as a share of the head's width
const TIE_START = 0.75
const TIE_END = 0.25

/**
 * The arcs drawn for the ties between heads, each running from the head it
 * leaves to the head it meets. A tie whose other head is not on the staff,
 * because it is on the card before or after this one, is drawn as a stub
 * running off that side.
 * @param {Object[]} heads {beat, name, x, y, width, stem, tieTo, tieFrom}, in
 * the pixels of the staff's scale
 * @param {number} stub how far a tie with no head to run to reaches
 * @param {Object} [opts]
 * @param {number} [opts.left] the furthest left a stub reaches back to, so a
 * tie running off this card stays clear of the clef and key signature
 * @returns {Object[]} {x1, y1, x2, y2, dir}, the ends anchored on the heads
 * the arc joins and always in reading order, and dir the side it bulges to
 */
export function tieArcs(heads, stub, {left=null}={}) {
  // The head an end joins, nearest the head asking for it on side (1 ahead of
  // it, -1 behind), rather than the first of the array: a looping card is
  // drawn more than once in one window, so the same beat and note can be on
  // the staff several times and each occurrence joins its own neighbour
  let at = (beat, name, x, side) => {
    let found = null

    for (let head of heads) {
      if (head.name != name) { continue }
      if (Math.abs(head.beat - beat) >= BEAT_EPSILON) { continue }
      if ((head.x - x) * side <= 0) { continue }
      if (!found || (head.x - found.x) * side < 0) { found = head }
    }

    return found
  }

  let arcs = []
  // a tie bulges away from its stem, as it does on paper
  let arcDir = head => head.stem == "up" ? "down" : "up"
  // a tie leaves a head near its right edge and meets one near its left
  let leaves = (x, width) => x + width * TIE_START
  let meets = (x, width) => x + width * TIE_END

  for (let head of heads) {
    if (head.tieTo != null) {
      let next = at(head.tieTo, head.name, head.x, 1)
      arcs.push({
        x1: leaves(head.x, head.width), y1: head.y,
        x2: next ? meets(next.x, next.width) : meets(head.x + stub, head.width),
        y2: next ? next.y : head.y,
        dir: arcDir(head),
      })
    }

    if (head.tieFrom != null && !at(head.tieFrom, head.name, head.x, -1)) {
      let x2 = meets(head.x, head.width)
      let from = leaves(head.x - stub, head.width)
      // the stub never runs back past the staff's notes, so a head with less
      // room in front of it than the stub reaches draws a shorter one
      let x1 = left == null ? from : Math.max(left, from)

      arcs.push({x1, y1: head.y, x2, y2: head.y, dir: arcDir(head)})
    }
  }

  return arcs
}
