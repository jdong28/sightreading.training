// Measure flashcards for the sheet music generator: the measures of a piece
// section (the pool, the score's own bar numbers) are grouped into cards of
// any number of measures, and the staff shows one card at a time, in order or
// picked at random weighted toward the weakest measures.
//
// Each pass through a card is collected as an attempt (st/srs/attempt): when
// it is done it is graded and written to the local store (st/storage) as a
// review of every measure of the card (and of the card's range), adding its
// hits, misses and time to their items and scheduling each measure's item
// (st/srs/schedule). The random picks favour the measures whose recall the
// scheduler predicts lowest and those missed lately (practiceWeight).

import {addNoteListener} from "st/note_stats"
import {getAppStore} from "st/storage"
import {AttemptPass, passAttempts, passPractice, columnClefs} from "st/srs/attempt"
import {practiceWeight} from "st/srs/schedule"

export const IN_ORDER = "in order"
export const RANDOM_ORDER = "random"

/**
 * The notes of one measure of the pool.
 * @typedef {Object} PoolMeasure
 * @property {number} number the score's bar number
 * @property {string[][]} columns each may carry the score's onsets and
 * notation (see extractSectionColumns in st/song_sections)
 */

/**
 * @typedef {Object} MeasureCard
 * @property {number} startMeasure
 * @property {number} endMeasure
 * @property {number[]} measures bar numbers, in order
 * @property {string[][]} columns the columns of every measure, in order
 * @property {number[]} columnMeasures index into measures for each column
 */

/**
 * Groups the pool into cards of perCard contiguous measures, the last card
 * shorter when the pool doesn't divide evenly.
 * @param {PoolMeasure[]} measures
 * @param {number} perCard
 * @returns {MeasureCard[]}
 */
export function measureCards(measures, perCard) {
  let size = Math.max(1, Math.floor(perCard) || 1)
  let cards = []

  for (let i = 0; i < measures.length; i += size) {
    cards.push(sectionCard(measures.slice(i, i + size)))
  }

  return cards
}

/**
 * One card of all the given measures, eg. the whole section drill.
 * @param {PoolMeasure[]} measures at least one
 * @returns {MeasureCard}
 */
export function sectionCard(measures) {
  let columns = []
  let columnMeasures = []

  measures.forEach((measure, idx) => {
    for (let column of measure.columns) {
      columns.push(column)
      columnMeasures.push(idx)
    }
  })

  return {
    startMeasure: measures[0].number,
    endMeasure: measures[measures.length - 1].number,
    measures: measures.map(measure => measure.number),
    columns,
    columnMeasures,
  }
}

// what a copy of a column keeps for an engine's card to join it to the heads
// it drew (see joinCard in st/score_render/card_join): the column's onset and
// the score's notation of its notes and of the heads its ties run on to
export const COLUMN_JOIN_KEYS = ["beat", "notation", "extras"]

/**
 * A copy of the card's column for the drill, keeping what an engine's card
 * joins it by (see COLUMN_JOIN_KEYS), and `cardIndex`, idx, which of the
 * card's columns it is, so the page can mark it on a card an engine drew
 * (st/score_render)
 * @param {MeasureCard} card
 * @param {number} idx
 * @returns {string[]}
 */
export function cardColumn(card, idx) {
  let source = card.columns[idx]
  let column = [...source]

  for (let key of COLUMN_JOIN_KEYS) {
    if (source[key] != null) {
      column[key] = source[key]
    }
  }

  column.cardIndex = idx
  return column
}

/**
 * Every column of the card, as the drill plays them.
 * @param {MeasureCard} card
 * @returns {string[][]}
 */
export function cardColumns(card) {
  return card.columns.map((column, idx) => cardColumn(card, idx))
}

/**
 * The weight of each card in random picks, weakest first: the mean
 * practiceWeight (st/srs/schedule) of its measures' items under the hand
 * setting, a measure never graded weighing as UNSCHEDULED_RECALL.
 * @param {MeasureCard[]} cards
 * @param {ItemRecord[]} items the piece's items
 * @param {Object} [opts]
 * @param {string} [opts.hand] the hand setting the cards are played in
 * @param {number} [opts.now]
 * @param {SchedulerSettings} [opts.settings]
 * @returns {number[]}
 */
export function cardWeights(cards, items, {hand="both", now=Date.now(), settings}={}) {
  let byMeasure = new Map()
  for (let item of items) {
    if (item.hand == hand && item.startMeasure == item.endMeasure && !item.beats) {
      byMeasure.set(item.startMeasure, item)
    }
  }

  return cards.map(card => {
    let total = card.measures.reduce((sum, n) =>
      sum + practiceWeight(byMeasure.get(n) || null, now, settings), 0)
    return total / card.measures.length
  })
}

