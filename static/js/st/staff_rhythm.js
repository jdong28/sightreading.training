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
function columnBeats(columns, idx, rests=true) {
  let column = columns[idx]
  if (!column || column.beat == null) { return null }

  let next = columns[idx + 1]
  if (next && next.beat > column.beat) {
    // a bar holding no column between the two is drawn in room of its own, so
    // the gap is only what this column's own measure holds (see columnTrail)
    if (column.beats > 0 && columnTrail(columns, idx) > 0) {
      return column.beats
    }
    return next.beat - column.beat
  }

  let repeated = columns.findIndex(other => other && other.beat === column.beat)
  if (repeated >= 0 && repeated < idx) {
    return columnBeats(columns, repeated, rests)
  }

  if (!(column.beats > 0)) { return null }

  // a looping card wraps from here back to an earlier column, which comes
  // round with the extras that lead it, so the gap holds their beats too
  return column.beats + columnLead(next, rests)
}

// The bars drawn on the boundary after the column at idx, which hold no column
// of their own (see sectionCard in st/measure_cards): a card hangs the bars it
// ends on on its last column, and every other one on the column it is drawn
// before (see cardColumn)
function boundaryBars(columns, idx) {
  let column = columns[idx]
  let next = columns[idx + 1]
  let out = []

  for (let bar of (column && column.beat != null && column.bars) || []) {
    if (bar.beats > 0 && bar.beat >= column.beat) { out.push(bar) }
  }

  for (let bar of (next && next.beat != null && next.bars) || []) {
    if (bar.beats > 0 && bar.beat < next.beat) { out.push(bar) }
  }

  return out
}

// The beats the bars drawn on the boundary after the column at idx cover past
// that column's own: they are drawn in room of their own there, never over the
// note the column holds (see boundaryBars)
function columnTrail(columns, idx) {
  let column = columns[idx]
  let most = 0

  if (!column || column.beat == null) { return most }

  let end = column.beat + (column.beats > 0 ? column.beats : 0)

  for (let bar of boundaryBars(columns, idx)) {
    most = Math.max(most, bar.beat + bar.beats - end)
  }

  return most
}

// The beat the bars a column carries that hold no column open at, Infinity for
// a column carrying none: everything the score writes from there on belongs to
// those bars rather than to the room before the column's own head
export function barsOpenAt(column) {
  let opens = Infinity

  if (!column || column.beat == null) { return opens }

  for (let bar of column.bars || []) {
    if (!(bar.beats > 0) || bar.beat >= column.beat) { continue }
    opens = Math.min(opens, bar.beat)
  }

  return opens
}

