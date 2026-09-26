// Today's programme: the planned session on one piece, which picks the next
// single measure to practise from the piece's items (st/srs/records), the
// scheduler's settings (st/srs/schedule) and the clock. Nothing is planned
// ahead or stored: the queue is worked out afresh after every attempt from
// the items as stored, so a reload in mid-session carries on with the same
// queue. What the planner knows of the session so far (when it started, how
// many cards were played, how many of them brought new measures, the card
// just played) it reads from the attempts the items keep in recent and
// their last practice.
//
// The queue, first match wins:
// 1. a ladder rung come due, earliest first, the immediate retry after an
//    again included;
// 2. a review due today, lowest predicted recall first, after a warm-up of
//    the two likeliest recalled;
// 3. a new measure, the next in score order not yet seen, while fewer than
//    LADDER_CAP items are on the ladder, the ones resting counted, new cards
//    are at most half the cards played and the due reviews fit in
//    REVIEW_SHARE of the time left to the target (with nothing else to do,
//    up to IDLE_LADDER_CAP on the ladder, and the sitting is over once the
//    bars resting fill that).
//    Once the first fifth of the target has passed, a new measure these
//    limits allow goes ahead of the due reviews, so new material is
//    interleaved with them rather than left until they are all done;
// 4. an early review: an item in review not played today, lowest predicted
//    recall first;
// 5. a run-through: an item in review, least recently played first, which
//    the scheduler's same-day rule leaves unscheduled;
// 6. the next ladder rung, played before it comes due.
// Never the measure just played, save the retry, its hand alone the hand
// scaffold sends next and a piece of one measure.
//
// Hands apart, only where a bar needs it (the hand scaffold): a bar
// played hands together that fails (graded again) at first sight, or twice
// running later, with at least SCAFFOLD_SHARE of the misses of that failure,
// and at least SCAFFOLD_MISSES, on one staff, is next offered as that hand
// alone, from the hand's own item on its own ladder, in its place in the
// queue. The blamed hand is read from that failure's review alone, so a bar
// whose failure has no review read isn't split. The bar returns hands
// together once the hand holds: its item graded good or better twice running
// since the failure, or graduated since, which its own last review tells
// from an interval merely extended. When both staves are blamed, the one
// with more misses comes first, then the other. A piece without a staff per
// hand never splits (handMeasures), nor does a session played with one hand,
// nor a bar only one hand has notes in: taking the other off it would leave
// the very same card.
// The scaffold is the planner's alone: it is worked out from the items and
// the last review of each bar, and writes nothing, so the schedule stays what
// replay rebuilds.
//
// Rest it until the next sitting: a bar failing a third time in a sitting,
// whichever hand it was played with, is not offered again in the sitting. Its
// due date is left as it is, so it opens the next sitting. With every bar left
// resting the programme has no entry at all until then. A bar resting is no
// work left in the sitting, but it is still learned (planSummary).
//
// Off schedule: a measure on the ladder played before its rung comes due (the
// last entry, or a neighbour in a card) is graded only when it fails, else
// its pass is practice alone, so a rung is never climbed early
// (onScheduleMeasures). Measures in review keep the scheduler's same-day rule
// and a measure never scheduled gets its first-sight review.
//
// The session is endless: its length (the practice settings' sessionMinutes)
// is a soft target, past which the programme reads complete and the queue
// carries on.
//
// Joins between measures: each entry is played as a card of the player's
// measures per card anchored on its measure (anchoredCard), so the measure
// is practised with its neighbours. The entry's schedule comes from its
// measure's own review; the other measures of the card are reviewed as any
// card's measures are, under the off-schedule rule above.

import {itemId, STAVES} from "st/srs/records"
import {AGAIN, GOOD} from "st/srs/grade"
import {
  scheduled, predictedRecall, localDay, dayStart,
  DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS, MINUTE, HOUR,
} from "st/srs/schedule"

// the cards at the start of a session played from the likeliest recalled
// due reviews
export const WARM_UP_CARDS = 2

// the most items on the ladder before new material waits
export const LADDER_CAP = 4

