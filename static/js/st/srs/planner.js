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
// 2. while the piece is read through (see below), the next bar not yet
//    played, in score order;
// 3. a review due today, lowest predicted recall first, after a warm-up of
//    the two likeliest recalled;
// 4. a new measure, the next not yet seen in the piece's introduction order
//    (PlanInput#introduce, score order without one; played hands together,
//    tonight's study below takes its place), while fewer than
//    LADDER_CAP items are on the ladder, the ones resting counted, new cards
//    are at most half the cards played and the due reviews fit in
//    REVIEW_SHARE of the time left to the target (with nothing else to do,
//    up to IDLE_LADDER_CAP on the ladder, and the sitting is over once the
//    bars resting fill that).
//    Once the first fifth of the target has passed, a new measure these
//    limits allow goes ahead of the due reviews, so new material is
//    interleaved with them rather than left until they are all done;
// 5. an early review: an item in review not played today, lowest predicted
//    recall first;
// 6. a run-through: an item in review, least recently played first, which
//    the scheduler's same-day rule leaves unscheduled;
// 7. the next ladder rung, played before it comes due.
// Never the measure just played, save the retry, its hand alone the hand
// scaffold sends next, a piece of one measure, and a new measure: nothing is
// graded on one yet, so a bar merely touched as a practice-only neighbour (a
// read-through's lead-in) or read through is still its own to introduce next.
//
// Tonight's study (PlanInput#study, state.study, the STUDY reason): played
// hands together on a piece of more than one playable bar, new material is
// learned a passage at a time rather than a bar at a time. The passages are
// laid out from the piece's flags in the introduction order given
// (layoutPassages: the pulled passage first, its repeats after it, then the
// rest in score order, each run split into passages of at most passageBars).
// A passage goes through four stages, each worked out from the items alone,
// so a reload resumes the same card: I READ, each bar of the passage not yet
// scheduled once, in cards kept inside the passage (a bar's hand alone where
// a flag started it apart); II HANDS, only for a bar the hand scaffold split,
// that hand alone until it holds; III TOGETHER, a forward chain from the
// passage's first bar, R1, R1-2, R1-3 and so on, each one clean pass longer
// than the last, a pass that slips dropping to the first bar that slipped,
// played alone until clean, before the chain resumes; IV FLOW, the passage
// from its lead-in (the bar before it, the seam), two passes running graded
// good or easy. A split bar shows stage II until its hand holds, whatever
// stage the passage is at. The passage rests until the next sitting when one
// of its bars rests (above), when in stage III a bar slips STUDY_SLIPS times
// in the sitting, or when in stage IV STUDY_SLIPS flow passes fail in it; no
// further passage opens meanwhile. Only the milestones are stored
// (StudyRecord#plan: the bars known before the plan, each passage opened with
// its stage and when the stage began, when it flowed, when the piece was
// learned), and the chain and the flow are told from the recent attempts and
// passes of the items after the stage began. Once every passage has flowed
// the piece is learned: the programme is maintenance alone and its study
// status reads "maintaining". The study takes rule 4's place in the queue: it
// goes ahead of the due reviews after the warm-up fifth, then takes turns
// with them (the card just played being a study card sends the next after
// the reviews), drops the ladder rungs its card already contains (the card
// grades them) and, with nothing else left, opens the next passage. A
// passage opens only where a new bar would have been offered. No rule of the
// study touches grading, FSRS or replay.
//
// Read through first: a piece new to the programme (none of its single
// measures of the session's hand ever scheduled) is read through once before
// any of it is learned, one bar at a time in score order, each played as
// practice alone (PlanInput#readThrough, state.toRead, the READ_THROUGH
// reason): a "read-through" review is logged, which the scheduler and replay
// never read, so a bar's first graded review comes at its second reading,
// when it is introduced. The player may skip it (StudyRecord#readThrough). A read-through left part way
// resumes at the first bar not yet played, from the items' attempts alone,
// and a piece with a bar already scheduled, or one of a single playable bar
// (whose card loops, so nothing of it would ever be graded), never reads
// through at all.
//
// The introduction order: once a piece is read through, or for one that
// skips the read-through (order SCORE_ORDER, or a piece without flagged
// passages in force for the session's hand), its new bars still arrive in
// an order (PlanInput#introduce, built by introduction()): READ_FIRST (the
// default) pulls the piece's hardest flagged passage, from the bar before it
// (its lead-in), early, with its repeats (a flag's alsoAt ranges) right
// after it, then the rest in score order with every other flag's repeats
// likewise pulled forward; HARDEST_FIRST pulls every Hard and Hardest
// passage that way; SCORE_ORDER pulls nothing, today's order exactly. Only a
// passage at PASSAGE_LEVEL or above is ever pulled (pulledPassage), so for a
// piece whose flags are all worth a look the two pulling orders bring
// nothing forward and differ by the read-through alone. A repeat keeps its
// own item and schedule: only the order it first arrives in
// changes. The order never reads the log and changes only which bar is
// first graded, never how a graded bar is scheduled, so the schedule stays
// what replay(reviews) rebuilds and SCHEDULER_ALGO is untouched by any of
// this.
//
// Hands apart, only where a bar needs it (the hand scaffold): a bar
// played hands together that fails (graded again) at first sight, or twice
// running later, with at least SCAFFOLD_SHARE of that failure's staff blames,
// and at least SCAFFOLD_MISSES, on one staff, is next offered as that hand
// alone, from the hand's own item on its own ladder, in its place in the
// queue. The blamed hand is read from that failure's review alone, so a bar
// whose failure has no review read isn't split. The bar returns hands
// together once the hand holds: its item graded good or better twice running
// since the failure, or graduated since, which its own last review tells
// from an interval merely extended. A miss is blamed on every hand whose
// notes it left untouched, so a failure spread over both hands blames
// neither staff enough and the bar stays together. A piece without a staff per
// hand never splits (handMeasures), nor does a session played with one hand,
// nor a bar only one hand has notes in: taking the other off it would leave
// the very same card. A drill the player grades themselves doesn't split
// either (split), though the hands' items still tell the rest rule and the
// sitting how the bar has gone.
// The scaffold is the planner's alone: it is worked out from the items and
// the last review of each bar, and writes nothing, so the schedule stays what
// replay rebuilds. The count of a piece's bars due must follow the same rule,
// or a scaffold the planner has retired keeps flagging its piece as overdue
// (mostOverduePiece, which reads items alone). A hand alone the player has
// practised by choice, in free practice or a programme played with that
// hand, is marked deliberate on its item (ItemRecord#deliberate) and always
// counts there, so only the scaffold's own hand items follow the retirement
// rule above.
//
// Hands apart from the start, where a flag asks for it (decision 6,
// startApart): a bar a flag ticks "start this passage hands separately"
// is introduced hands apart rather than together, at introduction only - a
// bar already learned hands together keeps the hand scaffold above, not
// this. Applies only where the bar could split anyway (apart, both hands
// have notes) and only while split holds, same as the scaffold. The bar's
// first listed hand that hasn't held stands in for it: with no item of its
// own yet, it is the new entry under rule 4, in the bar's place among the
// unseen measures, as a new slot of that hand; once it has an item on the
// ladder, it is a ladder slot on its own schedule, counted toward
// LADDER_CAP like any rung (startApartIntroductions). A both-hands flag
// offers the right hand first, then the left, same as a both-hands
// "practise hands separately" pill elsewhere. Held here means: graded good
// or better twice running, or graduated to review (startApartHeld); items
// alone, no review needed, since the graduation case only wants the state
// a bar's own last review already carries. Once every listed hand holds,
// the bar is unseen hands together and comes as a normal NEW entry. The
// read-through above is never split: it grades nothing and a bar counts as
// read by the session hand's own item, so it is always played with the
// session's hand. These
// hand items are scaffold items too (PlanDeck#scaffold is entry.hand !=
// sessionHand), so they are never marked deliberate, and mostOverduePiece
// already counts one while its bar has no hands-together item and stops
// once it does, without reading flags. The rest rule below counts these
// hands' attempts like any other, so a bar introduced hands apart rests
// after its third failure in the sitting too, hands apart or together.
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
export const READ_THROUGH = "read-through"
export const STUDY = "study"

