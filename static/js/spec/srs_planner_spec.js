import MersenneTwister from "mersennetwister"

import {
  planNext, planState, planSummary, anchoredCard, onScheduleMeasures, mostOverduePiece, inStudy,
  entryStatus, entryCaption, cardCaption, blamedStaves,
  RETRY, LADDER, REVIEW, NEW, EARLY, RUN_THROUGH, WAIT, LADDER_CAP, IDLE_LADDER_CAP, SITTING_GAP_MS,
} from "st/srs/planner"
import {
  applyGrade, replay, DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS,
  SCHEDULER_ALGO, DAY, MINUTE,
} from "st/srs/schedule"
import {newItem, itemId, RECENT_ATTEMPTS} from "st/srs/records"
import {PlanDeck, PlanGenerator} from "st/plan_cards"
import {MeasureCardDeck, MeasureCardGenerator, measureCards, IN_ORDER, COLUMN_JOIN_KEYS} from "st/measure_cards"
import {
  SHEET_MUSIC_GENERATOR, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, PROGRAMME_PRACTICE, FREE_PRACTICE, WHOLE_SECTION,
  plannedPractice, programmeOffered, drilledRange, PLAN_CARD_MEASURES,
} from "st/data"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"

import {openTestStore, pickupScore} from "spec/helpers"

const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4

// a local time, so day boundaries hold in any time zone
const at = (day, hour, minute=0) => new Date(2026, 2, day, hour, minute).getTime()
const NOW = at(10, 18)

const MEASURES = [1, 2, 3, 4, 5, 6, 7, 8]

// a single measure item of piece p, as the scheduler leaves it
const bar = (measure, fields={}) => ({
  ...newItem({pieceId: "p", startMeasure: measure, endMeasure: measure}, 0),
  ...fields,
})

// played at last, reviewed reps times before
const played = (last, reps, grade=GOOD) => ({
  last, lastPracticed: last, reps, lastGrade: grade, attempts: reps, elapsedMs: reps * 5000,
  recent: Array.from({length: Math.min(reps, RECENT_ATTEMPTS)}, (_, idx) =>
    [last - idx * DAY, 4, 4, grade]).reverse(),
  algo: SCHEDULER_ALGO,
})

// in review, next due at due, with stability s
const inReview = (measure, {due, last=due - 5 * DAY, s=5}={}) =>
  bar(measure, {...played(last, 3), state: "review", step: 0, s, d: 5, due, streak: 3})

// on the ladder, next rung due at due
const onLadder = (measure, {due, last=due - 30 * 1000, step=0, grade=GOOD, state="learning"}={}) =>
  bar(measure, {...played(last, 1, grade), state, step, s: 1, d: 5, due, streak: grade >= 3 ? 1 : 0})

const plan = (items, extra={}) => planNext({
  pieceId: "p", items, measures: MEASURES, now: NOW, ...extra,
})

const entryOf = (items, extra) => {
  let {entry} = plan(items, extra)
  return entry && [entry.reason, entry.measure]
}

// every measure but those given in review, due well after today and played today
const settled = (except=[]) => MEASURES.filter(m => !except.includes(m))
  .map(m => inReview(m, {due: NOW + 20 * DAY, last: NOW - 3 * MINUTE - m * 1000}))

