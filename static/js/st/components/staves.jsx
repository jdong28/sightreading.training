
import * as React from "react"
import classNames from "classnames"
import * as types from "prop-types"

import NoteList from "st/note_list"
import {SongNoteList} from "st/song_note_list"
import ChordList from "st/chord_list"

import {parseNote, noteName, noteStaffOffset} from "st/music"

import StaffNotes, {
  KEY_SIGNATURE_SPACING, clefChangeBoxes, staffColumnNotes, columnNotation
} from "st/components/staff_notes"
import {
  columnStems, columnBars, columnExtras, columnLayout, headKey, middleRow, rowCenter,
} from "st/staff_rhythm"
import StaffSongNotes from "st/components/staff_song_notes"
import styles from "st/components/staff.module.css"

const DEFAULT_HEIGHT = 120
const DEFAULT_MARGIN = 60

// the least room a grand staff keeps between its two staves, which is what
// the classic treble over bass layout needs for the notes between them
const GRAND_STAFF_GAP = 70

// A whole note's head is 20% of the staff tall and hangs 47% of its own
// height above the line of its row (see .note in staff.module.css), so it
// reaches this much of a staff past that line, further below than above
const HEAD_ABOVE_ROW = 0.2 * 0.47
const HEAD_BELOW_ROW = 0.2 - HEAD_ABOVE_ROW

// An accidental drawn on a note is three heads tall and starts a head above
// it (.accidental.sharp and .natural in staff.module.css), so it reaches a
// head's height further past the note's row than the head does
const ACCIDENTAL_PAST_HEAD = 0.2

// the props that draw a staff in a clef, by the clef sign of st/musicxml
export const CLEF_PROPS = {
  g: {
    // where the key signature is centered around
    keySignatureCenter: "F5",
    upperRow: 45,
    lowerRow: 37,
    cleffImage: "/static/svg/clefs.G.svg",
    staffClass: styles.g_staff,
    // the clef drawn where the clef changes: at full size its height, in
    // staff heights, and width:height, and the line it curls around, as a
    // share of the staff and of the clef's height from the top
    changeGlyph: {height: 1.15, aspect: 332.166 / 912.17, line: 0.75, anchor: 0.626},
  },
  f: {
    keySignatureCenter: "F3",
    upperRow: 33,
    lowerRow: 25,
    cleffImage: "/static/svg/clefs.F_change.svg",
    staffClass: styles.f_staff,
    changeGlyph: {height: 0.58, aspect: 541.731 / 653.875, line: 0.25, anchor: 0.31},
  },
}

// The clef sign of the score in force at each column of notes on staff (see
// cardColumn in st/measure_cards), or null when the columns don't carry the
// score's clefs: the clef of that staff of a grand staff, or for a staff on
// its own the clef of the one staff the drill's hand is on. A column without
// clefs, eg. the gap after a card, keeps the sign of the column before it, or
// of the first column with clefs when it leads. A song's notes are not
// columns and never carry clefs
function columnClefSigns(notes, staff) {
  if (!Array.isArray(notes) || notes instanceof SongNoteList) {
    return null
  }

  let signs = notes.map(column => {
    if (!column.clefs) { return undefined }
    if (staff) { return column.clefs[staff] }
    let staves = Object.keys(column.clefs)
    return staves.length == 1 ? column.clefs[staves[0]] : null
  })

  let sign = signs.find(s => s !== undefined)
  if (sign === undefined) {
    return null
  }

  return signs.map(columnSign => {
    if (columnSign !== undefined) { sign = columnSign }
    return sign
  })
}

// the clef props each of notes' columns is drawn in on staff, the score's
// when the columns carry them (see columnClefSigns), else null
function columnClefProps(notes, staff, defaultProps) {
  let signs = columnClefSigns(notes, staff)
  return signs && signs.map(sign => CLEF_PROPS[sign] || defaultProps)
}

// the clef props a staff is drawn in at its head column, the score's when the
// columns carry it, else defaultProps
export function headClefProps(notes, staff, defaultProps) {
  let signs = columnClefSigns(notes, staff)
  return (signs && CLEF_PROPS[signs[0]]) || defaultProps
}