// the most on the ladder when there is nothing else to play
export const IDLE_LADDER_CAP = 8

// new cards stay at most this share of the cards played
export const NEW_SHARE = 0.5

// new material waits unless the due reviews fit in this share of the time
// left to the target
export const REVIEW_SHARE = 0.7

// attempts further apart than this are in different sessions
export const SITTING_GAP_MS = 20 * MINUTE

// the time a bar takes when none of the piece has been timed
export const DEFAULT_BAR_MS = 8 * 1000

// why an entry is next
export const RETRY = "retry"
export const LADDER = "ladder"
export const REVIEW = "review"
export const NEW = "new"
export const EARLY = "early"
export const RUN_THROUGH = "run-through"
export const WAIT = "wait"

// a failure sends a bar's hand alone when that hand's staff was blamed for
// at least this share of its misses, and at least SCAFFOLD_MISSES of them
export const SCAFFOLD_SHARE = 2 / 3
export const SCAFFOLD_MISSES = 2

// the failures in a sitting after which a bar rests until the next
export const REST_FAILURES = 3

export const STUDYING = ["learning", "maintaining"]

const ON_LADDER = ["learning", "relearning"]

/**
 * The measures a card anchored on measure plays: measure and the ones after
 * it, or at the end of the piece the ones before it, size in all.
 * @param {number[]} measures the piece's bar numbers in score order
 * @param {number} measure one of them
 * @param {number} size measures per card, at least 1
 * @returns {number[]} in score order
 */
export function anchoredCard(measures, measure, size) {
  let idx = measures.indexOf(measure)
  if (idx < 0) { return [measure] }

  let count = Math.min(measures.length, Math.max(1, Math.floor(size) || 1))
  let start = Math.max(0, Math.min(idx, measures.length - count))
  return measures.slice(start, start + count)
}

/**
 * The measures of a card played now whose grades the schedule asks for: any
 * not on the ladder (never scheduled, or in review, which the scheduler's
 * same-day rule looks after) and ladder rungs come due. A pass at the others
 * is graded only when it fails, else it is practice alone.
 * @param {number[]} card the card's measures
 * @param {function(number): (ItemRecord|null)} itemOf the item of a measure
 * @param {number} now
 * @returns {number[]}
 */
export function onScheduleMeasures(card, itemOf, now) {
  return card.filter(measure => {
    let item = itemOf(measure)
    return !item || !scheduled(item) || !ON_LADDER.includes(item.state) || item.due <= now
  })
}

/**
 * The planner's inputs.
 * @typedef {Object} PlanInput
 * @property {string} pieceId
 * @property {ItemRecord[]} items the piece's items, any others are ignored
 * @property {number[]} measures the bar numbers that can be played, in score order
 * @property {string} [hand] the hand setting of the session, one of HANDS
 * @property {number} now
 * @property {SchedulerSettings} [settings]
 * @property {PracticeSettings} [practice]
 * @property {number} [cardMeasures] measures per card, which the time of a card is estimated by
 * @property {string} [previous] the item id of the entry just played, on top
 * of the measures of the last card the items record
 * @property {{upper: number[], lower: number[]}} [handMeasures] the bar
 * numbers each hand alone can play, for a piece with a staff per hand; a bar
 * is only offered hands apart (the hand scaffold) where both hands have
 * notes in it, in a session played hands together
 * @property {Map<string, ReviewRecord>} [lastReviews] the last graded review
 * known of an item, by item id, whose staffMisses say which hand a failure's
 * misses fell on
 */

/**
 * The next measure to practise and the state of the programme.
 * @typedef {Object} PlanEntry
 * @property {string} reason one of RETRY, LADDER, REVIEW, NEW, EARLY, RUN_THROUGH, WAIT
 * @property {number} measure
 * @property {string} itemId
 * @property {ItemRecord|null} item null for a measure never scheduled
 * @property {string} hand the session's hand, or the hand alone of a bar
 * the hand scaffold offers
 */

// when an item was played: its graded attempts, and its last practice
const playedAt = item => [...item.recent.map(([at]) => at), item.lastPracticed]

