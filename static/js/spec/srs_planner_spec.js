import MersenneTwister from "mersennetwister"

import {
  planNext, planState, planSummary, studyStatus, anchoredCard, onScheduleMeasures, mostOverduePiece,
  inStudy, entryStatus, entryCaption, cardCaption, blamedStaves, introduction, passagesForHand,
  pulledPassage, planUpcoming, upNextWords, PASSAGE_LEVEL,
  RETRY, LADDER, REVIEW, NEW, EARLY, RUN_THROUGH, WAIT, READ_THROUGH, LADDER_CAP, IDLE_LADDER_CAP,
  SITTING_GAP_MS, READ_FIRST, HARDEST_FIRST, SCORE_ORDER,
} from "st/srs/planner"
import {
  applyGrade, replay, scheduled, DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS,
  SCHEDULER_ALGO, DAY, MINUTE,
} from "st/srs/schedule"
import {newItem, itemId, validItem, RECENT_ATTEMPTS} from "st/srs/records"
import {PlanDeck, PlanGenerator} from "st/plan_cards"
import {MeasureCardDeck, MeasureCardGenerator, measureCards, IN_ORDER, COLUMN_JOIN_KEYS} from "st/measure_cards"
import {
  SHEET_MUSIC_GENERATOR, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, PROGRAMME_PRACTICE, FREE_PRACTICE, WHOLE_SECTION,
  plannedPractice, programmeOffered, drilledRange, PLAN_CARD_MEASURES, introductionOrder,
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

      // with nothing else to play the idle cap applies, so the sitting
      // carries on with a new bar rather than ending at the four resting
      let alone = plan([1, 2, 3, 4].map(failed))
      expect([...alone.state.resting].sort()).toEqual([1, 2, 3, 4])
      expect(alone.state.unseen).toEqual([5, 6, 7, 8])
      expect([alone.entry.reason, alone.entry.measure]).toEqual([NEW, 5])

      // until the bars resting fill the idle cap: a struggling player is
      // never fed the rest of the piece
      let full = planNext({
        pieceId: "p", now: NOW, measures: Array.from({length: 20}, (_, idx) => idx + 1),
        items: Array.from({length: IDLE_LADDER_CAP}, (_, idx) => failed(idx + 1)),
      })
      expect(full.state.laddered).toEqual(IDLE_LADDER_CAP)
      expect(full.state.unseen.length).toBeGreaterThan(0)
      expect(full.entry).toBe(null)
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
        due: 2, dueMinutes: 1, newMeasures: 5, toRead: 0, targetMinutes: 20, learned: 2, measures: 8,
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

    it("names a read-through entry, and a bar's passage role", function() {
      expect(entryStatus({reason: READ_THROUGH, measure: 3, hand: "both"}, {now: NOW}))
        .toEqual("Read-through · bar 3")
      expect(entryStatus({reason: READ_THROUGH, measure: 3, hand: "upper"}, {now: NOW}))
        .toEqual("Read-through · bar 3 · right hand")

      let entry = measure => ({reason: NEW, measure, hand: "both"})
      expect(entryStatus(entry(69), {now: NOW, passage: {role: "passage", start: 68, end: 73, level: 3}}))
        .toEqual("New · bar 69 · hardest passage")
      expect(entryStatus(entry(69), {now: NOW, passage: {role: "passage", start: 68, end: 73, level: 2}}))
        .toEqual("New · bar 69 · hard passage")
      expect(entryStatus(entry(69), {now: NOW, passage: {role: "passage", start: 68, end: 73, level: 1}}))
        .toEqual("New · bar 69 · worth a look")
      expect(entryStatus(entry(67), {now: NOW, passage: {role: "lead-in", start: 68, end: 73, level: 3}}))
        .toEqual("New · bar 67 · lead-in to bars 68–73")
      expect(entryStatus(entry(67), {now: NOW, passage: {role: "lead-in", start: 68, end: 68, level: 3}}))
        .toEqual("New · bar 67 · lead-in to bar 68")
      expect(entryStatus(entry(84), {now: NOW, passage: {role: "repeat", start: 11, end: 12, level: 2}}))
        .toEqual("New · bar 84 · repeats bars 11–12")
      expect(entryStatus(entry(17), {now: NOW})).toEqual("New · bar 17")
    })

    it("captions a read-through card by how many bars are left", function() {
      let state = toRead => ({toRead: Array.from({length: toRead}, (_, idx) => idx + 1)})
      expect(cardCaption({reason: READ_THROUGH, measure: 1}, null, state(87)))
        .toEqual("87 bars left to read through")
      expect(cardCaption({reason: READ_THROUGH, measure: 1}, null, state(1)))
        .toEqual("1 bar left to read through")
      expect(cardCaption({reason: READ_THROUGH, measure: 1}, null, state(0)))
        .toEqual("read-through done · new bars next")
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

    // the review of a hand alone's pass at a bar, and the state it moved on
    // from, which says whether the pass graduated it
    const moved = (hand, measure, time, was, grade=GOOD) => [`p:${hand}:${measure}-${measure}`, {
      itemId: `p:${hand}:${measure}-${measure}`, at: time, pieceId: "p", kind: "attempt",
      grade, was, misses: 0, staffMisses: {upper: 0, lower: 0},
    }]

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
        ["one miss", firstSight, blame(ago(1), 0, 1), {}, [RETRY, 3, "both"]],
        ["misses under two thirds on either staff", firstSight, blame(ago(1), 2, 2, 4), {}, [RETRY, 3, "both"]],
        ["misses spread over both staves", firstSight, blame(ago(1), 2, 3), {}, [RETRY, 3, "both"]],
        // a miss with both hands' notes untouched is blamed on both staves,
        // so the blames outnumber the misses and neither hand takes enough
        // of them to be sent alone
        ["every miss blamed on both staves", firstSight, blame(ago(1), 3, 3, 3), {}, [RETRY, 3, "both"]],
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
        ["graduated by an easy first sight",
          {lastReviews: new Map([...blame(ago(10), 0, 3), moved("lower", 3, ago(8), "new", EASY)])},
          [[ago(8), EASY]], undefined],
        ["good, then hard", {}, [[ago(8), GOOD], [ago(6), HARD]], "lower"],
        ["again, then good twice running", {}, [[ago(8), AGAIN], [ago(6), GOOD], [ago(4), GOOD]], undefined],
        ["held before the failure only", {}, [[ago(30), GOOD], [ago(20), GOOD]], "lower"],
        // a hand scaffolded before, graduated and in review when the bar
        // failed again: extending its interval is no graduation, so the two
        // goods running are what returns the bar
        ["in review before the failure, good once since", {},
          [[NOW - 30 * DAY, EASY], [ago(2), GOOD]], "lower"],
        ["in review before the failure, good twice since", {},
          [[NOW - 30 * DAY, EASY], [ago(4), GOOD], [ago(2), GOOD]], undefined],
        ["played alone, its failure's review not read yet", {lastReviews: new Map()}, [[ago(8), GOOD]], undefined],
      ]

      for (let [name, extra, attempts, hand] of rows) {
        let {state} = planned([failed, ...left(attempts)], {lastReviews: blame(ago(10), 0, 3), ...extra})
        expect(state.scaffolds.get(3)).withContext(name).toEqual(hand)
      }

      // once held, the bar itself comes straight back
      let held = left([[ago(8), GOOD], [ago(6), GOOD]])
      expect(entryIn([failed, ...held], {lastReviews: blame(ago(10), 0, 3)})).toEqual([RETRY, 3, "both"])

      // a failure blamed on both staves scaffolds neither hand
      let both = blame(ago(10), 3, 3)
      expect(planned([failed], {lastReviews: both}).state.scaffolds.get(3)).toBe(undefined)

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

    it("returns the bar hands together when its hand graduates since the failure", function() {
      // bar 5 failed at first sight, its left hand alone climbed two rungs
      // and the bar came back; it fails again, and the hand graduates on
      // the pass after that — a graduation, not an interval extended
      let bar = graded(5, [[ago(20), AGAIN], [ago(6), AGAIN]])
      let lower = graded(5, [[ago(16), GOOD], [ago(12), GOOD], [ago(2), EASY]], "lower")
      expect([lower.state, lower.lastGrade]).toEqual(["review", EASY])

      let reviews = new Map([
        ["p:both:5-5", {
          itemId: "p:both:5-5", at: ago(6), pieceId: "p", kind: "attempt", grade: AGAIN,
          misses: 3, staffMisses: {upper: 0, lower: 3},
        }],
        moved("lower", 5, ago(2), "learning", EASY),
      ])
      let {entry, state} = planNext({
        pieceId: "p", items: [...settled([5]), bar, lower], measures: MEASURES, now: NOW,
        handMeasures: APART, lastReviews: reviews,
      })

      expect(state.scaffolds.get(5)).toBe(undefined)
      expect([entry.measure, entry.hand]).toEqual([5, "both"])

      // the same hand, in review before the bar failed and merely extended
      // by the pass since, still owes the two goods
      let extended = new Map([...reviews, moved("lower", 5, ago(2), "review", EASY)])
      expect(planNext({
        pieceId: "p", items: [...settled([5]), bar, lower], measures: MEASURES, now: NOW,
        handMeasures: APART, lastReviews: extended,
      }).state.scaffolds.get(5)).toEqual("lower")
    })

    it("rests a bar its hands' items failed where the drill doesn't split", function() {
      // bar 3 failed once hands together and twice on its left hand alone
      let items = [graded(3, [[ago(10), AGAIN]]), graded(3, [[ago(8), AGAIN], [ago(6), AGAIN]], "lower")]
      let lastReviews = blame(ago(10), 0, 3)
      expect(planned(items, {lastReviews}).state.resting.has(3)).toBe(true)

      // a drill that can't offer a hand alone still reads the hands' items,
      // so the bar rests rather than coming back hands together
      let {entry, state} = planned(items, {lastReviews, split: false})
      expect(state.scaffolds.get(3)).toBe(undefined)
      expect([...state.failing]).toEqual([])
      expect(state.resting.has(3)).toBe(true)
      expect(entry.measure).not.toEqual(3)
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
      expect(blamedStaves(review(1, 3, 3))).toEqual(["lower"])
      expect(blamedStaves(review(2, 1, 3))).toEqual(["upper"])
      expect(blamedStaves(review(1, 1, 1))).toEqual([])
      expect(blamedStaves(review(4, 5, 6))).toEqual([])
      // a miss blamed on both hands is counted on both staves, so the
      // blames can outnumber the review's misses and neither hand has the
      // share of them a split needs
      expect(blamedStaves(review(3, 3, 3))).toEqual([])
      expect(blamedStaves({misses: 3})).toBe(null)
    })
  })

  describe("introduction order", function() {
    it("takes new measures in the order given, score order without one", function() {
      expect(entryOf(settled([5, 6, 1]), {introduce: [5, 6, 1, 2, 3, 4, 7, 8]})).toEqual([NEW, 5])
      expect(entryOf(settled([1]), {introduce: [5, 6, 1, 2, 3, 4, 7, 8]})).toEqual([NEW, 1])
      expect(entryOf(settled([5, 6, 1]))).toEqual([NEW, 1])
      expect(entryOf(settled([7, 1]), {introduce: [7, 99]})).toEqual([NEW, 7])
      expect(entryOf(settled([1]), {introduce: [7, 99]})).toEqual([NEW, 1])
    })

    it("keeps every limit whatever the order", function() {
      let rungs = count => [1, 2, 3, 4, 5, 6, 7, 8].slice(0, count)
        .map(m => onLadder(m, {due: NOW + m * MINUTE, last: NOW - 2 * DAY}))
      let early9 = inReview(9, {due: NOW + 5 * DAY, last: NOW - 3 * DAY})
      let measures = [...MEASURES, 9, 10]
      let introduce = [...measures].reverse()

      expect(entryOf([...rungs(LADDER_CAP), early9], {measures, introduce})).toEqual([EARLY, 9])
      expect(entryOf(rungs(IDLE_LADDER_CAP), {measures, introduce})).toEqual([WAIT, 1])

      let fresh = [1, 2].map((m, idx) => onLadder(m, {due: NOW + 5 * MINUTE, last: NOW - (idx + 1) * MINUTE}))
      let early8 = inReview(8, {due: NOW + 5 * DAY, last: NOW - 3 * DAY})
      let reversed = [...MEASURES].reverse()
      expect(entryOf([...fresh, early8], {introduce: reversed})).toEqual([EARLY, 8])
      expect(entryOf(fresh, {introduce: reversed})).toEqual([NEW, 8])
    })

    it("the fallback first new measure follows the order", function() {
      let items = [bar(1, {attempts: 1, lastPracticed: NOW - 6 * MINUTE})]
      let practice = {...DEFAULT_PRACTICE_SETTINGS, sessionMinutes: 5}
      expect(entryOf(items, {practice, introduce: [6, 1, 2, 3, 4, 5, 7, 8]})).toEqual([NEW, 6])
      expect(entryOf(items, {practice})).toEqual([NEW, 1])
    })

    it("plays exactly as no order given, in score order explicitly, a random month of grades", function() {
      let random = new MersenneTwister(7)
      let settings = DEFAULT_SCHEDULER_SETTINGS
      let without = new Map()
      let withOrder = new Map()
      let now = NOW

      for (let day = 0; day < 12; day++) {
        now = NOW + day * DAY
        for (let card = 0; card < 40; card++) {
          let a = planNext({pieceId: "p", items: [...without.values()], measures: MEASURES, now})
          let b = planNext({
            pieceId: "p", items: [...withOrder.values()], measures: MEASURES, now,
            introduce: MEASURES, readThrough: false,
          })

          expect([b.entry.reason, b.entry.measure, b.entry.hand])
            .toEqual([a.entry.reason, a.entry.measure, a.entry.hand])

          let grade = random.random() < 0.15 ? AGAIN : random.random() < 0.3 ? HARD : GOOD

          for (let [items, entry] of [[without, a.entry], [withOrder, b.entry]]) {
            let stored = items.get(entry.itemId) || bar(entry.measure)
            let early = !onScheduleMeasures([entry.measure], () => stored, now).length
            let next = early && grade > AGAIN ? {...stored, lastPracticed: now, attempts: stored.attempts + 1} : {
              ...applyGrade(stored, grade, now, settings), lastPracticed: now, attempts: stored.attempts + 1,
              recent: [...stored.recent, [now, 4, grade >= 3 ? 4 : 2, grade]].slice(-RECENT_ATTEMPTS),
            }
            items.set(entry.itemId, next)
          }

          now += 20 * 1000
        }
      }
    })

    describe("introduction()", function() {
      let flag = (start, end, level, extra={}) => ({start, end, level, hand: "both", ...extra})
      const TEN = Array.from({length: 10}, (_, i) => i + 1)

      it("has nothing to introduce without a counting flag, or in score order", function() {
        expect(introduction({measures: TEN, passages: []}))
          .toEqual(jasmine.objectContaining({introduce: null, readThrough: false}))
        expect(introduction({measures: TEN, passages: [flag(2, 3, 3)], order: SCORE_ORDER}))
          .toEqual(jasmine.objectContaining({introduce: null, readThrough: false}))
      })

      it("pulls the hardest passage early, from its lead-in, in READ_FIRST; every hard one in HARDEST_FIRST", function() {
        let passages = [flag(2, 3, 3), flag(6, 7, 2)]
        let readFirst = introduction({measures: TEN, passages, order: READ_FIRST})
        expect(readFirst.introduce).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        expect(readFirst.readThrough).toBe(true)

        let hardestFirst = introduction({measures: TEN, passages, order: HARDEST_FIRST})
        expect(hardestFirst.introduce).toEqual([1, 2, 3, 5, 6, 7, 4, 8, 9, 10])
        expect(hardestFirst.readThrough).toBe(false)
      })

      it("brings the lead-in with the pulled passage, wherever it falls", function() {
        let passages = [flag(5, 6, 3), flag(2, 3, 2)]
        expect(introduction({measures: TEN, passages, order: READ_FIRST}).introduce)
          .toEqual([4, 5, 6, 1, 2, 3, 7, 8, 9, 10])
        expect(introduction({measures: TEN, passages, order: HARDEST_FIRST}).introduce)
          .toEqual([4, 5, 6, 1, 2, 3, 7, 8, 9, 10])
      })

      it("skips unplayable bars for the lead-in, and never repeats it", function() {
        let measures = [1, 2, 4, 5]
        let passages = [flag(4, 5, 3)]
        expect(introduction({measures, passages, order: HARDEST_FIRST}).introduce).toEqual([2, 4, 5, 1])
      })

      it("pulls a flag's repeats right after it, early ones with the flag, the rest's after its last bar", function() {
        let withRepeat = [flag(2, 3, 3, {alsoAt: [[7, 8]]})]
        expect(introduction({measures: TEN, passages: withRepeat, order: READ_FIRST}).introduce)
          .toEqual([1, 2, 3, 7, 8, 4, 5, 6, 9, 10])

        let worthALookRepeat = [flag(5, 6, 3), flag(2, 3, 1, {alsoAt: [[7, 8]]})]
        expect(introduction({measures: TEN, passages: worthALookRepeat, order: READ_FIRST}).introduce)
          .toEqual([4, 5, 6, 1, 2, 3, 7, 8, 9, 10])
        expect(introduction({measures: TEN, passages: worthALookRepeat, order: SCORE_ORDER}).introduce)
          .toBe(null)
      })

      it("still reads through and pulls repeats for worth-a-look flags alone", function() {
        let passages = [flag(2, 3, 1, {alsoAt: [[7, 8]]})]
        let built = introduction({measures: TEN, passages, order: READ_FIRST})
        expect(built.readThrough).toBe(true)
        expect(built.introduce).toEqual([1, 2, 3, 7, 8, 4, 5, 6, 9, 10])
      })

      it("pulls no passage forward when none reaches PASSAGE_LEVEL", function() {
        let passages = [flag(5, 6, 1), flag(2, 3, 1)]
        expect(pulledPassage(passages)).toBe(null)
        expect(introduction({measures: TEN, passages, order: HARDEST_FIRST}).introduce)
          .toEqual(TEN)
        expect(introduction({measures: TEN, passages, order: READ_FIRST}).introduce)
          .toEqual(TEN)

        // one flagged that hard is pulled, hardest first, for either order
        let harder = [...passages, flag(8, 9, PASSAGE_LEVEL)]
        expect(pulledPassage(harder)).toEqual(jasmine.objectContaining({start: 8, end: 9}))
        expect(introduction({measures: TEN, passages: harder, order: READ_FIRST}).introduce)
          .toEqual([7, 8, 9, 1, 2, 3, 4, 5, 6, 10])
      })

      it("counts a flag for pulling only in a session of its hand", function() {
        let passages = [flag(5, 6, 3, {hand: "lower"})]
        expect(pulledPassage(passages, "upper")).toBe(null)
        expect(pulledPassage(passages, "lower")).toEqual(jasmine.objectContaining({start: 5}))
        expect(pulledPassage(passages)).toEqual(jasmine.objectContaining({start: 5}))
      })

      it("never reads through a piece of a single playable bar", function() {
        let passages = [flag(1, 1, 3)]
        let one = introduction({measures: [1], passages, order: READ_FIRST})
        expect(one.readThrough).toBe(false)
        expect(one.introduce).toEqual([1])

        expect(introduction({measures: [1, 2], passages, order: READ_FIRST}).readThrough).toBe(true)
      })

      it("counts a flag only for a session of its hand, or both", function() {
        let passages = [flag(2, 3, 3, {hand: "lower"})]
        expect(introduction({measures: TEN, passages, order: READ_FIRST, hand: "upper"}))
          .toEqual(jasmine.objectContaining({introduce: null, readThrough: false}))
        expect(introduction({measures: TEN, passages, order: READ_FIRST, hand: "lower"}).readThrough).toBe(true)
        expect(introduction({measures: TEN, passages, order: READ_FIRST, hand: "both"}).readThrough).toBe(true)
        expect(passagesForHand(passages, "upper")).toEqual([])
      })

      it("clips a flag to the playable bars it covers", function() {
        let measures = [1, 2, 3, 4, 5, 6]
        let passages = [flag(5, 20, 3)]
        expect(introduction({measures, passages, order: HARDEST_FIRST}).introduce).toEqual([4, 5, 6, 1, 2, 3])
      })

      it("marks every bar's role, earlier flags kept on an overlap", function() {
        let passages = [flag(5, 6, 3, {alsoAt: [[9, 10]]})]
        let readFirst = introduction({measures: TEN, passages, order: READ_FIRST})
        expect(readFirst.roles.get(4)).toEqual(jasmine.objectContaining({role: "lead-in"}))
        expect(readFirst.roles.get(5)).toEqual(jasmine.objectContaining({role: "passage", level: 3}))
        expect(readFirst.roles.get(6)).toEqual(jasmine.objectContaining({role: "passage", level: 3}))
        expect(readFirst.roles.get(9)).toEqual(jasmine.objectContaining({role: "repeat"}))
        expect(readFirst.roles.get(10)).toEqual(jasmine.objectContaining({role: "repeat"}))

        let scoreOrder = introduction({measures: TEN, passages, order: SCORE_ORDER})
        expect(scoreOrder.roles.get(5)).toEqual(jasmine.objectContaining({role: "passage"}))
        expect(scoreOrder.roles.has(4)).toBe(false)
        expect(scoreOrder.roles.has(9)).toBe(false)

        let overlapping = [flag(2, 4, 3), flag(3, 5, 1)]
        let overlap = introduction({measures: TEN, passages: overlapping, order: SCORE_ORDER})
        expect(overlap.roles.get(3)).toEqual(jasmine.objectContaining({level: 3}))
      })
    })
  })

  describe("read-through", function() {
    it("reads a new piece through first, as practice", function() {
      let fresh = plan([], {readThrough: true})
      expect([fresh.entry.reason, fresh.entry.measure]).toEqual([READ_THROUGH, 1])
      expect(fresh.state.toRead).toEqual(MEASURES)

      let started = [1, 2].map(m => bar(m, {attempts: 1, lastPracticed: NOW - MINUTE}))
      expect(entryOf(started, {readThrough: true})).toEqual([READ_THROUGH, 3])

      let allPlayed = MEASURES.map(m => bar(m, {attempts: 1, lastPracticed: NOW - MINUTE}))
      expect(entryOf(allPlayed, {readThrough: true, introduce: [6, 1, 2, 3, 4, 5, 7, 8]})).toEqual([NEW, 6])
    })

    it("resumes at the first bar not yet played", function() {
      let played = [1, 2, 4].map(m => bar(m, {attempts: 1, lastPracticed: NOW - MINUTE}))
      expect(entryOf(played, {readThrough: true})).toEqual([READ_THROUGH, 3])
    })

    it("never reads through a piece with a scheduled bar", function() {
      let {entry, state} = plan([inReview(3, {due: NOW + 9 * DAY})], {readThrough: true})
      expect(entry.reason).not.toEqual(READ_THROUGH)
      expect(state.toRead).toEqual([])
    })

    it("counts only the session's hand, and never a bar set aside", function() {
      let upperPlayed = {
        ...bar(1, {attempts: 1, lastPracticed: NOW - MINUTE}), hand: "upper",
        id: itemId({pieceId: "p", hand: "upper", startMeasure: 1, endMeasure: 1}),
      }
      expect(entryOf([upperPlayed], {readThrough: true})).toEqual([READ_THROUGH, 1])

      let suspended = {...bar(1), state: "suspended"}
      let {state} = plan([suspended], {readThrough: true})
      expect(state.toRead).not.toContain(1)
    })

    it("reads a start-apart bar through with the session's hand", function() {
      // decision 6 splits a bar at its introduction, not at the reading
      // before it: a read-through grades nothing, and its bar counts as read
      // by the session hand's own item, so a hand alone here would never
      // leave the bar behind
      let opts = {
        readThrough: true, handMeasures: {upper: MEASURES, lower: MEASURES},
        startApart: new Map([[1, ["lower"]]]),
      }
      let fresh = plan([], opts)
      expect([fresh.entry.reason, fresh.entry.measure, fresh.entry.hand])
        .toEqual([READ_THROUGH, 1, "both"])

      let read = [bar(1, {attempts: 1, lastPracticed: NOW - MINUTE})]
      expect(entryOf(read, opts)).toEqual([READ_THROUGH, 2])
    })

    it("sums up the read-through for the plate", function() {
      expect(planSummary({pieceId: "p", items: [], measures: MEASURES, now: NOW, readThrough: true}))
        .toEqual(jasmine.objectContaining({toRead: 8, newMeasures: 8}))
      expect(planSummary({pieceId: "p", items: [], measures: MEASURES, now: NOW}).toRead).toEqual(0)
    })
  })

  describe("hands apart from the start", function() {
    const APART = {upper: MEASURES, lower: MEASURES}
    const ago = minutes => NOW - minutes * MINUTE

    // a single measure item of piece p's hand, as the scheduler leaves it
    // from the attempts given (the same pattern as "hands apart and rests")
    const graded = (measure, attempts, hand="both") => {
      let id = itemId({pieceId: "p", hand, startMeasure: measure, endMeasure: measure})
      let item = replay(attempts.map(([time, grade]) => ({
        itemId: id, at: time, pieceId: "p", kind: "attempt", grade, columns: 4, clean: grade > AGAIN ? 4 : 1,
      })))
      return {...item, attempts: attempts.length, lastPracticed: attempts[attempts.length - 1][0]}
    }

    // bar 3 is the only measure not already settled (in review, far off),
    // so it is the only candidate the queue has to offer
    const planned = (items, extra) => planNext({
      pieceId: "p", items: [...settled([3]), ...items], measures: MEASURES, now: NOW,
      handMeasures: APART, ...extra,
    })
    const entryIn = (items, extra) => {
      let {entry} = planned(items, extra)
      return [entry.reason, entry.measure, entry.hand]
    }
    const stateOf = (items, extra) => planState({
      pieceId: "p", items: [...settled([3]), ...items], measures: MEASURES, now: NOW,
      handMeasures: APART, ...extra,
    })

    it("introduces a bar hands apart when a flag names one hand, until it holds", function() {
      let startApart = new Map([[3, ["lower"]]])

      let {entry, state} = planned([], {startApart})
      expect([entry.reason, entry.measure, entry.hand]).toEqual([NEW, 3, "lower"])
      expect(entry.item).toBe(null)
      expect(entryStatus(entry, {now: NOW})).toEqual("New · bar 3 · left hand")
      expect(cardCaption(entry, null, state)).toEqual("Left hand alone, then together")

      // its own item, once on the ladder, is a ladder slot of its own,
      // counted toward LADDER_CAP like any rung - not yet held
      let once = graded(3, [[ago(0.5), GOOD]], "lower")
      let onceState = stateOf([once], {startApart})
      expect(onceState.ladder.some(slot => slot.measure == 3 && slot.hand == "lower")).toBe(true)
      expect(onceState.laddered).toBeGreaterThan(0)

      // it is no longer a measure to introduce, since its hand is on the
      // ladder, but bar 3 has still never been scheduled hands together: it
      // is what the piece has left to learn
      expect(onceState.offerable).toEqual([])
      expect(onceState.unseen).toEqual([3])
      let onceInput = {
        pieceId: "p", items: [...settled([3]), once], measures: MEASURES, now: NOW,
        handMeasures: APART, startApart,
      }
      expect(studyStatus(onceInput)).toEqual("learning")
      expect(planSummary(onceInput).newMeasures).toEqual(1)

      // two goods running: the hand holds, and the bar is unseen hands
      // together again, a normal NEW entry
      let held = graded(3, [[ago(0.8), GOOD], [ago(0.5), GOOD]], "lower")
      let heldState = stateOf([held], {startApart})
      expect(heldState.startApartIntros.has(3)).toBe(false)
      expect(heldState.unseen).toEqual([3])
      expect(entryIn([held], {startApart})).toEqual([NEW, 3, "both"])
    })

    it("offers a both-hands flag the right hand first, then the left, then together", function() {
      let startApart = new Map([[3, ["upper", "lower"]]])

      let {entry, state} = planned([], {startApart})
      expect([entry.reason, entry.measure, entry.hand]).toEqual([NEW, 3, "upper"])
      expect(cardCaption(entry, null, state)).toEqual("Right hand alone, then the left")

      let rightHeld = graded(3, [[ago(0.8), GOOD], [ago(0.5), GOOD]], "upper")
      let phase2 = stateOf([rightHeld], {startApart})
      expect(phase2.startApartIntros.get(3).hand).toEqual("lower")
      expect(phase2.startApartCaptions.get(3)).toEqual("Left hand alone, then together")

      let bothHeld = [
        graded(3, [[ago(1.6), GOOD], [ago(1.3), GOOD]], "upper"),
        graded(3, [[ago(0.8), GOOD], [ago(0.5), GOOD]], "lower"),
      ]
      let phase3 = stateOf(bothHeld, {startApart})
      expect(phase3.startApartIntros.has(3)).toBe(false)
      expect(phase3.unseen).toEqual([3])
    })

    it("changes nothing without startApart, with an empty one, or where split is false", function() {
      let rows = [
        {}, {startApart: null}, {startApart: new Map()},
        {startApart: new Map([[3, ["lower"]]]), split: false},
      ]
      for (let extra of rows) {
        expect(entryIn([], extra)).toEqual([NEW, 3, "both"])
      }
    })

    it("ignores the tick for a bar only one hand has notes in, or one already live hands together", function() {
      let startApart = new Map([[3, ["lower"]]])

      // bar 3 isn't in `apart`: the right hand alone has no notes there
      let oneHand = planned([], {
        startApart, handMeasures: {upper: MEASURES, lower: MEASURES.filter(m => m != 3)},
      })
      expect(oneHand.entry.hand).toEqual("both")

      // bar 3 already has a hands-together item: it isn't unseen any more
      let together = graded(3, [[ago(1), AGAIN]])
      expect(entryIn([together], {startApart}).slice(1)).toEqual([3, "both"])
    })

    it("rests a start-apart bar its hand failed a third time in the sitting", function() {
      let startApart = new Map([[3, ["lower"]]])
      let fails = times => graded(3, times.map(minutes => [ago(minutes), AGAIN]), "lower")

      // twice is no rest: the bar is still offered, on its hand's own ladder
      let twice = stateOf([fails([10, 8])], {startApart})
      expect(twice.resting.has(3)).toBe(false)
      expect(entryIn([fails([10, 8])], {startApart})).toEqual([LADDER, 3, "lower"])

      // the third failure sets the bar aside for the sitting, hands apart
      // or together, and it is still counted on the ladder
      let failing = fails([10, 8, 6])
      let state = stateOf([failing], {startApart})
      expect(state.resting.has(3)).toBe(true)
      expect(state.ladder.some(slot => slot.measure == 3)).toBe(false)
      expect(state.offerable).toEqual([])
      expect(state.unseen).toEqual([3])
      expect(state.laddered).toEqual(1)
      expect(cardCaption({reason: NEW, measure: 3, hand: "lower"}, failing, state))
        .toEqual("Bar 3 rests until your next sitting")

      let {entry} = planned([failing], {startApart})
      expect(entry.measure).not.toEqual(3)

      // the next sitting opens on it again, still on its hand alone
      expect(entryIn([failing], {startApart, now: NOW + 2 * 3600 * 1000}))
        .toEqual([LADDER, 3, "lower"])
    })

    it("resting keeps a start-apart bar out of the sitting's queue alone, not out of what is left to learn", function() {
      let startApart = new Map([[3, ["upper", "lower"]]])
      // the right hand failed three times in this sitting and then held, so
      // the bar rests while the hand standing in for it has no item yet
      let upper = graded(3, [
        [ago(12), AGAIN], [ago(10), AGAIN], [ago(8), AGAIN], [ago(6), GOOD], [ago(4), GOOD],
      ], "upper")
      let input = {
        pieceId: "p", items: [...settled([3]), upper], measures: MEASURES, now: NOW,
        handMeasures: APART, startApart,
      }

      let state = planState(input)
      expect(state.resting.has(3)).toBe(true)
      expect(state.startApartIntros.get(3).hand).toEqual("lower")

      // bar 3 has never been scheduled hands together: it is still a measure
      // the piece has to learn, whatever the sitting makes of it
      expect(state.unseen).toEqual([3])
      expect(state.offerable).toEqual([])
      expect(studyStatus(input)).toEqual("learning")
      expect(planSummary(input).newMeasures).toEqual(1)

      // the queue still doesn't offer it again this sitting
      expect(planNext(input).entry.measure).not.toEqual(3)
    })

    it("counts a start-apart hand item toward LADDER_CAP and mostOverduePiece's due count", function() {
      let startApart = new Map([[3, ["lower"]]])

      expect(stateOf([], {startApart}).laddered).toEqual(0)

      let onLadderItem = graded(3, [[ago(0.5), GOOD]], "lower")
      expect(stateOf([onLadderItem], {startApart}).laddered).toEqual(1)

      // it counts as due while bar 3 has no hands-together item of its own
      let overdue = mostOverduePiece({
        studies: [{pieceId: "p", status: "learning", startedAt: 0}],
        items: [...settled([3]), onLadderItem],
        now: NOW,
      })
      expect(overdue).toEqual("p")
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

      // a hand the bar has held since its failure is retired too, though the
      // bar is still on the ladder: p keeps one due bar, so q wins on two
      let failing = item(onLadder(3, {due: NOW - DAY + 1000, last: NOW - DAY - 30 * MINUTE, grade: AGAIN}))
      let heldLeft = {...left, recent: [25, 20].map(n => [NOW - DAY - n * MINUTE, 4, 4, GOOD])}
      let twoDue = [1, 2].map(measure => item(inReview(measure, {due: NOW - DAY + 5000}), "both", "q"))

      expect(mostOverduePiece({studies, items: [...twoDue, failing, heldLeft], now: NOW})).toEqual("q")
      expect(mostOverduePiece({studies, items: [...twoDue, failing, left], now: NOW})).toEqual("p")
    })

    it("counts a piece practised with one hand alone", function() {
      let item = (fields, hand, pieceId) => ({...fields, pieceId, hand,
        id: itemId({pieceId, hand, startMeasure: fields.startMeasure, endMeasure: fields.endMeasure})})

      // p has one bar due hands together; q has only ever been played with
      // the right hand, so its bars have no bar of their own to retire them
      let items = [
        item(inReview(1, {due: NOW - DAY}), "both", "p"),
        ...[1, 2].map(m => item(inReview(m, {due: NOW - DAY + 5000}), "upper", "q")),
      ]
      let studies = ["p", "q"].map(pieceId => ({pieceId, status: "learning", startedAt: 0}))

      expect(mostOverduePiece({studies, items, now: NOW})).toEqual("q")
    })

    it("counts a hand alone the player chose whatever the hand scaffold says", function() {
      let studies = ["p", "q"].map(pieceId => ({pieceId, status: "learning", startedAt: 0}))
      let item = (fields, hand="both", pieceId="p") => ({...fields, pieceId, hand,
        id: itemId({pieceId, hand, startMeasure: fields.startMeasure, endMeasure: fields.endMeasure})})
      // q has one bar due, just after p's left hand; p's bar 3 holds hands
      // together, and its left hand alone is due
      let other = item(inReview(1, {due: NOW - DAY + 5000}), "both", "q")
      let together = item(inReview(3, {due: NOW + 5 * DAY}))
      let left = item(inReview(3, {due: NOW - DAY}), "lower")

      // made by the scaffold, which has retired it
      expect(mostOverduePiece({studies, items: [other, together, left], now: NOW})).toEqual("q")
      // practised by choice, in free practice or a programme played with that hand
      expect(mostOverduePiece({studies, items: [other, together, {...left, deliberate: true}], now: NOW}))
        .toEqual("p")
    })

    it("makes the programme the default in study", function() {
      expect(inStudy(null)).toBe(false)
      expect(inStudy({pieceId: "p", status: "learning", startedAt: 0})).toBe(true)
      expect(inStudy({pieceId: "p", status: "shelved", startedAt: 0})).toBe(false)
    })
  })

  describe("the up next preview", function() {
    it("previews planNext's own entry order, deduped by measure, without the entry on the stand", function() {
      // last well outside the sitting gap, so the rung isn't also the
      // measure just played (which avoid already excludes)
      let rung = onLadder(1, {due: NOW, last: NOW - 30 * MINUTE})
      let input = Object.freeze({
        pieceId: "p", items: Object.freeze([rung]), measures: Object.freeze([1, 2, 3, 4, 5]), now: NOW,
      })

      expect(planUpcoming(input, 2).map(e => [e.reason, e.measure])).toEqual([[LADDER, 1], [NEW, 2]])

      // the rung's own entry (the ladder slot, and its duplicate in the
      // waiting list) is dropped once it is the entry on the stand
      let withPrevious = {...input, previous: rung.id}
      expect(planUpcoming(withPrevious, 2).map(e => e.measure)).not.toContain(1)
    })

    it("never mutates its input", function() {
      let input = Object.freeze({
        pieceId: "p",
        items: Object.freeze([onLadder(1, {due: NOW}), inReview(2, {due: NOW + 9 * DAY})]),
        measures: Object.freeze([1, 2, 3, 4, 5]),
        now: NOW,
      })

      expect(() => planUpcoming(input, 3)).not.toThrow()
    })

    it("gives each reason's words, the bar's passage role for a new one, and a hand alone appended", function() {
      let entry = (reason, measure, hand="both") => ({reason, measure, itemId: "x", item: null, hand})

      expect(upNextWords(entry(NEW, 5))).toEqual("New")
      expect(upNextWords(entry(NEW, 5), {role: "passage", level: 3})).toEqual("New · hardest passage")
      expect(upNextWords(entry(NEW, 5), {role: "passage", level: 2})).toEqual("New · hard passage")
      expect(upNextWords(entry(NEW, 5), {role: "lead-in", start: 5, end: 9})).toEqual("New · lead-in to bars 5–9")
      expect(upNextWords(entry(NEW, 6), {role: "repeat", start: 5, end: 9})).toEqual("New · repeats bars 5–9")
      expect(upNextWords(entry(RETRY, 3))).toEqual("Again, in a moment")
      expect(upNextWords(entry(LADDER, 3))).toEqual("Once more")
      expect(upNextWords(entry(WAIT, 3))).toEqual("Once more")
      expect(upNextWords(entry(REVIEW, 3))).toEqual("Review")
      expect(upNextWords(entry(EARLY, 3))).toEqual("Review")
      expect(upNextWords(entry(RUN_THROUGH, 3))).toEqual("Run-through")
      expect(upNextWords(entry(READ_THROUGH, 3))).toEqual("Read-through")
      expect(upNextWords(entry(NEW, 6, "upper"))).toEqual("New · right hand")
      expect(upNextWords(entry(WAIT, 6, "lower"))).toEqual("Once more · left hand")
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
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    await generator.ready
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
    let {deck, generator, notes} = await generatorFor(2)
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

  // an item of one bar on the ladder as of `at`, with the grades it has been
  // given, and the review that last wrote it
  let ladderBar = (measure, grades, at, extra={}) => ({
    id: itemId({pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure}),
    pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure,
    level: "bar", state: "learning", step: 0, due: at, last: at, s: 1, d: 5,
    reps: grades.length, lapses: grades.filter(g => g == AGAIN).length, streak: 0,
    lastGrade: grades[grades.length - 1], hits: 3, misses: 3 * grades.length,
    attempts: grades.length, lastPracticed: at, elapsedMs: 3000, algo: 1,
    createdAt: at - 5 * MINUTE,
    recent: grades.map((grade, n) => [at - (grades.length - n) * 1000, 3, 0, grade]),
    ...extra,
  })

  let writeLadderBar = async item => store.recordAttempt({
    item,
    review: {
      itemId: item.id, pieceId: piece.id, at: item.last, kind: "attempt", grade: item.lastGrade,
      was: "learning", columns: 3, clean: 0, misses: 3, stuck: 0, skipped: 0, hesitations: 0,
      mode: "wait", algo: 1, staffMisses: {upper: 0, lower: 3},
    },
  })

  it("leaves a resting bar as it is when a neighbour's card plays it", async function() {
    let at = time - MINUTE
    let bar = (measure, grades, extra={}) => ladderBar(measure, grades, at, extra)
    let write = writeLadderBar

    // bar 2 has failed three times in this sitting, so it rests; bar 1 is
    // due, and its card of two measures plays bar 2 with it
    await write(bar(0, [GOOD], {state: "review", due: time + 20 * DAY}))
    await write(bar(1, [GOOD]))
    await write(bar(2, [AGAIN, AGAIN, AGAIN]))
    time += 2 * MINUTE

    let {deck, generator, notes} = await generatorFor(2)
    let stats = new NoteStats()
    let resting = store.item(`${piece.id}:both:2-2`)
    let anchor = store.item(`${piece.id}:both:1-1`)
    expect([...planState(deck.planInput()).resting]).toEqual([2])
    expect(deck.entry.measure).toEqual(1)
    expect(generator.currentCard().measures).toEqual([1, 2])

    // the pass fails on bar 2's own column, the card's last
    let count = generator.currentCard().columns.length
    for (let i = 0; i < count; i++) {
      time += 1000
      if (i == count - 1) { stats.missNotes([...notes.currentColumn()]) }
      notes = hit(notes, stats)
    }
    await generator.finishing

    // its ladder is untouched: no review of its own, and its due date, state
    // and lapses stand, while the pass counts as practice on it
    let played = store.item(`${piece.id}:both:2-2`)
    expect([played.due, played.state, played.lapses, played.lastGrade])
      .toEqual([resting.due, resting.state, resting.lapses, resting.lastGrade])
    expect(played.attempts).toBeGreaterThan(resting.attempts)
    expect(played.lastPracticed).toBeGreaterThan(resting.lastPracticed)
    expect((await store.reviews({pieceId: piece.id}))
      .filter(review => review.itemId == `${piece.id}:both:2-2` && review.at > resting.last))
      .toEqual([])

    // the bar the card was anchored on is graded as usual
    let played1 = store.item(`${piece.id}:both:1-1`)
    expect(played1.reps).toBeGreaterThan(anchor.reps)
    expect(played1.due).not.toEqual(anchor.due)
  })

  it("adds a resting bar's practice once when a self grade doesn't name it", async function() {
    let at = time - MINUTE
    await writeLadderBar(ladderBar(0, [GOOD], at, {state: "review", due: time + 20 * DAY}))
    await writeLadderBar(ladderBar(1, [GOOD], at))
    await writeLadderBar(ladderBar(2, [AGAIN, AGAIN, AGAIN], at))
    time += 2 * MINUTE

    // acoustic mode: bar 2 rests, and the card anchored on bar 1 plays it
    let {deck, generator} = await generatorFor(2)
    generator.setDrill(() => ({mode: "self"}))
    let resting = store.item(`${piece.id}:both:2-2`)
    expect([...planState(deck.planInput()).resting]).toEqual([2])
    expect(generator.currentCard().measures).toEqual([1, 2])

    time += 1000
    generator.selfGrade(HARD, {bars: [1]})
    await generator.finishing

    // the bar the player didn't blame is practice alone, written once: its
    // ladder stands and its totals count the pass a single time
    let played = store.item(`${piece.id}:both:2-2`)
    expect([played.due, played.state, played.lapses, played.lastGrade])
      .toEqual([resting.due, resting.state, resting.lapses, resting.lastGrade])
    expect(played.attempts).toEqual(resting.attempts + 1)
    expect((await store.reviews({pieceId: piece.id}))
      .filter(review => review.itemId == `${piece.id}:both:2-2` && review.at > resting.last))
      .toEqual([])

    // the bar it named is graded
    expect(store.item(`${piece.id}:both:1-1`).lastGrade).toEqual(HARD)
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

    // a reload, with nothing known of the piece's reviews, plans the bar
    // hands together at once and reads the log because it is failing, so
    // the same hand alone is offered again before a card of it is played
    let reopened = await openTestStore({keep: true})
    let reloaded = new PlanDeck(measures, {
      pieceId: piece.id, cardMeasures: 1, ...hands, store: reopened, now: () => time,
    })
    expect(reloaded.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "both"}))
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

  it("offers a bar failing on one hand's notes as that hand alone while the drill scrolls", async function() {
    let {built, ...hands} = handPools()
    let {deck, generator, notes} = await generatorFor(1, hands)
    generator.setDrill(() => ({mode: "scroll", speed: 100}))
    let stats = new NoteStats()
    notes = await playCard({generator, notes}, stats)

    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    notes = await playCard({generator, notes}, stats)

    expect(deck.entry).toEqual(jasmine.objectContaining({reason: LADDER, measure: 1, hand: "lower"}))
    expect(generator.replanning()).toBe(false)
    expect(generator.currentCard()).toEqual(jasmine.objectContaining({measures: [1], hand: "lower"}))
    expect(built).toEqual(["lower:1"])

    notes = await playCard({generator, notes}, stats)
    let reviews = await store.reviews({pieceId: piece.id})
    expect(reviews[reviews.length - 1]).toEqual(jasmine.objectContaining({
      itemId: `${piece.id}:lower:1-1`, mode: "scroll",
    }))
  })

  it("keeps a hand alone showing whatever mode the drill is in", async function() {
    let {built, ...hands} = handPools()
    let {deck, generator, notes} = await generatorFor(1, hands)
    let stats = new NoteStats()
    notes = await playCard({generator, notes}, stats)
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    notes = await playCard({generator, notes}, stats)
    expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))

    let mode = "wait"
    generator.setDrill(() => ({mode}))
    let entry = deck.entry
    for (let next of ["scroll", "wait"]) {
      mode = next
      generator.setDrill(() => ({mode}))
      expect(deck.split()).toBe(true)
      expect(generator.replanning()).toBe(false)
      expect(generator.replan()).toBe(false)
      expect(deck.entry).toEqual(entry)
    }
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

  it("plans at once, and reads the log only for a bar that can split and is failing", async function() {
    let measures = pool()
    let deckFor = opts => new PlanDeck(measures, {
      pieceId: piece.id, cardMeasures: 1, store, now: () => time, ...opts,
    })
    spyOn(store, "reviews").and.callThrough()

    // a session played with one hand, one with no hands to split with, and
    // one whose hands never share a bar: none can offer a bar hands apart
    expect(deckFor({hand: "lower", ...handPools()}).entry)
      .toEqual(jasmine.objectContaining({measure: 0, hand: "lower"}))
    expect(deckFor({}).entry).toEqual(jasmine.objectContaining({measure: 0, hand: "both"}))

    let {handCard} = handPools()
    let alternating = deckFor({handCard, handMeasures: {upper: [0, 2], lower: [1]}})
    expect(alternating.entry).toEqual(jasmine.objectContaining({measure: 0, hand: "both"}))
    expect(alternating.handMeasures).toBe(null)

    // a deck that can split plans at once too while no bar of it is failing
    let quiet = deckFor(handPools())
    expect(quiet.entry).toEqual(jasmine.objectContaining({measure: 0, hand: "both"}))
    expect(quiet.ready).toBe(undefined)
    expect(store.reviews).not.toHaveBeenCalled()

    // once a bar that can split fails, the log says which hand it blames,
    // so the deck reads it and plans again from what it finds
    let {generator, notes} = await generatorFor(1, handPools())
    let stats = new NoteStats()
    notes = await playCard({generator, notes}, stats)
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    await playCard({generator, notes}, stats)

    let failing = deckFor(handPools())
    expect(failing.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "both"}))
    await failing.ready
    expect(failing.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
    expect(store.reviews).toHaveBeenCalled()
  })

  // bar 1, failed twice running so its next rung is minutes off, with its
  // misses split evenly across the staves so no hand is blamed
  let barOneFailing = ({blame = {upper: 2, lower: 2}} = {}) => {
    let at = time - 5 * MINUTE
    let id = itemId({pieceId: piece.id, hand: "both", startMeasure: 1, endMeasure: 1})
    return store.recordAttempt({
      item: {
        id, pieceId: piece.id, hand: "both", startMeasure: 1, endMeasure: 1,
        level: "bar", state: "learning", step: 1, due: time + 5 * MINUTE, last: at, s: 1, d: 5,
        reps: 2, lapses: 1, streak: 0, lastGrade: AGAIN, hits: 0, misses: 4, attempts: 2,
        lastPracticed: at, elapsedMs: 4000, algo: 1, createdAt: at - MINUTE,
        recent: [[at - MINUTE, 4, 0, AGAIN], [at, 4, 0, AGAIN]],
      },
      review: {
        itemId: id, pieceId: piece.id, at, kind: "attempt", grade: AGAIN, was: "learning",
        columns: 4, clean: 0, misses: 4, stuck: 0, skipped: 0, hesitations: 0, mode: "wait",
        algo: 1, staffMisses: blame,
      },
    })
  }

  it("marks a hand alone a flag's tick asked for requested, never deliberate; the scaffold's hand is neither", async function() {
    let {built, ...hands} = handPools()
    let setUp = await generatorFor(1, {...hands, startApart: () => new Map([[1, ["lower"]]])})
    let stats = new NoteStats()
    let notes = await playCard(setUp, stats)

    // bar 1 is introduced left hand alone, at the flag's request
    expect(setUp.deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 1, hand: "lower"}))
    expect(setUp.deck.scaffold).toBe(true)
    expect(setUp.deck.requested).toBe(true)

    await playCard({...setUp, notes}, stats)
    let asked = store.item(`${piece.id}:lower:1-1`)
    expect(asked.requested).toBe(true)
    expect(asked.deliberate).toBeUndefined()
    expect(validItem(asked)).toBe(true)
    expect(store.item(`${piece.id}:both:0-0`).requested).toBeUndefined()
  })

  it("does not mark the hand scaffold's own hand-alone pass requested", async function() {
    let {built, ...hands} = handPools()
    await barOneFailing({blame: {upper: 0, lower: 4}})

    // the log is read before the first card is dealt: bar 1 failed on the
    // bass staff, so the scaffold offers it left hand alone
    let setUp = await generatorFor(1, hands)
    expect(setUp.deck.reviews.size).toEqual(1)
    setUp.deck.advance(false)
    setUp.generator.startCard()

    expect(setUp.deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
    expect(setUp.deck.scaffold).toBe(true)
    expect(setUp.deck.requested).toBe(false)

    await playCard({...setUp, notes: setUp.notes}, new NoteStats())
    let made = store.item(`${piece.id}:lower:1-1`)
    expect(made).toBeTruthy()
    expect(made.requested).toBeUndefined()
    expect(made.deliberate).toBeUndefined()
  })

  it("plans again from the log without dropping the card it never played", async function() {
    let measures = pool()
    await barOneFailing()

    // bar 1 is failing and can split, so the deck reads the log; its review
    // blames neither hand, so the plan it makes again is the same one
    let deck = new PlanDeck(measures, {
      pieceId: piece.id, cardMeasures: 1, store, now: () => time, ...handPools(),
    })
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 0}))

    await deck.ready
    expect(deck.reviews.size).toEqual(1)
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 0}))
  })

  it("waits for the pass in progress before it plans again from the log", async function() {
    let measures = pool()
    await barOneFailing({blame: {upper: 0, lower: 4}})

    // the log read is held up until the player is into the card
    let landed
    let reviews = await store.reviews({pieceId: piece.id})
    spyOn(store, "reviews").and.returnValue(new Promise(resolve => { landed = resolve }))

    // a card of two bars, so one column played leaves the pass in progress
    let deck = new PlanDeck(measures, {
      pieceId: piece.id, cardMeasures: 2, store, now: () => time, ...handPools(),
    })
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    let notes = new NoteList([], {generator})
    notes.fillBuffer(8)

    let entry = deck.entry
    let card = generator.currentCard()
    expect(entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 0}))

    time += 1000
    notes = hit(notes, new NoteStats())
    expect(generator.playing()).toBe(true)

    landed(reviews)
    expect(await generator.ready).toBe(false)

    // the card the player is on is left alone, and the reviews are kept for
    // the plan after it
    expect(deck.entry).toEqual(entry)
    expect(generator.currentCard()).toBe(card)
    expect(deck.reviews.size).toEqual(1)
    expect(deck.advance().scaffolds.get(1)).toEqual("lower")
  })

  it("reads the log for a bar that rests, so the scaffold holds when it wakes", async function() {
    let measures = pool()
    let {built, ...hands} = handPools()
    let at = time - MINUTE

    // every bar failed three times in this sitting, so all of them rest;
    // bar 1's misses fell on the bass staff, and it comes back first
    for (let measure of [0, 1, 2]) {
      let id = itemId({pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure})
      await store.recordAttempt({
        item: {
          id, pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure,
          level: "bar", state: "learning", step: 0, due: measure == 1 ? at : at + 30 * 1000,
          last: at, s: 1, d: 5, reps: 3, lapses: 2, streak: 0, lastGrade: AGAIN,
          hits: 0, misses: 9, attempts: 3, lastPracticed: at, elapsedMs: 3000,
          algo: 1, createdAt: at - 3 * MINUTE,
          recent: [2, 1, 0].map(n => [at - n * MINUTE, 3, 0, AGAIN]),
        },
        review: {
          itemId: id, pieceId: piece.id, at, kind: "attempt", grade: AGAIN, was: "learning",
          columns: 3, clean: 0, misses: 3, stuck: 0, skipped: 0, hesitations: 0, mode: "wait",
          algo: 1, staffMisses: measure == 1 ? {upper: 0, lower: 3} : {upper: 3, lower: 0},
        },
      })
    }

    // the drill is rebuilt while they rest, so there is no card to show
    let deck = new PlanDeck(measures, {pieceId: piece.id, cardMeasures: 1, ...hands, store, now: () => time})
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    expect([...planState(deck.planInput()).resting].sort()).toEqual([0, 1, 2])
    expect(deck.entry).toBe(null)

    // the log is still read, so when the next sitting wakes bar 1 the hand
    // its failure blamed is the one offered
    await generator.ready
    expect(deck.reviews.size).toEqual(3)

    time += SITTING_GAP_MS + MINUTE
    expect(generator.replan()).toBe(true)
    expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
    expect(built).toEqual(["lower:1"])
  })

  it("rests a bar its hand alone failed once the drill stops splitting", async function() {
    let measures = pool()
    let {built, ...hands} = handPools()
    let at = time - MINUTE

    // bar 1 failed once hands together, blamed on the bass staff, and twice
    // more on its left hand alone: three failures in this sitting
    let failed = async (hand, times) => {
      let id = itemId({pieceId: piece.id, hand, startMeasure: 1, endMeasure: 1})
      await store.recordAttempt({
        item: {
          id, pieceId: piece.id, hand, startMeasure: 1, endMeasure: 1,
          level: "bar", state: "learning", step: 0, due: at, last: at, s: 1, d: 5,
          reps: times, lapses: times, streak: 0, lastGrade: AGAIN,
          hits: 0, misses: 3 * times, attempts: times, lastPracticed: at, elapsedMs: 3000,
          algo: 1, createdAt: at - 3 * MINUTE,
          recent: [...Array(times).keys()].map(n => [at - n * MINUTE, 3, 0, AGAIN]),
        },
        review: {
          itemId: id, pieceId: piece.id, at, kind: "attempt", grade: AGAIN, was: "learning",
          columns: 3, clean: 0, misses: 3, stuck: 0, skipped: 0, hesitations: 0, mode: "wait",
          algo: 1, staffMisses: {upper: 0, lower: 3},
        },
      })
    }
    await failed("both", 1)
    await failed("lower", 2)

    let deck = new PlanDeck(measures, {pieceId: piece.id, cardMeasures: 1, ...hands, store, now: () => time})
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    await generator.ready
    expect(planState(deck.planInput()).resting.has(1)).toBe(true)

    // the staff can't draw one hand alone, so the scaffold isn't offered;
    // the hand's failures still rest the bar rather than bringing it back
    // hands together
    generator.setHandsApart(() => false)
    let state = planState(deck.planInput())
    expect(state.resting.has(1)).toBe(true)
    expect(state.scaffolds.get(1)).toBe(undefined)
    expect([...state.failing]).toEqual([])
    expect(deck.entry && deck.entry.measure).not.toEqual(1)
  })

  describe("introduction order and read-through", function() {
    let flagAt2 = () => [{start: 2, end: 2, level: 3, hand: "both"}]

    it("reads the piece through as practice, then brings in the hardest passage from its lead-in", async function() {
      let {deck, generator, notes} = await generatorFor(2, {passages: flagAt2, order: READ_FIRST})
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: READ_THROUGH, measure: 0}))
      expect(generator.currentCard().measures).toEqual([0, 1])
      expect(generator.statusLine()).toEqual("Read-through · bar 0")

      let stats = new NoteStats()
      let itemOf = m => store.item(`${piece.id}:both:${m}-${m}`)

      notes = await playCard({generator, notes}, stats)
      expect(itemOf(0).attempts).toEqual(1)
      expect(itemOf(1).attempts).toEqual(1)
      expect(scheduled(itemOf(0))).toBe(false)
      expect(await store.reviews({pieceId: piece.id})).toEqual([])
      expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "learning"}))
      expect(generator.caption()).toMatch(/1 bar left to read through$/)
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: READ_THROUGH, measure: 2}))

      notes = await playCard({generator, notes}, stats)
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 1}))
      expect(generator.statusLine()).toEqual("New · bar 1 · lead-in to bar 2")

      await playCard({generator, notes}, stats)
      expect(scheduled(itemOf(1))).toBe(true)
      expect(scheduled(itemOf(2))).toBe(true)
      expect((await store.reviews({pieceId: piece.id})).length).toBeGreaterThan(0)
    })

    it("hardest first skips the read-through", async function() {
      let {deck} = await generatorFor(2, {passages: flagAt2, order: HARDEST_FIRST})
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 1}))
    })

    it("plays today's queue without passages, or in score order", async function() {
      let noPassages = await generatorFor(2, {passages: () => [], order: READ_FIRST})
      expect(noPassages.deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 0}))

      let scoreOrder = await generatorFor(2, {passages: flagAt2, order: SCORE_ORDER})
      expect(scoreOrder.deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 0}))
    })

    it("resumes the read-through after a reload", async function() {
      let {generator, notes} = await generatorFor(2, {passages: flagAt2, order: READ_FIRST})
      let stats = new NoteStats()
      await playCard({generator, notes}, stats)

      let deck2 = new PlanDeck(pool(), {
        pieceId: piece.id, cardMeasures: 2, store, now: () => time, passages: flagAt2, order: READ_FIRST,
      })
      expect(deck2.entry).toEqual(jasmine.objectContaining({reason: READ_THROUGH, measure: 2}))
    })

    it("keeps a read-through card practice alone through a rest part way into it", async function() {
      let {deck, generator, notes} = await generatorFor(2, {passages: flagAt2, order: READ_FIRST})
      let stats = new NoteStats()
      let columns = generator.currentCard().columns.length

      time += 1000
      notes = hit(notes, stats)

      // a Rest part way through the card abandons the pass, its practice
      // written as the page writes it (recordSectionPractice); the player
      // plays the rest of the same card as a continued one
      let abandoned = generator.takePractice()
      expect(abandoned.length).toBeGreaterThan(0)
      for (let practice of abandoned) { await store.recordSectionPractice(practice) }

      for (let i = 1; i < columns; i++) {
        time += 1000
        notes = hit(notes, stats)
      }
      await generator.finishing
      await generator.studying

      expect(await store.reviews({pieceId: piece.id})).toEqual([])
      expect(scheduled(store.item(`${piece.id}:both:0-0`))).toBe(false)
      expect(scheduled(store.item(`${piece.id}:both:1-1`))).toBe(false)
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: READ_THROUGH, measure: 2}))
    })

    it("writes a self-graded read-through pass as practice alone", async function() {
      let {deck, generator} = await generatorFor(2, {passages: flagAt2, order: READ_FIRST})
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: READ_THROUGH, measure: 0}))

      generator.setDrill(() => ({mode: "self"}))
      time += 1000
      generator.selfGrade(GOOD)
      await generator.finishing
      await generator.studying

      expect(await store.reviews({pieceId: piece.id})).toEqual([])
      expect(store.item(`${piece.id}:both:0-0`).attempts).toEqual(1)
      expect(store.item(`${piece.id}:both:1-1`).attempts).toEqual(1)
      expect(generator.selfReceipt().when).toBe(null)
    })

    it("keeps the schedule what replay rebuilds through a read-through and the new cards after it", async function() {
      let {generator, notes} = await generatorFor(2, {passages: flagAt2, order: READ_FIRST})
      let stats = new NoteStats()

      for (let i = 0; i < 4; i++) {
        notes = await playCard({generator, notes}, stats)
      }

      let reviews = await store.reviews({pieceId: piece.id})
      for (let item of store.items(piece.id)) {
        if (item.startMeasure != item.endMeasure) { continue }
        let own = reviews.filter(review => review.itemId == item.id)
        if (own.length) {
          expect(replay(own, {item})).toEqual(item)
        } else {
          expect(item.state).toEqual("tracked")
        }
      }
    })

    it("plans again once a late analysis lands", async function() {
      let landed
      let ready = new Promise(resolve => { landed = resolve })
      let flagged = false
      let deck = new PlanDeck(pool(), {
        pieceId: piece.id, cardMeasures: 2, store, now: () => time,
        passages: () => flagged ? flagAt2() : [],
        order: READ_FIRST,
        passagesReady: ready,
      })
      let generator = new PlanGenerator(deck, {now: () => time})
      generators.push(generator)

      expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 0}))

      flagged = true
      landed()
      expect(await generator.ready).toBe(true)
      expect(deck.entry).toEqual(jasmine.objectContaining({reason: READ_THROUGH, measure: 0}))
    })
  })

  // acoustic mode (st/srs/self_grade): the hand scaffold is turned off
  // outright while it is on (Q3), rather than left active like scroll mode
  describe("self-graded passes", function() {
    it("plans the next entry from a self grade, with no caption but a receipt of when the bar returns", async function() {
      let {deck, generator} = await generatorFor(1)
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 0, hand: "both"}))

      generator.setDrill(() => ({mode: "self"}))
      time += 1000
      generator.selfGrade(GOOD)
      await generator.finishing
      await generator.studying

      // planned from the item the self grade wrote
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1}))
      let item = store.item(`${piece.id}:both:0-0`)
      expect(item.lastGrade).toEqual(GOOD)
      expect(generator.caption()).toBe(null)
      expect(generator.selfReceipt().when).toEqual({measure: 0, words: entryCaption(item, time)})
    })

    it("names the bar Where? named, not the entry bar's own schedule", async function() {
      await writeLadderBar(ladderBar(1, [AGAIN], time - 30 * MINUTE))
      await writeLadderBar(ladderBar(2, [GOOD], time - 3 * DAY, {state: "review", due: time + 20 * DAY, s: 30}))

      let {deck, generator} = await generatorFor(2)
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1}))
      expect(generator.currentCard().measures).toEqual([1, 2])

      generator.setDrill(() => ({mode: "self"}))
      time += 1000
      generator.selfGrade(HARD, {bars: [2]})
      await generator.finishing

      let bar2 = store.item(`${piece.id}:both:2-2`)
      let words = entryCaption(bar2, time)
      expect(words).not.toEqual("again in a moment")
      expect(generator.selfReceipt().when).toEqual({measure: 2, words})
    })

    // the receipt keeps to the grade: a bar the off-schedule rule left to the
    // totals alone has no schedule this grade set, so it is named without one
    it("says nothing of the schedule of a bar the grade only practised", async function() {
      // bar 1 is a rung come due, the entry; bar 2, on its ladder a minute
      // ago, is the rest of its card and its next rung isn't due yet
      await writeLadderBar(ladderBar(1, [AGAIN], time - 30 * MINUTE))
      await writeLadderBar(ladderBar(2, [GOOD], time - MINUTE))

      let {deck, generator} = await generatorFor(2)
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1}))
      expect(generator.currentCard().measures).toEqual([1, 2])

      generator.setDrill(() => ({mode: "self"}))
      let before = store.item(`${piece.id}:both:2-2`)
      expect(before.state).toEqual("learning")
      expect(before.due).toBeGreaterThan(time)

      time += 1000
      generator.selfGrade(HARD, {bars: [2]})
      await generator.finishing

      // bar 2's rung isn't due and the pass didn't fail it, so it took the
      // practice alone: its ladder is untouched, and the receipt says nothing
      // of a schedule the grade never set
      let after = store.item(`${piece.id}:both:2-2`)
      expect([after.due, after.state, after.lastGrade])
        .toEqual([before.due, before.state, before.lastGrade])
      expect(after.attempts).toEqual(before.attempts + 1)
      expect(generator.selfReceipt()).toEqual(jasmine.objectContaining({bars: [2], when: null}))
    })

    it("names a bar resting once the grade rests it, not when it returns", async function() {
      let at = time - MINUTE
      await writeLadderBar(ladderBar(0, [GOOD], at, {state: "review", due: time + 20 * DAY}))
      await writeLadderBar(ladderBar(1, [GOOD], at))
      await writeLadderBar(ladderBar(2, [AGAIN, AGAIN], at))
      time += 2 * MINUTE

      let {deck, generator} = await generatorFor(2)
      generator.setDrill(() => ({mode: "self"}))
      expect(generator.currentCard().measures).toEqual([1, 2])

      time += 1000
      generator.selfGrade(AGAIN, {bars: [2]})
      await generator.finishing

      expect(planState(deck.planInput()).resting.has(2)).toBe(true)
      expect(generator.selfReceipt().when).toEqual({measure: 2, words: "rests until your next sitting"})
    })

    it("never splits a bar from self-graded failures, which stay on its hands-together ladder", async function() {
      let {built, ...hands} = handPools()
      let {deck, generator, notes} = await generatorFor(1, hands)
      let stats = new NoteStats()
      notes = await playCard({generator, notes}, stats)
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "both"}))

      generator.setDrill(() => ({mode: "self"}))
      time += 1000
      generator.selfGrade(AGAIN)
      await generator.finishing
      time += 1000
      generator.selfGrade(AGAIN)
      await generator.finishing

      let bar = store.item(`${piece.id}:both:1-1`)
      expect(bar.state).toEqual("learning")
      expect(store.item(`${piece.id}:lower:1-1`)).toBe(null)
      expect(store.item(`${piece.id}:upper:1-1`)).toBe(null)
      expect(built).toEqual([])

      let reviews = await store.reviews({pieceId: piece.id})
      expect(reviews.filter(r => r.itemId == `${piece.id}:both:1-1`).every(r => r.staffMisses === undefined)).toBe(true)
    })

    it("offers hands together in a self-graded drill a bar the scaffold split after a detected failure, and the hand alone again once acoustic mode is off", async function() {
      let {built, ...hands} = handPools()
      let {deck, generator, notes} = await generatorFor(1, hands)
      let stats = new NoteStats()
      notes = await playCard({generator, notes}, stats)

      stats.missNotes(["G3"])
      stats.missNotes(["G3"])
      notes = await playCard({generator, notes}, stats)
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))

      // acoustic mode turns the scaffold off: the bar returns hands together
      generator.setDrill(() => ({mode: "self"}))
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "both"}))

      // once acoustic mode is off again, the next plan offers the hand alone
      // once more, exactly as it did before
      generator.setDrill(() => ({mode: "wait"}))
      deck.advance(false)
      expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
      expect(built).toEqual(["lower:1"])
    })
  })

  it("introduces a flagged passage hands apart when it names a hand, through the real deck", async function() {
    let {handMeasures, handCard} = handPools()
    let startApart = new Map([[1, ["lower"]]])

    let {deck, generator, notes} = await generatorFor(1, {
      handMeasures, handCard, startApart: () => startApart,
    })
    let stats = new NoteStats()

    // bar 0 first, hands together: it has no lower-hand notes to split
    expect(deck.entry.measure).toEqual(0)
    expect(deck.entry.hand).toEqual("both")
    notes = await playCard({generator, notes}, stats)

    // bar 1 is offered hands apart from the start: its left hand alone
    expect(deck.entry.measure).toEqual(1)
    expect(deck.entry.hand).toEqual("lower")
    expect(generator.currentCard().hand).toEqual("lower")

    await playCard({generator, notes}, stats)
    let handItem = store.item(`${piece.id}:lower:1-1`)
    expect(handItem).toBeTruthy()
    expect(handItem.deliberate).toBeUndefined()
  })

  it("keeps the plan it made when a review is beyond the planner", async function() {
    let measures = pool()
    let {built, ...hands} = handPools()
    let stats = new NoteStats()

    // bar 1 fails hands together on the bass staff, so the next plan reads
    // its review to pick the hand
    let first = await generatorFor(1, hands)
    let notes = await playCard(first, stats)
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    await playCard({generator: first.generator, notes}, stats)
    expect(first.deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
    expect(built).toEqual(["lower:1"])

    // the log now hands back a review the planner can't read
    spyOn(console, "warn")
    spyOn(store, "reviews").and.returnValue(Promise.resolve([{
      itemId: `${piece.id}:both:1-1`, pieceId: piece.id, kind: "attempt", grade: AGAIN, at: time,
      get staffMisses() { throw new Error("a review from a later version") },
    }]))

    let deck = new PlanDeck(measures, {pieceId: piece.id, cardMeasures: 1, ...hands, store, now: () => time})
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    let entry = deck.entry
    expect(entry).toEqual(jasmine.objectContaining({measure: 1, hand: "both"}))

    // the plan the deck made from the items stands, so the staff keeps its
    // card rather than going blank
    expect(await generator.ready).toBe(false)
    expect(deck.entry).toEqual(entry)
    expect(generator.currentCard().measures).toEqual([1])
    expect(console.warn).toHaveBeenCalled()
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

  // free practice of the piece's measures with a hand setting, one card a bar
  let freePractice = (measures, hand) => {
    let free = new MeasureCardGenerator(
      new MeasureCardDeck(measureCards(measures, 1), {
        pieceId: piece.id, hand, order: IN_ORDER, store, now: () => time,
      }),
      {now: () => time})
    generators.push(free)
    let notes = new NoteList([], {generator: free})
    notes.fillBuffer(8)
    return {generator: free, notes}
  }

  it("marks a hand alone the player chose, never the hand scaffold's", async function() {
    let lowerItem = () => store.item(`${piece.id}:lower:1-1`)
    // the pools first: making one stops the generator playing
    let leftBar = pool(LEFT_HAND).filter(m => m.number == 1)
    let rightPool = pool(RIGHT_HAND)
    let {handMeasures, handCard} = handPools()
    let {deck, generator, notes} = await generatorFor(1, {handMeasures, handCard})
    let stats = new NoteStats()
    notes = await playCard({generator, notes}, stats)

    // bar 1 fails on its bass G3, so the scaffold offers its left hand alone
    stats.missNotes(["G3"])
    stats.missNotes(["G3"])
    notes = await playCard({generator, notes}, stats)
    expect(deck.entry).toEqual(jasmine.objectContaining({measure: 1, hand: "lower"}))
    await playCard({generator, notes}, stats)
    expect(lowerItem()).toEqual(jasmine.objectContaining({state: "review"}))
    expect(lowerItem().deliberate).toBeUndefined()

    // free practice of the same left hand marks it as the player's
    await playCard(freePractice(leftBar, "lower"), new NoteStats())
    expect(lowerItem().deliberate).toBe(true)

    // as does a programme played with one hand, whose cards are its own
    let rightDeck = new PlanDeck(rightPool, {pieceId: piece.id, hand: "upper", cardMeasures: 1, store, now: () => time})
    let right = new PlanGenerator(rightDeck, {now: () => time})
    generators.push(right)
    await right.ready
    let rightNotes = new NoteList([], {generator: right})
    rightNotes.fillBuffer(8)
    let {measure} = rightDeck.entry
    await playCard({generator: right, notes: rightNotes}, new NoteStats())
    expect(store.item(`${piece.id}:upper:${measure}-${measure}`).deliberate).toBe(true)

    // hands together nothing is marked
    expect(store.items(piece.id).filter(item => item.hand == "both" && item.deliberate)).toEqual([])
  })

  it("marks the practice of a hand alone left unfinished", async function() {
    // bar 1's right hand is three columns: one is played, then Rest
    let right = freePractice(pool(RIGHT_HAND).filter(m => m.number == 1), "upper")
    time += 1000
    right.notes = hit(right.notes, new NoteStats())

    let practice = right.generator.takePractice()
    expect(practice.length).toBeGreaterThan(0)
    for (let stint of practice) {
      await store.recordSectionPractice(stint)
    }
    expect(store.item(`${piece.id}:upper:1-1`)).toEqual(jasmine.objectContaining({
      state: "tracked", attempts: 1, deliberate: true,
    }))
  })

  it("flags a hands together study for the hand alone free practice built on purpose", async function() {
    // the left hand of bar 1 is practised on its own first
    let left = freePractice(pool(LEFT_HAND).filter(m => m.number == 1), "lower")
    await playCard(left, new NoteStats())
    let lower = store.item(`${piece.id}:lower:1-1`)
    expect(lower).toEqual(jasmine.objectContaining({state: "review"}))

    // the next day the programme plays bars 0 and 1 hands together, which
    // puts the piece in study, both bars due after the left hand
    time += DAY
    let {deck, generator, notes} = await generatorFor(1)
    let stats = new NoteStats()
    for (let measure of [0, 1]) {
      expect(deck.entry).toEqual(jasmine.objectContaining({measure, hand: "both"}))
      notes = await playCard({generator, notes}, stats)
    }
    expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "learning"}))

    let together = store.item(`${piece.id}:both:1-1`)
    expect(together.state).toEqual("review")
    expect(together.due).toBeGreaterThan(lower.due)

    // the day the left hand comes due, it alone is due
    let now = lower.due + 8 * 60 * MINUTE
    expect(store.items(piece.id).filter(item => item.due != null && item.due <= now).map(item => item.id))
      .toEqual([lower.id])
    expect(mostOverduePiece({studies: store.studies(), items: store.items(), now})).toEqual(piece.id)
  })

  it("ends the sitting once the bars resting fill the idle cap", async function() {
    // twenty bars of one note each, the first eight failed three times in
    // this sitting, so the bars never seen wait for the next one
    let measures = Array.from({length: 20}, (_, idx) => ({number: idx + 1, columns: [["C4"]]}))
    let at = time - MINUTE
    for (let measure = 1; measure <= IDLE_LADDER_CAP; measure++) {
      let id = itemId({pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure})
      await store.recordAttempt({
        item: {
          id, pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure,
          level: "bar", state: "learning", step: 0, due: at, last: at, s: 1, d: 5,
          reps: 3, lapses: 2, streak: 0, lastGrade: AGAIN, hits: 0, misses: 3, attempts: 3,
          lastPracticed: at, elapsedMs: 3000, algo: 1, createdAt: at - 3 * MINUTE,
          recent: [2, 1, 0].map(n => [at - n * MINUTE, 1, 0, AGAIN]),
        },
        review: {
          itemId: id, pieceId: piece.id, at, kind: "attempt", grade: AGAIN, was: "learning",
          columns: 1, clean: 0, misses: 1, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 1,
        },
      })
    }

    let deck = new PlanDeck(measures, {pieceId: piece.id, cardMeasures: 1, store, now: () => time})
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)

    let state = planState(deck.planInput())
    expect(state.laddered).toEqual(IDLE_LADDER_CAP)
    expect(state.elapsedMs).toBeLessThan(state.targetMs)
    expect(deck.entry).toBe(null)
    expect(generator.summary().newMeasures).toEqual(20 - IDLE_LADDER_CAP)
    expect(generator.statusLine())
      .toEqual("Nothing more to practise this sitting · struggling bars rest until your next sitting")
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

  it("marks the piece maintaining once every measure is scheduled", async function() {
    let {generator, notes} = await generatorFor(3)
    notes = await playCard({generator, notes}, new NoteStats())
    expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "maintaining"}))
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

    // a hand-made flag, valid enough for store.putAnnotation (st/difficulty
    // records), so the order input and the programme start read through
    // without a real analysis
    let flagRecord = (id, extra={}) => ({
      pieceId: piece.id, fingerprint: {bars: []}, decisions: [], runs: {},
      proposals: [{
        id, source: "score", start: 1, end: 1, startIndex: 1, endIndex: 1,
        hand: "lower", level: 3, kinds: ["density"], title: "Test passage",
        reason: "test", reasons: ["test"], tip: "test", ...extra,
      }],
    })

    it("offers the order input only for a piece in the programme with flags for the hand", async function() {
      expect(input("introduce").visible(settingsFor({practice: PROGRAMME_PRACTICE}))).toBe(false)

      await store.putAnnotation(flagRecord("score:1-1:a"))

      expect(input("introduce").visible(settingsFor({practice: PROGRAMME_PRACTICE}))).toBe(true)
      expect(input("introduce").visible(settingsFor({practice: FREE_PRACTICE}))).toBe(false)
      expect(input("introduce").visible(settingsFor({practice: PROGRAMME_PRACTICE, hand: RIGHT_HAND}))).toBe(false)
    })

    it("reads the introduction order from settings, defaulting an unset or unknown value", function() {
      expect(introductionOrder({})).toEqual(READ_FIRST)
      expect(introductionOrder({introduce: "nonsense"})).toEqual(READ_FIRST)
      expect(introductionOrder({introduce: HARDEST_FIRST})).toEqual(HARDEST_FIRST)
    })

    it("starts the programme read through by default, and in score order when set", async function() {
      await store.putAnnotation(flagRecord("score:1-1:b"))

      let readFirst = SHEET_MUSIC_GENERATOR.create(grand, null, settingsFor({practice: PROGRAMME_PRACTICE}))
      generators.push(readFirst)
      await readFirst.ready
      expect(readFirst.statusLine()).toMatch(/^Read-through/)

      let scoreOrder = SHEET_MUSIC_GENERATOR.create(
        grand, null, settingsFor({practice: PROGRAMME_PRACTICE, introduce: "in score order"}))
      generators.push(scoreOrder)
      await scoreOrder.ready
      expect(scoreOrder.statusLine()).toEqual("New · bar 0")
    })
  })
})