// The most beats a column's own extras fall before it: the rest a bar opens
// with, or a head a tie runs on to from a column the staff can't show, and the
// bars drawn before it that hold no column at all (see cardColumn in
// st/measure_cards), which keep the room their own beats are worth however
// little of them is drawn. A staff that draws none of the score's rests (see
// restsStaff in st/components/staff_notes) leaves those out, since it keeps no
// room for what it never draws
function columnLead(column, rests=true) {
  let most = 0

  if (!column || column.beat == null) { return most }

  for (let extra of column.extras || []) {
    if (!rests && extra.kind == "rest") { continue }

    let before = column.beat - extra.beat
    if (before > most) {
      most = before
    }
  }

  for (let bar of column.bars || []) {
    let before = column.beat - bar.beat
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
export function columnUnit(columns, {rests=true}={}) {
  let total = 0
  let gaps = 0

  for (let idx = 0; idx < columns.length; idx++) {
    let beats = columnBeats(columns, idx, rests)
    if (beats > 0) {
      total += beats
      gaps += 1
    }
  }

  return gaps ? total / gaps : null
}

// The room kept before the extras a column's bar opens with, in column
// widths, so the bar line those extras belong to is drawn in front of them
// rather than through them: the line sits halfway into this room (see
// barLineBoxes in st/components/staff_notes), which is about a note head at the
// widths the staff fits its columns to
export const OPENING_EXTRA_ROOM = 0.5

// The room the column at idx holds past its own beats: the boundary a bar
// line is drawn in (see OPENING_EXTRA_ROOM), kept whenever something of the
// next bar is drawn there — the extras the next column's bar opens with, or
// the bars a card ends on — and the room those bars are themselves drawn in
// (see columnTrail), so a bar line and its rests never land on the note the
// column holds
function closingRoom(columns, idx, unit, rests) {
  let trail = roomFor(columnTrail(columns, idx), unit)
  let opens = trail > 0 || columnLead(columns[idx + 1], rests) > 0

  return (opens ? OPENING_EXTRA_ROOM : 0) + trail
}

// How many column widths each column holds the staff for, measured over
// unitColumns (the whole card, so the layout holds still as the notes slide
// through the staff). A column holds the room the bar after it needs on top
// of its beats (see closingRoom). Every column holds one width when the
// columns carry no beats, which is what a generated drill and a piece
// imported before the score's rhythm was kept draw
export function columnAdvances(columns, unitColumns=columns, {rests=true}={}) {
  let unit = columnUnit(unitColumns && unitColumns.length ? unitColumns : columns, {rests})
  if (!unit) {
    return columns.map(() => 1)
  }

  return columns.map((column, idx) => {
    let beats = columnBeats(columns, idx, rests)
    let closing = closingRoom(columns, idx, unit, rests)
    if (!(beats > 0)) { return 1 + closing }
    return roomFor(beats, unit) + closing
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
function leadBeats(columns, rests) {
  let most = 0

  for (let column of columns || []) {
    most = Math.max(most, columnLead(column, rests))
  }

  return most
}

/**
 * Where the columns are drawn and how much room each one holds. The first
 * column is offset by the room its card keeps for the extras that fall before
 * one of its columns, so a bar opening on a rest draws it there rather than
 * over the clef or the head of its own bar.
 * @param {Array} columns the columns on the staff
 * @param {Array} [unitColumns] the whole card the columns are a window of
 * @param {Object} [opts]
 * @param {boolean} [opts.rests] whether the staff draws the score's rests; a
 * staff that draws none keeps no room for them either (see restsStaff in
 * st/components/staff_notes)
 * @returns {{offsets: number[], advances: number[], gaps: Array, unit:
 * number|null, leadBeats: number, rests: boolean}} offsets and advances in
 * column widths, gaps the beats each column holds and leadBeats the beats the
 * room reserved before the first column holds
 */
export function columnLayout(columns, unitColumns, {rests=true}={}) {
  let advances = columnAdvances(columns, unitColumns, {rests})
  let unitOf = unitColumns && unitColumns.length ? unitColumns : columns
  let unit = columnUnit(unitOf, {rests})
  // measured over the card, not the window, so the room holds still as the
  // notes slide through the staff
  let beats = leadBeats(unitOf, rests)
  let offsets = []
  let at = (beats > 0 ? OPENING_EXTRA_ROOM : 0) + roomFor(beats, unit)

  for (let advance of advances) {
    offsets.push(at)
    at += advance
  }

  return {
    offsets,
    advances,
    gaps: columns.map((column, idx) => columnBeats(columns, idx, rests)),
    unit,
    leadBeats: beats,
    rests,
  }
}

// Where each column is drawn, in column widths from the first one (see
// columnAdvances)
export function columnOffsets(columns, unitColumns, opts) {
  return columnLayout(columns, unitColumns, opts).offsets
}

// The room the columns need in column widths, what a card is fitted to the
// staff plate by: up to the last column, from the staff's notes rather than
// from the first column, so the room reserved before it is fitted too, and
// measured in the unit the staff draws the card with (see columnAdvances). A
// card ending on bars that hold no column also needs the room its last column
// holds, since those bars are drawn in it (see closingRoom)
export function columnSpan(columns, unitColumns, opts) {
  if (!columns || !columns.length) { return 0 }

  let {offsets, advances} = columnLayout(columns, unitColumns, opts)
  let last = offsets.length - 1
  let trail = columnTrail(columns, last) > 0 ? advances[last] : 0

  if (columns.length < 2 && !trail) { return 0 }
  return offsets[last] + trail
}

// The stem direction of a group of notes sharing a staff, a column and a
// voice: away from the voice the group is not (an upper voice stems up and a
// lower voice down), else away from the middle line, which is what a single
// voice does. A voice's position is its place in the bar, not in the column
// (see columnStems), so a voice turns its stems the same way right through a
// bar the other voice only strikes part of, as it is written on paper. The
// direction the score writes is not kept at all (st/musicxml): it is the
// direction of the beam the note belongs to, which the staff works out for
// itself from the heads the beam joins (see beamChains)
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

// the beam the score writes at level (1 the primary beam) on the heads of a
// stem group, which share one stem and so one beam: "begin", "continue",
// "end", "forward hook", "backward hook", or null for none
function beamMark(group, level) {
  for (let notation of group.notations) {
    let value = notation && notation.beams && notation.beams[level]
    if (value) { return value }
  }

  return null
}

// the slur or tuplet spans the heads of a stem group start or stop
function spansOf(group, key) {
  let out = []

  for (let notation of group.notations) {
    for (let span of (notation && notation[key]) || []) {
      out.push(span)
    }
  }

  return out
}

/**
 * The beam groups of the stem groups of one voice of one bar, in the order
 * they are struck: each a run of groups the score joins with a primary beam,
 * from its "begin" to its "end". A run whose begin or end is not among the
 * groups — the score's group runs on past the card, or past the notes this
 * staff draws — is kept all the same and marked open at that side, so the
 * staff can draw its beam running off to the card's edge, the way a tie
 * running off the card is drawn (see tieArcs).
 * @param {Object[]} groups stem groups in x order
 * @returns {Object[]} {groups, openStart, openEnd}
 */
function beamChains(groups) {
  let chains = []
  let open = null

  for (let group of groups) {
    let mark = beamMark(group, 1)

    if (!mark) {
      open = null
      continue
    }

    if (mark == "begin" || !open) {
      open = {groups: [], openStart: mark != "begin", openEnd: true}
      chains.push(open)
    }

    open.groups.push(group)

    if (mark == "end") {
      open.openEnd = false
      open = null
    }
  }

  // a lone group beamed to nothing at either side is an unbeamed note, which
  // draws its own flags
  return chains.filter(chain =>
    chain.groups.length > 1 || chain.openStart || chain.openEnd)
}

/**
 * The beams drawn over a chain: one entry per level (1 an eighth's beam, 2 a
 * sixteenth's), spanning the run of groups short enough to carry it. A level
 * only one group is short enough for draws a partial hook, pointing the way
 * the score writes it, or, when that group opens or ends an open chain, the
 * stub that runs off the card.
 * @param {Object} chain see beamChains
 * @returns {Object[]} {level, from, to, hook, openStart, openEnd}, from and
 * to indices into the chain's groups
 */
function beamSegments(chain) {
  let groups = chain.groups
  let last = groups.length - 1
  let levels = Math.max(...groups.map(group => group.flags))
  let out = []

  for (let level = 1; level <= levels; level++) {
    let run = []

    let flush = () => {
      if (!run.length) { return }

      let from = run[0]
      let to = run[run.length - 1]
      let openStart = from == 0 && chain.openStart
      let openEnd = to == last && chain.openEnd
      let segment = {level, from, to, openStart, openEnd}

      if (run.length == 1 && !openStart && !openEnd) {
        let mark = beamMark(groups[from], level)
        segment.hook = mark == "backward hook" || from == last ? "backward" : "forward"
      }

      out.push(segment)
      run = []
    }

    groups.forEach((group, idx) => {
      if (group.flags >= level) {
        run.push(idx)
      } else {
        flush()
      }
    })

    flush()
  }

  return out
}

// how long a stem is in staff rows, and the least a beamed one is shortened
// to so its beam still clears the heads under it (see STEM_LENGTH)
const STEM_ROWS = STEM_LENGTH / STAFF_ROW
const MIN_BEAM_STEM_ROWS = STEM_ROWS - 2

// How far a beam ever climbs: an engraver keeps it near level, so it rises at
// most this many staff rows over the whole group, and no more steeply than
// this over one column width. A group whose outer heads are level draws a
// level beam
export const MAX_BEAM_RISE = 2
const MAX_BEAM_SLOPE = 1.2

// The staff row a beam chain's beam runs at, as a function of a group's x in
// column widths: the line through the stem ends of the chain's outer groups,
// its rise limited the way an engraver limits it, pushed clear of any head
// between them that reaches past it
function beamLine(chain, dir) {
  let groups = chain.groups
  let far = group => dir == "up" ?
    Math.max(...group.rows) : Math.min(...group.rows)
  let end = group => far(group) + (dir == "up" ? STEM_ROWS : -STEM_ROWS)

  let first = groups[0]
  let last = groups[groups.length - 1]
  let run = last.x - first.x
  let limit = Math.min(MAX_BEAM_RISE, run > 0 ? run * MAX_BEAM_SLOPE : 0)
  let rise = Math.max(-limit, Math.min(limit, end(last) - end(first)))
  let slope = run > 0 ? rise / run : 0
  let at = x => end(first) + slope * (x - first.x)

  let shift = 0
  for (let group of groups) {
    let clear = far(group) + (dir == "up" ? MIN_BEAM_STEM_ROWS : -MIN_BEAM_STEM_ROWS)
    let off = clear - at(group.x)
    shift = dir == "up" ? Math.max(shift, off) : Math.min(shift, off)
  }

  return x => at(x) + shift
}

/**
 * The tuplets of the stem groups of one voice of one bar: a run of groups the
 * score writes a <tuplet> start and stop around, else a run played at one
 * ratio. The number drawn over a tuplet is the notes the score writes it with
 * (3 over a triplet), so a run of a piece stored before that count was kept
 * draws none at all, and the bracket is left out when the run is exactly one
 * beam group, which the beam itself already marks out.
 * @param {Object[]} groups stem groups in x order
 * @param {Object[]} chains the beam chains of the same groups
 * @returns {Object[]} {groups, notes, bracket}
 */
function tupletChains(groups, chains) {
  let out = []
  let open = null

  for (let group of groups) {
    let ratio = group.tuplet

    if (!ratio || ratio == 1) {
      open = null
      continue
    }

    let marks = spansOf(group, "tuplets").map(span => span.type)

    if (!open || open.ratio != ratio || marks.includes("start")) {
      open = {groups: [], ratio, notes: group.tupletNotes || 0}
      out.push(open)
    }

    open.groups.push(group)

    // a score writing <time-modification> but no <tuplet> spans marks nothing
    // out, so a run splits at the notes actual-notes already states
    if (marks.includes("stop") || (open.notes > 1 && open.groups.length >= open.notes)) {
      open = null
    }
  }

  let sameGroups = (a, b) =>
    a.length == b.length && a.every((group, idx) => group === b[idx])

  return out.filter(tuplet => tuplet.notes > 1).map(tuplet => ({
    ...tuplet,
    bracket: !chains.some(chain => sameGroups(chain.groups, tuplet.groups)),
  }))
}

/**
 * The stem the staff draws each head with, so everything drawn from a stem —
 * its flags, the beams joining it to its neighbours, the tuplet drawn over
 * it, and the ties bowing away from it — agrees with it. The heads one voice
 * strikes at once share one stem, drawn from the lowest note of a group
 * stemming up and the highest of one stemming down; the others carry only the
 * direction it turns. A voice's position is settled over the whole bar, so
 * every stem of a voice sharing a bar with another turns the same way, rather
 * than only in the columns where the other voice also strikes. A group the
 * score beams to its neighbours turns with the whole beam group and reaches
 * its beam instead of drawing flags. Only notated values that carry a stem
 * have one, so a column of whole notes, and every head without notation, has
 * none.
 * @param {Object[]} heads the heads one staff draws, each {bar, column, row,
 * middleRow, notation, x}: the bar and the column it is struck in, the staff
 * row it is drawn on, the middle line of its own column's clef, how the score
 * writes it, and where its column falls in column widths
 * @returns {Array} one entry per head, in the order they were given: null for
 * a head with no stem, else {dir}, with {height, flags} on the head that
 * carries its group's stem, and {beam, tuplet} on it when the score beams it
 * to its neighbours or writes a tuplet over it
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

  let chainId = 0

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

    let stemmed = []

    for (let group of groups.values()) {
      let notations = group.map(idx => heads[idx].notation)
      if (!notations.some(notation => notation && noteTypeProps(notation.type).stem)) {
        continue
      }

      let first = heads[group[0]]
      let notation = notations.find(entry => entry) || {}

      stemmed.push({
        heads: group,
        notations,
        rows: group.map(idx => heads[idx].row),
        // the shortest value of the group carries the stem's flags, as the
        // one stem is drawn for all of them
        flags: Math.max(...notations.map(entry =>
          noteTypeProps(entry && entry.type).flags)),
        x: first.x || 0,
        voice: voiceOf(first),
        middleRow: first.middleRow,
        tuplet: notation.tuplet || 1,
        tupletNotes: notation.tupletNotes || 0,
      })
    }

    stemmed.sort((a, b) => a.x - b.x)

    // the beams and tuplets of each voice, which are drawn over the groups of
    // that voice alone
    let byVoice = new Map()
    for (let group of stemmed) {
      if (!byVoice.has(group.voice)) {
        byVoice.set(group.voice, [])
      }
      byVoice.get(group.voice).push(group)
    }

    for (let voice of byVoice.values()) {
      let chains = beamChains(voice)

      for (let chain of chains) {
        chain.id = `beam-${chainId++}`
        // the whole group turns one way, decided by its own heads the way a
        // single stem is (see stemDirection)
        chain.dir = stemDirection(
          voice.flatMap(group => chain.groups.includes(group) ? group.rows : []),
          chain.groups[0].middleRow,
          {voicePosition: positions[chain.groups[0].voice]})
        chain.segments = beamSegments(chain)
        chain.line = beamLine(chain, chain.dir)

        chain.groups.forEach((group, index) => {
          group.beam = {
            group: chain.id,
            index,
            size: chain.groups.length,
            segments: chain.segments,
            dir: chain.dir,
          }
          group.dir = chain.dir
          group.endRow = chain.line(group.x)
        })
      }

      tupletChains(voice, chains).forEach((tuplet, idx) => {
        let id = `tuplet-${chainId++}`
        tuplet.groups.forEach((group, index) => {
          group.tupletSpan = {
            group: id,
            index,
            size: tuplet.groups.length,
            notes: tuplet.notes,
            bracket: tuplet.bracket,
          }
        })
      })
    }

    for (let group of stemmed) {
      let rows = group.rows
      let dir = group.dir || stemDirection(rows, group.middleRow,
        {voicePosition: positions[group.voice]})

      let anchorRow = dir == "up" ? Math.min(...rows) : Math.max(...rows)
      let anchor = group.heads[rows.indexOf(anchorRow)]
      let span = Math.max(...rows) - Math.min(...rows)

      let height = group.beam ?
        Math.abs(group.endRow - anchorRow) * STAFF_ROW :
        STEM_LENGTH + span * STAFF_ROW

      for (let idx of group.heads) {
        stems[idx] = idx == anchor ? {
          dir, height,
          // a beamed note's value is written by the beams joining it to its
          // neighbours, never by a flag of its own
          flags: group.beam ? 0 : group.flags,
          ...(group.beam ? {beam: group.beam} : null),
          ...(group.tupletSpan ? {tuplet: group.tupletSpan} : null),
        } : {dir}
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

// The beams joining a group's stems: half a staff space thick with a quarter
// space between them, as they are engraved. A beam whose group runs on past
// the card reaches this far past the last stem it joins, the way a tie
// running off the card draws a stub, and the hook of a lone short note in a
// group is this wide
export const BEAM_THICKNESS = STAFF_SPACE * 0.5
export const BEAM_GAP = STAFF_SPACE * 0.25
export const BEAM_STUB = STAFF_SPACE * 1.2
export const BEAM_HOOK = STAFF_SPACE * 0.9

// A tuplet's number, and the bracket around it when the group is not one
// beam: how far past the stems it sits, how tall the number is drawn and how
// far the bracket's ends hook back towards them
export const TUPLET_OFFSET = STAFF_SPACE * 0.5
export const TUPLET_SIZE = STAFF_SPACE * 0.9
export const TUPLET_HOOK = STAFF_SPACE * 0.35

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
// unscaled pixels, measured to the middle of the head. The row is rounded the
// way the head's own top is (see renderNote in st/components/staff/score_notes,
// which writes it as a whole percent of the staff), so a beam, a stem's end
// and a tie all meet the head exactly where it is drawn
export function rowCenter(row, {upperRow}) {
  return Math.floor((upperRow - row) * 25 / 2) / 100 * STAFF_HEIGHT +
    (0.5 - HEAD_ABOVE_ROW) * NOTE_HEAD_HEIGHT
}

/**
 * Where something the score writes `beat` beats before the column at idx is
 * drawn, in column widths: its share of the room the layout keeps in front of
 * that column, never back into the room the column's bar line is drawn in.
 * This is where a rest a bar opens with and a head a tie runs on to from a
 * column the staff can't show fall. A bar holding no column at all (see
 * cardColumn in st/measure_cards), and everything the score writes inside it,
 * is drawn in the room kept for it at the end of the column before, so it
 * clears the note that column holds (see afterOffset).
 * @param {Array} columns the columns on the staff
 * @param {Object} layout see columnLayout
 * @param {number} idx the column it falls before
 * @param {number} beat
 * @returns {number}
 */
export function beforeOffset(columns, layout, idx, beat) {
  let previous = idx > 0 ? columns[idx - 1] : null

  if (previous && previous.beat != null && beat >= barsOpenAt(columns[idx])) {
    return afterOffset(columns, layout, idx - 1, beat)
  }

  let {offsets, gaps, leadBeats} = layout
  let from = (idx > 0 ? offsets[idx - 1] : 0) + OPENING_EXTRA_ROOM
  let span = idx > 0 ? gaps[idx - 1] : leadBeats
  let room = offsets[idx] - from
  let before = columns[idx].beat - beat

  return Math.max(from, span > 0 ? offsets[idx] - room * before / span : from)
}

/**
 * Where something the score writes at or after the onset of the column at idx
 * is drawn, in column widths: its share of the room that column holds, which
 * is no part of the room the bar after it is drawn in. This is where a rest or
 * a tied head between two columns falls. A bar a card ends on is drawn past
 * the column's own beats, in the room kept for it alone (see columnTrail), so
 * it clears the note the column holds.
 * @param {Array} columns the columns on the staff
 * @param {Object} layout see columnLayout
 * @param {number} idx the column it falls on or after
 * @param {number} beat
 * @returns {number}
 */
export function afterOffset(columns, {offsets, advances, gaps, unit, rests=true}, idx, beat) {
  let column = columns[idx]
  let beats = gaps && gaps[idx]
  let after = beat - column.beat
  let own = column.beats > 0 ? column.beats : 0
  let trailBeats = columnTrail(columns, idx)

  if (trailBeats > 0 && after >= own) {
    let trail = roomFor(trailBeats, unit)
    return offsets[idx] + advances[idx] - trail +
      trail * Math.min(1, (after - own) / trailBeats)
  }

  // a column whose room isn't known goes by the card's own beat to a width
  let into = beats > 0 ?
    (advances[idx] - closingRoom(columns, idx, unit, rests)) * after / beats :
    after / (unit > 0 ? unit : 1)

  return offsets[idx] + into
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
 * @param {boolean} [opts.rests] whether the staff draws the score's rests
 * @returns {Object[]} each extra with `offset`, its own place in column widths
 */
export function columnExtras(columns, layout) {
  let {offsets, advances, gaps, leadBeats, staff, rests=true} = layout
  if (!offsets || !advances) { return [] }

  let out = []

  columns.forEach((column, idx) => {
    for (let extra of column.extras || []) {
      if (!rests && extra.kind == "rest") { continue }
      if (staff && extra.staff && extra.staff != staff) { continue }

      let before = column.beat - extra.beat

      if (before > 0) {
        // An extra falling before its column: the rest a bar opens with, or
        // one carried onto this column from a column the staff can't show
        // (see beforeOffset)
        out.push({
          ...extra,
          columnIdx: idx,
          offset: beforeOffset(columns, layout, idx, extra.beat),
        })
        continue
      }

      // a beat of the room the column's own beats hold, so a head or rest
      // between two columns keeps its place however that column is spaced
      // (see afterOffset)
      out.push({
        ...extra,
        columnIdx: idx,
        offset: afterOffset(columns, layout, idx, extra.beat),
      })
    }
  })

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

// where a slur leaves and meets a head, as a share of the head's width: it
// runs from the middle of one head to the middle of another, where a tie,
// joining two heads of one pitch, runs between their facing edges
const SLUR_ANCHOR = 0.5

/**
 * The arcs drawn for the score's slurs, matched by the number the score
 * writes on them so nested and overlapping slurs each find their own end. A
 * slur is drawn exactly as a tie is (see tieArcs) and differs only in where
 * it ends, since a tie joins two heads of one pitch and a slur joins
 * different ones. A slur whose other head is not on the staff, because it is
 * on the card before or after this one, runs off that side as a tie does.
 * @param {Object[]} heads {x, y, width, stem, slurs}, in the pixels of the
 * staff's scale, every head the staff draws so the arcs clear the ones they
 * arch over
 * @param {number} stub how far a slur with no head to run to reaches
 * @param {Object} [opts]
 * @param {number} [opts.left] the furthest left a stub reaches back to
 * @param {Object[]} [opts.through] the slurs open right across these heads,
 * neither started nor stopped on any of them, which are drawn running off
 * both sides of the staff
 * @returns {Object[]} {x1, y1, x2, y2, dir, clear}, the ends in reading
 * order, dir the side the arc bulges to and clear the y of the head it must
 * arch past, or null when it spans none
 */
export function slurArcs(heads, stub, {left=null, through=null}={}) {
  let sorted = [...heads].sort((a, b) => a.x - b.x)
  let arcs = []
  let open = new Map()

  // a slur bulges away from the stems of the heads it joins, as it does on
  // paper, unless the score says which side it is drawn on
  let arcDir = (head, placement) => placement ?
    (placement == "above" ? "up" : "down") :
    (head.stem == "up" ? "down" : "up")

  let anchor = head => head.x + head.width * SLUR_ANCHOR

  // the head the arc arches past: the highest one it spans when it bulges up,
  // the lowest when it bulges down
  let clearance = (dir, x1, x2) => {
    let ys = sorted.filter(head => head.x >= x1 - 1 && head.x <= x2 + 1)
      .map(head => head.y)

    if (!ys.length) { return null }
    return dir == "up" ? Math.min(...ys) : Math.max(...ys)
  }

  let push = (dir, x1, y1, x2, y2) =>
    arcs.push({x1, y1, x2, y2, dir, clear: clearance(dir, x1, x2)})

  // the slurs some head on the staff starts or stops, which draw their own
  // arc and so are never drawn passing over it
  let marked = new Set()

  for (let head of sorted) {
    for (let span of head.slurs || []) {
      marked.add(span.number)

      if (span.type == "start") {
        open.set(span.number, {head, placement: span.placement})
        continue
      }

      let from = open.get(span.number)
      open.delete(span.number)

      if (from) {
        push(arcDir(from.head, from.placement || span.placement),
          anchor(from.head), from.head.y, anchor(head), head.y)
        continue
      }

      // the head the slur starts on is on the card before this one, so it
      // runs in from the edge, never back past the staff's notes
      let x2 = anchor(head)
      let x1 = left == null ? x2 - stub : Math.max(left, x2 - stub)
      push(arcDir(head, span.placement), x1, head.y, x2, head.y)
    }
  }

  // the head a slur stops on is on the card after this one
  for (let {head, placement} of open.values()) {
    let x1 = anchor(head)
    push(arcDir(head, placement), x1, head.y, x1 + stub, head.y)
  }

  // A slur both of whose heads are on other cards passes right over this one,
  // so it is drawn running off both sides rather than disappearing while the
  // middle of the phrase is played
  if (sorted.length) {
    let first = sorted[0]
    let last = sorted[sorted.length - 1]

    for (let span of through || []) {
      if (marked.has(span.number)) { continue }
      let x1 = first.x - stub
      push(arcDir(first, span.placement),
        left == null ? x1 : Math.max(left, x1), first.y,
        anchor(last) + stub, last.y)
    }
  }

  return arcs
}
