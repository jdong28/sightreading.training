// Today's programme on the staff: the planned session (st/srs/planner) as a
// deck of measure cards, played by the measure card generator
// (st/measure_cards) so the page draws, detects and records it as it does
// any card. Each card is the planner's next measure anchored in a card of
// the player's measures per card (anchoredCard), and the next is planned
// when a card is done, from the piece's items as its attempts leave them. A
// bar the hand scaffold offers hands apart is a card of that bar alone, of
// that hand's notes, and its attempts are written to that hand's items.

import {getAppStore} from "st/storage"
import {MeasureCardGenerator, sectionCard} from "st/measure_cards"
import {passAttempts} from "st/srs/attempt"
import {AGAIN} from "st/srs/grade"
import {itemId, newItem, itemWithPractice} from "st/srs/records"
import {scheduledAttempt} from "st/srs/schedule"
import {
  planNext, planState, planSummary, studyStatus, anchoredCard,
  entryStatus, cardCaption, WAIT,
} from "st/srs/planner"

// the last graded review known of each item of a piece, by store then piece
// id then item id, which the hand scaffold reads the blamed hand from: read
// from the log the first time a deck of the piece is made (reviews are never
// cached in the store) and kept up to date by the attempts the decks plan
// from, so a rebuilt drill plans at once
const knownReviews = new WeakMap()

function reviewsKnown(store, pieceId) {
  let pieces = knownReviews.get(store)
  if (!pieces) {
    pieces = new Map()
    knownReviews.set(store, pieces)
  }

  let known = pieces.get(pieceId)
  if (!known) {
    known = {reviews: new Map(), read: null, loaded: false}
    pieces.set(pieceId, known)
  }
  return known
}

// Reads the piece's reviews into what is known of them, once per store and
// piece: the promise to wait for before the first card is planned, or null
// when they are known already
function readReviews(store, pieceId, known) {
  if (known.loaded) { return null }

  if (!known.read) {
    known.read = Promise.resolve(store.reviews ? store.reviews({pieceId}) : [])
      .then(reviews => learnReviews(known.reviews, reviews))
      .catch(err => console.warn("Couldn't read the piece's reviews", err))
      .then(() => { known.loaded = true })
  }
  return known.read
}

// keeps the later of each item's graded reviews
function learnReviews(known, reviews) {
  for (let review of reviews) {
    if (review.kind != "attempt" || !review.grade) { continue }
    let before = known.get(review.itemId)
    if (!before || before.at < review.at) {
      known.set(review.itemId, review)
    }
  }
}

// A deck of one card per playable measure of the piece, the card anchored on
// it, showing the one the planner picks, and for a session hands together on
// a piece with a staff per hand, a card of each measure for each hand alone
export class PlanDeck {
  /**
   * @param {PoolMeasure[]} measures every measure of the piece, in score order
   * @param {Object} opts
   * @param {string} opts.pieceId
   * @param {string} [opts.hand] one of HANDS (st/srs/records), the session's
   * @param {{upper: PoolMeasure[], lower: PoolMeasure[]}} [opts.hands] every
   * measure of the piece with each hand's notes alone, for the hand scaffold
   * @param {number} [opts.cardMeasures] measures per card
   * @param {function(): number} [opts.now]
   * @param {LocalStore} [opts.store] the app's store by default
   */
  constructor(measures, {pieceId, hand="both", hands=null, cardMeasures=1, now=Date.now, store}) {
    this.pieceId = pieceId
    this.sessionHand = hand
    this.cardMeasures = cardMeasures
    this.now = now
    this.store = store

    let numbers = measures.map(measure => measure.number)
    let byNumber = new Map(measures.map(measure => [measure.number, measure]))
    this.measures = measures.filter(measure => measure.columns.length).map(measure => measure.number)
    this.cards = this.measures.map(measure =>
      sectionCard(anchoredCard(numbers, measure, cardMeasures).map(n => byNumber.get(n))))

    // each hand's cards of a measure alone, by hand then measure
    this.handCards = new Map(hand == "both" && hands ? Object.entries(hands).map(([staff, pool]) =>
      [staff, new Map(pool.filter(measure => measure.columns.length)
        .map(measure => [measure.number, {...sectionCard([measure]), hand: staff}]))]) : [])
    this.handMeasures = this.handCards.size ? Object.fromEntries([...this.handCards]
      .map(([staff, cards]) => [staff, [...cards.keys()]])) : null

    // items as the attempts not yet stored leave them, by id
    this.pending = new Map()

    this.index = null
    this.entry = null
    // whether a card has been planned yet, false only while the piece's
    // reviews are still being read
    this.planned = false

    // the hand scaffold reads the blamed hand from the log, so the first
    // card of a piece is planned only once its reviews have been read; the
    // decks after it plan in the constructor
    let known = reviewsKnown(this.getStore(), pieceId)
    this.reviews = known.reviews
    let reading = readReviews(this.getStore(), pieceId, known)
    if (reading) {
      this.ready = reading.then(() => this.advance())
    } else {
      this.advance()
    }
  }

