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
//    LADDER_CAP items are on the ladder, new cards are at most half the cards
//    played and the due reviews fit in REVIEW_SHARE of the time left to the
//    target (with nothing else to do, up to IDLE_LADDER_CAP on the ladder).
//    Once the first fifth of the target has passed, a new measure these
//    limits allow goes ahead of the due reviews, so new material is
//    interleaved with them rather than left until they are all done;
// 4. an early review: an item in review not played today, lowest predicted
//    recall first;
// 5. a run-through: an item in review, least recently played first, which
//    the scheduler's same-day rule leaves unscheduled;
// 6. the next ladder rung, played before it comes due.
// Never the measure just played, save the retry and a piece of one measure.
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

import {itemId} from "st/srs/records"
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
 */

/**
 * The next measure to practise and the state of the programme.
 * @typedef {Object} PlanEntry
 * @property {string} reason one of RETRY, LADDER, REVIEW, NEW, EARLY, RUN_THROUGH, WAIT
 * @property {number} measure
 * @property {string} itemId
 * @property {ItemRecord|null} item null for a measure never scheduled
 * @property {string} hand
 */

// when an item was played: its graded attempts, and its last practice
const playedAt = item => [...item.recent.map(([at]) => at), item.lastPracticed]

// the session so far as the attempts on the items tell it
function sittingOf(items, now) {
  let times = [...new Set(items.flatMap(playedAt))]
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

/**
 * Everything the queue is picked from: the piece's single measure items of
 * the hand in the measures given, grouped by what the scheduler has them
 * doing, and the session so far.
 * @param {PlanInput} input
 * @returns {Object}
 */
export function planState({
  pieceId, items, measures, hand="both", now, settings=DEFAULT_SCHEDULER_SETTINGS,
  practice=DEFAULT_PRACTICE_SETTINGS, cardMeasures=1, previous=null,
}) {
  let order = new Map(measures.map((measure, idx) => [measure, idx]))
  let bars = items.filter(item => item.pieceId == pieceId && item.hand == hand &&
    item.startMeasure == item.endMeasure && !item.beats && order.has(item.startMeasure))
  let byMeasure = new Map(bars.map(item => [item.startMeasure, item]))

  let live = bars.filter(item => scheduled(item))
  let liveMeasures = new Set(live.map(item => item.startMeasure))
  let setAside = new Set(bars.filter(item => ["merged", "split", "suspended"].includes(item.state))
    .map(item => item.startMeasure))

  let sitting = sittingOf(bars, now)

  // the measures just played in this session: every measure of the last
  // card, and the entry named
  let lastCard = sitting.last != null && now - sitting.last <= SITTING_GAP_MS ? sitting.last : null
  let recent = new Set(lastCard == null ? [] :
    bars.filter(item => playedAt(item).includes(lastCard)).map(item => item.id))
  if (previous) { recent.add(previous) }

  let today = localDay(now)
  let endOfToday = dayStart(today + 1)

  let ladder = live.filter(item => ON_LADDER.includes(item.state))
  let review = live.filter(item => item.state == "review")
  let dueReviews = review.filter(item => item.due < endOfToday)
  let unseen = measures.filter(measure => !liveMeasures.has(measure) && !setAside.has(measure))

  let timed = live.filter(item => item.attempts > 0 && item.elapsedMs > 0)
  let barMs = timed.length ?
    timed.reduce((sum, item) => sum + item.elapsedMs / item.attempts, 0) / timed.length :
    DEFAULT_BAR_MS
  let cardMs = barMs * Math.max(1, Math.floor(cardMeasures) || 1)

  let targetMs = practice.sessionMinutes * MINUTE
  let elapsedMs = now - sitting.startedAt

  return {
    pieceId, hand, now, settings, order, byMeasure, recent, today, endOfToday,
    live, ladder, review, dueReviews, unseen, sitting,
    cardMs, targetMs, elapsedMs,
    complete: elapsedMs >= targetMs || (!ladder.length && !dueReviews.length && !unseen.length),
  }
}

// whether the item's next rung is the immediate retry after an again
const isRetry = item => ON_LADDER.includes(item.state) && item.lastGrade == 1 && item.due <= item.last

// the queue in order, as lists of candidates: never empty while the piece
// has a live item or a measure to learn
function candidates(state, {avoid}) {
  let {now, settings, order, recent, ladder, review, dueReviews, unseen, sitting} = state
  let recall = item => predictedRecall(item, now, settings)
  let measureOrder = (a, b) => order.get(a.startMeasure) - order.get(b.startMeasure)
  let other = item => !avoid || !recent.has(item.id) || isRetry(item)

  let rungs = ladder.filter(item => item.due <= now && other(item))
    .sort((a, b) => a.due - b.due || measureOrder(a, b))

  let warmUp = sitting.cards < WARM_UP_CARDS
  let due = dueReviews.filter(other)
    .sort((a, b) => (warmUp ? recall(b) - recall(a) : recall(a) - recall(b)) || measureOrder(a, b))

  let early = review.filter(item => item.due >= state.endOfToday &&
      localDay(item.lastPracticed) < state.today && other(item))
    .sort((a, b) => recall(a) - recall(b) || measureOrder(a, b))

  let runThrough = review.filter(other)
    .sort((a, b) => a.lastPracticed - b.lastPracticed || measureOrder(a, b))

  let waiting = ladder.filter(other).sort((a, b) => a.due - b.due || measureOrder(a, b))

  let newMeasures = unseen.filter(measure => !avoid || !recent.has(measureItemId(state, measure)))

  let idle = !rungs.length && !due.length && !early.length && !runThrough.length
  let cap = idle ? IDLE_LADDER_CAP : LADDER_CAP
  let remainingMs = state.targetMs - state.elapsedMs
  let fits = dueReviews.length * state.cardMs <= REVIEW_SHARE * remainingMs
  let share = sitting.newCards <= NEW_SHARE * sitting.cards
  let offerNew = ladder.length < cap && fits && (share || idle)
  let newEntry = offerNew ? newMeasures.slice(0, 1).map(measure => ({reason: NEW, measure})) : []

  // past the warm-up fifth of the session, new material the limits allow is
  // interleaved with the due reviews rather than waiting for them all
  let interleave = !warmUp && state.elapsedMs >= state.targetMs / 5

  return [
    ...rungs.map(item => ({reason: isRetry(item) ? RETRY : LADDER, item})),
    ...(interleave ? newEntry : []),
    ...due.map(item => ({reason: REVIEW, item})),
    ...(interleave ? [] : newEntry),
    ...early.map(item => ({reason: EARLY, item})),
    ...runThrough.map(item => ({reason: RUN_THROUGH, item})),
    ...waiting.map(item => ({reason: WAIT, item})),
  ]
}

const measureItemId = ({pieceId, hand}, measure) =>
  itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})

