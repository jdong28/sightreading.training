
// Read this for refresher on terminology: https://en.wikipedia.org/wiki/Staff_(music)

import * as React from "react"
import classNames from "classnames"
import * as types from "prop-types"

import Two from "two.js"

// hardcoded offset from when offsets were aranged in figma. This should
// probably be removed and everything should be specified relative to origin
const STAFF_HEIGHT_OFFSET = -100

// These dimensions are in "staff-local" coordinates
const LINE_DY = 58 // Y spacing between each ledger line, should also be the height of the note
const LINE_HALF_DY = LINE_DY / 2 // the Y spacing between half steps
const LINE_HEIGHT = 4

const CLEF_GAP = 28 // the X spacing between cleff and first note
const NOTE_COLUMN_DX = 300 // the X spacing between note columns (note this doesn't take into account the width of column) to enssure consistent spacing between column

const LEDGER_EXTENT = 15 // how much ledger line extends before and past the note in x axis

const STAFF_INNER_HEIGHT = LINE_DY*4 + LINE_HEIGHT
const BAR_WIDTH = 12

// the distance between the grand staff's two staff origins. It holds the
// closest the two staves ever draw a column's notes, B3 on the lower staff
// under C4 on the upper one with the tallest accidental glyph on each:
// NoteList#splitForGrandStaff never draws a treble note below a bass one
// (the keys held down included, see StaffTwo#splitHeldForGrandStaff), and
// the room between a column's two notes only grows with the steps between
// them, so no other pair comes closer
const MIN_STAFF_DY = 500

import {CLEF_G, CLEF_F, CLEF_C, FLAT, SHARP, NATURAL, QUARTER_NOTE, WHOLE_NOTE, BRACE} from "st/staff_assets"

import {parseNote, noteStaffOffset, KeySignature, MIDDLE_C_PITCH} from "st/music"

import styles from "./staff_two.module.css"

import NoteList from "st/note_list"
import {SCROLL_WAIT} from "st/score_render/card_scroll"

// this converts static react elements to a memoized component that can take
// ref
const createAsset = function(element, name) {
  let out = React.memo(React.forwardRef((_, ref) =>
    // NOTE: nulling out viewBox is a hack to deal with this bug: https://github.com/jonobr1/two.js/issues/561
    React.cloneElement(element, { ref, viewBox: null })
  ))

  if (name) {
    out.displayName = name
  }
  return out
}


const makeBox = function(x,y,w,h) {
  let bar = new Two.Path([
    new Two.Anchor(x, y),
    new Two.Anchor(x + w, y),
    new Two.Anchor(x + w, y + h),
    new Two.Anchor(x, y + h)
  ], true, false)

  bar.fill = "black"
  bar.noStroke()

  return bar
}

// moves a persisted shape into the group its props now name (see
// StaffGroup#render's groupFor, which flips a keyed shape between the head
// column's group and the rest as the note list shifts)
const reparent = function(shape, renderGroup) {
  if (shape.parent !== renderGroup) {
    renderGroup.add(shape)
  }
}

const GClef = createAsset(CLEF_G, "GClef")
const FClef = createAsset(CLEF_F, "FClef")
const CClef = createAsset(CLEF_C, "CClef")
const Flat = createAsset(FLAT, "Flat")
const Sharp = createAsset(SHARP, "Sharp")
const Natural = createAsset(NATURAL, "Natural")
const Brace = createAsset(BRACE, "Brace")
const QuarterNote = createAsset(QUARTER_NOTE, "QuarterNote")
const WholeNote = createAsset(WHOLE_NOTE, "WholeNote")

// the staff-local row of a note on a given staff type (treble/bass/alto),
// counting half-steps down from the staff's upper line. The one definition
// of the row a note sits on: StaffGroup draws from it, and computeFit sizes
// the plate from a staff's note range with it, without needing an instance
// TODO: need to convert the chromatic note to keysignature relative in
// order to calculate accurate note position
function rowForNote(type, note) {
  const upperLine = StaffGroup.STAFF_TYPES[type].upperLine
  return -noteStaffOffset(note) + noteStaffOffset(upperLine)
}

// the y an accidental's glyph is drawn from, relative to the top-left of the
// head it belongs to: these put each glyph's own shape against the head
const ACCIDENTAL_Y_OFFSET = {natural: 61, sharp: 58, flat: 85}

// the staff-local y of an accidental's glyph top, drawn on a head at y
function accidentalY(type, y) {
  return y - ACCIDENTAL_Y_OFFSET[type] + LINE_HALF_DY
}

// the staff-local y of a note's head on a given staff type, its top-left
function yForNote(type, note) {
  // NOTE: noteStaffOffset has y axis flipped (origin on bottom), rendering has origin on top
  // NOTE we subtract LINE_HALF_DY since we assume the the note_asset.height / 2 == LINE_HALF_DY
  return rowForNote(type, note) * LINE_HALF_DY - LINE_HALF_DY
}

