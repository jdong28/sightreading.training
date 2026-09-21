import {ShapeGenerator, Generator, generatorDefaultSettings} from "st/generators"
import {ChordGenerator, MultiKeyChordGenerator} from "st/chord_generators"
import {STAVES, GENERATORS, SHEET_MUSIC_STORAGE_KEY, LEGACY_SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {MAX_MEASURES_PER_CARD} from "st/measure_cards"
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
  let noteGenerators = GENERATORS.filter(g => g.mode == "notes" && g.name != "sheet music")

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

    let sheetMusic = () => GENERATORS.find(g => g.name == "sheet music")
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

    it("clamps a measures-per-card stored above the cap instead of falling back to the whole section", function() {
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
        piece: "", song: "", measuresPerCard: String(MAX_MEASURES_PER_CARD + 5),
      }))
      expect(generatorDefaultSettings(sheetMusic(), treble()).measuresPerCard)
        .toEqual(String(MAX_MEASURES_PER_CARD))
    })
  })
})
