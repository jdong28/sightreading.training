// The scheduler of spaced repetition on imported pieces: when an item (a
// single measure of a piece under one hand setting, see st/srs/records) is
// next due, from the grades of its attempts.
//
// The first time an item is graded it climbs a short ladder within the
// session (30 s, 2.5 min, 10 min: again goes back to the first rung with one
// immediate retry, hard repeats the rung, good climbs one, easy two), then
// graduates to due dates across days set by the FSRS-6 memory model
// (st/srs/fsrs) at the target retention: the next due date is when its
// predicted recall falls to it. A lapse (again on a review) sends it back to
// the ladder keeping a fraction of its stability. Three rules are the
// piano's rather than FSRS's: the first interval across days is capped at one
// day (four when the first sight was easy), since motor learning consolidates
// in sleep; a repeat of an item in review on the day it was reviewed that
// doesn't fail changes nothing, as it is practice rather than evidence; and
// no interval is over 120 days. Intervals of a day or more end at the start
// of a local day, which begins at 4 am, so practice at 11 pm and again at 7 am
// is a day apart.
//
// Only single measures are scheduled (schedulable); the reviews of a card's
// range are logged but give it no due date. Items keep the scheduler version
// that wrote their schedule in algo, and replay rebuilds a schedule from the
// log, so a revised scheduler can reschedule history.

import {makeFsrs, DEFAULT_W} from "st/srs/fsrs"
import {newItem, RECENT_ATTEMPTS} from "st/srs/records"

// the version of this scheduler, stored on each item it schedules as algo
export const SCHEDULER_ALGO = 1

export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// the states of a scheduled item
export const SCHEDULED_STATES = ["learning", "review", "relearning"]

// states an item is never scheduled in: a node of the (later) chunk tree
// that another stands for, or a shelved piece
export const UNSCHEDULED_STATES = ["merged", "split", "suspended"]

// the meta store keys of the settings records
export const SCHEDULER_SETTINGS_KEY = "scheduler"
export const PRACTICE_SETTINGS_KEY = "practice"

/**
 * The scheduler's parameters, one record of the meta store (so they travel
 * with a library file).
 * @typedef {Object} SchedulerSettings
 * @property {string} key SCHEDULER_SETTINGS_KEY
 * @property {number} algo SCHEDULER_ALGO
 * @property {number} retention the predicted recall an item is due at
 * @property {number[]} w the FSRS-6 parameters
 * @property {number[]} ladderMs the rungs of the ladder within a session
 * @property {{firstDays: number, easyFirstDays: number, maxDays: number}} caps
 * the most days of a first interval across days, of one after an easy first
 * sight, and of any interval
 */
export const DEFAULT_SCHEDULER_SETTINGS = deepFreeze({
  key: SCHEDULER_SETTINGS_KEY,
  algo: SCHEDULER_ALGO,
  retention: 0.9,
  w: [...DEFAULT_W],
  ladderMs: [30 * 1000, 2.5 * MINUTE, 10 * MINUTE],
  caps: {firstDays: 1, easyFirstDays: 4, maxDays: 120},
})

/**
 * How long the player means to practise, one record of the meta store; read
 * by the later planner.
 * @typedef {Object} PracticeSettings
 * @property {string} key PRACTICE_SETTINGS_KEY
 * @property {number} dailyGoalMinutes
 * @property {number} sessionMinutes
 */
export const DEFAULT_PRACTICE_SETTINGS = deepFreeze({
  key: PRACTICE_SETTINGS_KEY,
  dailyGoalMinutes: 10,
  sessionMinutes: 20,
})

// in continuous time (see applyGrade) a review sooner than this after the
// last is on the same day
export const SAME_DAY_DAYS = 0.5

// the local hour a day starts at
export const ROLLOVER_HOUR = 4

// the half-life of an attempt in the recent miss rate
export const RECENT_HALF_LIFE_DAYS = 14

// the recall taken for an item with no schedule when weighing it, so a
// measure never played weighs 2, as much as one just failed at least
export const UNSCHEDULED_RECALL = 0.75