class NoteGroup extends React.PureComponent {
  static defaultProps = {
    type: "whole",
    head: false,
    held: false,
  }

  constructor(props) {
    super(props)
    this.noteGroup = props.getAsset("wholeNote")
    this.refresh()
  }

  refresh() {
    reparent(this.noteGroup, this.props.renderGroup)
    this.noteGroup.translation.set(this.props.x, this.props.y)
    this.noteGroup.className = classNames("note", {
      head: this.props.head,
      held: this.props.held,
    })
    // legacy: staff.module.css .note.held { opacity: 0.2 }
    this.noteGroup.opacity = this.props.held ? 0.2 : 1
  }

  componentDidUpdate() {
    this.refresh()
  }

  componentWillUnmount() {
    if (this.noteGroup) {
      this.noteGroup.remove()
    }
  }

  render() {
    return null
  }
}

// one ledger line, drawn above or below a staff (see StaffGroup#makeNotes):
// a PureComponent mirroring NoteGroup, built once and repositioned/resized
// on update so it scrolls with the notes
class LedgerLine extends React.PureComponent {
  constructor(props) {
    super(props)
    this.box = makeBox(0, 0, Math.max(props.w, 0), props.h)
    this.box.className = "ledgerLine"
    this.refresh()
  }

  refresh() {
    reparent(this.box, this.props.renderGroup)
    this.box.translation.set(this.props.x, this.props.y)
    let w = Math.max(this.props.w, 0)
    this.box.vertices[1].x = w
    this.box.vertices[2].x = w
    this.box.vertices[2].y = this.props.h
    this.box.vertices[3].y = this.props.h
  }

  componentDidUpdate() {
    this.refresh()
  }

  componentWillUnmount() {
    if (this.box) {
      this.box.remove()
    }
  }

  render() {
    return null
  }
}

// an accidental (sharp, flat or natural) drawn left of a note's head
class Accidental extends React.PureComponent {
  static defaultProps = {
    held: false,
  }

  constructor(props) {
    super(props)
    this.shape = props.getAsset(props.type)
    this.refresh()
  }

  refresh() {
    reparent(this.shape, this.props.renderGroup)
    this.shape.className = classNames("accidental", this.props.type, {
      held: this.props.held,
    })
    this.shape.translation.set(this.props.x, this.props.y)
    // legacy: staff.module.css .note.held { opacity: 0.2 } covers the
    // note's accidental too
    this.shape.opacity = this.props.held ? 0.2 : 1
  }

  componentDidUpdate(prevProps) {
    if (prevProps.type != this.props.type) {
      // the glyph itself came from the type, so it has to be rebuilt
      this.shape.remove()
      this.shape = this.props.getAsset(this.props.type)
    }
    this.refresh()
  }

  componentWillUnmount() {
    if (this.shape) {
      this.shape.remove()
    }
  }

  render() {
    return null
  }
}

// a column's annotation (eg. the position generator's finger number),
// drawn above it
class Annotation extends React.PureComponent {
  constructor(props) {
    super(props)
    this.text = new Two.Text(props.text, props.x, props.y, {
      size: 36,
      fill: "black",
      family: "sans-serif",
    })
    this.text.className = "annotation"
    this.refresh()
  }

  refresh() {
    reparent(this.text, this.props.renderGroup)
    this.text.translation.set(this.props.x, this.props.y)
    this.text.value = this.props.text
  }

  componentDidUpdate() {
    this.refresh()
  }

  componentWillUnmount() {
    if (this.text) {
      this.text.remove()
    }
  }

  render() {
    return null
  }
}

// manages a Two.Group for a single staff, clef and including key signature
// all cordinates are done in "staff-local" space, STAFF_HEIGHT_OFFSET
// The staff contains a "notes group" which contains all the notes rendered by the staff
// this should be a react component
class StaffGroup extends React.PureComponent {
  // Terminology: A "clef" is just the symbol, the staff type (treble, bass,
  // etc.) is a combination of clef and the range of notes
  static STAFF_TYPES = {
    treble: {
      // where the F of the key signature is centered around
      keySignatureCenter: "F5",
      upperLine: "F5", // upper line is where origin (0) is for staff lines

      clefAsset: "gclef",
      assetOffset: 14,
    },
    bass: {
      keySignatureCenter: "F3",
      upperLine: "A3",

      clefAsset: "fclef",
      assetOffset: 102,
    },
    alto: {
      keySignatureCenter: "F5",
      upperLine: "G5",

      clefAsset: "cclef",
      assetOffset: 100,
    }
  }

  static defaultProps = {
    type: "treble",
    keySignature: 0,
    width: 100,
    row: 0,
    dx: NOTE_COLUMN_DX,
    staffDy: MIN_STAFF_DY,
    heldNotes: null,
  }

