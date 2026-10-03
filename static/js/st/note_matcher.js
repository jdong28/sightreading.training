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
// early, they were wrong), judged at the next key down — or, in tempo mode,
// dropped uncredited as this column scrolls past (see scrollPast), which
// counts its own miss on the column instead. A key of the column the head
// has just moved on from, completed or scrolled past, struck again within
// LATE_REPEAT_WINDOW of its going (a late duplicate, a key bounce, the note
// the player was still reading) is ignored. Both windows are on the events'
// timeStamps, so a press with none (the on-screen keyboard) is judged as if
// outside them.
//
// A key the score still sounds at a column's onset from an earlier one (a
// key two voices share, or notes that overlap: column.sustained, see
// extractSectionColumns) counts toward the column while it is down, held
// rather than struck again (T6, rule 1; ruling D3(a)). That held credit is
// applied lazily: when a key that isn't the head's own goes down (the player
// has moved on), or when it would complete the head with the keys struck at
// it, never before the column is the head, nor as it becomes the head save
// the one column below. Striking the key again is its own key down at the
// column, as before. A key held through a note the score strikes again (the
// earlier one ends at the onset) isn't sustained, so the column still waits
// for it.
//
// The one column credited as it becomes the head is the card's last (not
// its first, which a key of that card credits instead, so one key down never
// finishes a lap the player hasn't played): no key of the card is left to go
// down after it, so the card finishes by itself. Striking a key held for it
// again at its onset anyway is then excused the once, so it is never a slip
// on the card or lap after it (see settleCardEnd).
//
// The ornaments the score writes (T7, rule 2.2; redesigned, sr-detect-
// ornament-span-n7d) are allowed extras, excused independent of the head: a
// grace note, or a note of a trill, turn or mordent, played anywhere from the
// column it is written at (column.allowed) through the columns its own note
// still sounds over (column.trailing, both from extractSectionColumns in
// st/song_sections) goes down with nothing judged about it, carried on past
// the head as T once the column completes (see hit). A key that could belong
// to either the ornament or a real column (the trill's own pitch, repeating
// into the next note, or a grace struck early for the column after the head)
// is ambiguous: held pending rather than judged at once, until what follows
// within ORNAMENT_GAP decides it (see noteOn, settlePending) — another
// ornament key in play means it was the ornament going on, no strike and no
// slip; anything else (a key outside it, the gap elapsing, the page's tick)
// means it was the real strike, judged at its own timeStamp. A key pending
// for the head completes it as if struck then, and is dropped as part of an
// ornament only for one still rolling from an earlier column (T), never for
// one the head's own trill, turn or mordent sounds (its trailing), which runs
// from the head's own note; one pending for the next column, ambiguous
// because it is also the next column's own key, is credited early (T5) once
// resolved, excused rather than a slip when it goes stale instead. A column's
// own key is only ever ambiguous this way while a grace note only ever
// excuses, never holding a melody note back.
//
// Each hit also measures the column for the grade (rule 8 of the report):
// its latency, from the moment it became the head to the first of its own
// keys struck at it, which is what a hesitation is read from (so a column
// completed late by a key held instead of struck again, or by a slow roll,
// isn't one); how many of its keys were credited early (above) and held
// over (heldCredit, rule 1); and, in scroll mode, how long it stood on the
// hit line before it completed (late), which is recorded but never a miss:
// scroll mode scrolls to the line and waits (ruling D4(a)) — unless the
// trainer's "Keep tempo" setting is on (this.tempo, ruling D4(c)), when a
// column that scrolls past the line by TEMPO_TOLERANCE is missed instead of
// waited for (see scrollPast) and late runs unclamped from onLineSince,
// since the column may already have crossed the line before it became the
// head. See measured.
// A column settled by held credit (settleHeld, or settleCardEnd at the
// card's end) had none of its keys struck at it, so it has no time of its
// own: it is measured settled, with no latency, and the next column played
// is timed from when the column before it completed, so the wait lands on
// the column the player reached for. That carry stays within the card: a
// settled column that ends one carries nothing over, so the next card's
// first column is timed from the same moment as the pass it opens (see
// AttemptPass).

// W_early: how long a key of the next column may wait for the column under
// way to complete before it counts as a slip on it (ruling D2(a): about
// 250 ms to start with, to be revised from recorded playing)
export const EARLY_KEY_WINDOW = 250

