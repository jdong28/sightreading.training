import {
  practiceDay, todayMinutes, todayMinutesWords, PROGRAMME, FREE, WHOLE, TODAY_TROUBLE_ROWS,
} from "st/practice_day"
import {PROGRAMME_PRACTICE, FREE_PRACTICE, WHOLE_SECTION} from "st/data"
import {importMusicXMLPiece, pieceSong} from "st/sheet_music_deck"
import {measureBeatRange} from "st/song_sections"
import {dayStart, localDay} from "st/srs/schedule"
import {openTestStore, dynamicsOpening} from "spec/helpers"
import {GOOD, AGAIN} from "st/srs/grade"

// a fixed Monday evening, 14 September 2026; its practice day starts at 4 am
const NOW = +new Date(2026, 8, 14, 20)
const TODAY_START = dayStart(localDay(NOW))
const at = (hour, minute=0, day=14) => +new Date(2026, 8, day, hour, minute)

const goal = 10
const exerciseLabel = () => ({italic: "Treble staff", small: "Exercises · Random notes"})

describe("practice day (st/practice_day)", function() {
  let store, fixture, other, pieces

  beforeEach(async function() {
    store = await openTestStore()
    let xml = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    fixture = (await importMusicXMLPiece("fixture.musicxml", xml, store)).piece
    other = (await importMusicXMLPiece("other.musicxml", dynamicsOpening({title: "Other Study"}), store)).piece
    pieces = [fixture, other].map(piece => ({id: piece.id, title: piece.title, song: pieceSong(piece)}))
  })

  afterEach(function() {
    store.close()
  })

  let session = (id, startedAt, fields={}) => ({
    id, startedAt, endedAt: startedAt + 60000, staff: "treble", generator: "random",
    notesRead: 9, misses: 1, bestStreak: 3, elapsedSeconds: 600, notes: {}, settings: {}, ...fields,
  })

  let pieceSession = (id, startedAt, settings={}, fields={}) => session(id, startedAt, {
    generator: "sheet music", staff: "grand", settings: {piece: fixture.id, pieceTitle: "Fixture", ...settings}, ...fields,
  })

  // a detected row of a bar, its four columns on the beats of the bar
  let row = (measure, time, fields={}, piece=fixture) => {
    let barStart = measureBeatRange(pieceSong(piece), measure, measure)[0]
    return {
      itemId: `${piece.id}:both:${measure}-${measure}`, at: time, pieceId: piece.id, hand: "both", measure,
      sessionId: "s1", mode: "wait", card: [measure, measure], cardGrade: 3, columns: 4, clean: 4, grade: 3,
      reviewed: true,
      beats: [barStart, barStart + 1, barStart + 2, barStart + 3], gaps: [null, 1, 1, 1], iois: [null, 500, 500, 500],
      pulse: 500, marks: [],
      ...fields,
    }
  }

  let wrong = (index, kind="wrong") => [index, kind, ["C4"], kind == "wrong" ? ["D4"] : [], 1, null]
  let selfRow = (measure, time, grade, fields={}) => ({
    itemId: `${fixture.id}:both:${measure}-${measure}`, at: time, pieceId: fixture.id, hand: "both", measure,
    sessionId: "s1", mode: "self", card: [measure, measure], cardGrade: grade, columns: null, clean: null, grade, ...fields,
  })

  let item = (measure, passes, hand="both", fields={}) => ({
    id: `${fixture.id}:${hand}:${measure}-${measure}`, pieceId: fixture.id, hand, startMeasure: measure, endMeasure: measure,
    attempts: passes.length, passes, recent: passes, ...fields,
  })
  let clean = time => [time, 4, 4, GOOD]
  let slip = time => [time, 4, 3, AGAIN]

  let day = ({sessions=[], rows=[], items=[], played=true, now=NOW, ...rest}={}) => practiceDay({
    now, sessions, rows, pieces, items: () => items, played, goal, exerciseLabel, ...rest,
  })

  it("keeps the session settings' words as st/data names them", function() {
    expect(PROGRAMME).toEqual(PROGRAMME_PRACTICE)
    expect(FREE).toEqual(FREE_PRACTICE)
    expect(WHOLE).toEqual(WHOLE_SECTION)
  })

  describe("the practice day", function() {
    it("counts a session at 03:30 for yesterday and one at 04:30 for today", function() {
      let sessions = [session("early", at(3, 30)), session("late", at(4, 30), {elapsedSeconds: 120})]
      let result = day({sessions})

      expect(result.sessions.map(s => s.id)).toEqual(["late"])
      expect(result.cards.sessions.value).toEqual(1)
      expect(result.cards.minutes.value).toEqual(2)
    })

    it("names the practice day's date, so half past midnight is still Monday's evening", function() {
      let late = +new Date(2026, 8, 15, 0, 30)
      let result = day({now: late, sessions: [session("a", at(23, 30))]})

      expect(result.date).toEqual({weekday: "Monday", day: 14, month: "September"})
      expect(result.sessions.map(s => s.id)).toEqual(["a"])
      expect(day().date).toEqual({weekday: "Monday", day: 14, month: "September"})
    })

    it("leaves out a session that starts after now", function() {
      expect(day({sessions: [session("future", NOW + 3600000)]}).state).not.toEqual("played")
    })
  })

  describe("the minutes card", function() {
    it("reads a session's elapsed seconds, else its active seconds, and says when the goal is met", function() {
      let result = day({sessions: [
        session("a", at(18), {elapsedSeconds: 300}),
        session("b", at(19), {elapsedSeconds: undefined, activeSeconds: 300}),
      ]})

      expect(result.cards.minutes.value).toEqual(10)
      expect(result.cards.minutes.met).toBe(true)
      expect(result.cards.minutes.ariaLabel).toEqual("10 of 10 minutes")
    })

    it("draws the goal's track to scale: the fill and the tick, under and over the goal", function() {
      let under = day({sessions: [session("a", at(18), {elapsedSeconds: 360})]}).cards.minutes
      expect(under.value).toEqual(6)
      expect(under.met).toBe(false)
      expect(under.fill).toBeCloseTo(0.6, 5)
      expect(under.tick).toEqual(1)

      let over = day({sessions: [session("a", at(18), {elapsedSeconds: 1200})]}).cards.minutes
      expect(over.fill).toEqual(1)
      expect(over.tick).toBeCloseTo(0.5, 5)
    })
  })

  describe("the accuracy card", function() {
    it("sums the notes of every session and shows the change on yesterday", function() {
      let sessions = [
        session("a", at(18), {notesRead: 9, misses: 1}), session("b", at(19), {notesRead: 7, misses: 3}),
        session("y", at(18, 0, 13), {notesRead: 8, misses: 2}),
      ]
      let accuracy = day({sessions}).cards.accuracy
      expect(accuracy.value).toEqual(80)
      expect(accuracy.change).toBe("Level with yesterday")

      let up = day({sessions: [session("a", at(18), {notesRead: 83, misses: 17}), session("y", at(18, 0, 13), {notesRead: 80, misses: 20})]}).cards.accuracy
      expect(up.change).toEqual("▲ 3 on yesterday")

      let down = day({sessions: [session("a", at(18), {notesRead: 78, misses: 22}), session("y", at(18, 0, 13), {notesRead: 80, misses: 20})]}).cards.accuracy
      expect(down.change).toEqual("▼ 2 on yesterday")
    })

    it("has no change when yesterday read no notes, and no accuracy when today read none", function() {
      let none = day({sessions: [session("a", at(18), {notesRead: 0, misses: 0})]}).cards.accuracy
      expect(none.value).toBe(null)
      expect(none.change).toBe(null)

      let noYesterday = day({sessions: [
        session("a", at(18)), session("y", at(18, 0, 13), {notesRead: 0, misses: 0}),
      ]}).cards.accuracy
      expect(noYesterday.value).toEqual(90)
      expect(noYesterday.change).toBe(null)
    })
  })

  describe("the sessions card", function() {
    it("says the pieces and exercises played, leaving out a part with none", function() {
      let caption = sessions => day({sessions}).cards.sessions.caption

      expect(caption([pieceSession("p", at(18)), session("e", at(19))])).toEqual("1 piece, 1 exercise")
      expect(caption([session("e", at(19)), session("f", at(20), {generator: "sweep"})])).toEqual("2 exercises")
      expect(caption([pieceSession("p", at(18)), pieceSession("q", at(19))])).toEqual("1 piece")
      expect(caption([pieceSession("p", at(18)), pieceSession("q", at(19), {piece: other.id, pieceTitle: "Other Study"})]))
        .toEqual("2 pieces")
      expect(caption([session("e", at(19)), session("f", at(20))])).toEqual("1 exercise")
    })
  })

  describe("a bar today", function() {
    let plate = (rows, extra={}) => day({rows, ...extra}).pieces[0]
    let cell = (rows, measure, extra) => plate(rows, extra).cells.find(c => c.measure == measure)

    it("adds a bar's passes together over the day: 4 of 4 and 3 of 4 is 88%, near", function() {
      let result = cell([row(2, at(18)), row(2, at(18, 5), {clean: 3, marks: [wrong(1)]})], 2)
      expect(result.label).toEqual("88%")
      expect(result.kind).toEqual("near")
      expect(result.share).toEqual(88)
    })

    it("reads clean at 100, near at 80 or more and trouble under", function() {
      let rows = [
        row(1, at(18)), row(2, at(18), {clean: 3, marks: [wrong(1)]}),
        row(3, at(18), {clean: 2, marks: [wrong(1), wrong(2)]}),
      ]
      let result = plate(rows)
      expect(result.cells.slice(0, 3).map(c => c.kind)).toEqual(["clean", "trouble", "trouble"])

      let near = cell([row(1, at(18), {columns: 10, clean: 8, marks: [wrong(1), wrong(2)], beats: Array(10).fill(0), gaps: Array(10).fill(null), iois: Array(10).fill(null)})], 1)
      expect(near.kind).toEqual("near")
    })

    it("adds the rows of every hand together", function() {
      let rows = [
        row(2, at(18)), row(2, at(18, 5), {hand: "upper", itemId: `${fixture.id}:upper:2-2`, clean: 2, marks: [wrong(0), wrong(1)]}),
      ]
      expect(cell(rows, 2).label).toEqual("75%")
    })

    it("reads a bar with only self-graded passes as its share of clean passes", function() {
      let rows = [selfRow(2, at(18), GOOD), selfRow(2, at(18, 5), GOOD), selfRow(2, at(18, 10), AGAIN)]
      let result = cell(rows, 2)
      expect(result.label).toEqual("2 of 3 clean")
      expect(result.kind).toEqual("trouble")
      expect(result.share).toEqual(67)
    })

    it("keeps the accuracy of a bar with one detected pass, whatever self-graded passes it has", function() {
      let rows = [row(2, at(18), {clean: 3, marks: [wrong(1)]}), selfRow(2, at(18, 5), GOOD)]
      expect(cell(rows, 2).label).toEqual("75%")
    })

    it("marks a bar not played today, by its number", function() {
      let result = plate([row(2, at(18))])
      let unplayed = result.cells.find(c => c.measure == 3)
      expect(unplayed.kind).toBe(null)
      expect(unplayed.ariaLabel).toEqual("Bar 3, not played today")
      expect(result.cells.find(c => c.measure == 2).ariaLabel).toEqual("Bar 2, 100% today")
      expect(result.played).toEqual(1)
      expect(result.total).toEqual(16)
    })

    it("skips the rows of a piece that is gone, and those of yesterday", function() {
      let gone = row(2, at(18), {pieceId: "gone", itemId: "gone:both:2-2"})
      let yesterday = row(3, at(18, 0, 13))
      let result = day({rows: [gone, yesterday, row(4, at(18))]})
      expect(result.pieces.length).toEqual(1)
      expect(result.pieces[0].played).toEqual(1)

      expect(day({rows: [gone]}).state).toEqual("nothing-today")
    })
  })

  describe("the trouble lines", function() {
    let troubles = (rows, extra) => day({rows, ...extra}).pieces[0].troubles

    it("tells a mistake by its beat: a wrong mark at the second note in 3 of 3 passes", function() {
      let rows = [1, 2, 3].map(i => row(3, at(18, i), {clean: 3, marks: [wrong(1)]}))
      let [bar3] = troubles(rows)
      expect(bar3.measure).toEqual(3)
      expect(bar3.text).toEqual("Beat 2 went wrong in all 3 passes")
      expect(bar3.label).toEqual("75%")
    })

    it("says once, some and only passes", function() {
      let words = rows => troubles(rows)[0].text

      expect(words([row(3, at(18), {clean: 3, marks: [wrong(1)]})])).toEqual("Beat 2 went wrong in your only pass")
      expect(words([row(3, at(18), {clean: 3, marks: [wrong(1)]}), row(3, at(19)), row(3, at(20))]))
        .toEqual("Beat 2 went wrong once in 3 passes")
      expect(words([
        row(3, at(18), {clean: 3, marks: [wrong(1)]}), row(3, at(19), {clean: 3, marks: [wrong(1)]}), row(3, at(20)),
      ])).toEqual("Beat 2 went wrong in 2 of 3 passes")
    })

    it("says a skipped note and one that went by unplayed", function() {
      expect(troubles([row(3, at(18), {clean: 3, marks: [wrong(2, "skipped")]})])[0].text)
        .toEqual("Beat 3 was skipped in your only pass")
      expect(troubles([row(3, at(18), {mode: "scroll", clean: 3, marks: [wrong(0, "scrolled")]})])[0].text)
        .toEqual("Beat 1 went by unplayed in your only pass")
    })

    it("adds a second place: \"; also beat 4\"", function() {
      let rows = [
        row(3, at(18), {clean: 2, marks: [wrong(1), wrong(3)]}), row(3, at(19), {clean: 3, marks: [wrong(1)]}),
      ]
      expect(troubles(rows)[0].text).toEqual("Beat 2 went wrong in all 2 passes; also beat 4")
    })

    it("adds a hesitation that is not in the %", function() {
      let rows = [row(3, at(18), {clean: 3, marks: [wrong(1), [2, "hesitated", ["E4"], [], 0, 1800]]})]
      expect(troubles(rows)[0].text).toEqual("Beat 2 went wrong in your only pass · 1 hesitation, not in the %")

      let two = [row(3, at(18), {clean: 3, marks: [wrong(1), [2, "hesitated", ["E4"], [], 0, 1800], [3, "hesitated", ["F4"], [], 0, 1700]]})]
      expect(troubles(two)[0].text).toContain("2 hesitations, not in the %")
    })

    it("names the note's place in the bar when the score has no rhythm", function() {
      let rows = [row(3, at(18), {clean: 3, marks: [wrong(1)], beats: [null, null, null, null]})]
      expect(troubles(rows)[0].text).toEqual("Note 2 of 4 went wrong in your only pass")
    })

    it("says how many passes were clean, and what slipped, for a self-graded bar", function() {
      let rows = [
        selfRow(3, at(18), GOOD), selfRow(3, at(18, 5), AGAIN, {slipped: ["rhythm"]}),
        selfRow(3, at(18, 10), AGAIN, {slipped: ["rhythm", "notes"]}),
      ]
      expect(troubles(rows)[0].text).toEqual("1 of 3 passes clean · slipped: rhythm")
      expect(troubles([selfRow(3, at(18), AGAIN)])[0].text).toEqual("0 of 1 passes clean")
    })

    it("orders the bars by accuracy and cuts them to five, with \"and N more\"", function() {
      let rows = []
      for (let measure = 1; measure <= 7; measure++) {
        let missed = measure % 3 + 1
        rows.push(row(measure, at(18), {clean: 4 - missed, marks: Array.from({length: missed}, (_, i) => wrong(i))}))
      }
      let result = day({rows}).pieces[0]
      let shares = result.troubles.map(t => t.label)

      expect(result.troubles.length).toEqual(TODAY_TROUBLE_ROWS)
      expect(shares).toEqual([...shares].sort((a, b) => parseInt(a) - parseInt(b)))
      expect(result.moreTrouble).toEqual(2)
    })

    it("leaves out a bar played clean", function() {
      let result = day({rows: [row(2, at(18)), row(3, at(18), {clean: 3, marks: [wrong(1)]})]}).pieces[0]
      expect(result.troubles.map(t => t.measure)).toEqual([3])
      expect(result.moreTrouble).toEqual(0)
    })
  })

  describe("what to practise", function() {
    let practise = rows => day({rows}).pieces[0].practise

    it("is the span of the bars under 80%: 75% at 3 and 71% at 9, with 92% at 6 between", function() {
      let rows = [
        row(3, at(18), {clean: 3, marks: [wrong(1)]}),
        row(6, at(18), {columns: 12, clean: 11, beats: Array(12).fill(0), gaps: Array(12).fill(null), iois: Array(12).fill(null), marks: [wrong(1)]}),
        row(9, at(18), {columns: 7, clean: 5, beats: Array(7).fill(0), gaps: Array(7).fill(null), iois: Array(7).fill(null), marks: [wrong(1), wrong(2)]}),
      ]
      let result = practise(rows)
      expect(result.start).toEqual(3)
      expect(result.end).toEqual(9)
      expect(result.label).toEqual("Practise bars 3–9")
      expect(result.note).toEqual("One bar a card, the weakest most often.")
    })

    it("is one bar for one trouble bar, with no line under it", function() {
      let result = practise([row(3, at(18), {clean: 3, marks: [wrong(1)]}), row(4, at(18))])
      expect(result).toEqual({start: 3, end: 3, label: "Practise bar 3", note: null})
    })

    it("has no line when every bar of the span is a trouble bar", function() {
      let result = practise([
        row(3, at(18), {clean: 3, marks: [wrong(1)]}), row(4, at(18), {clean: 3, marks: [wrong(1)]}),
      ])
      expect(result.label).toEqual("Practise bars 3–4")
      expect(result.note).toBe(null)
    })

    it("is nothing with no bar under 80%", function() {
      let rows = [row(2, at(18)), row(3, at(18), {columns: 10, clean: 9, marks: [wrong(1)], beats: Array(10).fill(0), gaps: Array(10).fill(null), iois: Array(10).fill(null)})]
      expect(practise(rows)).toBe(null)
    })
  })

  describe("bars learned today", function() {
    let learned = (items, rows=[row(1, at(18))]) => day({items, rows}).cards.learned

    it("counts a bar whose three clean passes in a row were today's", function() {
      let result = learned([item(1, [clean(at(18)), clean(at(19)), clean(at(20))]), item(2, [clean(at(18))])])
      expect(result.value).toEqual(1)
      expect(result.caption).toEqual("Fixture bar 1")
    })

    it("doesn't count a bar learned yesterday and played clean again today", function() {
      let result = learned([item(1, [
        clean(at(18, 0, 13)), clean(at(19, 0, 13)), clean(at(20, 0, 13)), clean(at(18)),
      ])])
      expect(result.value).toEqual(0)
      expect(result.caption).toEqual("Three clean passes in a row learns a bar")
    })

    it("names a bar learned with one hand alone with its hand", function() {
      let result = learned([item(6, [clean(at(18)), clean(at(19)), clean(at(20))], "lower")])
      expect(result.caption).toEqual("Fixture bar 6, left hand")
      expect(learned([item(6, [clean(at(18)), clean(at(19)), clean(at(20))], "upper")]).caption)
        .toEqual("Fixture bar 6, right hand")
    })

    it("lists the bars of a piece together, and the first six then \"and N more\"", function() {
      let threeClean = [clean(at(18)), clean(at(19)), clean(at(20))]
      let items = [1, 2, 4, 5].map(m => item(m, threeClean))
      expect(learned(items).caption).toEqual("Fixture bars 1, 2, 4, 5")

      let many = [1, 2, 3, 4, 5, 6, 7, 8].map(m => item(m, threeClean))
      let result = learned(many)
      expect(result.value).toEqual(8)
      expect(result.caption).toEqual("Fixture bars 1, 2, 3, 4, 5, 6 and 2 more")
    })

    it("puts a piece's bars apart from another's, joined with a semicolon", function() {
      let threeClean = [clean(at(18)), clean(at(19)), clean(at(20))]
      let result = practiceDay({
        now: NOW, sessions: [], pieces, played: true, goal, exerciseLabel,
        rows: [row(1, at(18)), row(1, at(18), {}, other)],
        items: id => id == fixture.id ? [item(1, threeClean)] :
          [{...item(2, threeClean), id: `${other.id}:both:2-2`, pieceId: other.id}],
      })
      expect(result.cards.learned.caption).toEqual("Fixture bar 1; Other Study bar 2")
    })

    it("marks the learned bar's cell", function() {
      let threeClean = [clean(at(18)), clean(at(19)), clean(at(20))]
      let result = day({items: [item(1, threeClean)], rows: [row(1, at(18)), row(2, at(18))]}).pieces[0]
      expect(result.cells.find(c => c.measure == 1).learned).toBe(true)
      expect(result.cells.find(c => c.measure == 1).ariaLabel).toEqual("Bar 1, 100% today, learned today")
      expect(result.cells.find(c => c.measure == 2).learned).toBe(false)
    })
  })

  describe("the sessions today", function() {
    it("lists them oldest first with their time, minutes and accuracy", function() {
      let result = day({sessions: [
        session("b", at(19, 5), {elapsedSeconds: 20, notesRead: 3, misses: 1}),
        session("a", at(8, 30), {elapsedSeconds: 600, notesRead: 91, misses: 9}),
      ]}).sessions

      expect(result.map(s => s.time)).toEqual(["08:30", "19:05"])
      expect(result.map(s => s.minutes)).toEqual(["10 min", "< 1 min"])
      expect(result.map(s => s.figure)).toEqual([{text: "91%", weak: false}, {text: "75%", weak: true}])
      expect(result[0]).toEqual(jasmine.objectContaining({
        kind: "exercise", title: "Sight reading", italic: "Treble staff", small: "Exercises · Random notes",
      }))
    })

    it("says a free practice session's bars and its cards", function() {
      let free = settings => day({sessions: [pieceSession("p", at(18), {practice: FREE, ...settings})]}).sessions[0]

      expect(free({startMeasure: 1, endMeasure: 8, measuresPerCard: 2})).toEqual(jasmine.objectContaining({
        kind: "piece", title: "Fixture", italic: "bars 1–8", small: "Free practice · 2 bars a card",
      }))
      expect(free({startMeasure: 3, endMeasure: 3, measuresPerCard: 1})).toEqual(jasmine.objectContaining({
        italic: "bar 3", small: "Free practice · 1 bar a card",
      }))
      expect(free({startMeasure: 1, endMeasure: 4, measuresPerCard: WHOLE}).small)
        .toEqual("Free practice · the section as one card")
    })

    it("says today's programme and its passes, once the rows are read", function() {
      let sessions = [pieceSession("s1", at(18), {practice: PROGRAMME})]
      let before = day({sessions, rows: null}).sessions[0]
      expect(before.italic).toEqual("today's programme")
      expect(before.small).toBe(null)

      let rows = [row(1, at(18)), row(2, at(18, 1)), row(2, at(18, 2))]
      expect(day({sessions, rows}).sessions[0].small).toEqual("3 passes")
      expect(day({sessions, rows: [rows[0]]}).sessions[0].small).toEqual("1 pass")
      expect(day({sessions, rows: []}).sessions[0].small).toBe(null)
    })

    it("names the bars played, from the rows, for a session recorded before the ship", function() {
      let sessions = [pieceSession("s1", at(18), {})]
      let result = day({sessions, rows: [row(2, at(18)), row(5, at(18, 1)), row(2, at(18, 2))]}).sessions[0]
      expect(result.italic).toEqual("bars 2–5")
      expect(result.small).toEqual("3 passes")

      expect(day({sessions, rows: null}).sessions[0].italic).toBe(null)
    })

    it("falls back to Song notation for a piece with no title", function() {
      expect(day({sessions: [pieceSession("p", at(18), {pieceTitle: ""})]}).sessions[0].title).toEqual("Song notation")
    })

    it("shows a self-graded session's clean passes, and a dash for neither", function() {
      let result = day({sessions: [
        session("a", at(18), {notesRead: 0, misses: 0, selfGraded: {passes: 4, clean: 3}}),
        session("b", at(19), {notesRead: 0, misses: 0}),
      ]}).sessions
      expect(result.map(s => s.figure.text)).toEqual(["3 of 4 clean", "—"])
    })
  })

  describe("the mistakes", function() {
    it("counts the marks by kind, each a share of all of them", function() {
      let rows = [
        row(2, at(18), {clean: 2, marks: [wrong(0), wrong(1), [2, "hesitated", ["E4"], [], 0, 1500]]}),
        row(3, at(18), {clean: 3, marks: [wrong(1, "skipped")]}),
        row(4, at(18), {mode: "scroll", clean: 3, marks: [wrong(1, "scrolled")]}),
      ]
      let mistakes = day({rows}).mistakes

      expect(mistakes.map(m => [m.label, m.count, m.width])).toEqual([
        ["Wrong notes", 2, 40], ["Skipped", 2, 40], ["Hesitations (not in the %)", 1, 20],
      ])
    })

    it("has none without detected rows, and zero widths when nothing went wrong", function() {
      expect(day({rows: [selfRow(2, at(18), GOOD)]}).mistakes).toBe(null)
      expect(day({rows: [row(2, at(18))]}).mistakes.map(m => m.width)).toEqual([0, 0, 0])
    })
  })

  describe("kept going wrong", function() {
    let habits = (rows, extra) => day({rows, ...extra}).habits

    it("lists a note wrong in two passes and not one wrong once", function() {
      let rows = [
        row(3, at(18), {clean: 3, marks: [wrong(1)]}),
        row(3, at(19), {clean: 2, marks: [wrong(1), [2, "wrong", ["E4"], ["F4"], 1, null]]}),
      ]
      expect(habits(rows)).toEqual([{text: "Bar 3, beat 2", times: "2 times"}])
    })

    it("lists three at most, the most often first and then the latest", function() {
      let twice = measure => [
        row(measure, at(18), {clean: 3, marks: [wrong(1)]}), row(measure, at(19), {clean: 3, marks: [wrong(1)]}),
      ]
      let rows = [
        ...twice(2), ...twice(4), ...twice(5), ...twice(6),
        row(3, at(18, 1), {clean: 3, marks: [wrong(1)]}), row(3, at(19, 1), {clean: 3, marks: [wrong(1)]}),
        row(3, at(20, 1), {clean: 3, marks: [wrong(1)]}),
      ]
      let result = habits(rows)

      expect(result.length).toEqual(3)
      expect(result[0]).toEqual({text: "Bar 3, beat 2", times: "3 times"})
    })

    it("starts with the piece's title only when two pieces have rows today", function() {
      let one = [
        row(3, at(18), {clean: 3, marks: [wrong(1)]}), row(3, at(19), {clean: 3, marks: [wrong(1)]}),
      ]
      expect(habits(one)[0].text).toEqual("Bar 3, beat 2")

      let two = [...one,
        row(1, at(18), {}, other), row(1, at(19), {}, other),
      ]
      expect(habits(two)[0].text).toEqual("Fixture · Bar 3, beat 2")
    })
  })

  describe("the three states", function() {
    it("is first use with no session and no bar played before", function() {
      expect(day({played: false}).state).toEqual("first-use")
    })

    it("is nothing today with yesterday's figures, told as yesterday's line", function() {
      let sessions = [
        session("a", at(18, 0, 13), {elapsedSeconds: 600, notesRead: 90, misses: 10}),
        pieceSession("b", at(19, 0, 13), {}, {elapsedSeconds: 480, notesRead: 90, misses: 10}),
        session("c", at(20, 0, 13), {elapsedSeconds: 120, generator: "sweep", notesRead: 0, misses: 0}),
      ]
      let result = day({sessions})

      expect(result.state).toEqual("nothing-today")
      expect(result.yesterday).toEqual("Yesterday: 20 minutes, Fixture and 2 exercises, 90%.")
      expect(result.lastSeen).toBe(null)
    })

    it("tells yesterday's one piece alone, without an accuracy when no note was read", function() {
      let result = day({sessions: [pieceSession("b", at(19, 0, 13), {}, {elapsedSeconds: 300, notesRead: 0, misses: 0})]})
      expect(result.yesterday).toEqual("Yesterday: 5 minutes, Fixture.")
    })

    it("says when it was last at the bench when yesterday was missed", function() {
      let result = day({sessions: [session("a", at(18, 0, 11))]})
      expect(result.state).toEqual("nothing-today")
      expect(result.yesterday).toBe(null)
      expect(result.lastSeen).toEqual("Last at the bench 3 days ago.")
    })

    it("is nothing today, not first use, once a bar has been played, with no session left", function() {
      expect(day({played: true}).state).toEqual("nothing-today")
    })

    it("is played with a session or a row today, the sessions and cards shown before the rows are read", function() {
      expect(day({sessions: [session("a", at(18))]}).state).toEqual("played")
      expect(day({rows: [row(2, at(18))]}).state).toEqual("played")

      let loading = day({sessions: [session("a", at(18))], rows: null})
      expect(loading.state).toEqual("played")
      expect(loading.loaded).toBe(false)
      expect(loading.pieces).toEqual([])
      expect(day({sessions: [session("a", at(18))]}).loaded).toBe(true)
    })
  })

  describe("the closing line", function() {
    it("says the minutes and the bars learned, and adds the good evening once the goal is met", function() {
      let threeClean = [clean(at(18)), clean(at(19)), clean(at(20))]
      let sessions = [session("a", at(18), {elapsedSeconds: 2040})]

      expect(day({sessions, rows: [row(1, at(18))], items: [item(1, threeClean), item(2, threeClean), item(3, threeClean), item(4, threeClean)]}).closing)
        .toEqual("34 minutes, and 4 bars learned. A good evening at the bench.")
      expect(day({sessions: [session("a", at(18), {elapsedSeconds: 360})]}).closing).toEqual("6 minutes.")
      expect(day({sessions: [session("a", at(18), {elapsedSeconds: 60})]}).closing).toEqual("1 minute.")
    })

    it("is left out with no minutes and no bars learned", function() {
      expect(day({sessions: [session("a", at(18), {elapsedSeconds: 10})]}).closing).toBe(null)
    })
  })

  describe("the strips' minutes", function() {
    it("counts a record once, by its id, when the cache holds it already", function() {
      let cached = [session("a", at(18), {elapsedSeconds: 300}), session("b", at(19), {elapsedSeconds: 600})]
      let record = session("b", at(19), {elapsedSeconds: 660})

      expect(todayMinutes(cached, {now: NOW})).toEqual(15)
      expect(todayMinutes(cached, {now: NOW, record})).toEqual(16)
      expect(todayMinutes(cached.slice(0, 1), {now: NOW, record})).toEqual(16)
      expect(todayMinutes([], {now: NOW, record})).toEqual(11)
    })

    it("counts only the practice day of now", function() {
      let sessions = [session("a", at(3, 30), {elapsedSeconds: 600}), session("b", at(5), {elapsedSeconds: 300})]
      expect(todayMinutes(sessions, {now: NOW})).toEqual(5)
    })

    it("says the goal met, or how far to it", function() {
      expect(todayMinutesWords(15, 10)).toEqual("15 minutes today, goal 10 met")
      expect(todayMinutesWords(10, 10)).toEqual("10 minutes today, goal 10 met")
      expect(todayMinutesWords(6, 10)).toEqual("6 of 10 minutes today")
      expect(todayMinutesWords(1, 1)).toEqual("1 minute today, goal 1 met")
      expect(todayMinutesWords(0, 1)).toEqual("0 of 1 minute today")
      expect(todayMinutesWords(1, 10)).toEqual("1 of 10 minutes today")
    })
  })

  it("starts the day at 4 am", function() {
    expect(new Date(TODAY_START).getHours()).toEqual(4)
  })
})