function deepFreeze(object) {
  for (let value of Object.values(object)) {
    if (value && typeof value == "object") { deepFreeze(value) }
  }
  return Object.freeze(object)
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const isPositive = n => typeof n == "number" && Number.isFinite(n) && n > 0

/**
 * @param {*} settings
 * @returns {boolean} whether settings is a valid scheduler settings record
 */
export function validSchedulerSettings(settings) {
  if (!settings || typeof settings != "object" || settings.key != SCHEDULER_SETTINGS_KEY) {
    return false
  }

  let {algo, retention, w, ladderMs, caps} = settings
  return Number.isInteger(algo) && algo >= 1 &&
    typeof retention == "number" && retention > 0 && retention < 1 &&
    Array.isArray(w) && w.length == DEFAULT_W.length && w.every(n => typeof n == "number" && Number.isFinite(n)) &&
    Array.isArray(ladderMs) && ladderMs.length > 0 && ladderMs.every(ms => typeof ms == "number" && ms >= 0) &&
    !!caps && isPositive(caps.firstDays) && isPositive(caps.easyFirstDays) && isPositive(caps.maxDays)
}

/**
 * @param {*} settings
 * @returns {boolean} whether settings is a valid practice settings record
 */
export function validPracticeSettings(settings) {
  return !!settings && typeof settings == "object" && settings.key == PRACTICE_SETTINGS_KEY &&
    isPositive(settings.dailyGoalMinutes) && isPositive(settings.sessionMinutes)
}

// the memory model of each settings' parameters
const models = new WeakMap()
function modelOf(settings) {
  let model = models.get(settings.w)
  if (!model) {
    model = makeFsrs(settings.w)
    models.set(settings.w, model)
  }
  return model
}

/**
 * The local day a time falls on, counting days from the epoch, where a day
 * starts at ROLLOVER_HOUR: 3 am belongs to the day before.
 * @param {number} time ms
 * @returns {number}
 */
export function localDay(time) {
  let date = new Date(time)
  let day = date.getDate() - (date.getHours() < ROLLOVER_HOUR ? 1 : 0)
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), day) / DAY)
}

/**
 * When a local day starts (see localDay), in local time.
 * @param {number} day
 * @returns {number} ms
 */
export function dayStart(day) {
  let date = new Date(day * DAY)
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), ROLLOVER_HOUR).getTime()
}

/**
 * @param {ItemRecord} item
 * @returns {boolean} whether the scheduler gives the item due dates: a single
 * measure (of any hand setting) not set aside
 */
export function schedulable(item) {
  return item.startMeasure == item.endMeasure && !item.beats &&
    !UNSCHEDULED_STATES.includes(item.state)
}

/**
 * @param {ItemRecord} item
 * @returns {boolean} whether the item carries a schedule
 */
export function scheduled(item) {
  return SCHEDULED_STATES.includes(item.state) && item.s != null && item.d != null &&
    item.last != null && item.due != null
}

/**
 * The item after a graded attempt at it: its state, ladder step, due date,
 * stability and difficulty, and counts. An item without a schedule (tracked,
 * or never seen) starts one.
 * @param {ItemRecord} item
 * @param {number} grade 1 again, 2 hard, 3 good, 4 easy
 * @param {number} now when it was played
 * @param {SchedulerSettings} [settings]
 * @param {Object} [opts]
 * @param {boolean} [opts.continuous] measure time in exact days instead of
 * local days: a review under half a day after the last is on the same day,
 * and due dates aren't moved to the start of a day (as the design's exhibits
 * were worked out)
 * @returns {ItemRecord}
 */
export function applyGrade(item, grade, now, settings=DEFAULT_SCHEDULER_SETTINGS, {continuous=false}={}) {
  let model = modelOf(settings)
  let {retention, ladderMs, caps} = settings
  let fresh = !scheduled(item)

  let sameDay = true
  let elapsedDays = 0
  if (!fresh) {
    if (continuous) {
      elapsedDays = Math.max(0, (now - item.last) / DAY)
      sameDay = elapsedDays < SAME_DAY_DAYS
    } else {
      elapsedDays = Math.max(0, localDay(now) - localDay(item.last))
      sameDay = elapsedDays == 0
    }
  }

  // a same-day repeat of an item in review that doesn't fail is practice,
  // not evidence: its memory and due date stay as they were
  if (!fresh && item.state == "review" && sameDay && grade >= 2) {
    return {...item, reps: item.reps + 1}
  }

  let next = {
    ...item,
    reps: item.reps + 1,
    streak: grade >= 3 ? item.streak + 1 : 0,
    lastGrade: grade,
    last: now,
    algo: SCHEDULER_ALGO,
  }

  // the due date days away, at the start of a local day
  let dueIn = days => continuous ? now + days * DAY :
    dayStart(localDay(now) + Math.max(1, Math.round(days)))

  let graduate = cap => {
    next.state = "review"
    next.step = 0
    next.due = dueIn(clamp(model.interval(next.s, retention), 1, cap))
  }

  // a rung of the ladder; again allows one immediate retry, then waits
  let climb = step => {
    next.step = step
    let retry = grade == 1 && item.lastGrade != 1
    next.due = now + (retry ? 0 : ladderMs[step])
  }

  if (fresh) {
    Object.assign(next, model.init(grade), {lapses: 0})
    if (grade == 4) {
      graduate(caps.easyFirstDays)
    } else {
      next.state = "learning"
      climb(grade == 3 ? 1 : 0)
      if (next.step >= ladderMs.length) { graduate(caps.firstDays) }
    }
  } else if (item.state == "learning" || item.state == "relearning") {
    let {s, d} = sameDay ? model.shortTerm(item, grade) : model.review(item, grade, elapsedDays)
    Object.assign(next, {s, d})

    let step = grade == 1 ? 0 : grade == 2 ? item.step : item.step + grade - 2
    if (step >= ladderMs.length) {
      graduate(item.state == "learning" ? caps.firstDays : caps.maxDays)
    } else {
      climb(step)
    }
  } else {
    let {s, d} = sameDay ? model.shortTerm(item, grade) : model.review(item, grade, elapsedDays)
    Object.assign(next, {s, d})

    if (grade == 1) {
      next.state = "relearning"
      next.lapses = item.lapses + 1
      climb(0)
    } else {
      next.due = dueIn(clamp(model.interval(s, retention), 1, caps.maxDays))
    }
  }

  return next
}

