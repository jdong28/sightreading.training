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
//
// Around each column the matcher looks one column either way (T5, rules 2.3,
// 2.4 and 3 of the report). A key of the next column struck while this one
// is under way, as when one hand leads the other, is held early for it: once
// this column completes it is credited to the next, which completes at once
// if that was all it needed. It counts as a slip on this column only if this
// one doesn't complete within EARLY_KEY_WINDOW of it (the player wasn't
// early, they were wrong), judged at the next key down. A key of the column
// just completed struck again within LATE_REPEAT_WINDOW of its completing (a
// late duplicate, a key bounce) is ignored. Both windows are on the events'
// timeStamps, so a press with none (the on-screen keyboard) is judged as if
// outside them.

// W_early: how long a key of the next column may wait for the column under
// way to complete before it counts as a slip on it (ruling D2(a): about
// 250 ms to start with, to be revised from recorded playing)
export const EARLY_KEY_WINDOW = 250

// L: how long after a column completes striking one of its keys again is
// ignored rather than a slip (D2(a), as EARLY_KEY_WINDOW)
export const LATE_REPEAT_WINDOW = 250

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
    // survives a hit, so a wrong key still down as a column completes is
    // counted on it; letting keys up judges nothing (T4)
    this.held = {}

    // the keys struck at the head column since it became the head, wrong
    // ones included, and the keys credited to it early. Kept however many
    // keys come up (in notes mode), and cleared at a hit or when another
    // list takes over
    this.touched = {}

    // of those, the keys that slipped at the head, and the keys of the next
    // column held early for it, each with the timeStamp it went down at
    this.strays = {}
    this.early = {}

    // the keys of the head credited to it early, recorded on its hit
    this.credited = []

    // the column just completed and the timeStamp of its last required key
    // down, which a key struck again shortly after is excused against
    this.previous = null

    // whether one of the head column's own keys has gone down at it, and
    // when the first of them did, for its spread: null when that press
    // carried no timeStamp (the on-screen keyboard)
    this.firstDown = false
    this.firstAt = null

    // the note list a miss was last counted on (a column counts missed once
    // however many slips it takes), and whether the try in progress has
    // already counted a slip
    this.missedNotes = null
    this.slipped = false

    // the timeStamp of the last event fed in, recorded for the later tasks
    // that measure a column's timing. Nothing computes lateness from it yet
    this.lastEventAt = null
  }

  // adopts a note list built elsewhere (a rebuilt drill, a column scrolled
  // past): the keys struck at the old head are dropped, so its new one is
  // played afresh from the next key down, however many keys are still down.
  // A key held over is neither credited to the new column (score-sustained
  // credit is a later step) nor counted against it, having been judged on
  // the column it was played on
  setNotes(notes) {
    notes = notes || null
    if (notes !== this.notes) {
      this.clearTouched()
    }
    this.notes = notes
  }

  // Begin and Rest: no key is down and no column is in progress
  clear() {
    this.held = {}
    this.clearTouched()
  }

  // the head column is played afresh from the next key down, with the keys
  // still down left held (a skipped column): no key is held early for the
  // column after it, and no column just completed is looked back to
  clearTouched() {
    this.touched = {}
    this.strays = {}
    this.early = {}
    this.credited = []
    this.previous = null
    this.firstDown = false
    this.firstAt = null
  }

  // the stats started over, so the column under way may count a miss again
  forgetMisses() {
    this.missedNotes = null
  }

  // A key went down. Returns the result the page renders
  noteOn(note, timeStamp) {
    this.lastEventAt = timeStamp ?? null

    // an ornament the score writes at the head column (a grace note, or a
    // note of a trill, turn or mordent) played as written is an allowed
    // extra (rule 2.2): the key is down, but it isn't required, isn't a slip
    // and is no part of the try at the column
    if (this.mode == "notes" && this.notes && this.notes.allowedInHead(note, this.anyOctave)) {
      this.held = {...this.held, [note]: true}
      return this.result()
    }

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

    this.expireEarly(timeStamp)

    // rule 2: the head's own key, a key of the column just completed struck
    // again, a key of the next column played early, or else a slip
    let slip = false
    if (this.inColumn(notes.currentColumn(), note)) {
      // the first of the column's own keys down starts its spread
      if (!this.firstDown) {
        this.firstDown = true
        this.firstAt = timeStamp ?? null
      }
    } else if (this.repeated(note, timeStamp)) {
      // struck again: neither the head's nor a slip
    } else if (timeStamp != null && this.inColumn(this.columnAt(1), note)) {
      this.early = {...this.early, [note]: timeStamp}
    } else {
      this.strays = {...this.strays, [note]: true}
      slip = true
    }

    let matched = notes.matchesHead(Object.keys(this.touched), this.anyOctave)

    // a slip counts the column as missed, but the keys touched still go on
    // to complete it. A wrong key still down as the column completes is
    // counted before the hit, on stats started over since it went down too
    let strayDown = Object.keys(this.strays).filter(n => this.held[n])
    if (slip || (matched && strayDown.length && this.missedNotes != notes)) {
      this.emitMiss()
    }

    if (matched) {
      this.hit(timeStamp)
    }
  }

  // The head column is complete, its last required key down at completedAt:
  // it moves on, and the keys held early for the next column are credited
  // to it, completing it too if they are all of it (rule 3)
  hit(completedAt) {
    let notes = this.notes
    let column = notes.currentColumn()
    let touched = Object.keys(this.touched)

    // from the first of the column's keys down to the last, which completed
    // it: null when either press came with no timeStamp (the on-screen
    // keyboard), as their distance apart isn't known
    let spread = this.firstAt != null && completedAt != null
      ? completedAt - this.firstAt
      : null

    let event = {
      type: "hit",
      // the keys the stats credit the column with: the column's own
      hitNotes: touched.filter(n => this.inColumn(column, n)),
      // the list as it was, for the width the staff slides by
      from: notes,
      // a slip's shake plays out over the next column
      stray: Object.keys(this.strays).length > 0,
      spread,
      // the column's keys that were struck before it was the head
      early: this.credited,
    }

    let early = this.early
    this.slipped = false
    let advanced = notes.clone()
    advanced.shift()
    advanced.pushRandom()
    this.notes = advanced

    // the next column is played afresh, but for its keys struck early: the
    // keys still down stay held, and none of them is otherwise credited to
    // it (score-sustained credit is a later step)
    this.clearTouched()
    this.previous = {column, at: completedAt}

    let next = advanced.currentColumn()
    let credited = Object.keys(early).filter(n => this.inColumn(next, n))
    for (let n of credited) {
      this.touched[n] = true
      this.firstDown = true
      this.firstAt = this.firstAt == null ? early[n] : Math.min(this.firstAt, early[n])
    }
    this.credited = credited

    // the list as it now stands, before any column the keys credited early
    // complete in turn
    event.to = advanced
    this.emit(event)

    if (credited.length && advanced.matchesHead(credited, this.anyOctave)) {
      this.hit(Math.max(...credited.map(n => early[n])))
    }
  }

  // Keys held early for the next column that the head hasn't completed
  // within EARLY_KEY_WINDOW of, at a key down at timeStamp, were wrong: they
  // count as one slip on the head, and aren't credited to the next column
  expireEarly(timeStamp) {
    let stale = Object.keys(this.early).filter(n =>
      timeStamp == null || timeStamp - this.early[n] > EARLY_KEY_WINDOW)
    if (!stale.length) { return }

    this.early = {...this.early}
    this.strays = {...this.strays}
    for (let n of stale) {
      delete this.early[n]
      this.strays[n] = true
    }

    this.emitMiss()
  }

  // whether a key is one of the column just completed, struck again within
  // LATE_REPEAT_WINDOW of its completing (rule 2.3)
  repeated(note, timeStamp) {
    let previous = this.previous
    return !!previous && previous.at != null && timeStamp != null &&
      timeStamp - previous.at <= LATE_REPEAT_WINDOW &&
      this.inColumn(previous.column, note)
  }

  // counts a slip on the head column, blamed on its notes from the keys
  // struck at it that are its own or slipped
  emitMiss() {
    let notes = this.notes
    let column = notes.currentColumn()
    let struck = Object.keys(this.touched).filter(n =>
      this.strays[n] || this.inColumn(column, n))
    this.emit(this.missColumn(column, notes.blamedNotes(struck, this.anyOctave)))
  }

  // the column at an index of the list, [] past its end
  columnAt(idx) {
    let column = this.notes[idx]
    if (column == null) { return [] }
    return Array.isArray(column) ? column : [column]
  }

  inColumn(column, note) {
    return column.some(n => this.notes.sameNote(note, n, this.anyOctave))
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
