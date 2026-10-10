import {
  AttemptPass, passAttempts, passPractice, passPace, columnClefs, PAUSE_MS, selfAttempts, selfPractice,
} from "st/srs/attempt"
import {sectionCard} from "st/measure_cards"
import {newItem, validItem, validReview} from "st/srs/records"
import {AGAIN, HARD, GOOD, EASY, GRADE_ALGO} from "st/srs/grade"
import {SELF_PAUSE_MS} from "st/srs/self_grade"

// a column of notes on the grand staff at a beat, eg. col(0, ["G3", "lower"], ["G4", "upper"])
const col = (beat, ...notes) => {
  let column = notes.map(([name]) => name)
  column.beat = beat
  column.staves = notes.map(([, staff]) => staff)
  column.clefs = {upper: "g", lower: "f"}
  return column
}

// bar 1: a chord across the staves, then two treble notes; bar 2 one bass note
const twoBars = () => sectionCard([
  {number: 1, columns: [col(0, ["G3", "lower"], ["G4", "upper"]), col(1, ["A4", "upper"]), col(2, ["B4", "upper"])]},
  {number: 2, columns: [col(3, ["C3", "lower"])]},
])

const noItems = () => null

// plays the pass's head column, done at time, with the given slips first
// and what the matcher measured on it: by default the column started the
// moment it became the head's time away and all its keys down together
const play = (pass, time, {misses=[], counted=true, hit=true, measured}={}) => {
  let latency = pass.columnStartedAt == null ? null : time - pass.columnStartedAt
  misses.forEach((notes, idx) => pass.miss(notes, {counted: counted && idx == 0, time}))
  let index = pass.done(time, hit ? measured || {latency, spread: 0, early: 0, heldCredit: 0, late: null} : undefined)
  if (hit) { pass.hit(index) }
}

