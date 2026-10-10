import MersenneTwister from "mersennetwister"

import {
  planNext, planState, planUpcoming, studyAfterPass, studyStatus, studyView, splitRun, layoutPassages,
  entryStatus, cardCaption, upNextWords, passageBarsOf,
  STUDY, READ, HANDS, TOGETHER, FLOW, STUDY_SLIPS, PASSAGE_BARS,
  REVIEW, LADDER, NEW, READ_THROUGH, READ_FIRST, HARDEST_FIRST, SCORE_ORDER,
} from "st/srs/planner"
import {
  applyGrade, DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS, SCHEDULER_ALGO, DAY, MINUTE, HOUR,
} from "st/srs/schedule"
import {newItem, itemId, RECENT_ATTEMPTS} from "st/srs/records"
import {replay} from "st/srs/schedule"
import {PlanDeck, PlanGenerator} from "st/plan_cards"
import {SHEET_MUSIC_GENERATOR, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, FREE_PRACTICE} from "st/data"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"

import {openTestStore, pianoScore} from "spec/helpers"

const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4

// a local time, so day boundaries hold in any time zone
const NOW = new Date(2026, 2, 10, 18).getTime()

const M12 = Array.from({length: 12}, (_, idx) => idx + 1)

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

// a bar played long ago and due long after: known, and no work for the queue
const learnt = measure => inReview(measure, {due: NOW + 30 * DAY, last: NOW - 5 * DAY})

// a range of several bars, as a card of the study leaves it: its graded passes
const range = (start, end, passes) => ({
  ...newItem({pieceId: "p", startMeasure: start, endMeasure: end}, 0),
  state: "tracked", attempts: passes.length, lastPracticed: passes.length ? passes[passes.length - 1][0] : 0,
  recent: passes.slice(-RECENT_ATTEMPTS),
})

// a bar of the study with the passes it has had since, [at, columns, clean, grade]
const withPasses = (item, passes) => ({
  ...item, passes, lastPracticed: Math.max(item.lastPracticed, ...passes.map(([at]) => at)),
})

const clean = at => [at, 4, 4, GOOD]
const slip = (at, columns=4, hits=3) => [at, columns, hits, AGAIN]

// the study of a piece whose bars known are scheduled already
const study = (known, extra={}) => ({
  record: {pieceId: "p", status: "learning", startedAt: 0, plan: {createdAt: 0, known, passages: []}},
  flags: [], order: SCORE_ORDER, passageBars: 4, ...extra,
})

// the same with passages open, each [start, end, stage, stageAt, flowedAt?]
const studyOf = (known, passages, extra={}) => {
  let {record, ...rest} = study(known, extra)
  return {
    ...rest,
    record: {
      ...record,
      plan: {
        ...record.plan,
        passages: passages.map(([start, end, stage, stageAt, flowedAt]) =>
          ({start, end, from: "score", openedAt: NOW - HOUR, stage, stageAt, ...(flowedAt ? {flowedAt} : {})})),
      },
    },
  }
}

const planFor = (items, extra={}) => planNext({
  pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2, study: study([[1, 8]]), ...extra,
})

// the reason, bar and card of the entry planned
const entryOf = (items, extra) => {
  let {entry} = planFor(items, extra)
  return entry && [entry.reason, entry.measure, entry.measures]
}