// the session so far as the attempts on the items tell it: the items of the
// session's hand, which bring new measures, and the others played in it
function sittingOf(items, others, now) {
  let times = [...new Set([...items, ...others].flatMap(playedAt))]
    .filter(at => at <= now)
    .sort((a, b) => b - a)

  let start = now
  for (let at of times) {
    if (start - at > SITTING_GAP_MS) { break }
    start = at
  }

  let played = times.filter(at => at >= start)

  // an attempt that was the first at an item brought a new measure
  let firsts = new Set(items
    .filter(item => item.recent.length && item.reps == item.recent.length)
    .map(item => item.recent[0][0])
    .filter(at => at >= start && at <= now))

  return {
    startedAt: start,
    cards: played.length,
    newCards: played.filter(at => firsts.has(at)).length,
    last: times.length ? times[0] : null,
  }
}

const gradeOf = ([, , , grade]) => grade

/**
 * The staves a failure's misses fell on enough to send that hand alone: at
 * least SCAFFOLD_SHARE of the review's misses, and SCAFFOLD_MISSES, blamed on
 * the staff, most misses first.
 * @param {ReviewRecord} review
 * @returns {string[]|null} of STAVES, null for a review whose misses aren't
 * split by staff
 */
export function blamedStaves(review) {
  let misses = review && review.staffMisses
  if (!misses) { return null }

  return STAVES
    .filter(staff => misses[staff] >= SCAFFOLD_MISSES && misses[staff] >= SCAFFOLD_SHARE * review.misses)
    .sort((a, b) => misses[b] - misses[a])
}

// when a bar's last attempt failed, at first sight or after a failure, else
// null
function failedAt(item) {
  let recent = item.recent
  let last = recent[recent.length - 1]
  if (!last || gradeOf(last) != AGAIN) { return null }
  if (recent.length > 1 && gradeOf(recent[recent.length - 2]) != AGAIN) { return null }
  return last[0]
}

// Whether a hand alone holds since a time: graded good or better twice
// running since, or graduated since. A graduation is told from the hand's
// last review, which says the state it moved on from (was): an item in
// review before then only extended its interval. Without that review the
// two goods running are what releases the bar.
function held(item, since, review) {
  if (!item) { return false }

  let after = item.recent.filter(([at]) => at > since).map(gradeOf)
  let n = after.length
  if (n >= 2 && after[n - 1] >= GOOD && after[n - 2] >= GOOD) { return true }

  return item.state == "review" && item.last > since && item.lastGrade >= GOOD &&
    !!review && review.at > since && review.was != "review"
}

/**
 * The hand scaffold of a bar played hands together: the hand it is offered
 * alone as, while the bar is in trouble and until each hand blamed holds.
 * The hands blamed come from that failure's review alone, so a bar whose
 * failure has no review read isn't split.
 * @param {ItemRecord} bar the bar's hands together item
 * @param {Object} opts
 * @param {Object<string, ItemRecord>} [opts.hands] the bar's items of each hand
 * alone, by hand
 * @param {Map<string, ReviewRecord>} [opts.reviews] the last graded review
 * known of each item, by item id: the bar's says which hands its failure
 * blamed, a hand's whether it graduated since
 * @returns {{hand: string, item: ItemRecord|null, since: number}|null} the
 * hand, its item, and when the bar failed; null when the bar holds hands
 * together, or its failure has no review
 */
export function barScaffold(bar, {hands={}, reviews=new Map()}={}) {
  let since = failedAt(bar)
  if (since == null) { return null }

  let failure = reviews.get(bar.id)
  let blamed = failure && failure.at == since ? blamedStaves(failure) : null
  if (!blamed) { return null }

  let hand = blamed.find(staff => {
    let own = hands[staff]
    return !held(own, since, own && reviews.get(own.id))
  })
  return hand ? {hand, item: hands[hand] || null, since} : null
}

// the hand items of the given single measure items, by measure then hand
function handsByMeasure(items) {
  let byMeasure = new Map()
  for (let item of items) {
    let hands = byMeasure.get(item.startMeasure) || {}
    hands[item.hand] = item
    byMeasure.set(item.startMeasure, hands)
  }
  return byMeasure
}

