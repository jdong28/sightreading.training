import MersenneTwister from "mersennetwister"

import {
  planNext, planState, planSummary, anchoredCard, mostOverduePiece, inStudy,
  entryStatus, entryCaption,
  RETRY, LADDER, REVIEW, NEW, EARLY, RUN_THROUGH, WAIT, LADDER_CAP, IDLE_LADDER_CAP,
} from "st/srs/planner"
import {
  applyGrade, DEFAULT_SCHEDULER_SETTINGS, DEFAULT_PRACTICE_SETTINGS,
  SCHEDULER_ALGO, DAY, MINUTE,
} from "st/srs/schedule"
import {newItem, itemId, RECENT_ATTEMPTS} from "st/srs/records"
import {PlanDeck, PlanGenerator} from "st/plan_cards"
import {MeasureCardGenerator, COLUMN_JOIN_KEYS} from "st/measure_cards"
import {
  SHEET_MUSIC_GENERATOR, BOTH_HANDS, PROGRAMME_PRACTICE, FREE_PRACTICE, WHOLE_SECTION,
  plannedPractice, programmeOffered, drilledRange, PLAN_CARD_MEASURES,
} from "st/data"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"

import {openTestStore, pickupScore} from "spec/helpers"

const AGAIN = 1, HARD = 2, GOOD = 3

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
        now = NOW + day * DAY
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
          let next = applyGrade(stored, grade, now, settings)
          next = {
            ...next, lastPracticed: now, attempts: stored.attempts + 1,
            recent: [...stored.recent, [now, 4, grade >= 3 ? 4 : 2, grade]].slice(-RECENT_ATTEMPTS),
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

    it("makes the programme the default in study", function() {
      expect(inStudy(null)).toBe(false)
      expect(inStudy({pieceId: "p", status: "learning", startedAt: 0})).toBe(true)
      expect(inStudy({pieceId: "p", status: "shelved", startedAt: 0})).toBe(false)
    })
  })
})

const grand = {name: "grand", range: ["C2", "C6"]}

// plays the head column like the sight reading page does on a hit
let hit = (notes, stats) => {
  let column = notes.currentColumn()
  notes = notes.clone()
  notes.shift()
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
  let pool = () => {
    let settings = {piece: piece.id, song: "", startMeasure: 0, endMeasure: 2, hand: BOTH_HANDS}
    let generator = SHEET_MUSIC_GENERATOR.create(grand, null, {...settings, practice: FREE_PRACTICE, measuresPerCard: 1})
    generator.stop()
    return generator.cards.map(card => ({number: card.startMeasure, columns: card.columns}))
  }

  let generatorFor = (cardMeasures=2) => {
    let deck = new PlanDeck(pool(), {pieceId: piece.id, cardMeasures, store, now: () => time})
    let generator = new PlanGenerator(deck, {now: () => time})
    generators.push(generator)
    let notes = new NoteList([], {generator})
    notes.fillBuffer(8)
    return {deck, generator, notes}
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

  it("keeps the generator contract the staff and ScoreCard rely on", function() {
    let {deck, generator, notes} = generatorFor()
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
    let {deck, generator, notes} = generatorFor()
    let stats = new NoteStats()

    notes = await playCard({generator, notes}, stats)

    // measures 0 and 1 are scheduled, as the planner foresaw; measure 2 is new
    let anchor = store.item(`${piece.id}:both:0-0`)
    expect(generator.caption()).toEqual(entryCaption(anchor, time))
    expect(generator.caption()).not.toBe(null)
    expect(deck.entry).toEqual(jasmine.objectContaining({reason: NEW, measure: 2}))
    expect(generator.currentCard().measures).toEqual([1, 2])
    expect(notesOf(notes).slice(0, 5)).toEqual([["G3", "G4"], ["A4"], ["B4"], ["C3", "E3", "G3", "C5"], []])

    let bars = store.items(piece.id).filter(item => item.startMeasure == item.endMeasure)
    expect(bars.map(item => item.startMeasure).sort()).toEqual([0, 1])
    expect(bars.every(item => item.due > time)).toBe(true)

    // the piece is in study
    expect(store.study(piece.id)).toEqual(jasmine.objectContaining({status: "learning", startedAt: time}))
  })

  it("brings a failed measure back at once", async function() {
    let {deck, generator, notes} = generatorFor(1)
    let stats = new NoteStats()

    // a slip on the pickup's only column, then the hit
    stats.missNotes(["D5"])
    notes = await playCard({generator, notes}, stats)

    expect(deck.entry).toEqual(jasmine.objectContaining({reason: RETRY, measure: 0}))
    expect(generator.statusLine()).toEqual("Once more · bar 0")
    expect(generator.caption()).toEqual("again in a moment")
    expect(notesOf(notes).slice(0, 2)).toEqual([["D5"], []])
  })

  it("resumes the same queue from the store after a reload", async function() {
    let first = generatorFor(1)
    let stats = new NoteStats()
    for (let i = 0; i < 3; i++) {
      first.notes = await playCard(first, stats)
    }

    let entry = first.deck.entry
    let reloaded = generatorFor(1)
    expect(reloaded.deck.entry).toEqual(entry)
  })

  it("marks the piece maintaining once every measure is scheduled", async function() {
    let {generator, notes} = generatorFor(3)
    notes = await playCard({generator, notes}, new NoteStats())
    expect(store.study(piece.id).status).toEqual("maintaining")
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

    it("plays the whole piece in the programme and the section in free practice", async function() {
      await store.putStudy({pieceId: piece.id, status: "learning", startedAt: NOW})

      let planned = SHEET_MUSIC_GENERATOR.create(grand, null, settingsFor())
      generators.push(planned)
      expect(planned instanceof PlanGenerator).toBe(true)
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
