import {AttemptPass, passAttempts, passPractice, columnClefs, PAUSE_MS} from "st/srs/attempt"
import {sectionCard} from "st/measure_cards"
import {newItem, validItem, validReview} from "st/srs/records"
import {AGAIN, HARD, GOOD, EASY, GRADE_ALGO} from "st/srs/grade"

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
})