// L: how long after a column completes striking one of its keys again is
// ignored rather than a slip (D2(a), as EARLY_KEY_WINDOW)
export const LATE_REPEAT_WINDOW = 250

// how long a key ambiguous between an ornament going on and a real strike
// (noteOn, settlePending) waits for what follows to decide it: a starting
// guess in the family of EARLY_KEY_WINDOW and LATE_REPEAT_WINDOW, to be
// revised from recorded playing. Trills slower than four notes a second read
// as separate strikes rather than one ornament going on
export const ORNAMENT_GAP = 250

export default class NoteMatcher {
  // notes is the NoteList the drill is playing (the matcher advances it);
  // opts are the options detection reads: the generator's mode ("notes" or
  // "chords") and anyOctave, whether the staff scrolls (scroll mode), tempo,
  // the "Keep tempo" setting (D4(c): see scrollPast), onEvent, told each
  // judgement as it is made, and now, the clock of the moments no event
  // times (a column becoming the head through a new list, Begin, a press
  // with no timeStamp, the staff coming to rest on the hit line):
  // performance.now by default, the clock MIDI events are stamped by
  constructor(notes, opts={}) {
    this.notes = notes || null
    this.mode = opts.mode || "notes"
    this.anyOctave = !!opts.anyOctave
    this.scroll = !!opts.scroll
    this.tempo = !!opts.tempo
    this.onEvent = opts.onEvent || null
    this.now = opts.now || (() => performance.now())

    // in scroll mode, since when the staff has stood with the head column on
    // the hit line, null while it moves (see onLine)
    this.onLineSince = null

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

    // the keys held for the card's last column as it completed with them
    // (see settleCardEnd), each excused the once when struck again, and no
    // longer once a key that isn't struck again goes down. They survive the
    // hits after it, not a list taken on afresh
    this.restrikes = {}

    // a key down ambiguous between an ornament going on and a real strike
    // (see noteOn): {note, at, target}, target "head" when the key is the
    // head's own, "next" when it is the next column's; settled by what
    // follows within ORNAMENT_GAP (settlePending) or the page's tick. Never
    // set without a timeStamp
    this.pending = null

    // T, the ornament keys carried on past the column just completed (see
    // hit): its own allowed and trailing pitches, plus its own keys a pending
    // resolution judged real (ambiguousOwn, below). Kept in play — excused,
    // never required, never a slip — at the column after it and, once
    // credited early, the one after that
    this.trailing = []

    // A, the subset of T that makes the new head's own keys ambiguous rather
    // than its ordinary strike (trailing(prev) and prev's own ambiguousOwn,
    // never prev's allowed: a grace note only ever excuses, so a melody note
    // repeating its pitch doesn't wait for one)
    this.headAmbiguous = []

    // the head's own keys a pending resolution judged real this tenure (see
    // settlePending), carried into trailing and headAmbiguous at the hit
    this.ambiguousOwn = {}

    // whether one of the head column's own keys has gone down at it, and
    // when the first of them did, for its spread: null when that press
    // carried no timeStamp (the on-screen keyboard)
    this.firstDown = false
    this.firstAt = null

    // when the head column became the head, and when the first of its own
    // keys went down (on the matcher's clock when the press had no
    // timeStamp), for its latency
    this.headAt = this.now()
    this.firstKeyAt = null

    // the note list a miss was last counted on (a column counts missed once
    // however many slips it takes), and whether the try in progress has
    // already counted a slip
    this.missedNotes = null
    this.slipped = false

    // the timeStamp of the last event fed in
    this.lastEventAt = null
  }

  // adopts a note list built elsewhere (a rebuilt drill, a column scrolled
  // past): the keys struck at the old head are dropped, so its new one is
  // played afresh from the next key down, however many keys are still down.
  // A key held over isn't counted against the new column, having been judged
  // on the column it was played on, and counts toward it only where the
  // score still sounds it there (held credit, applied lazily as ever)
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
  // still down left held (a skipped column), and timed from now: no key is
  // held early for the column after it, and no column just completed (nor
  // card's last column completed held, nor an ornament going on) is looked
  // back to
  clearTouched() {
    this.startHead(this.now())
    this.restrikes = {}
    this.pending = null
    this.trailing = []
    this.headAmbiguous = []
  }

