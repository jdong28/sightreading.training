
import * as React from "react"
import classNames from "classnames"
import * as types from "prop-types"

import NoteList from "st/note_list"
import {SongNoteList} from "st/song_note_list"
import ChordList from "st/chord_list"

import {parseNote, noteStaffOffset, MIDDLE_C_PITCH} from "st/music"

import StaffNotes, {KEY_SIGNATURE_SPACING} from "st/components/staff_notes"
import StaffSongNotes from "st/components/staff_song_notes"
import styles from "st/components/staff.module.css"

const DEFAULT_HEIGHT = 120
const DEFAULT_MARGIN = 60

// the props that draw a staff in a clef, by the clef sign of st/musicxml
export const CLEF_PROPS = {
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

// The first column of notes that carries the score staff of its notes and
// the clefs to draw them in (see cardColumn in st/measure_cards), or null
// when the notes are split between the staves by pitch
export function scoreStaffColumn(notes) {
  if (!(notes instanceof NoteList)) {
    return null
  }

  return notes.find(column => Array.isArray(column) && column.clefs) || null
}

// the props of a clef sign, or of fallback when the sign isn't drawn
function clefProps(sign, fallback) {
  return CLEF_PROPS[sign] || CLEF_PROPS[fallback]
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
    // notes of that score staff when the columns carry it
    staff: types.string,
  }

  // The props with the clef the score uses on this staff: a staff on its own
  // showing the notes of a single score staff (eg. one hand of a piece), or
  // of staves that share a clef, is drawn in that clef. The grand staff
  // passes the clefs of its own staves
  clefProps() {
    let column = this.props.staff == null && scoreStaffColumn(this.props.notes)
    if (!column) {
      return this.props
    }

    let signs = new Set()
    for (let col of this.props.notes) {
      for (let staff of (Array.isArray(col) && col.staves) || []) {
        signs.add(column.clefs[staff.staff])
      }
    }

    let [sign] = signs
    if (signs.size != 1 || !CLEF_PROPS[sign]) {
      return this.props
    }

    return {...this.props, ...CLEF_PROPS[sign]}
  }

  // skips react for performance
  setOffset(amount) {
    // no notes rendered yet, eg. a scroll mode entered as the page mounts
    if (!this.refs.notes) { return }

    let scale = this.props.scale || 1
    let noteWidth = this.props.noteWidth || 1
    this.refs.notes.setOffset(amount * noteWidth * scale)
  }

  // find the min/max note range in rows
  notesRowRange() {
    let min, max

    if (this.props.notes instanceof SongNoteList) {
      this.props.notes.forEach(note => {
        if (this.props.filterPitch) {
          let pitch = parseNote(note.note)
          if (!this.props.filterPitch(pitch)) {
            return
          }
        }

        let row = noteStaffOffset(note.note)

        if (min == null || row < min) {
          min = row
        }

        if (max == null || row > max) {
          max = row
        }
      })
    }

    return [min, max]
  }

  render() {
    let props = this.clefProps()
    let staffNotes = null

    if (props.notes instanceof NoteList) {
      let scale = props.scale || 1
      let noteWidth = Math.floor(props.noteWidth * scale)
      staffNotes = <StaffNotes ref="notes" {...props} noteWidth={noteWidth}></StaffNotes>
    }

    if (props.notes instanceof SongNoteList) {
      staffNotes = <StaffSongNotes ref="notes" {...props}></StaffSongNotes>
    }

    let scale = this.props.scale || 1
    let height = DEFAULT_HEIGHT * scale

    let noteHeight = height * 0.2 // height of 1 bar

    let [minRow, maxRow] = this.notesRowRange()

    let marginTop, marginBottom

    if (minRow != null && minRow < props.lowerRow) {
      marginBottom = noteHeight * (props.lowerRow - minRow) / 2 + noteHeight

      if (marginBottom < DEFAULT_MARGIN * scale) {
        marginBottom = null
      }
    }

    if (maxRow != null && maxRow > props.upperRow) {
      marginTop = noteHeight * (maxRow - props.upperRow) / 2 + noteHeight

      if (marginTop < DEFAULT_MARGIN * scale) {
        marginTop = null
      }
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

  filterGStaff(pitch) {
    if (pitch < MIDDLE_C_PITCH) {
      return false
    }

    return true
  }

  filterFStaff(pitch) {
    if (pitch >= MIDDLE_C_PITCH) {
      return false
    }

    return true
  }

  // Notes of columns that carry their score staff (an imported piece) go on
  // the staff of the score, each staff drawn in the clef the score uses for
  // it at the card; other notes are split at middle C, treble over bass
  render() {
    let column = scoreStaffColumn(this.props.notes)
    let upperClef = column ? clefProps(column.clefs.upper, "g") : null
    let lowerClef = column ? clefProps(column.clefs.lower, "f") : null

    return <div className={styles.grand_staff}>
      <GStaff
        ref={this.gstaff}
        filterPitch={this.filterGStaff}
        {...this.props}
        {...upperClef}
        staff="upper" />
      <FStaff
        ref={this.fstaff}
        filterPitch={this.filterFStaff}
        showAnnotations={false}
        {...this.props}
        {...lowerClef}
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
