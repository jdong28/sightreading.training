import {parseMusicXML} from "st/musicxml"
import {pianoScore} from "spec/helpers"

import {hash8, fingerprint, exactRepeats, FINGERPRINT_ALGO} from "st/difficulty/fingerprints"
import {scoreExtras} from "st/difficulty/source"
import {barFeatures} from "st/difficulty/features"
import {scoreBars, findPassages, heat, ANALYZER_ALGO} from "st/difficulty/sections"
import {intervalWords, passageReasons} from "st/difficulty/reasons"
import {validAnnotation, flagsInForce} from "st/difficulty/records"
import {analyzePiece, annotationWith, annotationStale} from "st/difficulty/index"
import {
  validDecision, reviewFlags, withDecisions, startApartBars,
  acceptDecision, editDecision, dismissDecision, restoreDecision, addDecision, promoteTroubleSpot,
} from "st/difficulty/decisions"
import {barSimilarity, alignBars, mapRange} from "st/difficulty/align"
import {
  FLAGS_FORMAT, FLAGS_VERSION, MAX_FLAGS_FILE_BYTES, MAX_FLAGS_FILE_DECISIONS,
  flagsFileFor, readFlagsFile, fileMatch, reanchorDecisions,
} from "st/difficulty/flags_file"
import {troubleSpots} from "st/difficulty/trouble"

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

