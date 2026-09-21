import {
  gradeAttempt, gradeOf, attemptPace, attemptCounts,
  AGAIN, HARD, GOOD, EASY, HESITATION_MIN_MS,
} from "st/srs/grade"

// columns played at an even 500 ms a beat, one beat apart, with the misses
// of each (a number a column, or an object for anything more)
const played = (...columns) => columns.map(column => ({
  misses: 0, ms: 500, gap: 1, ...(typeof column == "number" ? {misses: column} : column),
}))

const clean = n => played(...Array(n).fill(0))

describe("srs grade", function() {
  describe("the grade of one attempt", function() {
    const cases = [
      ["4 clean columns in wait mode is easy", clean(4), {mode: "wait"}, EASY],
      ["4 clean columns in scroll mode is only good", clean(4), {mode: "scroll"}, GOOD],
      ["4 columns with 1 slip is hard", played(0, 1, 0, 0), {mode: "wait"}, HARD],
      ["4 columns with 2 slips is again", played(0, 1, 1, 0), {mode: "wait"}, AGAIN],
      ["2 columns with 1 slip is again", played(0, 1), {mode: "wait"}, AGAIN],
      ["31 columns with 1 slip is hard", played(...Array(30).fill(0), 1), {mode: "wait"}, HARD],
      ["a column slipped on twice among 8 is hard", played(0, 2, 0, 0, 0, 0, 0, 0), {mode: "wait"}, HARD],
      ["a stuck column (three slips) among 8 is again", played(0, 3, 0, 0, 0, 0, 0, 0), {mode: "wait"}, AGAIN],
      ["a skipped column is again", played(0, 0, {skipped: true}, 0), {mode: "wait"}, AGAIN],
      ["a column scrolled past among 8 is hard", played(0, 0, 0, 1, 0, 0, 0, 0), {mode: "scroll"}, HARD],
      ["one hesitation among 4 is good, never easy",
        played(0, 0, {ms: 2000}, 0), {mode: "wait"}, GOOD],
      ["hesitations on over a quarter of the columns is hard",
        played(0, 0, {ms: 2000}, {ms: 2000}, 0, 0, 0), {mode: "wait"}, HARD],
      ["a long gap excuses the time after a long note",
        played(0, 0, {ms: 2000, gap: 4}, 0), {mode: "wait"}, EASY],
      ["a pause on the first column is reading, never a hesitation",
        played({ms: 20000}, 0, 0, 0), {mode: "wait"}, EASY],
      ["a pause on a bar's first column inside a card is a hesitation",
        played({ms: 2000}, 0, 0, 0), {mode: "wait", lead: false}, GOOD],
      ["under the threshold's floor is never a hesitation",
        played(0, 0, {ms: HESITATION_MIN_MS}, 0), {mode: "wait"}, EASY],
      ["a clean attempt slower than the usual pace is good",
        clean(4), {mode: "wait", usualPace: 400}, GOOD],
      ["a clean attempt near the usual pace is easy",
        clean(4), {mode: "wait", usualPace: 450}, EASY],
      ["a clean attempt at first sight is easy whatever the usual pace",
        clean(4), {mode: "wait", usualPace: 100, firstSight: true}, EASY],
      ["scroll mode ignores the time on a column",
        played(0, {ms: 20000}, 0, 0), {mode: "scroll"}, GOOD],
    ]

    for (let [what, columns, opts, grade] of cases) {
      it(what, function() {
        expect(gradeAttempt(columns, opts).grade).toEqual(grade)
      })
    }
  })

  it("counts what the grade reads", function() {
    let columns = played(
      {ms: 9000}, 0, 1, {skipped: true, ms: 50}, 3, {ms: 2600}, {ms: 1400, gap: 2}, 0)

    expect(gradeAttempt(columns, {mode: "wait"})).toEqual({
      columns: 8,
      clean: 5,
      slips: 2,
      misses: 4,
      stuck: 1,
      skipped: 1,
      hesitations: 1,
      pace: 500,
      grade: AGAIN,
    })
  })

  describe("pace", function() {
    it("is the median time a notated beat, leaving out the lead, skipped and untimed columns", function() {
      let columns = played(
        {ms: 9000}, {ms: 400}, {ms: 1200, gap: 2}, {ms: 700}, {skipped: true, ms: 1}, {ms: null})
      expect(attemptPace(columns)).toEqual(600)
      expect(attemptPace(columns, {lead: false})).toEqual(650)
    })

    it("counts a column without the score's rhythm as one beat", function() {
      expect(attemptPace(played(0, {ms: 300, gap: null}, {ms: 500, gap: null}))).toEqual(400)
    })

    it("is unknown for a single column", function() {
      expect(attemptPace(clean(1))).toBe(null)
      expect(gradeAttempt(clean(1), {mode: "wait", usualPace: 1}).grade).toEqual(EASY)
    })

    it("judges hesitations by a pace given, eg. a whole card's", function() {
      let columns = played(0, {ms: 1600}, {ms: 1600})
      expect(attemptCounts(columns, {mode: "wait"}).hesitations).toEqual(0)
      expect(attemptCounts(columns, {mode: "wait", pace: 500}).hesitations).toEqual(2)
    })

    it("isn't counted in scroll mode", function() {
      expect(attemptCounts(clean(3), {mode: "scroll"}).pace).toBe(null)
    })
  })

  it("grades the counts alone", function() {
    let counts = {columns: 4, slips: 0, stuck: 0, skipped: 0, hesitations: 0, pace: 500}
    expect(gradeOf(counts, {mode: "wait"})).toEqual(EASY)
    expect(gradeOf({...counts, pace: 600}, {mode: "wait", usualPace: 500})).toEqual(GOOD)
    expect(gradeOf({...counts, slips: 1}, {mode: "wait"})).toEqual(HARD)
  })
})