// the introduction order a piece's new bars arrive in, see introduction()
export const READ_FIRST = "read through"
export const HARDEST_FIRST = "hardest first"
export const SCORE_ORDER = "in score order"
export const INTRODUCTION_ORDERS = [READ_FIRST, HARDEST_FIRST, SCORE_ORDER]

// the level (st/difficulty) a flagged passage reaches to be pulled forward,
// see introduction() and pulledPassage()
export const PASSAGE_LEVEL = 2

// a failure sends a bar's hand alone when that hand's staff took at least
// this share of its staff blames, and at least SCAFFOLD_MISSES of them
export const SCAFFOLD_SHARE = 2 / 3
export const SCAFFOLD_MISSES = 2

// the failures in a sitting after which a bar rests until the next
export const REST_FAILURES = 3

export const STUDYING = ["learning", "maintaining"]

// the stages of tonight's study, see the header
export const READ = 1
export const HANDS = 2
export const TOGETHER = 3
export const FLOW = 4
export const STAGE_NAMES = {[READ]: "Read", [HANDS]: "Hands", [TOGETHER]: "Together", [FLOW]: "Flow"}

// the bars a passage takes, by default, at least and at most
export const PASSAGE_BARS = 4
export const MIN_PASSAGE_BARS = 2
export const MAX_PASSAGE_BARS = 6

// the slips of one bar (stage III) or failed flow passes (stage IV) in a
// sitting after which a passage rests until the next
export const STUDY_SLIPS = 3

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
 * @property {boolean} [split] whether a bar may be offered hands apart at
 * all, true by default; the hands' items are read either way, so the rest
 * rule and the sitting see every card played
 * @property {Map<string, ReviewRecord>} [lastReviews] the last graded review
 * known of an item, by item id, whose staffMisses say which hand a failure's
 * misses fell on
 * @property {number[]|null} [introduce] the piece's bar numbers in the order
 * new bars should arrive (see introduction()), score order when left out
 * @property {boolean} [readThrough] whether the piece is read through once
 * before any of its bars not yet scheduled are learned
 * @property {{record: StudyRecord|null, flags: Object[], order: string,
 * passageBars: number}|null} [study] tonight's study, given for a session
 * played hands together (see the header): the piece's stored study, its
 * flags in force (st/difficulty flagsInForce, hardest first), the
 * introduction order and the bars a passage takes
 * @property {boolean} [previousStudy] whether the card just played was a
 * STUDY entry, which sends the next study card after the due reviews
 * @property {Map<number, string[]>} [startApart] bars a flag ticked "start
 * this passage hands separately" asks to introduce hands apart (decision 6,
 * st/difficulty/decisions.startApartBars), each with the hand(s) it names,
 * both hands listed right first; see the header's start-apart paragraph
 */

/**
 * The next measure to practise and the state of the programme.
 * @typedef {Object} PlanEntry
 * @property {string} reason one of RETRY, LADDER, REVIEW, NEW, EARLY,
 * RUN_THROUGH, WAIT, READ_THROUGH, STUDY
 * @property {number} measure
 * @property {string} itemId
 * @property {ItemRecord|null} item null for a measure never scheduled
 * @property {string} hand the session's hand, or the hand alone of a bar
 * the hand scaffold offers
 * @property {number[]} [measures] the bars of the card, given while tonight's
 * study applies (never for a READ_THROUGH entry): the study's own card, or the
 * entry's bar among the scheduled bars and the current passage
 * @property {number} [stage] STUDY only, one of READ, HANDS, TOGETHER, FLOW
 * @property {{start: number, end: number, from: string, words: string|null}} [passage]
 * STUDY only: the passage the card belongs to
 * @property {boolean} [early] STUDY only: a hand alone played before its
 * rung comes due, which the off-schedule rule applies to
 */

/**
 * A counting flag's bar, for the status line words (see entryStatus).
 * @typedef {Object} PassageRole
 * @property {string} role "passage", "lead-in" or "repeat"
 * @property {number} start the flag's own start
 * @property {number} end the flag's own end
 * @property {number} level the flag's level, 1-3
 */

/**
 * The counting flags of a session: those that apply to hand, see
 * introduction().
 * @param {Object[]} passages flags in force (st/difficulty flagsInForce),
 * hardest first
 * @param {string} [hand]
 * @returns {Object[]}
 */
export function passagesForHand(passages, hand="both") {
  return passages.filter(flag => hand == "both" || flag.hand == "both" || flag.hand == hand)
}

/**
 * The hardest counting passage an order pulls forward: the first flag at
 * PASSAGE_LEVEL or above, see introduction(). Null when none of the piece's
 * passages is flagged that hard, where READ_FIRST and HARDEST_FIRST bring
 * nothing forward and what the orders say of them must say so too (the
 * programme plate's order row, the drawer's hint).
 * @param {Object[]} passages flags in force, hardest first
 * @param {string} [hand]
 * @returns {Object|null}
 */
export function pulledPassage(passages, hand="both") {
  return passagesForHand(passages, hand).find(flag => flag.level >= PASSAGE_LEVEL) || null
}

/**
 * The order a piece's new bars should arrive in (decisions 1 and 7 of the
 * hard-sections design): which bar introduction() pulls forward, from which
 * lead-in, and the role of every bar a counting flag touches, for the status
 * line words (entryStatus).
 * @param {Object} opts
 * @param {number[]} opts.measures the playable bar numbers, in score order
 * @param {Object[]} [opts.passages] flags in force (st/difficulty
 * flagsInForce), hardest first: {start, end, level, hand, alsoAt?}
 * @param {string} [opts.order] one of INTRODUCTION_ORDERS
 * @param {string} [opts.hand] the session's hand
 * @returns {{introduce: number[]|null, readThrough: boolean, roles: Map<number, PassageRole>}}
 */
