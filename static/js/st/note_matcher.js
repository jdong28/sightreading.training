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
// list as it now stands, the keys down and touched, and the events the page
// applies (a miss counted on a column, a hit that advanced it, the chord
// drill's release check).

export default class NoteMatcher {
  // notes is the NoteList the drill is playing (the matcher advances it);
  // opts are the options detection reads: the generator's mode ("notes" or
  // "chords") and anyOctave
  constructor(notes, opts={}) {
    this.notes = notes || null
    this.mode = opts.mode || "notes"
    this.anyOctave = !!opts.anyOctave

    // the keys physically down, from each note on to its note off. It
    // survives a hit, so letting up keys that played earlier columns is no
    // try at the current one
    this.held = {}

    // the keys struck at the head column since it was last played afresh.
    // Cleared at a hit and when every key comes up
    this.touched = {}

    // the note list a miss was last counted on (a column counts missed once
    // however many slips and releases it takes), and whether the try in
    // progress has already counted a slip
    this.missedNotes = null
    this.slipped = false

    // the timeStamp of the last event fed in, recorded for the later tasks
    // that measure a column's timing. Nothing computes lateness from it yet
    this.lastEventAt = null
  }

  // adopts a note list built elsewhere (a rebuilt drill, a skipped column)
  setNotes(notes) {
    this.notes = notes || null
  }

  // Begin and Rest: no key is down and no column is in progress
  clear() {
    this.held = {}
    this.touched = {}
  }

  // the head column is played afresh from the next key down, with the keys
  // still down left held (a skipped column)
  clearTouched() {
    this.touched = {}
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
    // a try on
    if (!Object.keys(this.touched).some(n => this.held[n])) {
      this.slipped = false
    }

    this.held = {...this.held, [note]: true}
    this.touched = {...this.touched, [note]: true}

    let events = []
    // chords only check on release
    if (this.mode == "notes") {
      this.judgePress(note, events)
    }

    return this.result(events)
  }

  // A key came up. The release check runs at most once an event, when the
  // last key down comes up. Answers null when the key wasn't down at all, so
  // the page has nothing to render
  noteOff(note, timeStamp) {
    this.lastEventAt = timeStamp ?? null

    // a key pressed at rest, or before Begin or Rest, isn't held
    if (!this.held[note]) {
      return null
    }

    this.held = {...this.held}
    delete this.held[note]

    if (Object.keys(this.held).length) {
      return this.result([])
    }

    let events = []
    this.judgeRelease(events)
    return this.result(events)
  }

  // called on every key down in notes mode
  judgePress(note, events) {
    let notes = this.notes
    if (!notes) { return }

    // nothing to play (eg. an empty section): no key is a slip, as no
    // release is a miss
    if (!notes.currentColumn().length) { return }

    let touched = Object.keys(this.touched)
    let matched = notes.matchesHead(touched, this.anyOctave)

    // pressing a key outside the column is a slip: the column counts as
    // missed, but the keys touched still go on to complete it. A slip in the
    // same event that completes the column is counted before the hit
    let stray = notes.strayNotes(touched, this.anyOctave)
    if (stray.includes(note) || (matched && stray.length && this.missedNotes != notes)) {
      events.push(this.missColumn(notes.currentColumn(), notes.blamedNotes(touched, this.anyOctave)))
    }

    if (!matched) { return }

    this.slipped = false
    let from = notes
    let advanced = notes.clone()
    advanced.shift()
    advanced.pushRandom()

    this.notes = advanced
    // the keys still down stay held: letting them up later is no try at the
    // next column
    this.touched = {}

    events.push({
      type: "hit",
      // the keys the stats credit the column with: the slipped ones don't
      hitNotes: touched.filter(n => !stray.includes(n)),
      // the list as it was, for the width the staff slides by
      from,
      // a slip's shake plays out over the next column
      stray: stray.length > 0,
    })
  }

  // called when the keys down reach 0
  judgeRelease(events) {
    let notes = this.notes
    if (!notes) { return }

    switch (this.mode) {
      case "notes": {
        let column = notes.currentColumn()

        if (column.length == 0) {
          this.slipped = false
          this.touched = {}
          return
        }

        // the keys let up played earlier columns (held across their hits),
        // none this one: that isn't a try at it
        let touched = Object.keys(this.touched)
        if (!touched.length) { return }

        // every key is up without the column matched: it counts as missed
        // (once) and is played afresh from the next key down
        events.push(this.missColumn(column, notes.blamedNotes(touched, this.anyOctave)))
        this.touched = {}
        return
      }

      case "chords": {
        let touched = Object.keys(this.touched)

        if (notes.matchesHead(touched) && touched.length > 2) {
          let from = notes
          let advanced = notes.clone()
          advanced.shift()
          advanced.pushRandom()
          this.notes = advanced
          this.clear()
          events.push({type: "chordHit", from})
        } else {
          this.clear()
          events.push({type: "chordMiss"})
        }
        return
      }
    }
  }

  // The head column counts as missed, at most once however many slips and
  // releases it takes to complete it. missed are the column's notes the
  // stats count against, blamed those the miss is put down to (see
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

    // one slip a try, from a key down to every key up
    this.slipped = true

    return {type: "miss", missed, blamed, counted, notes: this.notes}
  }

  result(events) {
    return {
      notes: this.notes,
      held: {...this.held},
      touched: {...this.touched},
      events,
    }
  }
}
