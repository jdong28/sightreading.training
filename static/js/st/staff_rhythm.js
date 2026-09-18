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
export function dotFactor(dots) {
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
// next column's onset, or, for the last column (and a looping card's repeat of
// its first), the beats the column itself was extracted with. Columns without
// beats, eg. a generated drill, hold one column each
function columnBeats(columns, idx) {
  let column = columns[idx]
  if (!column || column.beat == null) { return null }

  let next = columns[idx + 1]
  if (next && next.beat > column.beat) {
    return next.beat - column.beat
  }

  return column.beats > 0 ? column.beats : null
}

// How close two heads are ever drawn, in column widths. A run of notes
// shorter than the section moves in, a triplet or a group of sixteenths, is
// squeezed up to here and no further, so the heads stay clear of each other
// and a bar of them can't drag the card off the staff plate
export const MIN_COLUMN_ADVANCE = 0.75

// How a note's room grows with its length, the way an engraver spaces a
// system: not in proportion to the length but well under it, so a note twice
// as long as its neighbours takes about half again their room rather than
// twice it, and a whole note among eighths doesn't swallow the bar. Because
// the exponent is below one and the unit is the mean gap, the columns of a
// card never span more room than the same number of even columns would
// (Jensen), so a card that fitted the staff plate before still fits
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
    return Math.max(Math.pow(beats / unit, SPACING_EXPONENT), MIN_COLUMN_ADVANCE)
  })
}

/**
 * Where the columns are drawn and how much room each one holds.
 * @param {Array} columns the columns on the staff
 * @param {Array} [unitColumns] the whole card the columns are a window of
 * @returns {{offsets: number[], advances: number[], gaps: Array, unit: number|null}}
 * offsets and advances in column widths, gaps the beats each column holds
 */
export function columnLayout(columns, unitColumns) {
  let advances = columnAdvances(columns, unitColumns)
  let offsets = []
  let at = 0

  for (let advance of advances) {
    offsets.push(at)
    at += advance
  }

  return {
    offsets,
    advances,
    gaps: columns.map((column, idx) => columnBeats(columns, idx)),
    unit: columnUnit(unitColumns && unitColumns.length ? unitColumns : columns),
  }
}

// Where each column is drawn, in column widths from the first one (see
// columnAdvances)
export function columnOffsets(columns, unitColumns) {
  return columnLayout(columns, unitColumns).offsets
}

// The distance in column widths from the first column of columns to the last,
// what a card is fitted to the staff plate by
export function columnSpan(columns) {
  if (!columns || columns.length < 2) { return 0 }
  let offsets = columnOffsets(columns)
  return offsets[offsets.length - 1]
}

// The stem direction of a group of notes sharing a staff, a column and a
// voice: away from the voice the group is not (an upper voice stems up and a
// lower voice down), else away from the middle line, which is what a single
// voice does. The direction the score writes (notation.stem) is not used: it
// is the direction of the beam the note belongs to, and until beams are drawn
// a lone note under it would stem the wrong way and hang its flag over the
// notes around it
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

// Groups the notes a staff draws in one column by voice, since each voice
// carries its own stem. Entries are in the order the notes are drawn, each
// {voice, indices} into notes, and a group's notes share one stem
// notations: the notation of each note, or null for a note without one
export function voiceGroups(notations) {
  let groups = []
  let byVoice = new Map()

  notations.forEach((notation, idx) => {
    let voice = (notation && notation.voice) || 0
    if (!byVoice.has(voice)) {
      let group = {voice, indices: []}
      byVoice.set(voice, group)
      groups.push(group)
    }
    byVoice.get(voice).indices.push(idx)
  })

  return groups
}

// Where each voice of a staff's column sits relative to the others, by the
// notes it holds: {voice: "upper"|"lower"} when two or more voices share the
// column, so their stems point away from each other, else an empty object
// rowsByVoice: Map of voice -> the staff rows of its notes
export function voicePositions(rowsByVoice) {
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
export const STEM_LENGTH = STAFF_SPACE * 3.5
export const DOT_SIZE = STAFF_SPACE * 0.26
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
export const REST_GLYPHS = {
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

// How far below the top of a staff drawn with clef props the line of row
// falls, in unscaled pixels
export function rowLine(row, {upperRow}) {
  return (upperRow - row) * STAFF_ROW
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
export function columnExtras(columns, {offsets, advances, gaps, unit, staff}) {
  if (!offsets || !advances) { return [] }

  let out = []

  columns.forEach((column, idx) => {
    let beats = gaps && gaps[idx]

    for (let extra of column.extras || []) {
      if (staff && extra.staff && extra.staff != staff) { continue }
      // a beat of the column's own room, so a head or rest between two
      // columns keeps its place however that column is spaced; a column
      // whose room isn't known goes by the card's own beat to a column width
      let into = beats > 0 ?
        advances[idx] * (extra.beat - column.beat) / beats :
        (extra.beat - column.beat) / (unit > 0 ? unit : 1)

      out.push({...extra, columnIdx: idx, offset: offsets[idx] + into})
    }
  })

  return out
}

/**
 * The arcs drawn for the ties between heads. A tie whose other head is not on
 * the staff, because it is on the card before or after this one, is drawn as
 * a stub running off that side.
 * @param {Object[]} heads {beat, name, x, y, stem, tieTo, tieFrom}, in the
 * pixels of the staff's scale
 * @param {number} stub how far a tie with no head to run to reaches
 * @returns {Object[]} {x1, y1, x2, y2, dir}, dir the side the arc bulges to
 */
export function tieArcs(heads, stub) {
  let at = (beat, name) => heads.find(head =>
    head.name == name && Math.abs(head.beat - beat) < BEAT_EPSILON)

  let arcs = []
  // a tie bulges away from its stem, as it does on paper
  let arcDir = head => head.stem == "up" ? "down" : "up"

  for (let head of heads) {
    if (head.tieTo != null) {
      let next = at(head.tieTo, head.name)
      arcs.push({
        x1: head.x, y1: head.y,
        x2: next ? next.x : head.x + stub,
        y2: next ? next.y : head.y,
        dir: arcDir(head),
      })
    }

    if (head.tieFrom != null && !at(head.tieFrom, head.name)) {
      arcs.push({
        x1: head.x - stub, y1: head.y,
        x2: head.x, y2: head.y,
        dir: arcDir(head),
      })
    }
  }

  return arcs
}