  constructor(props={}) {
    super(props)
    this.state = {}
    this.width = props.width // TODO: normalize this
    this.marginX = 0

    this.getAsset = props.getAsset
    this.getAssetWidth = props.getAssetWidth
    // this will hold all the notes for this staff
    this.notesGroup = new Two.Group()
    this.notesGroup.className = "notesGroup"

    // the head column's shapes (notes, accidentals, ledger lines, and held
    // keys drawn faintly on it): one group so NoteShaker can shake it as a
    // whole (see StaffTwo#getFirstColumnGroups)
    this.headGroup = new Two.Group()
    this.headGroup.className = "headGroup"
    this.notesGroup.add(this.headGroup)
  }

  render() {
    this.RefreshStaff ||= Object.assign(React.memo((props) => {
      this.refreshStaff()
      return null
    }), { displayName: "RefreshStaff" })

    const {notes, ledgerLines, accidentals, annotations} = this.makeNotes(
      this.props.notes || [], this.props.heldNotes)

    const groupFor = n => n.column == 0 ? this.headGroup : this.notesGroup

    return React.createElement(React.Fragment, {},
      <this.RefreshStaff
        keySignature={this.props.keySignature}
        type={this.props.type}
        row={this.props.row}
        staffDy={this.props.staffDy}
      />,
      ...notes.map((n, idx) => <NoteGroup
        key={`note-${idx}`}
        renderGroup={groupFor(n)}
        getAsset={this.getAsset}
        {...n}
      />),
      ...accidentals.map((a, idx) => <Accidental
        key={`accidental-${idx}`}
        renderGroup={groupFor(a)}
        getAsset={this.getAsset}
        {...a}
      />),
      ...ledgerLines.map((l, idx) => <LedgerLine
        key={`ledger-${idx}`}
        renderGroup={groupFor(l)}
        {...l}
      />),
      ...annotations.map((a, idx) => <Annotation
        key={`annotation-${idx}`}
        renderGroup={groupFor(a)}
        {...a}
      />),
    )
  }

  // resize the staff to a new width. Note that this width should be in "staff
  // local" dimensions, with scale unaplied to dom element
  updateWidth(width) {
    this.width = width
    // TODO: test to make sure this works
    if (this.staffGroup) {
      for (const line of this.staffGroup.getByClassName("staffLine")) {
        line.vertices[1].x = this.width
        line.vertices[2].x = this.width
      }
    }
  }

  // Moves the notes group by x (the slider's scroll translation, in
  // staff-local units) plus this staff's own hitX offset (see hitXOffset),
  // which keeps the head column waiting on the scroll-mode hit band
  // regardless of this staff's own margin (clef and key signature width).
  // Called every animation frame (via StaffTwo#setOffset) as well as
  // whenever the staff's margin may have changed (refreshStaff), in which
  // case x is omitted and the last scroll translation is reapplied
  updateNotesTranslation(x, y, opts={}) {
    if (x != null) {
      this.scrollX = x
    }
    if ("hitX" in opts) { this._hitX = opts.hitX }
    if ("dx" in opts) { this._dx = opts.dx }
    if ("renderScale" in opts) { this._renderScale = opts.renderScale }

    this.notesGroup.translation.set((this.scrollX || 0) + this.hitXOffset(), y || 0)
  }

  // the extra translation (staff-local units, always >= 0) that puts this
  // staff's head column at hitX (pixels, StaffTwo's own coordinates) once
  // the slider waits at SCROLL_WAIT; 0 in wait mode (hitX null), and clamped
  // to 0 so a narrow plate never pushes the head left of the clef
  hitXOffset() {
    if (this._hitX == null) { return 0 }

    let renderScale = this._renderScale || 1
    let dx = this._dx || 0
    let firstNoteX = CLEF_GAP * 2

    let extra = this._hitX / renderScale - this.marginX - firstNoteX -
      this.getAssetWidth("wholeNote") / 2 - SCROLL_WAIT * dx

    return Math.max(0, extra)
  }

  componentWillUnmount() {
    if (this.staffGroup) {
      this.staffGroup.remove()
    }
  }

  refreshStaff() {
    if (this.staffGroup) {
      this.staffGroup.remove()
    }

    this.staffGroup = this.makeStaff(this.notesGroup)
    this.props.targetRenderGroup.add(this.staffGroup)

    // the staff's margin may have just changed (a new clef or key
    // signature), so the scroll/hitX translation must be recomputed against
    // it rather than left at whatever it was positioned at before
    this.updateNotesTranslation()
  }