/**
 * The next entry of the queue.
 * @param {PlanInput} input
 * @returns {{entry: PlanEntry|null, complete: boolean, state: Object}} a
 * null entry only when the piece has no measure to play
 */
export function planNext(input) {
  let state = planState(input)

  // the measure just played only comes again when there's nothing else
  let [next] = candidates(state, {avoid: true})
  if (!next) {
    [next] = candidates(state, {avoid: false})
  }

  // a piece whose every measure waits past the target: its first new one
  if (!next && state.unseen.length) {
    next = {reason: NEW, measure: state.unseen[0]}
  }

  if (!next) {
    return {entry: null, complete: state.complete, state}
  }

  let measure = next.item ? next.item.startMeasure : next.measure
  let entry = {
    reason: next.reason,
    measure,
    itemId: next.item ? next.item.id : measureItemId(state, measure),
    item: next.item || null,
    hand: state.hand,
  }

  return {entry, complete: state.complete, state}
}

/**
 * What the programme holds for the piece before a session: the reviews due
 * and about how long they take, the new measures on offer, the target, and
 * the measures learned (in review) out of all.
 * @param {PlanInput} input
 * @returns {{due: number, dueMinutes: number, newMeasures: number, targetMinutes: number, learned: number, measures: number}}
 */
export function planSummary(input) {
  let state = planState(input)
  let due = state.dueReviews.length + state.ladder.filter(item => item.due < state.endOfToday).length
  return {
    due,
    dueMinutes: due ? Math.max(1, Math.round(due * state.cardMs / MINUTE)) : 0,
    newMeasures: state.unseen.length,
    targetMinutes: (input.practice || DEFAULT_PRACTICE_SETTINGS).sessionMinutes,
    learned: state.review.length,
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
 * measures due by the end of today (any hand), the earliest due first on a
 * tie; null when nothing is due.
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
    let due = items.filter(item => item.pieceId == pieceId && item.startMeasure == item.endMeasure &&
      !item.beats && scheduled(item) && item.due < endOfToday)
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
