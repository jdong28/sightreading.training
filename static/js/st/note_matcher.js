// The one place the drill's detection rules live (T3 of the note detection
// report): a pure, synchronous matcher over a NoteList.
//
// Every MIDI note on and note off is fed to it one at a time, in the order it
// arrived, with the event's timeStamp. The matcher's own state is the source
// of truth for the keys down, the keys touched and the head column; the page
// renders what each call returns, and never judges a note through a setState
// callback. Two key-downs that arrive in one MIDI packet are therefore
// judged one after the other against the head each of them actually saw,
// exactly as the same presses spread out in time would be.
//
// Nothing here touches React, the DOM or the stats: a call answers with the
// list as it now stands and the keys down and touched, and tells opts.onEvent
// each judgement it makes (a miss counted on a column, a hit that advanced
// it, the chord drill's release check) at the point it makes it, so every
// judgement reaches the stats before the list advance the ones after it
// describe.
//
// In notes mode only key-downs are judged (T4). A key coming up only leaves
// the keys down, so a hand let up before the other lands, keys let go early
// under the pedal (which the matcher never reads) and a rolled chord caught
// by it all complete their column: it is complete once every one of its keys
// has gone down since it became the head, however far apart. How far apart
// is recorded on the hit (its spread), and nothing judges it yet.

export default class NoteMatcher {
  // notes is the NoteList the drill is playing (the matcher advances it);
  // opts are the options detection reads: the generator's mode ("notes" or
  // "chords") and anyOctave, and onEvent, told each judgement as it is made
  constructor(notes, opts={}) {
    this.notes = notes || null
    this.mode = opts.mode || "notes"
    this.anyOctave = !!opts.anyOctave
    this.onEvent = opts.onEvent || null

    // the keys physically down, from each note on to its note off. It
    // survives a hit, so letting up keys that played earlier columns is no
    // try at the current one
    this.held = {}

    // the keys struck at the head column since it became the head, wrong
    // ones included. Kept however many keys come up (in notes mode), and
    // cleared at a hit or when another list takes over
    this.touched = {}

    // when the first of the head column's own keys went down, for its spread
    this.firstAt = null

    // the note list a miss was last counted on (a column counts missed once
    // however many slips it takes), and whether the try in
    // progress has already counted a slip
    this.missedNotes = null
    this.slipped = false

    // the timeStamp of the last event fed in, recorded for the later tasks
    // that measure a column's timing. Nothing computes lateness from it yet
    this.lastEventAt = null
  }

  // adopts a note list built elsewhere (a rebuilt drill, a column scrolled
  // past): the keys struck and let up since the old head became the head
  // are dropped, as they would count for its new one ever after. Keys still
  // down stay touched, a wrong one counting on the column it is played on
  setNotes(notes) {
    notes = notes || null
    if (notes !== this.notes) {
      let down = Object.keys(this.touched).filter(n => this.held[n])
      this.clearTouched()
      for (let n of down) { this.touched[n] = true }
    }
    this.notes = notes
  }

  // Begin and Rest: no key is down and no column is in progress
  clear() {
    this.held = {}
    this.clearTouched()
  }

  // the head column is played afresh from the next key down, with the keys
  // still down left held (a skipped column)
  clearTouched() {
    this.touched = {}
    this.firstAt = null
  }

  // the stats started over, so the column under way may count a miss again
  forgetMisses() {
    this.missedNotes = null
  }

  // A key went down. Returns the result the page renders
  noteOn(note, timeStamp) {
    this.lastEventAt = timeStamp ?? null

    // a key down with none of the column's touched keys held starts a new
    // try, which may slip again; keys held from earlier columns don't carry
    // a try on. A try only bounds the slips counted: letting its keys up
    // judges nothing and keeps them struck
    if (!Object.keys(this.touched).some(n => this.held[n])) {
      this.slipped = false
    }

    this.held = {...this.held, [note]: true}
    this.touched = {...this.touched, [note]: true}

    // chords only check on release
    if (this.mode == "notes") {
      this.judgePress(note, timeStamp)
    }

    return this.result()
  }