describe("today's programme planner", function() {
  describe("joins", function() {
    it("anchors a card on its measure and the ones after it, or before it at the end", function() {
      let measures = [0, 1, 2, 3, 4]
      expect(anchoredCard(measures, 0, 3)).toEqual([0, 1, 2])
      expect(anchoredCard(measures, 2, 3)).toEqual([2, 3, 4])
      expect(anchoredCard(measures, 3, 3)).toEqual([2, 3, 4])
      expect(anchoredCard(measures, 4, 3)).toEqual([2, 3, 4])
      expect(anchoredCard(measures, 4, 2)).toEqual([3, 4])
      expect(anchoredCard(measures, 2, 1)).toEqual([2])
      expect(anchoredCard(measures, 2, 9)).toEqual(measures)
      expect(anchoredCard([7], 7, 2)).toEqual([7])
    })

    it("grades a card's measures played before their schedule asks only when they fail", function() {
      let items = new Map([
        // a rung waiting, played as the last entry or as a neighbour
        [1, onLadder(1, {due: NOW + MINUTE})],
        [2, onLadder(2, {due: NOW + 5 * MINUTE, state: "relearning"})],
        // a rung come due
        [3, onLadder(3, {due: NOW})],
        // in review played again today (a run-through) or before it is due:
        // the scheduler's same-day rule looks after it
        [4, inReview(4, {due: NOW + 9 * DAY, last: NOW - 10 * MINUTE})],
        [5, inReview(5, {due: NOW + 9 * DAY, last: NOW - 3 * DAY})],
        // tracked, never scheduled: its first sight
        [6, bar(6, {attempts: 2, lastPracticed: NOW - DAY})],
      ])
      let itemOf = measure => items.get(measure) || null

      expect(onScheduleMeasures([1], itemOf, NOW)).toEqual([])
      expect(onScheduleMeasures([1], itemOf, NOW + MINUTE)).toEqual([1])
      expect(onScheduleMeasures([1, 2, 3, 4, 5, 6, 7], itemOf, NOW)).toEqual([3, 4, 5, 6, 7])
    })
  })

  describe("queue", function() {
    it("takes a ladder rung come due, then a due review, then a new measure, an early review, a run-through, a rung early", function() {
      let rung = onLadder(1, {due: NOW - 1000, last: NOW - DAY})
      let due = inReview(2, {due: NOW - DAY})
      let early = inReview(4, {due: NOW + 5 * DAY, last: NOW - 3 * DAY})
      let today = inReview(5, {due: NOW + 3 * DAY, last: NOW - 60 * MINUTE})
      let rest = [3, 6, 7, 8].map(m => inReview(m, {due: NOW + 9 * DAY, last: NOW - 50 * MINUTE + m}))

      expect(entryOf([rung, due, early, today, ...rest])).toEqual([LADDER, 1])
      expect(entryOf([due, early, today, ...rest])).toEqual([REVIEW, 2])
      // measure 1 has never been scheduled
      expect(entryOf([early, today, ...rest])).toEqual([NEW, 1])
      let seen = [1, 2].map(m => inReview(m, {due: NOW + 9 * DAY, last: NOW - 55 * MINUTE + m}))
      expect(entryOf([...seen, early, today, ...rest])).toEqual([EARLY, 4])
      // every measure played today: the least recently played
      let playedToday = inReview(4, {due: NOW + 5 * DAY, last: NOW - 40 * MINUTE})
      expect(entryOf([...seen, playedToday, today, ...rest])).toEqual([RUN_THROUGH, 5])
      // only rungs to come: the earliest, before it is due
      let waiting = [
        onLadder(1, {due: NOW + 60 * 1000, last: NOW - 2 * DAY}),
        onLadder(2, {due: NOW + 30 * 1000, last: NOW - 3 * DAY}),
      ]
      expect(entryOf(waiting, {measures: [1, 2]})).toEqual([WAIT, 2])
    })

    it("takes rungs earliest first and new measures in score order", function() {
      let items = [
        onLadder(5, {due: NOW - 1000}),
        onLadder(3, {due: NOW - 5000}),
        onLadder(1, {due: NOW + 1000}),
      ]
      expect(entryOf(items)).toEqual([LADDER, 3])
      expect(entryOf(items.slice(2))).toEqual([NEW, 2])
      expect(entryOf(items.slice(2), {measures: [8, 7, 1, 2]})).toEqual([NEW, 8])
    })

    it("warms up on the two due reviews likeliest recalled, then takes the least likely first", function() {
      let strong = inReview(2, {due: NOW - 1000, s: 30, last: NOW - 30 * DAY})
      let weak = inReview(3, {due: NOW - 6 * DAY, s: 2, last: NOW - 8 * DAY})
      let middling = inReview(4, {due: NOW - 2 * DAY, s: 8, last: NOW - 10 * DAY})
      expect(entryOf([weak, middling, strong])).toEqual([REVIEW, 2])

      // two cards played in this session: the warm-up is over
      let cards = [5, 6].map((m, idx) => inReview(m, {due: NOW + 9 * DAY, last: NOW - (idx + 1) * MINUTE}))
      expect(entryOf([weak, middling, strong, ...cards])).toEqual([REVIEW, 3])
    })

    it("never takes the measure just played again, save the retry after an again", function() {
      // measure 1 was just played (the latest attempt) and its rung is due
      let justPlayed = onLadder(1, {due: NOW - 1000, last: NOW - 20 * 1000})
      let other = onLadder(2, {due: NOW - 500, last: NOW - 5 * MINUTE})
      expect(entryOf([justPlayed, other])).toEqual([LADDER, 2])
      // so is every measure of its card
      let neighbour = inReview(2, {due: NOW - DAY, last: NOW - 20 * 1000})
      expect(entryOf([justPlayed, neighbour], {measures: [1, 2, 3]})).toEqual([NEW, 3])
      // the retry comes straight back
      let retry = onLadder(1, {due: NOW - 20 * 1000, last: NOW - 20 * 1000, grade: AGAIN})
      expect(entryOf([retry, other])).toEqual([RETRY, 1])
      // or the entry named as previous, eg. a card played but not graded
      let rungs = [
        onLadder(2, {due: NOW - 500, last: NOW - 10 * MINUTE}),
        onLadder(3, {due: NOW - 100, last: NOW - 20 * MINUTE}),
        onLadder(4, {due: NOW + 5 * MINUTE, last: NOW - 5 * MINUTE}),
      ]
      expect(entryOf(rungs)).toEqual([LADDER, 2])
      expect(entryOf(rungs, {previous: "p:both:2-2"})).toEqual([LADDER, 3])
      // a piece of one measure plays it again
      expect(entryOf([justPlayed], {measures: [1]})).toEqual([LADDER, 1])
    })

    it("keeps at most four measures on the ladder while there is other work", function() {
      let rungs = count => [1, 2, 3, 4, 5, 6, 7, 8].slice(0, count)
        .map(m => onLadder(m, {due: NOW + m * MINUTE, last: NOW - 2 * DAY}))
      let early = inReview(9, {due: NOW + 5 * DAY, last: NOW - 3 * DAY})
      let measures = [...MEASURES, 9, 10]

      expect(entryOf([...rungs(LADDER_CAP - 1), early], {measures})).toEqual([NEW, 4])
      expect(entryOf([...rungs(LADDER_CAP), early], {measures})).toEqual([EARLY, 9])
      // with nothing else to play, up to eight
      expect(entryOf(rungs(LADDER_CAP), {measures})).toEqual([NEW, 5])
      expect(entryOf(rungs(IDLE_LADDER_CAP - 1), {measures})).toEqual([NEW, 8])
      expect(entryOf(rungs(IDLE_LADDER_CAP), {measures})).toEqual([WAIT, 1])
    })

    it("counts a bar resting toward the ladder cap, so no new bar takes its place", function() {
      // four bars on the ladder, each failed three times in this sitting,
      // with a review due: none of the four can be offered, but they are
      // still the work in progress the cap counts
      let failed = measure => ({
        ...onLadder(measure, {due: NOW - MINUTE, grade: AGAIN}),
        recent: [7, 6, 5].map(n => [NOW - n * MINUTE, 4, 0, AGAIN]),
      })
      let items = [...[1, 2, 3, 4].map(failed), inReview(5, {due: NOW - DAY})]
      let {entry, state} = plan(items)

      expect([...state.resting].sort()).toEqual([1, 2, 3, 4])
      expect(state.ladder).toEqual([])
      expect(state.laddered).toEqual(LADDER_CAP)
      expect([entry.reason, entry.measure]).toEqual([REVIEW, 5])

      // one fewer in progress and the next new measure comes through
      expect(entryOf([...[1, 2, 3].map(failed), inReview(5, {due: NOW - DAY})])).toEqual([NEW, 4])

      // with nothing else to play either, the four still hold the cap: the
      // sitting has no card left rather than a new bar in their place
      let alone = plan([1, 2, 3, 4].map(failed))
      expect([...alone.state.resting].sort()).toEqual([1, 2, 3, 4])
      expect(alone.state.unseen).toEqual([5, 6, 7, 8])
      expect(alone.entry).toBe(null)

      expect(entryOf([1, 2, 3].map(failed))).toEqual([NEW, 4])
    })

    it("offers new measures only while the due reviews fit in the time left", function() {
      // ten minutes into a twenty minute session, the reviews to come
      // interleaved with new material
      let sitting = [1, 2, 3].map(m => inReview(m, {due: NOW + 9 * DAY, last: NOW - 10 * MINUTE + m * 3 * MINUTE}))
      let dueReviews = count => Array.from({length: count}, (_, idx) =>
        inReview(10 + idx, {due: NOW - DAY, last: NOW - 6 * DAY}))
      let measures = [...MEASURES, ...Array.from({length: 60}, (_, idx) => 10 + idx)]

      // seven minutes in, 9 of the 13 left for reviews, a card of two
      // measures about 10 s: new material goes between the due reviews
      expect(entryOf([...sitting, ...dueReviews(10)], {measures, cardMeasures: 2})).toEqual([NEW, 4])
      expect(entryOf([...sitting, ...dueReviews(60)], {measures, cardMeasures: 2})).toEqual([REVIEW, 10])

      // past the target nothing new starts, and the backlog is still played
      let late = {measures, practice: {...DEFAULT_PRACTICE_SETTINGS, sessionMinutes: 5}}
      expect(entryOf([...sitting, ...dueReviews(1)], late)).toEqual([REVIEW, 10])
      expect(entryOf(sitting, late)).toEqual([RUN_THROUGH, 1])
    })

    it("keeps new cards to half the cards played while there is other work", function() {
      // two cards in this session, both bringing a new measure
      let fresh = [1, 2].map((m, idx) => onLadder(m, {due: NOW + 5 * MINUTE, last: NOW - (idx + 1) * MINUTE}))
      let early = inReview(8, {due: NOW + 5 * DAY, last: NOW - 3 * DAY})
      expect(entryOf([...fresh, early])).toEqual([EARLY, 8])
      // with nothing else, new material fills the session
      expect(entryOf(fresh)).toEqual([NEW, 3])
    })

    it("is never empty while the piece has a live item, playing a random month of grades", function() {
      let random = new MersenneTwister(7)
      let settings = DEFAULT_SCHEDULER_SETTINGS
      let items = new Map()
      let now = NOW
      let previous = null
      let reasons = new Set()

      for (let day = 0; day < 12; day++) {
        // each day is a session of its own
        now = NOW + day * DAY
        previous = null
        for (let card = 0; card < 40; card++) {
          let {entry} = planNext({pieceId: "p", items: [...items.values()], measures: MEASURES, now})
          expect(entry).not.toBe(null)
          reasons.add(entry.reason)

          if (previous) {
            expect(entry.measure != previous.measure || entry.reason == RETRY)
              .withContext(`${entry.reason} ${entry.measure} after ${previous.reason} ${previous.measure}`)
              .toBe(true)
          }

          let grade = random.random() < 0.15 ? AGAIN : random.random() < 0.3 ? HARD : GOOD
          let stored = items.get(entry.itemId) || bar(entry.measure)
          let early = !onScheduleMeasures([entry.measure], () => stored, now).length
          let next = early && grade > AGAIN ? {...stored, lastPracticed: now, attempts: stored.attempts + 1} : {
            ...applyGrade(stored, grade, now, settings), lastPracticed: now, attempts: stored.attempts + 1,
            recent: [...stored.recent, [now, 4, grade >= 3 ? 4 : 2, grade]].slice(-RECENT_ATTEMPTS),
          }
          if (early) {
            expect(next.due).withContext(`${entry.reason} ${entry.measure} climbed early`)
              .toBeLessThanOrEqual(Math.max(stored.due, now))
          }
          items.set(entry.itemId, next)
          previous = entry
          now += 20 * 1000
        }
      }

      expect([...reasons]).toEqual(jasmine.arrayContaining([EARLY, LADDER, NEW, RETRY, REVIEW, RUN_THROUGH]))
    })
  })

  describe("the session", function() {
    it("reads complete past the target and carries on", function() {
      let sitting = [1, 2].map(m => inReview(m, {due: NOW + 9 * DAY, last: NOW - 25 * MINUTE + m * 4 * MINUTE}))
      let rest = [3, 4, 5, 6, 7, 8].map(m => onLadder(m, {due: NOW + 9 * MINUTE, last: NOW - 2 * MINUTE}))

      let before = plan([...sitting, ...rest], {practice: {...DEFAULT_PRACTICE_SETTINGS, sessionMinutes: 30}})
      expect(before.complete).toBe(false)

      let after = plan([...sitting, ...rest], {practice: {...DEFAULT_PRACTICE_SETTINGS, sessionMinutes: 10}})
      expect(after.complete).toBe(true)
      expect(after.entry).not.toBe(null)
      expect(entryStatus(after.entry, {now: NOW, complete: after.complete}))
        .toEqual("Programme complete · Run-through · bar 1")

      // nothing due and every measure learned is complete from the start
      expect(plan(settled()).complete).toBe(true)
    })

    it("takes the session from the attempts on the items, so a reload resumes the queue", function() {
      let items = [
        inReview(1, {due: NOW + 9 * DAY, last: NOW - 35 * MINUTE}),
        inReview(2, {due: NOW + 9 * DAY, last: NOW - 12 * MINUTE}),
        inReview(3, {due: NOW + 9 * DAY, last: NOW - 2 * MINUTE}),
      ]
      let state = planState({pieceId: "p", items, measures: MEASURES, now: NOW})
      expect(state.sitting.startedAt).toEqual(NOW - 12 * MINUTE)
      expect(state.sitting.cards).toEqual(2)
      expect(state.elapsedMs).toEqual(12 * MINUTE)
    })

    it("counts the cards that brought a new measure", function() {
      let items = [
        onLadder(1, {due: NOW + MINUTE, last: NOW - 3 * MINUTE}),
        onLadder(2, {due: NOW + MINUTE, last: NOW - 3 * MINUTE}),
        inReview(3, {due: NOW + 9 * DAY, last: NOW - 2 * MINUTE}),
      ]
      let {sitting} = planState({pieceId: "p", items, measures: MEASURES, now: NOW})
      expect([sitting.cards, sitting.newCards]).toEqual([2, 1])
    })

    it("ignores other pieces, hands and ranges", function() {
      let items = [
        {...onLadder(1, {due: NOW - 1000}), pieceId: "q", id: "q:both:1-1"},
        {...onLadder(2, {due: NOW - 1000, last: NOW - DAY}), hand: "upper", id: "p:upper:2-2"},
        {...newItem({pieceId: "p", startMeasure: 1, endMeasure: 2}), state: "learning", due: NOW - 1000},
      ]
      expect(entryOf(items)).toEqual([NEW, 1])
      expect(entryOf(items, {hand: "upper"})).toEqual([LADDER, 2])
    })

    it("sums up the programme for the plate", function() {
      let items = [
        inReview(1, {due: NOW - DAY}),
        inReview(2, {due: NOW + 2 * DAY}),
        onLadder(3, {due: NOW + 5 * MINUTE}),
      ]
      expect(planSummary({pieceId: "p", items, measures: MEASURES, now: NOW})).toEqual({
        due: 2, dueMinutes: 1, newMeasures: 5, targetMinutes: 20, learned: 2, measures: 8,
      })

      // bar 1's left hand alone failed three times in the sitting, so the bar
      // rests: it is no work left, but it is still one of the bars learned
      let rested = {
        ...bar(1),
        hand: "lower",
        id: itemId({pieceId: "p", hand: "lower", startMeasure: 1, endMeasure: 1}),
        recent: [3, 2, 1].map(n => [NOW - n * MINUTE, 4, 0, AGAIN]),
        lastPracticed: NOW - MINUTE,
      }
      let resting = {
        pieceId: "p", items: [...items, rested], measures: MEASURES, now: NOW,
        handMeasures: {upper: MEASURES, lower: MEASURES},
      }
      expect(planState(resting).resting.has(1)).toBe(true)
      expect(planSummary(resting)).toEqual(jasmine.objectContaining({due: 1, learned: 2}))
    })
  })

  describe("status line and caption", function() {
    it("names the entry", function() {
      let entry = (reason, item, hand="both") => ({reason, measure: 11, item, hand, itemId: "p:both:11-11"})
      let reviewed = {...inReview(11, {due: NOW, last: at(6, 20)})}
      expect(entryStatus(entry(REVIEW, reviewed), {now: NOW}))
        .toEqual("Review · bar 11 · hands together · last played 4 days ago")
      expect(entryStatus(entry(EARLY, reviewed, "upper"), {now: NOW}))
        .toEqual("Review · bar 11 · right hand · last played 4 days ago")
      expect(entryStatus({...entry(NEW, null), measure: 17}, {now: NOW})).toEqual("New · bar 17")
      expect(entryStatus(entry(RETRY, null), {now: NOW})).toEqual("Once more · bar 11")
      expect(entryStatus(entry(LADDER, null, "lower"), {now: NOW})).toEqual("Once more · bar 11 · left hand")
      expect(entryStatus(entry(WAIT, null), {now: NOW, complete: true}))
        .toEqual("Programme complete · Once more · bar 11")
    })

    it("says when the measure comes back", function() {
      expect(entryCaption(onLadder(1, {due: NOW + 30 * 1000}), NOW)).toEqual("again in a moment")
      expect(entryCaption(inReview(1, {due: at(11, 4)}), NOW)).toEqual("returns tomorrow")
      expect(entryCaption(inReview(1, {due: at(13, 4)}), NOW)).toEqual("returns in 3 days")
      expect(entryCaption(bar(1), NOW)).toBe(null)
    })
  })

  describe("hands apart and rests", function() {
    const ago = minutes => NOW - minutes * MINUTE

    // a single measure item of piece p rebuilt by the scheduler from its
    // graded attempts, [at, grade] each
    const graded = (measure, attempts, hand="both") => {
      let id = itemId({pieceId: "p", hand, startMeasure: measure, endMeasure: measure})
      let item = replay(attempts.map(([time, grade]) => ({
        itemId: id, at: time, pieceId: "p", kind: "attempt", grade, columns: 4, clean: grade > AGAIN ? 4 : 1,
      })))
      return {...item, attempts: attempts.length, lastPracticed: attempts[attempts.length - 1][0]}
    }

    // the review of bar 3 played hands together at a time, its misses split by staff
    const blame = (time, upper, lower, misses=Math.max(upper, lower)) => new Map([["p:both:3-3", {
      itemId: "p:both:3-3", at: time, pieceId: "p", kind: "attempt", grade: AGAIN, misses,
      staffMisses: {upper, lower},
    }]])

    const APART = {upper: MEASURES, lower: MEASURES}

    // the other bars in review, played a few minutes ago
    const planned = (items, extra) => planNext({
      pieceId: "p", items: [...settled([3]), ...items], measures: MEASURES, now: NOW,
      handMeasures: APART, ...extra,
    })
    const entryIn = (items, extra) => {
      let {entry} = planned(items, extra)
      return [entry.reason, entry.measure, entry.hand]
    }

    it("offers a bar hands apart when it fails on one hand's misses, at first sight or twice running", function() {
      let firstSight = graded(3, [[ago(1), AGAIN]])
      let twice = graded(3, [[ago(5), GOOD], [ago(3), AGAIN], [ago(1), AGAIN]])
      let once = graded(3, [[ago(3), GOOD], [ago(1), AGAIN]])

      let rows = [
        ["the left hand's misses at first sight", firstSight, blame(ago(1), 0, 3), {}, [LADDER, 3, "lower"]],
        ["the right hand's", firstSight, blame(ago(1), 2, 0), {}, [LADDER, 3, "upper"]],
        ["two thirds of them on one staff", firstSight, blame(ago(1), 0, 2, 3), {}, [LADDER, 3, "lower"]],
        ["both staves blamed, the one with more misses first", firstSight, blame(ago(1), 2, 3), {}, [LADDER, 3, "lower"]],
        ["one miss", firstSight, blame(ago(1), 0, 1), {}, [RETRY, 3, "both"]],
        ["misses under two thirds on either staff", firstSight, blame(ago(1), 2, 2, 4), {}, [RETRY, 3, "both"]],
        ["twice running later", twice, blame(ago(1), 0, 3), {}, [LADDER, 3, "lower"]],
        ["a first failure after a good pass", once, blame(ago(1), 0, 3), {}, [RETRY, 3, "both"]],
        ["the review of an earlier attempt", firstSight, blame(ago(2), 0, 3), {}, [RETRY, 3, "both"]],
        ["no review read and no hand played alone", firstSight, new Map(), {}, [RETRY, 3, "both"]],
        ["a piece of one staff", firstSight, blame(ago(1), 3, 0), {handMeasures: null}, [RETRY, 3, "both"]],
        ["a bar the left hand has no notes in", firstSight, blame(ago(1), 0, 3),
          {handMeasures: {upper: MEASURES, lower: [1, 2]}}, [RETRY, 3, "both"]],
        // the blamed hand is the only one that plays the bar, so taking the
        // other off it would leave the very same card
        ["a bar the right hand has no notes in", firstSight, blame(ago(1), 0, 3),
          {handMeasures: {upper: [1, 2], lower: MEASURES}}, [RETRY, 3, "both"]],
        ["a staff that plays no bar at all", firstSight, blame(ago(1), 3, 0),
          {handMeasures: {upper: MEASURES, lower: []}}, [RETRY, 3, "both"]],
      ]

      for (let [name, item, lastReviews, extra, expected] of rows) {
        expect(entryIn([item], {lastReviews, ...extra})).withContext(name).toEqual(expected)
      }

      // without the failure's review the bar isn't split, whatever has been
      // played alone since it failed
      let leftAlone = graded(3, [[ago(0.5), GOOD]], "lower")
      expect(entryIn([firstSight, leftAlone], {lastReviews: new Map()})).toEqual([RETRY, 3, "both"])

      // the hand alone's item, by the id it will be written under
      let {entry} = planned([firstSight], {lastReviews: blame(ago(1), 0, 3)})
      expect([entry.itemId, entry.item]).toEqual(["p:lower:3-3", null])
      expect(entryStatus(entry, {now: NOW})).toEqual("Once more · bar 3 · left hand")
    })

    it("never splits a session played with one hand", function() {
      let failed = {...graded(3, [[ago(1), AGAIN]], "upper")}
      let {entry, state} = planNext({
        pieceId: "p", items: [failed], measures: MEASURES, now: NOW, hand: "upper", handMeasures: APART,
        lastReviews: new Map([[failed.id, {...blame(ago(1), 3, 0).get("p:both:3-3"), itemId: failed.id}]]),
      })
      expect([entry.reason, entry.measure, entry.hand]).toEqual([RETRY, 3, "upper"])
      expect(state.scaffolds.size).toEqual(0)
    })

    it("returns the bar hands together once its hand holds", function() {
      let failed = graded(3, [[ago(10), AGAIN]])
      let left = attempts => attempts.length ? [graded(3, attempts, "lower")] : []

      let rows = [
        ["not played alone yet", {}, [], "lower"],
        ["good once", {}, [[ago(8), GOOD]], "lower"],
        ["good twice running", {}, [[ago(8), GOOD], [ago(6), GOOD]], undefined],
        ["graduated by an easy first sight", {}, [[ago(8), EASY]], undefined],
        ["good, then hard", {}, [[ago(8), GOOD], [ago(6), HARD]], "lower"],
        ["again, then good twice running", {}, [[ago(8), AGAIN], [ago(6), GOOD], [ago(4), GOOD]], undefined],
        ["held before the failure only", {}, [[ago(30), GOOD], [ago(20), GOOD]], "lower"],
        ["played alone, its failure's review not read yet", {lastReviews: new Map()}, [[ago(8), GOOD]], undefined],
      ]

      for (let [name, extra, attempts, hand] of rows) {
        let {state} = planned([failed, ...left(attempts)], {lastReviews: blame(ago(10), 0, 3), ...extra})
        expect(state.scaffolds.get(3)).withContext(name).toEqual(hand)
      }

      // once held, the bar itself comes straight back
      let held = left([[ago(8), GOOD], [ago(6), GOOD]])
      expect(entryIn([failed, ...held], {lastReviews: blame(ago(10), 0, 3)})).toEqual([RETRY, 3, "both"])

      // both staves blamed: the other hand next, then together
      let right = graded(3, [[ago(8), GOOD], [ago(6), GOOD]], "upper")
      let both = blame(ago(10), 3, 3)
      expect(planned([failed, right], {lastReviews: both}).state.scaffolds.get(3)).toEqual("lower")
      expect(planned([failed, right, ...held], {lastReviews: both}).state.scaffolds.get(3)).toBe(undefined)

      // failing together again sends it back to the hand
      let again = graded(3, [[ago(10), AGAIN], [ago(2), AGAIN]])
      expect(entryIn([again, ...held], {lastReviews: blame(ago(2), 0, 2)})).toEqual([LADDER, 3, "lower"])
    })

    it("offers a hand alone on its own schedule once it has been played since the failure", function() {
      let failed = graded(3, [[ago(10), AGAIN]])
      let reviews = blame(ago(10), 0, 3)

      // the left hand alone graduated before the bar failed, so the failure
      // sends the bar to it at once, however far off its own review is
      let waiting = graded(3, [[NOW - 3 * DAY, EASY]], "lower")
      expect(waiting.state).toEqual("review")
      expect(waiting.due).toBeGreaterThan(NOW)
      expect(entryIn([failed, waiting], {lastReviews: reviews})).toEqual([LADDER, 3, "lower"])

      // played since the failure and graded hard: it still holds the bar,
      // but comes back when its own schedule says rather than at once
      let hard = graded(3, [[NOW - 3 * DAY, EASY], [ago(5), HARD]], "lower")
      expect([hard.state, hard.lastGrade]).toEqual(["review", HARD])
      let {entry, state} = planned([failed, hard], {lastReviews: reviews})
      expect(state.scaffolds.get(3)).toEqual("lower")
      expect(state.ladder.find(slot => slot.measure == 3).due).toEqual(hard.due)
      expect(entry.measure).not.toEqual(3)
    })

    it("waits on the hand's own schedule when a same-day pass left its due date where it was", function() {
      // the left hand alone is in review from an earlier day, graded good
      // earlier today, then hard again since the bar failed: the scheduler's
      // same-day rule leaves its due date and last grade where they were
      let hand = graded(3, [[NOW - 3 * DAY, EASY], [ago(45), GOOD], [ago(2), HARD]], "lower")
      expect([hand.state, hand.lastGrade, hand.last]).toEqual(["review", GOOD, ago(45)])
      expect(hand.due).toBeGreaterThan(NOW)

      let failed = graded(3, [[ago(40), AGAIN], [ago(10), AGAIN]])
      let {entry, state} = planned([failed, hand], {lastReviews: blame(ago(10), 0, 3)})

      // it still holds the bar, but the pass since the failure counts, so it
      // comes back when its own schedule says rather than every other card
      expect(state.scaffolds.get(3)).toEqual("lower")
      expect(state.ladder.find(slot => slot.measure == 3).due).toEqual(hand.due)
      expect(entry.measure).not.toEqual(3)
    })

    it("rests only a bar the programme has in hand, not one free practice failed alone", function() {
      // a long sitting of free practice failed bar 3 left hand alone three
      // times, and the programme has never played the piece, so it has no
      // bar 3 of its own to rest
      let alone = graded(3, [[ago(50), AGAIN], [ago(35), AGAIN], [ago(20), AGAIN]], "lower")
      let {entry, state} = planNext({
        pieceId: "p", items: [alone], measures: MEASURES, now: NOW, handMeasures: APART,
      })

      expect([...state.resting]).toEqual([])
      expect(state.elapsedMs).toBeGreaterThan(state.targetMs)
      expect([entry.reason, entry.measure]).toEqual([NEW, 1])
    })

    it("rests a bar failing a third time in a sitting until the next", function() {
      let rows = [
        ["failed together, then twice alone", [[ago(10), AGAIN]], [[ago(8), AGAIN], [ago(6), AGAIN]], true],
        ["failed three times together", [[ago(10), AGAIN], [ago(8), AGAIN], [ago(6), AGAIN]], [], true],
        ["failed twice", [[ago(10), AGAIN], [ago(8), AGAIN]], [], false],
        ["failed twice yesterday and once today",
          [[NOW - DAY - 2 * MINUTE, AGAIN], [NOW - DAY - MINUTE, AGAIN], [ago(1), AGAIN]], [], false],
      ]

      for (let [name, together, alone, rests] of rows) {
        let items = [graded(3, together), ...(alone.length ? [graded(3, alone, "lower")] : [])]
        let last = together[together.length - 1][0]
        let {entry, state} = planned(items, {lastReviews: blame(last, 0, 3)})
        expect(state.resting.has(3)).withContext(name).toBe(rests)
        if (rests) {
          expect(entry.measure).withContext(name).not.toEqual(3)
        }
      }

      // its due date is left as it is, so it opens the next sitting, still
      // on its hand alone
      let items = [graded(3, [[ago(10), AGAIN]]), graded(3, [[ago(8), AGAIN], [ago(6), AGAIN]], "lower")]
      let later = {lastReviews: blame(ago(10), 0, 3), now: NOW + 2 * 3600 * 1000}
      expect(entryIn(items, later)).toEqual([LADDER, 3, "lower"])

      // a bar resting is no work left in the programme, and a piece whose
      // every bar rests has nothing to play until the next sitting
      let alone = planNext({
        pieceId: "p", items, measures: [3], now: NOW, handMeasures: APART, lastReviews: blame(ago(10), 0, 3),
      })
      expect(alone.complete).toBe(true)
      expect(alone.entry).toBe(null)
    })

    it("words the card after a failure", function() {
      let failed = graded(3, [[ago(1), AGAIN]])
      let state = extra => planState({
        pieceId: "p", items: [...settled([3]), failed, ...(extra || [])], measures: MEASURES, now: NOW,
        handMeasures: APART, lastReviews: blame(ago(1), 0, 3),
      })
      let together = {reason: NEW, measure: 3, hand: "both", itemId: "p:both:3-3", item: null}
      let alone = {reason: LADDER, measure: 3, hand: "lower", itemId: "p:lower:3-3", item: null}

      expect(cardCaption(together, failed, state())).toEqual("Left hand alone, then together")

      let once = graded(3, [[ago(0.5), GOOD]], "lower")
      expect(cardCaption(alone, once, state([once]))).toEqual("again in a moment")

      let held = graded(3, [[ago(0.8), GOOD], [ago(0.5), GOOD]], "lower")
      expect(cardCaption(alone, held, state([held]))).toEqual("hands together next")

      let failing = graded(3, [[ago(0.8), AGAIN], [ago(0.5), AGAIN]], "lower")
      expect(cardCaption(alone, failing, state([failing]))).toEqual("Bar 3 rests until your next sitting")
    })

    it("reads the hands a failure's misses fall on", function() {
      let review = (upper, lower, misses) => ({misses, staffMisses: {upper, lower}})
      expect(blamedStaves(review(0, 3, 3))).toEqual(["lower"])
      expect(blamedStaves(review(4, 5, 6))).toEqual(["lower", "upper"])
      expect(blamedStaves(review(2, 1, 3))).toEqual(["upper"])
      expect(blamedStaves(review(1, 1, 1))).toEqual([])
      expect(blamedStaves({misses: 3})).toBe(null)
    })
  })

  describe("pieces in study", function() {
    it("suggests the piece with the most measures due", function() {
      let due = (pieceId, measure, dueAt) => ({...inReview(measure, {due: dueAt}), pieceId,
        id: itemId({pieceId, hand: "both", startMeasure: measure, endMeasure: measure})})
      let studies = ["a", "b", "c"].map(pieceId => ({pieceId, status: "learning", startedAt: 0}))
      let items = [due("a", 1, NOW - DAY), due("b", 1, NOW - DAY), due("b", 2, NOW), due("c", 1, NOW + 5 * DAY)]

      expect(mostOverduePiece({studies, items, now: NOW})).toEqual("b")
      expect(mostOverduePiece({studies: studies.filter(s => s.pieceId != "b"), items, now: NOW})).toEqual("a")
      expect(mostOverduePiece({studies: [{...studies[1], status: "shelved"}], items, now: NOW})).toBe(null)
    })

    it("counts a bar's hand alone only while the hand scaffold offers it", function() {
      let studies = ["p", "q"].map(pieceId => ({pieceId, status: "learning", startedAt: 0}))
      let item = (fields, hand="both", pieceId="p") => ({...fields, pieceId, hand,
        id: itemId({pieceId, hand, startMeasure: fields.startMeasure, endMeasure: fields.endMeasure})})
      // q has one bar due, just after p's left hand
      let other = item(inReview(1, {due: NOW - DAY + 5000}), "both", "q")
      // a left hand alone due, its bar played together since
      let left = item(onLadder(3, {due: NOW - DAY, last: NOW - DAY - 20 * MINUTE}), "lower")

      let rows = [
        ["a retired scaffold", [item(inReview(3, {due: NOW + 5 * DAY}))], "q"],
        ["an active scaffold", [item(onLadder(3, {due: NOW - DAY + 1000, last: NOW - DAY - 30 * MINUTE, grade: AGAIN}))], "p"],
        ["a bar only practised with one hand", [], "p"],
      ]

      for (let [name, together, expected] of rows) {
        expect(mostOverduePiece({studies, items: [other, left, ...together], now: NOW}))
          .withContext(name).toEqual(expected)
      }

      // a study played with the left hand: those are its programme's own
      // items, due however their bar stands hands together
      let retired = [other, left, item(inReview(3, {due: NOW + 5 * DAY}))]
      expect(mostOverduePiece({studies: [{...studies[0], hand: "lower"}, studies[1]], items: retired, now: NOW}))
        .toEqual("p")
    })

    it("counts each piece by the hand its own study is played with", function() {
      let item = (fields, hand, pieceId) => ({...fields, pieceId, hand,
        id: itemId({pieceId, hand, startMeasure: fields.startMeasure, endMeasure: fields.endMeasure})})

      // p is practised hands together, with one bar due; q is practised with
      // the right hand, over bars in review from an earlier hands together
      // phase, and has two right hand bars due
      let items = [
        item(inReview(1, {due: NOW - DAY}), "both", "p"),
        ...[1, 2].map(m => item(inReview(m, {due: NOW + 5 * DAY}), "both", "q")),
        ...[1, 2].map(m => item(inReview(m, {due: NOW - DAY}), "upper", "q")),
      ]
      let studies = [
        {pieceId: "p", status: "learning", startedAt: 0},
        {pieceId: "q", status: "learning", startedAt: 0, hand: "upper"},
      ]

      expect(mostOverduePiece({studies, items, now: NOW})).toEqual("q")

      // hands together, q's right hand items are scaffolds its bars retired
      let together = [studies[0], {pieceId: "q", status: "learning", startedAt: 0}]
      expect(mostOverduePiece({studies: together, items, now: NOW})).toEqual("p")
    })

    it("makes the programme the default in study", function() {
      expect(inStudy(null)).toBe(false)
      expect(inStudy({pieceId: "p", status: "learning", startedAt: 0})).toBe(true)
      expect(inStudy({pieceId: "p", status: "shelved", startedAt: 0})).toBe(false)
    })
  })
})