describe("tonight's study", function() {
  describe("layout", function() {
    const flags = [
      {id: "a", start: 5, end: 8, level: 3, hand: "both", alsoAt: [[10, 12]]},
      {id: "b", start: 2, end: 3, level: 1, hand: "lower"},
    ]
    const measures = Array.from({length: 13}, (_, idx) => idx)
    const shape = passages => passages.map(({start, end, from}) => `${start}-${end}:${from}`)
    const lay = extra => shape(layoutPassages({measures, flags, order: READ_FIRST, passageBars: 4, ...extra}))

    it("splits a run into balanced chunks of at most the size, the earlier ones larger", function() {
      expect(splitRun([1, 2, 3, 4, 5], 4)).toEqual([[1, 2, 3], [4, 5]])
      expect(splitRun([1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
      expect(splitRun([1, 2, 3, 4, 5, 6], 4)).toEqual([[1, 2, 3], [4, 5, 6]])
      expect(splitRun([1, 2, 3, 4], 4)).toEqual([[1, 2, 3, 4]])
      expect(splitRun([7], 4)).toEqual([[7]])
    })

    it("lays the hardest passage and its repeats first, then the rest in score order", function() {
      expect(lay({})).toEqual([
        "5-8:flag:a", "10-12:flag:a", "0-1:score", "2-3:flag:b", "4-4:score", "9-9:score",
      ])
    })

    it("pulls every hard passage first in hardest first, and none in score order", function() {
      expect(lay({order: HARDEST_FIRST})).toEqual(lay({}))
      expect(lay({order: SCORE_ORDER})).toEqual([
        "0-1:score", "2-3:flag:b", "4-4:score", "5-8:flag:a", "10-12:flag:a", "9-9:score",
      ])
    })

    it("leaves out the flags of the other hand, and the bars excluded", function() {
      expect(lay({hand: "upper"})).toEqual([
        "5-8:flag:a", "10-12:flag:a", "0-2:score", "3-4:score", "9-9:score",
      ])
      expect(lay({exclude: [0, 1, 2, 3, 4, 6]})).toEqual([
        "5-5:flag:a", "7-8:flag:a", "10-12:flag:a", "9-9:score",
      ])
    })

    it("lays out a piece without flags in score order, splitting a run of bars evenly", function() {
      let unflagged = layoutPassages({measures: M12, passageBars: 4})
      expect(shape(unflagged)).toEqual(["1-4:score", "5-8:score", "9-12:score"])
      expect(shape(layoutPassages({measures: M12, passageBars: 5}))).toEqual(["1-4:score", "5-8:score", "9-12:score"])
      expect(shape(layoutPassages({measures: M12.slice(0, 9), passageBars: 4}))).toEqual([
        "1-3:score", "4-6:score", "7-9:score",
      ])
    })

    it("never lays a passage across a bar the piece can't play", function() {
      let gappy = [1, 2, 3, 6, 7, 8]
      expect(shape(layoutPassages({measures: gappy, passageBars: 6}))).toEqual(["1-8:score"])
      expect(layoutPassages({measures: gappy, passageBars: 6})[0].start).toEqual(1)
    })

    it("keeps a passage's size between two and six bars", function() {
      expect([0, 1, 2, 5, 6, 7, 9, NaN, undefined].map(passageBarsOf)).toEqual([4, 2, 2, 5, 6, 6, 6, 4, 4])
      expect(PASSAGE_BARS).toEqual(4)
    })
  })

  describe("stages", function() {
    // a passage of bars 1-4 opened an hour ago, every bar before it known
    // in review played long ago unless given
    const T = n => NOW - 10 * MINUTE + n * 1000

    const viewOf = (items, {passages=[[1, 4, READ, NOW - HOUR]], known=[[5, 8]], ...extra}={}) => {
      let state = planState({
        pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2,
        study: studyOf(known, passages), ...extra,
      })
      return state.study
    }

    // the passage at stage III from T(0), the stage begun when its last bar was scheduled
    const THREE = [[1, 4, TOGETHER, T(0)]]

    // all four bars scheduled on the ladder, played at T(0)
    const live = (fields={}) => [1, 2, 3, 4].map(m => ({...onLadder(m, {due: NOW + HOUR, last: T(0)}), ...fields}))

    it("reads each bar of the passage not yet scheduled, in cards kept inside the passage", function() {
      let bars = viewOf([]).current
      expect([bars.stage, bars.effective, bars.card.measures]).toEqual([READ, READ, [1, 2]])

      let half = viewOf([1, 2].map(m => onLadder(m, {due: NOW + HOUR, last: T(0)}))).current
      expect([half.effective, half.card.measures]).toEqual([READ, [3, 4]])

      // a card of the size of the passage's last bar alone stays inside it
      let three = viewOf([1, 2].map(m => onLadder(m, {due: NOW + HOUR, last: T(0)})),
        {passages: [[1, 3, READ, NOW - HOUR]], known: [[4, 8]]}).current
      expect(three.card.measures).toEqual([2, 3])
    })

    it("moves on to hands apart, then together, once every bar is scheduled and none is split", function() {
      let together = viewOf(live()).current
      expect([together.stage, together.effective]).toEqual([TOGETHER, TOGETHER])
      // the bars played then are the stage's start, so their passes don't count
      expect(together.stageAt).toEqual(T(0))
      expect(together.card).toEqual(jasmine.objectContaining({measures: [1], dropped: false}))
    })

    it("grows the chain one bar for each clean pass of the longest so far", function() {
      let at = [T(10), T(20), T(30)]
      let items = [
        withPasses(live()[0], [clean(at[0]), clean(at[1])]),
        withPasses(live()[1], [clean(at[1])]),
        ...live().slice(2),
        range(1, 2, [clean(at[1])]),
      ]
      expect(viewOf(items, {passages: THREE}).current.card.measures).toEqual([1, 2, 3])

      // a pass that slips isn't one, and at R1 alone another is asked
      let slipped = [withPasses(live()[0], [slip(at[0])]), ...live().slice(1)]
      expect(viewOf(slipped, {passages: THREE}).current.card.measures).toEqual([1])
    })

    it("plays alone the first bar a chain pass slipped at, then goes on from the chain", function() {
      let at = [T(10), T(20), T(30), T(40)]
      let slippedAtThree = [
        withPasses(live()[0], [clean(at[0]), clean(at[1]), clean(at[2])]),
        withPasses(live()[1], [clean(at[1]), clean(at[2])]),
        withPasses(live()[2], [slip(at[2])]),
        live()[3],
        range(1, 2, [clean(at[1])]),
        range(1, 3, [slip(at[2], 12, 11)]),
      ]
      let dropped = viewOf(slippedAtThree, {passages: THREE}).current
      expect(dropped.card).toEqual(jasmine.objectContaining({measures: [3], dropped: true}))

      // the bar alone slipping again keeps it there
      let again = slippedAtThree.map(item => item.startMeasure == 3 && item.endMeasure == 3 ?
        withPasses(item, [slip(at[2]), slip(at[3])]) : item)
      expect(viewOf(again, {passages: THREE}).current.card.measures).toEqual([3])

      // clean, it resumes the chain at the length that slipped
      let resumed = slippedAtThree.map(item => item.startMeasure == 3 && item.endMeasure == 3 ?
        withPasses(item, [slip(at[2]), clean(at[3])]) : item)
      expect(viewOf(resumed, {passages: THREE}).current.card)
        .toEqual(jasmine.objectContaining({measures: [1, 2, 3], dropped: false}))
    })

    it("moves on to flow at the first clean pass of the whole passage", function() {
      let at = T(30)
      let whole = [...live(), range(1, 4, [slip(T(20), 16, 14), clean(at)])]
      let flow = viewOf(whole, {passages: THREE}).current
      expect([flow.stage, flow.effective, flow.stageAt]).toEqual([FLOW, FLOW, at])
      // no bar before the passage at the piece's start: its bars alone
      expect(flow.card.measures).toEqual([1, 2, 3, 4])
    })

    it("flows from the lead-in bar, and needs two passes running graded good or easy", function() {
      let passages = [[5, 8, FLOW, T(30)]]
      let known = [[1, 4]]
      let bars = [5, 6, 7, 8].map(m => onLadder(m, {due: NOW + HOUR, last: T(0)}))
      let lead = inReview(4, {due: NOW + 20 * DAY, last: NOW - 3 * DAY})
      let flowRange = passes => range(4, 8, passes)
      let at = [T(40), T(50), T(60)]
      let viewWith = passes => viewOf([...bars, lead, flowRange(passes)], {passages, known}).passages[0]

      let none = viewWith([])
      expect([none.card.measures, none.lastFlow, none.flowedAt]).toEqual([[4, 5, 6, 7, 8], false, null])

      let one = viewWith([[at[0], 20, 20, GOOD]])
      expect([one.lastFlow, one.flowedAt]).toEqual([true, null])

      // a hard pass isn't one, and one pass is never enough
      let hard = viewWith([[at[0], 20, 20, GOOD], [at[1], 20, 19, HARD]])
      expect([hard.lastFlow, hard.flowedAt]).toEqual([false, null])

      let twice = viewWith([[at[0], 20, 20, GOOD], [at[1], 20, 20, EASY]])
      expect(twice.flowedAt).toEqual(at[1])
      expect(twice.card).toBe(null)

      // two goods only count if they are running, with the slip between
      let apart = viewWith([[at[0], 20, 20, GOOD], [at[1], 20, 18, AGAIN], [at[2], 20, 20, GOOD]])
      expect([apart.lastFlow, apart.flowedAt]).toEqual([true, null])

      // passes before the stage began are none of its evidence
      let before = viewWith([[T(20), 20, 20, GOOD], [T(25), 20, 20, GOOD]])
      expect(before.flowedAt).toBe(null)
    })

    it("sends a split bar back to stage II, whatever the stage, until its hand holds", function() {
      // bar 2 failed on the left hand's misses at first sight
      let failing = {...onLadder(2, {due: NOW + HOUR, last: T(5), grade: AGAIN}), recent: [[T(5), 4, 1, AGAIN]]}
      let items = [onLadder(1, {due: NOW + HOUR, last: T(0)}), failing, onLadder(3, {due: NOW + HOUR, last: T(0)}),
        onLadder(4, {due: NOW + HOUR, last: T(0)})]
      let lastReviews = new Map([[failing.id, {
        itemId: failing.id, at: T(5), pieceId: "p", kind: "attempt", grade: AGAIN, misses: 3,
        staffMisses: {upper: 0, lower: 3},
      }]])
      let apart = {upper: M12, lower: M12}

      let passage = viewOf(items, {handMeasures: apart, lastReviews, passages: [[1, 4, TOGETHER, T(0)]]}).current
      expect([passage.stage, passage.effective]).toEqual([TOGETHER, HANDS])
      expect(passage.card).toEqual(jasmine.objectContaining({measures: [2], hand: "lower", early: false}))

      // at stage I the bar's hand alone is the queue's, and the passage reads on
      let reading = viewOf(items.slice(0, 2), {handMeasures: apart, lastReviews}).current
      expect(reading.effective).toEqual(READ)
    })

    it("introduces a flag's start-apart bar as its hand alone", function() {
      let startApart = new Map([[1, ["lower"]]])
      let items = []
      let reading = viewOf(items, {handMeasures: {upper: M12, lower: M12}, startApart}).current
      expect(reading.card).toEqual(jasmine.objectContaining({measures: [1], hand: "lower", early: false}))
      expect(reading.card.itemId).toEqual("p:lower:1-1")
    })

    it("counts a stored passage no playable bar is left of as flowed", function() {
      let view = viewOf([], {passages: [[20, 22, FLOW, NOW - HOUR]]})
      expect(view.current).toBe(null)
      expect(view.passages[0].flowedAt).not.toBe(null)
      expect(view.passages[0].card).toBe(null)
    })

    it("reads a bar's hands played since the passage opened", function() {
      let upper = {...bar(2, {hand: "upper"}), ...played(NOW - MINUTE, 1), state: "learning", due: NOW + HOUR}
      let before = {...bar(3, {hand: "lower"}), ...played(NOW - 2 * HOUR, 1), state: "learning", due: NOW + HOUR}
      let view = viewOf([...live(), upper, before]).current
      expect(view.handsPlayed).toEqual([{measure: 2, hand: "upper"}])
    })
  })

  describe("queue", function() {
    // every bar settled, played long ago unless said
    const rested = (m, extra={}) => inReview(m, {due: NOW + 20 * DAY, last: NOW - 5 * DAY, ...extra})
    const dueToday = m => inReview(m, {due: NOW - HOUR, last: NOW - 5 * DAY})

    it("takes the due reviews first through the warm-up, and keeps a card inside the scheduled bars", function() {
      let items = [...[1, 2, 3].map(dueToday), ...[4, 5, 6, 7, 8].map(m => rested(m))]
      expect(entryOf(items)).toEqual([REVIEW, 1, [1, 2]])
    })

    it("goes ahead of the due reviews once the first fifth of the session has passed", function() {
      let items = [
        ...[1, 2, 3].map(m => inReview(m, {due: NOW - HOUR, last: NOW - 5 * MINUTE + m * 1000})),
        ...[4, 5, 6, 7, 8].map(m => inReview(m, {due: NOW + 20 * DAY, last: NOW - 5 * MINUTE + m * 1000})),
      ]
      expect(entryOf(items)).toEqual([STUDY, 9, [9, 10]])
    })

    it("takes turns with them: a study card just played is followed by a review", function() {
      let items = [
        ...[1, 2, 3].map(m => inReview(m, {due: NOW - HOUR, last: NOW - 5 * MINUTE + m * 1000})),
        ...[4, 5, 6, 7, 8].map(m => inReview(m, {due: NOW + 20 * DAY, last: NOW - 5 * MINUTE + m * 1000})),
      ]
      expect(entryOf(items, {previousStudy: true})).toEqual([REVIEW, 1, [1, 2]])
    })

    it("holds the passage back while the ladder is at its cap", function() {
      let items = [
        ...[1, 2, 3, 4].map(m => onLadder(m, {due: NOW + 20 * 1000, last: NOW - 5 * DAY})),
        ...[5, 6, 7, 8].map(dueToday),
      ]
      expect(entryOf(items)).toEqual([REVIEW, 5, [5, 6]])
    })

    it("opens a passage under the idle cap when nothing else is left", function() {
      let items = [1, 2, 3, 4].map(m => onLadder(m, {due: NOW + 20 * 1000, last: NOW - 5 * DAY}))
      let {entry, state} = planFor(items)
      expect([entry.reason, entry.measure, entry.measures]).toEqual([STUDY, 9, [9, 10]])
      expect([entry.stage, entry.passage]).toEqual([READ, jasmine.objectContaining({start: 9, end: 12})])
      expect(state.study.current).toBe(null)
    })

    it("plays a rung of the bar before a passage inside the scheduled bars", function() {
      let items = [...[1, 2, 3, 4, 5, 6, 7].map(m => rested(m)), onLadder(8, {due: NOW - 1000, last: NOW - 5 * DAY})]
      expect(entryOf(items)).toEqual([LADDER, 8, [7, 8]])
    })

    it("opens the next passage when nothing else is left to play, even past the target", function() {
      // bars the piece has played but never scheduled, over a sitting a minute long
      let tracked = [1, 2, 3].map(m => ({...bar(m), attempts: 1, lastPracticed: NOW - 3 * MINUTE + m * 60 * 1000}))
      let practice = {...DEFAULT_PRACTICE_SETTINGS, sessionMinutes: 1}
      let {entry, state} = planNext({
        pieceId: "p", items: tracked, measures: M12, now: NOW, cardMeasures: 2, practice,
        study: study([]),
      })
      expect(state.elapsedMs).toBeGreaterThan(practice.sessionMinutes * MINUTE)
      expect(entry.reason).toEqual(STUDY)
    })

    it("opens no passage while every bar the programme has rests, or a read-through is waiting", function() {
      // eight bars on the ladder, resting: the idle cap holds new material
      // back, and the fallback opens no passage with nothing awake
      let resting = [1, 2, 3, 4, 5, 6, 7, 8].map(m => ({
        ...onLadder(m, {due: NOW + HOUR, last: NOW - MINUTE, grade: AGAIN}),
        recent: [[NOW - 3 * MINUTE, 4, 1, AGAIN], [NOW - 2 * MINUTE, 4, 1, AGAIN], [NOW - MINUTE, 4, 1, AGAIN]],
      }))
      expect(planFor(resting).entry).toBe(null)

      let {entry} = planNext({
        pieceId: "p", items: [], measures: M12, now: NOW, cardMeasures: 2, readThrough: true, study: study([]),
      })
      expect(entry.reason).toEqual(READ_THROUGH)
    })

    it("reads the piece through before any study, whole cards of the player's size", function() {
      let {entry, state} = planNext({
        pieceId: "p", items: [], measures: M12, now: NOW, cardMeasures: 2, readThrough: true, study: study([]),
      })
      expect(entry).toEqual({reason: READ_THROUGH, measure: 1, itemId: "p:both:1-1", item: null, hand: "both"})
      expect(state.toRead.length).toEqual(12)
    })

    it("drops a rung the study card contains, and plays a rung it doesn't first", function() {
      let T = n => NOW - 10 * MINUTE + n * 1000
      // bar 2 was played in an earlier sitting, so it isn't the card just played
      let ladder = (m, due) => onLadder(m, {due, last: m == 2 ? NOW - 3 * HOUR : T(0)})
      let passage = [[1, 4, TOGETHER, T(0)]]
      let items = due => [1, 2, 3, 4].map(m => ladder(m, due[m] ?? NOW + HOUR))

      // bar 1's rung is due, and the chain's first card plays it
      let covered = planNext({
        pieceId: "p", items: items({1: NOW - 1000}), measures: M12, now: NOW, cardMeasures: 2,
        study: studyOf([[5, 8]], passage),
      })
      expect([covered.entry.reason, covered.entry.measures]).toEqual([STUDY, [1]])

      // bar 2's isn't, so it is played first, among the scheduled bars
      let apart = planNext({
        pieceId: "p", items: items({2: NOW - 1000}), measures: M12, now: NOW, cardMeasures: 2,
        study: studyOf([[5, 8]], passage),
      })
      expect([apart.entry.reason, apart.entry.measure, apart.entry.measures]).toEqual([LADDER, 2, [2, 3]])
    })

    it("keeps a review's card inside the bars scheduled and the passage in progress", function() {
      let items = [...[1, 2, 3].map(m => rested(m, {due: NOW - HOUR})), ...[4, 5, 6, 7, 8].map(m => rested(m))]
      // bar 3 anchored on two bars with bar 4 beside it
      let {entry} = planNext({
        pieceId: "p", items: [...[1, 2].map(m => rested(m)), dueToday(3), onLadder(9, {due: NOW + HOUR, last: NOW - HOUR})],
        measures: M12, now: NOW, cardMeasures: 3, study: study([[1, 8]]),
      })
      expect(entry.measure).toEqual(3)
      expect(entry.measures.includes(4)).toBe(false)
      expect(items.length).toEqual(8)
    })

    it("plays the programme as it always was once the piece is learned", function() {
      let items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => rested(m))
      let learned = {...study([[1, 12]])}
      learned.record.plan.learnedAt = NOW - DAY
      let {entry, state} = planNext({
        pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2, study: learned,
      })
      expect(state.study.learned).toBe(true)
      expect(entry.measures).toBeUndefined()
      expect(entry.reason).not.toEqual(STUDY)
      expect(studyStatus({pieceId: "p", items, measures: M12, now: NOW, study: learned})).toEqual("maintaining")
    })

    it("plays the shipped queue with one hand", function() {
      let items = [1, 2, 3].map(m => ({...rested(m), hand: "upper", id: `p:upper:${m}-${m}`}))
      let withStudy = planNext({pieceId: "p", items, measures: M12, now: NOW, hand: "upper", study: study([])})
      let without = planNext({pieceId: "p", items, measures: M12, now: NOW, hand: "upper"})
      expect(withStudy.state.study).toBe(null)
      expect(withStudy.entry).toEqual(without.entry)
      expect(withStudy.entry.reason).toEqual(NEW)
    })

    it("plays the shipped queue on a piece of one playable bar", function() {
      let {entry, state} = planNext({pieceId: "p", items: [], measures: [1], now: NOW, study: study([])})
      expect(state.study).toBe(null)
      expect(entry.reason).toEqual(NEW)
    })

    it("is never empty while the piece has a bar to learn, playing a random month of grades", function() {
      let random = new MersenneTwister(11)
      let settings = DEFAULT_SCHEDULER_SETTINGS
      let items = new Map()
      let record = study([]).record
      let reasons = new Set()
      let now = NOW

      let input = extra => ({
        pieceId: "p", items: [...items.values()], measures: M12, now, cardMeasures: 2,
        study: {record, flags: [], order: SCORE_ORDER, passageBars: 4}, ...extra,
      })

      // plays the entry's card as a pass of the grade given: each bar and the
      // range written as the generator writes them, a bar off schedule that
      // didn't fail only as practice
      let play = (entry, grade) => {
        let bars = entry.measures || [entry.measure]
        let clean = grade >= GOOD
        let pass = [now, 4 * bars.length, clean ? 4 * bars.length : 4 * bars.length - 1, grade]
        for (let measure of bars) {
          let id = itemId({pieceId: "p", hand: entry.hand, startMeasure: measure, endMeasure: measure})
          let stored = items.get(id) || bar(measure, {hand: entry.hand, id})
          let own = [now, 4, clean ? 4 : 3, grade]
          let onLadder = ["learning", "relearning"].includes(stored.state) && stored.due > now
          let item = onLadder && grade > AGAIN ?
            {...stored, passes: [...(stored.passes ?? stored.recent), [now, 4, own[2], null]].slice(-8)} : {
              ...applyGrade(stored, grade, now, settings),
              recent: [...stored.recent, own].slice(-RECENT_ATTEMPTS),
              passes: [...(stored.passes ?? stored.recent), own].slice(-8),
            }
          items.set(id, {...item, lastPracticed: now, attempts: stored.attempts + 1})
        }
        if (bars.length > 1) {
          let id = itemId({pieceId: "p", hand: entry.hand, startMeasure: bars[0], endMeasure: bars[bars.length - 1]})
          let stored = items.get(id) || range(bars[0], bars[bars.length - 1], [])
          items.set(id, {...stored, lastPracticed: now, attempts: stored.attempts + 1,
            recent: [...stored.recent, pass].slice(-RECENT_ATTEMPTS)})
        }
      }

      for (let day = 0; day < 12; day++) {
        now = NOW + day * DAY
        for (let card = 0; card < 40; card++) {
          let {entry} = planNext(input())
          if (!entry) { break }
          reasons.add(entry.reason)

          let grade = random.random() < 0.15 ? AGAIN : random.random() < 0.3 ? HARD : GOOD
          play(entry, grade)
          now += 20 * 1000

          let plan = studyAfterPass(input(), {entry, at: now})
          record = {...record, plan}
        }
      }

      expect([...reasons]).toEqual(jasmine.arrayContaining([STUDY]))
      expect(planNext(input()).state.study.passages.length).toBeGreaterThan(0)
    })
  })

  describe("rests", function() {
    const T = n => NOW - 10 * MINUTE + n * 1000
    const ladder = (m, last=T(0)) => onLadder(m, {due: NOW + HOUR, last})
    const passage = stage => [[1, 4, stage, T(0)]]
    const planOf = (items, passages, extra) => planNext({
      pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2,
      study: studyOf([[5, 8]], passages), ...extra,
    })

    it("rests a passage one of whose bars rests under the shipped rule, holding the next passage", function() {
      let failing = {
        ...ladder(3, T(40)),
        recent: [[T(10), 4, 1, AGAIN], [T(20), 4, 1, AGAIN], [T(40), 4, 1, AGAIN]],
      }
      let items = [ladder(1), ladder(2), failing, ladder(4)]
      let {entry, state} = planOf(items, passage(TOGETHER))
      expect(state.study.current.restReason).toEqual("bar")
      expect(state.study.current.resting).toBe(true)
      expect(state.study.current.card).toBe(null)
      // nothing of the study is left to play, and no passage opens meanwhile
      expect(entry == null || entry.reason != STUDY).toBe(true)
    })

    it("rests a passage whose bar slipped three times in stage III, until the next sitting", function() {
      let slips = [slip(T(10)), slip(T(20)), slip(T(30))]
      let items = [ladder(1), ladder(2), withPasses(ladder(3), slips), ladder(4)]
      let {state} = planOf(items, passage(TOGETHER))
      expect(state.study.current.restReason).toEqual("slips")

      // the third slip is what rests it
      let two = [ladder(1), ladder(2), withPasses(ladder(3), slips.slice(0, 2)), ladder(4)]
      expect(planOf(two, passage(TOGETHER)).state.study.current.resting).toBe(false)
      expect(STUDY_SLIPS).toEqual(3)

      // slips of an earlier sitting don't count
      let earlier = slips.map(([at, ...rest]) => [at - 3 * HOUR, ...rest])
      let old = [ladder(1), ladder(2), withPasses(ladder(3, T(0) - 3 * HOUR), earlier), ladder(4)]
      expect(planOf(old, passage(TOGETHER)).state.study.current.resting).toBe(false)
    })

    it("rests a passage after three failed flow passes in a sitting", function() {
      let flows = n => range(1, 4, Array.from({length: n}, (_, idx) => [T(10 + 10 * idx), 16, 14, AGAIN]))
      let items = [ladder(1), ladder(2), ladder(3), ladder(4)]
      let view = n => planOf([...items, flows(n)], passage(FLOW), {}).state.study.current
      expect([view(2).resting, view(3).resting, view(3).restReason]).toEqual([false, true, "flow"])
    })

    it("opens the next passage after one flows", function() {
      let items = [1, 2, 3, 4].map(m => learnt(m))
      let {entry} = planNext({
        pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2,
        study: studyOf([[5, 8]], [[1, 4, FLOW, T(0), T(50)]]),
      })
      expect(entry.reason).toEqual(STUDY)
      expect(entry.passage).toEqual(jasmine.objectContaining({start: 9, end: 12}))
      function T(n) { return NOW - 10 * MINUTE + n * 1000 }
    })
  })

  describe("writes", function() {
    const T = n => NOW - 10 * MINUTE + n * 1000

    it("opens the entry's passage the first time one of its cards is written, knowing the bars before it", function() {
      // bars 9-12 scheduled before there was a plan, the card [1, 2] just played
      let items = [...[9, 10, 11, 12].map(m => learnt(m)), ...[1, 2].map(m => onLadder(m, {due: NOW + HOUR, last: T(5)}))]
      let input = {pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2, study: {
        record: null, flags: [], order: SCORE_ORDER, passageBars: 4,
      }}
      let entry = {
        reason: STUDY, measure: 1, measures: [1, 2], stage: READ, hand: "both",
        passage: {start: 1, end: 4, from: "score", words: null},
      }

      let plan = studyAfterPass(input, {entry, at: T(5)})
      expect(plan).toEqual({
        createdAt: T(5), known: [[9, 12]],
        passages: [{start: 1, end: 4, from: "score", openedAt: T(5), stage: READ, stageAt: T(5)}],
      })
    })

    it("keeps the bars of a review known, and opens nothing for it", function() {
      let items = [1, 2, 3].map(m => learnt(m))
      let input = {pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2, study: {
        record: null, flags: [], order: SCORE_ORDER, passageBars: 4,
      }}
      let entry = {reason: REVIEW, measure: 1, measures: [1, 2], hand: "both", item: items[0], itemId: items[0].id}
      expect(studyAfterPass(input, {entry, at: T(5)})).toEqual({createdAt: T(5), known: [[1, 3]], passages: []})
    })

    it("advances a passage's stage and when it began, and flows it, from the items", function() {
      let record = studyOf([[5, 8]], [[1, 4, READ, T(0)]]).record
      let items = [1, 2, 3, 4].map(m => onLadder(m, {due: NOW + HOUR, last: T(5)}))
      let input = {
        pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2,
        study: {record, flags: [], order: SCORE_ORDER, passageBars: 4},
      }
      let plan = studyAfterPass(input, {at: NOW})
      expect(plan.passages).toEqual([jasmine.objectContaining({stage: TOGETHER, stageAt: T(5)})])
      expect(plan.learnedAt).toBeUndefined()

      // the passage flows with two flow passes running, and the next opens
      let flowing = {...input, items: [...items, range(1, 4, [clean(T(10)), clean(T(20))].map(([at]) => [at, 16, 16, GOOD]))]}
      let plan2 = studyAfterPass({...flowing, study: {...input.study, record: {...record, plan: {...record.plan,
        passages: [{...record.plan.passages[0], stage: FLOW, stageAt: T(6)}]}}}}, {at: NOW})
      expect(plan2.passages[0]).toEqual(jasmine.objectContaining({stage: FLOW, flowedAt: T(20)}))
    })

    it("sets when the piece was learned once every passage has flowed", function() {
      let record = studyOf([[5, 8]], [[1, 4, FLOW, T(0), T(50)]]).record
      let items = [1, 2, 3, 4].map(m => learnt(m))
      let input = {
        pieceId: "p", items, measures: [1, 2, 3, 4], now: NOW, cardMeasures: 2,
        study: {record, flags: [], order: SCORE_ORDER, passageBars: 4},
      }
      expect(studyAfterPass(input, {at: NOW})).toEqual(jasmine.objectContaining({learnedAt: NOW}))
      expect(studyStatus(input)).toEqual("maintaining")

      // a piece with a passage still to open is learning
      expect(studyStatus({...input, measures: M12})).toEqual("learning")
    })

    it("gives nothing when the study doesn't apply", function() {
      expect(studyAfterPass({pieceId: "p", items: [], measures: M12, now: NOW}, {at: NOW})).toBe(null)
      expect(studyView({pieceId: "p", items: [], measures: M12, now: NOW})).toBe(null)
    })

    it("tells the setup pane what the study holds", function() {
      let view = studyView({
        pieceId: "p", items: [1, 2, 3, 4].map(m => learnt(m)), measures: M12, now: NOW, cardMeasures: 2,
        study: studyOf([[5, 8]], [[1, 4, FLOW, T(0), T(50)]]),
      })
      expect(view.learned).toBe(false)
      expect(view.path).toEqual([
        {start: 1, end: 4, flowed: true, current: false}, {start: 9, end: 12, flowed: false, current: true},
      ])
      expect([view.flowed, view.total]).toEqual([1, 2])
      expect(view.passage).toEqual(jasmine.objectContaining({start: 9, end: 12, open: false}))
    })
  })

  describe("words", function() {
    const entry = {
      reason: STUDY, measure: 5, measures: [5, 6], stage: READ, hand: "both", item: null, itemId: "p:both:5-5",
      passage: {start: 5, end: 8, from: "flag:a", words: "hardest passage"},
    }

    it("names a study card by its stage, bars and passage", function() {
      expect(entryStatus(entry, {now: NOW})).toEqual("Study · I Read · bars 5–6 · hardest passage")
      expect(entryStatus({...entry, stage: TOGETHER, measures: [5]}, {now: NOW}))
        .toEqual("Study · III Together · bar 5 · hardest passage")
      expect(entryStatus({...entry, stage: HANDS, measures: [7], hand: "lower"}, {now: NOW}))
        .toEqual("Study · II Hands · bar 7 · left hand · hardest passage")
      expect(entryStatus({...entry, stage: FLOW, measures: [4, 5, 6, 7, 8], passage: {...entry.passage, words: null}}, {now: NOW}))
        .toEqual("Study · IV Flow · bars 4–8")
      expect(entryStatus(entry, {now: NOW, complete: true}))
        .toEqual("Programme complete · Study · I Read · bars 5–6 · hardest passage")
    })

    it("words a study row of the preview, with a hand alone appended", function() {
      expect(upNextWords({...entry, stage: TOGETHER})).toEqual("Study · III Together")
      expect(upNextWords({...entry, stage: HANDS, hand: "lower"})).toEqual("Study · II Hands · left hand")
    })

    it("carries a study entry's stage and bars into the preview", function() {
      let items = [1, 2, 3, 4, 5, 6, 7, 8].map(m => learnt(m))
      let upcoming = planUpcoming({pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2, study: study([[1, 8]])}, 3)
      let first = upcoming.find(({reason}) => reason == STUDY)
      expect(first).toEqual(jasmine.objectContaining({stage: READ, measures: [9, 10]}))
      expect(upNextWords(first)).toEqual("Study · I Read")
    })

    it("captions the card after a study pass by where the passage goes next", function() {
      // a passage whose bars were all just scheduled by a card of stage I
      let T = n => NOW - 10 * MINUTE + n * 1000
      let items = [1, 2, 3, 4].map(m => onLadder(m, {due: NOW + HOUR, last: T(5)}))
      let state = planState({
        pieceId: "p", items, measures: M12, now: NOW, cardMeasures: 2,
        study: studyOf([[5, 8]], [[1, 4, READ, T(0)]]),
      })
      expect(cardCaption({...entry, passage: {start: 1, end: 4, from: "score", words: null}}, items[3], state))
        .toEqual("Together next, from bar 1")
    })
  })
})


const grand = {name: "grand", range: ["C2", "C6"]}

// plays the head column like the sight reading page does on a hit
let hit = (notes, stats, measured) => {
  let column = notes.currentColumn()
  notes = notes.clone()
  notes.shift(measured)
  notes.pushRandom()
  stats.hitNotes(column)
  return notes
}

// eight bars of four quarter notes over a held bass note each
const OCTET_BAR = {upper: ["C5", "D5", "E5", "F5"], lower: [{name: "C3", duration: 4, type: "whole"}]}

describe("tonight's study on the staff", function() {
  let store, previousStore, piece, generators, time

  beforeEach(async function() {
    store = await openTestStore()
    previousStore = setAppStore(store)
    piece = (await importMusicXMLPiece(
      "octet.musicxml", pianoScore({title: "Study Octet", bars: Array.from({length: 8}, () => OCTET_BAR)}), store)).piece
    generators = []
    time = NOW
  })

  afterEach(async function() {
    generators.forEach(g => g.stop())
    setAppStore(previousStore)
    await store.close()
  })

  // the piece's bars as the grand staff draws them, in the score's own columns
  let pool = (hand=BOTH_HANDS) => {
    let settings = {piece: piece.id, song: "", startMeasure: 1, endMeasure: 8, hand}
    let generator = SHEET_MUSIC_GENERATOR.create(grand, null, {...settings, practice: FREE_PRACTICE, measuresPerCard: 1})
    generator.stop()
    return generator.cards.map(card => ({number: card.startMeasure, columns: card.columns}))
  }

  let generatorFor = async (opts={}) => {
    let deck = new PlanDeck(pool(), {
      pieceId: piece.id, cardMeasures: 2, store, now: () => time, study: true, order: SCORE_ORDER, ...opts,
    })
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    await generator.ready
    let notes = new NoteList([], {generator})
    notes.fillBuffer(40)
    return {deck, generator, notes, stats: new NoteStats()}
  }

  // the status line of the card shown, then plays it through, a second a
  // column, and says what the card leaves in the caption
  let play = async (ctx, {slips=[], measured={}}={}) => {
    let {generator} = ctx
    let status = generator.statusLine()
    let columns = generator.currentCard().columns.length
    for (let i = 0; i < columns; i++) {
      time += 1000
      if (slips.includes(i)) { ctx.stats.missNotes(["C5"]) }
      ctx.notes = hit(ctx.notes, ctx.stats, measured[i])
    }
    await generator.finishing
    await generator.studying
    return [status, generator.lastCaption]
  }

  let playAll = async (ctx, count) => {
    let played = []
    for (let i = 0; i < count; i++) { played.push(await play(ctx)) }
    return played
  }

  describe("a clean piece to learned", function() {
    it("takes eight cards for each clean passage, and learns the piece", async function() {
      let ctx = await generatorFor()
      let first = await playAll(ctx, 8)
      expect(first).toEqual([
        ["Study · I Read · bars 1–2", "returns in 4 days"],
        ["Study · I Read · bars 3–4", "Together next, from bar 1"],
        ["Study · III Together · bar 1", "Together next · bars 1–2"],
        ["Study · III Together · bars 1–2", "Together next · bars 1–3"],
        ["Study · III Together · bars 1–3", "Together next · bars 1–4"],
        ["Study · III Together · bars 1–4", "Now bars 1–4 twice without a stop"],
        ["Study · IV Flow · bars 1–4", "1 of 2 · once more without a stop"],
        ["Study · IV Flow · bars 1–4", "Bars 1–4 flow"],
      ])

      let second = await playAll(ctx, 8)
      expect(second.map(([status]) => status)).toEqual([
        "Study · I Read · bars 5–6", "Study · I Read · bars 7–8",
        "Study · III Together · bar 5", "Study · III Together · bars 5–6",
        "Study · III Together · bars 5–7", "Study · III Together · bars 5–8",
        "Study · IV Flow · bars 4–8", "Study · IV Flow · bars 4–8",
      ])
      expect(second[second.length - 1][1]).toEqual("Learned ❖ · the programme keeps it from here")
      expect(ctx.generator.statusLine()).toMatch(/^Programme complete · Run-through · bar 1/)

      let record = store.study(piece.id)
      expect(record.status).toEqual("maintaining")
      expect(record.plan.passages).toEqual([
        jasmine.objectContaining({start: 1, end: 4, stage: FLOW, flowedAt: jasmine.any(Number)}),
        jasmine.objectContaining({start: 5, end: 8, stage: FLOW, flowedAt: jasmine.any(Number)}),
      ])
      expect(record.plan.learnedAt).toEqual(jasmine.any(Number))
    })

    it("rebuilds every bar's schedule from the log by replay", async function() {
      let ctx = await generatorFor()
      await playAll(ctx, 16)
      await expectReplay()
    })
  })

  // every single bar item is what replaying its own reviews rebuilds, an item
  // never graded still tracked
  let expectReplay = async () => {
    let reviews = await store.reviews({pieceId: piece.id})
    for (let item of store.items(piece.id)) {
      if (item.startMeasure != item.endMeasure) { continue }
      let own = reviews.filter(review => review.itemId == item.id)
      if (own.some(review => review.kind == "attempt")) {
        expect(replay(own, {item})).withContext(item.id).toEqual(item)
      } else {
        expect(item.state).withContext(item.id).toEqual("tracked")
      }
    }
  }

  describe("slips", function() {
    it("drops to the bar that slipped, then on, and rests the passage after the third slip", async function() {
      let ctx = await generatorFor()
      await playAll(ctx, 4)

      // R1-3 slipping at bar 3, whose columns are 8-11 of the card
      let first = await play(ctx, {slips: [8]})
      expect(first).toEqual(["Study · III Together · bars 1–3", "Bar 3 alone, then on"])

      let second = await play(ctx, {slips: [0]})
      expect(second).toEqual(["Study · III Together · bar 3", "Bar 3 alone, then on"])

      let third = await play(ctx)
      expect(third).toEqual(["Study · III Together · bar 3", "Together next · bars 1–3"])

      let fourth = await play(ctx, {slips: [8]})
      expect(fourth).toEqual(["Study · III Together · bars 1–3", "Bars 1–4 rest until your next sitting"])

      // nothing of the study is offered again this sitting, and the plan stays at stage III
      expect(ctx.deck.entry == null || ctx.deck.entry.reason != STUDY).toBe(true)
      expect(store.study(piece.id).plan.passages).toEqual([jasmine.objectContaining({start: 1, end: 4, stage: TOGETHER})])
      expect(store.study(piece.id).status).toEqual("learning")
      await expectReplay()
    })

    it("opens the passage again at the next sitting", async function() {
      let ctx = await generatorFor()
      await playAll(ctx, 4)
      await play(ctx, {slips: [8]})
      await play(ctx, {slips: [0]})
      await play(ctx)
      await play(ctx, {slips: [8]})

      time += 3 * HOUR
      let next = new PlanDeck(pool(), {
        pieceId: piece.id, cardMeasures: 2, store, now: () => time, study: true, order: SCORE_ORDER,
      })
      let generator = new PlanGenerator(next, {now: () => time})
      generators.push(generator)
      expect(next.entry.reason).toEqual(STUDY)
      expect(generator.statusLine()).toMatch(/^Study · III Together · bar/)
    })

    it("rests the passage after three failed flow passes in a sitting", async function() {
      let ctx = await generatorFor()
      await playAll(ctx, 6)

      let flows = []
      for (let i = 0; i < 3; i++) { flows.push(await play(ctx, {slips: [0]})) }
      expect(flows.map(([status]) => status)).toEqual(Array(3).fill("Study · IV Flow · bars 1–4"))
      expect(flows[2][1]).toEqual("Bars 1–4 rest until your next sitting")
      expect(ctx.deck.entry == null || ctx.deck.entry.reason != STUDY).toBe(true)
    })
  })

  // the bars each hand alone has notes in and the lazy one-bar accessor a
  // deck builds its hand cards through
  let handPools = () => {
    let pools = {upper: pool(RIGHT_HAND), lower: pool(LEFT_HAND)}
    return {
      handMeasures: Object.fromEntries(Object.entries(pools).map(([staff, list]) =>
        [staff, list.filter(measure => measure.columns.length).map(measure => measure.number)])),
      handCard: (staff, number) => pools[staff].find(measure => measure.number == number),
    }
  }

  let itemOf = id => store.item(`${piece.id}:${id}`)

  describe("the hand scaffold", function() {
    it("offers a bar failing on the left hand alone, in stage I, then reads on", async function() {
      let hands = handPools()
      let ctx = await generatorFor(hands)

      // bar 2's bass note missed three times, its columns 4-7 of the card
      ctx.stats.missNotes(["C3"])
      let cols = ctx.generator.currentCard().columns.length
      for (let i = 0; i < cols; i++) {
        time += 1000
        if (i == 4) { for (let n = 0; n < 3; n++) { ctx.stats.missNotes(["C3"]) } }
        ctx.notes = hit(ctx.notes, ctx.stats)
      }
      await ctx.generator.finishing
      await ctx.generator.studying

      expect(ctx.generator.statusLine()).toEqual("Once more · bar 2 · left hand")
      let apart = await play(ctx)
      expect(apart).toEqual(["Once more · bar 2 · left hand", "hands together next"])

      expect(ctx.generator.statusLine()).toEqual("Once more · bar 2")
      await play(ctx)

      // the passage reads on, and the hand played alone is the passage's
      expect(ctx.generator.statusLine()).toMatch(/^Study · I Read/)
      let state = planState(ctx.deck.planInput())
      expect(state.study.current.handsPlayed).toEqual([{measure: 2, hand: "lower"}])
    })

    // writes the attempts of the bars given as the scheduler leaves them, so the
    // passage starts at stage II with bar 2 split on the left hand
    let seedSplitBar = async () => {
      let at = NOW - 10 * MINUTE
      let write = (measure, hand, time, grade, extra={}) => store.recordAttempt({
        item: {
          ...newItem({pieceId: piece.id, hand, startMeasure: measure, endMeasure: measure}, time),
          attempts: 1, hits: 4, lastPracticed: time, recent: [[time, 4, grade > AGAIN ? 4 : 1, grade]],
        },
        review: {
          itemId: itemId({pieceId: piece.id, hand, startMeasure: measure, endMeasure: measure}), at: time,
          pieceId: piece.id, kind: "attempt", grade, was: "new", columns: 4, clean: grade > AGAIN ? 4 : 1,
          misses: grade > AGAIN ? 0 : 3, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 3, ...extra,
        },
      })

      await write(1, "both", at, GOOD)
      await write(2, "both", at + 1000, AGAIN, {staffMisses: {upper: 0, lower: 3}})
      await write(3, "both", at + 2000, GOOD)
      await write(4, "both", at + 3000, GOOD)
      await write(2, "lower", at + 4000, HARD, {staffMisses: {upper: 0, lower: 1}})
      await store.putStudy({
        pieceId: piece.id, status: "learning", startedAt: at,
        plan: {
          createdAt: at, known: [],
          passages: [{start: 1, end: 4, from: "score", openedAt: at, stage: READ, stageAt: at}],
        },
      })
      time = at + 5000
    }

    it("plays a hand alone early in stage II as practice, and grades it once its rung comes due", async function() {
      await seedSplitBar()
      let ctx = await generatorFor(handPools())
      let lower = () => itemOf("lower:2-2")

      expect(ctx.generator.statusLine()).toEqual("Study · II Hands · bar 2 · left hand")
      expect(ctx.deck.entry.early).toBe(true)
      expect(lower().due).toBeGreaterThan(time)

      // played before its rung is due, a hand that doesn't fail is practice alone
      let before = {reps: lower().reps, recent: lower().recent, attempts: lower().attempts}
      let reviews = (await store.reviews({pieceId: piece.id})).length
      let apart = await play(ctx)
      expect(apart).toEqual(["Study · II Hands · bar 2 · left hand", "Left hand alone, then together"])
      expect(lower().reps).toEqual(before.reps)
      expect(lower().recent).toEqual(before.recent)
      expect(lower().attempts).toEqual(before.attempts + 1)
      expect((await store.reviews({pieceId: piece.id})).length).toEqual(reviews)
      expect(ctx.generator.statusLine()).toEqual("Study · II Hands · bar 2 · left hand")

      // played again once the rung is due, it is graded
      time = lower().due + MINUTE
      ctx.deck.advance(false)
      ctx.generator.startCard()
      expect(ctx.deck.entry.hand).toEqual("lower")
      expect(ctx.deck.entry.early == null || ctx.deck.entry.early === false).toBe(true)
      await play(ctx)
      expect((await store.reviews({pieceId: piece.id})).length).toEqual(reviews + 1)
      expect(lower().reps).toEqual(before.reps + 1)
      await expectReplay()
    })
  })

  describe("a rung the study's card contains", function() {
    it("is graded inside the chain card played after it came due, with no card of its own", async function() {
      let ctx = await generatorFor()

      // bar 2 slips once at first sight: hard, a rung half a minute on
      await play(ctx, {slips: [4]})
      expect(itemOf("both:2-2").lastGrade).toEqual(HARD)
      let due = itemOf("both:2-2").due

      let statuses = []
      for (let i = 0; i < 4; i++) { statuses.push((await play(ctx))[0]) }
      expect(statuses).toEqual([
        "Study · I Read · bars 3–4", "Study · III Together · bar 1",
        "Study · III Together · bars 1–2", "Study · III Together · bars 1–3",
      ])
      // played before the rung came due, graded as the passage it was on a schedule
      expect(time).toBeGreaterThan(due)
      expect(itemOf("both:2-2").recent.length).toEqual(2)
      expect(ctx.generator.statusLine()).not.toEqual("Once more · bar 2")
    })
  })

  describe("a self-graded drill", function() {
    it("chains on the player's grades, dropping to the bar they name", async function() {
      let ctx = await generatorFor()
      ctx.generator.setDrill(() => ({mode: "self"}))

      let grade = async (value, opts) => {
        let status = ctx.generator.statusLine()
        time += 1000
        ctx.generator.selfGrade(value, opts)
        await ctx.generator.finishing
        await ctx.generator.studying
        return status
      }

      let statuses = []
      for (let value of [GOOD, GOOD, GOOD, GOOD]) { statuses.push(await grade(value)) }
      expect(statuses).toEqual([
        "Study · I Read · bars 1–2", "Study · I Read · bars 3–4", "Study · III Together · bar 1",
        "Study · III Together · bars 1–2",
      ])

      statuses.push(await grade(AGAIN, {bars: [3]}))
      expect(statuses[4]).toEqual("Study · III Together · bars 1–3")
      expect(ctx.generator.statusLine()).toEqual("Study · III Together · bar 3")

      statuses.push(await grade(GOOD))
      statuses.push(await grade(GOOD))
      statuses.push(await grade(GOOD))
      expect(statuses.slice(5)).toEqual([
        "Study · III Together · bar 3", "Study · III Together · bars 1–3", "Study · III Together · bars 1–4",
      ])
      expect(ctx.generator.statusLine()).toEqual("Study · IV Flow · bars 1–4")
      await grade(EASY)
      await grade(GOOD)
      expect(ctx.generator.statusLine()).toEqual("Study · I Read · bars 5–6")
    })
  })

  describe("the read-through and the hardest passage", function() {
    const flag = {id: "a", start: 5, end: 8, level: 3, hand: "both", alsoAt: []}

    it("reads the piece through, then learns the hardest passage from its lead-in, then the rest", async function() {
      let ctx = await generatorFor({passages: () => [flag], order: READ_FIRST})

      let read = await playAll(ctx, 4)
      expect(read).toEqual([
        ["Read-through · bar 1", "2 bars left to read through"].map(words => words)[0] == "Read-through · bar 1" ?
          ["Read-through · bar 1", "6 bars left to read through"] : null,
        ["Read-through · bar 3", "4 bars left to read through"],
        ["Read-through · bar 5", "2 bars left to read through"],
        ["Read-through · bar 7", "read-through done · tonight's study next"],
      ])

      // each pass is logged as a read-through, and none is a graded attempt
      let reviews = await store.reviews({pieceId: piece.id})
      expect(reviews.map(review => review.kind)).toEqual(Array(reviews.length).fill("read-through"))
      expect(reviews.length).toBeGreaterThanOrEqual(4)
      expect(itemOf("both:1-1").state).toEqual("tracked")
      expect(itemOf("both:1-1").attempts).toEqual(1)

      let studied = await playAll(ctx, 8)
      expect(studied.map(([status]) => status)).toEqual([
        "Study · I Read · bars 5–6 · hardest passage", "Study · I Read · bars 7–8 · hardest passage",
        "Study · III Together · bar 5 · hardest passage", "Study · III Together · bars 5–6 · hardest passage",
        "Study · III Together · bars 5–7 · hardest passage", "Study · III Together · bars 5–8 · hardest passage",
        "Study · IV Flow · bars 4–8 · hardest passage", "Study · IV Flow · bars 4–8 · hardest passage",
      ])
      expect(studied[7][1]).toEqual("Bars 5–8 flow")
      expect(ctx.generator.statusLine()).toEqual("Study · I Read · bars 1–2")

      // the lead-in bar is first graded in the flow card, having been only read
      let attempts = (await store.reviews({pieceId: piece.id})).filter(review => review.kind == "attempt")
      let lead = attempts.filter(review => review.itemId == `${piece.id}:both:4-4`)
      expect(lead[0].was).toEqual("tracked")
      let flowAt = lead[0].at
      expect(attempts.filter(review => review.at == flowAt).map(review => review.itemId)).toContain(`${piece.id}:both:4-8`)

      await expectReplay()
    })

    it("goes straight to the study once the read-through is skipped, and remembers it", async function() {
      let ctx = await generatorFor({passages: () => [flag], order: READ_FIRST})
      expect(ctx.generator.statusLine()).toEqual("Read-through · bar 1")

      ctx.generator.skipReadThrough()
      expect(ctx.generator.statusLine()).toEqual("Study · I Read · bars 5–6 · hardest passage")
      await ctx.generator.studying
      expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "learning", readThrough: "skipped"}))

      let reopened = new PlanDeck(pool(), {
        pieceId: piece.id, cardMeasures: 2, store, now: () => time, study: true,
        passages: () => [flag], order: READ_FIRST,
      })
      expect(new PlanGenerator(reopened, {now: () => time}).statusLine())
        .toEqual("Study · I Read · bars 5–6 · hardest passage")
    })

    it("keeps the skip when a card is written right after it, and the plan with the status", async function() {
      let ctx = await generatorFor({passages: () => [flag], order: READ_FIRST})
      ctx.generator.skipReadThrough()
      ctx.notes = new NoteList([], {generator: ctx.generator})
      ctx.notes.fillBuffer(40)

      // written before the store has the skip
      await play(ctx)
      let record = store.study(piece.id)
      expect(record.readThrough).toEqual("skipped")
      expect(record.status).toEqual("learning")
      expect(record.plan.passages).toEqual([jasmine.objectContaining({start: 5, end: 8, from: "flag:a"})])
    })

    it("leaves a shelved study as it is", async function() {
      await store.putStudy({pieceId: piece.id, status: "shelved", startedAt: 5})
      let ctx = await generatorFor()
      await playAll(ctx, 2)
      expect(store.study(piece.id)).toEqual({pieceId: piece.id, status: "shelved", startedAt: 5})
    })
  })

  describe("a reload", function() {
    it("resumes mid-chain with the same card, from the store alone", async function() {
      let ctx = await generatorFor()
      await playAll(ctx, 4)
      let status = ctx.generator.statusLine()
      expect(status).toEqual("Study · III Together · bars 1–3")

      let reopened = await openTestStore({keep: true})
      let deck = new PlanDeck(pool(), {
        pieceId: piece.id, cardMeasures: 2, store: reopened, now: () => time, study: true, order: SCORE_ORDER,
      })
      expect(new PlanGenerator(deck, {now: () => time}).statusLine()).toEqual(status)
      await reopened.close()
    })
  })

  describe("a piece played with one hand", function() {
    it("introduces bars one at a time and leaves the plan alone", async function() {
      let deck = new PlanDeck(pool(RIGHT_HAND), {
        pieceId: piece.id, hand: "upper", cardMeasures: 2, store, now: () => time, study: true, order: SCORE_ORDER,
      })
      let generator = new PlanGenerator(deck, {now: () => time})
      generators.push(generator)
      expect(generator.statusLine()).toEqual("New · bar 1 · right hand")

      let notes = new NoteList([], {generator})
      notes.fillBuffer(40)
      let stats = new NoteStats()
      for (let i = 0; i < generator.currentCard().columns.length; i++) {
        time += 1000
        notes = hit(notes, stats)
      }
      await generator.finishing
      await generator.studying
      expect(store.study(piece.id).plan).toBeUndefined()
      expect(generator.statusLine()).toMatch(/^New · bar .* right hand$/)
    })
  })
})
