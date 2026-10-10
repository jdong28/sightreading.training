import {
  ShapeGenerator, Generator, generatorDefaultSettings, currentScrollTempo, storeCurrentDrill,
  DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY, focusPool,
} from "st/generators"
import {ChordGenerator, MultiKeyChordGenerator} from "st/chord_generators"
import {
  STAVES, GENERATORS, SHEET_MUSIC_GENERATOR, SHEET_MUSIC_STORAGE_KEY, LEGACY_SHEET_MUSIC_STORAGE_KEY,
  WHOLE_SECTION, FREE_PRACTICE, BOTH_HANDS, RIGHT_HAND, LEFT_HAND, troublePracticeSettings, scoreSettingsForPiece,
} from "st/data"
import {RANDOM_ORDER} from "st/measure_cards"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import {openTestStore, dynamicsOpening} from "spec/helpers"
import Keyboard from "st/components/keyboard"

import {
  KeySignature, ChromaticKeySignature, ChromaticScale, Chord, Staff, parseNote, noteName
} from "st/music"

describe("generators", function() {
  describe("shape generators", function() {
    it("gets inversions of triad", function() {
      let g = new ShapeGenerator()
      expect(g.inversions([0, 2, 4])).toEqual([
        [0, 2, 4],
        [0, 2, 5],
        [0, 3, 5],
      ])
    })


    it("gets inversions of triad out of order", function() {
      let g = new ShapeGenerator()
      expect(g.inversions([4, 0, 2])).toEqual([
        [0, 2, 4],
        [0, 2, 5],
        [0, 3, 5],
      ])
    })

    it("gets inversions of seven", function() {
      let g = new ShapeGenerator()
      expect(g.inversions([0, 2, 4, 6])).toEqual([
        [0, 2, 4, 6],
        [0, 2, 4, 5],
        [0, 2, 3, 5],
        [0, 1, 3, 5],
      ])
    })

  })

  describe("smoothing", function() {
    it("ranks notes using individual minimizer", function() {
      let g = new Generator()
      g.lastNotes = ["C2", "C5"]

      let k = 0
      let available = [
        ["A1", "D5"],
        ["D2", "D5"],
      ]

      let nextNote = () => available[(k++) % available.length]
      let res = g.sortedCandidatesIndividual(2, nextNote)
      expect(res).toEqual([
        [4, available[1]],
        [5, available[0]],
      ])
    })
  })
})


describe("chord generator", function() {
  it("gets all chords for scale", function() {
    let generator = new ChordGenerator(new KeySignature(0))
    let chords = generator.allChords()

    expect(chords).toEqual([
      new Chord("C", "M"),
      new Chord("D", "m"),
      new Chord("E", "m"),
      new Chord("F", "M"),
      new Chord("G", "M"),
      new Chord("A", "m"),
      new Chord("B", "dim"),
    ])
  })

  it("generates some chords without an error", function() {
    let generator = new ChordGenerator(new KeySignature(0))
    for (let i = 0; i < 10; i++) {
      let chord = generator.nextChord()
      expect(chord).toBeTruthy()
    }
  })

  describe("multi key chord generator", function() {
    it("should create generator", function() {
      let generator = new MultiKeyChordGenerator(new KeySignature(0))
      for (let i = 0; i < 10; i++) {
        let chord = generator.nextChord()
        expect(chord).toBeTruthy()
      }
    })
  })
})