/**
 * Everything the queue is picked from: the piece's single measure items of
 * the hand in the measures given, grouped by what the scheduler has them
 * doing, as slots of the queue (a bar's hand alone standing in for it while
 * the hand scaffold holds it), the bars resting until the next sitting, and
 * the session so far.
 * @param {PlanInput} input
 * @returns {Object}
 */
export function planState({
  pieceId, items, measures, hand="both", now, settings=DEFAULT_SCHEDULER_SETTINGS,
  practice=DEFAULT_PRACTICE_SETTINGS, cardMeasures=1, previous=null, handMeasures=null,
  lastReviews=new Map(),
}) {
  let order = new Map(measures.map((measure, idx) => [measure, idx]))
  let single = item => item.pieceId == pieceId && item.startMeasure == item.endMeasure &&
    !item.beats && order.has(item.startMeasure)
  let bars = items.filter(item => single(item) && item.hand == hand)
  let byMeasure = new Map(bars.map(item => [item.startMeasure, item]))

  // the bars a session played hands together can offer one hand alone: only
  // those both hands have notes in
  let staffBars = hand == "both" && handMeasures ?
    STAVES.map(staff => new Set(handMeasures[staff] || [])) : []
  let apart = new Set(staffBars.length == STAVES.length ?
    [...staffBars[0]].filter(measure => staffBars.every(bars => bars.has(measure))) : [])
  let handBars = apart.size ? items.filter(item => single(item) && STAVES.includes(item.hand)) : []
  let handItems = handsByMeasure(handBars)

  let live = bars.filter(item => scheduled(item))
  let liveMeasures = new Set(live.map(item => item.startMeasure))
  let setAside = new Set(bars.filter(item => ["merged", "split", "suspended"].includes(item.state))
    .map(item => item.startMeasure))

  let sitting = sittingOf(bars, handBars, now)

  // the measures just played in this session: every measure of the last
  // card, and the entry named
  let lastCard = sitting.last != null && now - sitting.last <= SITTING_GAP_MS ? sitting.last : null
  let recent = new Set(lastCard == null ? [] :
    [...bars, ...handBars].filter(item => playedAt(item).includes(lastCard)).map(item => item.id))
  if (previous) { recent.add(previous) }

  // the bars the programme has in hand, failed REST_FAILURES times in the
  // sitting whichever hand played them, rest
  let failures = new Map()
  for (let item of [...bars, ...handBars]) {
    if (!liveMeasures.has(item.startMeasure)) { continue }
    let failed = item.recent.filter(([at, , , grade]) =>
      grade == AGAIN && at >= sitting.startedAt && at <= now).length
    failures.set(item.startMeasure, (failures.get(item.startMeasure) || 0) + failed)
  }
  let resting = new Set([...failures].filter(([, count]) => count >= REST_FAILURES).map(([measure]) => measure))

  let today = localDay(now)
  let endOfToday = dayStart(today + 1)

  // an item's place in the queue, or its hand alone's while the hand
  // scaffold holds the bar: due when the bar failed until the hand has been
  // graded since, then on the hand's own schedule
  let slotOf = item => {
    let measure = item.startMeasure
    let scaffold = apart.has(measure) && ON_LADDER.includes(item.state) ?
      barScaffold(item, {hands: handItems.get(measure), reviews: lastReviews}) : null

    if (!scaffold) {
      return {id: item.id, measure, hand, item, due: item.due, retry: isRetry(item)}
    }

    let own = scaffold.item
    let climbing = !!own && own.recent.some(([at]) => at > scaffold.since)
    return {
      id: own ? own.id : itemId({pieceId, hand: scaffold.hand, startMeasure: measure, endMeasure: measure}),
      measure,
      hand: scaffold.hand,
      item: own,
      due: climbing ? own.due : scaffold.since,
      retry: climbing && isRetry(own),
    }
  }

  let awake = live.filter(item => !resting.has(item.startMeasure))
  // the bars that can split and are failing, the ones resting among them:
  // the hand the scaffold offers is read from each one's last review, the
  // only thing the plan wants from the log (see barScaffold)
  let failing = new Set(live.filter(item => apart.has(item.startMeasure) &&
    ON_LADDER.includes(item.state) && failedAt(item) != null).map(item => item.id))
  // the bars in progress, whether or not they rest: what the ladder holds
  let laddered = live.filter(item => ON_LADDER.includes(item.state)).length
  let ladder = awake.filter(item => ON_LADDER.includes(item.state)).map(slotOf)
  let review = awake.filter(item => item.state == "review").map(slotOf)
  let dueReviews = review.filter(slot => slot.item.due < endOfToday)
  let unseen = measures.filter(measure => !liveMeasures.has(measure) && !setAside.has(measure))
  let scaffolds = new Map(ladder.filter(slot => slot.hand != hand).map(slot => [slot.measure, slot.hand]))

  let timed = live.filter(item => item.attempts > 0 && item.elapsedMs > 0)
  let barMs = timed.length ?
    timed.reduce((sum, item) => sum + item.elapsedMs / item.attempts, 0) / timed.length :
    DEFAULT_BAR_MS
  let cardMs = barMs * Math.max(1, Math.floor(cardMeasures) || 1)

  let targetMs = practice.sessionMinutes * MINUTE
  let elapsedMs = now - sitting.startedAt

  return {
    pieceId, hand, now, settings, order, byMeasure, recent, today, endOfToday,
    live, awake, failing, ladder, laddered, review, dueReviews, unseen, resting, scaffolds, sitting,
    cardMs, targetMs, elapsedMs,
    complete: elapsedMs >= targetMs || (!ladder.length && !dueReviews.length && !unseen.length),
  }
}

