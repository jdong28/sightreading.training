import MersenneTwister from "mersennetwister"

import {
  measureCards, sectionCard, cardColumn, cardWeights, nextCardIndex,
  MeasureCardDeck, MeasureCardGenerator, IN_ORDER, RANDOM_ORDER
} from "st/measure_cards"

import {SheetMusicGenerator, generatorDefaultSettings, fixGeneratorSettings} from "st/generators"
import {
  SHEET_MUSIC_GENERATOR, sheetMusicSection, BOTH_HANDS, RIGHT_HAND, WHOLE_SECTION, SHEET_MUSIC_STORAGE_KEY,
  sheetMusicMeasureBounds, sheetMusicSectionRange, sheetMusicSectionUpdate, sheetMusicSectionLength,
} from "st/data"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"
import {AGAIN, HARD, GOOD, EASY} from "st/srs/grade"
import {newItem} from "st/srs/records"
import {predictedRecall, UNSCHEDULED_RECALL, DEFAULT_SCHEDULER_SETTINGS, DAY} from "st/srs/schedule"

import {openTestStore, pickupScore, noteXML} from "spec/helpers"

const grand = {name: "grand", range: ["C2", "C6"]}

// the measures of pickupScore on the grand staff
const pickupMeasures = () => [
  {number: 0, columns: [["D5"]]},
  {number: 1, columns: [["G3", "G4"], ["A4"], ["B4"]]},
  {number: 2, columns: [["C3", "E3", "G3", "C5"]]},
]

// the notes of columns, without what cardColumn copies onto them
const notesOf = columns => [...columns].map(column => [...column])

const emptyStore = {sectionStats: () => [], recordSectionPractice: async () => {}}

// plays the head column like the sight reading page does on a hit
let hit = (notes, stats) => {
  let column = notes.currentColumn()
  notes = notes.clone()
  notes.shift()
  notes.pushRandom()
  stats.hitNotes(column)
  return notes
}

// scrolls past the head column without playing it, like the skip hotkey
let skip = notes => {
  notes = notes.clone()
  notes.shift()
  notes.pushRandom()
  return notes
}

