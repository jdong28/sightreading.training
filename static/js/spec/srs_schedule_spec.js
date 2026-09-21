import {FSRSAlgorithm, generatorParameters} from "ts-fsrs"

import {makeFsrs, S_MIN} from "st/srs/fsrs"
import {
  applyGrade, replay, localDay, dayStart, predictedRecall, recentMissRate, practiceWeight,
  schedulable, scheduled, validSchedulerSettings, validPracticeSettings,
  DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS, SCHEDULER_ALGO, UNSCHEDULED_RECALL,
  DAY, MINUTE
} from "st/srs/schedule"
import {newItem, itemWithPractice, RECENT_ATTEMPTS} from "st/srs/records"
import {songToJSON} from "st/sheet_music_deck"
import {MultiTrackSong, SongNote} from "st/song_note_list"

import {openTestStore} from "spec/helpers"

const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4

// a local time, so day boundaries hold in any time zone
const at = (day, hour, minute=0) => new Date(2026, 2, day, hour, minute).getTime()

const bar = () => newItem({pieceId: "p", startMeasure: 3, endMeasure: 3}, 0)

// an item in review, reviewed at last and next due in s days
const reviewItem = (last, s, fields={}) => ({
  ...bar(), state: "review", s, d: 5, last, due: last + s * DAY, reps: 4, streak: 4, lastGrade: GOOD,
  algo: SCHEDULER_ALGO, ...fields,
})