describe("srs attempt", function() {
  let pass

  beforeEach(function() {
    pass = new AttemptPass(twoBars(), {startedAt: 1000})
    pass.drill = {mode: "wait"}
  })

  let attemptsOf = (p, opts={}) => passAttempts(p, {pieceId: "p", hand: "both", sessionId: "s1", ...opts})
    .map(({id, build}) => ({id, ...build((opts.items || noItems)(id))}))

  it("grades a clean pass as a review of the card and of each of its bars", function() {
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500)
    expect(pass.complete).toBe(true)

    let attempts = attemptsOf(pass)
    expect(attempts.map(a => a.id)).toEqual(["p:both:1-2", "p:both:1-1", "p:both:2-2"])
    expect(attempts.every(({item, review}) => validItem(item) && validReview(review))).toBe(true)

    let [card, bar1, bar2] = attempts
    expect(card.review).toEqual({
      itemId: "p:both:1-2",
      at: 4500,
      pieceId: "p",
      sessionId: "s1",
      kind: "attempt",
      grade: EASY,
      was: "new",
      columns: 4,
      clean: 4,
      misses: 0,
      stuck: 0,
      skipped: 0,
      hesitations: 0,
      elapsedMs: 3500,
      mode: "wait",
      algo: GRADE_ALGO,
      leadMs: 2000,
      bars: [[1, 3, 3, 0, 3000], [2, 1, 1, 0, 500]],
      staffMisses: {upper: 0, lower: 0},
      // [slips, stalled, latency, spread, early, heldCredit, late] a column
      perColumn: [[0, 0, 2000, 0, 0, 0, null], [0, 0, 500, 0, 0, 0, null], [0, 0, 500, 0, 0, 0, null], [0, 0, 500, 0, 0, 0, null]],
    })

    expect(card.item).toEqual(jasmine.objectContaining({
      id: "p:both:1-2", pieceId: "p", hand: "both", startMeasure: 1, endMeasure: 2,
      state: "tracked", hits: 4, misses: 0, attempts: 1, lastPracticed: 4500, elapsedMs: 3500,
      recent: [[4500, 4, 4, EASY]], paceMs: 500,
    }))

    // only the bar the card opens with has the reading time
    expect(bar1.review.leadMs).toEqual(2000)
    expect(bar1.review.bars).toBeUndefined()
    expect([bar1.review.columns, bar1.review.grade]).toEqual([3, EASY])
    expect(bar2.review.leadMs).toBeUndefined()
    expect([bar2.review.columns, bar2.review.grade, bar2.review.elapsedMs]).toEqual([1, EASY, 500])
    expect(bar2.review.perColumn).toEqual([[0, 0, 500, 0, 0, 0, null]])
    expect([bar2.item.hits, bar2.item.elapsedMs]).toEqual([1, 500])
  })

  it("appends a pass tuple to each single-bar item, none to the range item", function() {
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500)

    let [card, bar1, bar2] = attemptsOf(pass)
    expect(card.item.passes).toBeUndefined()
    expect(bar1.item.passes).toEqual([[4500, 3, 3, EASY]])
    expect(bar2.item.passes).toEqual([[4500, 1, 1, EASY]])
  })

  it("grades each bar from its own columns, splitting the misses by the staff of the notes not held", function() {
    play(pass, 3000, {misses: [["G3"], ["G3", "G4"], ["G4"]]})
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500)

    let [card, bar1, bar2] = attemptsOf(pass)
    // a stuck column fails the card and its bar, not the bar after it
    expect([card.review.grade, bar1.review.grade, bar2.review.grade]).toEqual([AGAIN, AGAIN, EASY])
    expect(card.review).toEqual(jasmine.objectContaining({
      clean: 3, misses: 3, stuck: 1, trouble: [0], staffMisses: {upper: 2, lower: 2},
      bars: [[1, 3, 2, 3, 3000], [2, 1, 1, 0, 500]],
    }))
    expect(bar2.review.staffMisses).toEqual({upper: 0, lower: 0})
    expect(bar2.review.trouble).toBeUndefined()

    // the totals count the column missed once, as the stats did
    expect([card.item.hits, card.item.misses]).toEqual([4, 1])
    expect([bar1.item.hits, bar1.item.misses]).toEqual([3, 1])
    // a pace is kept from clean attempts only
    expect(card.item.paceMs).toBeUndefined()
    expect(bar2.item.paceMs).toEqual(500)
  })

  it("numbers trouble by the item's own columns", function() {
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500, {misses: [["C3"]]})

    let [card, bar1, bar2] = attemptsOf(pass)
    expect(card.review.trouble).toEqual([3])
    expect(bar1.review.trouble).toBeUndefined()
    expect(bar2.review.trouble).toEqual([0])
    // one slip in a one column bar is again, a hard card
    expect([card.review.grade, bar2.review.grade]).toEqual([HARD, AGAIN])
    expect(bar2.review.staffMisses).toEqual({upper: 0, lower: 1})
  })

  it("judges a bar's hesitations by the whole card's pace", function() {
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 6000)

    let [card, bar1, bar2] = attemptsOf(pass)
    expect(card.review.hesitations).toEqual(1)
    expect([card.review.grade, bar1.review.grade, bar2.review.grade]).toEqual([GOOD, EASY, HARD])
  })

  // a column completed late because a key was held instead of struck
  // again: its first key went down on time, so the wait on it is its spread,
  // not a hesitation
  it("reads a hesitation from a column's latency, never from the time it took to complete", function() {
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 9000, {measured: {latency: 400, spread: 5100, early: 0, heldCredit: 0, late: null}})
    play(pass, 9500)

    let [card, bar1] = attemptsOf(pass)
    expect([card.review.hesitations, card.review.grade, bar1.review.grade]).toEqual([0, EASY, EASY])
    expect(card.review.perColumn[2]).toEqual([0, 0, 400, 5100, 0, 0, null])
    // the time on it is still the column's, for the elapsed time
    expect(bar1.review.elapsedMs).toEqual(8000)

    // a long wait before the first key is one, however quickly it completes
    let slow = new AttemptPass(twoBars(), {startedAt: 1000})
    slow.drill = {mode: "wait"}
    play(slow, 3000)
    play(slow, 3500)
    play(slow, 6000, {measured: {latency: 2400, spread: 100, early: 0, heldCredit: 0, late: null}})
    play(slow, 6500)
    let [slowCard] = attemptsOf(slow)
    expect([slowCard.review.hesitations, slowCard.review.grade]).toEqual([1, GOOD])
  })

  // a column the matcher settled by a key held, none of its keys struck at
  // it: its time and the notated beats before it go to the next column
  // played, so the wait for it isn't a hesitation at the pace of the pass
  it("carries the time on a column settled by a key held to the next column played", function() {
    let settled = {latency: null, spread: null, early: 0, heldCredit: 1, late: null, settled: true}
    play(pass, 2000)
    play(pass, 2500)
    play(pass, 4000, {measured: settled})
    play(pass, 4500, {measured: {latency: 2000, spread: 0, early: 0, heldCredit: 0, late: null}})

    expect(pass.columns.map(column => [column.settled, column.ms])).toEqual([
      [false, 1000], [false, 500], [true, null], [false, 2000],
    ])
    let [card, bar1, bar2] = attemptsOf(pass)
    expect(card.review.perColumn.map(column => column[2])).toEqual([1000, 500, null, 2000])
    expect([card.review.hesitations, card.review.grade]).toEqual([0, EASY])
    expect(card.review.elapsedMs).toEqual(3500)
    expect([bar1.review.elapsedMs, bar2.review.elapsedMs]).toEqual([1500, 2000])
  })

  it("opens a pass at its first column played when those before it were settled by a key held", function() {
    let settled = {latency: null, spread: null, early: 0, heldCredit: 1, late: null, settled: true}
    play(pass, 1000, {measured: settled})
    play(pass, 5000)
    play(pass, 5500)
    play(pass, 6000)

    let [card] = attemptsOf(pass)
    expect(card.review.leadMs).toEqual(4000)
    expect([card.review.hesitations, card.review.grade]).toEqual([0, EASY])
  })

  it("records how late each column stood on the line in scroll mode, never as a miss", function() {
    pass.drill = {mode: "scroll", speed: 30}
    let measured = late => ({latency: 300, spread: 0, early: 0, heldCredit: 0, late})
    play(pass, 3000, {measured: measured(0)})
    play(pass, 3500, {measured: measured(0)})
    play(pass, 9000, {measured: measured(4800)})
    play(pass, 9500, {measured: measured(120.4)})

    let [card, bar1] = attemptsOf(pass)
    expect(card.review.perColumn.map(column => column[6])).toEqual([0, 0, 4800, 120])
    expect(card.review).toEqual(jasmine.objectContaining({
      misses: 0, clean: 4, skipped: 0, hesitations: 0, grade: GOOD, mode: "scroll",
    }))
    expect(card.review.trouble).toBeUndefined()
    expect([bar1.review.misses, bar1.review.grade]).toEqual([0, GOOD])
    expect([card.item.hits, card.item.misses]).toEqual([4, 0])
    expect(validReview(card.review)).toBe(true)
  })

  it("counts a column left unplayed as skipped in wait mode, a miss scrolled past in scroll mode", function() {
    play(pass, 3000)
    play(pass, 3500, {hit: false})
    play(pass, 4000, {misses: [["B4"]], hit: false})
    play(pass, 4500)

    let [card] = attemptsOf(pass)
    expect([card.review.skipped, card.review.clean, card.review.grade]).toEqual([2, 2, AGAIN])
    // a column skipped is stalled, and has nothing measured
    expect(card.review.perColumn.slice(1, 3)).toEqual([[0, 1, null, null, null, null, null], [1, 1, null, null, null, null, null]])
    expect([card.item.hits, card.item.misses]).toEqual([2, 1])

    pass.drill = {mode: "scroll", speed: 30}
    let [scrolled] = attemptsOf(pass)
    expect([scrolled.review.skipped, scrolled.review.mode, scrolled.review.speed]).toEqual([1, "scroll", 30])
  })

  it("is never easy in scroll mode, and keeps no pace", function() {
    pass.drill = {mode: "scroll", speed: 20}
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500)

    let attempts = attemptsOf(pass)
    expect(attempts.map(a => a.review.grade)).toEqual([GOOD, GOOD, GOOD])
    expect(attempts.map(a => a.review.hesitations)).toEqual([0, 0, 0])
    expect(attempts.every(a => a.item.paceMs === undefined)).toBe(true)
  })

  it("adds to stored items, first sight only for an item never practiced", function() {
    let stored = {
      ...newItem({pieceId: "p", startMeasure: 1, endMeasure: 1}, 10),
      hits: 5, misses: 2, attempts: 2, lastPracticed: 100, elapsedMs: 900, paceMs: 400,
      recent: [[1, 3, 3, 4], [2, 3, 3, 4], [3, 3, 3, 4], [4, 3, 3, 4], [5, 3, 3, 4]],
    }

    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500)

    let items = id => id == stored.id ? stored : null
    let [card, bar1] = attemptsOf(pass, {items})

    expect(card.review.was).toEqual("new")
    expect(bar1.review.was).toEqual("tracked")
    // slower than its usual pace
    expect(bar1.review.grade).toEqual(GOOD)
    expect(bar1.item).toEqual(jasmine.objectContaining({
      hits: 8, misses: 2, attempts: 3, lastPracticed: 4500, elapsedMs: 3900, paceMs: 425, createdAt: 10,
      recent: [[2, 3, 3, 4], [3, 3, 3, 4], [4, 3, 3, 4], [5, 3, 3, 4], [4500, 3, 3, GOOD]],
    }))
  })

  it("leaves a pause out of the elapsed time", function() {
    play(pass, 3000)
    play(pass, 3000 + PAUSE_MS)
    play(pass, 3500 + PAUSE_MS)
    play(pass, 4000 + PAUSE_MS)

    let [card] = attemptsOf(pass)
    expect(card.review.elapsedMs).toEqual(3000)
    expect(card.review.hesitations).toEqual(1)
  })

  it("writes no attempt for a pass not played through in one go, only its practice", function() {
    play(pass, 3000, {misses: [["G4"]]})
    play(pass, 3500)
    expect(attemptsOf(pass)).toEqual([])

    expect(passPractice(pass, {pieceId: "p", hand: "upper"})).toEqual([
      {pieceId: "p", hand: "upper", startMeasure: 1, endMeasure: 2, hits: 2, misses: 1, elapsedMs: 2500, at: 3500},
      {pieceId: "p", hand: "upper", startMeasure: 1, endMeasure: 1, hits: 2, misses: 1, elapsedMs: 2500, at: 3500},
    ])

    let rest = new AttemptPass(pass.card, {from: pass.head, continued: true, startedAt: 9000})
    rest.drill = {mode: "wait"}
    play(rest, 9500)
    play(rest, 10000)
    expect(rest.complete).toBe(true)
    expect(attemptsOf(rest)).toEqual([])
    expect(passPractice(rest, {pieceId: "p", hand: "upper"}).map(p => [p.startMeasure, p.endMeasure, p.hits]))
      .toEqual([[1, 2, 2], [1, 1, 1], [2, 2, 1]])
  })

  it("writes nothing for a pass never played", function() {
    play(pass, 3000, {hit: false})
    play(pass, 3500, {hit: false})
    play(pass, 4000, {hit: false})
    play(pass, 4500, {hit: false})

    expect(pass.touched).toBe(true)
    expect(pass.played).toBe(false)
    expect(attemptsOf(pass)).toEqual([])
    expect(passPractice(pass, {pieceId: "p", hand: "both"})).toEqual([])
  })

  it("grades a card of one bar once", function() {
    let bar = new AttemptPass(sectionCard([{number: 4, columns: [col(0, ["C4", "upper"]), col(1, ["D4", "upper"])]}]), {startedAt: 0})
    bar.drill = {mode: "wait"}
    play(bar, 1000)
    play(bar, 1500)

    let attempts = attemptsOf(bar, {hand: "upper"})
    expect(attempts.map(a => a.id)).toEqual(["p:upper:4-4"])
    expect(attempts[0].review.bars).toBeUndefined()
  })

  it("marks the item deliberate only when asked, never on a hands-together item", function() {
    play(pass, 3000)
    play(pass, 3500)
    play(pass, 4000)
    play(pass, 4500)

    let marked = attemptsOf(pass, {hand: "lower", deliberate: true})
    expect(marked.every(({item}) => item.deliberate)).toBe(true)

    // the hand scaffold's own pass, no marker given
    let scaffold = attemptsOf(pass, {hand: "lower"})
    expect(scaffold.every(({item}) => item.deliberate === undefined)).toBe(true)

    let together = attemptsOf(pass, {deliberate: true})
    expect(together.every(({item}) => item.deliberate === undefined)).toBe(true)
  })

  it("carries deliberate onto a practice stint only when given", function() {
    play(pass, 3000, {misses: [["G4"]]})
    play(pass, 3500)

    let marked = passPractice(pass, {pieceId: "p", hand: "lower", deliberate: true})
    expect(marked.length).toBeGreaterThan(0)
    expect(marked.every(stint => stint.deliberate)).toBe(true)

    let unmarked = passPractice(pass, {pieceId: "p", hand: "lower"})
    expect(unmarked.every(stint => stint.deliberate === undefined)).toBe(true)
  })

  it("leaves out the staff misses of columns without staves", function() {
    let plain = new AttemptPass(sectionCard([{number: 1, columns: [["C4"], ["D4"]]}]), {startedAt: 0})
    plain.drill = {mode: "wait"}
    play(plain, 1000, {misses: [["C4"]]})
    play(plain, 1500)

    let [attempt] = attemptsOf(plain)
    expect(attempt.review.staffMisses).toBeUndefined()
    expect(validReview(attempt.review)).toBe(true)
  })

  it("tells the clefs a column's notes are read in", function() {
    let [chord] = twoBars().columns
    expect(columnClefs(chord)).toEqual(["g", "f"])
    expect(columnClefs(chord, ["G3"])).toEqual(["f"])
    expect(columnClefs(["C4"])).toEqual([])
  })

  // acoustic mode: the player grades the pass themself (st/srs/self_grade),
  // in place of detection
  describe("read-through passes", function() {
    let playThrough = () => {
      for (let time of [3000, 3500, 4000, 4500]) { play(pass, time) }
    }

    it("logs a review of the card and of each bar as a read-through, graded as any attempt", function() {
      playThrough()
      let attempts = attemptsOf(pass, {kind: "read-through"})
      let plain = attemptsOf(pass)
      expect(attempts.map(a => a.id)).toEqual(["p:both:1-2", "p:both:1-1", "p:both:2-2"])
      expect(attempts.every(({item, review}) => validItem(item) && validReview(review))).toBe(true)
      expect(attempts.map(({review}) => review.kind)).toEqual(Array(3).fill("read-through"))
      expect(attempts.map(({review}) => ({...review, kind: "attempt"}))).toEqual(plain.map(({review}) => review))
    })

    it("gives its items practice and a pass, never an attempt a schedule or the pace reads", function() {
      playThrough()
      let [card, bar1, bar2] = attemptsOf(pass, {kind: "read-through"})
      expect(card.item).toEqual(jasmine.objectContaining({attempts: 1, hits: 4, lastPracticed: 4500, recent: []}))
      expect(card.item.passes).toBeUndefined()
      expect(card.item.paceMs).toBeUndefined()
      expect(bar1.item.recent).toEqual([])
      expect(bar1.item.passes).toEqual([[4500, 3, 3, null]])
      expect(bar2.item.passes).toEqual([[4500, 1, 1, null]])
      expect(bar1.item.state).toEqual("tracked")
    })

    it("adds to an item as stored, the first graded attempt after it still at first sight of nothing", function() {
      playThrough()
      let items = {"p:both:1-1": {...newItem({pieceId: "p", startMeasure: 1, endMeasure: 1}, 10), attempts: 1, hits: 3, lastPracticed: 2000}}
      let [, bar1] = attemptsOf(pass, {kind: "read-through", items: id => items[id] || null})
      expect(bar1.item).toEqual(jasmine.objectContaining({attempts: 2, hits: 6}))
      expect(bar1.review.was).toEqual("tracked")
    })

    it("writes a self-graded read-through as a self review of the card and its bars, never a recent attempt", function() {
      pass.selfGrade = {grade: GOOD}
      let attempts = selfAttempts(pass, {pieceId: "p", hand: "both", at: 5000, kind: "read-through"})
        .map(({id, build}) => ({id, ...build(null)}))
      expect(attempts.map(a => a.id)).toEqual(["p:both:1-2", "p:both:1-1", "p:both:2-2"])
      expect(attempts.every(({item, review}) => validItem(item) && validReview(review))).toBe(true)
      expect(attempts[0].review).toEqual({
        itemId: "p:both:1-2", at: 5000, pieceId: "p", kind: "read-through", mode: "self",
        grade: GOOD, was: "new", elapsedMs: 4000,
      })
      expect(attempts.map(({item}) => item.recent)).toEqual([[], [], []])
      expect(attempts[1].item.passes).toEqual([[5000, null, null, GOOD]])
      expect(attempts[0].item.passes).toBeUndefined()
    })
  })

  describe("self-graded passes", function() {
    let selfAttemptsOf = (p, opts={}) => selfAttempts(p, {pieceId: "p", hand: "both", ...opts})
      .map(({id, build}) => ({id, ...build((opts.items || noItems)(id))}))

    it("gives the range and each bar, each a self review with none of detection's fields", function() {
      pass.selfGrade = {grade: GOOD}
      let attempts = selfAttemptsOf(pass, {at: 5000})
      expect(attempts.map(a => a.id)).toEqual(["p:both:1-2", "p:both:1-1", "p:both:2-2"])
      expect(attempts.every(({item, review}) => validItem(item) && validReview(review))).toBe(true)

      let [card, bar1, bar2] = attempts
      expect(card.review).toEqual({
        itemId: "p:both:1-2", at: 5000, pieceId: "p", kind: "attempt", mode: "self",
        grade: GOOD, was: "new", elapsedMs: 4000,
      })
      expect(card.item).toEqual(jasmine.objectContaining({
        id: "p:both:1-2", attempts: 1, lastPracticed: 5000, elapsedMs: 4000,
        recent: [[5000, null, null, GOOD]],
      }))
      expect(card.item.paceMs).toBeUndefined()

      // elapsed time split by each bar's share of the card's columns
      expect(bar1.review.elapsedMs).toEqual(3000)
      expect(bar2.review.elapsedMs).toEqual(1000)
    })

    it("grades only the named bars when bars is given, leaving the rest to selfPractice", function() {
      pass.selfGrade = {grade: HARD, bars: [2]}
      let attempts = selfAttemptsOf(pass, {at: 5000})
      expect(attempts.map(a => a.id)).toEqual(["p:both:1-2", "p:both:2-2"])

      let practice = selfPractice(pass, {pieceId: "p", hand: "both", at: 5000})
      expect(practice).toEqual([
        {pieceId: "p", hand: "both", startMeasure: 1, endMeasure: 1, hits: 0, misses: 0, played: true, at: 5000, elapsedMs: 3000},
      ])
    })

    it("appends a self pass tuple to every bar a Clean grade reaches, only the named bar for Where?", function() {
      pass.selfGrade = {grade: GOOD}
      let [, bar1, bar2] = selfAttemptsOf(pass, {at: 5000})
      expect(bar1.item.passes).toEqual([[5000, null, null, GOOD]])
      expect(bar2.item.passes).toEqual([[5000, null, null, GOOD]])

      pass.selfGrade = {grade: HARD, bars: [2]}
      let [, stumbledBar2] = selfAttemptsOf(pass, {at: 6000})
      expect(stumbledBar2.id).toEqual("p:both:2-2")
      expect(stumbledBar2.item.passes).toEqual([[6000, null, null, HARD]])
    })

    it("leaves out the elapsed time, and adds none, over SELF_PAUSE_MS", function() {
      pass.selfGrade = {grade: EASY}
      let at = 1000 + SELF_PAUSE_MS + 1000
      let attempts = selfAttemptsOf(pass, {at})
      expect(attempts.every(a => a.review.elapsedMs === undefined)).toBe(true)
      expect(attempts.every(a => a.item.elapsedMs === undefined)).toBe(true)
    })

    it("keeps no pace and writes no detected attempt for a self-graded pass", function() {
      pass.selfGrade = {grade: GOOD}
      pass.drill = {mode: "self"}
      expect(passPace(pass)).toBe(null)
      expect(passAttempts(pass, {pieceId: "p", hand: "both"})).toEqual([])
    })

    it("carries deliberate onto a self-graded attempt and its leftover practice only when given", function() {
      pass.selfGrade = {grade: HARD, bars: [2]}
      let marked = selfAttemptsOf(pass, {at: 5000, hand: "lower", deliberate: true})
      expect(marked.every(({item}) => item.deliberate)).toBe(true)

      let practice = selfPractice(pass, {pieceId: "p", hand: "lower", at: 5000, deliberate: true})
      expect(practice.length).toBeGreaterThan(0)
      expect(practice.every(stint => stint.deliberate)).toBe(true)

      let unmarkedPractice = selfPractice(pass, {pieceId: "p", hand: "lower", at: 5000})
      expect(unmarkedPractice.every(stint => stint.deliberate === undefined)).toBe(true)
    })
  })
})
