// Today's programme on the staff: the planned session (st/srs/planner) as a
// deck of measure cards, played by the measure card generator
// (st/measure_cards) so the page draws, detects and records it as it does
// any card. Each card is the planner's next measure anchored in a card of
// the player's measures per card (anchoredCard), and the next is planned
// when a card is done, from the piece's items as its attempts leave them. A
// bar the hand scaffold offers hands apart is a card of that bar alone, of
// that hand's notes, and its attempts are written to that hand's items; the
// scaffold is offered in wait mode alone, so a failing bar returns hands
// together while the drill scrolls. The scaffold's own passes never mark
// their items deliberate (PlanDeck#scaffold, ItemRecord#deliberate): only a
// session played with that hand as its own does.

import {getAppStore} from "st/storage"
import {MeasureCardGenerator, sectionCard} from "st/measure_cards"
import {itemId, newItem, itemWithPractice} from "st/srs/records"
import {scheduledAttempt} from "st/srs/schedule"
import {
  planNext, planState, planSummary, studyStatus, anchoredCard,
  entryStatus, cardCaption, entryCaption, WAIT,
} from "st/srs/planner"

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
   * @param {{upper: number[], lower: number[]}} [opts.handMeasures] the bars
   * each hand alone has notes in, for the hand scaffold
   * @param {function(string, number): PoolMeasure} [opts.handCard] one bar of
   * the piece with one hand's notes alone, called only for a bar the scaffold
   * offers, never for the whole piece
   * @param {number} [opts.cardMeasures] measures per card
   * @param {function(): number} [opts.now]
   * @param {LocalStore} [opts.store] the app's store by default
   */
  constructor(measures, {pieceId, hand="both", handMeasures=null, handCard=null,
      cardMeasures=1, now=Date.now, store}) {
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

    // the bars each hand alone can play, and the one-bar cards of them the
    // scaffold has asked for, by hand and measure: the planner splits only a
    // bar both hands have notes in, so only those make a deck splittable
    let hands = hand == "both" && handMeasures && handCard ? handMeasures : null
    let lower = new Set(hands ? hands.lower || [] : [])
    let apart = !!hands && (hands.upper || []).some(bar => lower.has(bar))
    this.handMeasures = apart ? handMeasures : null
    this.buildHandCard = apart ? handCard : null
    this.handCards = new Map()

    // items as the attempts not yet stored leave them, by id
    this.pending = new Map()

    this.index = null
    this.entry = null

    // the last graded review known of each of the piece's items, by item id,
    // which the hand scaffold reads the blamed hand from. The deck plans at
    // once from the items the store has cached, and reads the log (reviews
    // are never cached, and free practice writes them too) only when a bar
    // that can split is failing, planning again from it when it lands; its
    // own passes keep it up to date from there
    this.reviews = new Map()
    // whether a card is being played, which the generator keeps up to date:
    // the plan made again after the read waits rather than throw a pass away
    this.playing = () => false
    // what the hand scaffold needs of the page, which the generator keeps
    // up to date: a drill that waits at each column, and a staff that can
    // draw one hand of the piece by itself (see split). Acoustic mode turns
    // the scaffold off outright (selfGraded): self failures never split a
    // bar, and a bar split by an earlier detected failure returns hands
    // together while it is on
    this.waiting = () => true
    this.splittable = () => true
    this.selfGraded = () => false

    if (this.advance().failing.size) {
      this.ready = this.loadReviews()
        .then(() => { if (!this.playing()) { this.advance(false) } })
    }
  }

  getStore() {
    return this.store || getAppStore()
  }

  // reads the piece's reviews from the log into what is known of them
  loadReviews() {
    let store = this.getStore()
    return Promise.resolve(store.reviews ? store.reviews({pieceId: this.pieceId}) : [])
      .then(reviews => learnReviews(this.reviews, reviews))
      .catch(err => console.warn("Couldn't read the piece's reviews", err))
  }

  /** @returns {boolean} whether a bar may be offered as one hand alone now */
  split() {
    return this.waiting() && this.splittable() && !this.selfGraded()
  }

  /** @returns {string} the hand of the card being shown, the session's or a hand alone */
  get hand() {
    return this.entry ? this.entry.hand : this.sessionHand
  }

  /**
   * @returns {boolean} whether the card shown is the hand scaffold's hand
   * alone, standing in for its bar played hands together, rather than the
   * player's own choice of hand (see ItemRecord#deliberate)
   */
  get scaffold() {
    return !!this.entry && this.entry.hand != this.sessionHand
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

    let {hand, measure} = this.entry
    return hand == this.sessionHand ? this.cards[this.index] : this.handCard(hand, measure)
  }

  /**
   * The one-bar card of a hand alone the scaffold offers, built the first
   * time that bar is offered to that hand
   * @param {string} staff one of STAVES
   * @param {number} measure
   * @returns {MeasureCard}
   */
  handCard(staff, measure) {
    let key = `${staff}:${measure}`
    if (!this.handCards.has(key)) {
      this.handCards.set(key, {...sectionCard([this.buildHandCard(staff, measure)]), hand: staff})
    }
    return this.handCards.get(key)
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
      split: this.split(),
      lastReviews: this.reviews,
      now: this.now(),
      settings: store.schedulerSettings(),
      practice: store.practiceSettings(),
      cardMeasures: this.cardMeasures,
    }
  }

  /**
   * Moves on to the card of the planner's next entry
   * @param {boolean} [played] whether the entry showing was played, which
   * keeps the planner from offering it again at once; the plan made afresh
   * after the log read has played nothing
   * @returns {Object} the planner's state, see planState
   */
  advance(played=true) {
    let previous = played && this.entry ? this.entry.itemId : null
    let {entry, state} = planNext({...this.planInput(), previous})
    this.entry = entry
    this.index = entry ? this.measures.indexOf(entry.measure) : null
    return state
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
// when its measure comes back, and the receipt of a self-graded pass with
// when the bar its grade went to comes back, and marks the piece in study
export class PlanGenerator extends MeasureCardGenerator {
  /**
   * @param {PlanDeck} deck
   * @param {Object} [opts]
   * @param {function(): number} [opts.now]
   */
  constructor(deck, opts) {
    super(deck, opts)
    this.lastCaption = null
    // the bar a self-graded pass's grade went to and when it comes back,
    // which selfReceipt reads in place of lastCaption (see finishPass)
    this.lastWhen = null
    deck.playing = () => this.playing()
    // a deck that reads the log plans again when it lands, unless a pass is
    // in progress; it resolves to whether the page should fill the staff
    // again from the card it then picks (see refreshNoteList)
    this.ready = deck.ready ? deck.ready
      .then(() => {
        if (this.playing()) { return false }
        this.startCard()
        return true
      })
      .catch(err => {
        console.warn("Couldn't show today's first card", err)
        return false
      }) : null
  }

  /** @returns {boolean} whether the card showing has been played into */
  playing() {
    return !!this.pass && this.pass.touched
  }

  /**
   * @param {function(): {mode: string, speed?: number}} drill see
   * MeasureCardGenerator#setDrill. The scaffold is offered in wait mode
   * alone, so the card showing is planned again once the drill is known
   */
  setDrill(drill) {
    super.setDrill(drill)
    this.deck.waiting = () => this.drill().mode != "scroll"
    this.deck.selfGraded = () => this.drill().mode == "self"
    this.replan()
  }

  /**
   * @param {function(): boolean} apart whether the staff drawing the cards
   * can draw one hand of the piece by itself, which the page says (see
   * SightReadingPage#handsApart); the card showing is planned again once
   * it has
   */
  setHandsApart(apart) {
    this.deck.splittable = apart
    this.replan()
  }

  /**
   * @returns {boolean} whether the card showing isn't one to play now: a
   * programme with no card, which the page asks for at Begin (every bar the
   * piece has left rested in the sitting before, and the one that is over
   * opens them again), or a hand alone where the scaffold can't be offered,
   * where a failing bar returns hands together
   */
  replanning() {
    let entry = this.deck.entry
    return !entry || (entry.hand != this.deck.sessionHand && !this.deck.split())
  }

  /**
   * Plans again when the card showing isn't one to play now, see replanning
   * @returns {boolean} whether there is a card to play now
   */
  replan() {
    if (!this.replanning()) { return false }

    this.deck.advance(false)
    this.startCard()
    return !!this.deck.card
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
    if (entry) { return entryStatus(entry, {now: this.now(), complete: this.deck.complete}) }

    // the deck has no card: the bars in trouble rest until the next sitting,
    // and the programme is complete only when nothing else is left either
    let state = planState(this.deck.planInput())
    if (!state.complete) {
      return "Nothing more to practise this sitting · struggling bars rest until your next sitting"
    }

    let bars = state.resting.size
    return bars ?
      `Programme complete · ${bars} ${bars == 1 ? "bar rests" : "bars rest"} until your next sitting` :
      "Programme complete"
  }

  /** @returns {string|null} the pace of the last card played and when it comes back */
  caption() {
    return [super.caption(), this.lastCaption].filter(Boolean).join(" · ") || null
  }

  /** @returns {Object[]} see MeasureCardGenerator#takePractice, the caption going with it */
  takePractice() {
    this.lastCaption = null
    this.lastWhen = null
    return super.takePractice()
  }

  /** @returns {Object|null} see MeasureCardGenerator#selfReceipt, with when the bar the grade went to returns */
  selfReceipt() {
    let receipt = super.selfReceipt()
    return receipt && {...receipt, when: this.lastWhen}
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
    let state = planState(this.deck.planInput())

    if (pass.selfGrade) {
      this.lastCaption = null
      let measure = pass.selfGrade.bars?.[0] ?? entry.measure
      let id = itemId({pieceId: opts.pieceId, hand: opts.hand, startMeasure: measure, endMeasure: measure})
      let item = items.find(item => item.id == id) ?? this.deck.item(id)
      let words = state.resting.has(measure) ? "rests until your next sitting" : entryCaption(item, state.now)
      this.lastWhen = words ? {measure, words} : null
    } else {
      let item = entry && items.find(item => item.id == entry.itemId)
      this.lastCaption = entry ? cardCaption(entry, item || null, state) : null
      this.lastWhen = null
    }

    if (items.length) {
      this.markStudy(opts.at)
    }

    return opts
  }

  /**
   * As MeasureCardGenerator#practiceOnly, save that a hand alone the scaffold
   * offers climbs its own ladder from the bar's failure, so it is on schedule
   * unless it was played waiting, where the rule for any other card applies,
   * and that a bar resting until the next sitting is left as it is wherever
   * it is played, so a card anchored on a neighbour writes it as practice
   * alone however the pass went
   * @param {AttemptPass} pass complete
   * @param {Object} opts as for passAttempts
   * @returns {string[]}
   */
  practiceOnly(pass, opts) {
    if (pass.practiceOnly) { return pass.practiceOnly }

    let {pieceId, hand} = opts
    let barId = measure => itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
    let resting = planState(this.deck.planInput()).resting
    let rested = pass.card.measures.filter(measure => resting.has(measure)).map(barId)

    let entry = this.deck.entry
    let apart = entry && entry.hand != this.deck.sessionHand
    let offSchedule = apart && entry.reason != WAIT ? [] : super.practiceOnly(pass, opts)

    pass.practiceOnly = [...new Set([...rested, ...offSchedule])]
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