// The MIDI pitches the staves, generators and keyboard used while note names
// put middle C at "C5". Naming middle C "C4" must not move any of them
describe("octave numbering", function() {
  const STAFF_PITCHES = {
    treble: [57, 84], // A3 - C6
    bass: [36, 64], // C2 - E4
    grand: [36, 84], // C2 - C6
    chord: [95, 96], // B6 - C7
  }

  it("keeps every staff's pitch range", function() {
    expect(Object.fromEntries(STAVES.map(staff => [staff.name, staff.range.map(parseNote)])))
      .toEqual(STAFF_PITCHES)

    expect(Staff.allStaves().map(staff => [staff.name, [staff.lowerNote, staff.upperNote, staff.clefNote].map(parseNote)]))
      .toEqual([["treble", [64, 77, 67]], ["bass", [43, 57, 53]]])

    let keyboard = new Keyboard({})
    expect([keyboard.defaultLower, keyboard.defaultUpper].map(parseNote)).toEqual([60, 83])
  })

  let keys = [new KeySignature(0), new KeySignature(-3), new KeySignature(4), new ChromaticKeySignature()]
  let noteStaves = STAVES.filter(staff => staff.mode == "notes")
  let noteGenerators = GENERATORS.filter(g => g.mode == "notes")

  for (let generator of noteGenerators) {
    it(`keeps the pitches of the ${generator.name} generator on every staff`, function() {
      for (let staff of noteStaves) {
        let [lower, upper] = STAFF_PITCHES[staff.name]

        for (let key of keys) {
          let settings = generatorDefaultSettings(generator, staff)
          if ((generator.inputs || []).some(input => input.name == "noteRange")) {
            expect(settings.noteRange).toEqual([lower, upper])
          }

          let g = generator.create.call(generator, staff, key, settings)
          let pitches = []
          for (let i = 0; i < 100; i++) {
            let column = g.nextNote()
            for (let note of Array.isArray(column) ? column : [column]) {
              pitches.push(parseNote(note))
            }
          }

          let context = `${generator.name} on ${staff.name} in ${key.name()}`
          expect(pitches.length).withContext(context).toBeGreaterThan(0)
          expect(Math.min(...pitches)).withContext(context).toBeGreaterThanOrEqual(lower)
          expect(Math.max(...pitches)).withContext(context).toBeLessThanOrEqual(upper)
        }
      }
    })
  }

  it("draws random notes from the key's scale over the same pitches", function() {
    for (let staff of noteStaves) {
      let [lower, upper] = STAFF_PITCHES[staff.name]
      for (let key of keys) {
        let scale = key.defaultScale()
        let expected = []
        for (let pitch = lower; pitch <= upper; pitch++) {
          if (scale.containsNote(noteName(pitch))) {
            expected.push(pitch)
          }
        }

        expect(scale.getLooseRange(...staff.range).map(parseNote))
          .withContext(`${staff.name} in ${key.name()}`).toEqual(expected)
      }
    }
  })

  describe("stored sheet music settings", function() {
    let saved

    beforeEach(function() {
      saved = [SHEET_MUSIC_STORAGE_KEY, LEGACY_SHEET_MUSIC_STORAGE_KEY].map(key => [key, window.localStorage.getItem(key)])
      for (let [key] of saved) {
        window.localStorage.removeItem(key)
      }
    })

    afterEach(function() {
      for (let [key, value] of saved) {
        if (value == null) {
          window.localStorage.removeItem(key)
        } else {
          window.localStorage.setItem(key, value)
        }
      }
    })

    let sheetMusic = () => SHEET_MUSIC_GENERATOR
    let treble = () => STAVES.find(staff => staff.name == "treble")

    it("renumbers song notation stored when middle C was c5 once", function() {
      window.localStorage.setItem(LEGACY_SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: "", song: "c5 d5.2 { f+6 | a4 }", startMeasure: 1, endMeasure: 1,
      }))

      let settings = generatorDefaultSettings(sheetMusic(), treble())
      expect(settings.song).toEqual("c4 d4.2 { f+5 | a3 }")
      expect(JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)).song).toEqual("c4 d4.2 { f+5 | a3 }")
      // the legacy key is left in place
      expect(JSON.parse(window.localStorage.getItem(LEGACY_SHEET_MUSIC_STORAGE_KEY)).song).toEqual("c5 d5.2 { f+6 | a4 }")

      // settings stored since aren't renumbered again
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({piece: "", song: "e4"}))
      expect(generatorDefaultSettings(sheetMusic(), treble()).song).toEqual("e4")
    })

    it("keeps a stored measures-per-card as the number it names", function() {
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: "", song: "", measuresPerCard: "8",
      }))
      expect(generatorDefaultSettings(sheetMusic(), treble()).measuresPerCard)
        .toEqual(8)

      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: "", song: "", measuresPerCard: "many",
      }))
      expect(generatorDefaultSettings(sheetMusic(), treble()).measuresPerCard)
        .toEqual(WHOLE_SECTION)
    })
  })

  // what Today (st/practice_day) writes before it goes to the score page
  describe("the settings Today hands the score page", function() {
    let store, previous, saved, piece, other, xml

    beforeEach(async function() {
      saved = window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)
      window.localStorage.removeItem(SHEET_MUSIC_STORAGE_KEY)
      store = await openTestStore()
      previous = setAppStore(store)
      xml = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
      piece = (await importMusicXMLPiece("fixture.musicxml", xml, store)).piece
      other = (await importMusicXMLPiece("other.musicxml", dynamicsOpening({title: "Other Study"}), store)).piece
    })

    afterEach(function() {
      setAppStore(previous)
      store.close()
      if (saved == null) {
        window.localStorage.removeItem(SHEET_MUSIC_STORAGE_KEY)
      } else {
        window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, saved)
      }
    })

    let stored = settings => window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify(settings))

    describe("troublePracticeSettings", function() {
      it("sets one bar as free practice and the whole section as one card", function() {
        let settings = {piece: piece.id, hand: BOTH_HANDS, startMeasure: 1, endMeasure: 4, measuresPerCard: 2, order: RANDOM_ORDER}

        let one = troublePracticeSettings(settings, [3, 3])
        expect(one).toEqual({...settings, practice: FREE_PRACTICE, startMeasure: 3, endMeasure: 3, measuresPerCard: WHOLE_SECTION})
      })

      it("sets a span one bar a card in Random order, keeping the hand", function() {
        let settings = {piece: piece.id, hand: LEFT_HAND, startMeasure: 1, endMeasure: 4, measuresPerCard: WHOLE_SECTION}

        let span = troublePracticeSettings(settings, [3, 9])
        expect(span.practice).toEqual(FREE_PRACTICE)
        expect([span.startMeasure, span.endMeasure]).toEqual([3, 9])
        expect(span.measuresPerCard).toEqual(1)
        expect(span.order).toEqual(RANDOM_ORDER)
        expect(span.hand).toEqual(LEFT_HAND)
        expect(span.piece).toEqual(piece.id)
      })

      it("clamps the span to the piece", function() {
        let settings = {piece: piece.id, hand: BOTH_HANDS, startMeasure: 1, endMeasure: 4}

        let span = troublePracticeSettings(settings, [0, 40])
        expect([span.startMeasure, span.endMeasure]).toEqual([1, 16])
      })
    })

    describe("scoreSettingsForPiece", function() {
      it("keeps the stored settings of the same piece", function() {
        stored({piece: piece.id, startMeasure: 5, endMeasure: 7, hand: RIGHT_HAND, practice: FREE_PRACTICE, measuresPerCard: 2})

        let settings = scoreSettingsForPiece(piece.id)
        expect(settings.piece).toEqual(piece.id)
        expect([settings.startMeasure, settings.endMeasure]).toEqual([5, 7])
        expect(settings.hand).toEqual(RIGHT_HAND)
        expect(settings.measuresPerCard).toEqual(2)
      })

      it("takes the defaults of a piece picked in place of the stored one, as the setup pane picks it", function() {
        stored({piece: piece.id, startMeasure: 5, endMeasure: 7, hand: RIGHT_HAND, practice: FREE_PRACTICE})

        let settings = scoreSettingsForPiece(other.id)
        expect(settings.piece).toEqual(other.id)
        expect([settings.startMeasure, settings.endMeasure]).toEqual([1, 4])
        expect(settings.hand).toEqual(BOTH_HANDS)
        expect(settings.practice).toBe(null)
      })
    })
  })

  // D4(c): the trainer's "Keep tempo" setting, kept under the drill's
  // storage key alongside mode and speed
  describe("the scroll-mode tempo setting", function() {
    let saved

    beforeEach(function() {
      saved = [DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY].map(key => [key, window.localStorage.getItem(key)])
      for (let [key] of saved) {
        window.localStorage.removeItem(key)
      }
    })

    afterEach(function() {
      for (let [key, value] of saved) {
        if (value == null) {
          window.localStorage.removeItem(key)
        } else {
          window.localStorage.setItem(key, value)
        }
      }
    })

    it("is off by default, on once stored, and kept apart per storage key", function() {
      expect(currentScrollTempo()).toBe(false)
      expect(currentScrollTempo(SCORE_DRILL_STORAGE_KEY)).toBe(false)

      storeCurrentDrill({tempo: true})
      expect(currentScrollTempo()).toBe(true)
      expect(currentScrollTempo(SCORE_DRILL_STORAGE_KEY)).toBe(false)

      storeCurrentDrill({tempo: true}, SCORE_DRILL_STORAGE_KEY)
      expect(currentScrollTempo(SCORE_DRILL_STORAGE_KEY)).toBe(true)

      storeCurrentDrill({tempo: false})
      expect(currentScrollTempo()).toBe(false)
    })
  })
})