// whether the item's next rung is the immediate retry after an again
const isRetry = item => ON_LADDER.includes(item.state) && item.lastGrade == AGAIN && item.due <= item.last

// the queue in order, as lists of candidates: never empty while the piece
// has a bar awake or a measure to learn
function candidates(state, {avoid}) {
  let {now, settings, order, recent, ladder, review, dueReviews, unseen, sitting} = state
  let recall = slot => predictedRecall(slot.item, now, settings)
  let measureOrder = (a, b) => order.get(a.measure) - order.get(b.measure)
  let other = slot => !avoid || !recent.has(slot.id) || slot.retry

  let rungs = ladder.filter(slot => slot.due <= now && other(slot))
    .sort((a, b) => a.due - b.due || measureOrder(a, b))

  let warmUp = sitting.cards < WARM_UP_CARDS
  let due = dueReviews.filter(other)
    .sort((a, b) => (warmUp ? recall(b) - recall(a) : recall(a) - recall(b)) || measureOrder(a, b))

  let early = review.filter(slot => slot.item.due >= state.endOfToday &&
      localDay(slot.item.lastPracticed) < state.today && other(slot))
    .sort((a, b) => recall(a) - recall(b) || measureOrder(a, b))

  let runThrough = review.filter(other)
    .sort((a, b) => a.item.lastPracticed - b.item.lastPracticed || measureOrder(a, b))

  let waiting = ladder.filter(other).sort((a, b) => a.due - b.due || measureOrder(a, b))

  let newMeasures = unseen.map(measure => newSlot(state, measure)).filter(other)

  let idle = !rungs.length && !due.length && !early.length && !runThrough.length
  let cap = idle ? IDLE_LADDER_CAP : LADDER_CAP
  let remainingMs = state.targetMs - state.elapsedMs
  let fits = dueReviews.length * state.cardMs <= REVIEW_SHARE * remainingMs
  let share = sitting.newCards <= NEW_SHARE * sitting.cards
  let offerNew = state.laddered < cap && fits && (share || idle)
  let newEntry = offerNew ? newMeasures.slice(0, 1).map(slot => ({reason: NEW, slot})) : []

  // past the warm-up fifth of the session, new material the limits allow is
  // interleaved with the due reviews rather than waiting for them all
  let interleave = !warmUp && state.elapsedMs >= state.targetMs / 5

  return [
    ...rungs.map(slot => ({reason: slot.retry ? RETRY : LADDER, slot})),
    ...(interleave ? newEntry : []),
    ...due.map(slot => ({reason: REVIEW, slot})),
    ...(interleave ? [] : newEntry),
    ...early.map(slot => ({reason: EARLY, slot})),
    ...runThrough.map(slot => ({reason: RUN_THROUGH, slot})),
    ...waiting.map(slot => ({reason: WAIT, slot})),
  ]
}