// how many rows a note's row sits outside the five lines of clef props
function ledgerSteps(props, row) {
  if (row > props.upperRow) { return row - props.upperRow }
  if (row < props.lowerRow) { return props.lowerRow - row }
  return 0
}

// The props a staff draws its notes with: its columns at the staff's scale,
// the clef of the score at its head column over its own, and columnClefs, the
// clef props each column is drawn in, when the columns carry the score's
// clefs (see columnClefSigns)
function staffClefProps(props) {
  if (props.noteWidth) {
    props = {...props, noteWidth: Math.floor(props.noteWidth * (props.scale || 1))}
  }

  let columnClefs = columnClefProps(props.notes, props.staff, props)
  if (!columnClefs) {
    return props
  }

  return {...props, ...columnClefs[0], columnClefs}
}

/**
 * Every head a staff drawn with props draws over columns, in the order it
 * draws them: the notes of each column with how the score writes them, then
 * the heads the ties run on to and the ones another voice doubles, which are
 * drawn but never played (see StaffNotes#convertToSongNotes). Each carries
 * what places it — the bar and the onset it is struck on, its staff row and
 * the clef that draws it — which is what its stem and the staff's own reach
 * are worked out from.
 * @param {Array} columns
 * @param {Object} props
 * @returns {Object[]}
 */
function drawnHeads(columns, props) {
  let columnClefs = columnClefProps(columns, props.staff, props)
  let clefAt = idx => (columnClefs && columnClefs[idx]) || props
  let bars = columnBars(columns)
  let heads = []

  let push = (idx, group, name, beat, notation) => {
    let spelled = props.keySignature.enharmonic(name)
    let clef = clefAt(idx)

    heads.push({
      bar: bars[idx],
      column: group,
      name, beat, notation, clef,
      row: noteStaffOffset(spelled),
      middleRow: middleRow(clef),
      accidental: props.keySignature.accidentalsForNote(spelled) != null,
    })
  }

  columns.forEach((column, idx) => {
    let [columnNotes] = staffColumnNotes(column, props)
    let notation = columnNotation(column, columnNotes, props)

    columnNotes.forEach((name, at) => {
      push(idx, idx, name, column.beat, notation && notation[at])
    })
  })

  for (let extra of columnExtras(columns, {...columnLayout(columns), staff: props.staff})) {
    if (extra.kind != "head") { continue }

    // a head a tie runs on to at its column's own onset, a chord note held
    // over from the onset before, is one of that chord and shares its stem; a
    // head another voice doubles is drawn beside the chord and keeps its own
    let column = columns[extra.columnIdx]
    let group = column && extra.from != null && column.beat === extra.beat ?
      extra.columnIdx : `${extra.columnIdx}@${extra.beat}`

    push(extra.columnIdx, group, extra.name, extra.beat, extra)
  }

  return heads
}

// everything drawnHeads reads besides the columns themselves
function headStemsKey(columns, props) {
  return [columns, props.keySignature, props.filterPitch, props.upperRow, props.lowerRow]
}

// The last unit walked for each staff: GrandStaff measures both of its staves
// and each of them walks the same unit again to draw itself and to measure its
// own reach, so one walk a staff serves them all
const headStemsCache = new Map()

// The heads of columns and the stem of each, as one set so that what the staff
// draws and the room it keeps for it are never worked out from different heads
function drawnHeadStems(columns, props) {
  let key = headStemsKey(columns, props)
  let cached = headStemsCache.get(props.staff)

  if (cached && cached.key.every((part, idx) => part === key[idx])) {
    return cached.result
  }

  let heads = drawnHeads(columns, props)
  let result = [heads, columnStems(heads)]
  headStemsCache.set(props.staff, {key, result})

  return result
}

// The stem of every head the staff draws, by what names a head (see headKey).
// Worked out over the whole unit rather than over the window on the staff, so
// a voice keeps one stem direction right through its bar however much of that
// bar the window holds
export function unitStems(props) {
  let columns = props.unitColumns && props.unitColumns.length ? props.unitColumns : props.notes
  let out = new Map()

  if (!Array.isArray(columns) || columns instanceof SongNoteList) {
    return out
  }

  let [heads, stems] = drawnHeadStems(columns, props)

  heads.forEach((head, idx) => {
    if (stems[idx]) {
      out.set(headKey(head.beat, head.name, head.notation), stems[idx])
    }
  })

  return out
}

