import * as React from "react"
import classNames from "classnames"
import * as types from "prop-types"

import NoteList from "st/note_list"
import {SongNoteList} from "st/song_note_list"
import ChordList from "st/chord_list"

import {parseNote, noteName, noteStaffOffset} from "st/music"

import StaffNotes, {KEY_SIGNATURE_SPACING} from "st/components/staff_notes"
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

// the props that draw a staff in a clef
const CLEF_PROPS = {
  g: {
    // where the key signature is centered around
    keySignatureCenter: "F5",
    upperRow: 45,
    lowerRow: 37,
    cleffImage: "/static/svg/clefs.G.svg",
    staffClass: styles.g_staff,
  },
  f: {
    keySignatureCenter: "F3",
    upperRow: 33,
    lowerRow: 25,
    cleffImage: "/static/svg/clefs.F_change.svg",
    staffClass: styles.f_staff,
  },
}

// how many rows a note's row sits outside the five lines of clef props
function ledgerSteps(props, row) {
  if (row > props.upperRow) { return row - props.upperRow }
  if (row < props.lowerRow) { return props.lowerRow - row }
  return 0
}

// the props a staff draws its notes with: its columns at the staff's scale
function scaledProps(props) {
  if (props.noteWidth) {
    props = {...props, noteWidth: Math.floor(props.noteWidth * (props.scale || 1))}
  }

  return props
}

// How far past its five lines a staff drawn with props reaches, above and
// below, in pixels: a song's notes, or for a drill the notes held down that
// aren't in its head, which land wherever the player's wrong note falls (see
// StaffNotes#convertHeldToSongNotes)
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

  if (props.notes instanceof NoteList) {
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
    // the grand staff this staff is ("upper" or "lower")
    staff: types.string,
    // the room this staff keeps below it, set by GrandStaff so the notes of
    // its two staves never meet
    gapBelow: types.number,
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
    let props = scaledProps(this.props)
    let staffNotes = null

    if (props.notes instanceof NoteList) {
      staffNotes = <StaffNotes ref="notes" {...props}></StaffNotes>
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

  // The staff a note goes on: the one whose clef leaves it fewest ledger
  // steps from the five lines, so it is always drawn near a staff. A note
  // below both staves goes on the lower one, any other tie on the upper,
  // which splits the treble over bass layout at middle C
  staffForPitch(pitch) {
    let row = noteStaffOffset(noteName(pitch))
    let upper = CLEF_PROPS.g
    let lower = CLEF_PROPS.f

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

    return scaledProps({...defaults, ...this.props, staff, filterPitch})
  }

  // Each note goes on the staff whose clef draws it nearest its lines. The
  // two staves keep the room both of them reach into between them, so their
  // notes never meet
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