export function introduction({measures, passages=[], order=READ_FIRST, hand="both"}) {
  let counting = passagesForHand(passages, hand)

  // every counting flag's playable bars, worked out once per flag: the deck
  // builds the introduction afresh on every plan, which the trainer's status
  // line reaches on every render, so nothing here is worked out per bar
  let flagBars = new Map(counting.map(flag =>
    [flag, measures.filter(measure => measure >= flag.start && measure <= flag.end)]))
  let barsOf = flag => flagBars.get(flag) || []

  // every bar of a counting flag gets the passage role, in force order
  // (hardest first), an earlier flag's role never overwritten; marked in
  // every order, including SCORE_ORDER, so a flagged bar is named as it comes
  let roles = new Map()
  for (let flag of counting) {
    for (let measure of barsOf(flag)) {
      if (!roles.has(measure)) {
        roles.set(measure, {role: "passage", start: flag.start, end: flag.end, level: flag.level})
      }
    }
  }

  if (!counting.length || order == SCORE_ORDER) {
    return {introduce: null, readThrough: false, roles}
  }

  // the playable bar just before a flag's first playable bar, by index;
  // none for a flag opening the piece
  let leadIn = flag => {
    let bars = barsOf(flag)
    if (!bars.length) { return null }
    let idx = measures.indexOf(bars[0])
    return idx > 0 ? measures[idx - 1] : null
  }
  // likewise once per flag: the bars of its repeats, and which flags' repeats
  // follow a bar in score order, by that flag's last playable bar (decision 7)
  let flagRepeats = new Map(counting.map(flag => [flag, (flag.alsoAt || []).flatMap(([from, to]) =>
    measures.filter(measure => measure >= from && measure <= to))]))
  let repeatsOf = flag => flagRepeats.get(flag) || []
  let repeatsAfter = new Map()
  for (let flag of counting) {
    let bars = barsOf(flag)
    if (!bars.length) { continue }
    let last = bars[bars.length - 1]
    if (!repeatsAfter.has(last)) { repeatsAfter.set(last, []) }
    repeatsAfter.get(last).push(flag)
  }

  // READ_FIRST pulls the first counting flag hard enough, HARDEST_FIRST
  // every one
  let pulled = order == HARDEST_FIRST ? counting.filter(flag => flag.level >= PASSAGE_LEVEL) :
    [pulledPassage(counting)].filter(Boolean)

  let seen = new Set()
  let introduce = []
  let add = measure => {
    if (seen.has(measure)) { return }
    seen.add(measure)
    introduce.push(measure)
  }
  let markRole = (measure, kind, flag) => {
    if (!roles.has(measure)) { roles.set(measure, {role: kind, start: flag.start, end: flag.end, level: flag.level}) }
  }

  // each pulled passage, early, from its lead-in, with its repeats right
  // after it
  for (let flag of pulled) {
    let lead = leadIn(flag)
    if (lead != null) {
      add(lead)
      markRole(lead, "lead-in", flag)
    }
    for (let measure of barsOf(flag)) { add(measure) }
    for (let measure of repeatsOf(flag)) {
      add(measure)
      markRole(measure, "repeat", flag)
    }
  }

  // the rest, in score order; right after a flag's last playable bar, at any
  // level, its repeats (decision 7)
  for (let measure of measures) {
    add(measure)
    for (let flag of repeatsAfter.get(measure) || []) {
      for (let repeat of repeatsOf(flag)) {
        add(repeat)
        markRole(repeat, "repeat", flag)
      }
    }
  }

  // a piece of a single playable bar is never read through: its one card
  // loops, so the read-through would never end and nothing of it be graded
  return {introduce, readThrough: order == READ_FIRST && measures.length > 1, roles}
}

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
 * The staff a failure's misses fell on enough to send that hand alone: at
 * least SCAFFOLD_MISSES of them, and at least SCAFFOLD_SHARE of every blame
 * the failure laid on a staff. A miss with both hands' notes untouched is
 * blamed on both staves, so the share is measured against those blames and
 * not the review's miss count: a failure spread over both hands blames
 * neither staff enough, and at most one staff is ever blamed.
 * @param {ReviewRecord} review
 * @returns {string[]|null} of STAVES, at most one, null for a review whose
 * misses aren't split by staff
 */