  // creates staff lines, cleff, and key signature, refreshing into render group
  makeStaff(notesGroup) {
    const staffGroup = new Two.Group()

    staffGroup.translation.set(0, this.props.staffDy * this.props.row)

    // the X location where the notes can be rendered from. This will be
    // incremented by initial bar line, key signature, time signature, etc.
    let marginX = 0

    let bar = makeBox(0, 0, BAR_WIDTH, STAFF_INNER_HEIGHT)
    staffGroup.add(bar)
    marginX += BAR_WIDTH

    for (let i = 0; i < 5; i++) {
      let line = makeBox(marginX, i*LINE_DY, this.width - marginX, LINE_HEIGHT)
      line.className = "staffLine"
      staffGroup.add(line)
    }

    if (this.props.type) {
      const staffSettings = this.getStaffSettings()
      const clef =  this.getAsset(staffSettings.clefAsset)
      if (clef) {
        marginX += CLEF_GAP
        clef.translation.set(marginX, STAFF_HEIGHT_OFFSET + staffSettings.assetOffset)
        staffGroup.add(clef)
        marginX += clef.getBoundingClientRect().width
      }
    }

    let keySignature
    if (this.props.keySignature > 0) { // sharp
      keySignature = this.makeKeySignature("sharp", this.props.keySignature)
    } else if (this.props.keySignature < 0) { // flat
      keySignature = this.makeKeySignature("flat", -this.props.keySignature)
    }

    if (keySignature) {
      marginX += CLEF_GAP
      keySignature.translation.set(marginX, 0)
      staffGroup.add(keySignature)
      marginX += keySignature.getBoundingClientRect().width
    }

    const noteOffsetGroup = new Two.Group()
    noteOffsetGroup.translation.set(marginX, 0)
    staffGroup.add(noteOffsetGroup)

    if (notesGroup) {
      noteOffsetGroup.add(notesGroup)
    }

    this.marginX = marginX

    return staffGroup
  }

  // convert a NoteList (and the keys held down) into the shapes a column of
  // notes draws: heads, ledger lines (per note, so a seconds-offset head
  // still gets ledger lines wide enough to run under it), accidentals and
  // column annotations, plus the held keys not in the head column drawn
  // faintly on it (legacy: staff_notes.jsx's heldSongNotes)
  makeNotes(noteList, heldNotes) {
    const key = new KeySignature(this.props.keySignature)
    const dx = this.props.dx || NOTE_COLUMN_DX

    const outputNotes = []
    const outputLedgerLines = []
    const outputAccidentals = []
    const outputAnnotations = []

    const firstNoteX = CLEF_GAP * 2
    const noteWidth = this.getAssetWidth("wholeNote")
    let nextNoteX = firstNoteX
    let currentNoteColumn = 0

    const addLedgerLines = (x, row, column) => {
      if (row < 0) {
        let lines = Math.floor(Math.abs(row) / 2)
        for (let k = 1; k <= lines; k++) {
          outputLedgerLines.push({
            column,
            x: x - LEDGER_EXTENT, y: -k * LINE_DY,
            w: noteWidth + LEDGER_EXTENT * 2, h: LINE_HEIGHT,
          })
        }
      } else if (row > 8) {
        let lines = Math.floor((row - 8) / 2)
        const lowerLineY = 4 * LINE_DY
        for (let k = 1; k <= lines; k++) {
          outputLedgerLines.push({
            column,
            x: x - LEDGER_EXTENT, y: lowerLineY + k * LINE_DY,
            w: noteWidth + LEDGER_EXTENT * 2, h: LINE_HEIGHT,
          })
        }
      }
    }

    // positions one note (a real column note, or a held key drawn faintly
    // on the head column) and its ledger lines and accidental
    const addNote = (rawName, x, column, head, held) => {
      const spelled = key.enharmonic(rawName)
      const row = rowForNote(this.props.type, spelled)
      const y = this.getNoteY(spelled)

      outputNotes.push({column, x, y, head, held})

      const accidentals = key.accidentalsForNote(spelled)
      if (accidentals != null) {
        const type = accidentals == 0 ? "natural" : accidentals == 1 ? "sharp" : "flat"
        const accidentalGap = 15
        const aWidth = this.getAssetWidth(type)

        outputAccidentals.push({
          column, type, held,
          x: x - Math.ceil(aWidth) - accidentalGap,
          y: accidentalY(type, y),
        })
      }

      addLedgerLines(x, row, column)
    }

    for (let noteColumn of noteList) {
      if (typeof noteColumn == "string") {
        noteColumn = [noteColumn]
      }

      let sortedColumn = [...noteColumn].sort((a, b) => parseNote(a) - parseNote(b))

      let lastRow = null
      let lastOffset = false
      for (let noteName of sortedColumn) {
        const spelled = key.enharmonic(noteName)
        const noteRow = rowForNote(this.props.type, spelled)

        let x = nextNoteX

        // offset the note: the upper note of a second stacked on the one
        // before it
        if (!lastOffset && lastRow != null && Math.abs(noteRow - lastRow) == 1) {
          x += Math.floor(noteWidth * 0.90)
          lastOffset = true
        } else {
          lastOffset = false
        }
        lastRow = noteRow

        const head = currentNoteColumn == 0
        const held = head && !!(heldNotes && heldNotes[noteName])
        addNote(noteName, x, currentNoteColumn, head, held)
      }

      if (noteColumn.annotation) {
        outputAnnotations.push({
          column: currentNoteColumn,
          text: noteColumn.annotation,
          x: nextNoteX,
          y: -LINE_DY - 20,
        })
      }

      currentNoteColumn += 1
      nextNoteX += dx
    }

    // held keys that aren't in the head column are drawn faintly on it too
    // (legacy: staff_notes.jsx's convertHeldToSongNotes)
    if (heldNotes) {
      for (const name of Object.keys(heldNotes)) {
        if (!heldNotes[name]) { continue }
        if (noteList && noteList.inHead && noteList.inHead(name)) { continue }
        addNote(name, firstNoteX, 0, false, true)
      }
    }

    return {
      notes: outputNotes,
      ledgerLines: outputLedgerLines,
      accidentals: outputAccidentals,
      annotations: outputAnnotations,
    }
  }

