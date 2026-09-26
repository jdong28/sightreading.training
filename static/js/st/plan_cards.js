// Today's programme on the staff: the planned session (st/srs/planner) as a
// deck of measure cards, played by the measure card generator
// (st/measure_cards) so the page draws, detects and records it as it does
// any card. Each card is the planner's next measure anchored in a card of
// the player's measures per card (anchoredCard), and the next is planned
// when a card is done, from the piece's items as its attempts leave them.

import {getAppStore} from "st/storage"
import {MeasureCardGenerator, sectionCard} from "st/measure_cards"
import {itemId, newItem, itemWithPractice} from "st/srs/records"
import {scheduledAttempt} from "st/srs/schedule"
import {
  planNext, planState, planSummary, studyStatus, anchoredCard,
  entryStatus, entryCaption,
} from "st/srs/planner"

// A deck of one card per playable measure of the piece, the card anchored on
// it, showing the one the planner picks
export class PlanDeck {
  /**
   * @param {PoolMeasure[]} measures every measure of the piece, in score order
   * @param {Object} opts
   * @param {string} opts.pieceId
   * @param {string} [opts.hand] one of HANDS (st/srs/records)
   * @param {number} [opts.cardMeasures] measures per card
   * @param {function(): number} [opts.now]
   * @param {LocalStore} [opts.store] the app's store by default
   */
  constructor(measures, {pieceId, hand="both", cardMeasures=1, now=Date.now, store}) {
    this.pieceId = pieceId
    this.hand = hand
    this.cardMeasures = cardMeasures
    this.now = now
    this.store = store

    let numbers = measures.map(measure => measure.number)
    let byNumber = new Map(measures.map(measure => [measure.number, measure]))
    this.measures = measures.filter(measure => measure.columns.length).map(measure => measure.number)
    this.cards = this.measures.map(measure =>
      sectionCard(anchoredCard(numbers, measure, cardMeasures).map(n => byNumber.get(n))))

    // items as the attempts not yet stored leave them, by id
    this.pending = new Map()

    this.index = null
    this.entry = null
    this.advance()
  }

  getStore() {
    return this.store || getAppStore()
  }

  /** @returns {boolean} whether the piece has a measure to play */
  get playable() {
    return this.index != null
  }

  /** @returns {number} */
  get playableCount() {
    return this.cards.length
  }

  /** @returns {MeasureCard|null} the card being shown */
  get card() {
    return this.index == null ? null : this.cards[this.index]
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
      hand: this.hand,
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
  }

  /**
   * Items an attempt leaves, until the store has them
   * @param {ItemRecord[]} items
   */
  expect(items) {
    for (let item of items) {
      this.pending.set(item.id, item)
    }
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

  /** @returns {string} the status line of the card being played */
  statusLine() {
    let entry = this.deck.entry
    return entry ? entryStatus(entry, {now: this.now(), complete: this.deck.complete}) : null
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
    let items = [
      ...attempts.map(({id, build}) => scheduledAttempt(build(this.deck.item(id)), settings).item),
      ...practice.map(stint => itemWithPractice(this.deck.item(itemId(stint)) || newItem(stint, stint.at), stint)),
    ]
    last.hit = hit

    this.deck.expect(items)
    let item = entry && items.find(item => item.id == entry.itemId)
    this.lastCaption = item ? entryCaption(item, opts.at) : null

    if (items.length) {
      this.markStudy(opts.at)
    }

    return opts
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