  // A key came up. In notes mode that judges nothing; the chord drill's
  // release check runs at most once an event, when the last key down comes
  // up. Answers null when the key wasn't down at all, so the page has
  // nothing to render
  noteOff(note, timeStamp) {
    this.lastEventAt = timeStamp ?? null

    // a key pressed at rest, or before Begin or Rest, isn't held
    if (!this.held[note]) {
      return null
    }

    this.held = {...this.held}
    delete this.held[note]

    if (this.mode == "chords" && !Object.keys(this.held).length) {
      this.judgeChord()
    }

    return this.result()
  }

  // tells the page what a key down or up did, as it is judged
  emit(event) {
    if (this.onEvent) { this.onEvent(event) }
  }

  // called on every key down in notes mode, with the event's timeStamp
  judgePress(note, timeStamp) {
    let notes = this.notes
    if (!notes) { return }

    // nothing to play (eg. an empty section): no key is a slip
    if (!notes.currentColumn().length) { return }

    let touched = Object.keys(this.touched)
    let matched = notes.matchesHead(touched, this.anyOctave)

    // pressing a key outside the column is a slip: the column counts as
    // missed, but the keys touched still go on to complete it. A wrong key
    // still down as the column completes is counted before the hit, on
    // stats started over since it went down too
    let stray = notes.strayNotes(touched, this.anyOctave)
    let strayDown = stray.filter(n => this.held[n])
    if (stray.includes(note) || (matched && strayDown.length && this.missedNotes != notes)) {
      this.emit(this.missColumn(notes.currentColumn(), notes.blamedNotes(touched, this.anyOctave)))
    }

    // the first of the column's own keys down starts its spread
    if (!stray.includes(note) && this.firstAt == null) {
      this.firstAt = timeStamp ?? null
    }

    if (!matched) { return }

    // from the first of the column's keys down to this one, which completed
    // it: null for presses with no timeStamp (the on-screen keyboard)
    let spread = this.firstAt != null && timeStamp != null
      ? timeStamp - this.firstAt
      : null

    this.slipped = false
    let from = notes
    let advanced = notes.clone()
    advanced.shift()
    advanced.pushRandom()

    this.notes = advanced
    // the keys still down stay held: letting them up later is no try at the
    // next column
    this.clearTouched()

    this.emit({
      type: "hit",
      // the keys the stats credit the column with: the slipped ones don't
      hitNotes: touched.filter(n => !stray.includes(n)),
      // the list as it was, for the width the staff slides by
      from,
      // a slip's shake plays out over the next column
      stray: stray.length > 0,
      spread,
    })
  }

  // the chord drill, when the keys down reach 0: the chord is checked on
  // its release
  judgeChord() {
    let notes = this.notes
    if (!notes) { return }

    let touched = Object.keys(this.touched)

    if (notes.matchesHead(touched) && touched.length > 2) {
      let from = notes
      let advanced = notes.clone()
      advanced.shift()
      advanced.pushRandom()
      this.notes = advanced
      this.clear()
      this.emit({type: "chordHit", from})
    } else {
      this.clear()
      this.emit({type: "chordMiss"})
    }
  }

  // The head column counts as missed, at most once however many slips it
  // takes to complete it. missed are the column's notes the stats count
  // against, blamed those the miss is put down to (see
  // NoteList#blamedNotes); counted says what the stats make of it: the
  // column's first miss, a further slip in the same column, or nothing
  missColumn(missed, blamed) {
    let counted = null

    if (this.missedNotes != this.notes) {
      this.missedNotes = this.notes
      counted = "miss"
    } else if (!this.slipped) {
      counted = "slip"
    }

    // one slip a try, from a key down to every key struck at the column up
    this.slipped = true

    return {type: "miss", missed, blamed, counted, notes: this.notes}
  }

  result() {
    return {
      notes: this.notes,
      held: {...this.held},
      touched: {...this.touched},
    }
  }
}