  // a column became the head at time: nothing is struck at it yet
  startHead(time) {
    this.touched = {}
    this.strays = {}
    this.early = {}
    this.credited = []
    this.previous = null
    this.firstDown = false
    this.firstAt = null
    this.firstKeyAt = null
    this.headAt = time
    this.ambiguousOwn = {}
  }

  // In scroll mode the staff came to rest with the head column on the hit
  // line at time (the slider reached its floor), or moves again (null). A
  // column completed while the staff stands there was late by the time it
  // stood there as the head
  onLine(time) {
    this.onLineSince = time ?? null
  }

  // the stats started over, so the column under way may count a miss again
  forgetMisses() {
    this.missedNotes = null
  }

  // A key went down. Returns the result the page renders
  noteOn(note, timeStamp) {
    this.lastEventAt = timeStamp ?? null

    if (this.mode == "notes" && this.notes) {
      // a key pending from an earlier press is settled first, against this
      // one, at its own timeStamp: its events (a hit, a miss) reach the page
      // before this key's (see settlePending)
      this.settlePending(note, timeStamp)

      // an ornament the score writes (a grace note, or a note of a trill,
      // turn or mordent) played as written is allowed, excused independent
      // of the head (T7, redesigned): the key goes down, but nothing about
      // it is judged, unless it is ambiguous with a real column's own key,
      // which holds it pending instead (see classifyOrnamentKey)
      let ornament = this.classifyOrnamentKey(note, timeStamp)
      if (ornament == "head" || ornament == "next") {
        this.pending = {note, at: timeStamp, target: ornament}
        this.held = {...this.held, [note]: true}
        return this.result()
      }
      if (ornament == "excused") {
        this.held = {...this.held, [note]: true}
        return this.result()
      }
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

  // Classifies note at the head column, before anything else is judged about
  // it (noteOn): "head" or "next" when it is ambiguous and should be held
  // pending rather than judged now (see settlePending), "excused" when it is
  // an ornament key with nothing to judge, or null when it isn't an ornament
  // key at all, to carry on to the ordinary try/slip logic and judgePress.
  //
  // Ambiguous at the head means a key of the head's own, not yet touched,
  // that is in headAmbiguous (A): the previous column's trailing pitches and
  // its own keys a pending resolution judged real, never its allowed, so a
  // melody note repeating a grace note's pitch isn't held up by it. Ambiguous
  // for the next column means a key not the head's own, in the head's allowed
  // or T (the carried trailing set), that is the next column's own: struck
  // early for it (T5) once resolved, as credited(). Any other key in the
  // head's allowed or T is excused outright. Neither kind of ambiguity, nor
  // the excuse, applies to a press with no timeStamp (the on-screen
  // keyboard): at the head it is the head's own at once, excused as today
  classifyOrnamentKey(note, timeStamp) {
    let column = this.notes.currentColumn()
    let next = this.columnAt(1)
    let inHead = this.inColumn(column, note)

    if (inHead) {
      if (!this.touched[note] && timeStamp != null && this.inSet(this.headAmbiguous, note)) {
        return "head"
      }
      return null
    }

    let inPlay = this.inSet(column.allowed, note) || this.inSet(this.trailing, note)
    if (!inPlay) { return null }

    if (timeStamp != null && this.inColumn(next, note)) {
      return "next"
    }

    return "excused"
  }

  // whether note is one of the pitches of list (a column's allowed or
  // trailing, or the carried trailing set), by name
  inSet(list, note) {
    return !!list && list.some(n => this.notes.sameNote(note, n, this.anyOctave))
  }

  // whether note is one of the ornament pitches in play over the head: its
  // own allowed and trailing (column.allowed, column.trailing) and the
  // carried trailing set T. Used only to tell an ornament going on from a
  // real strike at settlePending; classifyOrnamentKey's own sets are narrower
  // (a column's own key, trailing only at its own column, never makes it an
  // ornament key here, since it is already handled by headAmbiguous there)
  inOrnamentPlay(note) {
    let column = this.notes.currentColumn()
    return this.inSet(column.allowed, note) || this.inSet(column.trailing, note) || this.inSet(this.trailing, note)
  }

  // A key pending from an earlier press (see noteOn) is settled against note,
  // this one, before it is itself judged: within ORNAMENT_GAP of the pending
  // key and itself an ornament key in play, the pending key was the ornament
  // going on, dropped with no strike and no slip; otherwise it was the real
  // strike, judged (or credited) at its own timeStamp, before this key's.
  //
  // A key pending for the head is required there, so what settles it has to
  // be an ornament still rolling from an earlier column (T): one the head's
  // own trill, turn or mordent sounds (its trailing) runs from the head's own
  // note, which the pending key was, so that key is the real strike. The
  // head's allowed decides nothing, since a grace leading into the head comes
  // before its note rather than out of it
  settlePending(note, timeStamp) {
    let pending = this.pending
    if (!pending) { return }

    let withinGap = timeStamp != null && timeStamp - pending.at <= ORNAMENT_GAP
    let ornamentOn = pending.target == "head"
      ? !this.inSet(this.notes.currentColumn().trailing, note) && this.inSet(this.trailing, note)
      : this.inOrnamentPlay(note)
    if (withinGap && ornamentOn) {
      this.pending = null
      return
    }

    this.resolvePending()
  }

  // the pending key was the real strike (settlePending, tick): judged at its
  // own timeStamp when it is the head's own (recorded as one of this head's
  // ambiguousOwn keys first, so the hit after it carries it on in T), or
  // credited early to the next column, as any T5 early key, when it is the
  // next column's: excused rather than required, so it slips only if the
  // head doesn't complete within EARLY_KEY_WINDOW of it, and is dropped
  // silently, never a slip, if it goes stale instead (expireEarly)
  resolvePending() {
    let pending = this.pending
    this.pending = null
    if (!pending) { return }

    if (pending.target == "head") {
      this.ambiguousOwn[pending.note] = true
      // struck at it, as noteOn marks any head's own key before judgePress
      this.touched = {...this.touched, [pending.note]: true}
      this.judgePress(pending.note, pending.at)
    } else {
      this.early = {...this.early, [pending.note]: {at: pending.at, kind: "excused"}}
    }
  }

  // how long until the pending key (if any) is settled by itself, were no
  // further key to decide it first (see tick)
  pendingUntil() {
    return this.pending ? this.pending.at + ORNAMENT_GAP : null
  }

  // The page's timer calls this once pendingUntil() has passed with no key
  // down to settle it first (ORNAMENT_GAP elapsed on a column ending on
  // ornament pitches alone, eg. a looping card's last column): resolves it as
  // the real strike and returns the result to render, or null, unchanged,
  // when there was nothing to resolve
  tick(time) {
    if (!this.pending || time < this.pending.at + ORNAMENT_GAP) { return null }
    this.resolvePending()
    return this.result()
  }

  // called on every key down in notes mode, with the event's timeStamp
  judgePress(note, timeStamp) {
    let notes = this.notes
    if (!notes) { return }

    // nothing to play (eg. an empty section): no key is a slip
    if (!notes.currentColumn().length) { return }

    this.expireEarly(timeStamp)

    // a key that isn't one struck again at all is the player moving on from
    // the card's last column: the keys held for it aren't excused any more
    if (!this.struckAgain(note, timeStamp)) {
      this.restrikes = {}
    }

    // a key down that is neither the head's own nor a key struck again is
    // the player moving on: the columns its held keys complete are done
    // first, and the key is judged at the one after
    if (!this.inColumn(notes.currentColumn(), note) && !this.struckAgain(note, timeStamp)) {
      let settled = this.notes
      this.settleHeld(note)
      notes = this.notes
      if (notes !== settled) {
        // struck at the head it was judged at
        this.touched = {...this.touched, [note]: true}
      }
      if (!notes.currentColumn().length) { return }
    }

    // rule 2: the head's own key, a key struck again (of the column just
    // completed, or held for the card's last column), a key of the next
    // column played early, or else a slip
    let slip = false
    let own = this.inColumn(notes.currentColumn(), note)
    if (own) {
      // the first of the column's own keys down starts its spread, which
      // the key down that completes the column ends, and the first struck
      // at it (a key credited early was struck before it was the head) ends
      // its latency
      if (!this.firstDown) {
        this.firstDown = true
        this.firstAt = timeStamp ?? null
      }
      if (this.firstKeyAt == null) {
        this.firstKeyAt = timeStamp ?? this.now()
      }
    } else if (this.struckAgain(note, timeStamp)) {
      // neither the head's nor a slip, and a key held for the card's last
      // column has spent its excuse on the one onset the score writes there
      this.spendRestrike(note)
    } else if (timeStamp != null && this.inColumn(this.columnAt(1), note)) {
      this.early = {...this.early, [note]: {at: timeStamp, kind: "required"}}
    } else if (timeStamp != null && this.inSet(this.columnAt(1).allowed, note)) {
      // the next column's own ornament, struck while this one is under way
      // (a leading hand's grace note, or a trill started early): buffered
      // early like a T5 key, but never credited, since it isn't the next
      // column's note (classifyOrnamentKey, resolvePending)
      this.early = {...this.early, [note]: {at: timeStamp, kind: "ornament"}}
    } else {
      this.strays = {...this.strays, [note]: true}
      slip = true
    }

    // only the head's own key can complete it: any other key down settled
    // what the keys held complete before it was judged
    let matched = own && this.completes()

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

    this.settleCardEnd()
  }

  // The head just became the card's last column with every key of it down,
  // struck early for it or held where the score still sounds it (rule 1):
  // it completes now. Held credit is otherwise lazy, but no key of the card
  // is left to go down after this column and settle it, so the card would
  // wait for a key struck again. Never a card's first column (nor a column
  // carrying no cardIndex), which only becomes the head as the lap or card
  // before it ends, so one key down never finishes a lap it doesn't play.
  //
  // The player may still strike a key held for it again at its own onset, as
  // the score writes it (D3(a)), which now comes after the card: each is
  // excused the once (see struckAgain, spendRestrike), however late, where
  // LATE_REPEAT_WINDOW would call it a slip on what follows (or hold it early
  // for the column after the head, which it isn't). The next lap or card
  // starting on the key can't tell that from its own: the key plays it, and
  // stays excused struck once more for it. Any settled hit that completes a
  // card's last column records the excuse (see hit), so the settling of a
  // held column reaching the card's end records it too. Like any settled
  // column it has no time of its own, and ending the card, carries none over
  settleCardEnd() {
    let column = this.notes.currentColumn()
    if (!column.length || !column.cardIndex || !this.lastOfCard()) { return }

    if (!this.heldCredit().length || !this.completes()) { return }

    this.hit(null, {settled: true})
  }

  // The head column is complete, its last required key down at completedAt
  // (null when every key of it was held): it moves on, and the keys held
  // early for the next column are credited to it, completing it too if they
  // are all of it (rule 3), never by the credit it holds, which stays lazy.
  // settled when held credit completed it with none of its own keys struck
  // at it (see settleHeld, settleCardEnd): the next column of its card is
  // timed as if it weren't there
  hit(completedAt, {settled=false}={}) {
    let notes = this.notes
    let column = notes.currentColumn()
    let touched = Object.keys(this.touched)
    let held = this.heldCredit()

    // a settled column's wait carries only to the next column of its own
    // card: the card it ends keeps nothing back for the one after it, but
    // excuses the keys it credits held struck again at the onset the score
    // writes there, which comes after the card (see settleCardEnd)
    let last = this.lastOfCard()
    let carry = settled && !last
    let excused = settled && last && held.length ? held : null

    // the moment the column completed, on the clock the measurements share:
    // the key that completed it carried no timeStamp (the on-screen
    // keyboard) when completedAt is null
    let at = completedAt ?? this.now()

    // from the first of the column's keys down to the last, which completed
    // it: null when either press came with no timeStamp (the on-screen
    // keyboard), as their distance apart isn't known
    let spread = this.firstAt != null && completedAt != null
      ? completedAt - this.firstAt
      : null
    let measured = {spread, ...this.measured(at, held), settled}

    let event = {
      type: "hit",
      // the keys the stats credit the column with: the column's own, struck
      // or held
      hitNotes: [...touched.filter(n => this.inColumn(column, n)), ...held],
      // the list as it was, for the width the staff slides by
      from: notes,
      // a slip's shake plays out over the next column
      stray: Object.keys(this.strays).length > 0,
      // the column's keys that were struck before it was the head, which
      // measured counts as its early
      credited: this.credited,
      // the column's keys the score still sounds that were held rather than
      // struck again (rule 1), which measured counts as its heldCredit
      heldCredited: held,
      // what the grade reads on the column, as it went with it (see measured)
      ...measured,
    }

    let early = this.early
    this.slipped = false
    let advanced = notes.clone()
    // the measurements go with the column as it is removed, so the generator
    // has them the moment it is told the column is done, before it grades
    // the pass they finish (see NoteList#shift)
    advanced.shift(measured)
    advanced.pushRandom()
    this.notes = advanced

    // T, carried on past this column (T7, redesigned): its own allowed and
    // trailing pitches, plus its own keys a pending resolution judged real
    // this tenure (ambiguousOwn). headAmbiguous (A), the subset that makes
    // the new head's own keys ambiguous, leaves out allowed: a grace note
    // only ever excuses, never holding a melody note back
    let ambiguousOwn = Object.keys(this.ambiguousOwn)
    let trailingOf = column.trailing || []
    this.trailing = [...(column.allowed || []), ...trailingOf, ...ambiguousOwn]
    this.headAmbiguous = [...trailingOf, ...ambiguousOwn]

    // the next column is played afresh, but for its keys struck early: the
    // keys still down stay held, and count toward it only as held credit,
    // lazily, where the score still sounds them. After a settled column of
    // the same card it is timed from when the settled one became the head,
    // as nothing of that wait was spent on the column settled
    let previous = this.previous
    this.startHead(carry ? this.headAt : at)

    // a column completed with no key of its own down has no key down for a
    // key struck again to be excused against, so the column that has stands
    this.previous = completedAt == null ? previous : {column, at: completedAt}
    if (excused) {
      this.restrikes = Object.fromEntries(excused.map(n => [n, true]))
    }

    // an ornament key (kind "ornament") is never credited, since it isn't
    // really the next column's note; an excused key (a pending key resolved
    // for the next column, kind "excused") is, exactly as a plain early key
    // (kind "required") is, both filtered to the next column's own already
    let next = advanced.currentColumn()
    let credited = Object.keys(early).filter(n => early[n].kind != "ornament" && this.inColumn(next, n))
    for (let n of credited) {
      this.touched[n] = true
      this.firstDown = true
      this.firstAt = this.firstAt == null ? early[n].at : Math.min(this.firstAt, early[n].at)
    }
    this.credited = credited

    // the list as it now stands, before any column the keys credited early
    // complete in turn
    event.to = advanced
    this.emit(event)

    if (credited.length && advanced.matchesHead(credited, this.anyOctave)) {
      this.hit(Math.max(...credited.map(n => early[n].at)))
    }
  }

  // Tempo mode (D4(c)): the head column has scrolled past the hit line by
  // TEMPO_TOLERANCE. A column the held keys already complete (rule 1) is a
  // hit instead, exactly as a key down would settle it (settleHeld), since
  // held credit is otherwise only applied lazily at a key down, which a
  // column scrolling past unplayed never sees. Otherwise, when the column
  // has notes and miss is set (false at rest, as the page's old loop
  // checked the session), it counts one miss, "miss" when the column
  // hasn't been counted missed yet, else "slip" (even within the try that
  // already slipped: the scroll-past isn't a try, and the grade must always
  // hear it), blamed on its notes not yet struck. Either way the column
  // then advances exactly as a hit does but for the hit itself: cleared
  // with nothing measured, the keys held early for the next column credited
  // to it as before, chaining a hit when they complete it — all but the
  // ones the head took longer than EARLY_KEY_WINDOW to scroll past, which
  // are dropped uncredited (dropStaleEarly), as rule 2.4 drops them at a
  // key down, counting no miss beyond the scroll-past's own. The column it
  // took away is the one looked back to (previous, at the scroll-past), so
  // rule 2.3 excuses the note the player was still reading struck just after
  // it went by rather than slipping the column that took over: one miss for
  // the one late note. Emits "scrolled"
  // after the miss (if any) and before any chained hit, so the miss reaches
  // the stats, and through them the generator's columnDone, before the
  // shift below calls it
  scrollPast(time, {miss=true}={}) {
    this.dropStaleEarly(time)

    let notes = this.notes
    let column = notes.currentColumn()

    if (this.heldCredit().length && this.completes()) {
      this.hit(null, {settled: true})
      return this.result()
    }

    if (column.length && miss) {
      let blamed = this.blamedForHead()
      let counted = this.missedNotes == notes ? "slip" : "miss"
      this.missedNotes = notes
      this.emit({type: "miss", missed: column, blamed, counted, notes})
    }

    let early = this.early
    this.slipped = false
    let advanced = notes.clone()
    advanced.shift()
    advanced.pushRandom()
    this.notes = advanced

    this.startHead(time)
    this.previous = {column, at: time}
    this.restrikes = {}

    let next = advanced.currentColumn()
    let credited = Object.keys(early).filter(n => this.inColumn(next, n))
    for (let n of credited) {
      this.touched[n] = true
      this.firstDown = true
      this.firstAt = this.firstAt == null ? early[n] : Math.min(this.firstAt, early[n])
    }
    this.credited = credited

    this.emit({type: "scrolled", from: notes, to: advanced})

    if (credited.length && advanced.matchesHead(credited, this.anyOctave)) {
      this.hit(Math.max(...credited.map(n => early[n])))
    }

    return this.result()
  }

  // The head column's keys the score still sounds at its onset from an
  // earlier one (column.sustained) that are down but weren't struck at it
  heldCredit() {
    let column = this.notes.currentColumn()
    let sustained = column.sustained || []
    if (!sustained.length) { return [] }

    return Object.keys(this.held).filter(n => !this.touched[n] &&
      sustained.some(s => this.notes.sameNote(n, s, this.anyOctave)))
  }

  // whether every key of the head column has gone down at it, or is held
  // on where the score still sounds it (rule 1)
  completes() {
    return this.notes.matchesHead([...Object.keys(this.touched), ...this.heldCredit()], this.anyOctave)
  }

  // Held credit applied lazily, at a key down that isn't the head's own:
  // each head its held keys complete is hit in turn, settled, with none of
  // its own keys struck to time it, up to the head the key belongs to. It
  // stops at the end of the card (lastOfCard), so a looping card whose held
  // key sounds through it credits the lap under way and not the laps after
  // it. A card's cardIndex climbs to its last column, which ends the
  // settling, so the loop always runs out.
  //
  // A card's first column is settled only by a key of that card: a key held
  // through the card or lap before it is credited when the player plays the
  // card (the Rêverie's bar 3 beat 6, sounding on from bar 2), and never by a
  // key of neither, which would let one key down credit a lap unplayed
  settleHeld(note) {
    while (true) {
      let column = this.notes.currentColumn()
      if (!column.length || this.inColumn(column, note)) { return }
      if (!this.heldCredit().length || !this.completes()) { return }
      if (column.cardIndex == 0 && !this.inCard(note)) { return }

      let last = this.lastOfCard()
      this.hit(null, {settled: true})
      if (last) { return }
    }
  }

  // Whether the column at idx of the list (the head by default) is the last
  // of the card it belongs to: the column after it is empty (the gap between
  // cards, the end of the run) or starts the next lap or card, its cardIndex
  // no greater than its own. A column carrying no cardIndex is its own
  // card's last
  lastOfCard(idx=0) {
    let next = this.columnAt(idx + 1)
    if (!next.length) { return true }

    let column = this.columnAt(idx)
    return column.cardIndex == null || next.cardIndex == null ||
      next.cardIndex <= column.cardIndex
  }

  // whether a key is one of the columns of the card the head begins, up to
  // its last (lastOfCard): the card the player is playing once they do
  inCard(note) {
    for (let idx = 0; this.columnAt(idx).length; idx++) {
      if (this.inColumn(this.columnAt(idx), note)) { return true }
      if (this.lastOfCard(idx)) { return false }
    }

    return false
  }

  // Keys held early for the next column that the head hasn't completed
  // within EARLY_KEY_WINDOW of, at a key down at timeStamp, were wrong: they
  // count as one slip on the head, and aren't credited to the next column.
  // An excused key (kind "excused": a pending key resolved for the next
  // column, see resolvePending) is never one of them, dropped silently
  // instead, since it was never really a slip to begin with
  expireEarly(timeStamp) {
    let stale = this.staleEarly(timeStamp)
    if (!stale.length) { return }

    this.early = {...this.early}
    let slipped = []
    for (let n of stale) {
      if (this.early[n].kind != "excused") { slipped.push(n) }
      delete this.early[n]
    }
    if (!slipped.length) { return }

    this.strays = {...this.strays}
    for (let n of slipped) {
      this.strays[n] = true
    }

    this.emitMiss()
  }

  // The same stale keys, dropped uncredited as the head scrolls past at
  // time (D4(c)): they are never credited to the next column either, but
  // the scroll-past counts the head's one miss, so they add no second one
  dropStaleEarly(time) {
    let stale = this.staleEarly(time)
    if (!stale.length) { return }

    this.early = {...this.early}
    for (let n of stale) {
      delete this.early[n]
    }
  }

  // the keys held early for the next column that the head still hasn't
  // completed at time, EARLY_KEY_WINDOW on from each of them
  staleEarly(time) {
    return Object.keys(this.early).filter(n =>
      time == null || time - this.early[n].at > EARLY_KEY_WINDOW)
  }

  // whether a key down is one struck again rather than played: one of the
  // column the head just moved on from (repeated), or held for the card's
  // last column as it completed (see settleCardEnd)
  struckAgain(note, timeStamp) {
    return !!this.restrikes[note] || this.repeated(note, timeStamp)
  }

  // a key held for the card's last column has been struck again, for the one
  // onset the score writes there: it is excused no further, so striking that
  // pitch again is a slip on what follows as any other key is
  spendRestrike(note) {
    if (!this.restrikes[note]) { return }

    this.restrikes = {...this.restrikes}
    delete this.restrikes[note]
  }

  // whether a key is one of the column the head has just moved on from,
  // struck again within LATE_REPEAT_WINDOW of its going (rule 2.3)
  repeated(note, timeStamp) {
    let previous = this.previous
    return !!previous && previous.at != null && timeStamp != null &&
      timeStamp - previous.at <= LATE_REPEAT_WINDOW &&
      this.inColumn(previous.column, note)
  }

  // counts a slip on the head column, blamed on its notes from the keys
  // struck at it that are its own or slipped, and the keys it credits held:
  // a note the column already has is never one the miss is put down to
  emitMiss() {
    this.emit(this.missColumn(this.notes.currentColumn(), this.blamedForHead()))
  }

  // the head column's notes a miss on it is put down to (see emitMiss): the
  // one rule, shared with the scroll-past's forced miss
  blamedForHead() {
    let notes = this.notes
    let column = notes.currentColumn()
    let struck = [
      ...Object.keys(this.touched).filter(n => this.strays[n] || this.inColumn(column, n)),
      ...this.heldCredit(),
    ]
    return notes.blamedNotes(struck, this.anyOctave)
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

  // From the head column becoming the head to the first of its own keys
  // down, null until one of them is (a wrong key first doesn't end it)
  headLatency() {
    return this.firstKeyAt != null ? Math.max(0, this.firstKeyAt - this.headAt) : null
  }

  // In scroll mode, how long the head column has stood on the hit line as
  // the head at time (0 while it is still on its way there), null in wait
  // mode. Never a miss in D4(a); in tempo mode (D4(c), this.tempo) measured
  // with no headAt clamp, since a column that became the head after it had
  // already crossed the line (the column before it was hit late) is late
  // from its own crossing, not from when it became the head
  headOnLine(time) {
    if (!this.scroll) { return null }
    if (this.onLineSince == null) { return 0 }
    let since = this.tempo ? this.onLineSince : Math.max(this.onLineSince, this.headAt)
    return Math.max(0, time - since)
  }

  // The head column's measurements for the grade, as the key down at time
  // completes it: its latency and how late it was on the hit line, plus
  // early, how many of its keys were credited from presses made before it
  // was the head (see hit), and heldCredit, how many of the held keys the
  // score still sounds it counted (rule 1)
  // hit adds settled, whether held credit completed it with none of its keys
  // struck at it (see settleHeld, settleCardEnd), which gives it no time of
  // its own
  measured(time, held) {
    return {
      latency: this.headLatency(),
      early: this.credited.length,
      heldCredit: held.length,
      late: this.headOnLine(time),
    }
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

  // The head column as it stands, for the developer metrics panel to show
  // while it is played, judging nothing: how long it has been the head and
  // its latency once one of its own keys went down (ms on the matcher's
  // clock, see measured), the keys struck at it and down, the keys held
  // early for the next column and those credited to it early, and in scroll
  // mode how long it has stood on the hit line
  inspect() {
    let now = this.now()
    return {
      waiting: Math.max(0, now - this.headAt),
      latency: this.headLatency(),
      touched: Object.keys(this.touched),
      held: Object.keys(this.held),
      early: Object.keys(this.early),
      credited: [...this.credited],
      onLine: this.headOnLine(now),
    }
  }
}