// one already-scored bar as scoreBars leaves it, for the findPassages tests
// that need a given shape of scores across a piece
function scoredBar(number, score, top=null) {
  return {
    number,
    indices: [number - 1, number - 1],
    beats: [number - 1, number],
    hands: {upper: {}, lower: null},
    density: {notes: 4, perBeat: 1, perSecond: null},
    score,
    top: top || [{kind: "density", hand: null, contribution: score, detail: {perBeat: 1, perSecond: null}}],
  }
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

    it("a pickup and the short final bar that compensates it are no meter change", () => {
      let shortBar = beats => ({
        upper: QUIET_UPPER.slice(0, beats).map(name => ({name})),
        lower: QUIET_LOWER.slice(0, beats).map(name => ({name})),
        beats,
      })

      let compensated = Array.from({length: 10}, () => quietBar())
      compensated[0] = shortBar(1)
      compensated[9] = shortBar(3)
      let withPickup = parseMusicXML(pianoScore({bars: compensated})
        .replace('<measure number="1">', '<measure number="0" implicit="yes">'))

      let bars = barFeatures(withPickup)
      expect(bars[0].number).toEqual(0)
      expect(bars[bars.length - 1].number).toEqual(9)
      expect(bars.filter(b => b.timeChange).map(b => b.number)).toEqual([])

      let inside = Array.from({length: 10}, () => quietBar())
      inside[4] = shortBar(3)
      let interior = barFeatures(parseMusicXML(pianoScore({bars: inside})))
      expect(interior.filter(b => b.timeChange).map(b => b.number)).toContain(5)
    })

    it("counts a note written with a double accidental once, naming it as one", () => {
      let xml = pianoScore({bars: [
        quietBar(),
        {
          upper: [{name: "B4", alter: 2}, {name: "D4"}, {name: "E4"}, {name: "F4"}],
          lower: QUIET_LOWER.map(name => ({name})),
        },
      ]})
      let bars = barFeatures(parseMusicXML(xml), scoreExtras(xml))
      expect(bars[1].chromatic).toEqual({count: 1, hasDouble: true})
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
      expect(metronome.tempo).toEqual({bpm: 90, from: "metronome", word: null})

      let sound = scoreExtras(pianoScore({bars: [
        {directions: [{sound: 76}], upper: QUIET_UPPER.map(name => ({name}))},
        {directions: [{sound: 120}], upper: QUIET_UPPER.map(name => ({name}))},
      ]}))
      expect(sound.tempo).toEqual({bpm: 76, from: "sound", word: null})

      let words = scoreExtras(pianoScore({bars: [
        {directions: [{words: "Andantino sognando"}], upper: QUIET_UPPER.map(name => ({name}))},
      ]}))
      expect(words.tempo).toEqual({bpm: 88, from: "words", word: "andantino"})

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

    it("trims a run wider than the budget to its hardest bars", () => {
      // bars 3, 5 and 7 are hard and the bars between them easy, so bridging
      // makes one five-bar run — one bar more than this 12-bar piece's
      // budget, which must still flag its hardest bars
      let scores = [0, 0, 5, 0, 5, 0, 5, 0, 0, 0, 0, 0]
      let scored = scores.map((score, i) => scoredBar(i + 1, score))
      let passages = findPassages(scored, {repeats: new Map()})

      // bars 3-5, never 3-6: bar 6 is only bridged into the run, so a
      // passage never opens or closes on it
      expect(passages.map(p => [p.start, p.end])).toEqual([[3, 5]])
      expect(passages[0].run.length).toEqual(3)

      // and a piece whose looser thresholds bridge nearly everything into
      // one run still flags within its budget of six bars
      let wide = [1, 2.2, 3, 1.6, 5.5, 4, 5.5, 0.2, 3, 0.2, 0.2, 4, 2.2, 0.2, 2.2, 4]
        .map((score, i) => scoredBar(i + 1, score))
      let widePassages = findPassages(wide, {repeats: new Map()})
      expect(widePassages.length).toBeGreaterThan(0)
      expect(widePassages.reduce((sum, p) => sum + p.run.length, 0)).toBeLessThanOrEqual(6)
    })

    it("splits a run wider than eight bars without leaving a bridged bar at an edge", () => {
      // bar 2 is only bridged between bars 1 and 3, and the ten-bar run's
      // weakest interior bar is bar 3, so the split lands beside it
      let scores = [20, 0, 10, 20, 20, 20, 20, 20, 20, 20, ...new Array(18).fill(0)]
      let scored = scores.map((score, i) => scoredBar(i + 1, score))
      let passages = findPassages(scored, {repeats: new Map()})

      // the left half of the split is bars 1-2, so it keeps bar 1 alone
      expect(passages.map(p => [p.start, p.end])).toEqual([[1, 1], [4, 10]])
      for (let p of passages) {
        expect(p.run[0].score).toBeGreaterThan(0)
        expect(p.run[p.run.length - 1].score).toBeGreaterThan(0)
      }
    })

    it("a run resting on one signal stays Worth a look however high it scores", () => {
      let scores = [0.2, 0.2, 0.2, 0.2, 9, 9, 9, 0.2, 0.2, 0.2, 0.2, 0.2]
      let oneSignal = scores.map((score, i) => scoredBar(i + 1, score))
      expect(findPassages(oneSignal, {repeats: new Map()}).map(p => [p.start, p.end, p.level]))
        .toEqual([[4, 7, 1]])

      let twoSignals = scores.map((score, i) => scoredBar(i + 1, score, [
        {kind: "density", hand: null, contribution: score / 2, detail: {perBeat: 1, perSecond: null}},
        {kind: "leap", hand: "upper", contribution: score / 2, detail: {semitones: 20, from: "C4", to: "G5"}},
      ]))
      expect(findPassages(twoSignals, {repeats: new Map()}).map(p => [p.start, p.end, p.level]))
        .toEqual([[4, 7, 3]])
    })

    it("ranks the heat strip over the bars that strike a note only", () => {
      // a bar of sixteenths in one hand only, between the quiet bars and the
      // dense ones, so its rank moves if anything is added to the ranking
      let halfDense = {
        upper: DENSE_UPPER.map(name => ({name, duration: 0.25, type: "16th"})),
        lower: QUIET_LOWER.map(name => ({name})),
      }
      let bars = [
        ...Array.from({length: 8}, () => quietBar()),
        denseBar(), denseBar(), denseBar(),
        halfDense,
        quietBar(), quietBar(),
      ]
      let heatOf = songBars =>
        analyzePiece({song: parseMusicXML(pianoScore({bars: songBars})), source: null, at: 1})
          .runs.score.heat

      let noted = heatOf(bars)
      let withBlanks = heatOf([...bars, uniformBlank(), uniformBlank()])

      expect(withBlanks.length).toEqual(16)
      expect([withBlanks[14], withBlanks[15]]).toEqual([0, 0])
      expect(withBlanks[11]).toBeGreaterThan(0)
      expect(withBlanks[11]).toBeLessThan(withBlanks[8])

      // the blank bars are no part of the ranking: every bar that strikes a
      // note reads just as it does in the same piece without them
      expect(withBlanks.slice(0, 14)).toEqual(noted)
    })

    it("ranks a piece's hardest bars at the top of the strip, however many tie", () => {
      // four bars of the same dense writing: they are the hardest thing in
      // the piece and must read as that, not as a notch below it
      let analysis = analyzePiece({song: workhorseSong({denseAt: [9, 10, 11, 12]}), source: null, at: 1})
      let heatPct = analysis.runs.score.heat

      expect(analysis.proposals.map(p => [p.start, p.end, p.level])).toEqual([[9, 12, 3]])

      for (let number of [9, 10, 11, 12]) {
        expect(heat(heatPct[number - 1])).toEqual(4)
      }
      for (let number of [1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16]) {
        expect(heat(heatPct[number - 1])).toEqual(0)
      }
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
      // the same dense run twice over: bars 17-19 repeat bars 5-7 note for note
      let song = workhorseSong({denseAt: [5, 6, 7, 17, 18, 19], barCount: 24})
      let scored = scoreBars(barFeatures(song))

      let unmerged = findPassages(scored, {repeats: new Map()})
      expect(unmerged.map(p => [p.start, p.end]).sort((a, b) => a[0] - b[0]))
        .toEqual([[5, 7], [17, 19]])

      let repeats = exactRepeats(fingerprint(song))
      let passages = findPassages(scored, {repeats})
      expect(passages.map(p => [p.start, p.end])).toEqual([[5, 7]])
      expect(passages[0].alsoAt).toEqual([[17, 19]])

      let proposals = analyzePiece({song, source: null, at: 1}).proposals
      expect(proposals.map(p => p.alsoAt)).toEqual([[[17, 19]]])

      // the passage's own reasons give way to where it recurs, which is
      // always the last thing it says
      expect(proposals[0].reasons.length).toEqual(3)
      expect(proposals[0].reasons[2]).toEqual("Also at bars 17–19.")
    })

    it("merges a repeat into the earliest flagged copy, the first copy unflagged", () => {
      // the same two-bar statement three times over, at bars 2-3, 6-7 and
      // 10-11: the first scores below the flag threshold, so the merge has
      // to key on the bars' material rather than on where it first appears
      let scores = [0.2, 3, 3, 0.2, 0.2, 4, 4, 0.2, 0.2, 4, 4, 0.2]
      let scored = scores.map((score, i) => scoredBar(i + 1, score))
      let repeats = new Map([[5, 1], [6, 2], [9, 1], [10, 2]])

      expect(findPassages(scored, {repeats: new Map()}).map(p => [p.start, p.end]))
        .toEqual([[6, 7], [10, 11]])

      let passages = findPassages(scored, {repeats})
      expect(passages.map(p => [p.start, p.end])).toEqual([[6, 7]])
      expect(passages[0].alsoAt).toEqual([[10, 11]])
      expect(passageReasons(passages[0], {bars: scored}).reasons)
        .toContain("Also at bars 10–11.")
    })

    it("names every range a passage recurs at in one sentence", () => {
      // the same two-bar figure four times over: bars 1-2, 7-8, 13-14 and
      // 19-20, all four within this 24-bar piece's budget
      let figureAt = [1, 2, 7, 8, 13, 14, 19, 20]
      let scored = Array.from({length: 24}, (_, i) =>
        scoredBar(i + 1, figureAt.includes(i + 1) ? 5 : 0))
      let repeats = new Map([[6, 0], [7, 1], [12, 0], [13, 1], [18, 0], [19, 1]])

      expect(findPassages(scored, {repeats: new Map()}).map(p => [p.start, p.end]))
        .toEqual([[1, 2], [7, 8], [13, 14], [19, 20]])

      let passages = findPassages(scored, {repeats})
      expect(passages.map(p => [p.start, p.end])).toEqual([[1, 2]])
      expect(passages[0].alsoAt).toEqual([[7, 8], [13, 14], [19, 20]])

      let reasons = passageReasons(passages[0], {bars: scored}).reasons
      expect(reasons.length).toBeLessThanOrEqual(3)
      expect(reasons[reasons.length - 1]).toEqual("Also at bars 7–8, 13–14 and 19–20.")
    })

    it("keeps a passage that repeats only part of another as its own flag", () => {
      // bars 1-4 are the passage; bars 7-8 repeat its bars 2-3 note for note,
      // which is a part of it, not a copy of it
      let scores = [4, 4, 4, 4, 0.2, 0.2, 3.5, 3.5, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
      let scored = scores.map((score, i) => scoredBar(i + 1, score))
      let repeats = new Map([[6, 1], [7, 2]])

      let passages = findPassages(scored, {repeats})
      expect(passages.map(p => [p.start, p.end]).sort((a, b) => a[0] - b[0]))
        .toEqual([[1, 4], [7, 8]])
      for (let p of passages) { expect(p.alsoAt).toBeUndefined() }

      for (let p of passages) {
        for (let reason of passageReasons(p, {bars: scored}).reasons) {
          expect(reason).not.toMatch(/Also at|recur/)
        }
      }
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

    it("a tempo guessed from a marking is named as an estimate, a metronome mark is not", () => {
      function densityReason(direction) {
        let bars = Array.from({length: 16}, (_, i) => (i >= 8 && i <= 10) ? denseBar() : quietBar())
        bars[0] = {...bars[0], directions: [direction]}
        let xml = pianoScore({bars})
        let analysis = analyzePiece({song: parseMusicXML(xml), source: xml, at: 1})
        return analysis.proposals.flatMap(p => p.reasons).find(r => r.includes("notes a second"))
      }

      expect(densityReason({words: "Allegro con brio"})).toContain("at Allegro, taken as ♩ = 132")

      let stated = densityReason({metronome: {unit: "quarter", perMinute: 92}})
      expect(stated).toContain("at ♩ = 92")
      expect(stated).not.toContain("taken as")
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

    it("validAnnotation rejects the proposal fields the plate renders unchecked", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let proposal = record.proposals[0]
      let withFields = fields => ({
        ...record,
        proposals: [{...proposal, ...fields}, ...record.proposals.slice(1)],
      })

      expect(validAnnotation(record)).toBeTruthy()
      expect(validAnnotation(withFields({alsoAt: [[9, 11]]}))).toBeTruthy()
      expect(validAnnotation(withFields({alsoAt: []}))).toBeTruthy()

      // alsoAt is where the passage recurs: bar ranges, whole and in order
      for (let bad of [5, "9-11", ["9-11"], [null], [[9]], [[9, 11, 13]],
        [[9, "11"]], [[11, 9]], [[9, 11.5]]]) {
        expect(validAnnotation(withFields({alsoAt: bad}))).toBeFalsy()
      }

      // the reasons are rendered as React children, so each must be a string
      expect(validAnnotation(withFields({reasons: ["why"]}))).toBeTruthy()
      for (let bad of [[{}], [null], [["why"]], [3]]) {
        expect(validAnnotation(withFields({reasons: bad}))).toBeFalsy()
      }

      // the plate walks the bars of a range, so a range is whole and in order
      for (let bad of [{start: 1, end: 1e9 + 0.5}, {start: 11, end: 9},
        {start: 1.5, end: 3}, {startIndex: 3, endIndex: 1}, {startIndex: 0.5, endIndex: 3}]) {
        expect(validAnnotation(withFields(bad))).toBeFalsy()
      }
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

  describe("decisions", () => {
    function barsWithDense(denseAt, barCount = 16) {
      let bars = []
      for (let i = 1; i <= barCount; i++) { bars.push(denseAt.includes(i) ? denseBar() : quietBar()) }
      return bars
    }

    it("with no decisions, flagsInForce returns exactly stage 1's flags, order and numbers", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flags = flagsInForce(record)

      let expectedOrder = [...analysis.proposals]
        .sort((a, b) => b.level - a.level || (b.strength || 0) - (a.strength || 0) || a.start - b.start)
        .map(p => p.id)
      expect(flags.map(f => f.id)).toEqual(expectedOrder)
      expect(flags.map(f => f.num)).toEqual(flags.map((_, i) => i + 1))
      expect(flags.every(f => f.status == "waiting")).toBeTruthy()
    })

    it("accept marks a flag accepted; a re-analysis with a changed reason keeps it accepted and shows the new reason", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]

      record = withDecisions(record, [acceptDecision({record, flag, by: "Ms Laurent", at: 10})])
      expect(reviewFlags(record).find(f => f.id == flag.id).status).toEqual("accepted")

      let changedProposals = record.proposals.map(p =>
        p.id == flag.id ? {...p, reason: "changed", reasons: ["changed"]} : p)
      let reanalysed = {...record, proposals: changedProposals}

      let after = reviewFlags(reanalysed).find(f => f.id == flag.id)
      expect(after.status).toEqual("accepted")
      expect(after.lines.map(l => l.text)).toContain("changed")
    })

    it("editing the title keeps the analysis's name as givenTitle; clearing it restores the analysis's name", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]
      let originalTitle = flag.title

      record = withDecisions(record,
        [editDecision({record, flag, overrides: {title: "My name for it"}, by: "Ms Laurent", at: 10})])
      let renamed = reviewFlags(record).find(f => f.id == flag.id)
      expect(renamed.title).toEqual("My name for it")
      expect(renamed.givenTitle).toEqual(originalTitle)

      // a re-analysis doesn't clobber either name
      let reanalysed = annotationWith(record, "p1", analysis)
      let afterReanalysis = reviewFlags(reanalysed).find(f => f.id == flag.id)
      expect(afterReanalysis.title).toEqual("My name for it")
      expect(afterReanalysis.givenTitle).toEqual(originalTitle)

      // "Use that name" is the next edit, with no title of its own
      let cleared = withDecisions(reanalysed,
        [editDecision({record: reanalysed, flag: afterReanalysis, overrides: {}, by: "Ms Laurent", at: 20})])
      let final = reviewFlags(cleared).find(f => f.id == flag.id)
      expect(final.title).toEqual(originalTitle)
      expect(final.givenTitle).toBeUndefined()
    })

    it("editing the reason puts the teacher's sentence first, then the score's reasons; a blank reason keeps only the score's", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]

      record = withDecisions(record, [editDecision({
        record, flag, overrides: {reason: "Watch the left hand's leap", tip: "Hands separately first"},
        by: "Ms Laurent", at: 10,
      })])
      let result = reviewFlags(record).find(f => f.id == flag.id)
      expect(result.lines[0]).toEqual({source: "teacher", text: "Watch the left hand's leap"})
      expect(result.lines.slice(1).every(l => l.source == "score")).toBeTruthy()
      expect(result.lines.length).toEqual(flag.lines.length + 1)
      expect(result.tip).toEqual("Hands separately first")

      let after = reviewFlags(withDecisions(record, [editDecision({
        record, flag: result, overrides: {reason: "", tip: "Hands separately first"}, by: "Ms Laurent", at: 20,
      })])).find(f => f.id == flag.id)
      expect(after.lines.every(l => l.source == "score")).toBeTruthy()
      expect(after.lines.length).toEqual(flag.lines.length)
    })

    it("dismiss takes a flag out of force; it stays dismissed across a re-analysis, even one that changes the proposal's kinds", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]

      record = withDecisions(record, [dismissDecision({record, flag, by: "Ms Laurent", at: 10})])
      expect(flagsInForce(record).some(f => f.id == flag.id)).toBeFalsy()
      expect(reviewFlags(record).find(f => f.id == flag.id).status).toEqual("dismissed")

      let reanalysed = annotationWith(record, "p1", analysis)
      expect(flagsInForce(reanalysed).some(f => f.id == flag.id)).toBeFalsy()

      let driftedProposals = reanalysed.proposals.map(p =>
        p.id == flag.id ? {...p, id: "score:drifted", kinds: ["leap"]} : p)
      let drifted = {...reanalysed, proposals: driftedProposals}
      expect(flagsInForce(drifted).some(f => f.id == "score:drifted")).toBeFalsy()
      let driftedFlag = reviewFlags(drifted)
        .find(f => f.startIndex == flag.startIndex && f.endIndex == flag.endIndex)
      expect(driftedFlag.status).toEqual("dismissed")
    })

    it("restore returns a flag to the state it held before the dismissal", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]

      record = withDecisions(record, [dismissDecision({record, flag, by: "", at: 10})])
      record = withDecisions(record,
        [restoreDecision({record, flag: reviewFlags(record).find(f => f.id == flag.id), by: "", at: 20})])
      expect(reviewFlags(record).find(f => f.id == flag.id).status).toEqual("waiting")

      record = withDecisions(record,
        [acceptDecision({record, flag: reviewFlags(record).find(f => f.id == flag.id), by: "", at: 30})])
      record = withDecisions(record,
        [dismissDecision({record, flag: reviewFlags(record).find(f => f.id == flag.id), by: "", at: 40})])
      expect(reviewFlags(record).find(f => f.id == flag.id).status).toEqual("dismissed")
      record = withDecisions(record,
        [restoreDecision({record, flag: reviewFlags(record).find(f => f.id == flag.id), by: "", at: 50})])
      expect(reviewFlags(record).find(f => f.id == flag.id).status).toEqual("accepted")
    })

    it("add puts a teacher's own flag in force; promoteTroubleSpot puts a player's flag in force waiting, until the teacher decides", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)

      let add = addDecision({
        record, by: "Ms Laurent", at: 10,
        flag: {
          start: 1, end: 1, startIndex: 0, endIndex: 0, hand: "both", level: 1, kinds: [],
          title: "Mind the pedal", reason: "", tip: "", apart: false,
        },
      })
      record = withDecisions(record, [add])
      let added = flagsInForce(record).find(f => f.id == add.flagId)
      expect(added.status).toEqual("added")
      expect(added.sources).toEqual(["teacher"])

      let promote = promoteTroubleSpot({
        record, by: "", at: 20,
        spot: {start: 3, end: 3, startIndex: 2, endIndex: 2, hand: "lower", text: "Slow and uneven"},
      })
      record = withDecisions(record, [promote])
      let promoted = flagsInForce(record).find(f => f.id == promote.flagId)
      expect(promoted.status).toEqual("waiting")
      expect(promoted.sources).toEqual(["player"])

      record = withDecisions(record, [acceptDecision({record, flag: promoted, by: "Ms Laurent", at: 30})])
      expect(flagsInForce(record).find(f => f.id == promote.flagId).status).toEqual("accepted")
    })

    it("folds by at, not array order; withDecisions is idempotent; an older at never overrides a newer one", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]

      let accept = acceptDecision({record, flag, by: "", at: 100})
      let dismiss = dismissDecision({record, flag, by: "", at: 50})

      let withBoth = withDecisions(record, [accept, dismiss])
      expect(reviewFlags(withBoth).find(f => f.id == flag.id).status).toEqual("accepted")

      let again = withDecisions(withBoth, [accept, dismiss])
      expect(again.decisions.length).toEqual(withBoth.decisions.length)
      expect(again).toEqual(withBoth)
    })

    it("an accepted or edited flag whose proposal a later analysis drops still stands, from `given`", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]

      record = withDecisions(record,
        [editDecision({record, flag, overrides: {tip: "Hands separately"}, by: "Ms Laurent", at: 10})])

      let droppedProposals = record.proposals.filter(p => p.id != flag.id)
      let reanalysed = {...record, proposals: droppedProposals}

      let stillThere = flagsInForce(reanalysed).find(f => f.id == flag.id)
      expect(stillThere).toBeTruthy()
      expect(stillThere.title).toEqual(flag.title)
      expect(stillThere.tip).toEqual("Hands separately")
    })

    it("changing a note in a decided bar marks it check, still in force; a new accept anchors afresh and clears it", () => {
      let song = parseMusicXML(pianoScore({bars: barsWithDense([9, 10, 11])}))
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let hardest = flagsInForce(record).find(f => f.start <= 9 && f.end >= 11)
      expect(hardest).toBeTruthy()

      record = withDecisions(record, [acceptDecision({record, flag: hardest, by: "", at: 10})])

      let changedBars = barsWithDense([9, 10, 11])
      changedBars[8] = {
        ...changedBars[8],
        upper: [{name: "G4", duration: 0.25, type: "16th"}, ...changedBars[8].upper.slice(1)],
      }
      let changedSong = parseMusicXML(pianoScore({bars: changedBars}))
      let changedAnalysis = analyzePiece({song: changedSong, source: null, at: 2})
      let reanalysed = annotationWith(record, "p1", changedAnalysis)

      let checked = flagsInForce(reanalysed)
        .find(f => f.startIndex == hardest.startIndex && f.endIndex == hardest.endIndex)
      expect(checked).toBeTruthy()
      expect(checked.place).toEqual("check")

      let cleared = withDecisions(reanalysed, [acceptDecision({record: reanalysed, flag: checked, by: "", at: 20})])
      let final = flagsInForce(cleared)
        .find(f => f.startIndex == hardest.startIndex && f.endIndex == hardest.endIndex)
      expect(final.place).toEqual("placed")
    })

    it("an unplaced decision is never in force, but appears in reviewFlags", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)

      let decision = {
        flagId: "added:unplaced1", action: "add", at: 10, by: "Ms Laurent", source: "teacher",
        flag: {
          start: 19, end: 21, startIndex: 18, endIndex: 20, hand: "both", level: 1, kinds: [],
          title: "From Ms Laurent's copy", reason: "", tip: "", apart: false,
        },
        anchor: {bars: ["x", "y", "z"]},
        unplaced: {start: 19, end: 21},
      }
      record = withDecisions(record, [decision])

      expect(flagsInForce(record).some(f => f.id == "added:unplaced1")).toBeFalsy()
      let flag = reviewFlags(record).find(f => f.id == "added:unplaced1")
      expect(flag).toBeTruthy()
      expect(flag.place).toEqual("unplaced")
    })

    it("validAnnotation accepts an empty decisions array and rejects malformed decisions", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      expect(validAnnotation(record)).toBeTruthy()

      let base = {flagId: "x", action: "accept", at: 1, by: "", anchor: {bars: []}}
      expect(validDecision(base)).toBeTruthy()
      expect(validDecision({...base, action: "bogus"})).toBeFalsy()
      expect(validDecision({...base, at: "1"})).toBeFalsy()
      expect(validDecision({...base, of: {source: "score", startIndex: 5, endIndex: 2}})).toBeFalsy()
      expect(validDecision({...base, anchor: {}})).toBeFalsy()
      expect(validDecision({...base, action: "add", source: "teacher"})).toBeFalsy()
      expect(validDecision({
        ...base, action: "add", source: "teacher",
        flag: {
          start: 1, end: 1, startIndex: 0, endIndex: 0, hand: "both", level: 1, kinds: [],
          title: "t", reason: "", tip: "",
        },
      })).toBeTruthy()

      expect(validAnnotation({...record, decisions: [{...base, action: "bogus"}]})).toBeFalsy()
    })

    it("startApartBars gives the hand(s) of every flag in force ticked apart; dismissed gives nothing", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)

      let add = addDecision({
        record, by: "Ms Laurent", at: 10,
        flag: {
          start: 5, end: 5, startIndex: 4, endIndex: 4, hand: "lower", level: 1, kinds: [],
          title: "t", reason: "", tip: "", apart: true,
        },
      })
      let bothAdd = addDecision({
        record, by: "Ms Laurent", at: 11,
        flag: {
          start: 20, end: 20, startIndex: 19, endIndex: 19, hand: "both", level: 1, kinds: [],
          title: "t2", reason: "", tip: "", apart: true,
        },
      })
      record = withDecisions(record, [add, bothAdd])

      let flags = flagsInForce(record)
      let map = startApartBars(flags)
      expect(map.get(5)).toEqual(["lower"])
      expect(map.get(20)).toEqual(["upper", "lower"])

      let addedFlag = flags.find(f => f.id == add.flagId)
      record = withDecisions(record, [dismissDecision({record, flag: addedFlag, by: "", at: 20})])
      let afterDismiss = startApartBars(flagsInForce(record))
      expect(afterDismiss.has(5)).toBeFalsy()
      expect(afterDismiss.get(20)).toEqual(["upper", "lower"])
    })
  })

  describe("align", () => {
    // a bar with its own tiny universe of pitch-class-shaped tokens (not
    // real pitch classes, just distinct values), so two different bars
    // never collide by accident the way small mod-12 numbers would
    function uniqueBar(id, size = 5) {
      let base = id * 100
      let pcs = Array.from({length: size}, (_, i) => base + i)
      return {hash: `h${id}`, sketch: {upper: `0:${pcs.join(",")}`, lower: ""}}
    }

    function fp(bars, opts = {}) {
      return {
        algo: opts.algo ?? 1,
        numbersHash: opts.numbersHash ?? "n",
        bars: bars.map(b => b.hash),
        sketches: bars.map(b => b.sketch),
      }
    }

    it("aligns identical fingerprints as the identity; every range placed and not moved", () => {
      let bars = [1, 2, 3, 4, 5, 6, 7, 8].map(id => uniqueBar(id))
      let alignment = alignBars(fp(bars), fp(bars))
      expect(alignment).toEqual(bars.map((_, i) => ({to: i, sim: 1})))

      expect(mapRange(alignment, 2, 5)).toEqual({place: "placed", startIndex: 2, endIndex: 5})
    })

    it("a bar inserted at the start shifts every later range by one index, moved from the old range", () => {
      let base = [1, 2, 3, 4, 5, 6, 7, 8].map(id => uniqueBar(id))
      let fromFp = fp(base)
      let toFp = fp([uniqueBar(99), ...base])

      let alignment = alignBars(fromFp, toFp)
      expect(alignment).toEqual(base.map((_, i) => ({to: i + 1, sim: 1})))

      expect(mapRange(alignment, 2, 5)).toEqual({place: "moved", startIndex: 3, endIndex: 6})
    })

    it("an 8-bar repeat written out in the middle leaves ranges before it alone and shifts ranges after it by 8", () => {
      let before = [1, 2, 3, 4].map(id => uniqueBar(id))
      let repeat = [5, 6, 7, 8, 9, 10, 11, 12].map(id => uniqueBar(id))
      let after = [13, 14].map(id => uniqueBar(id))

      // fromFp: the repeat played once (eg. a da capo); toFp: written out
      // twice in full, an 8-bar insertion
      let fromFp = fp([...before, ...repeat, ...after])
      let toFp = fp([...before, ...repeat, ...repeat, ...after])

      let alignment = alignBars(fromFp, toFp)

      for (let i = 0; i < before.length; i++) {
        expect(alignment[i]).toEqual({to: i, sim: 1})
      }

      let afterStart = before.length + repeat.length
      for (let i = 0; i < after.length; i++) {
        expect(alignment[afterStart + i]).toEqual({to: before.length + 2 * repeat.length + i, sim: 1})
      }

      let range = mapRange(alignment, afterStart, afterStart + after.length - 1)
      expect(range.place).toEqual("moved")
      expect(range.startIndex).toEqual(before.length + 2 * repeat.length)
    })

    it("a corrected note still aligns by sketch similarity, below 1 but high enough to place", () => {
      let base = [1, 2, 3, 4].map(id => uniqueBar(id))
      let fromFp = fp(base)

      let original = uniqueBar(3)
      let changedPcs = original.sketch.upper.split(":")[1].split(",").map(Number)
      changedPcs[changedPcs.length - 1] = 999999 // one note corrected
      let changed = {hash: "h3-corrected", sketch: {upper: `0:${changedPcs.join(",")}`, lower: ""}}

      let toBars = [...base]
      toBars[2] = changed
      let toFp = fp(toBars)

      let alignment = alignBars(fromFp, toFp)
      expect(alignment[2].to).toEqual(2)
      expect(alignment[2].sim).toBeGreaterThanOrEqual(0.6)
      expect(alignment[2].sim).toBeLessThan(1)

      expect(mapRange(alignment, 1, 3)).toEqual({place: "placed", startIndex: 1, endIndex: 3})
    })

    it("an unrelated piece aligns with nothing; every range is unplaced", () => {
      let fromFp = fp([1, 2, 3, 4, 5, 6, 7, 8].map(id => uniqueBar(id)))
      let toFp = fp([101, 102, 103, 104, 105, 106, 107, 108].map(id => uniqueBar(id)))

      // a forced pairing (however bad) can still score better than two
      // independent gaps, so this doesn't come back all null; what matters
      // is that nothing clears the similarity a placed range needs
      let alignment = alignBars(fromFp, toFp)
      expect(alignment.every(e => e == null || e.sim < 0.6)).toBeTruthy()
      expect(mapRange(alignment, 0, 7)).toEqual({place: "unplaced"})

      // the fraction a flags-file importer would read as fileMatch, well
      // under the 50% threshold it refuses below (st/difficulty/flags_file)
      let mappedFraction = alignment.filter(e => e && e.sim >= 0.6).length / alignment.length
      expect(mappedFraction).toBeLessThan(0.5)
    })

    it("barSimilarity is 1 for an exact hash match or two empty bars, and the Jaccard index of sketch tokens otherwise", () => {
      let a = uniqueBar(1)
      expect(barSimilarity(a, a)).toEqual(1)
      expect(barSimilarity({hash: "e1", sketch: {}}, {hash: "e2", sketch: {}})).toEqual(1)
      expect(barSimilarity({hash: "e1", sketch: {}}, uniqueBar(1))).toEqual(0)

      let x = {hash: "x", sketch: {upper: "0:1,2,3,4", lower: ""}}
      let y = {hash: "y", sketch: {upper: "0:1,2,3,5", lower: ""}}
      expect(barSimilarity(x, y)).toBeCloseTo(3 / 5, 5)
    })
  })

  describe("flags file", () => {
    function restSong(barCount) {
      return parseMusicXML(pianoScore({bars: Array.from({length: barCount}, () => uniformBlank())}))
    }

    function barsWithDense(denseAt, barCount = 16) {
      let bars = []
      for (let i = 1; i <= barCount; i++) { bars.push(denseAt.includes(i) ? denseBar() : quietBar()) }
      return bars
    }

    it("flagsFileFor carries format, version, by, exportedAt, the fingerprint and every decision; readFlagsFile round-trips it", () => {
      let song = workhorseSong()
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let flag = flagsInForce(record)[0]
      record = withDecisions(record, [acceptDecision({record, flag, by: "Ms Laurent", at: 10})])

      let file = flagsFileFor(record, {title: "Rêverie"}, song, {by: "Ms Laurent", at: 100})
      expect(file.format).toEqual(FLAGS_FORMAT)
      expect(file.version).toEqual(FLAGS_VERSION)
      expect(file.by).toEqual("Ms Laurent")
      expect(file.exportedAt).toEqual(100)
      expect(file.piece.title).toEqual("Rêverie")
      expect(file.piece.fingerprint.bars).toEqual(record.fingerprint.bars)
      expect(file.piece.fingerprint.sketches).toEqual(record.fingerprint.sketches)
      expect(file.piece.fingerprint.numbers.length).toEqual(record.fingerprint.bars.length)
      expect(file.decisions).toEqual(record.decisions)

      let {data, error} = readFlagsFile(JSON.stringify(file))
      expect(error).toBeUndefined()
      expect(data).toEqual(file)
    })

    it("readFlagsFile refuses non-JSON, another format, a newer version, an oversized file and too many decisions", () => {
      let valid = flagsFileFor(
        annotationWith(null, "p1", analyzePiece({song: workhorseSong(), source: null, at: 1})),
        {title: "t"}, workhorseSong(), {by: "", at: 1})

      expect(readFlagsFile("not json at all").error).toBeTruthy()
      expect(readFlagsFile(JSON.stringify({format: "something-else", version: 1})).error).toBeTruthy()
      expect(readFlagsFile(JSON.stringify({...valid, version: FLAGS_VERSION + 1})).error)
        .toContain("newer version")
      expect(readFlagsFile("x".repeat(MAX_FLAGS_FILE_BYTES + 1)).error).toBeTruthy()

      let tooMany = {...valid, decisions: Array.from({length: MAX_FLAGS_FILE_DECISIONS + 1}, () => ({}))}
      expect(readFlagsFile(JSON.stringify(tooMany)).error).toBeTruthy()
    })

    it("readFlagsFile drops invalid decisions, keeping the valid ones", () => {
      let valid = flagsFileFor(
        annotationWith(null, "p1", analyzePiece({song: workhorseSong(), source: null, at: 1})),
        {title: "t"}, workhorseSong(), {by: "", at: 1})
      let withBad = {...valid, decisions: [{bogus: true}, ...valid.decisions]}
      let {data} = readFlagsFile(JSON.stringify(withBad))
      expect(data.decisions).toEqual(valid.decisions)
    })

    it("reanchorDecisions maps a decision's ranges onto the local copy, stamping moved or unplaced", () => {
      let song = parseMusicXML(pianoScore({bars: barsWithDense([9, 10, 11])}))
      let analysis = analyzePiece({song, source: null, at: 1})
      let record = annotationWith(null, "p1", analysis)
      let hardest = flagsInForce(record).find(f => f.start <= 9 && f.end >= 11)
      let accepted = withDecisions(record, [acceptDecision({record, flag: hardest, by: "Ms Laurent", at: 10})])
      let file = flagsFileFor(accepted, {title: "t"}, song, {by: "Ms Laurent", at: 100})

      // the local copy gained a bar at the start: every later index shifts by 1
      let withPickupSong = parseMusicXML(pianoScore({bars: [quietBar(), ...barsWithDense([9, 10, 11])]}))
      let localRecord = annotationWith(null, "p2", analyzePiece({song: withPickupSong, source: null, at: 2}))

      let {decisions, report} = reanchorDecisions(file, localRecord, withPickupSong)
      expect(report.unplaced).toEqual(0)
      expect(report.moved).toEqual(1)
      expect(decisions[0].of.startIndex).toEqual(hardest.startIndex + 1)
      expect(decisions[0].moved.by).toEqual("Ms Laurent")

      // an unrelated piece: the decision comes back unplaced, keeping the
      // file's own bar numbers to show where it was
      let unrelatedRecord = annotationWith(null, "p3", analyzePiece({song: restSong(20), source: null, at: 3}))
      let {decisions: unplacedDecisions, report: unplacedReport} = reanchorDecisions(file, unrelatedRecord, restSong(20))
      expect(unplacedReport.unplaced).toEqual(1)
      expect(unplacedDecisions[0].unplaced.start).toEqual(hardest.start)
    })

    it("fileMatch is the fraction of the file's bars that align well; low for an unrelated piece", () => {
      let song = workhorseSong()
      let record = annotationWith(null, "p1", analyzePiece({song, source: null, at: 1}))
      let file = flagsFileFor(record, {title: "t"}, song, {by: "", at: 1})

      expect(fileMatch(file, record)).toBeCloseTo(1, 5)

      let unrelatedRecord = annotationWith(null, "p2", analyzePiece({song: restSong(20), source: null, at: 2}))
      expect(fileMatch(file, unrelatedRecord)).toBeLessThan(0.5)
    })
  })

  describe("trouble spots", () => {
    function item({measure, hand = "both", reps = 0, lapses = 0, d = 0, paceMs, recentGrades = [], deliberate} = {}) {
      return {
        pieceId: "p1", hand, startMeasure: measure, endMeasure: measure,
        reps, lapses, d, paceMs,
        recent: recentGrades.map((grade, idx) => [idx, null, null, grade]),
        ...(deliberate !== undefined ? {deliberate} : {}),
      }
    }

    it("fewer than 3 graded attempts gives nothing; lapses >= 2 with reps >= 3 gives a suggestion", () => {
      let tooFew = item({measure: 3, reps: 2, lapses: 2})
      expect(troubleSpots({pieceId: "p1", items: [tooFew], measures: [1, 2, 3, 4, 5]})).toEqual([])

      let lapsed = item({measure: 3, reps: 3, lapses: 2})
      let spots = troubleSpots({pieceId: "p1", items: [lapsed], measures: [1, 2, 3, 4, 5]})
      expect(spots.length).toEqual(1)
      expect(spots[0].start).toEqual(3)
      expect(spots[0].end).toEqual(3)
      expect(spots[0].hand).toEqual("both")
      expect(spots[0].signals.map(s => s.kind)).toEqual(["lapses"])
    })

    it("two agains in recent, a difficulty of 7, or a pace above 1.5x the median each give a suggestion", () => {
      let again = item({measure: 1, reps: 3, recentGrades: [1, 1, 3]})
      let hard = item({measure: 3, reps: 3, d: 7})
      let slow = item({measure: 5, reps: 3, paceMs: 1800})
      let base = item({measure: 7, reps: 3, paceMs: 1000})
      let other = item({measure: 9, reps: 3, paceMs: 1000})

      let measures = Array.from({length: 10}, (_, i) => i + 1)
      let spots = troubleSpots({pieceId: "p1", items: [again, hard, slow, base, other], measures})

      expect(spots.find(s => s.start == 1).signals.map(s => s.kind)).toContain("again")
      expect(spots.find(s => s.start == 3).signals.map(s => s.kind)).toContain("difficulty")

      let slowSpot = spots.find(s => s.start == 5)
      expect(slowSpot.signals.map(s => s.kind)).toContain("pace")
      expect(slowSpot.text).toContain("1.8")

      expect(spots.find(s => s.start == 7)).toBeUndefined()
      expect(spots.find(s => s.start == 9)).toBeUndefined()
    })

    it("merges adjacent troubled bars, excludes bars already flagged, and takes the hand from a non-deliberate hand-alone item", () => {
      let a = item({measure: 4, reps: 3, lapses: 2})
      let b = item({measure: 5, reps: 3, lapses: 2})
      let flaggedBar = item({measure: 8, reps: 3, lapses: 2})
      let scaffoldHand = item({measure: 10, hand: "lower", reps: 1, deliberate: false})
      let scaffoldBoth = item({measure: 10, hand: "both", reps: 3})
      let deliberateHand = item({measure: 12, hand: "upper", reps: 5, deliberate: true})
      let togetherForDeliberate = item({measure: 12, hand: "both", reps: 3})

      let flags = [{start: 8, end: 8, hand: "both"}]
      let items = [a, b, flaggedBar, scaffoldHand, scaffoldBoth, deliberateHand, togetherForDeliberate]
      let measures = Array.from({length: 12}, (_, i) => i + 1)

      let spots = troubleSpots({pieceId: "p1", items, measures, flags})

      let merged = spots.find(s => s.start == 4)
      expect(merged.end).toEqual(5)

      expect(spots.some(s => s.start <= 8 && s.end >= 8)).toBeFalsy()

      let scaffolded = spots.find(s => s.start == 10)
      expect(scaffolded.hand).toEqual("lower")
      expect(scaffolded.signals.map(s => s.kind)).toContain("scaffold")

      expect(spots.find(s => s.start == 12)).toBeUndefined()
    })
  })
})

function uniformBlank() {
  return {
    upper: [{name: "C4", duration: 4, type: "whole", rest: true}],
    lower: [{name: "C3", duration: 4, type: "whole", rest: true}],
  }
}
