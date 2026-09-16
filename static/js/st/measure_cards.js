// Measure flashcards for the sheet music generator: the measures of a piece
// section (the pool, the score's own bar numbers) are grouped into cards of a
// few measures each, and the staff shows one card at a time, in order or
// picked at random weighted toward the measures played worst.
//
// While a card is played the hits, misses and time on each of its measures
// are counted, and when it is done they are added to the section stats of the
// local store (st/storage) under that single measure, which is what weights
// the random picks.

import NoteStats, {addNoteListener} from "st/note_stats"
import {getAppStore} from "st/storage"

export const IN_ORDER = "in order"
export const RANDOM_ORDER = "random"

export const MAX_MEASURES_PER_CARD = 8

/**
 * The notes of one measure of the pool.
 * @typedef {Object} PoolMeasure
 * @property {number} number the score's bar number
 * @property {string[][]} columns each may carry `staves`, the grand staff
 * of each of its notes, and `clefs`, the clef sign of each staff at its onset
 * (see extractSectionColumns in st/song_sections)
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
  let size = Math.min(MAX_MEASURES_PER_CARD, Math.max(1, Math.floor(perCard) || 1))
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

/**
 * A copy of the card's column for the staff. When the card has more than
 * one measure, the first column of each measure carries its bar number as
 * `measure`, where the staff draws a bar line. The grand staff of its notes
 * are kept as `staves`, and the clefs at its onset as `clefs`, for a staff
 * that draws them on the score's staves (st/components/staves)
 * @param {MeasureCard} card
 * @param {number} idx
 * @returns {string[]}
 */
export function cardColumn(card, idx) {
  let source = card.columns[idx]
  let column = [...source]
  let measureIdx = card.columnMeasures[idx]

  if (source.staves) {
    column.staves = source.staves
    column.clefs = source.clefs
  }

  if (card.measures.length > 1 && (idx == 0 || card.columnMeasures[idx - 1] != measureIdx)) {
    column.measure = card.measures[measureIdx]
  }

  return column
}

/**
 * Every column of the card, as the staff draws them.
 * @param {MeasureCard} card
 * @returns {string[][]}
 */
export function cardColumns(card) {
  return card.columns.map((column, idx) => cardColumn(card, idx))
}

/**
 * Every column a drill of the card draws: a looping card's columns are
 * followed by its first column again, where the loop wraps back to it.
 * @param {MeasureCard} card
 * @param {Object} [opts]
 * @param {boolean} [opts.loop]
 * @returns {string[][]}
 */
export function drillColumns(card, {loop=false}={}) {
  let columns = cardColumns(card)
  return loop && columns.length ? [...columns, columns[0]] : columns
}

/**
 * How much a measure is favored by random picks, from its single measure
 * section stats: 1 when never missed, growing with the misses per hit.
 * @param {{hits: number, misses: number}} [stats]
 * @returns {number}
 */
export function measureWeight(stats) {
  return stats ? 1 + stats.misses / (stats.hits + 1) : 1
}

/**
 * The weight of each card, the mean weight of its measures.
 * @param {MeasureCard[]} cards
 * @param {Object[]} sectionStats section stats records of the piece
 * @returns {number[]}
 */