// the queue slot of a measure never scheduled
const newSlot = ({pieceId, hand}, measure) => ({
  id: itemId({pieceId, hand, startMeasure: measure, endMeasure: measure}),
  measure, hand, item: null, retry: false,
})

/**
 * The next entry of the queue.
 * @param {PlanInput} input
 * @returns {{entry: PlanEntry|null, complete: boolean, state: Object}} a
 * null entry when the piece has nothing to play now: it has no measure, or
 * every bar it has left rests until the next sitting
 */
export function planNext(input) {
  let state = planState(input)

  // the measure just played only comes again when there's nothing else
  let [next] = candidates(state, {avoid: true})
  if (!next) {
    [next] = candidates(state, {avoid: false})
  }

  // a piece whose every measure waits past the target: its first new one,
  // unless every bar it has in progress rests until the next sitting
  let allResting = state.resting.size > 0 && !state.awake.length
  if (!next && state.unseen.length && !allResting) {
    next = {reason: NEW, slot: newSlot(state, state.unseen[0])}
  }

  if (!next) {
    return {entry: null, complete: state.complete, state}
  }

  let {slot} = next
  let entry = {
    reason: next.reason,
    measure: slot.measure,
    itemId: slot.id,
    item: slot.item || null,
    hand: slot.hand,
  }

  return {entry, complete: state.complete, state}
}

/**
 * What the programme holds for the piece before a session: the reviews due
 * and about how long they take, the new measures on offer, the target, and
 * the measures learned (in review) out of all, a bar resting among them.
 * @param {PlanInput} input
 * @returns {{due: number, dueMinutes: number, newMeasures: number, targetMinutes: number, learned: number, measures: number}}
 */
export function planSummary(input) {
  let state = planState(input)
  let due = state.dueReviews.length + state.ladder.filter(slot => slot.due < state.endOfToday).length
  return {
    due,
    dueMinutes: due ? Math.max(1, Math.round(due * state.cardMs / MINUTE)) : 0,
    newMeasures: state.unseen.length,
    targetMinutes: (input.practice || DEFAULT_PRACTICE_SETTINGS).sessionMinutes,
    learned: state.live.filter(item => item.state == "review").length,
    measures: input.measures.length,
  }
}

/**
 * The study status of a piece: learning while any of its measures has not
 * been scheduled, then maintaining.
 * @param {PlanInput} input
 * @returns {string}
 */
export function studyStatus(input) {
  return planState(input).unseen.length ? "learning" : "maintaining"
}

/**
 * Which piece in study most needs practice: the one with the most single
 * measures due by the end of today, the earliest due first on a tie; null
 * when nothing is due. A bar's hand alone counts while the bar has no
 * schedule hands together of its own, or while that bar is in trouble and
 * the hand has not held since: a hand alone left over from a retired
 * scaffold never flags its piece.
 * @param {Object} opts
 * @param {StudyRecord[]} opts.studies
 * @param {ItemRecord[]} opts.items every piece's
 * @param {number} opts.now
 * @returns {string|null} a piece id
 */