describe("spaced repetition scheduler", function() {
  describe("memory model", function() {
    it("agrees with the reference ts-fsrs over a grid of states", function() {
      let ref = new FSRSAlgorithm(generatorParameters({enable_fuzz: false}))
      let F = makeFsrs()
      let worst = 0
      let compare = (mine, theirs) => {
        worst = Math.max(worst, Math.abs(mine - theirs) / Math.max(1e-9, Math.abs(theirs)))
      }

      for (let g of [AGAIN, HARD, GOOD, EASY]) {
        compare(F.init(g).s, ref.init_stability(g))
        compare(F.init(g).d, Math.min(10, Math.max(1, ref.init_difficulty(g))))
      }

      let states = 0
      for (let s of [0.1, 0.5, 2.3, 10, 40, 200]) {
        for (let d of [1, 2, 5, 8, 10]) {
          for (let t of [0.5, 1, 5, 30, 365]) {
            compare(F.retr(t, s), ref.forgetting_curve(t, s))
            for (let g of [AGAIN, HARD, GOOD, EASY]) {
              let mine = F.review({s, d}, g, t)
              let theirs = ref.next_state({stability: s, difficulty: d}, t, g)
              compare(mine.s, theirs.stability)
              compare(mine.d, theirs.difficulty)
              states += 1
            }
          }

          for (let g of [AGAIN, HARD, GOOD, EASY]) {
            let mine = F.shortTerm({s, d}, g)
            let theirs = ref.next_state({stability: s, difficulty: d}, 0, g)
            compare(mine.s, theirs.stability)
            compare(mine.d, theirs.difficulty)
          }
        }

        // the interval is where the forgetting curve reaches the retention
        for (let r of [0.8, 0.9, 0.95]) {
          compare(ref.forgetting_curve(F.interval(s, r), s), r)
        }
      }

      expect(states).toEqual(600)
      expect(worst).toBeLessThan(1e-6)
    })
  })

  describe("Exhibit A", function() {
    // the design's exhibit, in continuous time: the first day's grades each
    // played when the ladder has it due, then one grade across days each on
    // its due date, a lapse relearned on the spot with goods up the ladder
    const T0 = 20000 * DAY
    const G = {a: AGAIN, h: HARD, g: GOOD, e: EASY}
    const fmt = d => d < 1 ? `${Math.round(d * 1440)}min` : `${d.toFixed(d < 10 ? 1 : 0)}d`
    const P95 = {...DEFAULT_SCHEDULER_SETTINGS, retention: 0.95}

    let apply = (item, grade, now, settings) => applyGrade(item, grade, now, settings, {continuous: true})

    function proposed(day0, later, settings=DEFAULT_SCHEDULER_SETTINGS) {
      let item = bar(), now = T0, out = []
      for (let c of day0) {
        item = apply(item, G[c], now, settings)
        if (item.state == "review") { break }
        now = item.due
      }
      out.push(`day0 ${day0}→S=${item.s.toFixed(2)} D=${item.d.toFixed(1)}`)

      for (let c of later) {
        now = item.due
        item = apply(item, G[c], now, settings)
        while (item.state == "relearning") {
          now = item.due
          item = apply(item, GOOD, now, settings)
        }
        out.push(`d${((now - T0) / DAY).toFixed(0)}:${c}→${fmt((item.due - now) / DAY)}`)
      }
      return out.join("  ")
    }

    it("stretches the intervals of a bar played clean", function() {
      expect(proposed("hggg", "gggggg")).toEqual(
        "day0 hggg→S=1.42 D=5.1  d1:g→4.7d  d6:g→16d  d22:g→49d  d71:g→120d  d191:g→120d  d311:g→120d")
      expect(proposed("hggg", "gggggg", P95)).toEqual(
        "day0 hggg→S=1.42 D=5.1  d1:g→1.9d  d3:g→4.2d  d7:g→8.6d  d16:g→17d  d32:g→31d  d63:g→55d")
    })

    it("collapses them after a lapse, keeping part of the stability", function() {
      expect(proposed("hggg", "gggaggg")).toEqual(
        "day0 hggg→S=1.42 D=5.1  d1:g→4.7d  d6:g→16d  d22:g→49d  d71:a→2.8d  d74:g→6.3d  d80:g→13d  d93:g→25d")
      expect(proposed("hggg", "gggaggg", P95)).toEqual(
        "day0 hggg→S=1.42 D=5.1  d1:g→1.9d  d3:g→4.2d  d7:g→8.6d  d16:a→1.0d  d17:g→1.4d  d18:g→2.2d  d20:g→3.3d")
    })

    it("stretches a hard bar more slowly", function() {
      expect(proposed("aggg", "hghghgh")).toEqual(
        "day0 aggg→S=0.32 D=6.4  d1:h→1.5d  d3:g→4.1d  d7:h→7.7d  d14:g→15d  d30:h→24d  d53:g→40d  d93:h→54d")
      expect(proposed("aggg", "hghghgh", P95)).toEqual(
        "day0 aggg→S=0.32 D=6.4  d1:h→1.0d  d2:g→1.4d  d3:h→2.0d  d5:g→3.0d  d8:h→3.9d  d12:g→5.4d  d18:h→6.6d")
    })

    it("lets an easy first sight skip the ladder", function() {
      expect(proposed("e", "ggggg")).toEqual(
        "day0 e→S=8.30 D=1.0  d4:g→26d  d30:g→108d  d138:g→120d  d258:g→120d  d378:g→120d")
      expect(proposed("e", "ggggg", P95)).toEqual(
        "day0 e→S=8.30 D=1.0  d3:g→9.5d  d13:g→24d  d37:g→57d  d94:g→120d  d214:g→120d")
    })

    it("takes early practice as weak evidence", function() {
      let item = reviewItem(T0, 10)
      let row = []
      for (let day = 1; day <= 7; day++) {
        item = apply(item, GOOD, T0 + day * DAY)
        row.push(`d${day}→${fmt((item.due - T0 - day * DAY) / DAY)}`)
      }
      expect(row.join("  ")).toEqual("d1→13d  d2→16d  d3→19d  d4→22d  d5→24d  d6→27d  d7→30d")
    })

    it("stretches a late clean review further, and keeps a fraction of stability on a late lapse", function() {
      let item = reviewItem(T0, 10)
      let interval = now => fmt((apply(item, GOOD, now).due - now) / DAY)
      expect(interval(T0 + 10 * DAY)).toEqual("32d")
      expect(interval(T0 + 30 * DAY)).toEqual("54d")
      expect(apply(item, AGAIN, T0 + 30 * DAY).s.toFixed(2)).toEqual("1.62")
    })
  })

  describe("ladder", function() {
    let now = at(10, 18)

    it("climbs one rung on good and two on easy, and repeats one on hard", function() {
      let item = applyGrade(bar(), HARD, now)
      expect([item.state, item.step, item.due - now]).toEqual(["learning", 0, 30 * 1000])

      item = applyGrade(item, GOOD, now + MINUTE)
      expect([item.state, item.step, item.due - now - MINUTE]).toEqual(["learning", 1, 2.5 * MINUTE])

      item = applyGrade(item, HARD, now + 5 * MINUTE)
      expect([item.step, item.due - now - 5 * MINUTE]).toEqual([1, 2.5 * MINUTE])

      let climbed = applyGrade(item, GOOD, now + 10 * MINUTE)
      expect([climbed.step, climbed.due - now - 10 * MINUTE]).toEqual([2, 10 * MINUTE])

      // two rungs past the last graduates
      let graduated = applyGrade(item, EASY, now + 10 * MINUTE)
      expect([graduated.state, graduated.step]).toEqual(["review", 0])
      expect(graduated.reps).toEqual(4)
    })

    it("goes back to the first rung on again, with one immediate retry", function() {
      let item = applyGrade(bar(), GOOD, now)
      item = applyGrade(item, GOOD, now + MINUTE)
      expect(item.step).toEqual(2)

      item = applyGrade(item, AGAIN, now + 2 * MINUTE)
      expect([item.state, item.step, item.due]).toEqual(["learning", 0, now + 2 * MINUTE])
      expect(item.streak).toEqual(0)

      // failing the retry waits for the first rung
      item = applyGrade(item, AGAIN, now + 3 * MINUTE)
      expect([item.step, item.due]).toEqual([0, now + 3 * MINUTE + 30 * 1000])

      // a first sight failed is retried at once too
      let failed = applyGrade(bar(), AGAIN, now)
      expect([failed.state, failed.step, failed.due, failed.lapses]).toEqual(["learning", 0, now, 0])
    })

    it("starts a schedule on an item only tracked so far, keeping its totals", function() {
      let tracked = itemWithPractice(bar(), {hits: 10, misses: 3, at: now - DAY})
      expect(scheduled(tracked)).toBe(false)

      let item = applyGrade(tracked, GOOD, now)
      expect(scheduled(item)).toBe(true)
      expect([item.state, item.step, item.reps, item.algo]).toEqual(["learning", 1, 1, SCHEDULER_ALGO])
      expect([item.hits, item.misses, item.attempts]).toEqual([10, 3, 1])
    })
  })

  describe("across days", function() {
    it("caps the first interval at one day, and four after an easy first sight", function() {
      let now = at(10, 18)
      let item = bar()
      for (let grade of [GOOD, GOOD, GOOD]) {
        item = applyGrade(item, grade, now)
        now += 11 * MINUTE
      }

      // FSRS alone would wait longer
      expect(makeFsrs().interval(item.s, 0.9)).toBeGreaterThan(1.5)
      expect(item.state).toEqual("review")
      expect(item.due).toEqual(at(11, 4))

      // S 8.3 would be over 8 days
      let easy = applyGrade(bar(), EASY, at(10, 18))
      expect(easy.state).toEqual("review")
      expect(easy.due).toEqual(at(14, 4))
    })

    it("leaves an item in review as it was after a same-day repeat that doesn't fail", function() {
      let reviewed = applyGrade(reviewItem(at(1, 12), 10), GOOD, at(11, 9))
      expect(reviewed.due).toBeGreaterThan(at(20, 0))

      for (let grade of [HARD, GOOD, EASY]) {
        let repeated = applyGrade(reviewed, grade, at(11, 22))
        expect(repeated).toEqual({...reviewed, reps: reviewed.reps + 1})
      }

      // failing it the same day is evidence
      let failed = applyGrade(reviewed, AGAIN, at(11, 22))
      expect([failed.state, failed.lapses, failed.due]).toEqual(["relearning", reviewed.lapses + 1, at(11, 22)])
    })

    it("keeps a fraction of the stability on a lapse", function() {
      let item = reviewItem(at(1, 12), 40)
      let lapsed = applyGrade(item, AGAIN, at(20, 12))
      expect(lapsed.state).toEqual("relearning")
      expect(lapsed.s).toBeGreaterThan(S_MIN)
      expect(lapsed.s).toBeGreaterThan(1)
      expect(lapsed.s).toBeLessThan(item.s / 2)
      expect(lapsed.lapses).toEqual(1)

      // relearnt on the ladder, it comes back sooner than it was due
      let relearnt = lapsed
      for (let minutes of [1, 2, 3]) {
        relearnt = applyGrade(relearnt, GOOD, at(20, 12, minutes))
      }
      expect(relearnt.state).toEqual("review")
      expect(relearnt.due).toBeLessThan(at(20, 12) + 20 * DAY)
      expect(relearnt.due).toBeGreaterThan(at(21, 0))
    })

    it("never waits more than 120 days", function() {
      let item = reviewItem(at(1, 12), 400, {d: 1})
      let reviewed = applyGrade(item, EASY, at(1, 12) + 400 * DAY)
      expect(reviewed.s).toBeGreaterThan(400)
      expect(localDay(reviewed.due) - localDay(at(1, 12) + 400 * DAY)).toEqual(120)
    })

    it("counts local days from 4 am", function() {
      // across midnight is still the same day, until 4 am
      expect(localDay(at(10, 23))).toEqual(localDay(at(11, 1)))
      expect(localDay(at(11, 3, 59))).toEqual(localDay(at(10, 4)))
      expect(localDay(at(11, 4))).toEqual(localDay(at(10, 4)) + 1)
      expect(localDay(at(11, 7))).toEqual(localDay(at(10, 23)) + 1)

      expect(dayStart(localDay(at(11, 2)))).toEqual(at(10, 4))
      expect(dayStart(localDay(at(11, 9)))).toEqual(at(11, 4))
      expect(localDay(at(11, 2), 0)).toEqual(localDay(at(11, 9), 0))
      expect(dayStart(localDay(at(11, 2), 0), 0)).toEqual(at(11, 0))
    })

    it("takes 11 pm and 7 am as a day apart, and 11 pm and 1 am as the same day", function() {
      let reviewed = applyGrade(reviewItem(at(1, 12), 9), GOOD, at(10, 23))

      // 1 am is still the day of the review: practice, not evidence
      expect(applyGrade(reviewed, GOOD, at(11, 1))).toEqual({...reviewed, reps: reviewed.reps + 1})

      // 7 am is a day later: a review, which schedules from the start of that day
      let next = applyGrade(reviewed, GOOD, at(11, 7))
      expect(next.last).toEqual(at(11, 7))
      expect(next.s).toBeGreaterThan(reviewed.s)
      expect(new Date(next.due).getHours()).toEqual(4)
      expect(next.due).toBeGreaterThan(reviewed.due)
    })
  })

  describe("weakest first", function() {
    let now = at(20, 12)

    it("weighs an item by its predicted recall and recent misses", function() {
      expect(predictedRecall(bar(), now)).toBe(null)
      expect(practiceWeight(null, now)).toEqual(1 + 4 * (1 - UNSCHEDULED_RECALL))

      // at its due date recall has fallen to the target
      let item = reviewItem(now - 10 * DAY, 10)
      expect(predictedRecall(item, now)).toBeCloseTo(0.9, 9)
      expect(practiceWeight(item, now)).toBeCloseTo(1 + 4 * 0.1, 9)

      // just reviewed, recall is certain
      expect(practiceWeight(reviewItem(now, 10), now)).toBeCloseTo(1, 9)
    })

    it("fades misses by half every two weeks", function() {
      let item = {...bar(), recent: [[now, 4, 2, HARD], [now, 4, 4, GOOD]]}
      expect(recentMissRate(item, now)).toBeCloseTo(0.25, 9)
      expect(recentMissRate({...item, recent: [[now - 14 * DAY, 4, 0, AGAIN]]}, now)).toBeCloseTo(0.5, 9)
      expect(recentMissRate(bar(), now)).toEqual(0)
    })
  })

  describe("items", function() {
    it("schedules single measures of any hand, not ranges, beats or items set aside", function() {
      expect(schedulable(bar())).toBe(true)
      expect(schedulable({...bar(), hand: "upper"})).toBe(true)
      expect(schedulable(newItem({pieceId: "p", startMeasure: 3, endMeasure: 4}))).toBe(false)
      expect(schedulable({...bar(), beats: [1, 2]})).toBe(false)
      for (let state of ["merged", "split", "suspended"]) {
        expect(schedulable({...bar(), state})).toBe(false)
      }
    })

    it("validates the settings records", function() {
      expect(validSchedulerSettings(DEFAULT_SCHEDULER_SETTINGS)).toBe(true)
      expect(DEFAULT_SCHEDULER_SETTINGS.retention).toEqual(0.9)
      expect(validSchedulerSettings({...DEFAULT_SCHEDULER_SETTINGS, retention: 1})).toBe(false)
      expect(validSchedulerSettings({...DEFAULT_SCHEDULER_SETTINGS, w: [1, 2]})).toBe(false)
      expect(validSchedulerSettings({...DEFAULT_SCHEDULER_SETTINGS, key: "practice"})).toBe(false)
      expect(validPracticeSettings(DEFAULT_PRACTICE_SETTINGS)).toBe(true)
      expect(validPracticeSettings({...DEFAULT_PRACTICE_SETTINGS, sessionMinutes: 0})).toBe(false)
    })
  })

  describe("in the store", function() {
    let opened
    let open = async opts => {
      let store = await openTestStore(opts)
      opened.push(store)
      return store
    }

    beforeEach(function() {
      opened = []
    })

    afterEach(async function() {
      for (let store of opened) {
        await store.close()
      }
    })

    let pieceData = id => {
      let song = new MultiTrackSong()
      song.pushWithTrack(new SongNote("C4", 0, 1), 0)
      song.metadata = {title: "Song", beatsPerMeasure: 4}
      return {id, title: id, importedAt: 1000, song: songToJSON(song)}
    }

    // an attempt built from the item as stored, as passAttempts builds them
    let attemptAt = (range, grade, time, {clean=4}={}) => stored => {
      let id = `${range.pieceId}:both:${range.startMeasure}-${range.endMeasure}`
      let current = stored.item(id) || newItem(range, time)
      let item = itemWithPractice(current, {hits: clean, misses: 4 - clean, at: time})
      item.recent = [...current.recent, [time, 4, clean, grade]].slice(-RECENT_ATTEMPTS)
      return {
        item,
        review: {
          itemId: id, at: time, pieceId: range.pieceId, kind: "attempt", grade,
          was: current.attempts ? current.state : "new",
          columns: 4, clean, misses: 4 - clean, stuck: 0, skipped: 0, hesitations: 0,
          mode: "wait", algo: 1,
        },
      }
    }

    const measure = {pieceId: "a", startMeasure: 2, endMeasure: 2}
    const range = {pieceId: "a", startMeasure: 2, endMeasure: 3}

    // a week of practice on measure 2 and the card 2-3
    let practise = async store => {
      let plays = [
        [at(1, 18), HARD], [at(1, 18, 1), GOOD], [at(1, 18, 5), GOOD], [at(1, 18, 20), GOOD],
        [at(2, 9), GOOD], [at(2, 21), EASY], [at(4, 3), AGAIN], [at(4, 3, 1), GOOD],
        [at(4, 3, 5), GOOD], [at(4, 3, 20), GOOD], [at(8, 12), GOOD],
      ]
      for (let [time, grade] of plays) {
        await store.recordAttempt(attemptAt(measure, grade, time, {clean: grade == AGAIN ? 1 : 4}))
        await store.recordAttempt(attemptAt(range, grade, time + 1))
      }
    }

    it("schedules a measure from each graded review, and replay rebuilds it from the log", async function() {
      let store = await open()
      await store.putPiece(pieceData("a"))
      await practise(store)

      let item = store.item("a:both:2-2")
      expect(scheduled(item)).toBe(true)
      expect(item.state).toEqual("review")
      expect(item.lapses).toEqual(1)
      expect(item.reps).toEqual(11)
      expect(item.due).toBeGreaterThan(at(8, 12))

      // a card's range is logged but not scheduled
      let card = store.item("a:both:2-3")
      expect([card.state, card.due, card.reps, card.recent.length]).toEqual(["tracked", undefined, 0, RECENT_ATTEMPTS])

      let reviews = await store.reviews({pieceId: "a"})
      let own = id => reviews.filter(review => review.itemId == id)
      expect(replay(own(item.id), {item})).toEqual(item)
      expect(replay(own(card.id), {item: card})).toEqual(card)

      // from the log alone, the schedule is the same
      let rebuilt = replay(own(item.id))
      for (let field of ["state", "step", "due", "last", "s", "d", "reps", "lapses", "streak", "lastGrade", "recent", "algo"]) {
        expect(rebuilt[field]).toEqual(item[field])
      }

      // each review after the first carries the recall predicted for it
      expect(own(item.id)[0].r).toBeUndefined()
      expect(own(item.id).slice(1).every(review => review.r > 0 && review.r <= 1)).toBe(true)
      expect(own(card.id).some(review => "r" in review)).toBe(false)
    })

    it("stores the settings records, with the library", async function() {
      let store = await open()
      expect(store.schedulerSettings()).toEqual(DEFAULT_SCHEDULER_SETTINGS)
      expect(store.practiceSettings()).toEqual(DEFAULT_PRACTICE_SETTINGS)
      expect(await store.backend.get("meta", "scheduler")).toEqual(DEFAULT_SCHEDULER_SETTINGS)
      expect(await store.backend.get("meta", "practice")).toEqual(DEFAULT_PRACTICE_SETTINGS)

      let strict = {...DEFAULT_SCHEDULER_SETTINGS, retention: 0.95}
      await store.putSettings(strict)
      await expectAsync(store.putSettings({...strict, retention: 2})).toBeRejectedWithError("Not valid settings")
      expect(store.schedulerSettings()).toEqual(strict)

      let reopened = await open({keep: true})
      expect(reopened.schedulerSettings()).toEqual(strict)

      // the new retention schedules the next attempts
      await reopened.putPiece(pieceData("a"))
      for (let time of [at(1, 18), at(1, 18, 1), at(1, 18, 2), at(3, 12)]) {
        await reopened.recordAttempt(attemptAt(measure, GOOD, time))
      }
      let reviews = await reopened.reviews({pieceId: "a"})
      let item = reopened.item("a:both:2-2")
      expect(item).toEqual(replay(reviews, {item, settings: strict}))
      expect(item.due).toBeLessThan(replay(reviews, {item}).due)

      let library = await reopened.exportLibrary()
      expect(library.settings).toEqual([strict, DEFAULT_PRACTICE_SETTINGS])

      let other = await open()
      let result = await other.importLibrary(library)
      expect(result.importedSettings).toEqual(2)
      expect(other.schedulerSettings()).toEqual(strict)
    })

    it("schedules the measures graded before the scheduler from their reviews, once", async function() {
      let store = await open()
      await store.putPiece(pieceData("a"))
      await practise(store)
      let scheduledItem = store.item("a:both:2-2")

      // as the store was before the scheduler: graded reviews, tracked items
      let unscheduled = replay([], {item: scheduledItem})
      expect(unscheduled.state).toEqual("tracked")
      await store.backend.write([
        {store: "items", put: {...unscheduled, recent: scheduledItem.recent}},
        {store: "meta", delete: "scheduler"},
        {store: "meta", delete: "practice"},
      ])

      let reopened = await open({keep: true})
      expect(reopened.item("a:both:2-2")).toEqual(scheduledItem)
      expect(reopened.item("a:both:2-3").state).toEqual("tracked")
      expect(await reopened.backend.get("meta", "scheduler")).toEqual(DEFAULT_SCHEDULER_SETTINGS)

      // not again once set up
      await reopened.backend.write([{store: "items", put: {...unscheduled, recent: scheduledItem.recent}}])
      let again = await open({keep: true})
      expect(again.item("a:both:2-2").state).toEqual("tracked")
    })
  })
})