/**
 * Picks the card after previous (null for the first card). Only cards with
 * notes are picked. In order walks the cards and wraps; random picks by
 * weight, never previous when another card can be picked.
 * @param {MeasureCard[]} cards
 * @param {number|null} previous
 * @param {Object} opts
 * @param {string} opts.order IN_ORDER or RANDOM_ORDER
 * @param {number[]} [opts.weights] per card, uniform when left out
 * @param {function(): number} [opts.random] returns [0, 1)
 * @returns {number|null} null when no card has notes
 */
export function nextCardIndex(cards, previous, {order, weights, random=Math.random}) {
  let playable = cards.map((card, idx) => idx).filter(idx => cards[idx].columns.length)
  if (!playable.length) {
    return null
  }

  if (order != RANDOM_ORDER) {
    return previous == null ? playable[0] :
      playable.find(idx => idx > previous) ?? playable[0]
  }

  let candidates = playable.length > 1 ? playable.filter(idx => idx != previous) : playable
  let weightOf = idx => weights ? Math.max(0, weights[idx]) : 1
  let total = candidates.reduce((sum, idx) => sum + weightOf(idx), 0)

  if (!(total > 0)) {
    return candidates[Math.floor(random() * candidates.length) % candidates.length]
  }

  let r = random() * total
  for (let idx of candidates) {
    r -= weightOf(idx)
    if (r < 0) {
      return idx
    }
  }

  return candidates[candidates.length - 1]
}

// The cards of a piece section and the one being shown, kept while the
// section settings stay the same so the drill carries on when the staff
// is rebuilt (eg. a new key signature)
export class MeasureCardDeck {
  /**
   * @param {MeasureCard[]} cards
   * @param {Object} opts
   * @param {string} opts.pieceId
   * @param {string} [opts.hand] the hand setting the cards are played in,
   * one of HANDS (st/srs/records)
   * @param {string} opts.order
   * @param {function(): number} [opts.random]
   * @param {function(): number} [opts.now]
   * @param {LocalStore} [opts.store] where the measures' items are read, the app's store by default
   */
  constructor(cards, {pieceId, hand="both", order, random=Math.random, now=Date.now, store}) {
    this.cards = cards
    this.pieceId = pieceId
    this.hand = hand
    this.order = order
    this.random = random
    this.now = now
    this.store = store

    this.index = null
    this.advance()
  }

  getStore() {
    return this.store || getAppStore()
  }

  /** @returns {boolean} whether any card has notes */
  get playable() {
    return this.index != null
  }

  /** @returns {number} how many cards have notes */
  get playableCount() {
    return this.cards.filter(card => card.columns.length).length
  }

  /** @returns {MeasureCard|null} the card being shown */
  get card() {
    return this.index == null ? null : this.cards[this.index]
  }

  /** Moves on to the next card */
  advance() {
    let store = this.getStore()
    let weights = this.order == RANDOM_ORDER ? cardWeights(this.cards, store.items(this.pieceId), {
      hand: this.hand, now: this.now(), settings: store.schedulerSettings(),
    }) : null

    this.index = nextCardIndex(this.cards, this.index, {
      order: this.order, weights, random: this.random,
    })
  }
}

// the generator whose columns are on the staff, told about hits and misses
let playing = null
let listening = false

// Shows the deck's cards on the staff one at a time. The card's columns are
// followed by empty columns until its last column is done, then the columns
// still to come are replaced by the next card's. A deck with a single card
// loops it without the gap, like the plain sheet music drill.
//
// Each pass through the card (each lap of a looping one) is an attempt: the
// page tells the generator the drill it is played in (setDrill) and takes
// the practice of a pass it abandons (takePractice)
export class MeasureCardGenerator {
  /**
   * @param {MeasureCardDeck} deck
   * @param {Object} [opts]
   * @param {function(): number} [opts.now]
   */
  constructor(deck, {now=Date.now}={}) {
    this.deck = deck
    this.now = now
    this.loop = deck.playableCount <= 1
    this.drill = () => ({mode: "wait"})

    this.startCard()

    playing = this
    if (!listening) {
      addNoteListener(event => playing && playing.notePlayed(event))
      listening = true
    }
  }

  // stops counting notes for this generator
  stop() {
    if (playing == this) {
      playing = null
    }
  }

  /**
   * @param {function(): {mode: string, speed?: number}} drill the drill
   * being played, "wait" or "scroll" mode at a scroll speed, which each
   * attempt is graded and stored by
   */
  setDrill(drill) {
    this.drill = drill
  }