  // the head column's shapes (heads, accidentals, ledger lines, held keys
  // drawn on it), shaken as one group by NoteShaker while noteShaking
  getFirstColumnGroup() {
    return this.headGroup
  }

  makeKeySignature(type, count) {
    let offsets, accidentalAsset

    // these offsets are from figma layout, in STAFF_HEIGHT_OFFSET space
    if (type == "flat") {
      offsets = [133, 42, 158, 67, 191, 100, 216]
      accidentalAsset = this.getAsset("flat")
    } else if (type == "sharp") {
      offsets = [42, 129, 14, 101, 187, 71, 158]
      accidentalAsset = this.getAsset("sharp")
    } else {
      throw new Error("Unknown type for makeKeySignature: " + type)
    }

    let group = new Two.Group()

    const staffSettings = this.getStaffSettings()
    const offsetY = (noteStaffOffset(staffSettings.upperLine) - noteStaffOffset(staffSettings.keySignatureCenter)) * LINE_HALF_DY

    let offsetX = 0
    const accidentalGap = 4
    for (let k = 0; k < count; k++) {
      let a = accidentalAsset.clone()

      a.translation.set(offsetX, offsetY + offsets[k] + STAFF_HEIGHT_OFFSET)
      offsetX += a.getBoundingClientRect().width + accidentalGap
      group.add(a)
    }

    return group
  }

  // notes group pre-offset group that will contain all notes & bars on this staff
  getNotesGroup() {
    return this.notesGroup
  }

  getRenderGroup() {
    return this.renderGroup
  }

  getMarginX() {
    return this.marginX
  }

  getStaffSettings() {
    const settings = StaffGroup.STAFF_TYPES[this.props.type]
    if (!settings) {
      throw new Error(`Don't have staff settings for staff: ${this.props.type}`)
    }

    return settings
  }

  // find staff-local y coordinate for a note (centered)
  getNoteY(note) {
    return yForNote(this.props.type, note)
  }

}

export class StaffTwo extends React.PureComponent {
  // TODO: grand should probably be handled differently -- we want it to be a
  // controller that renders both and then feeds the correct voices to the
  // correct staves
  static propTypes = {
    type: types.oneOf(["treble", "bass", "alto", "grand"]).isRequired,
    keySignature: types.object.isRequired
  }

  static defaultProps = {
    height: 300, // pixel height of the svg element
    maxScale: 0.5, // the maximum scale size when scaling contents to fit element
    range: [], // the staff's note range, what the fit is computed from
  }

  constructor(props) {
    super(props)
    this.state = {}
    this.updaters = [] // animation functions
    this.offset = 0 // the last offset setOffset was asked to apply

    this.containerRef = React.createRef()

    this.assets = { } // this will be populated with asset refs when they are fist instantiated
    this.assetCache = {} // the parsed two.js objects
    this.assetWidths = {} // the measured staff-local widths of those objects
  }

  // the staff-local column spacing: the legacy renderer's pixel spacing
  // (noteWidth * scale) translated into this staff's own units, or the
  // fixed spacing of old when the page doesn't pass noteWidth
  columnDx() {
    if (!this.props.noteWidth) { return NOTE_COLUMN_DX }

    let renderScale = (this.renderGroup && this.renderGroup.scale) || this.props.maxScale || 1
    return this.props.noteWidth * (this.props.scale || 1) / renderScale
  }

  // offset is real number in number of beats (or columns). Always stored
  // first so a later flush() (once Two.js setup has assigned state.two) can
  // re-apply it, even if this call landed before state.two was ready
  setOffset(offset) {
    this.offset = offset

    if (!this.state.two) { return }

    let dx = this.columnDx()
    let renderScale = this.renderGroup.scale

    for (const staff of this.getRenderedStaves()) {
      staff.updateNotesTranslation(offset * dx, 0, {hitX: this.props.hitX, dx, renderScale})
    }

    // it's not necessary to trigger update if twojs's own animation loop is
    // playing
    if (!this.state.two.playing) {
      this.state.two.update()
    }
  }

