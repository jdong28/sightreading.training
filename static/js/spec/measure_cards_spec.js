import MersenneTwister from "mersennetwister"

import {
  measureCards, measureWeight, cardWeights, nextCardIndex, MeasureCardDeck,
  MeasureCardGenerator, IN_ORDER, RANDOM_ORDER
} from "st/measure_cards"

import {SheetMusicGenerator} from "st/generators"
import {GENERATORS, sheetMusicSection, BOTH_HANDS} from "st/data"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"

import {openTestStore, pickupScore} from "spec/helpers"

const grand = {name: "grand", range: ["C3", "C7"]}

// the measures of pickupScore on the grand staff
const pickupMeasures = () => [
  {number: 0, columns: [["D6"]]},
  {number: 1, columns: [["G4", "G5"], ["A5"], ["B5"]]},
  {number: 2, columns: [["C4", "E4", "G4", "C6"]]},
]

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
          columns: [["D6"], ["G4", "G5"], ["A5"], ["B5"]],
          columnMeasures: [0, 1, 1, 1],
        },
        {
          startMeasure: 2, endMeasure: 2, measures: [2],
          columns: [["C4", "E4", "G4", "C6"]],
          columnMeasures: [0],
        },
      ])
    })

    it("makes a card per measure by default and caps the card size", function() {
      expect(measureCards(pickupMeasures(), 1).map(c => c.measures)).toEqual([[0], [1], [2]])
      expect(measureCards(pickupMeasures(), 0).map(c => c.measures)).toEqual([[0], [1], [2]])
      expect(measureCards(pickupMeasures(), 50).map(c => c.measures)).toEqual([[0, 1, 2]])
      expect(measureCards([], 2)).toEqual([])
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

    it("weights cards by the recorded accuracy of their measures", function() {
      expect(measureWeight(undefined)).toEqual(1)
      expect(measureWeight({hits: 9, misses: 0})).toEqual(1)
      expect(measureWeight({hits: 1, misses: 4})).toEqual(3)

      let stats = [
        {pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 1, misses: 4},
        // a range of measures isn't a measure's accuracy
        {pieceId: "p", startMeasure: 0, endMeasure: 2, hits: 0, misses: 50},
      ]

      expect(cardWeights(measureCards(pickupMeasures(), 2), stats)).toEqual([2, 1])
      expect(cardWeights(measureCards(pickupMeasures(), 1), [])).toEqual([1, 1, 1])
    })

    it("picks random cards by the stats in the store", function() {
      let store = {
        sectionStats: pieceId => pieceId == "p" ? [
          {pieceId: "p", startMeasure: 2, endMeasure: 2, hits: 0, misses: 1000},
        ] : [],
      }

      let mt = new MersenneTwister(3)
      let deck = new MeasureCardDeck(cards(), {
        pieceId: "p", order: RANDOM_ORDER, random: () => mt.random(), store,
      })

      let seen = [deck.index]
      for (let i = 0; i < 20; i++) {
        deck.advance()
        seen.push(deck.index)
      }

      // every other card is the measure missed most
      let twos = seen.filter(idx => idx == 2).length
      expect(twos).toBeGreaterThanOrEqual(9)
    })
  })

  describe("deck", function() {
    it("describes the card being shown", function() {
      let deck = new MeasureCardDeck(measureCards(pickupMeasures(), 2), {
        pieceId: "p", order: IN_ORDER, store: emptyStore,
      })

      expect(deck.status()).toEqual("Card 1 · measures 0–1 of 0–2")
      deck.advance()
      expect(deck.status()).toEqual("Card 2 · measure 2 of 0–2")
      deck.advance()
      expect(deck.status()).toEqual("Card 3 · measures 0–1 of 0–2")
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

      expect([...notes]).toEqual([["D6"], ["G4", "G5"], ["A5"], ["B5"], [], []])

      notes = hit(notes, stats)
      notes = hit(notes, stats)
      notes = hit(notes, stats)
      expect([...notes]).toEqual([["B5"], [], [], [], [], []])

      notes = hit(notes, stats)
      expect(deck.status()).toEqual("Card 2 · measure 2 of 0–2")
      expect([...notes]).toEqual([["C4", "E4", "G4", "C6"], [], [], [], [], []])

      notes = hit(notes, stats)
      expect(deck.status()).toEqual("Card 3 · measures 0–1 of 0–2")
      expect([...notes]).toEqual([["D6"], ["G4", "G5"], ["A5"], ["B5"], [], []])
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
        expect([...cardNotes]).toEqual([...plainNotes])
        cardNotes = hit(cardNotes, stats)
        plainNotes = skip(plainNotes)
      }

      expect(deck.status()).toEqual("Card 3 · measures 0–2 of 0–2")
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

      it("adds the hits, misses and time on each measure of a finished card", async function() {
        let {generator, notes} = generatorFor()
        let stats = new NoteStats()

        time = 1000
        stats.missNotes(["D6"])
        time = 1500
        notes = hit(notes, stats)
        time = 2500
        notes = hit(notes, stats)
        time = 3000
        stats.missNotes(["A5"])
        time = 3500
        notes = hit(notes, stats)

        // nothing is written before the card is done
        await Promise.resolve()
        expect(store.sectionStats("p")).toEqual([])

        time = 4000
        notes = hit(notes, stats)
        await generator.finishing

        let byMeasure = s => s.startMeasure
        expect(store.sectionStats("p").sort((a, b) => byMeasure(a) - byMeasure(b))).toEqual([
          {pieceId: "p", startMeasure: 0, endMeasure: 0, hits: 1, misses: 1, attempts: 1, lastPracticed: 4000, elapsedMs: 1500},
          {pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 3, misses: 1, attempts: 1, lastPracticed: 4000, elapsedMs: 2500},
        ])

        // a long pause on a column only counts up to the idle limit
        time = 4000 + 10 * 60 * 1000
        notes = hit(notes, stats)
        await generator.finishing

        expect(store.sectionStats("p").find(s => s.startMeasure == 2)).toEqual(
          {pieceId: "p", startMeasure: 2, endMeasure: 2, hits: 1, misses: 0, attempts: 1, lastPracticed: time, elapsedMs: NoteStats.TIMER_SIZE}
        )

        // the reloaded store has them too
        let reopened = await openTestStore({keep: true})
        expect(reopened.sectionStats("p").length).toEqual(3)
        await reopened.close()
      })

      it("records nothing for a card only skipped through", async function() {
        let {generator, notes} = generatorFor()

        for (let i = 0; i < 4; i++) {
          time += 1000
          notes = skip(notes)
        }
        await generator.finishing

        expect(generator.deck.status()).toEqual("Card 2 · measure 2 of 0–2")
        expect(store.sectionStats("p")).toEqual([])
      })

      it("times the first column from when it is shown, only the time for a single measure section", async function() {
        let deck = new MeasureCardDeck(measureCards([pickupMeasures()[1]], 1), {
          pieceId: "p", order: IN_ORDER, store,
        })

        // the page records the section's hits and misses
        await store.recordSectionPractice({pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 2, misses: 1, at: 500})

        let generator = track(new MeasureCardGenerator(deck, {recordNotes: false, now: () => time}))
        let notes = new NoteList([], {generator})
        let stats = new NoteStats()

        time = 1000
        notes.fillBuffer(6)
        time = 1600
        notes = hit(notes, stats)
        time = 1800
        stats.missNotes(["A5"])
        time = 2000
        notes = hit(notes, stats)
        time = 3000
        notes = hit(notes, stats)
        await generator.finishing

        expect(store.sectionStats("p")).toEqual([
          {pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 2, misses: 1, attempts: 1, lastPracticed: 3000, elapsedMs: 2000},
        ])
      })
    })
  })

  describe("sheet music generator", function() {
    const sheetMusic = GENERATORS.find(g => g.name == "sheet music")
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
      expect(input("order").values.map(v => v.name)).toEqual([IN_ORDER, RANDOM_ORDER])
    })

    it("drills a piece section as measure cards", function() {
      let settings = settingsFor()
      expect(sheetMusic.status(grand, settings)).toEqual(
        "Card 1 · measures 0–1 of 0–2. Score has measures 0–2 (0 is the pickup), section has 5 columns")

      generator = sheetMusic.create(grand, null, settings)
      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect([generator.nextNote(), generator.nextNote(), generator.nextNote(), generator.nextNote(), generator.nextNote()])
        .toEqual([["D6"], ["G4", "G5"], ["A5"], ["B5"], []])
    })

    it("draws the pool from the start and end measures and the hand", function() {
      let settings = settingsFor({startMeasure: 1, endMeasure: 2, measuresPerCard: 1, hand: "left hand (bass staff)"})
      expect(sheetMusic.status(grand, settings)).toMatch(/^Card 1 · measure 1 of 1–2\. /)

      generator = sheetMusic.create(grand, null, settings)
      expect(generator.nextNote()).toEqual(["G4"])
      expect(generator.nextNote()).toEqual([])
    })

    it("keeps drilling a whole section in order exactly as before", function() {
      let settings = settingsFor({measuresPerCard: 8})
      generator = sheetMusic.create(grand, null, settings)
      let plain = new SheetMusicGenerator(sheetMusicSection(grand, settings).columns)

      for (let i = 0; i < 12; i++) {
        expect(generator.nextNote()).toEqual(plain.nextNote())
      }
    })

    it("keeps pasted notation as a looping drill", function() {
      let settings = settingsFor({piece: "", song: "c5 d5 e5", startMeasure: 1, endMeasure: 1})
      generator = sheetMusic.create(grand, null, settings)

      expect(generator instanceof SheetMusicGenerator).toBe(true)
      expect(sheetMusic.status(grand, settings)).toEqual("Song has 1 measure, section has 3 columns")
    })
  })
})