export function cardWeights(cards, sectionStats) {
  let byMeasure = new Map()
  for (let stats of sectionStats) {
    if (stats.startMeasure == stats.endMeasure) {
      byMeasure.set(stats.startMeasure, stats)
    }
  }

  return cards.map(card => {
    let total = card.measures.reduce((sum, n) => sum + measureWeight(byMeasure.get(n)), 0)
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
   * @param {string} opts.order
   * @param {function(): number} [opts.random]
   * @param {LocalStore} [opts.store] where the measure stats are read, the app's store by default
   */
  constructor(cards, {pieceId, order, random=Math.random, store}) {
    this.cards = cards
    this.pieceId = pieceId
    this.order = order
    this.random = random
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
    let weights = this.order == RANDOM_ORDER ?
      cardWeights(this.cards, this.getStore().sectionStats(this.pieceId)) : null

    this.index = nextCardIndex(this.cards, this.index, {
      order: this.order, weights, random: this.random,
    })
  }
}

// the generator whose columns are on the staff, told about hits and misses
let playing = null
let listening = false

// time on one column longer than this is a pause and isn't counted
const MAX_COLUMN_MS = NoteStats.TIMER_SIZE

// Shows the deck's cards on the staff one at a time. The card's columns are
// followed by empty columns until its last column is done, then the columns
// still to come are replaced by the next card's. A deck with a single card
// loops it without the gap, like the plain sheet music drill.
export class MeasureCardGenerator {
  /**
   * @param {MeasureCardDeck} deck
   * @param {Object} [opts]
   * @param {boolean} [opts.recordNotes] false records only the time on the
   * measures, eg. when the section is a single measure whose hits and misses
   * the page already records
   * @param {function(): number} [opts.now]
   */
  constructor(deck, {recordNotes=true, now=Date.now}={}) {
    this.deck = deck
    this.recordNotes = recordNotes
    this.now = now
    this.loop = deck.playableCount <= 1

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

  startCard() {
    let card = this.deck.card
    this.emitted = 0 // columns handed out for the card
    this.done = 0 // columns of the card the player is done with
    this.tally = card ? card.measures.map(() => ({hits: 0, misses: 0, elapsedMs: 0})) : []
  }

  nextNote() {
    let card = this.deck.card
    if (!card) {
      return []
    }

    if (this.columnStartedAt == null) {
      this.columnStartedAt = this.now()
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

  // the measure tally of the column at the head of the staff
  headTally() {
    let card = this.deck.card
    let idx = this.done % card.columns.length
    return this.tally[card.columnMeasures[idx]]
  }

  // called by NoteList#shift with the list the column was removed from
  columnDone(column, list) {
    let card = this.deck.card
    if (!card) { return }

    let time = this.now()
    let tally = this.headTally()

    let elapsed = Math.max(0, time - this.columnStartedAt)
    if (elapsed < MAX_COLUMN_MS) {
      tally.elapsedMs += elapsed
    }
    this.columnStartedAt = time

    // the hit is counted after the column is removed, see notePlayed
    this.lastDone = tally
    this.done += 1

    if (this.loop) {
      if (this.done % card.columns.length == 0) {
        this.finishCard(card)
        this.tally = card.measures.map(() => ({hits: 0, misses: 0, elapsedMs: 0}))
      }
      return
    }

    if (this.done < card.columns.length) {
      return
    }

    this.finishCard(card)
    this.deck.advance()
    this.startCard()

    // the columns after the finished card are the gap, show the next card
    if (list) {
      let count = list.length
      list.length = 0
      for (let i = 0; i < count; i++) {
        list.push(this.nextNote())
      }
    }
  }

  notePlayed({type}) {
    if (!this.deck.card) { return }

    if (type == "hit") {
      // a hit is counted right after its column is done
      if (this.lastDone) {
        this.lastDone.hits += 1
        this.lastDone = null
      }
    } else if (type == "miss") {
      this.headTally().misses += 1
      this.lastDone = null
    }
  }

  // Adds the card's measure tallies to the store once the hit for its last
  // column has been counted, which happens in the same task
  finishCard(card) {
    let tally = this.tally
    let at = this.now()

    this.finishing = Promise.resolve().then(() => {
      let store = this.deck.getStore()
      return Promise.all(card.measures.map((measure, idx) => {
        let {hits, misses, elapsedMs} = tally[idx]
        if (!hits && !misses) { return }

        return store.recordSectionPractice({
          pieceId: this.deck.pieceId,
          startMeasure: measure,
          endMeasure: measure,
          hits: this.recordNotes ? hits : 0,
          misses: this.recordNotes ? misses : 0,
          elapsedMs, at,
        }).catch(err => console.warn("Couldn't save the measure stats", err))
      }))
    })
  }
}