  createResizeObserver() {
    this.resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        this.updateWidth(entry.contentRect.width)
      }
    })

    this.resizeObserver.observe(this.containerRef.current)
  }

  componentWillUnmount() {
    // guards setup that resolves after unmount (e.g. mount and unmount in
    // the same tick, before componentDidMount has assigned state.two)
    this._unmounted = true

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      delete this.resizeObserver
    }

    // clean up the two.js instance, if setup got far enough to create one
    const {two} = this.state
    if (two) {
      two.unbind("update")
      two.pause()
      if (this.containerRef.current && two.renderer.domElement.parentNode === this.containerRef.current) {
        this.containerRef.current.removeChild(two.renderer.domElement)
      }
    }
  }

  updateWidth(width) {
    if (this._unmounted) return

    const {two} = this.state
    if (!two) return

    if (width != two.width) {
      // setting dimensions is funky: https://github.com/jonobr1/two.js/issues/191
      two.width = width

      // scale to staff-local space
      let scaledWidth = two.width / this.renderGroup.scale

      for (const staff of this.getRenderedStaves()) {
        staff.updateWidth(scaledWidth)
      }

      two.renderer.setSize(two.width, two.height)
      two.update()

      // the plate's resize may change the band's centre (hitX, measured by
      // the page from the wrapper's width), so the head's position needs
      // recomputing against it
      this.setOffset(this.offset || 0)
    }
  }

  addUpdate(fn) {
    this.updaters = [...this.updaters, fn]

    if (this.state.two && !this.state.two.playing) {
      // console.log("Starting playing with ", this.updaters.length, "updaters")
      this.state.two.play()
    }

  }

  removeUpdate(fn) {
    this.updaters = this.updaters.filter(f => f != fn)

    if (this.updaters.length == 0 && this.state.two && this.state.two.playing) {
      // console.log("Stopping playing")
      this.state.two.pause()
    }
  }

  componentDidMount() {
    this.createResizeObserver()
    let initialWidth = this.containerRef.current.getBoundingClientRect().width

    const two = new Two({
      width: initialWidth,
      height: this.props.height,
      // type: Two.Types.canvas
    }).appendTo(this.containerRef.current)

    if (this._unmounted) {
      // unmounted before this setup finished; undo what was just built
      // instead of leaving a dangling Two.js instance/canvas behind
      two.pause()
      if (this.containerRef.current && two.renderer.domElement.parentNode === this.containerRef.current) {
        this.containerRef.current.removeChild(two.renderer.domElement)
      }
      return
    }

    // call updaters when any animations are active
    two.bind("update", (...args) => {
      for (let updater of this.updaters) {
        updater(...args)
      }
    })

    // render group contains the final viewport transformation
    this.renderGroup = two.makeGroup()
    this.renderGroup.scale = 0.5

    two.update()
    this.setState({ two }, () => {
      if (this._unmounted) return

      // the watchers rendered below only flush on a later prop *change*
      // (React.memo bails when props are referentially equal), so force one
      // flush here to paint notes/type/keySignature already present on this
      // very first render, without requiring a subsequent prop change
      this.flushChanges = true
      this.flush()
    })
  }

  // the staff-local vertical extent [top, bottom] of a clef and a range of
  // notes on the given staff type: used by computeFit to size the plate from
  // a staff's note range rather than its current notes. A note's own head
  // reaches past every ledger line addLedgerLines draws under it, so the
  // heads alone give the extent
  rangeExtent(type, notes) {
    const settings = StaffGroup.STAFF_TYPES[type]
    const clef = this.getAsset(settings.clefAsset)
    clef.translation.set(0, STAFF_HEIGHT_OFFSET + settings.assetOffset)

    let {top, bottom} = clef.getBoundingClientRect()

    for (const note of notes) {
      const y = yForNote(type, note)

      top = Math.min(top, y)
      bottom = Math.max(bottom, y + LINE_DY)
    }

    return {top, bottom}
  }

  // the fit for the staff's note range (this.props.range): the render scale
  // and vertical translation that fit the range's own ledger room in the
  // plate, plus the distance the grand staff's two staves are drawn apart.
  // The fit comes from the range, not the notes on screen, so the staff
  // never jumps as notes come and go, and is stable for as long as the
  // type/range/height/maxScale don't change
  computeFit() {
    const {type, range, height, maxScale} = this.props
    const cacheKey = [type, height, maxScale, ...range].join("/")

    if (this.fitCache && this.fitCache.key == cacheKey) {
      return this.fitCache.fit
    }

    let top, bottom

    if (type == "grand") {
      const middleC = noteStaffOffset("C4")
      const trebleNotes = range.filter(n => noteStaffOffset(n) >= middleC)
      const bassNotes = range.filter(n => noteStaffOffset(n) < middleC)

      const treble = this.rangeExtent("treble", trebleNotes)
      const bass = this.rangeExtent("bass", bassNotes)

      top = treble.top
      bottom = bass.bottom + MIN_STAFF_DY
    } else {
      const extent = this.rangeExtent(type, range)
      top = extent.top
      bottom = extent.bottom
    }

    top = Math.min(top, -1)
    bottom += 10

    const sourceHeight = bottom - top
    const scale = Math.min(maxScale, height / sourceHeight)
    const translateY = Math.floor(-(top * scale))

    this.fitCache = {key: cacheKey, fit: {scale, translateY, staffDy: MIN_STAFF_DY}}

    return this.fitCache.fit
  }

  getRenderedStaves() {
    const out = []

    if (this.trebleStaffRef && this.trebleStaffRef.current) {
      out.push(this.trebleStaffRef.current)
    }

    if (this.bassStaffRef && this.bassStaffRef.current) {
      out.push(this.bassStaffRef.current)
    }

    if (this.altoStaffRef && this.altoStaffRef.current) {
      out.push(this.altoStaffRef.current)
    }

    return out
  }

  // splits the keys held down between the grand staff's two staves by
  // splitting them with the head column through NoteList#splitForGrandStaff,
  // the same rule the drill's own columns use, so a held pitch is drawn on
  // the staff of the column that holds it
  splitHeldForGrandStaff(notes, heldNotes) {
    if (!heldNotes) { return [null, null] }

    const held = Object.keys(heldNotes).filter(name => heldNotes[name])
    const head = (notes && notes[0]) || []

    const [treble, bass] = new NoteList([head, held]).splitForGrandStaff()

    const asHeld = column => {
      const out = {}
      for (const name of column) { out[name] = true }
      return out
    }

    return [asHeld(treble[1]), asHeld(bass[1])]
  }

  renderStaves() {
    if (!this.state.two) {
      // canvas isn't ready yet
      return
    }

    if (!this.assetsReady()) {
      // asset refs may not be attached yet on a very first paint; wait for
      // them instead of throwing, and retry (via flush()) once they are
      this._pendingAssetsRetry = true
      return
    }

    // the one place the fit is applied: it only depends on props already
    // available here (type/range/height/maxScale), not on the notes about to
    // be laid out below, so it runs before them, which keeps makeNotes'
    // column spacing (which reads renderGroup.scale through columnDx/dx)
    // correct on the very first paint
    const {scale, translateY, staffDy} = this.computeFit()
    this.renderGroup.scale = scale
    this.renderGroup.translation.set(0, translateY)

    let marginX = 0

    const getAsset = this._getAsset || this.getAsset.bind(this)
    const getAssetWidth = this.getAssetWidth.bind(this)
    const dx = this.columnDx()

    const staffProps = {
      // two: this.state.two,
      targetRenderGroup: this.renderGroup,
      getAsset,
      getAssetWidth,
      keySignature: this.props.keySignature.getCount(), // TODO: just pass key signature to avoid additional work
      staffDy,
      width: Math.floor(this.state.two.width / this.renderGroup.scale),
      dx,
    }

    switch (this.props.type) {
      case "grand": {
        let trebleNotes, bassNotes

        if (this.props.notes) {
          [trebleNotes, bassNotes] = this.props.notes.splitForGrandStaff()
        }

        let [trebleHeld, bassHeld] = this.splitHeldForGrandStaff(this.props.notes, this.props.heldNotes)

        return <>
          <StaffGroup
            row={0}
            ref={this.trebleStaffRef ||= React.createRef()}
            type="treble"
            notes={trebleNotes}
            heldNotes={trebleHeld}
            {...staffProps}
          />
          <StaffGroup
            row={1}
            ref={this.bassStaffRef ||= React.createRef()}
            type="bass"
            notes={bassNotes}
            heldNotes={bassHeld}
            {...staffProps}
          />
        </>
      }
      case "treble": {
        return <StaffGroup
          ref={this.trebleStaffRef ||= React.createRef()}
          type="treble"
          notes={this.props.notes}
          heldNotes={this.props.heldNotes}
          {...staffProps}
        />
      }
      case "bass": {
        return <StaffGroup
          type="bass"
          ref={this.bassStaffRef ||= React.createRef()}
          notes={this.props.notes}
          heldNotes={this.props.heldNotes}
          {...staffProps}
        />
      }
      case "alto": {
        return <StaffGroup
          type="alto"
          ref={this.altoStaffRef ||= React.createRef()}
          notes={this.props.notes}
          heldNotes={this.props.heldNotes}
          {...staffProps}
        />
      }
    }

    throw new Error("Unhandled staff type in renderStaves")
  }

  // this will return a fresh copy of the asset that can be mutated
  getAsset(name) {
    this.assetCache ||= {}

    if (!this.assetCache[name]) {
      const domNode = this.assets[name].current

      if (!domNode) {
        throw new Error("Failed to find asset by name: " + name)
      }

      const loaded = this.state.two.interpret(domNode, false, false)
      this.assetCache[name] = loaded
    }

    return this.assetCache[name].clone()
  }

  // the staff-local width of an asset's glyph: it only depends on the asset,
  // so one clone is measured and the width kept (makeNotes needs an
  // accidental's width on every render)
  getAssetWidth(name) {
    if (this.assetWidths[name] == null) {
      this.assetWidths[name] = this.getAsset(name).getBoundingClientRect().width
    }

    return this.assetWidths[name]
  }

  // true once every asset ref assigned in render has attached its DOM node
  assetsReady() {
    const refs = Object.values(this.assets)
    return refs.length > 0 && refs.every(ref => ref.current)
  }

  // NOTE: flushChanges is set by the prop watchers in the rendered contents of
  // this widget. componentDidUpdate is called after all children have
  // rendered, so we can use it to apply the updates to the scene graph to the
  // output
  componentDidUpdate(prevProps, prevState) {
    this.flush()
  }

  flush() {
    if (this._unmounted) return

    if (this._pendingAssetsRetry) {
      if (this.assetsReady()) {
        // a previous render skipped building the staves because the asset
        // refs weren't attached yet; now that they are, try again
        this._pendingAssetsRetry = false
        this.forceUpdate()
      }
      return
    }

    if (this.flushChanges) {
      if (!this.assetsReady()) {
        // nothing has been rendered to fit yet; wait for renderStaves()'s
        // own retry (above) to try again
        return
      }

      this.flushChanges = false

      // re-apply the stored scroll/hitX offset against whatever just
      // changed (the fit's scale, a staff's margin, the note list): see
      // sight_reading_page_spec.js's "keeps the head on the band after a
      // staff change at rest"
      this.setOffset(this.offset || 0)
    }
  }

  // makes a react component for enabling and disabling an animation
  makeAnimator(displayName, makeFunction) {
    return Object.assign(React.memo(props => {
      React.useEffect(() => {
        const updater = makeFunction()
        this.addUpdate(updater)
        return () => {
          this.removeUpdate(updater)
          updater(-1, 0) // signal removal of animator
          if (this.state.two) {
            this.state.two.update() // synchronize any changes from removal of update
          }
        }
      })
    }), { displayName })
  }

  getFirstColumnGroups() {
    const out = []

    for (const staff of this.getRenderedStaves()) {
      const group = staff.getFirstColumnGroup()
      if (group) {
        out.push(group)
      }
    }

    return out
  }

  render() {
    this.RefreshNotes ||= Object.assign(React.memo((props) => {
      if (this.renderGroup) {
        this.flushChanges = true
      }
      return null
    }), {
      displayName: "RefreshNotes"
    })

    this.RefreshStaves ||= Object.assign(React.memo((props) => {
      if (this.renderGroup) {
        this.flushChanges = true
      }
      return null
    }), { displayName: "RefreshStaves" })


    this.NoteShaker ||= this.makeAnimator("NoteShaker", () => {
      let elapsed = 0
      return (frame, dt) => {
        const scale = (1 - Math.max(0, elapsed - 250) / 250)
        for (const group of this.getFirstColumnGroups()) {
          if (frame > 0) {
            group.translation.set(Math.sin(elapsed/3)*10*scale, 0)
          } else {
            group.translation.set(0,0)
          }
        }

        elapsed += dt
      }
    })

    return <div className={styles.notes_staff} ref={this.containerRef}>
      {this.renderStaves()}

      <this.RefreshNotes
        notes={this.props.notes}
        heldNotes={this.props.heldNotes}
      />

      <this.RefreshStaves
        type={this.props.type}
        keySignature={this.props.keySignature}
        range={this.props.range}
        hitX={this.props.hitX}
        noteWidth={this.props.noteWidth}
        scale={this.props.scale}
      />

      {this.props.noteShaking ? <this.NoteShaker /> : null}

      <div className="assets" style={{display: "none"}}>
        <GClef ref={this.assets.gclef ||= React.createRef()} />
        <FClef ref={this.assets.fclef ||= React.createRef()} />
        <CClef ref={this.assets.cclef ||= React.createRef()} />
        <Brace ref={this.assets.brace ||= React.createRef()} />
        <Flat ref={this.assets.flat ||= React.createRef()} />
        <Sharp ref={this.assets.sharp ||= React.createRef()} />
        <Natural ref={this.assets.natural ||= React.createRef()} />
        <WholeNote ref={this.assets.wholeNote ||= React.createRef()} />
        <QuarterNote ref={this.assets.quarterNote ||= React.createRef()} />
      </div>
    </div>
  }
}