// How far past its five lines a staff drawn with props reaches, above and
// below, in pixels: its notes' heads and the stems drawn on them, and the clef
// changes too big for the gaps they mark, which go above the staff. A drill
// measures the whole unit its notes are a window of rather than the window, so
// the staff holds its place as the window slides, plus the notes held down
// that aren't in its head, which land wherever the player's wrong note falls
// (see StaffNotes#convertHeldToSongNotes)
export function notesReach(props) {
  let height = DEFAULT_HEIGHT * (props.scale || 1)
  let above = 0
  let below = 0

  let include = (clef, row, accidental) => {
    let steps = ledgerSteps(clef, row)

    if (!steps) { return }

    let past = accidental ? ACCIDENTAL_PAST_HEAD : 0

    if (row > clef.upperRow) {
      above = Math.max(above, steps * height / 8 + (HEAD_ABOVE_ROW + past) * height)
    } else {
      below = Math.max(below, steps * height / 8 + (HEAD_BELOW_ROW + past) * height)
    }
  }

  let kept = name => !props.filterPitch || props.filterPitch(parseNote(name))
  // a whole note as the staff draws it: the row of the name it is spelled
  // with in the key signature, and whether an accidental is drawn on it
  let drawn = name => {
    let spelled = props.keySignature.enharmonic(name)
    return [noteStaffOffset(spelled), props.keySignature.accidentalsForNote(spelled) != null]
  }

  if (props.notes instanceof SongNoteList) {
    props.notes.forEach(note => {
      if (kept(note.note)) { include(props, noteStaffOffset(note.note)) }
    })
  }

  // A stem runs from the middle of its head to its far end, and its flags are
  // stacked back along it, so the stem's end is the furthest the staff draws
  // from that head (see columnStems and renderRhythm in st/components/staff)
  let includeStem = (clef, row, stem) => {
    if (!stem || !stem.height) { return }

    let center = rowCenter(row, clef) * (props.scale || 1)
    let reach = stem.height * (props.scale || 1)

    if (stem.dir == "up") {
      above = Math.max(above, reach - center)
    } else {
      below = Math.max(below, center + reach - height)
    }
  }

  if (props.notes instanceof NoteList) {
    if (props.unitColumns) {
      let [heads, stems] = drawnHeadStems(props.unitColumns, props)

      heads.forEach((head, idx) => {
        include(head.clef, head.row, head.accidental)
        includeStem(head.clef, head.row, stems[idx])
      })

      clefChangeBoxes({
        ...props,
        notes: props.unitColumns,
        columnClefs: columnClefProps(props.unitColumns, props.staff, props),
      }).forEach(box => {
        above = Math.max(above, -box.top)
      })
    }

    Object.keys(props.heldNotes || {}).forEach(name => {
      if (!props.notes.inHead(name) && kept(name)) {
        include(props, ...drawn(name))
      }
    })
  }

  return [above, below]
}

export class Staff extends React.PureComponent {
  static propTypes = {
    // rendering props
    upperRow: types.number.isRequired,
    lowerRow: types.number.isRequired,
    cleffImage: types.string.isRequired,
    staffClass: types.string.isRequired,
    keySignature: types.object,
    pixelsPerBeat: types.number,
    noteWidth: types.number,


    // state props
    notes: types.array,
    heldNotes: types.object.isRequired,
    inGrand: types.bool,
    scale: types.number,
    // the grand staff this staff is ("upper" or "lower"), which draws the
    // notes of that staff when the columns carry it
    staff: types.string,
    // Every column of the drill's current unit, the card (or section) the
    // notes are a sliding window of, which fixes the staff's margins while
    // that window slides. Without it a drill keeps the stylesheet's margins
    unitColumns: types.array,
    // the room this staff keeps below it, set by GrandStaff so the notes of
    // its two staves never meet
    gapBelow: types.number,
  }