  getStore() {
    return this.store || getAppStore()
  }

  /** @returns {string} the hand of the card being shown, the session's or a hand alone */
  get hand() {
    return this.entry ? this.entry.hand : this.sessionHand
  }

  /** @returns {boolean} whether the piece has a measure to play */
  get playable() {
    return this.cards.length > 0
  }

  /** @returns {number} */
  get playableCount() {
    return this.cards.length
  }

  /** @returns {MeasureCard|null} the card being shown */
  get card() {
    if (this.index == null) { return null }

    let apart = this.entry.hand != this.sessionHand && this.handCards.get(this.entry.hand)
    return apart ? apart.get(this.entry.measure) : this.cards[this.index]
  }

  /**
   * The item of an id, as stored or as an attempt still being written leaves it
   * @param {string} id
   * @returns {ItemRecord|null}
   */
  item(id) {
    let stored = this.getStore().item(id)
    let pending = this.pending.get(id)
    if (pending && (!stored || pending.reps > stored.reps || pending.lastPracticed > stored.lastPracticed)) {
      return pending
    }
    this.pending.delete(id)
    return stored
  }

  /** @returns {ItemRecord[]} the piece's items, see item */
  items() {
    let items = this.getStore().items(this.pieceId).map(item => this.item(item.id))
    let stored = new Set(items.map(item => item.id))
    return [...items, ...[...this.pending.values()].filter(item => !stored.has(item.id))]
  }

  /** @returns {PlanInput} what the planner plans from now */
  planInput() {
    let store = this.getStore()
    return {
      pieceId: this.pieceId,
      items: this.items(),
      measures: this.measures,
      hand: this.sessionHand,
      handMeasures: this.handMeasures,
      lastReviews: this.reviews,
      now: this.now(),
      settings: store.schedulerSettings(),
      practice: store.practiceSettings(),
      cardMeasures: this.cardMeasures,
    }
  }

  /** Moves on to the card of the planner's next entry */
  advance() {
    let {entry} = planNext({...this.planInput(), previous: this.entry && this.entry.itemId})
    this.entry = entry
    this.index = entry ? this.measures.indexOf(entry.measure) : null
    this.planned = true
  }

  /**
   * Items an attempt leaves, until the store has them, and its reviews
   * @param {ItemRecord[]} items
   * @param {ReviewRecord[]} [reviews]
   */
  expect(items, reviews=[]) {
    for (let item of items) {
      this.pending.set(item.id, item)
    }
    learnReviews(this.reviews, reviews)
  }

  /** @returns {boolean} whether the programme reads complete now */
  get complete() {
    return planState(this.planInput()).complete
  }

  /** @returns {Object} what the programme holds, see planSummary */
  summary() {
    return planSummary(this.planInput())
  }

  /** @returns {string} the piece's study status the items give, see studyStatus */
  studyStatus() {
    return studyStatus(this.planInput())
  }
}

// Plays the plan deck's cards. On top of the measure card generator it names
// the card being played (statusLine) and adds to the caption after each card
// when its measure comes back, and marks the piece in study
export class PlanGenerator extends MeasureCardGenerator {
  /**
   * @param {PlanDeck} deck
   * @param {Object} [opts]
   * @param {function(): number} [opts.now]
   */
  constructor(deck, opts) {
    super(deck, opts)
    this.lastCaption = null
    // the deck plans its first card once the piece's reviews are read, so
    // the page shows it then (see refreshNoteList)
    this.ready = deck.planned ? null : deck.ready.then(() => this.startCard())
  }