describe("measure cards", function() {
  describe("cards", function() {
    it("groups the pool into cards of contiguous measures, pickup and short last card included", function() {
      let cards = measureCards(pickupMeasures(), 2)

      expect(cards).toEqual([
        {
          startMeasure: 0, endMeasure: 1, measures: [0, 1],
          columns: [["D5"], ["G3", "G4"], ["A4"], ["B4"]],
          columnMeasures: [0, 1, 1, 1],
        },
        {
          startMeasure: 2, endMeasure: 2, measures: [2],
          columns: [["C3", "E3", "G3", "C5"]],
          columnMeasures: [0],
        },
      ])
    })

    it("makes a card per measure by default and takes any card size", function() {
      expect(measureCards(pickupMeasures(), 1).map(c => c.measures)).toEqual([[0], [1], [2]])
      expect(measureCards(pickupMeasures(), 0).map(c => c.measures)).toEqual([[0], [1], [2]])
      expect(measureCards(pickupMeasures(), 50).map(c => c.measures)).toEqual([[0, 1, 2]])
      expect(measureCards([], 2)).toEqual([])
    })

    it("groups a longer section into cards of the size asked for", function() {
      let measures = Array.from({length: 7}, (_, idx) => ({number: idx, columns: [["C4"]]}))
      expect(measureCards(measures, 5).map(c => c.measures)).toEqual([
        [0, 1, 2, 3, 4], [5, 6],
      ])
      expect(measureCards(measures, 50).map(c => c.measures)).toEqual([
        [0, 1, 2, 3, 4, 5, 6],
      ])
    })

    it("copies each column with what an engine's card joins it by and its place in the card", function() {
      let measures = [...pickupMeasures(), {number: 3, columns: []}, {number: 4, columns: [["F5"]]}]
      let notation = [{type: "quarter", voice: 1}]
      measures[4].columns[0].beat = 12
      measures[4].columns[0].notation = notation
      let card = sectionCard(measures)
      expect(card.measures).toEqual([0, 1, 2, 3, 4])

      let columns = card.columns.map((column, idx) => cardColumn(card, idx))
      expect(notesOf(columns)).toEqual(notesOf(card.columns))
      expect(columns.map(column => column.cardIndex)).toEqual([0, 1, 2, 3, 4, 5])
      expect([columns[5].beat, columns[5].notation]).toEqual([12, notation])
      expect(columns[0].beat).toBeUndefined()
    })

  })

  describe("picking", function() {
    let cards = () => measureCards(pickupMeasures(), 1)

    it("walks the cards in order and wraps, skipping cards without notes", function() {
      let all = cards()
      all[1].columns = []

      let seen = []
      let idx = null
      for (let i = 0; i < 5; i++) {
        idx = nextCardIndex(all, idx, {order: IN_ORDER})
        seen.push(idx)
      }

      expect(seen).toEqual([0, 2, 0, 2, 0])
      expect(nextCardIndex([], null, {order: IN_ORDER})).toBe(null)
    })

    it("never picks the card just shown at random", function() {
      let mt = new MersenneTwister(42)
      let random = () => mt.random()
      let all = cards()

      let idx = null
      let seen = new Set()
      for (let i = 0; i < 300; i++) {
        let next = nextCardIndex(all, idx, {order: RANDOM_ORDER, weights: [1, 5, 1], random})
        expect(next).not.toEqual(idx)
        seen.add(next)
        idx = next
      }

      expect([...seen].sort()).toEqual([0, 1, 2])
    })

    it("repeats the only card with notes", function() {
      let all = cards()
      all[0].columns = []
      all[2].columns = []

      expect(nextCardIndex(all, 1, {order: RANDOM_ORDER, random: () => 0.5})).toEqual(1)
    })

    it("picks cards in proportion to their weights", function() {
      let mt = new MersenneTwister(7)
      let random = () => mt.random()
      let all = cards()
      let counts = [0, 0, 0]
      let picks = 6000

      for (let i = 0; i < picks; i++) {
        counts[nextCardIndex(all, null, {order: RANDOM_ORDER, weights: [1, 3, 1], random})] += 1
      }

      expect(counts[0] / picks).toBeCloseTo(0.2, 1)
      expect(counts[1] / picks).toBeCloseTo(0.6, 1)
      expect(counts[2] / picks).toBeCloseTo(0.2, 1)

      // the card just shown is left out, the others keep their proportions
      counts = [0, 0, 0]
      for (let i = 0; i < picks; i++) {
        counts[nextCardIndex(all, 0, {order: RANDOM_ORDER, weights: [1, 3, 1], random})] += 1
      }

      expect(counts[0]).toEqual(0)
      expect(counts[1] / picks).toBeCloseTo(0.75, 1)
      expect(counts[2] / picks).toBeCloseTo(0.25, 1)
    })

    it("weights cards weakest first by their measures' items", function() {
      let now = 100 * DAY
      let measure = (startMeasure, fields={}) => ({
        ...newItem({pieceId: "p", startMeasure, endMeasure: startMeasure}), ...fields,
      })
      // known a day ago, recall a little under the target
      let known = measure(1, {state: "review", s: 10, d: 5, last: now - DAY, due: now + 9 * DAY})
      let recall = predictedRecall(known, now)
      expect(recall).toBeGreaterThan(0.98)
      expect(recall).toBeLessThan(1)

      let items = [
        known,
        // failed just now, never scheduled
        measure(0, {recent: [[now, 4, 2, 1]]}),
        // another hand's item, and a range, aren't the measure's
        measure(2, {hand: "upper", state: "review", s: 1, d: 5, last: now - 50 * DAY, due: now}),
        {...measure(0), endMeasure: 2, recent: [[now, 4, 0, 1]]},
      ]

      expect(cardWeights(measureCards(pickupMeasures(), 1), items, {now})).toEqual([
        1 + 4 * (1 - UNSCHEDULED_RECALL) + 1,
        1 + 4 * (1 - recall),
        1 + 4 * (1 - UNSCHEDULED_RECALL),
      ])

      // a card weighs the mean of its measures
      let [first, second] = cardWeights(measureCards(pickupMeasures(), 1), items, {now})
      expect(cardWeights(measureCards(pickupMeasures(), 2), items, {now})[0]).toBeCloseTo((first + second) / 2, 9)

      // untouched pieces weigh every measure the same
      expect(cardWeights(measureCards(pickupMeasures(), 1), [], {now})).toEqual([2, 2, 2])
    })

    it("picks random cards by the items in the store", function() {
      let now = 100 * DAY
      let measure = (startMeasure, fields) => ({
        ...newItem({pieceId: "p", startMeasure, endMeasure: startMeasure}), state: "review", ...fields,
      })
      let store = {
        items: pieceId => pieceId == "p" ? [
          // two known measures, played clean just now
          measure(0, {s: 30, d: 3, last: now, due: now + 30 * DAY}),
          measure(1, {s: 30, d: 3, last: now, due: now + 30 * DAY}),
          // one likely forgotten, and missed when last played
          measure(2, {s: 0.5, d: 9, last: now - 60 * DAY, due: now - 59 * DAY, recent: [[now - 60 * DAY, 3, 0, 1]]}),
        ] : [],
        schedulerSettings: () => DEFAULT_SCHEDULER_SETTINGS,
      }

      let mt = new MersenneTwister(3)
      let deck = new MeasureCardDeck(cards(), {
        pieceId: "p", order: RANDOM_ORDER, random: () => mt.random(), now: () => now, store,
      })

      let seen = [deck.index]
      for (let i = 0; i < 20; i++) {
        deck.advance()
        seen.push(deck.index)
      }

      // nearly every other card is the measure likeliest forgotten, more
      // often than either known one
      let count = card => seen.filter(idx => idx == card).length
      expect(count(2)).toBeGreaterThanOrEqual(8)
      expect(count(2)).toBeGreaterThan(Math.max(count(0), count(1)))
    })
  })

  describe("deck", function() {
    it("walks the cards in order and wraps", function() {
      let deck = new MeasureCardDeck(measureCards(pickupMeasures(), 2), {
        pieceId: "p", order: IN_ORDER, store: emptyStore,
      })

      expect(deck.card.measures).toEqual([0, 1])
      deck.advance()
      expect(deck.card.measures).toEqual([2])
      deck.advance()
      expect(deck.card.measures).toEqual([0, 1])
    })
  })

  describe("generator", function() {
    let generators
    let track = generator => {
      generators.push(generator)
      return generator
    }

    beforeEach(function() {
      generators = []
    })

    afterEach(function() {
      generators.forEach(g => g.stop())
    })

    it("shows one card, then the next once its last column is done", function() {
      let deck = new MeasureCardDeck(measureCards(pickupMeasures(), 2), {
        pieceId: "p", order: IN_ORDER, store: emptyStore,
      })

      let stats = new NoteStats()
      let notes = new NoteList([], {generator: track(new MeasureCardGenerator(deck))})
      notes.fillBuffer(6)

      expect(notesOf(notes)).toEqual([["D5"], ["G3", "G4"], ["A4"], ["B4"], [], []])

      notes = hit(notes, stats)
      notes = hit(notes, stats)
      notes = hit(notes, stats)
      expect(notesOf(notes)).toEqual([["B4"], [], [], [], [], []])

      notes = hit(notes, stats)
      expect(deck.card.measures).toEqual([2])
      expect(notesOf(notes)).toEqual([["C3", "E3", "G3", "C5"], [], [], [], [], []])

      notes = hit(notes, stats)
      expect(deck.card.measures).toEqual([0, 1])
      expect(notesOf(notes)).toEqual([["D5"], ["G3", "G4"], ["A4"], ["B4"], [], []])
    })

    it("loops a card covering the whole pool like the plain sheet music drill", function() {
      let deck = new MeasureCardDeck(measureCards(pickupMeasures(), 3), {
        pieceId: "p", order: IN_ORDER, store: emptyStore,
      })

      let cardNotes = new NoteList([], {generator: track(new MeasureCardGenerator(deck))})
      let plainNotes = new NoteList([], {generator: new SheetMusicGenerator(deck.card.columns)})
      cardNotes.fillBuffer(10)
      plainNotes.fillBuffer(10)

      let stats = new NoteStats()
      for (let i = 0; i < 10; i++) {
        expect(notesOf(cardNotes)).toEqual(notesOf(plainNotes))
        cardNotes = hit(cardNotes, stats)
        plainNotes = skip(plainNotes)
      }

      expect(deck.card.measures).toEqual([0, 1, 2])
    })

    describe("measure stats", function() {
      let store, time

      beforeEach(async function() {
        store = await openTestStore()
        time = 0
      })

      afterEach(async function() {
        await store.close()
      })

      let generatorFor = () => {
        let deck = new MeasureCardDeck(measureCards(pickupMeasures(), 2), {
          pieceId: "p", order: IN_ORDER, store,
        })

        let generator = track(new MeasureCardGenerator(deck, {now: () => time}))
        let notes = new NoteList([], {generator})
        notes.fillBuffer(6)
        return {generator, notes}
      }

      // the single measure rows of the piece, by measure
      let measureStats = () => store.sectionStats("p")
        .filter(s => s.startMeasure == s.endMeasure)
        .sort((a, b) => a.startMeasure - b.startMeasure)

      it("adds the hits, misses and time on each measure of a finished card", async function() {
        let {generator, notes} = generatorFor()
        let stats = new NoteStats()

        time = 1000
        stats.missNotes(["D5"])
        time = 1500
        notes = hit(notes, stats)
        time = 2500
        notes = hit(notes, stats)
        time = 3000
        stats.missNotes(["A4"])
        time = 3500
        notes = hit(notes, stats)

        // nothing is written before the card is done
        await Promise.resolve()
        expect(store.sectionStats("p")).toEqual([])

        time = 4000
        notes = hit(notes, stats)
        await generator.finishing

        expect(measureStats()).toEqual([
          {pieceId: "p", startMeasure: 0, endMeasure: 0, hits: 1, misses: 1, attempts: 1, lastPracticed: 4000, elapsedMs: 1500},
          {pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 3, misses: 1, attempts: 1, lastPracticed: 4000, elapsedMs: 2500},
        ])
        // and the card's own range
        expect(store.sectionStats("p").find(s => s.endMeasure == 1 && s.startMeasure == 0).hits).toEqual(4)

        // a long pause on a column isn't counted
        time = 4000 + 10 * 60 * 1000
        notes = hit(notes, stats)
        await generator.finishing

        expect(measureStats().find(s => s.startMeasure == 2)).toEqual(
          {pieceId: "p", startMeasure: 2, endMeasure: 2, hits: 1, misses: 0, attempts: 1, lastPracticed: time, elapsedMs: 0}
        )

        // the reloaded store has them too
        let reopened = await openTestStore({keep: true})
        expect(reopened.sectionStats("p").length).toEqual(4)
        await reopened.close()
      })

      it("grades each pass through a card as a review of the card and of each of its measures", async function() {
        let {generator, notes} = generatorFor()
        let stats = new NoteStats()

        time = 1000
        stats.missNotes(["D5"])
        time = 1500
        notes = hit(notes, stats)
        for (let t of [2000, 2500, 3000]) {
          time = t
          notes = hit(notes, stats)
        }
        await generator.finishing

        let reviews = await store.reviews({pieceId: "p"})
        expect(reviews.map(r => [r.itemId, r.grade, r.columns, r.clean, r.sessionId])).toEqual([
          ["p:both:0-0", AGAIN, 1, 0, stats.id],
          ["p:both:0-1", HARD, 4, 3, stats.id],
          ["p:both:1-1", EASY, 3, 3, stats.id],
        ])
        expect(reviews.every(r => r.at == 3000 && r.kind == "attempt" && r.mode == "wait" && r.was == "new")).toBe(true)
        expect(reviews[1].bars).toEqual([[0, 1, 0, 1, 1500], [1, 3, 3, 0, 1500]])
        expect(reviews[1].leadMs).toEqual(1500)
      })

      it("records nothing for a card only skipped through", async function() {
        let {generator, notes} = generatorFor()

        for (let i = 0; i < 4; i++) {
          time += 1000
          notes = skip(notes)
        }
        await generator.finishing

        expect(generator.deck.card.measures).toEqual([2])
        expect(store.sectionStats("p")).toEqual([])
        expect(await store.reviews({pieceId: "p"})).toEqual([])
      })

      it("grades a skipped column as again", async function() {
        let {generator, notes} = generatorFor()
        let stats = new NoteStats()

        time = 1000
        notes = hit(notes, stats)
        notes = skip(notes)
        notes = hit(notes, stats)
        notes = hit(notes, stats)
        await generator.finishing

        let reviews = await store.reviews({pieceId: "p"})
        expect(reviews.map(r => [r.itemId, r.grade, r.skipped])).toEqual([
          ["p:both:0-0", EASY, 0],
          ["p:both:0-1", AGAIN, 1],
          ["p:both:1-1", AGAIN, 1],
        ])
      })

      it("counts every slip for the grade and a column missed once for the totals", async function() {
        let {generator, notes} = generatorFor()
        let stats = new NoteStats()

        time = 1000
        notes = hit(notes, stats)
        stats.missNotes(["G3", "G4"])
        stats.slipNotes(["G3", "G4"])
        stats.slipNotes(["G4"])
        notes = hit(notes, stats)
        notes = hit(notes, stats)
        notes = hit(notes, stats)
        await generator.finishing

        let reviews = await store.reviews({pieceId: "p"})
        let bar = reviews.find(r => r.itemId == "p:both:1-1")
        expect([bar.grade, bar.misses, bar.stuck, bar.trouble]).toEqual([AGAIN, 3, 1, [0]])
        expect(measureStats()[1].misses).toEqual(1)
        expect(stats.misses).toEqual(1)
      })

      it("times the first column from when it is shown, and grades one lap of a single measure card once", async function() {
        let deck = new MeasureCardDeck(measureCards([pickupMeasures()[1]], 1), {
          pieceId: "p", order: IN_ORDER, store,
        })

        let generator = track(new MeasureCardGenerator(deck, {now: () => time}))
        let notes = new NoteList([], {generator})
        let stats = new NoteStats()

        time = 1000
        notes.fillBuffer(6)
        time = 1600
        notes = hit(notes, stats)
        time = 1800
        stats.missNotes(["A4"])
        time = 2000
        notes = hit(notes, stats)
        time = 3000
        notes = hit(notes, stats)
        await generator.finishing

        expect(store.sectionStats("p")).toEqual([
          {pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 3, misses: 1, attempts: 1, lastPracticed: 3000, elapsedMs: 2000},
        ])

        let reviews = await store.reviews({pieceId: "p"})
        expect(reviews.map(r => [r.itemId, r.leadMs, r.grade])).toEqual([["p:both:1-1", 600, AGAIN]])
      })

      it("writes one review a lap of a looping card", async function() {
        let deck = new MeasureCardDeck(measureCards(pickupMeasures(), 3), {
          pieceId: "p", order: IN_ORDER, store,
        })
        let generator = track(new MeasureCardGenerator(deck, {now: () => time}))
        let notes = new NoteList([], {generator})
        notes.fillBuffer(6)
        let stats = new NoteStats()

        for (let lap = 0; lap < 2; lap++) {
          for (let i = 0; i < 5; i++) {
            time += 500
            notes = hit(notes, stats)
          }
        }
        // a lap begun is not written
        time += 500
        notes = hit(notes, stats)
        await generator.finishing

        let reviews = await store.reviews({pieceId: "p"})
        expect(reviews.filter(r => r.itemId == "p:both:0-2").map(r => [r.at, r.was, r.grade]))
          .toEqual([[2500, "new", EASY], [5000, "tracked", EASY]])
        expect(reviews.length).toEqual(8)

        let items = store.items("p")
        expect(items.find(item => item.id == "p:both:0-2").recent.map(entry => entry[0])).toEqual([2500, 5000])
        expect(items.find(item => item.id == "p:both:0-0").hits).toEqual(2)
      })

      it("abandons a pass for the page, never grading the rest of its card", async function() {
        let {generator, notes} = generatorFor()
        generator.setDrill(() => ({mode: "wait"}))
        let stats = new NoteStats()

        // nothing played yet: the pass is kept, timed from now
        time = 5000
        expect(generator.takePractice()).toEqual([])

        time = 6000
        notes = hit(notes, stats)
        time = 6500
        stats.missNotes(["G3", "G4"])
        expect(generator.takePractice()).toEqual([
          {pieceId: "p", hand: "both", startMeasure: 0, endMeasure: 1, hits: 1, misses: 1, elapsedMs: 1000, at: 6500},
          {pieceId: "p", hand: "both", startMeasure: 0, endMeasure: 0, hits: 1, misses: 0, elapsedMs: 1000, at: 6500},
          {pieceId: "p", hand: "both", startMeasure: 1, endMeasure: 1, hits: 0, misses: 1, elapsedMs: 0, at: 6500},
        ])

        // the rest of the card adds to the totals alone
        for (let t of [7000, 7500, 8000]) {
          time = t
          notes = hit(notes, stats)
        }
        await generator.finishing
        expect(await store.reviews({pieceId: "p"})).toEqual([])
        expect(measureStats().map(s => [s.startMeasure, s.hits])).toEqual([[1, 3]])

        // the next card is graded
        time = 9000
        notes = hit(notes, stats)
        await generator.finishing
        expect((await store.reviews({pieceId: "p"})).map(r => r.itemId)).toEqual(["p:both:2-2"])
      })

      it("grades a pass by the drill it is played in, never one changing mode", async function() {
        let {generator, notes} = generatorFor()
        let drill = {mode: "wait"}
        generator.setDrill(() => drill)
        let stats = new NoteStats()

        // the first card changes mode half way through
        for (let i = 0; i < 4; i++) {
          if (i == 2) { drill = {mode: "scroll", speed: 25} }
          time += 500
          notes = hit(notes, stats)
        }
        await generator.finishing
        expect(await store.reviews({pieceId: "p"})).toEqual([])
        expect(measureStats().map(s => [s.startMeasure, s.hits])).toEqual([[0, 1], [1, 3]])

        time += 500
        notes = hit(notes, stats)
        await generator.finishing

        let reviews = await store.reviews({pieceId: "p"})
        expect(reviews.map(r => [r.itemId, r.mode, r.speed, r.grade])).toEqual([
          ["p:both:2-2", "scroll", 25, GOOD],
        ])
      })
    })
  })

  describe("sheet music generator", function() {
    const sheetMusic = SHEET_MUSIC_GENERATOR
    const input = name => sheetMusic.inputs.find(i => i.name == name)

    let store, previousStore, piece, generator

    beforeEach(async function() {
      store = await openTestStore()
      previousStore = setAppStore(store)
      piece = (await importMusicXMLPiece("minuet.musicxml", pickupScore(), store)).piece
      generator = null
    })

    afterEach(async function() {
      if (generator && generator.stop) {
        generator.stop()
      }
      setAppStore(previousStore)
      await store.close()
    })

    let settingsFor = extra => ({
      piece: piece.id, song: "", startMeasure: 0, endMeasure: 2,
      hand: BOTH_HANDS, measuresPerCard: 2, order: IN_ORDER, ...extra,
    })

    it("offers card size and order only for a piece from the library", function() {
      expect(input("measuresPerCard").visible(settingsFor())).toBe(true)
      expect(input("order").visible(settingsFor())).toBe(true)
      expect(input("measuresPerCard").visible(settingsFor({piece: ""}))).toBe(false)
      expect(input("order").visible(settingsFor({piece: ""}))).toBe(false)
      // the whole section is always played in order, so it offers no choice
      expect(input("order").visible(settingsFor({measuresPerCard: WHOLE_SECTION}))).toBe(false)
      expect(input("order").values.map(v => v.name)).toEqual([IN_ORDER, RANDOM_ORDER])
      expect(input("measuresPerCard").default).toEqual(WHOLE_SECTION)
      expect(input("measuresPerCard").presets.map(v => v.name)).toEqual([WHOLE_SECTION])
    })

    it("plays a saved drill without a card size as the whole section on one looping card", async function() {
      let bars = Array.from({length: 16}, (_, idx) => `
        <measure number="${idx + 1}">
          ${idx == 0 ? `<attributes>
            <divisions>1</divisions>
            <time><beats>2</beats><beat-type>4</beat-type></time>
            <staves>2</staves>
            <clef number="1"><sign>G</sign><line>2</line></clef>
            <clef number="2"><sign>F</sign><line>4</line></clef>
          </attributes>` : ""}
          ${noteXML("CDEFGAB"[idx % 7], 5, 1, 1)}
          ${noteXML("CDEFGAB"[(idx + 2) % 7], 5, 1, 1)}
        </measure>`).join("")

      let long = (await importMusicXMLPiece("long.musicxml", `<?xml version="1.0" encoding="UTF-8"?>
        <score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
          <part id="P1">${bars}</part>
        </score-partwise>`, store)).piece

      let saved = window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)
      let settings
      try {
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
          piece: long.id, song: "", startMeasure: 1, endMeasure: 16, hand: BOTH_HANDS,
        }))
        settings = generatorDefaultSettings(sheetMusic, grand)
      } finally {
        if (saved == null) {
          window.localStorage.removeItem(SHEET_MUSIC_STORAGE_KEY)
        } else {
          window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, saved)
        }
      }

      expect(settings.measuresPerCard).toEqual(WHOLE_SECTION)

      let {columns, status} = sheetMusicSection(grand, settings)
      expect(columns.length).toEqual(32)
      expect(sheetMusic.status(grand, settings)).toEqual(status)

      // the whole section is played in order whatever the order is set to,
      // never weighted by the measures played worst
      generator = sheetMusic.create(grand, null, {...settings, order: RANDOM_ORDER})
      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect(generator.deck.order).toEqual(IN_ORDER)

      generator = sheetMusic.create(grand, null, settings)
      let wholeSection = Array.from({length: 16}, (_, idx) => idx + 1)
      expect(generator.cards.map(card => card.measures)).toEqual([wholeSection])
      expect(generator.currentCardNumber()).toBe(null)

      // its columns come round again without the gap of a flashcard deck
      let emitted = []
      for (let i = 0; i < 34; i++) {
        emitted.push(generator.nextNote())
      }
      expect(notesOf(emitted)).toEqual([...columns, ...columns.slice(0, 2)].map(column => [...column]))
    })

    it("keeps a whole section as one looping card", function() {
      let settings = settingsFor({measuresPerCard: WHOLE_SECTION})
      generator = sheetMusic.create(grand, null, settings)

      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect(generator.currentCard().measures).toEqual([0, 1, 2])
      expect(generator.currentCardNumber()).toBe(null)

      // its columns come round again without the gap of a flashcard deck
      let plain = new SheetMusicGenerator(sheetMusicSection(grand, settings).columns)
      for (let i = 0; i < 12; i++) {
        expect(notesOf([generator.nextNote()])).toEqual([plain.nextNote()])
      }
    })

    it("picks random cards only for a numeric card size", function() {
      generator = sheetMusic.create(grand, null, settingsFor({measuresPerCard: WHOLE_SECTION, order: RANDOM_ORDER}))
      expect(generator.deck.order).toEqual(IN_ORDER)

      generator = sheetMusic.create(grand, null, settingsFor({measuresPerCard: "1", order: RANDOM_ORDER}))
      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect(generator.deck.order).toEqual(RANDOM_ORDER)
      expect(generator.deck.cards.map(card => card.measures)).toEqual([[0], [1], [2]])
    })

    it("records each hand setting's attempts under its hand, with the clefs of the notes read", async function() {
      let play = async (hand, misses) => {
        generator = sheetMusic.create(grand, null, settingsFor({startMeasure: 1, endMeasure: 1, measuresPerCard: 1, hand}))
        let stats = new NoteStats()
        let notes = new NoteList([], {generator})
        notes.fillBuffer(4)
        stats.missNotes(misses)
        for (let i = 0; i < 3; i++) {
          notes = hit(notes, stats)
        }
        await generator.finishing
        generator.stop()
        return stats
      }

      // measure 1: G3 and G4 together, then A4 and B4
      let both = await play(BOTH_HANDS, ["G3"])
      expect(both.clefs).toEqual({g: {hits: 3, misses: 0}, f: {hits: 1, misses: 1}})
      expect(both.sessionRecord().clefs).toEqual(both.clefs)

      let right = await play(RIGHT_HAND, ["G4"])
      expect(right.clefs).toEqual({g: {hits: 3, misses: 1}})

      let reviews = await store.reviews({pieceId: piece.id})
      expect(reviews.map(r => [r.itemId, r.staffMisses])).toEqual([
        [`${piece.id}:both:1-1`, {upper: 0, lower: 1}],
        [`${piece.id}:upper:1-1`, {upper: 1, lower: 0}],
      ])

      // the section stats still add up every hand of a measure
      expect(store.sectionStats(piece.id)).toEqual([jasmine.objectContaining({
        startMeasure: 1, endMeasure: 1, hits: 6, misses: 2, attempts: 2,
      })])
    })

    it("drills a piece section as measure cards", function() {
      let settings = settingsFor()
      generator = sheetMusic.create(grand, null, settings)
      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect(notesOf([generator.nextNote(), generator.nextNote(), generator.nextNote(), generator.nextNote(), generator.nextNote()]))
        .toEqual([["D5"], ["G3", "G4"], ["A4"], ["B4"], []])
    })

    it("keeps the settings status the same as cards advance", function() {
      let settings = settingsFor()
      let status = sheetMusic.status(grand, settings)
      expect(status).toEqual("Score has measures 0–2 (0 is the pickup), section has 5 columns")

      generator = sheetMusic.create(grand, null, settings)
      let stats = new NoteStats()
      let notes = new NoteList([], {generator})
      notes.fillBuffer(6)
      for (let i = 0; i < 4; i++) {
        notes = hit(notes, stats)
      }

      expect(generator.deck.card.measures).toEqual([2])
      expect(sheetMusic.status(grand, settings)).toEqual(status)
    })

    it("draws the pool from the start and end measures and the hand", function() {
      let settings = settingsFor({startMeasure: 1, endMeasure: 2, measuresPerCard: 1, hand: "left hand (bass staff)"})
      generator = sheetMusic.create(grand, null, settings)
      expect(generator.deck.card.measures).toEqual([1])
      let column = generator.nextNote()
      expect([...column]).toEqual(["G3"])
      expect(generator.nextNote()).toEqual([])
    })

    it("loops a section that fits on one card like the whole section drill", function() {
      let settings = settingsFor({measuresPerCard: 8})
      generator = sheetMusic.create(grand, null, settings)
      let plain = new SheetMusicGenerator(sheetMusicSection(grand, settings).columns)

      for (let i = 0; i < 12; i++) {
        expect(notesOf([generator.nextNote()])).toEqual([plain.nextNote()])
      }
    })

    describe("picking the section and card size", function() {
      // a piece of 16 bars, 1 to 16, a two note column a bar
      let sixteenBars
      beforeEach(async function() {
        let bars = Array.from({length: 16}, (_, idx) => `
          <measure number="${idx + 1}">
            ${idx == 0 ? `<attributes>
              <divisions>1</divisions>
              <time><beats>1</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes>` : ""}
            ${noteXML("CDEFGAB"[idx % 7], 5, 1, 1)}
          </measure>`).join("")

        sixteenBars = (await importMusicXMLPiece("sixteen.musicxml", `<?xml version="1.0" encoding="UTF-8"?>
          <score-partwise version="4.0">
            <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
            <part id="P1">${bars}</part>
          </score-partwise>`, store)).piece
      })

      let longSettings = extra => settingsFor({
        piece: sixteenBars.id, startMeasure: 1, endMeasure: 16, ...extra,
      })

      it("picks measures from the piece's own range, a pickup included", function() {
        expect(sheetMusicMeasureBounds(settingsFor())).toEqual([0, 2])
        expect(sheetMusicMeasureBounds(longSettings())).toEqual([1, 16])
        expect(sheetMusicMeasureBounds(settingsFor({piece: "", song: "c4 d4 e4 f4 g4"}))).toEqual([1, 2])
        expect(sheetMusicMeasureBounds(settingsFor({piece: "", song: ""}))).toBe(null)

        let bounds = settings => input("startMeasure").bounds(settings)
        expect(bounds(longSettings())).toEqual({min: 1, max: 16, caption: "of 16"})
        expect(bounds(settingsFor())).toEqual({min: 0, max: 2, caption: "of 2"})
      })

      it("clamps a section to the piece, start never after end", function() {
        let range = extra => sheetMusicSectionRange(longSettings(extra))
        expect(range({startMeasure: 4, endMeasure: 40})).toEqual({startMeasure: 4, endMeasure: 16})
        expect(range({startMeasure: 30, endMeasure: 40})).toEqual({startMeasure: 16, endMeasure: 16})
        expect(range({startMeasure: -3, endMeasure: 2})).toEqual({startMeasure: 1, endMeasure: 2})
        expect(range({startMeasure: 9, endMeasure: 5})).toEqual({startMeasure: 9, endMeasure: 9})

        expect(input("startMeasure").value(longSettings({startMeasure: 30, endMeasure: 40}))).toEqual(16)
        expect(input("endMeasure").value(longSettings({endMeasure: 40}))).toEqual(16)
      })

      it("drags the other end of the section along rather than refusing a pick", function() {
        let update = (extra, name, value) => sheetMusicSectionUpdate(longSettings(extra), name, value)

        // within the section, only the picked end moves
        expect(update({startMeasure: 2, endMeasure: 8}, "startMeasure", 5))
          .toEqual({startMeasure: 5, endMeasure: 8})
        expect(update({startMeasure: 2, endMeasure: 8}, "endMeasure", 12))
          .toEqual({startMeasure: 2, endMeasure: 12})

        // past the other end, it comes along
        expect(update({startMeasure: 2, endMeasure: 8}, "startMeasure", 11))
          .toEqual({startMeasure: 11, endMeasure: 11})
        expect(update({startMeasure: 6, endMeasure: 8}, "endMeasure", 3))
          .toEqual({startMeasure: 3, endMeasure: 3})

        // and a pick past the piece is clamped to it
        expect(update({startMeasure: 2, endMeasure: 8}, "endMeasure", 99))
          .toEqual({startMeasure: 2, endMeasure: 16})
        expect(update({startMeasure: 2, endMeasure: 8}, "startMeasure", 99))
          .toEqual({startMeasure: 16, endMeasure: 16})

        // the inputs pick through it
        expect(input("startMeasure").update(longSettings({startMeasure: 2, endMeasure: 8}), 11))
          .toEqual({startMeasure: 11, endMeasure: 11})
        expect(input("endMeasure").update(longSettings({startMeasure: 6, endMeasure: 8}), 3))
          .toEqual({startMeasure: 3, endMeasure: 3})
      })

      it("lets a card take up to the whole section", function() {
        let settings = longSettings({startMeasure: 3, endMeasure: 12})
        expect(sheetMusicSectionLength(settings)).toEqual(10)

        let perCard = input("measuresPerCard")
        expect(perCard.bounds(settings)).toEqual({min: 1, max: 10, caption: "of 10"})
        expect(perCard.hint).not.toContain("Cards stop")

        expect(perCard.value({...settings, measuresPerCard: WHOLE_SECTION})).toBe(null)
        expect(perCard.value({...settings, measuresPerCard: "2"})).toEqual(2)
        expect(perCard.value({...settings, measuresPerCard: 7})).toEqual(7)
      })

      it("draws cards of any size", function() {
        generator = sheetMusic.create(grand, null, longSettings({measuresPerCard: 5}))
        expect(generator.cards.map(card => [card.startMeasure, card.endMeasure]))
          .toEqual([[1, 5], [6, 10], [11, 15], [16, 16]])

        // a size past the section is the section on one card
        generator = sheetMusic.create(grand, null, longSettings({measuresPerCard: 40}))
        expect(generator.cards.map(card => card.measures.length)).toEqual([16])
      })

      it("loads stored settings from before the pickers, clamped to the piece", function() {
        let fixed = fixGeneratorSettings(sheetMusic, {
          piece: sixteenBars.id, song: "", startMeasure: 30, endMeasure: 40,
          hand: BOTH_HANDS, measuresPerCard: "3", order: IN_ORDER,
        })
        expect(fixed.startMeasure).toEqual(16)
        expect(fixed.endMeasure).toEqual(16)
        expect(fixed.measuresPerCard).toEqual(3)

        // a card size larger than a shorter piece's section still drills it
        fixed = fixGeneratorSettings(sheetMusic, {
          piece: piece.id, song: "", startMeasure: 0, endMeasure: 9,
          hand: BOTH_HANDS, measuresPerCard: 12,
        })
        expect([fixed.startMeasure, fixed.endMeasure, fixed.measuresPerCard]).toEqual([0, 2, 12])
        generator = sheetMusic.create(grand, null, settingsFor(fixed))
        expect(generator.currentCard().measures).toEqual([0, 1, 2])

        expect(fixGeneratorSettings(sheetMusic, {measuresPerCard: WHOLE_SECTION}).measuresPerCard)
          .toEqual(WHOLE_SECTION)
        expect(fixGeneratorSettings(sheetMusic, {measuresPerCard: "lots"}).measuresPerCard)
          .toBeUndefined()
      })
    })

    it("keeps pasted notation as a looping drill", function() {
      let settings = settingsFor({piece: "", song: "c4 d4 e4", startMeasure: 1, endMeasure: 1})
      generator = sheetMusic.create(grand, null, settings)

      expect(generator instanceof SheetMusicGenerator).toBe(true)
      expect(sheetMusic.status(grand, settings)).toEqual("Song has 1 measure, section has 3 columns")
    })
  })
})