  // the props this staff draws its notes with (see staffClefProps)
  clefProps() {
    return staffClefProps(this.props)
  }

  // skips react for performance
  setOffset(amount) {
    // no notes rendered yet, eg. a scroll mode entered as the page mounts
    if (!this.refs.notes) { return }

    let scale = this.props.scale || 1
    let noteWidth = this.props.noteWidth || 1
    this.refs.notes.setOffset(amount * noteWidth * scale)
  }

  // The margin that keeps something reaching that far past the staff's lines
  // inside the plate, with a note head's room to spare, or null when the
  // stylesheet's own margin already does
  reachMargin(reach, scale) {
    if (!reach) { return null }

    let margin = reach + HEAD_BELOW_ROW * DEFAULT_HEIGHT * scale
    return margin > DEFAULT_MARGIN * scale ? margin : null
  }

  render() {
    let scale = this.props.scale || 1
    let props = this.clefProps()
    let staffNotes = null

    if (props.notes instanceof NoteList) {
      staffNotes = <StaffNotes ref="notes" {...props} stems={unitStems(props)}></StaffNotes>
    }

    if (props.notes instanceof SongNoteList) {
      staffNotes = <StaffSongNotes ref="notes" {...props}></StaffSongNotes>
    }

    let height = DEFAULT_HEIGHT * scale

    let [above, below] = notesReach(props)

    let marginTop = this.reachMargin(above, scale)
    let marginBottom = this.reachMargin(below, scale)

    if (this.props.gapBelow > (marginBottom || 0)) {
      marginBottom = this.props.gapBelow
    }

    // the fixed offsets of staff.module.css scale with --staff-scale
    return <div
      style={{
        "--staff-scale": scale,
        height: `${height}px`,
        marginTop: marginTop ? `${marginTop}px` : null,
        marginBottom: marginBottom ? `${marginBottom}px` : null,
      }}
      className={classNames(styles.staff, props.staffClass)}
      data-staff={props.staff}
    >
      <img className={styles.cleff} src={props.cleffImage} />

      <div className={styles.lines}>
        <div className={classNames(styles.line1, styles.line)}></div>
        <div className={classNames(styles.line2, styles.line)}></div>
        <div className={classNames(styles.line3, styles.line)}></div>
        <div className={classNames(styles.line4, styles.line)}></div>
        <div className={classNames(styles.line5, styles.line)}></div>
      </div>

      {this.renderKeySignature(props)}
      {staffNotes}
      {this.props.children}
    </div>
  }

  renderKeySignature(props) {
    let keySignature = props.keySignature

    if (!keySignature) {
      return;
    }

    if (keySignature.count == 0) {
      return;
    }

    let ksCenter = parseNote(props.keySignatureCenter)
    if (keySignature.isFlat()) { ksCenter -= 2 }

    let sigNotes = keySignature.notesInRange(ksCenter - 10, ksCenter + 2)

    let topOffset = props.upperRow

    let sigClass = keySignature.isFlat() ? styles.flat : styles.sharp;

    let src = keySignature.isFlat() ? "/static/svg/flat.svg" : "/static/svg/sharp.svg";

    return <div className={styles.key_signature}>
      {sigNotes.map((n, i) => {
        let fromTop = topOffset - noteStaffOffset(n);
        let style = {
          top: `${Math.floor(fromTop * 25/2)}%`,
          left: `${i * KEY_SIGNATURE_SPACING * (props.scale || 1)}px`
        }

        return <img
          key={`sig-${n}`}
          data-note={n}
          style={style}
          className={classNames(styles.accidental, sigClass)}
          src={src} />;
      })}
    </div>;
  }
}

export class GStaff extends Staff {
  static defaultProps = CLEF_PROPS.g
}

export class FStaff extends Staff {
  static defaultProps = CLEF_PROPS.f
}

export class GrandStaff extends React.PureComponent {
  constructor(props) {
    super(props)
    this.gstaff = React.createRef()
    this.fstaff = React.createRef()

    this.filterGStaff = this.filterGStaff.bind(this)
    this.filterFStaff = this.filterFStaff.bind(this)
  }

