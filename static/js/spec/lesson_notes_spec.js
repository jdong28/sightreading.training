import {
  LESSON_TOPICS, newLessonNote, validLessonNote, lessonNoteForPiece, openNotes, notesOnBars,
  answersOnBars, notePins, lastLesson, lessonSince, evidenceOf, readEvidence, lessonView,
  NOTE_MAX_CHARS, DISCUSSED_DAYS,
} from "st/lesson_notes"
import {barReview} from "st/bar_review"
import {itemId} from "st/srs/records"
import {openTestStore} from "spec/helpers"

const NOTE_NAME = /[A-G][#b♯♭]?-?\d/

// a local time, so the spec reads the same in any time zone
const at = (month, day, hour=12) => new Date(2026, month - 1, day, hour).getTime()
const DAY = 24 * 60 * 60 * 1000

// the bar of four crotchets the model reads, a bar log row for each pass
const row = (measure, time, extra={}) => ({
  itemId: `fx:both:${measure}-${measure}`, at: time, pieceId: "fx", hand: "both", measure, sessionId: "s1",
  mode: "wait", card: [measure, measure], cardGrade: 3, columns: 4, clean: 4, grade: 3, reviewed: true,
  beats: [0, 1, 2, 3].map(beat => (measure - 1) * 4 + beat), gaps: [null, 1, 1, 1],
  iois: [null, 500, 500, 500], pulse: 500, marks: [],
  ...extra,
})

// beat 2 of the bar gone wrong
const slipped = (measure, time) => row(measure, time, {
  clean: 3, grade: 2, marks: [[1, "wrong", ["D3", "D5"], ["D#3"], 1, null]],
})

// a score of 16 bars of 4 beats, numbered from 1
const song = (bars=16) => ({
  length: bars * 4,
  metadata: {
    beatsPerMeasure: 4,
    measureStarts: Array.from({length: bars}, (_, idx) => idx * 4),
    measureNumbers: Array.from({length: bars}, (_, idx) => idx + 1),
  },
})

const barItem = (measure, passes, extra={}) => ({
  id: itemId({pieceId: "fx", hand: "both", startMeasure: measure, endMeasure: measure}),
  pieceId: "fx", hand: "both", startMeasure: measure, endMeasure: measure,
  level: "bar", state: "tracked", step: 0, reps: 0, lapses: 0, streak: 0,
  hits: 1, misses: 0, attempts: passes.length, lastPracticed: 1000, recent: [], algo: 0, createdAt: 1,
  passes,
  ...extra,
})

const note = (id, time, extra={}) => ({
  ...newLessonNote({
    source: "bar", pieceId: "fx", pieceTitle: "Fixture", start: 3, end: 3, text: `Question ${id}`, now: time,
  }),
  id, ...extra,
})

describe("notes for the next lesson (st/lesson_notes)", function() {
  describe("a new note", function() {
    it("is open, written now, with an id that starts with n, for each way of writing one", function() {
      let bar = newLessonNote({
        source: "bar", pieceId: "fx", pieceTitle: "Fixture", start: 3, end: 3, hand: "upper", topic: "fingering",
        text: "Why?", evidence: {at: 5000, accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"},
        now: 5000,
      })
      expect(bar).toEqual({
        id: bar.id, pieceId: "fx", pieceTitle: "Fixture", start: 3, end: 3, hand: "upper", topic: "fingering",
        text: "Why?", source: "bar", createdAt: 5000, updatedAt: 5000,
        evidence: {at: 5000, accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"},
        status: "open",
      })
      expect(bar.id).toMatch(/^n[0-9a-z]{7,}$/)
      expect(bar.id.startsWith(`n${(5000).toString(36)}`)).toBe(true)

      let flag = newLessonNote({source: "session", pieceId: "fx", pieceTitle: "Fixture", start: 3, end: 4, now: 6000})
      expect(flag).toEqual(jasmine.objectContaining({
        source: "session", text: "", hand: "both", topic: null, evidence: null, status: "open",
        createdAt: 6000, updatedAt: 6000,
      }))

      let general = newLessonNote({source: "general", text: "Practice habits?", now: 7000})
      expect(general).toEqual(jasmine.objectContaining({
        source: "general", pieceId: null, pieceTitle: null, start: null, end: null, hand: "both",
      }))

      let whole = newLessonNote({source: "general", pieceId: "fx", pieceTitle: "Fixture", text: "How often?", now: 8000})
      expect(whole).toEqual(jasmine.objectContaining({pieceId: "fx", start: null, end: null}))

      for (let made of [bar, flag, general, whole]) { expect(validLessonNote(made)).toBe(true) }
      expect(new Set([bar, flag, general, whole].map(n => n.id)).size).toEqual(4)
    })

    it("tells a valid note from an invalid one", function() {
      let good = note("a", 1000)
      expect(validLessonNote(good)).toBe(true)
      expect(validLessonNote({...good, status: "discussed", discussedAt: 2000, answer: ""})).toBe(true)
      expect(validLessonNote({...good, keptAt: 3000})).toBe(true)
      expect(validLessonNote({...good, topic: "pedal"})).toBe(true)

      for (let bad of [
        null, "note", {...good, id: ""}, {...good, status: "gone"}, {...good, text: 3},
        {...good, text: "x".repeat(NOTE_MAX_CHARS + 1)}, {...good, start: 4, end: 3}, {...good, start: 3.5},
        {...good, start: null, end: 3}, {...good, pieceId: null}, {...good, source: "voice"},
        {...good, hand: "left"}, {...good, topic: "tuning"}, {...good, status: "discussed"},
        {...good, discussedAt: 2000}, {...good, answer: 5}, {...good, keptAt: "now"},
        {...good, evidence: {at: 1}}, {...good, createdAt: "today"},
        {...good, source: "session", start: null, end: null},
      ]) {
        expect(validLessonNote(bad)).withContext(JSON.stringify(bad)).toBe(false)
      }

      expect(LESSON_TOPICS.map(topic => topic.label)).toEqual(
        ["Notes", "Rhythm", "Fingering", "Pedal", "How to practise", "Other"])
    })

    it("is filed under another piece by lessonNoteForPiece, nothing else changed", function() {
      let moved = lessonNoteForPiece(note("a", 1000), "other")
      expect(moved).toEqual({...note("a", 1000), id: moved.id, pieceId: "other"})
    })
  })

  describe("what the record says as a note is written", function() {
    let bar = (measure, rows, passes) => ({
      measure,
      item: barItem(measure, passes),
      review: barReview({rows, item: {attempts: rows.length}, measure, barStart: (measure - 1) * 4, now: 9000}),
    })

    it("gives one bar's accuracy and the worst line in beats, never a note name", function() {
      let rows = [slipped(3, 1000), slipped(3, 2000), slipped(3, 3000)]
      let evidence = evidenceOf({
        bars: [bar(3, rows, [[1000, 4, 3, 2], [2000, 4, 3, 2], [3000, 4, 3, 2]])], now: 9000,
      })

      expect(evidence).toEqual({at: 9000, accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"})
      expect(evidence.line).not.toMatch(NOTE_NAME)
    })

    it("says what a bar never played, and one graded by ear, have", function() {
      let never = {measure: 3, item: null, review: barReview({rows: [], item: null, measure: 3, barStart: 8})}
      expect(evidenceOf({bars: [never], now: 9000})).toBe(null)

      let self = {
        ...row(3, 2000), mode: "self", columns: null, clean: null, grade: 2, slipped: ["notes", "rhythm"],
        beats: undefined, gaps: undefined, iois: undefined, pulse: undefined,
      }
      let acoustic = {
        measure: 3, item: barItem(3, [[2000, null, null, 2]]),
        review: barReview({rows: [self], item: {attempts: 1}, measure: 3, barStart: 8}),
      }
      expect(evidenceOf({bars: [acoustic], now: 9000})).toEqual({
        at: 9000, accuracy: null, line: "You noted: notes, rhythm",
      })
    })

    it("adds up the latest pass of each bar of a range and names the worst bar", function() {
      let bars = [
        bar(3, [slipped(3, 2000), slipped(3, 3000)], [[2000, 4, 3, 2], [3000, 4, 3, 2]]),
        bar(4, [row(4, 3000)], [[3000, 4, 4, 3]]),
      ]
      let evidence = evidenceOf({bars, now: 9000})

      // 3 + 4 clean of 4 + 4 columns
      expect(evidence.accuracy).toEqual(88)
      expect(evidence.line).toEqual("Bar 3: beat 2 went wrong in all 2 of your last passes")
      expect(evidence.line).not.toMatch(NOTE_NAME)

      // a bar of the range never played leaves the others to speak
      let never = {measure: 5, item: null, review: barReview({rows: [], item: null, measure: 5, barStart: 16})}
      expect(evidenceOf({bars: [...bars, never], now: 9000}).accuracy).toEqual(88)

      // every bar right
      let right = [bar(3, [row(3, 3000)], [[3000, 4, 4, 3]]), bar(4, [row(4, 3000)], [[3000, 4, 4, 3]])]
      expect(evidenceOf({bars: right, now: 9000})).toEqual({
        at: 9000, accuracy: 100, line: "Every note right in your last passes",
      })
    })

    it("reads the bar log and items of the store for a range of the piece", async function() {
      let store = await openTestStore()
      try {
        await store.putPiece({id: "fx", title: "Fixture", importedAt: 1, song: {tracks: [], metadata: {}}})
        let item = barItem(3, [[1000, 4, 3, 2], [2000, 4, 3, 2]])
        await store.recordAttempt({
          item, review: {itemId: item.id, at: 2000, pieceId: "fx", kind: "legacy", hits: 1, misses: 0, attempts: 1},
        })
        await store.recordBarLog([slipped(3, 1000), slipped(3, 2000)])

        let evidence = await readEvidence(store, {
          pieceId: "fx", hand: "both", start: 3, end: 3, song: song(), now: 9000,
        })
        expect(evidence).toEqual({at: 9000, accuracy: 75, line: "Beat 2 went wrong in all 2 of your last passes"})
        expect(await readEvidence(store, {pieceId: "fx", hand: "both", start: 5, end: 5, song: song(), now: 9000})).toBe(null)
      } finally {
        await store.close()
      }
    })
  })

  describe("the notes on bars", function() {
    let notes = [
      note("a", 1000, {start: 3, end: 4}),
      note("b", 2000, {start: 4, end: 4}),
      note("c", 3000, {start: 5, end: 5}),
      note("d", 4000, {start: 4, end: 4, status: "dropped"}),
      note("e", 5000, {start: 4, end: 4, text: ""}),
      note("f", 6000, {start: 4, end: 4, pieceId: "other"}),
      note("g", 7000, {start: 4, end: 4, status: "discussed", discussedAt: 7500, answer: "Thumb under."}),
      note("h", 8000, {start: 3, end: 3, status: "discussed", discussedAt: 8500}),
      note("i", 9000, {start: 4, end: 4, status: "discussed", discussedAt: 9500, answer: ""}),
      note("j", 1500, {start: 4, end: 4, status: "discussed", discussedAt: 9900, answer: "Count four."}),
      {...newLessonNote({source: "general", pieceId: "fx", pieceTitle: "Fixture", text: "How often?", now: 3500}), id: "k"},
    ]

    it("lists the open notes with words that overlap the bars, inclusive, newest first", function() {
      let ids = (start, end) => notesOnBars(notes, "fx", start, end).map(n => n.id)
      expect(ids(3, 3)).toEqual(["a"])
      expect(ids(4, 4)).toEqual(["b", "a"])
      expect(ids(4, 5)).toEqual(["c", "b", "a"])
      expect(ids(6, 9)).toEqual([])
      // never a dropped note, a wordless flag, a discussed note or another piece's
      expect(ids(1, 16)).toEqual(["c", "b", "a"])
      expect(notesOnBars(notes, "other", 1, 16).map(n => n.id)).toEqual(["f"])
    })

    it("lists the answers of discussed notes with words, newest discussion first", function() {
      let ids = (start, end) => answersOnBars(notes, "fx", start, end).map(n => n.id)
      expect(ids(4, 4)).toEqual(["j", "g"])
      // an answer left empty isn't an answer, and a note not discussed has none
      expect(ids(3, 3)).toEqual([])
      expect(ids(1, 16)).toEqual(["j", "g"])
    })

    it("pins each open note at its first bar, wordless flags too, and adds the notes up", function() {
      expect(notePins(notes, "fx")).toEqual([{measure: 3, count: 1}, {measure: 4, count: 2}, {measure: 5, count: 1}])
      expect(notePins(notes, "none")).toEqual([])
      expect(notePins([], "fx")).toEqual([])
    })

    it("finds the open notes, the last lesson, and where the since card counts from", function() {
      expect(openNotes(notes).map(n => n.id)).toEqual(["a", "b", "c", "e", "f", "k"])
      expect(lastLesson(notes)).toEqual(9900)
      expect(lastLesson(openNotes(notes))).toBe(null)
      expect(lessonSince(notes)).toEqual(9900)
      expect(lessonSince(openNotes(notes))).toEqual(1000)
      expect(lessonSince([])).toBe(null)
    })
  })

  describe("the lesson view", function() {
    const NOW = at(10, 10)
    const pieces = [{id: "fx", title: "Fixture", song: song()}, {id: "wz", title: "Waltz", song: song(8)}]
    let view = (notes, {items=[], sessions=[], now=NOW}={}) => lessonView({notes, pieces, items, sessions, now})

    it("groups the open notes by piece, the newest note's piece first, bar notes by bar then whole-piece notes, 'Any piece' last", function() {
      let notes = [
        note("a", at(10, 8), {start: 5, end: 5, text: "Later bar"}),
        note("b", at(10, 9), {start: 3, end: 3, text: "Earlier bar"}),
        {...newLessonNote({source: "general", pieceId: "fx", pieceTitle: "Fixture", text: "Whole", now: at(10, 7)}), id: "c"},
        {...newLessonNote({source: "general", text: "Anything", now: at(10, 10)}), id: "d"},
        note("e", at(10, 9, 15), {pieceId: "wz", pieceTitle: "Waltz", text: "Waltz bar"}),
        note("f", at(10, 6), {status: "dropped"}),
        note("g", at(10, 5), {pieceId: "gone", pieceTitle: "Fixture", text: "Orphan"}),
      ]
      let {groups, count} = view(notes)

      expect(count).toEqual(6)
      expect(groups.map(g => g.header)).toEqual([
        "Waltz · 1 open note", "Fixture · 3 open notes", "Fixture (removed) · 1 open note", "Any piece · 1 open note",
      ])
      expect(groups[1].notes.map(n => n.id)).toEqual(["b", "a", "c"])
      expect(groups.map(g => g.key)).toEqual(["wz", "fx", "gone", "any"])

      // a removed piece's note has no bar to engrave or open
      let orphan = groups[2].notes[0]
      expect(orphan.removed).toBe(true)
      expect(orphan.engrave).toBe(null)
      expect(orphan.open).toBe(null)
      expect(groups[2].title).toEqual("Fixture (removed)")

      // a bar of a piece in the library is engraved and opened on the score
      let first = groups[1].notes[0]
      expect(first.engrave).toEqual({pieceId: "fx", measure: 3, hand: "both"})
      expect(first.open).toEqual({pieceId: "fx", bar: 3})
      expect(first.place).toEqual("Bar 3")
      expect(first.placeholder).toEqual("Bar 3")
      expect(groups[1].notes[2].placeholder).toEqual("Whole piece")
      expect(groups[1].notes[2].place).toEqual("Fixture")
      expect(groups[1].notes[2].engrave).toBe(null)
      expect(groups[3].notes[0].place).toEqual("Any piece")
      expect(groups[3].notes[0].open).toBe(null)
    })

    it("labels a note by its topic, hands and day, a flag by where it was made, a kept note by that", function() {
      let notes = [
        note("a", at(10, 9), {topic: "fingering", evidence: null}),
        note("b", at(10, 8), {start: 4, end: 5, hand: "upper", topic: "practice", keptAt: at(10, 9)}),
        {...newLessonNote({source: "session", pieceId: "fx", pieceTitle: "Fixture", start: 6, end: 6, now: at(10, 7)}), id: "c"},
        {...newLessonNote({source: "general", pieceId: "fx", pieceTitle: "Fixture", text: "How many?", topic: "practice", now: at(10, 6)}), id: "d"},
      ]
      let labels = view(notes).groups[0].notes.map(n => [n.id, n.label, n.place, n.wordless])
      expect(labels).toEqual([
        ["a", "Fingering · both hands · 9 Oct", "Bar 3", false],
        ["b", "How to practise · right hand · 8 Oct · kept for next time", "Bars 4–5", false],
        ["c", "Flagged in a session · 7 Oct", "Bar 6", true],
        ["d", "How to practise · 6 Oct", "Fixture", false],
      ])
    })

    it("tells then and now, and the passes over time, from the snapshot and the item under the note's hand", function() {
      let passes = [[at(10, 1), 16, 8, null], [at(10, 2), 16, 7, null], [at(10, 3), 16, 8, null],
        [at(10, 4), 13, 8, null], [at(10, 5), 16, 12, null]]
      let items = [
        barItem(3, passes),
        // the same bar under another hand is not the note's
        {...barItem(3, [[at(10, 5), 4, 4, 3]], {hand: "upper"}), id: "fx:upper:3-3"},
      ]
      let notes = [note("a", at(10, 6), {
        evidence: {at: at(10, 6), accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"},
      })]
      let [shown] = view(notes, {items}).groups[0].notes

      expect(shown.then).toEqual("Then: 75%, beat 2 went wrong in all 3 of your last passes.")
      expect(shown.now).toEqual("Now: 75% latest, 0 of 3 towards learned.")
      expect(shown.over).toEqual("Over time: 50 → 44 → 50 → 62 → 75.")
      for (let words of [shown.then, shown.now, shown.over]) { expect(words).not.toMatch(NOTE_NAME) }

      // a bar not played since is said so, and a note with no snapshot has no Then
      let [unplayed] = view([note("a", at(10, 6), {start: 9, end: 9})]).groups[0].notes
      expect(unplayed.then).toBe(null)
      expect(unplayed.now).toEqual("Now: not played yet.")
      expect(unplayed.over).toBe(null)

      // learned, with three clean passes at the end of the history
      let learned = barItem(3, [[at(10, 1), 4, 3, 2], [at(10, 2), 4, 4, 3], [at(10, 3), 4, 4, 3], [at(10, 4), 4, 4, 3]])
      expect(view(notes, {items: [learned]}).groups[0].notes[0].now).toEqual("Now: 100% latest, learned.")
    })

    it("tells a range's latest accuracy and how many of its bars are learned", function() {
      let clean = [[at(10, 1), 4, 4, 3], [at(10, 2), 4, 4, 3], [at(10, 3), 4, 4, 3]]
      let items = [barItem(3, [[at(10, 3), 5, 4, 2]]), barItem(4, clean)]
      let notes = [note("a", at(10, 6), {start: 3, end: 4})]
      let [shown] = view(notes, {items}).groups[0].notes

      // 4 + 4 clean of 5 + 4 columns
      expect(shown.now).toEqual("Now: 89% latest across bars 3–4, 1 of 2 bars learned.")
      expect(shown.over).toBe(null)
    })

    it("tells a whole piece's practice since the last lesson, from its own sessions", function() {
      let lesson = at(10, 3)
      let session = (day, seconds, piece="fx", generator="sheet music") => ({
        id: `s${day}${piece}`, startedAt: at(10, day), endedAt: at(10, day) + 1000, activeSeconds: seconds,
        elapsedSeconds: seconds, generator, settings: {piece},
      })
      let sessions = [
        session(2, 6000), // before the lesson: not counted
        session(4, 600), session(4, 600), session(6, 600), session(8, 120),
        session(5, 3000, "wz"), // another piece
        session(7, 3000, "fx", "random"), // not sheet music
      ]
      let items = [3, 4, 5].map(measure => barItem(measure, [[at(10, 5), 4, 4, 3], [at(10, 6), 4, 4, 3], [at(10, 7), 4, 4, 3]]))
      let notes = [
        {...newLessonNote({source: "general", pieceId: "fx", pieceTitle: "Fixture", text: "How many?", now: at(10, 4)}), id: "w"},
        note("l", at(10, 1), {status: "discussed", discussedAt: lesson, answer: "Slowly."}),
      ]

      let shown = view(notes, {items, sessions}).groups[0].notes[0]
      // 4, 6 and 8 October; 600 + 600 + 600 + 120 seconds is 32 minutes
      expect(shown.evidence).toEqual("Practised 3 days, 32 minutes, 3 of 16 bars learned.")

      expect(view(notes, {items, sessions: []}).groups[0].notes[0].evidence)
        .toEqual("Not practised since your last lesson.")
      expect(view([notes[0]], {items, sessions: []}).groups[0].notes[0].evidence).toEqual("Not practised yet.")
    })

    it("groups discussed notes by the day of the lesson, the last three days, then and N earlier, with what came since", function() {
      let lesson = (day, id, extra={}) => note(id, at(9, 1), {
        start: 4, end: 4, status: "discussed", discussedAt: at(10, day), answer: `Answer ${id}`, topic: "fingering", ...extra,
      })
      let notes = [
        lesson(2, "a"), lesson(2, "b", {start: 5, end: 5}), lesson(1, "c"), lesson(9, "d", {answer: ""}),
        lesson(5, "e"), lesson(4, "f"), lesson(3, "g"),
        note("o", at(10, 9), {text: "Still open"}),
        note("x", at(10, 9), {status: "dropped"}),
      ]
      // bar 4 learned on 9 October, after the lesson of the 2nd and the 3rd...
      let items = [
        barItem(4, [[at(10, 7), 4, 4, 3], [at(10, 8), 4, 4, 3], [at(10, 9), 4, 4, 3]]),
        barItem(5, [[at(10, 1), 4, 3, 2], [at(10, 3), 4, 3, 2]]),
      ]
      let {discussed, earlier} = view(notes, {items})

      expect(DISCUSSED_DAYS).toEqual(3)
      expect(discussed.map(g => g.label)).toEqual(["Discussed · 9 October", "Discussed · 5 October", "Discussed · 4 October"])
      expect(earlier).toEqual(4)
      expect(discussed[0].notes.map(n => [n.id, n.text, n.answer])).toEqual([["d", "Question d", null]])

      // an answer kept, and what the bar did since: learned on 9 October
      let day9 = view(notes.map(n => n.id == "d" ? {...n, answer: "Count four."} : n), {items}).discussed[0].notes[0]
      expect(day9.answer).toEqual("Count four.")

      let all = view(notes, {items, now: at(10, 10)})
      expect(all.discussed[2].notes[0].since).toEqual("Since then: learned on 9 October.")
      expect(all.discussed[2].notes[0].label).toEqual("Fingering · both hands · discussed 4 Oct")
      expect(all.discussed[0].notes[0].since).toEqual("Since then: learned on 9 October.")

      // a bar played since, not learned: its latest accuracy; played not at all: said so
      let after = view([lesson(2, "z", {start: 5, end: 5})], {items: [barItem(5, [[at(10, 3), 4, 3, 2]])]})
      expect(after.discussed[0].notes[0].since).toEqual("Since then: 75% latest.")
      expect(view([lesson(2, "z", {start: 5, end: 5})], {items: [barItem(5, [[at(10, 1), 4, 3, 2]])]}).discussed[0].notes[0].since)
        .toEqual("Since then: not played.")

      // the open and dropped notes aren't in the discussed list
      expect(all.groups[0].notes.map(n => n.id)).toEqual(["o"])
    })

    it("counts the days, minutes, bars learned and notes since the last lesson", function() {
      let lesson = at(10, 3)
      let session = (day, seconds) => ({
        id: `s${day}`, startedAt: at(10, day), endedAt: at(10, day) + 1, activeSeconds: seconds,
        elapsedSeconds: seconds, generator: "sheet music", settings: {piece: "fx"},
      })
      // 52 minutes in all
      let sessions = [session(4, 1200), session(5, 1020), session(6, 900)]
      let items = [
        // learned since the lesson: bars 3 and 4 under both hands, which count once, and 6 under the left
        barItem(3, [[at(10, 1), 4, 3, 2], [at(10, 5), 4, 4, 3], [at(10, 6), 4, 4, 3], [at(10, 7), 4, 4, 3]]),
        {...barItem(3, [[at(10, 5), 4, 4, 3], [at(10, 6), 4, 4, 3], [at(10, 7), 4, 4, 3]], {hand: "upper"}), id: "fx:upper:3-3"},
        barItem(4, [[at(10, 5), 4, 4, 3], [at(10, 6), 4, 4, 3], [at(10, 7), 4, 4, 3]]),
        {...barItem(6, [[at(10, 5), 4, 4, 3], [at(10, 6), 4, 4, 3], [at(10, 7), 4, 4, 3]], {hand: "lower"}), id: "fx:lower:6-6"},
        // learned before the lesson: not counted
        barItem(8, [[at(10, 1), 4, 4, 3], [at(10, 2), 4, 4, 3], [at(10, 2, 13), 4, 4, 3]]),
        // a bar's range of several bars is no bar
        {...barItem(9, [[at(10, 5), 4, 4, 3], [at(10, 6), 4, 4, 3], [at(10, 7), 4, 4, 3]], {endMeasure: 10}), id: "fx:both:9-10"},
      ]
      let notes = [
        note("l", at(10, 1), {status: "discussed", discussedAt: lesson, answer: "Slowly."}),
        note("a", at(10, 5)), note("b", at(10, 6), {start: 5, end: 5}),
      ]
      let {since} = view(notes, {items, sessions, now: at(10, 10)})

      expect(since).toEqual({
        label: "Since your last lesson", days: 7, daysWords: "days",
        detail: "52 minutes · 3 bars learned · 2 notes",
      })

      // with no lesson yet, from the oldest open note
      let first = view(notes.slice(1), {items, sessions, now: at(10, 10)}).since
      expect(first.label).toEqual("Before your first lesson")
      expect(first.days).toEqual(5)
      // the sessions of the 5th and 6th
      expect(first.detail).toEqual("32 minutes · 3 bars learned · 2 notes")

      let one = view([note("a", at(10, 9))], {now: at(10, 10)}).since
      expect([one.days, one.daysWords, one.detail]).toEqual([1, "day", "0 minutes · 0 bars learned · 1 note"])
    })

    it("is empty with no open and no discussed notes, and counts the open ones", function() {
      expect(view([])).toEqual({count: 0, empty: true, since: null, groups: [], discussed: [], earlier: 0})
      expect(view([note("x", 1000, {status: "dropped"})]).empty).toBe(true)

      let only = view([note("a", at(10, 9), {status: "discussed", discussedAt: at(10, 9), answer: ""})])
      expect(only.empty).toBe(false)
      expect(only.count).toEqual(0)
      expect(only.groups).toEqual([])

      let both = view([note("a", at(10, 9)), note("b", at(10, 9), {start: 4, end: 4})])
      expect(both.empty).toBe(false)
      expect(both.count).toEqual(2)
    })
  })
})