export function mostOverduePiece({studies, items, now}) {
  let endOfToday = dayStart(localDay(now) + 1)
  let studied = new Set(studies.filter(study => STUDYING.includes(study.status)).map(s => s.pieceId))

  let best = null
  for (let pieceId of studied) {
    let bars = items.filter(item => item.pieceId == pieceId && item.startMeasure == item.endMeasure &&
      !item.beats)
    let together = new Map(bars.filter(item => item.hand == "both").map(item => [item.startMeasure, item]))

    let offered = item => {
      if (item.hand == "both") { return true }
      let bar = together.get(item.startMeasure)
      if (!bar || !scheduled(bar)) { return true }

      let since = ON_LADDER.includes(bar.state) ? failedAt(bar) : null
      return since != null && !held(item, since)
    }

    let due = bars.filter(item => scheduled(item) && item.due < endOfToday && offered(item))
    if (!due.length) { continue }

    let earliest = Math.min(...due.map(item => item.due))
    if (!best || due.length > best.count || (due.length == best.count && earliest < best.earliest)) {
      best = {pieceId, count: due.length, earliest}
    }
  }

  return best ? best.pieceId : null
}

/**
 * @param {StudyRecord|null} study
 * @returns {boolean} whether the piece is in study, which makes the
 * programme its default
 */
export function inStudy(study) {
  return !!study && STUDYING.includes(study.status)
}


const HAND_WORDS = {both: "hands together", upper: "right hand", lower: "left hand"}

function daysAgo(then, now) {
  let days = localDay(now) - localDay(then)
  return days <= 0 ? "today" : days == 1 ? "yesterday" : `${days} days ago`
}

/**
 * The status line of an entry, eg. "Review · bar 11 · hands together · last
 * played 4 days ago", "New · bar 17", "Once more · bar 11".
 * @param {PlanEntry} entry
 * @param {Object} opts
 * @param {number} opts.now
 * @param {boolean} [opts.complete] prefixes "Programme complete"
 * @returns {string}
 */
export function entryStatus(entry, {now, complete=false}) {
  let bar = `bar ${entry.measure}`
  let hand = HAND_WORDS[entry.hand] || entry.hand
  let parts

  switch (entry.reason) {
    case NEW:
      parts = ["New", bar]
      break
    case REVIEW:
    case EARLY: {
      parts = ["Review", bar, hand]
      if (entry.item && entry.item.lastPracticed) {
        parts.push(`last played ${daysAgo(entry.item.lastPracticed, now)}`)
      }
      break
    }
    case RUN_THROUGH:
      parts = ["Run-through", bar]
      break
    default:
      parts = ["Once more", bar]
  }

  if (entry.reason != REVIEW && entry.reason != EARLY && entry.hand != "both") {
    parts.push(hand)
  }

  return [...(complete ? ["Programme complete"] : []), ...parts].join(" · ")
}

/**
 * The caption after a card, from its entry's item as the attempt left it:
 * "again in a moment" while it comes back within the hour, else when it
 * returns, eg. "returns in 3 days"; null when it isn't scheduled.
 * @param {ItemRecord|null} item
 * @param {number} now
 * @returns {string|null}
 */
export function entryCaption(item, now) {
  if (!item || !scheduled(item)) { return null }
  if (item.due - now < HOUR) { return "again in a moment" }

  let days = localDay(item.due) - localDay(now)
  return days <= 0 ? "returns later today" : days == 1 ? "returns tomorrow" : `returns in ${days} days`
}

/**
 * The caption after a card of the programme, from the state the attempt
 * leaves: its bar resting until the next sitting, eg. "Bar 19 rests until
 * your next sitting"; the hand scaffold offering it a hand alone next, eg. "Left hand
 * alone, then together"; the scaffold done with it, "hands together next";
 * else when it comes back (entryCaption).
 * @param {PlanEntry} entry the card's
 * @param {ItemRecord|null} item the entry's item as the attempt left it
 * @param {Object} state planState after the attempt
 * @returns {string|null}
 */
export function cardCaption(entry, item, state) {
  let {measure} = entry
  if (state.resting.has(measure)) { return `Bar ${measure} rests until your next sitting` }

  let scaffold = state.scaffolds.get(measure)
  if (scaffold && scaffold != entry.hand) {
    let words = HAND_WORDS[scaffold]
    return `${words[0].toUpperCase()}${words.slice(1)} alone, then together`
  }

  if (!scaffold && entry.hand != state.hand) { return "hands together next" }

  return entryCaption(item, state.now)
}