  // skips react for performance
  setOffset(amount) {
    if (this.gstaff.current) {
      this.gstaff.current.setOffset(amount)
    }

    if (this.fstaff.current) {
      this.fstaff.current.setOffset(amount)
    }
  }

  // The clef props each staff's head column is drawn in, kept while the
  // notes are, since staffForPitch looks them up for every note drawn
  headClefs() {
    if (this.clefsFor != this.props.notes) {
      this.clefsFor = this.props.notes
      this.clefs = {
        upper: headClefProps(this.props.notes, "upper", CLEF_PROPS.g),
        lower: headClefProps(this.props.notes, "lower", CLEF_PROPS.f),
      }
    }

    return this.clefs
  }

  // The staff a note that doesn't carry one goes on, notably a wrong note
  // held down: the one whose clef at the head column leaves it fewest ledger
  // steps from the five lines, so it is always drawn near a staff. A note
  // below both staves goes on the lower one, any other tie on the upper,
  // which splits the classic treble over bass layout at middle C
  staffForPitch(pitch) {
    let row = noteStaffOffset(noteName(pitch))
    let {upper, lower} = this.headClefs()

    let upperSteps = ledgerSteps(upper, row)
    let lowerSteps = ledgerSteps(lower, row)

    if (upperSteps == lowerSteps) {
      return row < lower.lowerRow ? "lower" : "upper"
    }

    return upperSteps < lowerSteps ? "upper" : "lower"
  }

  filterGStaff(pitch) {
    return this.staffForPitch(pitch) == "upper"
  }

  filterFStaff(pitch) {
    return this.staffForPitch(pitch) == "lower"
  }

  // the props one of the two staves draws with, so how far it reaches past
  // its lines can be measured before it renders
  staffProps(staff) {
    let [defaults, filterPitch] = staff == "upper" ?
      [CLEF_PROPS.g, this.filterGStaff] : [CLEF_PROPS.f, this.filterFStaff]

    return staffClefProps({...defaults, ...this.props, staff, filterPitch})
  }

  // Notes of columns that carry their staff (an imported piece) go on the
  // staff of the score, drawn in the score's clefs; other notes go on the
  // staff whose clef draws them nearest its lines. The two staves keep the
  // room both of them reach into between them, so their notes never meet
  render() {
    let scale = this.props.scale || 1
    let [, upperBelow] = notesReach(this.staffProps("upper"))
    let [lowerAbove] = notesReach(this.staffProps("lower"))

    return <div>
      <GStaff
        ref={this.gstaff}
        filterPitch={this.filterGStaff}
        {...this.props}
        gapBelow={Math.max(GRAND_STAFF_GAP * scale, upperBelow + lowerAbove)}
        staff="upper" />
      <FStaff
        ref={this.fstaff}
        filterPitch={this.filterFStaff}
        showAnnotations={false}
        {...this.props}
        staff="lower" />
    </div>;
  }
}

export class ChordStaff extends React.PureComponent {
  static propTypes = {
    chords: types.array,
  }

  setOffset(amount) {
    this.refs.chordScrolling.style.transform = `translate3d(${amount}px, 0, 0)`;
  }

  render() {
    if (!(this.props.chords instanceof ChordList)) {
      return <div />
    }

    let touchedNotes = Object.keys(this.props.touchedNotes)

    return <div className={styles.chord_staff}>
      <div className={styles.chord_scrolling} ref="chordScrolling">
        {this.props.chords.map((c, i) => {
          let pressedIndicator

          if (i == 0 && touchedNotes.length) {
            pressedIndicator = <span className={styles.touched}>
              {touchedNotes.map(n => {
                if (c.containsNote(n)) {
                  return <span key={`right-${n}`} className={styles.right}>•</span>
                } else {
                  return <span key={`wrong-${n}`} className={styles.wrong}>×</span>
                }
              })}
            </span>
          }

          return <div key={`${c}-${i}`} className={classNames(styles.chord, {
            [styles.errorshake]: this.props.noteShaking && i == 0,
          })}>
            {c.toString()}
            {pressedIndicator}
          </div>
        })}
      </div>
    </div>
  }
}
