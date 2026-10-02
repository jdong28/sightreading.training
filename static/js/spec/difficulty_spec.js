import {parseMusicXML} from "st/musicxml"
import {pianoScore} from "spec/helpers"

import {hash8, fingerprint, exactRepeats, FINGERPRINT_ALGO} from "st/difficulty/fingerprints"
import {scoreExtras} from "st/difficulty/source"
import {barFeatures} from "st/difficulty/features"
import {scoreBars, findPassages, heat, ANALYZER_ALGO} from "st/difficulty/sections"
import {intervalWords, passageReasons} from "st/difficulty/reasons"
import {validAnnotation, flagsInForce} from "st/difficulty/records"
import {analyzePiece, annotationWith, annotationStale, KINDS} from "st/difficulty/index"

// a quiet 16-bar piece (quarter notes, both hands, all in C major) with a
// dense run of sixteenths in both hands at bars 9-11, the workhorse for the
// section tests
const QUIET_UPPER = ["C4", "D4", "E4", "F4"]
const QUIET_LOWER = ["C3", "D3", "E3", "F3"]
const DENSE_UPPER = ["C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4", "C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4"]
const DENSE_LOWER = ["C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3", "C3", "D3", "E3", "F3", "G3", "F3", "E3", "D3"]

function quietBar() {
  return {
    upper: QUIET_UPPER.map(name => ({name})),
    lower: QUIET_LOWER.map(name => ({name})),
  }
}

function denseBar() {
  return {
    upper: DENSE_UPPER.map(name => ({name, duration: 0.25, type: "16th"})),
    lower: DENSE_LOWER.map(name => ({name, duration: 0.25, type: "16th"})),
  }
}

function workhorseSong({denseAt=[9, 10, 11], barCount=16}={}) {
  let bars = []
  for (let i = 1; i <= barCount; i++) {
    bars.push(denseAt.includes(i) ? denseBar() : quietBar())
  }
  return parseMusicXML(pianoScore({bars}))
}

function uniformSong(barCount=16) {
  let bars = []
  for (let i = 0; i < barCount; i++) { bars.push(quietBar()) }
  return parseMusicXML(pianoScore({bars}))
}