export function blamedStaves(review) {
  let misses = review && review.staffMisses
  if (!misses) { return null }

  let blamed = STAVES.reduce((sum, staff) => sum + misses[staff], 0)
  return STAVES.filter(staff =>
    misses[staff] >= SCAFFOLD_MISSES && misses[staff] >= SCAFFOLD_SHARE * blamed)
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
 * alone as, while the bar is in trouble and until the hand blamed holds.
 * The hand blamed comes from that failure's review alone, so a bar whose
 * failure has no review read isn't split.
 * @param {ItemRecord} bar the bar's hands together item
 * @param {Object} opts
 * @param {Object<string, ItemRecord>} [opts.hands] the bar's items of each hand
 * alone, by hand
 * @param {Map<string, ReviewRecord>} [opts.reviews] the last graded review
 * known of each item, by item id: the bar's says which hand its failure
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

// whether a start-apart hand holds, for introduction purposes alone (the
// header's start-apart paragraph): two goods running, or graduated to
// review. Items alone; no review read, since the graduation case only
// wants the state the item's own last review already carries
function startApartHeld(item) {
  if (!item) { return false }

  let grades = item.recent.map(gradeOf)
  let n = grades.length
  if (n >= 2 && grades[n - 1] >= GOOD && grades[n - 2] >= GOOD) { return true }

  return item.state == "review"
}

/**
 * Decision 6's input, resolved against this plan: the unseen bars a flag
 * asks to start hands apart, each with the hand that currently stands in
 * for it, kept in its own helper so it composes with however `unseen` and
 * `candidates` are built elsewhere (see the header's start-apart paragraph).
 * @param {Object} opts
 * @param {Map<number, string[]>|null} opts.startApart PlanInput's
 * @param {Set<number>} opts.apart bars both hands have notes in
 * @param {boolean} opts.split
 * @param {Map<number, Object>} opts.handItems a bar's items by hand (handsByMeasure)
 * @param {number[]} opts.unseen measures with no live hands-together item
 * @returns {Map<number, {measure: number, hand: string, heldIndex: number,
 * hands: string[], item: ItemRecord|null}>}
 */
function startApartIntroductions({startApart, apart, split, handItems, unseen}) {
  let intros = new Map()
  if (!split || !startApart || !startApart.size) { return intros }

  for (let measure of unseen) {
    if (!apart.has(measure)) { continue }

    let hands = startApart.get(measure)
    if (!hands || !hands.length) { continue }

    let byHand = handItems.get(measure) || {}
    let heldIndex = 0
    while (heldIndex < hands.length && startApartHeld(byHand[hands[heldIndex]])) { heldIndex++ }
    if (heldIndex >= hands.length) { continue } // every listed hand holds: a normal NEW entry

    intros.set(measure, {
      measure, hand: hands[heldIndex], heldIndex, hands, item: byHand[hands[heldIndex]] || null,
    })
  }

  return intros
}

// "Left hand alone, then together", or for a both-hands flag's first phase
// "Right hand alone, then the left" (right comes first, see startApartBars)
function startApartCaptionFor({hands, heldIndex}) {
  let current = HAND_WORDS[hands[heldIndex]]
  let currentCap = `${current[0].toUpperCase()}${current.slice(1)}`
  let remaining = hands.slice(heldIndex + 1)
  if (!remaining.length) { return `${currentCap} alone, then together` }

  return `${currentCap} alone, then ${remaining[0] == "lower" ? "the left" : "the right"}`
}


/**
 * A passage's bar count the setting gives, kept from MIN_PASSAGE_BARS to
 * MAX_PASSAGE_BARS, PASSAGE_BARS when it isn't a number.
 * @param {*} value
 * @returns {number}
 */
export const passageBarsOf = value =>
  Math.min(MAX_PASSAGE_BARS, Math.max(MIN_PASSAGE_BARS, Math.floor(value) || PASSAGE_BARS))

/**
 * A run of bars split into balanced chunks of at most size: as few chunks as
 * the size allows, the earlier ones the larger.
 * @param {number[]} run
 * @param {number} size
 * @returns {number[][]}
 */
export function splitRun(run, size) {
  let count = Math.ceil(run.length / size)
  let base = Math.floor(run.length / count)
  let extra = run.length % count

  let chunks = []
  let from = 0
  for (let chunk = 0; chunk < count; chunk++) {
    let length = base + (chunk < extra ? 1 : 0)
    chunks.push(run.slice(from, from + length))
    from += length
  }
  return chunks
}

/**
 * The passages tonight's study learns a piece in, in learning order.
 * First the passages the order pulls forward (READ_FIRST the hardest flag,
 * HARDEST_FIRST every flag at PASSAGE_LEVEL or above, SCORE_ORDER none), each
 * followed by its repeats (a flag's alsoAt ranges); then the rest in score
 * order, each run of bars that share their first counting flag (or have
 * none) a group, a flag's repeats following its group once its last bar has
 * been laid out. Every group is split into runs contiguous among the
 * playable bars, then into balanced chunks of at most passageBars.
 * @param {Object} opts
 * @param {number[]} opts.measures the playable bars, in score order
 * @param {Object[]} [opts.flags] flags in force, hardest first
 * @param {string} [opts.order] one of INTRODUCTION_ORDERS
 * @param {string} [opts.hand] the session's hand
 * @param {number} [opts.passageBars]
 * @param {number[]} [opts.exclude] bars never laid out: those known, in a
 * passage already opened, or set aside
 * @returns {{start: number, end: number, from: string}[]} from is "score" or
 * `flag:${flag.id}`
 */
export function layoutPassages({measures, flags=[], order=READ_FIRST, hand="both", passageBars=PASSAGE_BARS, exclude=[]}) {
  let size = passageBarsOf(passageBars)
  let index = new Map(measures.map((measure, idx) => [measure, idx]))
  let counting = passagesForHand(flags, hand)
  let covered = new Set(exclude)
  let passages = []

  let barsIn = (from, to) => measures.filter(measure => measure >= from && measure <= to)
  let fromOf = flag => `flag:${flag.id}`
  let repeatsOf = flag => (flag.alsoAt || []).flatMap(([from, to]) => barsIn(from, to))

  let take = (bars, from) => {
    let runs = []
    for (let measure of bars) {
      if (covered.has(measure) || !index.has(measure)) { continue }

      let run = runs[runs.length - 1]
      if (run && index.get(measure) == index.get(run[run.length - 1]) + 1) {
        run.push(measure)
      } else {
        runs.push([measure])
      }
      covered.add(measure)
    }

    for (let run of runs) {
      for (let chunk of splitRun(run, size)) {
        passages.push({start: chunk[0], end: chunk[chunk.length - 1], from})
      }
    }
  }

  let pulled = order == HARDEST_FIRST ? counting.filter(flag => flag.level >= PASSAGE_LEVEL) :
    order == READ_FIRST ? [pulledPassage(counting)].filter(Boolean) : []
  for (let flag of pulled) {
    take(barsIn(flag.start, flag.end), fromOf(flag))
    take(repeatsOf(flag), fromOf(flag))
  }

  // a bar's first counting flag, found once per flag rather than per bar
  let flagBars = new Map(counting.map(flag => [flag, new Set(barsIn(flag.start, flag.end))]))
  let flagOf = measure => counting.find(flag => flagBars.get(flag).has(measure)) || null

  let group = []
  let groupFlag = null
  let flush = () => {
    if (!group.length) { return }

    let last = group[group.length - 1]
    take(group, groupFlag ? fromOf(groupFlag) : "score")
    if (groupFlag) {
      let own = barsIn(groupFlag.start, groupFlag.end)
      if (own[own.length - 1] == last) { take(repeatsOf(groupFlag), fromOf(groupFlag)) }
    }
    group = []
  }

  for (let measure of measures) {
    if (covered.has(measure)) {
      flush()
      continue
    }

    let flag = flagOf(measure)
    if (group.length && flag !== groupFlag) { flush() }
    groupFlag = flag
    group.push(measure)
  }
  flush()

  return passages
}

// the history a bar's item keeps of its passes, practice alone included, or
// of its graded attempts where it keeps no passes: [at, columns, clean, grade]
const historyOf = item => item ? (item.passes ?? item.recent) : []

// whether a pass at a range was a clean one: every column hit without a
// slip, or for a self-graded pass (no columns) graded good or better
const cleanPass = ([, columns, clean, grade]) =>
  columns == null ? grade != null && grade >= GOOD : columns > 0 && clean == columns

// whether a flow pass counts: graded good or better where it was graded,
// else played clean (a pass written as practice alone has no grade)
const flowPass = entry => entry[3] != null ? entry[3] >= GOOD : cleanPass(entry)

const barsBetween = (measures, start, end) => measures.filter(measure => measure >= start && measure <= end)

/**
 * Tonight's study as the items leave it (see the header), for planState.
 * @param {Object} state planState so far
 * @param {Object} opts
 * @param {Object} opts.study PlanInput#study
 * @param {ItemRecord[]} opts.items the piece's items, any hand
 * @returns {Object} {plan, known, passages, current, next, upcoming, learned, levels,
 * flowed}: the stored plan (null before one is written), the bars known,
 * a view of each passage opened, the one in progress, the passage that would
 * open next, the passages still to open, whether the piece is learned, the
 * flags by passage origin and the count of passages flowed
 */
function deriveStudy(state, {study: {record, flags=[], order=READ_FIRST, passageBars=PASSAGE_BARS}, items}) {
  let {pieceId, hand, now, measures} = state
  let plan = record && record.plan || null
  let rangeId = (start, end) => itemId({pieceId, hand, startMeasure: start, endMeasure: end})

  let byId = new Map(items.filter(item => item.hand == hand).map(item => [item.id, item]))
  let singles = items.filter(item => item.startMeasure == item.endMeasure && !item.beats)
  let handItems = new Map(singles.filter(item => STAVES.includes(item.hand))
    .map(item => [`${item.hand}:${item.startMeasure}`, item]))
  let touched = new Map()
  for (let item of singles) {
    if (item.lastPracticed > now) { continue }
    touched.set(item.startMeasure, Math.max(touched.get(item.startMeasure) || 0, item.lastPracticed))
  }
  let levels = new Map(flags.map(flag => [`flag:${flag.id}`, flag]))

  let known = new Set(plan ? (plan.known || []).flatMap(([start, end]) => barsBetween(measures, start, end)) :
    [...state.liveMeasures])
  let opened = plan ? plan.passages : []
  let openedBars = new Set(opened.flatMap(passage => barsBetween(measures, passage.start, passage.end)))
  let upcoming = layoutPassages({
    measures, flags, order, hand, passageBars,
    exclude: [...known, ...openedBars, ...state.setAside],
  })

  let lastTouch = bars => Math.max(0, ...bars.map(measure => touched.get(measure) || 0))
  let history = (start, end) => {
    let item = start == end ? state.byMeasure.get(start) : byId.get(rangeId(start, end))
    return start == end ? historyOf(item) : item ? item.recent : []
  }

  let view = (passage, isOpen) => {
    let bars = barsBetween(measures, passage.start, passage.end)
    let flowedAt = isOpen ? passage.flowedAt || null : null
    let base = {start: passage.start, end: passage.end, from: passage.from, bars, open: isOpen}

    // a stored passage no bar of which can be played any more (the study was
    // imported for another edition) has nothing left to learn
    if (!bars.length) {
      return {
        ...base, lead: null, openedAt: passage.openedAt ?? null, stage: FLOW, stageAt: now, effective: null,
        flowedAt: flowedAt ?? now, handsPlayed: [], resting: false, restReason: null, lastFlow: false,
        slipped: null, card: null,
      }
    }

    let first = measures.indexOf(bars[0])
    let lead = first > 0 ? measures[first - 1] : null
    let stage = isOpen ? passage.stage : READ
    let stageAt = isOpen ? passage.stageAt : now
    let openedAt = isOpen ? passage.openedAt : now
    let scaffolded = bars.filter(measure => state.scaffolds.has(measure))

    if (stage == READ && bars.every(measure => state.liveMeasures.has(measure))) {
      stage = HANDS
      stageAt = lastTouch(bars)
    }
    if (stage == HANDS && !scaffolded.length) {
      stage = TOGETHER
      stageAt = lastTouch(bars)
    }

    // the passes since the stage began at a chain of the passage's first
    // bars, or at a range
    let chain = length => history(bars[0], bars[length - 1]).filter(([at]) => at > stageAt && at <= now)
    let flowBars = lead != null ? [lead, ...bars] : bars
    let flowPasses = () => history(flowBars[0], flowBars[flowBars.length - 1])
      .filter(([at]) => at > stageAt && at <= now)

    if (stage == TOGETHER && !flowedAt) {
      let whole = chain(bars.length).find(cleanPass)
      if (whole) {
        stage = FLOW
        stageAt = whole[0]
      }
    }

    let flows = []
    if (stage == FLOW && !flowedAt) {
      flows = flowPasses()
      for (let idx = 1; idx < flows.length; idx++) {
        if (flowPass(flows[idx]) && flowPass(flows[idx - 1])) {
          flowedAt = flows[idx][0]
          break
        }
      }
    }

    // a split bar sends the passage back to stage II until its hand holds
    let effective = flowedAt ? null : stage >= HANDS && scaffolded.length ? HANDS : stage

    let restingBars = bars.filter(measure => state.resting.has(measure))
    if (effective == FLOW && lead != null && state.resting.has(lead)) { restingBars.push(lead) }

    let since = Math.max(stageAt, state.sitting.startedAt)
    let sitting = ([at]) => at > since && at <= now
    let slipped = stage == TOGETHER ?
      bars.find(measure => historyOf(state.byMeasure.get(measure))
        .filter(entry => sitting(entry) && !cleanPass(entry)).length >= STUDY_SLIPS) : undefined
    let failedFlows = stage == FLOW && !flowedAt ? flows.filter(entry => sitting(entry) && !flowPass(entry)).length : 0

    let restReason = flowedAt ? null : restingBars.length ? "bar" : slipped != null ? "slips" :
      failedFlows >= STUDY_SLIPS ? "flow" : null
    let resting = restReason != null

    let handsPlayed = bars.flatMap(measure => STAVES.flatMap(staff => {
      let own = handItems.get(`${staff}:${measure}`)
      return own && historyOf(own).some(([at]) => at >= openedAt && at <= now) ? [{measure, hand: staff}] : []
    }))

    let card = null
    if (!flowedAt && !resting) {
      let plain = {hand, early: false}
      if (effective == READ) {
        let measure = bars.find(bar => !state.liveMeasures.has(bar))
        let intro = state.startApartIntros.get(measure)
        card = intro ?
          {
            measures: [measure], hand: intro.hand, item: intro.item,
            itemId: intro.item ? intro.item.id : itemId({pieceId, hand: intro.hand, startMeasure: measure, endMeasure: measure}),
            early: !!intro.item && scheduled(intro.item) && intro.item.due > now,
          } :
          {
            ...plain, measures: anchoredCard(bars, measure, state.cardMeasures),
            item: state.byMeasure.get(measure) || null, itemId: rangeId(measure, measure),
          }
      } else if (effective == HANDS) {
        let slots = state.ladder.filter(slot => slot.hand != hand && bars.includes(slot.measure))
          .sort((a, b) => a.due - b.due || state.order.get(a.measure) - state.order.get(b.measure))
        let slot = slots.find(candidate => candidate.id != state.previous) || slots[0]
        card = slot && {measures: [slot.measure], hand: slot.hand, item: slot.item, itemId: slot.id, early: slot.due > now}
      } else if (effective == TOGETHER) {
        // the longest chain with a clean pass since the stage began, and the
        // next one longer to play, but for a bar that slipped in the chain
        // last played, which is played alone until clean
        let longest = 0
        for (let length = bars.length; length >= 1; length--) {
          if (chain(length).some(cleanPass)) {
            longest = length
            break
          }
        }

        let target = bars.slice(0, Math.min(bars.length, longest + 1))
        let passes = chain(target.length)
        let lastPass = passes[passes.length - 1]
        let dropTo = null
        if (lastPass && !cleanPass(lastPass)) {
          let failing = target.find(measure => historyOf(state.byMeasure.get(measure))
            .some(entry => entry[0] == lastPass[0] && !cleanPass(entry)))
          let cleaned = failing != null && historyOf(state.byMeasure.get(failing))
            .some(entry => entry[0] > lastPass[0] && entry[0] <= now && cleanPass(entry))
          if (failing != null && !cleaned) { dropTo = failing }
        }

        let cardBars = dropTo != null ? [dropTo] : target
        let id = rangeId(cardBars[0], cardBars[cardBars.length - 1])
        card = {...plain, measures: cardBars, item: byId.get(id) || null, itemId: id, dropped: dropTo != null}
      } else if (effective == FLOW) {
        let id = rangeId(flowBars[0], flowBars[flowBars.length - 1])
        card = {...plain, measures: flowBars, item: byId.get(id) || null, itemId: id}
      }
    }

    let lastFlow = stage == FLOW && !flowedAt && flows.length > 0 && flowPass(flows[flows.length - 1])

    return {
      ...base, lead, openedAt: isOpen ? passage.openedAt : null, stage, stageAt, effective, flowedAt,
      handsPlayed, resting, restReason, lastFlow, slipped: slipped ?? null, card,
    }
  }

  let passages = opened.map(passage => view(passage, true))
  let current = passages.find(passage => !passage.flowedAt) || null
  let next = current || !upcoming.length ? null : view(upcoming[0], false)
  let learned = !!(plan && plan.learnedAt) || (!current && !upcoming.length)

  return {
    plan, known, passages, current, next, upcoming, learned, levels,
    flowed: passages.filter(passage => passage.flowedAt).length,
  }
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
  split=true, lastReviews=new Map(), introduce=null, readThrough=false, startApart=null,
  study=null, previousStudy=false,
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

  // never scheduled, nor set aside: the measures still to learn, in the
  // piece's introduction order when given (its bars first, any it leaves out
  // following in score order), else exactly score order
  let notLive = measure => !liveMeasures.has(measure) && !setAside.has(measure)
  let unseen
  if (introduce) {
    let ordered = introduce.filter(measure => order.has(measure) && notLive(measure))
    let already = new Set(ordered)
    unseen = [...ordered, ...measures.filter(measure => notLive(measure) && !already.has(measure))]
  } else {
    unseen = measures.filter(notLive)
  }

  // the piece is read through while none of its bars is scheduled yet: every
  // playable bar not yet played (its single measure item of the session's
  // hand with no attempts), in score order
  let readingThrough = readThrough && !live.length
  let toRead = readingThrough ?
    measures.filter(measure => !setAside.has(measure) && !((byMeasure.get(measure) || {}).attempts > 0)) : []

  // decision 6: a flag's startApart bar, still unseen hands together, is
  // introduced hands apart instead - a ladder slot of its own if its hand
  // already has an item on schedule, else as the NEW entry newSlot gives it
  // (see the header's start-apart paragraph)
  let startApartIntros = startApartIntroductions({startApart, apart, split, handItems, unseen})

  let sitting = sittingOf(bars, handBars, now)

  // the measures just played in this session: every measure of the last
  // card, and the entry named
  let lastCard = sitting.last != null && now - sitting.last <= SITTING_GAP_MS ? sitting.last : null
  let recent = new Set(lastCard == null ? [] :
    [...bars, ...handBars].filter(item => playedAt(item).includes(lastCard)).map(item => item.id))
  if (previous) { recent.add(previous) }

  // the bars the programme has in hand, failed REST_FAILURES times in the
  // sitting whichever hand played them, rest. A bar introduced hands apart
  // is in hand through its hand's item, with no hands-together one of its own
  let failures = new Map()
  for (let item of [...bars, ...handBars]) {
    let measure = item.startMeasure
    if (!liveMeasures.has(measure) && !startApartIntros.has(measure)) { continue }
    let failed = item.recent.filter(([at, , , grade]) =>
      grade == AGAIN && at >= sitting.startedAt && at <= now).length
    failures.set(measure, (failures.get(measure) || 0) + failed)
  }
  let resting = new Set([...failures].filter(([, count]) => count >= REST_FAILURES).map(([measure]) => measure))

  let today = localDay(now)
  let endOfToday = dayStart(today + 1)

  // an item's place in the queue, or its hand alone's while the hand
  // scaffold holds the bar: due when the bar failed until the hand has been
  // graded since, then on the hand's own schedule
  let slotOf = item => {
    let measure = item.startMeasure
    let scaffold = split && apart.has(measure) && ON_LADDER.includes(item.state) ?
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
  let failing = new Set(!split ? [] : live.filter(item => apart.has(item.startMeasure) &&
    ON_LADDER.includes(item.state) && failedAt(item) != null).map(item => item.id))
  // the bars in progress, whether or not they rest: what the ladder holds
  let laddered = live.filter(item => ON_LADDER.includes(item.state)).length
  let ladder = awake.filter(item => ON_LADDER.includes(item.state)).map(slotOf)
  let review = awake.filter(item => item.state == "review").map(slotOf)
  let dueReviews = review.filter(slot => slot.item.due < endOfToday)

  // a start-apart introduction whose hand is already on the ladder: counted
  // toward LADDER_CAP whether or not its bar rests, like any rung, and
  // offered as a slot of its own only while it is awake
  let startApartOnLadder = [...startApartIntros.values()]
    .filter(intro => intro.item && scheduled(intro.item) && ON_LADDER.includes(intro.item.state))
  let startApartLadderMeasures = new Set(startApartOnLadder.map(intro => intro.measure))
  ladder = [...ladder, ...startApartOnLadder
    .filter(intro => !resting.has(intro.measure))
    .map(intro => ({
      id: intro.item.id, measure: intro.measure, hand: intro.hand, item: intro.item,
      due: intro.item.due, retry: isRetry(intro.item),
    }))]
  laddered = laddered + startApartOnLadder.length
  let startApartCaptions = new Map(
    [...startApartIntros].map(([measure, intro]) => [measure, startApartCaptionFor(intro)]))

  let scaffolds = new Map(ladder.filter(slot => slot.hand != hand).map(slot => [slot.measure, slot.hand]))

  // the measures this sitting may introduce now: unseen stays everything the
  // piece has left to learn, whatever the sitting makes of it (planSummary,
  // studyStatus), so a bar resting until the next sitting or already on its
  // start-apart hand's own ladder is dropped here rather than there
  let offerable = unseen.filter(measure =>
    !resting.has(measure) && !startApartLadderMeasures.has(measure))

  let timed = live.filter(item => item.attempts > 0 && item.elapsedMs > 0)
  let barMs = timed.length ?
    timed.reduce((sum, item) => sum + item.elapsedMs / item.attempts, 0) / timed.length :
    DEFAULT_BAR_MS
  let cardMs = barMs * Math.max(1, Math.floor(cardMeasures) || 1)

  let targetMs = practice.sessionMinutes * MINUTE
  let elapsedMs = now - sitting.startedAt

  let state = {
    pieceId, hand, now, settings, order, byMeasure, recent, today, endOfToday,
    live, awake, failing, ladder, laddered, review, dueReviews, unseen, offerable, toRead, resting,
    scaffolds, sitting,
    startApartIntros, startApartCaptions,
    cardMs, targetMs, elapsedMs,
    measures, cardMeasures: Math.max(1, Math.floor(cardMeasures) || 1), previous, previousStudy,
    liveMeasures, setAside,
    study: null,
    complete: elapsedMs >= targetMs || (!ladder.length && !dueReviews.length && !unseen.length),
  }

  // tonight's study, for a session hands together on a piece of more than one
  // playable bar (a single bar's card loops, so nothing of it would be graded)
  if (study && hand == "both" && measures.length > 1) {
    state.study = deriveStudy(state, {study, items: items.filter(item => item.pieceId == pieceId)})

    // the programme isn't complete while a passage is still being learned
    if (!state.study.learned && elapsedMs < targetMs) { state.complete = false }
  }

  return state
}

// whether the item's next rung is the immediate retry after an again
const isRetry = item => ON_LADDER.includes(item.state) && item.lastGrade == AGAIN && item.due <= item.last

// the queue in order, as lists of candidates: never empty while the piece
// has a bar awake or a measure to learn
function candidates(state, {avoid}) {
  let {now, settings, order, recent, ladder, review, dueReviews, offerable, toRead, sitting} = state
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

  // the measures the sitting may introduce now (state.offerable). Never
  // filtered by other: unlike a ladder rung or review, a new measure has
  // nothing graded on it yet, so a bar merely touched as a practice-only
  // neighbour (a read-through's lead-in, see introduction()) is still its
  // own to introduce right after, not a repeat of what was just played
  let newMeasures = offerable.map(measure => newSlot(state, measure, introHand(state, measure)))

  let idle = !rungs.length && !due.length && !early.length && !runThrough.length
  let cap = idle ? IDLE_LADDER_CAP : LADDER_CAP
  let remainingMs = state.targetMs - state.elapsedMs
  let fits = dueReviews.length * state.cardMs <= REVIEW_SHARE * remainingMs
  let share = sitting.newCards <= NEW_SHARE * sitting.cards
  let offerNew = state.laddered < cap && fits && (share || idle)

  // reading through (toRead non-empty, which only holds while nothing of the
  // piece is scheduled, so every other list above is empty too) takes the
  // place of a new measure, in score order, until every bar has been played
  let reading = toRead.length > 0
  let readEntry = reading ? [{reason: READ_THROUGH, slot: newSlot(state, toRead[0], state.hand)}] : []

  // tonight's study takes the place of a new measure: the passage in
  // progress goes on whatever the limits, one to open only where a new
  // measure would be offered. The rungs its card contains are graded in it
  let study = activeStudy(state)
  let studyEntry = []
  if (study && !reading) {
    let passage = study.current || (offerNew ? study.next : null)
    if (passage && passage.card) {
      studyEntry = [{reason: STUDY, slot: studySlot(passage, study.levels)}]
      let {card} = passage
      rungs = rungs.filter(slot => !(slot.hand == card.hand && card.measures.includes(slot.measure)))
    }
  }
  let newEntry = study ? studyEntry :
    !reading && offerNew ? newMeasures.slice(0, 1).map(slot => ({reason: NEW, slot})) : []

  // past the warm-up fifth of the session, new material the limits allow is
  // interleaved with the due reviews rather than waiting for them all, save
  // that a study card just played sends the next after them
  let interleave = !warmUp && state.elapsedMs >= state.targetMs / 5 && !(study && state.previousStudy)

  return [
    ...readEntry,
    ...rungs.map(slot => ({reason: slot.retry ? RETRY : LADDER, slot})),
    ...(interleave ? newEntry : []),
    ...due.map(slot => ({reason: REVIEW, slot})),
    ...(interleave ? [] : newEntry),
    ...early.map(slot => ({reason: EARLY, slot})),
    ...runThrough.map(slot => ({reason: RUN_THROUGH, slot})),
    ...waiting.map(slot => ({reason: WAIT, slot})),
  ]
}

// the study while it has something left to learn, else null: a piece learned
// is played as the programme always was
const activeStudy = state => state.study && !state.study.learned ? state.study : null

// the queue slot of a passage's card, see deriveStudy
function studySlot(passage, levels) {
  let {card} = passage
  return {
    id: card.itemId, measure: card.measures[0], hand: card.hand, item: card.item, retry: false,
    measures: card.measures, stage: passage.effective, early: !!card.early,
    passage: {start: passage.start, end: passage.end, from: passage.from, words: studyPassageWords(passage, levels)},
  }
}

// the words of a passage's origin in the status line: its flag's level where
// it lies inside the flag, else the flag it repeats; none for a passage of
// the score alone
function studyPassageWords(passage, levels) {
  let flag = levels && levels.get(passage.from)
  if (!flag) { return null }

  if (passage.start >= flag.start && passage.end <= flag.end) {
    return PASSAGE_LEVEL_WORDS[flag.level] || null
  }
  return `repeats ${barsWords(flag.start, flag.end)}`
}

// the bars of a card of an entry played while the study is on: the study's
// own, a hand alone just its bar, else the entry's bar with the contiguous
// scheduled bars and the passage in progress (with its lead-in) around it,
// as many as a card takes, so a card never reaches a bar still to be learned
function clippedCard(state, slot) {
  if (slot.measures) { return slot.measures }
  if (slot.hand != state.hand) { return [slot.measure] }

  let {current} = state.study
  let allowed = new Set([
    ...state.liveMeasures,
    ...(current ? current.bars : []),
    ...(current && current.lead != null ? [current.lead] : []),
    slot.measure,
  ])

  let {measures} = state
  let idx = measures.indexOf(slot.measure)
  let from = idx
  let to = idx
  while (from > 0 && allowed.has(measures[from - 1])) { from-- }
  while (to < measures.length - 1 && allowed.has(measures[to + 1])) { to++ }
  return anchoredCard(measures.slice(from, to + 1), slot.measure, state.cardMeasures)
}

// the entry of a queue candidate
function entryOf({reason, slot}, state) {
  let entry = {
    reason,
    measure: slot.measure,
    itemId: slot.id,
    item: slot.item || null,
    hand: slot.hand,
  }

  if (activeStudy(state) && reason != READ_THROUGH) {
    entry.measures = clippedCard(state, slot)
  }
  if (reason == STUDY) {
    Object.assign(entry, {stage: slot.stage, passage: slot.passage, early: !!slot.early})
  }

  return entry
}

// the queue slot of a measure never scheduled, under the hand given
const newSlot = ({pieceId}, measure, hand) => ({
  id: itemId({pieceId, hand, startMeasure: measure, endMeasure: measure}),
  measure, hand, item: null, retry: false,
})

// the hand a measure never scheduled is introduced under: the one a
// start-apart flag asks for while it applies (see the header's start-apart
// paragraph), else the session's. A read-through never asks: it grades
// nothing and its bar counts as read by the session hand's own item
// (state.toRead), so it is always played with the session's hand
const introHand = (state, measure) => {
  let intro = state.startApartIntros && state.startApartIntros.get(measure)
  return intro ? intro.hand : state.hand
}

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

  // a piece whose every measure waits past the target: its first new one
  // (the next passage of the study) still offered this sitting, unless every
  // bar it has in progress rests until the next sitting, or a read-through
  // is still to be played
  let allResting = state.resting.size > 0 && !state.awake.length
  let study = activeStudy(state)
  if (study) {
    let open = !study.current && study.next && study.next.card
    if (!next && open && !allResting && !state.toRead.length) {
      next = {reason: STUDY, slot: studySlot(study.next, study.levels)}
    }
  } else {
    let [first] = state.offerable
    if (!next && first != null && !allResting) {
      next = {reason: NEW, slot: newSlot(state, first, introHand(state, first))}
    }
  }

  if (!next) {
    return {entry: null, complete: state.complete, state}
  }

  return {entry: entryOf(next, state), complete: state.complete, state}
}

/**
 * A preview of the queue's next few entries (score-first design §D9's "Up
 * next"), without the entry on the stand: candidates(state, {avoid: true}),
 * falling back to candidates(state, {avoid: false}) exactly as planNext
 * does, with the entry whose item id is input.previous dropped too (a
 * retry's own id, which avoid alone doesn't filter), deduped by measure,
 * the first count. Pure: nothing is stored, and the queue is replanned
 * after every card, so this is only ever a preview.
 * @param {PlanInput} input
 * @param {number} count
 * @returns {PlanEntry[]}
 */
export function planUpcoming(input, count) {
  let state = planState(input)
  let list = candidates(state, {avoid: true})
  if (!list.length) {
    list = candidates(state, {avoid: false})
  }

  let seen = new Set()
  let upcoming = []
  for (let candidate of list) {
    let {slot} = candidate
    if (slot.id == input.previous || seen.has(slot.measure)) { continue }
    seen.add(slot.measure)
    upcoming.push(entryOf(candidate, state))
    if (upcoming.length >= count) { break }
  }

  return upcoming
}

// a passage role's words with a leading " · ", or "" without one
function roleSuffix(passage) {
  let words = passageWords(passage)
  return words ? ` · ${words}` : ""
}

/**
 * The session rail's "Up next" words for a preview entry (see planUpcoming):
 * "New" (plus the bar's passage role, see passageWords), "Again, in a
 * moment" (RETRY), "Once more" (LADDER/WAIT), "Review" (REVIEW/EARLY),
 * "Run-through" (RUN_THROUGH), "Read-through" (READ_THROUGH) or "Study ·
 * III Together" (STUDY), with " · right hand" or " · left hand" appended for
 * a hand alone.
 * @param {PlanEntry} entry
 * @param {PassageRole} [passage] the entry's bar's role (see
 * PlanDeck#passageOf), read only for a NEW entry
 * @returns {string}
 */
export function upNextWords(entry, passage=null) {
  let words
  switch (entry.reason) {
    case NEW: words = `New${roleSuffix(passage)}`; break
    case RETRY: words = "Again, in a moment"; break
    case LADDER:
    case WAIT: words = "Once more"; break
    case REVIEW:
    case EARLY: words = "Review"; break
    case RUN_THROUGH: words = "Run-through"; break
    case READ_THROUGH: words = "Read-through"; break
    case STUDY: words = `Study · ${ROMAN[entry.stage]} ${STAGE_NAMES[entry.stage]}`; break
    default: words = "Once more"
  }

  if (entry.hand == "upper") { return `${words} · right hand` }
  if (entry.hand == "lower") { return `${words} · left hand` }
  return words
}

/**
 * What the programme holds for the piece before a session: the reviews due
 * and about how long they take, the new measures on offer, the bars still to
 * read through (0 outside a read-through), the target, and the measures
 * learned (in review) out of all, a bar resting among them.
 * @param {PlanInput} input
 * @returns {{due: number, dueMinutes: number, newMeasures: number, toRead: number, targetMinutes: number, learned: number, measures: number}}
 */
export function planSummary(input) {
  let state = planState(input)
  let due = state.dueReviews.length + state.ladder.filter(slot => slot.due < state.endOfToday).length
  return {
    due,
    dueMinutes: due ? Math.max(1, Math.round(due * state.cardMs / MINUTE)) : 0,
    newMeasures: state.unseen.length,
    toRead: state.toRead.length,
    targetMinutes: (input.practice || DEFAULT_PRACTICE_SETTINGS).sessionMinutes,
    learned: state.live.filter(item => item.state == "review").length,
    measures: input.measures.length,
  }
}

/**
 * The study status of a piece: learning while any of its measures has not
 * been scheduled (while tonight's study applies, until every passage has
 * flowed), then maintaining.
 * @param {PlanInput} input
 * @returns {string}
 */
export function studyStatus(input) {
  let state = planState(input)
  if (state.study) { return state.study.learned ? "maintaining" : "learning" }
  return state.unseen.length ? "learning" : "maintaining"
}

// the ranges of consecutive bars among measures that bars cover, as
// [start, end] pairs
function rangesOf(bars, measures) {
  let covered = new Set(bars)
  let ranges = []
  let run = null
  for (let measure of measures) {
    if (!covered.has(measure)) {
      run = null
    } else if (run) {
      run[1] = measure
    } else {
      run = [measure, measure]
      ranges.push(run)
    }
  }
  return ranges
}

/**
 * The plan of tonight's study to store once a pass has been written: the
 * stored plan (or a new one) with the entry's passage opened if it is new,
 * and every passage's stage, when it began and when it flowed as the items
 * now tell them, and the time the piece was learned. A new plan counts the
 * bars scheduled before the pass as known, the bars of a study card and its
 * passage not among them. Only milestones are stored (see StudyRecord#plan):
 * every card is worked out from the items again.
 * @param {PlanInput} input as the pass leaves the items
 * @param {Object} opts
 * @param {PlanEntry|null} [opts.entry] the card played
 * @param {number} opts.at when it was written
 * @returns {Object|null} the plan, null when the study doesn't apply
 */
export function studyAfterPass(input, {entry=null, at}) {
  let state = planState(input)
  if (!state.study) { return null }

  let plan = state.study.plan ? structuredClone(state.study.plan) : null
  let studied = entry && entry.reason == STUDY
  if (!plan) {
    let played = new Set(!studied ? [] : [
      ...entry.measures,
      ...barsBetween(state.measures, entry.passage.start, entry.passage.end),
    ])
    let known = [...state.liveMeasures].filter(measure => !played.has(measure))
    plan = {createdAt: at, known: rangesOf(known, state.measures), passages: []}
  }

  if (studied && !plan.passages.some(({start, end}) => start == entry.passage.start && end == entry.passage.end)) {
    let {start, end, from} = entry.passage
    plan.passages.push({start, end, from, openedAt: at, stage: READ, stageAt: at})
  }

  let derived = planState({...input, study: {...input.study, record: {...input.study.record, plan}}}).study
  plan.passages = plan.passages.map((passage, idx) => {
    let view = derived.passages[idx]
    let milestones = {...passage, stage: view.stage, stageAt: view.stageAt}
    if (view.flowedAt) { milestones.flowedAt = view.flowedAt }
    return milestones
  })

  if (derived.learned && !plan.learnedAt) { plan.learnedAt = at }
  return plan
}

/**
 * What the setup pane and the score show of tonight's study.
 * @param {PlanInput} input
 * @returns {{learned: boolean, readThroughLeft: number, passage: Object|null,
 * path: {start: number, end: number, flowed: boolean, current: boolean}[] (the
 * passages in the order they are learned, current the one in progress or, with
 * none, the next to open),
 * flowed: number, total: number}|null} null when the study doesn't apply;
 * passage is the view of the one in progress or next to open (deriveStudy),
 * with the words of its origin
 */
export function studyView(input) {
  let state = planState(input)
  let {study} = state
  if (!study) { return null }

  let passage = study.current || study.next
  return {
    learned: study.learned,
    readThroughLeft: state.toRead.length,
    passage: passage && {...passage, words: studyPassageWords(passage, study.levels)},
    path: [
      ...study.passages.map(view => ({start: view.start, end: view.end, flowed: !!view.flowedAt, current: view === study.current})),
      ...study.upcoming.map(({start, end}, idx) => ({start, end, flowed: false, current: !study.current && idx == 0})),
    ],
    flowed: study.flowed,
    total: study.passages.length + study.upcoming.length,
  }
}

/**
 * Which piece in study most needs practice: the one with the most single
 * measures due by the end of today, the earliest due first on a tie; null
 * when nothing is due. A hand alone the player chose (ItemRecord#deliberate)
 * always counts. One the hand scaffold made counts while its bar has no
 * schedule hands together of its own, or while that bar is in trouble and
 * the hand has not held since, which keeps a retired scaffold from flagging
 * its piece. It reads no reviews, so only the two goods running can retire
 * one here: a hand the planner retired by graduating still counts until the
 * bar is played together again.
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
      if (item.hand == "both" || item.deliberate) { return true }
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

const ROMAN = {[READ]: "I", [HANDS]: "II", [TOGETHER]: "III", [FLOW]: "IV"}

const capital = words => `${words[0].toUpperCase()}${words.slice(1)}`

export function daysAgo(then, now) {
  let days = localDay(now) - localDay(then)
  return days <= 0 ? "today" : days == 1 ? "yesterday" : `${days} days ago`
}

// "bar 68" or "bars 68–73", inlined rather than importing barsLabel from
// st/music
const barsWords = (start, end) => start == end ? `bar ${start}` : `bars ${start}–${end}`

// the level words of a counting flag's own passage bar, inlined (mirroring
// LEVEL_WORDS in st/difficulty/index, lowercase and "passage" for levels 2
// and 3) rather than importing st/difficulty
const PASSAGE_LEVEL_WORDS = {1: "worth a look", 2: "hard passage", 3: "hardest passage"}

// the words a bar's passage role (see introduction()) adds to its status
// line, null without one
function passageWords(passage) {
  if (!passage) { return null }

  switch (passage.role) {
    case "lead-in":
      return `lead-in to ${barsWords(passage.start, passage.end)}`
    case "repeat":
      return `repeats ${barsWords(passage.start, passage.end)}`
    default:
      return PASSAGE_LEVEL_WORDS[passage.level] || null
  }
}

/**
 * The status line of an entry, eg. "Review · bar 11 · hands together · last
 * played 4 days ago", "New · bar 17", "New · bar 69 · hardest passage",
 * "Read-through · bar 3", "Once more · bar 11", "Study · III Together ·
 * bars 5–7 · hardest passage".
 * @param {PlanEntry} entry
 * @param {Object} opts
 * @param {number} opts.now
 * @param {boolean} [opts.complete] prefixes "Programme complete"
 * @param {PassageRole} [opts.passage] the entry's bar's role (see
 * PlanDeck#passageOf), named only for a NEW entry
 * @returns {string}
 */
export function entryStatus(entry, {now, complete=false, passage=null}={}) {
  let bar = `bar ${entry.measure}`
  let hand = HAND_WORDS[entry.hand] || entry.hand
  let parts

  switch (entry.reason) {
    case NEW: {
      parts = ["New", bar]
      let words = passageWords(passage)
      if (words) { parts.push(words) }
      break
    }
    case READ_THROUGH:
      parts = ["Read-through", bar]
      break
    case STUDY: {
      let card = entry.measures
      parts = ["Study", `${ROMAN[entry.stage]} ${STAGE_NAMES[entry.stage]}`, barsWords(card[0], card[card.length - 1])]
      if (entry.hand != "both") { parts.push(hand) }
      if (entry.passage && entry.passage.words) { parts.push(entry.passage.words) }
      return [...(complete ? ["Programme complete"] : []), ...parts].join(" · ")
    }
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

// "87 bars left to read through", "1 bar left to read through", or
// "read-through done · new bars next" (tonight's study, when it applies)
// once every bar has been played
function readThroughCaption(toRead, studying) {
  if (!toRead) { return `read-through done · ${studying ? "tonight's study" : "new bars"} next` }
  return `${toRead} ${toRead == 1 ? "bar" : "bars"} left to read through`
}

// the caption after a card of tonight's study: where the passage goes next
function studyCaption(entry, item, state) {
  let {study} = state
  let view = study && study.passages.find(passage =>
    passage.start == entry.passage.start && passage.end == entry.passage.end)
  if (!view) { return entryCaption(item, state.now) }

  let bars = barsWords(view.start, view.end)
  if (view.flowedAt) {
    if (study.learned) { return "Learned ❖ · the programme keeps it from here" }
    return `${capital(bars)} ${view.bars.length == 1 ? "flows" : "flow"}`
  }
  if (view.resting) { return `${capital(bars)} rest until your next sitting` }

  let {card} = view
  switch (view.effective) {
    case HANDS:
      return `${capital(HAND_WORDS[card.hand])} alone, then together`
    case TOGETHER:
      if (card.dropped) { return `Bar ${card.measures[0]} alone, then on` }
      if (entry.stage != TOGETHER) { return `Together next, from bar ${view.bars[0]}` }
      return `Together next · ${barsWords(card.measures[0], card.measures[card.measures.length - 1])}`
    case FLOW: {
      let flow = card.measures
      if (entry.stage != FLOW) { return `Now ${barsWords(flow[0], flow[flow.length - 1])} twice without a stop` }
      return view.lastFlow ? "1 of 2 · once more without a stop" : "Not yet · again, without a stop"
    }
    default:
      return entryCaption(item, state.now)
  }
}

/**
 * The caption after a card of the programme, from the state the attempt
 * leaves: how many bars are left to read through, while the piece still is
 * (readThroughCaption); its bar resting until the next sitting, eg. "Bar 19
 * rests until your next sitting"; the hand scaffold offering it a hand alone
 * next, eg. "Left hand alone, then together"; the scaffold done with it,
 * "hands together next"; else when it comes back (entryCaption).
 * @param {PlanEntry} entry the card's; one of tonight's study is captioned by
 * where its passage goes next (studyCaption)
 * @param {ItemRecord|null} item the entry's item as the attempt left it
 * @param {Object} state planState after the attempt
 * @returns {string|null}
 */
export function cardCaption(entry, item, state) {
  if (entry.reason == READ_THROUGH) { return readThroughCaption(state.toRead.length, !!state.study) }
  if (entry.reason == STUDY) { return studyCaption(entry, item, state) }

  let {measure} = entry
  if (state.resting.has(measure)) { return `Bar ${measure} rests until your next sitting` }

  let startApart = state.startApartCaptions && state.startApartCaptions.get(measure)
  if (startApart) { return startApart }

  let scaffold = state.scaffolds.get(measure)
  if (scaffold && scaffold != entry.hand) {
    let words = HAND_WORDS[scaffold]
    return `${words[0].toUpperCase()}${words.slice(1)} alone, then together`
  }

  if (!scaffold && entry.hand != state.hand) { return "hands together next" }

  return entryCaption(item, state.now)
}