// the session summary card's "Practise these notes" (st/session_summary)
// seeds Random notes with the weak notes shown
describe("a focused pool of notes", function() {
  it("spells every pitch in range as the focused name, sorted low to high", function() {
    expect(focusPool(["A3", "C6"], ["F#", "Bb"])).toEqual(["Bb3", "F#4", "Bb4", "F#5", "Bb5"])
  })

  it("is empty when nothing in range matches", function() {
    expect(focusPool(["C4", "E4"], ["G"])).toEqual([])
  })

  it("skips a name parseNote can't read", function() {
    expect(focusPool(["C4", "C6"], ["H", "C##"])).toEqual([])
  })
})

describe("random notes created with a focus", function() {
  let random = GENERATORS.find(g => g.name == "random")
  let treble = STAVES.find(s => s.name == "treble")
  let grand = STAVES.find(s => s.name == "grand")
  let key = new KeySignature(0)

  // RandomNotes#handSize: the halfsteps one hand reaches, so the pitches of
  // one hand span at most handSize - 1
  let HAND_SIZE = 11

  // the fewest hands the column needs, walking its pitches low to high and
  // starting a new hand whenever the next note is out of the current one's
  // reach (greedy is optimal for covering a line with fixed-width windows)
  let handsNeeded = column => {
    let pitches = column.map(parseNote).sort((a, b) => a - b)
    let hands = 1
    let lowest = pitches[0]

    for (let pitch of pitches) {
      if (pitch - lowest >= HAND_SIZE) {
        hands += 1
        lowest = pitch
      }
    }

    return hands
  }

  // C over a staff gives one note per octave (C2-C6 on the grand staff, C4-C6
  // on the treble): a pool wider than one hand and sparser than one hand's
  // reach, so the hand windows handGroups draws can miss every note of it
  for (let staff of [grand, treble]) {
    it(`keeps every column of a sparse focus pool playable on the ${staff.name} staff`, function() {
      for (let notes = 1; notes <= 5; notes++) {
        for (let hands = 1; hands <= 2; hands++) {
          let generator = random.create(staff, key, {notes, hands, focus: {C: true}})
          let context = `notes ${notes}, hands ${hands}`

          for (let i = 0; i < 200; i++) {
            let column = generator.nextNote()
            expect(column.length).withContext(context).toBeGreaterThan(0)
            for (let note of column) {
              expect(note).withContext(context).toMatch(/^C\d+$/)
            }
            expect(handsNeeded(column)).withContext(context).not.toBeGreaterThan(hands)
            expect(new Set(column).size).withContext(context).toEqual(column.length)
          }
        }
      }
    })
  }

  it("falls back to the unfocused pool with every note off, or none in range", function() {
    let allOff = random.create(treble, key, {notes: 3, hands: 1, focus: {"F#": false}})
    expect(allOff.notes.length).toBeGreaterThan(2)

    let narrowed = random.create(treble, key, {
      notes: 3, hands: 1, focus: {"G#": true},
      noteRange: [parseNote("C4"), parseNote("E4")],
    })
    expect(narrowed.notes.length).toBeGreaterThan(0)
    expect(narrowed.notes.every(note => note[0] != "G")).toBe(true)
  })

  it("ignores the chord-based (musical) filter while focused", function() {
    let generator = random.create(treble, key, {notes: 3, hands: 1, musical: true, focus: {"F#": true}})
    expect(generator.scale).toBeUndefined()

    for (let i = 0; i < 20; i++) {
      for (let note of generator.nextNote()) {
        expect(note).toMatch(/^F#\d+$/)
      }
    }
  })
})