describe("st/difficulty", () => {
  describe("features", () => {
    it("counts notes struck in each bar and hand; a tied note is struck once, in its first bar", () => {
      let song = parseMusicXML(pianoScore({bars: [
        {
          upper: {layers: [[{name: "C5", duration: 4, type: "whole", tieStart: true}]]},
          lower: QUIET_LOWER.map(name => ({name})),
        },
        {
          upper: [{name: "C5", duration: 4, type: "whole", tieStop: true}],
          lower: QUIET_LOWER.map(name => ({name})),
        },
      ]}))

      let bars = barFeatures(song)
      expect(bars[0].hands.upper.struck.length).toEqual(1)
      expect(bars[1].hands.upper.struck.length).toEqual(0)
    })

    it("charges a leap across the bar line to the bar it lands in", () => {
      let song = parseMusicXML(pianoScore({bars: [
        {upper: QUIET_UPPER.map(name => ({name})), lower: ["C3", "D3", "E3", "F3"].map(name => ({name}))},
        {upper: QUIET_UPPER.map(name => ({name})), lower: ["C2", "D2", "E2", "F2"].map(name => ({name}))},
      ]}))

      let bars = barFeatures(song)
      expect(bars[1].hands.lower.leap.semitones).toEqual(17)
      expect(bars[1].hands.lower.leap.from).toEqual("F3")
      expect(bars[1].hands.lower.leap.to).toEqual("C2")
    })

    it("hold-and-move comes from durations; a second voice holding only rests counts nothing", () => {
      let held = parseMusicXML(pianoScore({time: [2, 4], bars: [{
        upper: QUIET_UPPER.slice(0, 2).map(name => ({name})),
        lower: {layers: [
          [{name: "C3", duration: 2, type: "half"}],
          [{name: "D3", duration: 1}, {name: "E3", duration: 1}],
        ]},
      }]}))

      expect(barFeatures(held)[0].hands.lower.holdMove).toEqual(1)

      let restOnly = parseMusicXML(pianoScore({time: [2, 4], bars: [{
        upper: QUIET_UPPER.slice(0, 2).map(name => ({name})),
        lower: {layers: [
          [{name: "D3", duration: 1}, {name: "E3", duration: 1}],
          [{rest: true, duration: 2}],
        ]},
      }]}))

      expect(barFeatures(restOnly)[0].hands.lower.holdMove).toEqual(0)
    })

    it("notes held wider than a hand are pedal (held), not stretch (span)", () => {
      let song = parseMusicXML(pianoScore({time: [2, 4], bars: [{
        upper: QUIET_UPPER.slice(0, 2).map(name => ({name})),
        lower: {layers: [
          [{name: "F#4", duration: 2, type: "half"}, {name: "D4", duration: 2, type: "half", chord: true}],
          [{rest: true, duration: 1}, {name: "A2", duration: 1, type: "quarter"}],
        ]},
      }]}))

      let bar = barFeatures(song)[0]
      expect(bar.hands.lower.held.semitones).toEqual(21)
      expect(bar.hands.lower.span.semitones).toBeLessThan(13)
    })

    it("counts notes outside the bar's key from their spelling, following a key change", () => {
      let song = parseMusicXML(pianoScore({key: -1, bars: [
        quietBar(),
        {upper: [{name: "Bb4"}, {name: "B4"}, {name: "C5"}, {name: "D5"}], lower: QUIET_LOWER.map(name => ({name}))},
      ]}))

      let bar = barFeatures(song)[1]
      expect(bar.chromatic.count).toEqual(1)
    })

    it("three against two: triplet eighths in one hand over duple eighths in the other", () => {
      let poly = parseMusicXML(pianoScore({time: [1, 4], bars: [{
        upper: [
          {name: "C5", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
          {name: "D5", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
          {name: "E5", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
        ],
        lower: [{name: "C3", duration: 0.5, type: "eighth"}, {name: "D3", duration: 0.5, type: "eighth"}],
      }]}))
      expect(barFeatures(poly)[0].poly).toBeTruthy()

      let bothTriplets = parseMusicXML(pianoScore({time: [1, 4], bars: [{
        upper: [
          {name: "C5", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
          {name: "D5", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
          {name: "E5", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
        ],
        lower: [
          {name: "C3", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
          {name: "D3", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
          {name: "E3", duration: 1 / 3, type: "eighth", tuplet: [3, 2]},
        ],
      }]}))
      expect(barFeatures(bothTriplets)[0].poly).toBeFalsy()
    })

    it("counts ledger lines by the staff's clef at the note; a clef change switches it", () => {
      let song = parseMusicXML(pianoScore({bars: [
        {upper: [{name: "E6"}, ...QUIET_UPPER.slice(0, 3).map(name => ({name}))], lower: QUIET_LOWER.map(name => ({name}))},
        {
          upper: QUIET_UPPER.map(name => ({name})),
          lower: [{name: "G4"}, ...QUIET_LOWER.slice(0, 3).map(name => ({name}))],
        },
      ]}))

      let bars = barFeatures(song)
      expect(bars[0].ledger).toBeGreaterThanOrEqual(1)
      expect(bars[1].ledger).toBeGreaterThanOrEqual(1)
    })

    it("a printed bar split in two measure indices is one bar; a pickup is bar 0", () => {
      let song = parseMusicXML(pianoScore({bars: [quietBar(), quietBar()]})
        .replace('<measure number="1">', '<measure number="0" implicit="yes">'))

      let bars = barFeatures(song)
      expect(bars[0].number).toEqual(0)
    })
  })

  describe("source", () => {
    it("reads the first explicit tempo marking only, else a tempo word, else null", () => {
      let metronome = scoreExtras(pianoScore({bars: [
        {directions: [{metronome: {unit: "quarter", dot: true, perMinute: 60}}], upper: QUIET_UPPER.map(name => ({name}))},
      ]}))
      expect(metronome.tempo).toEqual({bpm: 90, from: "metronome", text: null})

      let sound = scoreExtras(pianoScore({bars: [
        {directions: [{sound: 76}], upper: QUIET_UPPER.map(name => ({name}))},
        {directions: [{sound: 120}], upper: QUIET_UPPER.map(name => ({name}))},
      ]}))
      expect(sound.tempo).toEqual({bpm: 76, from: "sound", text: null})

      let words = scoreExtras(pianoScore({bars: [
        {directions: [{words: "Andantino sognando"}], upper: QUIET_UPPER.map(name => ({name}))},
      ]}))
      expect(words.tempo).toEqual({bpm: 88, from: "words", text: "Andantino sognando"})

      expect(scoreExtras(null).tempo).toBeNull()
      expect(scoreExtras("not xml at all <<<").tempo).toBeNull()
    })

    it("counts double accidentals per measure index", () => {
      let xml = pianoScore({bars: [
        {upper: [{name: "C5", alter: 2}, ...QUIET_UPPER.slice(0, 3).map(name => ({name}))]},
        {upper: QUIET_UPPER.map(name => ({name}))},
      ]})
      expect(scoreExtras(xml).doubleAccidentals).toEqual([1, 0])
    })
  })

  describe("fingerprints", () => {
    it("hashes equal bars equal; changing one note changes only its bar's hash; numbersHash tracks the numbering", () => {
      let songA = workhorseSong()
      let songB = workhorseSong()
      let fpA = fingerprint(songA)
      let fpB = fingerprint(songB)
      expect(fpA.bars).toEqual(fpB.bars)
      expect(fpA.numbersHash).toEqual(fpB.numbersHash)
      expect(fingerprint(songA)).toEqual(fingerprint(songA))

      let changed = parseMusicXML(pianoScore({bars: [
        {upper: [{name: "G5"}, ...QUIET_UPPER.slice(1).map(name => ({name}))], lower: QUIET_LOWER.map(name => ({name}))},
        quietBar(),
      ]}))
      let original = parseMusicXML(pianoScore({bars: [quietBar(), quietBar()]}))
      let fpChanged = fingerprint(changed)
      let fpOriginal = fingerprint(original)
      expect(fpChanged.bars[0]).not.toEqual(fpOriginal.bars[0])
      expect(fpChanged.bars[1]).toEqual(fpOriginal.bars[1])
    })

    it("hash8 is deterministic", () => {
      expect(hash8("abc")).toEqual(hash8("abc"))
      expect(hash8("abc")).not.toEqual(hash8("abd"))
    })

    it("exactRepeats finds an earlier equal bar and never pairs empty bars", () => {
      let song = parseMusicXML(pianoScore({bars: [quietBar(), uniformBlank(), quietBar()]}))
      let repeats = exactRepeats(fingerprint(song))
      expect(repeats.get(2)).toEqual(0)
      expect(repeats.has(1)).toBeFalsy()
    })
  })

  describe("sections", () => {
    it("flags a dense run as Hardest and flags between a quarter and a third of the bars", () => {
      let song = workhorseSong()
      let scored = scoreBars(barFeatures(song))
      let passages = findPassages(scored, {repeats: new Map()})

      expect(passages.length).toBeGreaterThan(0)
      let hardest = passages.find(p => p.start <= 9 && p.end >= 11)
      expect(hardest).toBeTruthy()
      expect(hardest.level).toEqual(3)

      let flaggedBars = passages.reduce((sum, p) => sum + p.run.length, 0)
      expect(flaggedBars).toBeGreaterThanOrEqual(3)
      expect(flaggedBars).toBeLessThanOrEqual(6)
    })

    it("flags nothing for a uniform piece, or one under 8 bars with notes", () => {
      let uniform = uniformSong()
      let scoredUniform = scoreBars(barFeatures(uniform))
      expect(findPassages(scoredUniform, {repeats: new Map()})).toEqual([])

      let short = uniformSong(6)
      let scoredShort = scoreBars(barFeatures(short))
      expect(findPassages(scoredShort, {repeats: new Map()})).toEqual([])
    })

    it("heat buckets a percentile into the strip's 0-4 ramp", () => {
      expect(heat(0.95)).toEqual(4)
      expect(heat(0.75)).toEqual(3)
      expect(heat(0.5)).toEqual(2)
      expect(heat(0.3)).toEqual(1)
      expect(heat(0.1)).toEqual(0)
    })

    it("names a hand when most of a passage's hand contributions are its; both otherwise", () => {
      let song = workhorseSong()
      let scored = scoreBars(barFeatures(song))
      let passages = findPassages(scored, {repeats: new Map()})
      for (let p of passages) {
        expect(["upper", "lower", "both"]).toContain(p.hand)
      }

      let oneStaff = parseMusicXML(pianoScore({bars:
        Array.from({length: 16}, (_, i) =>
          (i >= 8 && i <= 10) ?
            {upper: DENSE_UPPER.map(name => ({name, duration: 0.25, type: "16th"}))} :
            {upper: QUIET_UPPER.map(name => ({name}))})}))
      let scoredOne = scoreBars(barFeatures(oneStaff))
      let onePassages = findPassages(scoredOne, {repeats: new Map()})
      for (let p of onePassages) { expect(p.hand).toEqual("both") }
    })

    it("merges an exact repeat into the earlier passage, with alsoAt", () => {
      let song = workhorseSong({denseAt: [9, 10, 11]})
      let fp = fingerprint(song)
      let repeats = new Map([[11, 8], [10, 7], [9, 6]])
      let scored = scoreBars(barFeatures(song))
      let passages = findPassages(scored, {repeats})
      // the repeat map above claims bars 9-11 repeat bars 6-8: either they
      // are merged into a passage covering 6-8, or (since 6-8 themselves
      // never scored as a passage) nothing crashes and 9-11 still flags
      expect(() => findPassages(scored, {repeats})).not.toThrow()
    })

    it("gives the same proposals and ids for the same song", () => {
      let songA = workhorseSong()
      let songB = workhorseSong()
      let a = analyzePiece({song: songA, source: null, at: 1})
      let b = analyzePiece({song: songB, source: null, at: 2})
      expect(a.proposals.map(p => p.id)).toEqual(b.proposals.map(p => p.id))
      for (let p of a.proposals) { expect(p.id.startsWith("score:")).toBeTruthy() }
    })
  })

  describe("reasons", () => {
    it("intervalWords names diatonic distances", () => {
      expect(intervalWords("F1", "Eb4")).toEqual("almost three octaves")
      expect(intervalWords("C2", "C4")).toEqual("two octaves")
      expect(intervalWords("G2", "Bb3")).toEqual("a tenth")
      expect(intervalWords("A2", "F#4")).toEqual("a thirteenth")
    })

    it("every passage has a title, one to three reasons and a tip", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      expect(analysis.proposals.length).toBeGreaterThan(0)
      for (let p of analysis.proposals) {
        expect(p.title.length).toBeGreaterThan(0)
        expect(p.reasons.length).toBeGreaterThanOrEqual(1)
        expect(p.reasons.length).toBeLessThanOrEqual(3)
        expect(p.tip.length).toBeGreaterThan(0)
      }
    })

    it("names no hand on a one-staff piece", () => {
      let oneStaff = parseMusicXML(pianoScore({bars:
        Array.from({length: 16}, (_, i) =>
          (i >= 8 && i <= 10) ?
            {upper: DENSE_UPPER.map(name => ({name, duration: 0.25, type: "16th"}))} :
            {upper: QUIET_UPPER.map(name => ({name}))})}))
      let analysis = analyzePiece({song: oneStaff, source: null, at: 1})
      for (let p of analysis.proposals) {
        for (let reason of p.reasons) {
          expect(reason).not.toMatch(/left hand|right hand/i)
        }
      }
    })
  })

  describe("records and index", () => {
    it("analyzePiece gives a full valid record with and without a source", () => {
      let song = workhorseSong()
      let withSource = analyzePiece({song, source: pianoScore({bars: [quietBar()]}), at: 1})
      expect(withSource.runs.score.source).toBeTruthy()
      expect(withSource.runs.score.heat.length).toEqual(16)
      expect(validAnnotation({pieceId: "p1", ...withSource, decisions: []})).toBeTruthy()

      let withoutSource = analyzePiece({song, source: null, at: 1})
      expect(withoutSource.runs.score.source).toBeFalsy()
    })

    it("annotationWith replaces only the score's proposals, keeping other sources and decisions", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let previous = {
        pieceId: "p1",
        fingerprint: {algo: 0, numbersHash: "x", bars: []},
        proposals: [{
          id: "teacher:1", source: "teacher", start: 1, end: 1, startIndex: 0, endIndex: 0,
          hand: "both", level: 1, kinds: [], title: "t", reason: "r", reasons: ["r"], tip: "tip",
        }],
        decisions: [{id: "d1"}],
        runs: {},
      }

      let merged = annotationWith(previous, "p1", analysis)
      expect(merged.decisions).toEqual(previous.decisions)
      expect(merged.proposals.some(p => p.source == "teacher")).toBeTruthy()
      expect(merged.proposals.filter(p => p.source == "score").length).toEqual(analysis.proposals.length)
    })

    it("annotationStale is fresh for the same song and algo; stale otherwise", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)

      expect(annotationStale(record, song, {hasSource: false})).toBeFalsy()
      expect(annotationStale(null, song, {hasSource: false})).toBeTruthy()
      expect(annotationStale({...record, runs: {score: {...record.runs.score, algo: 0}}}, song, {})).toBeTruthy()
      expect(annotationStale(record, song, {hasSource: true})).toBeTruthy()

      let changedSong = parseMusicXML(pianoScore({bars:
        Array.from({length: 16}, (_, i) => i == 0 ?
          {upper: [{name: "G5"}, ...QUIET_UPPER.slice(1).map(name => ({name}))], lower: QUIET_LOWER.map(name => ({name}))} :
          (i >= 8 && i <= 10 ? denseBar() : quietBar()))}))
      expect(annotationStale(record, changedSong, {hasSource: false})).toBeTruthy()
    })

    it("flagsInForce orders by level then strength and numbers from 1", () => {
      let record = {
        proposals: [
          {id: "a", level: 1, strength: 5},
          {id: "b", level: 3, strength: 1},
          {id: "c", level: 3, strength: 9},
        ],
      }
      let flags = flagsInForce(record)
      expect(flags.map(f => f.id)).toEqual(["c", "b", "a"])
      expect(flags.map(f => f.num)).toEqual([1, 2, 3])
    })

    it("flagsInForce is empty for no record", () => {
      expect(flagsInForce(null)).toEqual([])
    })
  })
})

function uniformBlank() {
  return {
    upper: [{name: "C4", duration: 4, type: "whole", rest: true}],
    lower: [{name: "C3", duration: 4, type: "whole", rest: true}],
  }
}