  startCard(time=null) {
    let card = this.deck.card
    this.emitted = 0 // columns handed out for the card
    this.pass = card ? new AttemptPass(card, {startedAt: time}) : null
  }

  nextNote() {
    let card = this.deck.card
    if (!card) {
      return []
    }

    // the first card is timed from when it is shown
    if (this.pass.columnStartedAt == null) {
      this.pass.restart(this.now())
    }

    let columns = card.columns
    if (this.loop) {
      return cardColumn(card, this.emitted++ % columns.length)
    }

    return this.emitted < columns.length ? cardColumn(card, this.emitted++) : []
  }

  /** @returns {MeasureCard|null} the card at the head of the staff */
  currentCard() {
    return this.deck.card
  }

  /**
   * @returns {number|null} the card's position in the deck, from 1, or null
   * for a deck with a single card, looped like the whole section
   */
  currentCardNumber() {
    return this.loop || this.deck.index == null ? null : this.deck.index + 1
  }

  /** @returns {MeasureCard[]} every card the staff may show */
  get cards() {
    return this.deck.cards
  }

  // the pass being played, told the drill it is played in
  playedPass() {
    if (!this.pass.drill) {
      this.pass.drill = this.drill()
    }
    return this.pass
  }

  // called by NoteList#shift with the list the column was removed from
  columnDone(column, list) {
    let card = this.deck.card
    if (!card) { return }

    let time = this.now()
    let pass = this.playedPass()

    // the hit is counted after the column is removed, see notePlayed
    this.lastDone = {pass, index: pass.done(time)}

    if (!pass.complete) {
      return
    }

    this.finishPass(pass)

    if (this.loop) {
      this.pass = new AttemptPass(card, {startedAt: time})
      return
    }

    this.deck.advance()
    this.startCard(time)

    // the columns after the finished card are the gap, show the next card
    if (list) {
      let count = list.length
      list.length = 0
      for (let i = 0; i < count; i++) {
        list.push(this.nextNote())
      }
    }
  }

  notePlayed({type, notes=[], blamed=notes, stats}) {
    if (!this.deck.card) { return }

    if (stats) {
      this.sessionId = stats.id
    }

    if (type == "hit") {
      // a hit is counted right after its column is done
      let done = this.lastDone
      if (done) {
        done.pass.hit(done.index)
        let column = done.pass.card.columns[done.index]
        if (stats) { stats.countClefs(columnClefs(column), "hit") }
        this.lastDone = null
      }
    } else if (type == "miss" || type == "slip") {
      let pass = this.playedPass()
      pass.miss(blamed, {counted: type == "miss", time: this.now()})
      if (type == "miss" && stats) {
        stats.countClefs(columnClefs(pass.card.columns[pass.head], blamed), "miss")
      }
      this.lastDone = null
    }
  }

  /**
   * Abandons the pass being played, eg. at Rest or when the page is left, so
   * it is never graded: returns the practice on it so far, for the page to
   * add to the items' totals (see recordSectionPractice in st/storage), and
   * collects the rest of the card as practice alone. A pass not played yet
   * is kept, timed afresh from now.
   * @returns {Object[]} section practice, one per measure range
   */
  takePractice() {
    let pass = this.pass
    if (!pass) { return [] }

    let time = this.now()
    if (!pass.touched) {
      pass.restart(time)
      return []
    }

    this.pass = new AttemptPass(pass.card, {from: pass.head, continued: true, startedAt: time})
    this.lastDone = null
    return passPractice(pass, {pieceId: this.deck.pieceId, hand: this.deck.hand})
  }

  // Writes the pass to the store once the hit for its last column has been
  // counted, which happens in the same task: its attempts when it is graded,
  // else its practice
  finishPass(pass) {
    // a pass played partly in the other mode isn't graded in either
    if (this.drill().mode != pass.drill.mode) {
      pass.continued = true
    }

    // reviews are keyed by item and time, so two passes are never written at
    // the same millisecond
    let at = Math.max(pass.lastAt ?? this.now(), (this.writtenAt ?? -Infinity) + 1)
    this.writtenAt = at

    let finished = Promise.resolve().then(() => {
      let store = this.deck.getStore()
      let opts = {pieceId: this.deck.pieceId, hand: this.deck.hand, sessionId: this.sessionId, at}
      let attempts = passAttempts(pass, opts)

      if (attempts.length) {
        return Promise.all(attempts.map(({id, build}) =>
          store.recordAttempt(stored => build(stored.item(id)))))
      }

      return Promise.all(passPractice(pass, opts).map(practice =>
        store.recordSectionPractice(practice)))
    }).catch(err => console.warn("Couldn't save the attempt", err))

    this.finishing = Promise.all([this.finishing, finished])
  }
}