/**
 * The recall of the item the memory model predicts at a time.
 * @param {ItemRecord} item
 * @param {number} now
 * @param {SchedulerSettings} [settings]
 * @returns {number|null} 0-1, null for an item with no schedule
 */
export function predictedRecall(item, now, settings=DEFAULT_SCHEDULER_SETTINGS) {
  if (!item || !scheduled(item)) { return null }
  return modelOf(settings).retr(Math.max(0, (now - item.last) / DAY), item.s)
}

/**
 * The share of columns missed in the item's recent attempts (all of them in
 * an attempt graded again), each attempt counted at half its weight every
 * RECENT_HALF_LIFE_DAYS, so old misses fade.
 * @param {ItemRecord} item
 * @param {number} now
 * @returns {number} 0-1, 0 with no recent attempts
 */
export function recentMissRate(item, now) {
  let recent = item ? item.recent : []
  if (!recent.length) { return 0 }

  let total = recent.reduce((sum, [at, columns, clean, grade]) => {
    let missed = grade == 1 ? 1 : columns > 0 ? (columns - clean) / columns : 0
    let age = Math.max(0, (now - at) / DAY)
    return sum + missed * Math.pow(0.5, age / RECENT_HALF_LIFE_DAYS)
  }, 0)

  return total / recent.length
}

/**
 * How strongly weakest first practice favours an item:
 * 1 + 4 (1 - R) + its recent miss rate, R its predicted recall now
 * (UNSCHEDULED_RECALL when it has no schedule, as for a measure never played).
 * @param {ItemRecord|null} item
 * @param {number} now
 * @param {SchedulerSettings} [settings]
 * @returns {number} 1-6
 */
export function practiceWeight(item, now, settings=DEFAULT_SCHEDULER_SETTINGS) {
  let recall = predictedRecall(item, now, settings) ?? UNSCHEDULED_RECALL
  return 1 + 4 * (1 - recall) + recentMissRate(item, now)
}

// the fields replay rebuilds
const SCHEDULE_FIELDS = ["state", "step", "due", "last", "s", "d", "reps", "lapses", "streak", "lastGrade", "recent", "algo"]

/**
 * An item rebuilt from its log: its schedule and recent attempts as the
 * graded reviews among reviews leave them, played in order of time from an
 * item with neither (only schedulable items get a schedule). The totals (hits, misses, attempts, time) aren't all in
 * the log, so they are the given item's.
 * @param {ReviewRecord[]} reviews of one item
 * @param {Object} [opts]
 * @param {ItemRecord} [opts.item] the item whose other fields are kept, a new
 * one of the reviews' item id by default
 * @param {SchedulerSettings} [opts.settings]
 * @param {boolean} [opts.continuous] see applyGrade
 * @returns {ItemRecord}
 */
export function replay(reviews, {item, settings=DEFAULT_SCHEDULER_SETTINGS, continuous=false}={}) {
  let base = item || itemOfId(reviews[0].itemId, reviews[0].at)
  let replayed = {...base}
  for (let field of SCHEDULE_FIELDS) { delete replayed[field] }
  Object.assign(replayed, {
    state: base.state == "tracked" || SCHEDULED_STATES.includes(base.state) ? "tracked" : base.state,
    step: 0, reps: 0, lapses: 0, streak: 0, recent: [], algo: 0,
  })

  let graded = reviews.filter(review => review.kind == "attempt" && review.grade)
    .sort((a, b) => a.at - b.at)

  for (let review of graded) {
    let recent = [...replayed.recent, [review.at, review.columns, review.clean, review.grade]]
      .slice(-RECENT_ATTEMPTS)
    if (schedulable(replayed)) {
      replayed = applyGrade(replayed, review.grade, review.at, settings, {continuous})
    }
    replayed = {...replayed, recent}
  }

  return replayed
}

// a new item of an item id `${pieceId}:${hand}:${start}-${end}`
function itemOfId(id, createdAt) {
  let [, pieceId, hand, start, end] = id.match(/^(.*):(\w+):(-?\d+)-(-?\d+)$/)
  return newItem({pieceId, hand, startMeasure: Number(start), endMeasure: Number(end)}, createdAt)
}