const grand = {name: "grand", range: ["C2", "C6"]}

// plays the head column like the sight reading page does on a hit, with
// what the matcher measured on it (see NoteMatcher#measured)
let hit = (notes, stats, measured) => {
  let column = notes.currentColumn()
  notes = notes.clone()
  notes.shift(measured)
  notes.pushRandom()
  stats.hitNotes(column)
  return notes
}

// the notes of columns, without what cardColumn copies onto them
const notesOf = columns => [...columns].map(column => [...column])

describe("today's programme on the staff", function() {
  let store, previousStore, piece, generators, time

  beforeEach(async function() {
    store = await openTestStore()
    previousStore = setAppStore(store)
    piece = (await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)).piece
    generators = []
    time = NOW
  })

  afterEach(async function() {
    generators.forEach(g => g.stop())
    setAppStore(previousStore)
    await store.close()
  })

  // the measures of pickupScore on the grand staff, with their beats
  let pool = (hand=BOTH_HANDS) => {
    let settings = {piece: piece.id, song: "", startMeasure: 0, endMeasure: 2, hand}
    let generator = SHEET_MUSIC_GENERATOR.create(grand, null, {...settings, practice: FREE_PRACTICE, measuresPerCard: 1})
    generator.stop()
    return generator.cards.map(card => ({number: card.startMeasure, columns: card.columns}))
  }

  // the deck plans its first card once the piece's reviews are read
  let generatorFor = async (cardMeasures=2, opts={}) => {
    let deck = new PlanDeck(pool(), {pieceId: piece.id, cardMeasures, store, now: () => time, ...opts})
    await deck.ready
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    let notes = new NoteList([], {generator})
    notes.fillBuffer(8)
    return {deck, generator, notes}
  }

  // the bars each hand has notes in and the lazy one-bar accessor a deck
  // builds its hand cards through, recording every bar it asks for
  let handPools = () => {
    let pools = {upper: pool(RIGHT_HAND), lower: pool(LEFT_HAND)}
    let built = []
    return {
      built,
      handMeasures: Object.fromEntries(Object.entries(pools).map(([staff, list]) =>
        [staff, list.filter(measure => measure.columns.length).map(measure => measure.number)])),
      handCard: (staff, number) => {
        built.push(`${staff}:${number}`)
        return pools[staff].find(measure => measure.number == number)
      },
    }
  }

  // plays the card on the staff through, a second apart
  let playCard = async ({generator, notes}, stats) => {
    let count = generator.currentCard().columns.length
    for (let i = 0; i < count; i++) {
      time += 1000
      notes = hit(notes, stats)
    }
    await generator.finishing
    await generator.studying
    return notes
  }

  it("keeps the generator contract the staff and ScoreCard rely on", async function() {
    let {deck, generator, notes} = await generatorFor()
    expect(generator instanceof MeasureCardGenerator).toBe(true)

    // the first new measure, the pickup, with the one after it
    expect(deck.entry.reason).toEqual(NEW)
    expect(generator.currentCard().measures).toEqual([0, 1])
    expect(generator.currentCardNumber()).toBe(null)
    expect(generator.cards.map(card => card.measures)).toEqual([[0, 1], [1, 2], [1, 2]])
    expect(notesOf(notes)).toEqual([["D5"], ["G3", "G4"], ["A4"], ["B4"], [], [], [], []])

    // each column knows its place on the card and what an engine joins it by
    expect([...notes].slice(0, 4).map(column => column.cardIndex)).toEqual([0, 1, 2, 3])
    expect([...notes].slice(0, 4).every(column => typeof column.beat == "number")).toBe(true)
    expect(notes[1].notation).toEqual(generator.currentCard().columns[1].notation)
    expect(COLUMN_JOIN_KEYS).toContain("notation")

    expect(generator.sectionLabel()).toEqual("today's programme")
    expect(generator.cardLabel()).toEqual("measures 0–1")
    expect(generator.statusLine()).toEqual("New · bar 0")
    expect(generator.caption()).toBe(null)
  })

  it("plans the next card from the attempt just played, and says when it returns", async function() {
    let {deck, generator, notes} = await generatorFor()
    let stats = new NoteStats()

    notes = await playCard({generator, notes}, stats)

    // measures 0 and 1 are scheduled, as the planner foresaw; measure 2 is new
    // with the pace of the pass, a crotchet a second
    let anchor = store.item(`${piece.id}:both:0-0`)
    expect(entryCaption(anchor, time)).not.toBe(null)
    expect(generator.caption()).toEqual(`♩ ≈ 60 · no stops · ${entryCaption(anchor, time)}`)
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 2}))
    expect(generator.currentCard().measures).toEqual([1, 2])
    expect(notesOf(notes).slice(0, 5)).toEqual([["G3", "G4"], ["A4"], ["B4"], ["C3", "E3", "G3", "C5"], []])

    let bars = store.items(piece.id).filter(item => item.startMeasure == item.endMeasure)
    expect(bars.map(item => item.startMeasure).sort()).toEqual([0, 1])
    expect(bars.every(item => item.due > time)).toBe(true)

    // the piece is in study
    expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "learning", startedAt: time}))
  })

  // T8: a column's measurements reach the pass as the column is done, so the
  // grade the next card is planned from is the grade the review keeps
  it("plans from the last column's latency, the hesitation its review keeps", async function() {
    let {deck, generator, notes} = generatorFor(2)
    let stats = new NoteStats()
    let barId = `${piece.id}:both:1-1`

    // the pickup with measure 1, a second a column, each column struck at
    // once but the last after a long wait: one hesitation, in measure 1
    let columns = generator.currentCard().columns.length
    expect(columns).toEqual(4)
    for (let i = 0; i < columns; i++) {
      time += 1000
      notes = hit(notes, stats, {
        latency: i == columns - 1 ? 6000 : 200, spread: 0, early: 0, heldCredit: 0, late: null,
      })
    }

    // the card is graded as its last column is done, before the hit itself
    // is counted: the item the next card is planned from hesitated on it
    expect(deck.item(barId)).toEqual(jasmine.objectContaining({lastGrade: HARD}))

    await generator.finishing
    await generator.studying

    let review = (await store.reviews({pieceId: piece.id})).find(r => r.itemId == barId)
    expect([review.hesitations, review.grade, review.perColumn[2][2]]).toEqual([1, HARD, 6000])
    expect(store.item(barId).lastGrade).toEqual(HARD)
  })

  it("brings a failed measure back at once", async function() {
    let {deck, generator, notes} = await generatorFor(1)
    let stats = new NoteStats()

    // a slip on the pickup's only column, then the hit
    stats.missNotes(["D5"])
    notes = await playCard({generator, notes}, stats)

    expect(deck.entry).toEqual(jasmine.objectContaining({reason: RETRY, measure: 0}))
    expect(generator.statusLine()).toEqual("Once more · bar 0")
    expect(generator.caption()).toEqual("again in a moment")
    expect(notesOf(notes).slice(0, 2)).toEqual([["D5"], []])
  })

  it("offers a bar failing on the left hand's notes as the left hand alone, then together", async function() {
    // the pools first: making one stops the generator playing
    let measures = pool()
    let {built, ...hands} = handPools()
    let {deck, generator, notes} = await generatorFor(1, hands)
    let stats = new NoteStats()
    notes = await playCard({generator, notes}, stats)

    // measure 1 at first sight, its bass G3 missed twice
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 1, hand: "both"}))
    expect(built).toEqual([])
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    notes = await playCard({generator, notes}, stats)

    expect(store.item(`${piece.id}:both:1-1`).lastGrade).toEqual(AGAIN)
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: LADDER, measure: 1, hand: "lower"}))
    expect(generator.statusLine()).toEqual("Once more · bar 1 · left hand")
    expect(generator.caption()).toEqual("♩ ≈ 60 · no stops · Left hand alone, then together")
    expect(generator.currentCard()).toEqual(jasmine.objectContaining({measures: [1], hand: "lower"}))
    expect(notesOf(notes).slice(0, 2)).toEqual([["G3"], []])

    // only the bar offered is drawn from the score hands apart, once
    expect(built).toEqual(["lower:1"])

    // a reload, with nothing known of the piece's reviews, reads them from
    // the log before it plans, so the same hand alone is offered again
    let reopened = await openTestStore({keep: true})
    let reloaded = new PlanDeck(measures, {
      pieceId: piece.id, cardMeasures: 1, ...hands, store: reopened, now: () => time,
    })
    expect([reloaded.playable, reloaded.entry]).toEqual([true, null])
    await reloaded.ready
    expect(reloaded.entry).toEqual(deck.entry)
    await reopened.close()

    // the left hand alone is written to its own item, and holds at once
    notes = await playCard({generator, notes}, stats)
    let reviews = await store.reviews({pieceId: piece.id})
    expect(reviews[reviews.length - 1].itemId).toEqual(`${piece.id}:lower:1-1`)
    expect(store.item(`${piece.id}:lower:1-1`).state).toEqual("review")
    expect(generator.caption()).toEqual("hands together next")
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: RETRY, measure: 1, hand: "both"}))
    expect(notesOf(notes).slice(0, 4)).toEqual([["G3", "G4"], ["A4"], ["B4"], []])
    expect(built).toEqual(["lower:1"])
  })

  it("leaves the programme with no card once every bar it has left rests", async function() {
    let {deck, generator, notes} = await generatorFor(1)
    let stats = new NoteStats()
    // a note of each bar's first column, missed once, fails the bar
    let missed = {0: "D5", 1: "G3", 2: "C3"}

    for (let i = 0; i < 12 && deck.entry; i++) {
      stats.missNotes([missed[deck.entry.measure]])
      notes = await playCard({generator, notes}, stats)
    }

    expect([...deck.measures].sort()).toEqual([0, 1, 2])
    expect([...planState(deck.planInput()).resting].sort()).toEqual([0, 1, 2])
    expect(deck.entry).toBe(null)
    expect(generator.currentCard()).toBe(null)
    expect(generator.statusLine()).toEqual("Programme complete · 3 bars rest until your next sitting")
    expect(generator.caption()).toEqual("Bar 2 rests until your next sitting")
    expect(notesOf(notes).every(column => column.length == 0)).toBe(true)

    // Begin plans again, and only the sitting that is over opens them
    expect(generator.replan()).toBe(false)
    time += SITTING_GAP_MS + MINUTE
    expect(generator.replan()).toBe(true)
    expect(deck.entry).not.toBe(null)
    expect(generator.currentCard().measures).toEqual([deck.entry.measure])
    expect(generator.statusLine()).toMatch(/^Once more · bar \d+$/)
  })

  it("reads the review log afresh for each deck, so a failure outside the programme splits the bar", async function() {
    let measures = pool()
    let {built, ...hands} = handPools()
    let planDeck = async () => {
      let deck = new PlanDeck(measures, {pieceId: piece.id, cardMeasures: 1, ...hands, store, now: () => time})
      await deck.ready
      return deck
    }

    // the programme is opened, so its deck reads what the log holds now
    expect((await planDeck()).entry).toEqual(jasmine.objectContaining({measure: 0, hand: "both"}))
    expect(built).toEqual([])

    // free practice fails bar 1 on the bass staff: it writes the review
    // itself, and never tells a plan deck
    let free = new MeasureCardGenerator(
      new MeasureCardDeck(measureCards(measures.filter(m => m.number == 1), 1), {
        pieceId: piece.id, hand: "both", order: IN_ORDER, store, now: () => time,
      }),
      {now: () => time})
    generators.push(free)
    let freeNotes = new NoteList([], {generator: free})
    freeNotes.fillBuffer(8)
    let stats = new NoteStats()
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    freeNotes = await playCard({generator: free, notes: freeNotes}, stats)

    let reviews = await store.reviews({pieceId: piece.id})
    expect(reviews[reviews.length - 1]).toEqual(jasmine.objectContaining({
      itemId: `${piece.id}:both:1-1`, grade: AGAIN, staffMisses: {upper: 0, lower: 2},
    }))

    // the programme is opened again: the failure it never saw splits the bar
    expect((await planDeck()).entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
  })

  it("says how many bars rest once the sitting has met its target", async function() {
    // the pickup failed three times over a long sitting, the only bar the
    // programme has in hand; bars 1 and 2 have never been played
    let id = `${piece.id}:both:0-0`
    let last = time - 19 * MINUTE
    await store.recordAttempt({
      item: {
        id, pieceId: piece.id, hand: "both", startMeasure: 0, endMeasure: 0,
        level: "bar", state: "learning", step: 0, due: last, last, s: 1, d: 5,
        reps: 3, lapses: 2, streak: 0, lastGrade: AGAIN, hits: 0, misses: 3, attempts: 3,
        lastPracticed: last, elapsedMs: 3000, algo: 1, createdAt: time - 50 * MINUTE,
        recent: [49, 34, 19].map(n => [time - n * MINUTE, 1, 0, AGAIN]),
      },
      review: {
        itemId: id, pieceId: piece.id, at: last, kind: "attempt", grade: AGAIN, was: "learning",
        columns: 1, clean: 0, misses: 1, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 1,
      },
    })

    let {deck, generator} = await generatorFor(1)
    let state = planState(deck.planInput())
    expect([...state.resting]).toEqual([0])
    expect(state.elapsedMs).toBeGreaterThan(state.targetMs)
    expect(deck.entry).toBe(null)
    expect(generator.summary().newMeasures).toEqual(2)
    expect(generator.statusLine())
      .toEqual("Programme complete · 1 bar rests until your next sitting")
  })

  it("never splits a piece played without its hands", async function() {
    let {deck, generator, notes} = await generatorFor(1)
    let stats = new NoteStats()
    notes = await playCard({generator, notes}, stats)
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    notes = await playCard({generator, notes}, stats)
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: RETRY, measure: 1, hand: "both"}))
  })

  it("grades a measure played before its rung only when it fails, a neighbour never seen at first sight", async function() {
    let {deck, generator, notes} = await generatorFor(2)
    generator.setDrill(() => ({mode: "scroll"}))
    let stats = new NoteStats()
    let bar = measure => store.item(`${piece.id}:both:${measure}-${measure}`)
    let barReviews = async measure => (await store.reviews({pieceId: piece.id}))
      .filter(review => review.itemId == bar(measure).id)

    // the pickup, new, with measure 1 never seen: both at first sight
    notes = await playCard({generator, notes}, stats)
    expect([bar(0).state, bar(1).state]).toEqual(["learning", "learning"])
    expect((await barReviews(1)).map(review => review.was)).toEqual(["new"])
    let waiting = bar(1)

    // measure 2, new, with measure 1 on its rung well before it is due
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 2}))
    notes = await playCard({generator, notes}, stats)
    expect(bar(2).state).toEqual("learning")
    expect(await barReviews(1)).toHaveSize(1)
    expect(bar(1)).toEqual(jasmine.objectContaining({
      state: waiting.state, step: waiting.step, due: waiting.due, reps: waiting.reps, recent: waiting.recent,
      hits: waiting.hits + 3, lastPracticed: time,
    }))

    // nothing else to play: the pickup's rung early, which fails, with measure
    // 1 played cleanly again
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: WAIT, measure: 0}))
    let pickup = bar(0)
    stats.missNotes(["D5"])
    notes = await playCard({generator, notes}, stats)
    expect(await barReviews(0)).toHaveSize(2)
    expect(bar(0)).toEqual(jasmine.objectContaining({reps: pickup.reps + 1, lastGrade: AGAIN, step: 0}))
    expect(await barReviews(1)).toHaveSize(1)
    expect(bar(1).due).toEqual(waiting.due)

    // its retry is due, so it is graded
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: RETRY, measure: 0}))
    notes = await playCard({generator, notes}, stats)
    expect(await barReviews(0)).toHaveSize(3)
    expect(bar(1).due).toEqual(waiting.due)
  })

  it("resumes the same queue from the store after a reload", async function() {
    let first = await generatorFor(1)
    let stats = new NoteStats()
    for (let i = 0; i < 3; i++) {
      first.notes = await playCard(first, stats)
    }

    let entry = first.deck.entry
    let reloaded = await generatorFor(1)
    expect(reloaded.deck.entry).toEqual(entry)
  })

  it("marks the piece maintaining once every measure is scheduled, under the hand it is played with", async function() {
    let {generator, notes} = await generatorFor(3)
    notes = await playCard({generator, notes}, new NoteStats())
    expect(store.study(piece.id))
      .toEqual(jasmine.objectContaining({status: "maintaining", hand: "both"}))

    let left = await generatorFor(3, {hand: "lower"})
    left.notes = await playCard(left, new NoteStats())
    expect(store.study(piece.id).hand).toEqual("lower")
  })

  describe("settings", function() {
    let settingsFor = extra => ({
      piece: piece.id, song: "", startMeasure: 1, endMeasure: 1, hand: BOTH_HANDS,
      measuresPerCard: WHOLE_SECTION, order: "in order", practice: null, ...extra,
    })
    const input = name => SHEET_MUSIC_GENERATOR.inputs.find(i => i.name == name)

    it("offers a never practised piece the programme, which starts its study", async function() {
      expect(store.items(piece.id)).toEqual([])
      expect(programmeOffered(settingsFor())).toBe(true)
      expect(input("practice").visible(settingsFor())).toBe(true)
      expect(input("practice").value(settingsFor())).toEqual(FREE_PRACTICE)
      expect(programmeOffered(settingsFor({piece: ""}))).toBe(false)

      let generator = SHEET_MUSIC_GENERATOR.create(grand, null, settingsFor({practice: PROGRAMME_PRACTICE}))
      generators.push(generator)
      expect(generator instanceof PlanGenerator).toBe(true)
      await generator.ready
      expect(generator.statusLine()).toEqual("New · bar 0")

      let notes = new NoteList([], {generator})
      notes.fillBuffer(8)
      let stats = new NoteStats()
      for (let i = 0; i < generator.currentCard().columns.length; i++) { notes = hit(notes, stats) }
      await generator.finishing
      await generator.studying
      expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "learning"}))
      expect(plannedPractice(settingsFor())).toBe(true)
    })

    it("keeps free practice for a practised piece until it is in study", async function() {
      // free practice schedules the measures it plays
      let generator = SHEET_MUSIC_GENERATOR.create(grand, null, settingsFor())
      generators.push(generator)
      let notes = new NoteList([], {generator})
      notes.fillBuffer(4)
      let stats = new NoteStats()
      for (let i = 0; i < 3; i++) { notes = hit(notes, stats) }
      await generator.finishing

      expect(plannedPractice(settingsFor())).toBe(false)
      expect(input("practice").value(settingsFor())).toEqual(FREE_PRACTICE)
      expect(plannedPractice(settingsFor({practice: PROGRAMME_PRACTICE}))).toBe(true)

      await store.putStudy({pieceId: piece.id, status: "learning", startedAt: NOW})
      expect(plannedPractice(settingsFor())).toBe(true)
      expect(input("practice").value(settingsFor())).toEqual(PROGRAMME_PRACTICE)
      expect(plannedPractice(settingsFor({practice: FREE_PRACTICE}))).toBe(false)
    })

    it("opens a picked piece in its own default practice", async function() {
      let other = (await importMusicXMLPiece("other.musicxml", pickupScore({title: "Other Minuet"}), store)).piece
      await store.putStudy({pieceId: piece.id, status: "learning", startedAt: NOW})

      let picked = input("piece").pick(settingsFor({piece: other.id, practice: FREE_PRACTICE}), piece.id).settings
      expect(picked.practice).toBe(null)
      expect(plannedPractice(picked)).toBe(true)

      let back = input("piece").pick({...picked, practice: PROGRAMME_PRACTICE}, other.id).settings
      expect(back.practice).toBe(null)
      expect(plannedPractice(back)).toBe(false)
    })

    it("plays the whole piece in the programme and the section in free practice", async function() {
      await store.putStudy({pieceId: piece.id, status: "learning", startedAt: NOW})

      let planned = SHEET_MUSIC_GENERATOR.create(grand, null, settingsFor())
      generators.push(planned)
      expect(planned instanceof PlanGenerator).toBe(true)
      await planned.ready
      expect(planned.deck.cardMeasures).toEqual(PLAN_CARD_MEASURES)
      expect(drilledRange(settingsFor())).toEqual({startMeasure: 0, endMeasure: 2})
      expect(input("startMeasure").visible(settingsFor())).toBe(false)

      let free = SHEET_MUSIC_GENERATOR.create(grand, null, settingsFor({practice: FREE_PRACTICE}))
      generators.push(free)
      expect(free instanceof PlanGenerator).toBe(false)
      expect(free.currentCard().measures).toEqual([1])
      expect(drilledRange(settingsFor({practice: FREE_PRACTICE}))).toEqual({startMeasure: 1, endMeasure: 1})
      expect(input("startMeasure").visible(settingsFor({practice: FREE_PRACTICE}))).toBe(true)
    })
  })
})
