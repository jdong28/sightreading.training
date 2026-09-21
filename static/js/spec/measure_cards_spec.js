import MersenneTwister from "mersennetwister"

import {
  measureCards, sectionCard, cardColumn, cardColumns, measureWeight, cardWeights, nextCardIndex,
  MeasureCardDeck, MeasureCardGenerator, IN_ORDER, RANDOM_ORDER, MAX_MEASURES_PER_CARD
} from "st/measure_cards"

import {SheetMusicGenerator, generatorDefaultSettings} from "st/generators"
import {
  GENERATORS, sheetMusicSection, BOTH_HANDS, WHOLE_SECTION, SHEET_MUSIC_STORAGE_KEY
} from "st/data"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"

import {openTestStore, pickupScore, noteXML} from "spec/helpers"

const grand = {name: "grand", range: ["C2", "C6"]}

// the measures of pickupScore on the grand staff
const pickupMeasures = () => [
  {number: 0, columns: [["D5"]]},
  {number: 1, columns: [["G3", "G4"], ["A4"], ["B4"]]},
  {number: 2, columns: [["C3", "E3", "G3", "C5"]]},
]

// the notes of columns, without the measure marks of cardColumn
const notesOf = columns => [...columns].map(column => [...column])
// the bar number each column starts, or null
const measureMarks = columns => [...columns].map(column => column.measure ?? null)

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
          startMeasure: 0, endMeasure: 1, measures: [0, 1], numbered: true,
          columns: [["D5"], ["G3", "G4"], ["A4"], ["B4"]],
          columnMeasures: [0, 1, 1, 1],
        },
        {
          startMeasure: 2, endMeasure: 2, measures: [2], numbered: true,
          columns: [["C3", "E3", "G3", "C5"]],
          columnMeasures: [0],
        },
      ])

      // the deck's short last card is numbered like its siblings
      expect(measureMarks(cardColumns(cards[1]))).toEqual([2])
    })

    it("makes a card per measure by default and caps the card size", function() {
      expect(measureCards(pickupMeasures(), 1).map(c => c.measures)).toEqual([[0], [1], [2]])
      expect(measureCards(pickupMeasures(), 0).map(c => c.measures)).toEqual([[0], [1], [2]])
      expect(measureCards(pickupMeasures(), 50).map(c => c.measures)).toEqual([[0, 1, 2]])
      expect(measureCards([], 2)).toEqual([])
    })

    it("splits a section longer than the cap into cards of at most the cap", function() {
      expect(MAX_MEASURES_PER_CARD).toEqual(3)

      let measures = Array.from({length: 7}, (_, idx) => ({number: idx, columns: [["C4"]]}))
      expect(measureCards(measures, 50).map(c => c.measures)).toEqual([
        [0, 1, 2], [3, 4, 5], [6],
      ])
      // a requested size above the cap is capped the same way
      expect(measureCards(measures, MAX_MEASURES_PER_CARD + 4).map(c => c.measures))
        .toEqual([[0, 1, 2], [3, 4, 5], [6]])
    })

    it("leaves a pool of one measure unnumbered, whatever the card size", function() {
      let pool = pickupMeasures().slice(1, 2)

      for (let size of [1, 2, MAX_MEASURES_PER_CARD]) {
        let cards = measureCards(pool, size)
        expect(cards.map(card => card.numbered)).toEqual([false])
        expect(cards.map(card => measureMarks(cardColumns(card))))
          .toEqual([[null, null, null]])
      }
    })

    it("marks the first column of each measure of a numbered card", function() {
      let measures = [...pickupMeasures(), {number: 3, columns: []}, {number: 4, columns: [["F5"]]}]
      let card = sectionCard(measures)
      expect(card.measures).toEqual([0, 1, 2, 3, 4])

      let columns = card.columns.map((column, idx) => cardColumn(card, idx))
      expect(notesOf(columns)).toEqual(card.columns)
      expect(measureMarks(columns)).toEqual([0, 1, null, null, 2, 4])
      expect(card.columns[0].measure).toBeUndefined()

      // a deck of one measure a card draws no bar lines at all
      expect(measureCards(pickupMeasures(), 1).map(card => measureMarks(cardColumns(card))))
        .toEqual([[null], [null, null, null], [null]])
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
      expect(measureMarks(notes)).toEqual([0, 1, null, null, null, null])

      notes = hit(notes, stats)
      notes = hit(notes, stats)
      notes = hit(notes, stats)
      expect(notesOf(notes)).toEqual([["B4"], [], [], [], [], []])

      notes = hit(notes, stats)
      expect(deck.card.measures).toEqual([2])
      expect(notesOf(notes)).toEqual([["C3", "E3", "G3", "C5"], [], [], [], [], []])
      // the deck's short last card opens with its bar number like the first
      expect(measureMarks(notes)).toEqual([2, null, null, null, null, null])

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

        let byMeasure = s => s.startMeasure
        expect(store.sectionStats("p").sort((a, b) => byMeasure(a) - byMeasure(b))).toEqual([
          {pieceId: "p", startMeasure: 0, endMeasure: 0, hits: 1, misses: 1, attempts: 1, lastPracticed: 4000, elapsedMs: 1500},
          {pieceId: "p", startMeasure: 1, endMeasure: 1, hits: 3, misses: 1, attempts: 1, lastPracticed: 4000, elapsedMs: 2500},
        ])

        // a long pause on a column isn't counted
        time = 4000 + 10 * 60 * 1000
        notes = hit(notes, stats)
        await generator.finishing

        expect(store.sectionStats("p").find(s => s.startMeasure == 2)).toEqual(
          {pieceId: "p", startMeasure: 2, endMeasure: 2, hits: 1, misses: 0, attempts: 1, lastPracticed: time, elapsedMs: 0}
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

        expect(generator.deck.card.measures).toEqual([2])
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
        stats.missNotes(["A4"])
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
      // the whole section is always played in order, so it offers no choice
      expect(input("order").visible(settingsFor({measuresPerCard: WHOLE_SECTION}))).toBe(false)
      expect(input("order").values.map(v => v.name)).toEqual([IN_ORDER, RANDOM_ORDER])
      expect(input("measuresPerCard").default).toEqual(WHOLE_SECTION)
      expect(input("measuresPerCard").values.map(v => v.name))
        .toEqual([WHOLE_SECTION, ...Array.from({length: MAX_MEASURES_PER_CARD}, (_, idx) => `${idx + 1}`)])
    })

    it("walks a saved drill without a card size through the section in capped cards", async function() {
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

      // a section longer than the cap is never shown at once, whatever the
      // order is set to: it is walked in order, never weighted by the
      // measures played worst
      generator = sheetMusic.create(grand, null, {...settings, order: RANDOM_ORDER})
      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect(generator.deck.order).toEqual(IN_ORDER)

      generator = sheetMusic.create(grand, null, settings)
      expect(generator.cards.map(card => card.measures)).toEqual([
        [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15], [16],
      ])
      expect(generator.currentCardNumber()).toEqual(1)
      // every card of the walk opens with its own numbered bar line, the
      // trailing one bar card along with the rest
      expect(generator.cards.map(card => cardColumns(card)[0].measure))
        .toEqual([1, 4, 7, 10, 13, 16])

      // the first card's own columns, the first of each measure marked for
      // its bar line, and nothing past them until they are played
      let emitted = []
      for (let i = 0; i < 7; i++) {
        emitted.push(generator.nextNote())
      }
      expect(notesOf(emitted)).toEqual([...columns.slice(0, 6).map(column => [...column]), []])
      expect(measureMarks(emitted)).toEqual([1, null, 2, null, 3, null, null])

      // and playing a card through moves on to the next, the last wrapping
      // back to the section's start
      let stats = new NoteStats()
      let notes = new NoteList([], {generator})
      notes.fillBuffer(6)

      let played = []
      for (let i = 0; i < 7; i++) {
        played.push(generator.currentCard().measures)
        for (let column = 0; column < generator.currentCard().columns.length; column++) {
          notes = hit(notes, stats)
        }
      }

      expect(played).toEqual([
        [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15], [16], [1, 2, 3],
      ])
    })

    it("keeps a whole section the cap fits as one looping card", function() {
      let settings = settingsFor({measuresPerCard: WHOLE_SECTION})
      generator = sheetMusic.create(grand, null, settings)

      expect(generator instanceof SheetMusicGenerator).toBe(true)
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
      expect(generator instanceof SheetMusicGenerator).toBe(true)

      generator = sheetMusic.create(grand, null, settingsFor({measuresPerCard: "1", order: RANDOM_ORDER}))
      expect(generator instanceof MeasureCardGenerator).toBe(true)
      expect(generator.deck.order).toEqual(RANDOM_ORDER)
      expect(generator.deck.cards.map(card => card.measures)).toEqual([[0], [1], [2]])
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
      // drawn on the score's lower staff, in the clefs at its onset
      expect(column.staves).toEqual(["lower"])
      expect(column.clefs).toEqual({lower: "f"})
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

    it("keeps pasted notation as a looping drill", function() {
      let settings = settingsFor({piece: "", song: "c4 d4 e4", startMeasure: 1, endMeasure: 1})
      generator = sheetMusic.create(grand, null, settings)

      expect(generator instanceof SheetMusicGenerator).toBe(true)
      expect(sheetMusic.status(grand, settings)).toEqual("Song has 1 measure, section has 3 columns")
    })
  })
})