  /** @returns {null} the cards have no order to number */
  currentCardNumber() {
    return null
  }

  /** @returns {string} the title's words for the measures played */
  sectionLabel() {
    return "today's programme"
  }

  /** @returns {string|null} the plate's words for the card, eg. "measures 11–12" */
  cardLabel() {
    let card = this.deck.card
    if (!card) { return null }
    return card.startMeasure == card.endMeasure ? `measure ${card.startMeasure}` :
      `measures ${card.startMeasure}–${card.endMeasure}`
  }

  /** @returns {string|null} the status line of the card being played */
  statusLine() {
    let entry = this.deck.entry
    if (entry) { return entryStatus(entry, {now: this.now(), complete: this.deck.complete}) }
    // the deck has no card: every bar the piece has left rests until the
    // next sitting, unless it has yet to plan its first one
    return this.deck.planned ? "Programme complete · every bar rests until tomorrow" : null
  }

  /** @returns {string|null} the pace of the last card played and when it comes back */
  caption() {
    return [super.caption(), this.lastCaption].filter(Boolean).join(" · ") || null
  }

  /** @returns {Object[]} see MeasureCardGenerator#takePractice, the caption going with it */
  takePractice() {
    this.lastCaption = null
    return super.takePractice()
  }

  /** @returns {Object} what the programme holds, see planSummary */
  summary() {
    return this.deck.summary()
  }

  // the planner is told how the pass went before it plans the next card:
  // the items as its attempts leave them, graded now though the hit on the
  // last column is counted just after (see notePlayed), so it is taken as
  // hit unless it was scrolled past. The measures played off schedule that
  // didn't fail are settled here too (see practiceOnly), and written as
  // practice alone
  finishPass(pass) {
    let opts = super.finishPass(pass)
    let entry = this.deck.entry
    let last = pass.columns[pass.columns.length - 1]
    let hit = last.hit
    let scrolled = pass.drill && pass.drill.mode == "scroll" && last.counted > 0

    last.hit = hit || !scrolled
    let settings = this.deck.getStore().schedulerSettings()
    let {attempts, practice} = this.passRecords(pass, opts)
    let graded = attempts.map(({id, build}) => scheduledAttempt(build(this.deck.item(id)), settings))
    let items = [
      ...graded.map(attempt => attempt.item),
      ...practice.map(stint => itemWithPractice(this.deck.item(itemId(stint)) || newItem(stint, stint.at), stint)),
    ]
    last.hit = hit

    this.deck.expect(items, graded.map(attempt => attempt.review))
    let item = entry && items.find(item => item.id == entry.itemId)
    this.lastCaption = entry ? cardCaption(entry, item || null, planState(this.deck.planInput())) : null

    if (items.length) {
      this.markStudy(opts.at)
    }

    return opts
  }

  /**
   * As MeasureCardGenerator#practiceOnly, save that a hand alone the scaffold
   * offers climbs its own ladder from the bar's failure, so its bar is on
   * schedule unless it was offered while waiting
   * @param {AttemptPass} pass complete
   * @param {Object} opts as for passAttempts
   * @returns {string[]}
   */
  practiceOnly(pass, opts) {
    let entry = this.deck.entry
    if (!entry || entry.hand == this.deck.sessionHand) { return super.practiceOnly(pass, opts) }

    if (!pass.practiceOnly) {
      pass.practiceOnly = entry.reason != WAIT ? [] : passAttempts(pass, opts)
        .filter(({id, build}) => build(this.deck.item(id)).review.grade > AGAIN)
        .map(({id}) => id)
    }

    return pass.practiceOnly
  }

  // The piece is in study once a card of its programme is played: learning
  // until each of its measures has been scheduled, then maintaining
  markStudy(time) {
    let store = this.deck.getStore()
    let study = store.study(this.deck.pieceId)
    let status = this.deck.studyStatus()
    if (study && (study.status == status || study.status == "shelved")) { return }

    this.studying = Promise.resolve(this.studying).then(() => store.putStudy({
      ...study,
      pieceId: this.deck.pieceId,
      status,
      startedAt: study ? study.startedAt : time,
    })).catch(err => console.warn("Couldn't save the study", err))
  }
}
