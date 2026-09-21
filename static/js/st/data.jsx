
import * as React from "react"

import {MajorScale, parseNote, noteName} from "st/music"
import {shiftNotationOctaves} from "st/song_parser"

import {
  RandomNotes, SweepRangeNotes, MiniSteps, TriadNotes, SevenOpenNotes,
  ProgressionGenerator, PositionGenerator, IntervalGenerator, SheetMusicGenerator,
  allKeySignatures, currentDrillMode, SCORE_DRILL_STORAGE_KEY
} from "st/generators"

import {
  extractSectionColumns, filterColumnsToRange, parseSongText, countMeasures,
  measureNumberRange, measureNumberList, measureKeySignature, staffTracks
} from "st/song_sections"

import {
  MeasureCardDeck, MeasureCardGenerator, measureCards, sectionCard, cardColumns,
  IN_ORDER, RANDOM_ORDER, MAX_MEASURES_PER_CARD
} from "st/measure_cards"

import {
  loadDeck, findPiece, pieceSong, removePiece, importMusicXMLPiece,
  exportLibraryFile, importLibraryFile
} from "st/sheet_music_deck"

import {ChordGenerator, MultiKeyChordGenerator} from "st/chord_generators"
import {GStaff, FStaff, GrandStaff, ChordStaff} from "st/components/staves"

let smoothInput = {
  name: "smoothness",
  type: "range",
  default: 3,
  min: 0,
  max: 6,
}

let noteRangeInput = {
  name: "noteRange",
  type: "noteRange",
  label: "note range",
  // default: [0, 99], // default is set automatically
  min: 0,
  max: 100,
}

// browser storage for the sheet music section being drilled (piece or song
// text, measure range, hand or track) so a reload restores it. Imported
// pieces themselves live in the deck, see st/sheet_music_deck
export const SHEET_MUSIC_STORAGE_KEY = "st:sheet_music_deck:v2"

// where the section was kept while note names put middle C at "C5" (song
// text c5), migrated to SHEET_MUSIC_STORAGE_KEY once
export const LEGACY_SHEET_MUSIC_STORAGE_KEY = "st:sheet_music_deck"

const ALL_TRACKS = "all"

export const BOTH_HANDS = "both hands"
export const RIGHT_HAND = "right hand (treble staff)"
export const LEFT_HAND = "left hand (bass staff)"

// the measures per card that drills the whole section as one looping card
export const WHOLE_SECTION = "all"

// track option names use the notation's own 0-based track index (t0, t1...)
function sheetMusicTrackName(idx) {
  return `track t${idx}`
}

// select options for the track filter, computed from the pasted song
function sheetMusicTrackOptions(settings) {
  let options = [{name: ALL_TRACKS}]
  let {song} = parseSongText(settings.song)

  if (song && song.tracks) {
    song.tracks.forEach((track, idx) => {
      if (track && track.length) {
        options.push({name: sheetMusicTrackName(idx)})
      }
    })
  }

  return options
}

// track index named by the setting, or null for all tracks when the setting
// does not name a track of this song (eg. it was chosen for a previous song)
function sheetMusicTrackIndex(song, trackName) {
  let m = /^track t(\d+)$/.exec(trackName || "")
  if (!m) { return null }

  let idx = +m[1]
  let track = song.tracks && song.tracks[idx]
  return track && track.length ? idx : null
}

// the imported piece the settings drill, or null for the pasted notation
// (also when the chosen piece has been removed from the deck)
export function sheetMusicPiece(settings) {
  let piece = findPiece(settings.piece)
  return piece && pieceSong(piece) ? piece : null
}

function plural(count, word) {
  return `${count} ${word}${count == 1 ? "" : "s"}`
}

// describes the measures of a song, eg. "measures 0–32 (0 is the pickup)"
export function measuresDescription(song) {
  let [first, last] = measureNumberRange(song)
  if (last < first) {
    return "no measures"
  }

  if (first == 0) {
    return `measures 0–${last} (0 is the pickup)`
  }

  return `measures ${first}–${last}`
}

// the track indices to drill for a hand setting
export function handTracks(song, hand) {
  let staves = staffTracks(song)

  switch (hand) {
    case RIGHT_HAND:
      return staves.treble
    case LEFT_HAND:
      return staves.bass
    default:
      return null // all tracks
  }
}

// filters the section's columns to the staff and describes the result
function sectionResult(staff, columns, parts, opts={}) {
  // Notes outside the staff's range are filtered out (not clamped) so the
  // drill only shows what the staff and on screen keyboard can present; the
  // status reports how many were skipped.
  let [visible, dropped] = filterColumnsToRange(columns, staff.range[0], staff.range[1])

  if (visible.length) {
    parts.push(`section has ${plural(visible.length, "column")}`)
  } else {
    parts.push("section has no notes")
  }

  if (dropped) {
    let skipped = `${plural(dropped, "note")} outside the ${staff.name} staff range skipped`
    if (opts.suggestGrand && staff.name != "grand") {
      skipped += "; pick the grand staff to drill both hands"
    }
    parts.push(skipped)
  }

  return {columns: visible, status: parts.join(", ")}
}

// columns for an imported piece, see sheetMusicSection
export function pieceSection(staff, settings, song) {
  let tracks = handTracks(song, settings.hand)
  let columns = extractSectionColumns(song, {
    startMeasure: settings.startMeasure,
    endMeasure: settings.endMeasure,
    track: tracks,
  })

  let parts = [`Score has ${measuresDescription(song)}`]

  if (tracks && !tracks.length) {
    parts.push(`the score has no ${settings.hand == LEFT_HAND ? "bass" : "treble"} staff`)
  }

  let staves = staffTracks(song)
  let twoStaves = staves.treble.length > 0 && staves.bass.length > 0

  return sectionResult(staff, columns, parts, {
    suggestGrand: twoStaves && !tracks,
  })
}

// The measures of an imported piece's section with the columns of each on the
// staff, the pool of st/measure_cards. Columns carry the grand staff of their
// notes and the clefs at their onset, so the staff draws the piece on the
// score's own staves and clefs
export function pieceSectionMeasures(staff, settings, song) {
  let tracks = handTracks(song, settings.hand)
  let [firstMeasure] = measureNumberRange(song)
  let start = Math.max(firstMeasure, Math.floor(settings.startMeasure) || 0)
  let end = Math.floor(settings.endMeasure)

  return measureNumberList(song)
    .filter(number => number >= start && number <= end)
    .map(number => {
      let columns = extractSectionColumns(song, {
        startMeasure: number, endMeasure: number, track: tracks, staves: true,
      })
      let [visible] = filterColumnsToRange(columns, staff.range[0], staff.range[1])
      return {number, columns: visible}
    })
}

// The measures of the piece section as flashcards (see st/measure_cards), or
// null for pasted notation, a section that is one whole section card or a
// section without notes on the staff. A card is fitted to the plate in the
// wait mode only, so that is where the cap holds: a whole section longer than
// MAX_MEASURES_PER_CARD is walked in order as capped cards, wrapping back to
// the section's start, while a scrolling one runs on as the single looping
// card. The deck of the latest settings is kept so a rebuilt generator carries
// on from the card being shown
let cardDeck = null

// whether the drill plays the whole section rather than cards of a few
// measures, the one card size whose deck depends on the drill mode
export function wholeSectionDrill(settings) {
  return !(Number(settings.measuresPerCard) >= 1)
}

// opts.capped false is the engine card (st/score_render), drawn by an engine
// that lays out as many measures as it is given, so a card takes any number
// of measures and a whole section is one looping card however long it is,
// still a deck so its measures' stats are recorded
export function measureCardDeck(staff, settings, {capped=true}={}) {
  let piece = sheetMusicPiece(settings)
  if (!piece) {
    return null
  }

  let wholeSection = wholeSectionDrill(settings)
  if (wholeSection && capped && currentDrillMode(SCORE_DRILL_STORAGE_KEY) != "wait") {
    return null
  }

  let perCard = wholeSection ? MAX_MEASURES_PER_CARD : settings.measuresPerCard
  let order = wholeSection ? IN_ORDER : settings.order

  let key = JSON.stringify([
    piece.id, staff.name, staff.range, settings.startMeasure, settings.endMeasure,
    settings.hand, settings.measuresPerCard, order, capped,
  ])

  if (cardDeck && cardDeck.key == key && cardDeck.piece == piece) {
    return cardDeck.deck
  }

  let measures = pieceSectionMeasures(staff, settings, pieceSong(piece))
  let cards = wholeSection && !capped ?
    (measures.length ? [sectionCard(measures)] : []) :
    measureCards(measures, perCard, {capped})

  // a whole section the cap already fits stays the single looping card
  let deck = wholeSection && capped && cards.length < 2 ? null :
    new MeasureCardDeck(cards, {pieceId: piece.id, order})

  if (deck && !deck.playable) {
    deck = null
  }

  cardDeck = {key, piece, deck}
  return deck
}

// columns for the current sheet music settings on the given staff, plus a
// human readable status line for the settings panel
export function sheetMusicSection(staff, settings) {
  let piece = sheetMusicPiece(settings)
  if (piece) {
    return pieceSection(staff, settings, pieceSong(piece))
  }

  let {song, error} = parseSongText(settings.song)

  if (error) {
    return {columns: [], status: `Could not parse song: ${error}`}
  }

  if (!song) {
    return {columns: [], status: "Import a MusicXML piece or paste song notation above to build a section"}
  }

  let columns = extractSectionColumns(song, {
    startMeasure: settings.startMeasure,
    endMeasure: settings.endMeasure,
    track: sheetMusicTrackIndex(song, settings.track),
  })

  return sectionResult(staff, columns, [`Song has ${plural(countMeasures(song), "measure")}`])
}

// settings for drilling a newly picked piece: the opening measures of the
// score, both hands
export function sheetMusicPieceSettings(settings, song) {
  let [first, last] = measureNumberRange(song)
  let startMeasure = last >= 1 ? Math.max(first, 1) : first
  let endMeasure = Math.max(startMeasure, Math.min(startMeasure + 3, last))

  return {...settings, startMeasure, endMeasure, hand: BOTH_HANDS}
}

// the song of the sheet music settings: the imported piece's, else the pasted
// notation's when it parses; null otherwise
function sheetMusicSong(settings) {
  let piece = sheetMusicPiece(settings)
  if (piece) {
    return pieceSong(piece)
  }

  return parseSongText(settings.song).song
}

// [first, last] measure numbers the section can be picked from (a pickup is
// measure 0), or null when there is no song with measures to pick from
export function sheetMusicMeasureBounds(settings) {
  let song = sheetMusicSong(settings)
  if (!song) {
    return null
  }

  let [first, last] = measureNumberRange(song)
  return last >= first ? [first, last] : null
}

// The section's start and end measures clamped to the song, start never after
// end, so settings stored for a longer piece (or before the measures were
// picked this way) still name measures of this one. Unchanged when there is
// no song to clamp to
export function sheetMusicSectionRange(settings) {
  let start = Math.floor(settings.startMeasure)
  let end = Math.floor(settings.endMeasure)
  let bounds = sheetMusicMeasureBounds(settings)
  if (!bounds) {
    return {startMeasure: settings.startMeasure, endMeasure: settings.endMeasure}
  }

  let [first, last] = bounds
  let clamp = (value, fallback) => Math.min(last, Math.max(first, Number.isFinite(value) ? value : fallback))
  let startMeasure = clamp(start, first)
  let endMeasure = Math.max(startMeasure, clamp(end, last))

  return {startMeasure, endMeasure}
}

// The settings update for picking the section's start or end measure (name
// "startMeasure" or "endMeasure"), clamped to the song: moving one past the
// other drags the other along with it
export function sheetMusicSectionUpdate(settings, name, value) {
  let {startMeasure, endMeasure} = sheetMusicSectionRange(settings)
  let bounds = sheetMusicMeasureBounds(settings)
  if (bounds) {
    value = Math.min(bounds[1], Math.max(bounds[0], value))
  }

  if (name == "startMeasure") {
    return {startMeasure: value, endMeasure: Math.max(value, endMeasure)}
  }

  return {startMeasure: Math.min(value, startMeasure), endMeasure: value}
}

// the range the section's start and end measures are picked in, with the
// song's last measure as the caption
function sectionMeasureBounds(settings) {
  let bounds = sheetMusicMeasureBounds(settings)
  if (!bounds) {
    return {min: 0, max: 9999}
  }

  let [first, last] = bounds
  return {min: first, max: last, caption: `of ${last}`}
}

// how many measures the section has, at least 1
export function sheetMusicSectionLength(settings) {
  let song = sheetMusicSong(settings)
  if (!song) {
    return 1
  }

  let {startMeasure, endMeasure} = sheetMusicSectionRange(settings)
  let count = measureNumberList(song)
    .filter(number => number >= startMeasure && number <= endMeasure)
    .length

  return Math.max(1, count)
}

// The most measures a card of the section can have: the whole section when
// an engine draws the cards (opts.capped false), else at most
// MAX_MEASURES_PER_CARD, what the app's staff fits on the plate. capped says
// whether that cap is what holds it below the section's length
export function measuresPerCardLimit(settings, {capped=true}={}) {
  let length = sheetMusicSectionLength(settings)
  if (capped && length > MAX_MEASURES_PER_CARD) {
    return {max: MAX_MEASURES_PER_CARD, capped: true}
  }

  return {max: length, capped: false}
}

// the trainer's key signature for the score's key at the start measure, so
// its notes are drawn with the score's accidentals rather than the
// programme's; null for a song without a key or one the trainer lacks
export function sheetMusicKeyFor(song, startMeasure) {
  let fifths = measureKeySignature(song, startMeasure)
  if (typeof fifths != "number") {
    return null
  }

  return allKeySignatures().find(key => !key.isChromatic() && key.count == fifths) || null
}

// the grand staff for a piece with both a treble and a bass staff, which a
// single staff can't show without skipping one hand; null otherwise
export function sheetMusicStaffFor(song) {
  let staves = staffTracks(song)
  return staves.treble.length && staves.bass.length ? "grand" : null
}

function staffRange(staff, noteRange) {
  if (noteRange) {
    return [
      noteName(Math.max(noteRange[0], parseNote(staff.range[0]))),
      noteName(Math.min(noteRange[1], parseNote(staff.range[1])))
    ]
  } else {
    return staff.range
  }
}

export const STAVES = [
  {
    mode: "notes",
    name: "treble",
    range: ["A3", "C6"],
    render: function(props=this.state) {
      return <GStaff
        ref={(staff) => this.staff = staff}
        {...props}
      />
    },
  },
  {
    mode: "notes",
    name: "bass",
    range: ["C2", "E4"],
    render: function(props=this.state) {
      return <FStaff
        ref={(staff) => this.staff = staff}
        {...props}
      />
    },
  },
  {
    mode: "notes",
    name: "grand",
    range: ["C2", "C6"],
    render: function(props=this.state) {
      return <GrandStaff
        ref={(staff) => this.staff = staff}
        {...props}
      />
    },
  },
  {
    mode: "chords",
    name: "chord",
    range: ["B6", "C7"],
    render: function(props) {
      return <ChordStaff 
        chords={this.state.notes}
        noteShaking={this.state.noteShaking}
        touchedNotes={this.state.touchedNotes}
        ref={(staff) => this.staff = staff}
        {...props}
      />
    }
  }
]

const ALL_GENERATORS = [
  {
    name: "random",
    // shown in the programme drawer and the trainer title
    label: "Random notes",
    mode: "notes",
    inputs: [
      {
        name: "notes",
        type: "range",
        min: 1,
        max: 5,
      },
      {
        name: "hands",
        type: "range",
        default: 2,
        min: 1,
        max: 2,
      },
      smoothInput,
      noteRangeInput,
      {
        label: "chord based",
        name: "musical",
        type: "bool",
        hint: "Column fits random chord",
      }
    ],
    create: function(staff, keySignature, options) {
      let scale = keySignature.defaultScale()
      let notes = scale.getLooseRange(...staffRange(staff, options.noteRange))

      // send the scale
      if (options.musical) {
        options = {
          scale,
          ...options
        }
      }

      return new RandomNotes(notes, options)
    }
  },
  {
    name: "sweep",
    label: "Sweep up & down",
    mode: "notes",
    debug: true,
    create: function(staff, keySignature) {
      let notes = new MajorScale(keySignature)
        .getLooseRange(...staff.range);

      return new SweepRangeNotes(notes);
    }
  },
  {
    name: "steps",
    label: "Steps",
    mode: "notes",
    debug: true, // not needed anymore with smoothness
    create: function(staff, keySignature) {
      let notes = new MajorScale(keySignature)
        .getLooseRange(...staff.range);
      return new MiniSteps(notes);
    }
  },
  {
    name: "triads",
    label: "Triads",
    mode: "notes",
    inputs: [
      smoothInput
    ],
    create: function(staff, keySignature, options) {
      let notes = new MajorScale(keySignature)
        .getLooseRange(...staff.range);
      return new TriadNotes(notes, options);
    }
  },
  {
    name: "sevens",
    label: "Sevens",
    mode: "notes",
    inputs: [
      smoothInput,
      noteRangeInput,
    ],
    create: function(staff, keySignature, options) {
      let scale = keySignature.defaultScale()
      let notes = scale.getLooseRange(...staffRange(staff, options.noteRange))

      return new SevenOpenNotes(notes, options);
    }
  },
  {
    name: "progression",
    label: "Progression",
    mode: "notes",
    inputs: [
      smoothInput,
      {
        name: "progression",
        type: "select",
        values: [
          {
            name: "autumn leaves",
            // in major degrees
            value: [
              [2, "m7"],
              [5, "7"],
              [1, "M7"],
              [4, "M7"],
              [7, "m7b5"],
              [3, "7"],
              [6, "m"],
            ],

            // // iv7 – VII7 – IIImaj7 – VImaj7 – ii7(b5) – V7 – i
            // // in minor degrees
            // // TODO: make it work with minor progressions
            // let progression = [
            //   [4, "m7"],
            //   [7, "7"],
            //   [3, "M7"],
            //   [6, "M7"],
            //   [2, "m7b5"],
            //   [5, "7"],
            //   [1, "m"],
            // ]
          },

          {
            name: "50s",
            value: [
              [1, "M"],
              [6, "m"],
              [4, "M"],
              [5, "M"],
            ]
          },

          {
            name: "circle",
            value: [
              [6, "m"],
              [2, "m"],
              [5, "M"],
              [1, "M"],
            ]
          },

          {
            name: "basic substitution",
            value: [
              [1, "M7"],
              [2, "7"],
              [5, "7"],
            ],
          },
        ],
      }
    ],
    create: function(staff, keySignature, options) {
      let scale = new MajorScale(keySignature)
      let progressionInputs = this.inputs.find(i => i.name == "progression")
      let progression = progressionInputs.values.find(v => v.name == options.progression)
      return new ProgressionGenerator(scale, staff.range, progression.value, options)
    }
  },
  {
    name: "position",
    label: "Position",
    mode: "notes",
    inputs: [],
    create: function(staff, keySignature, options) {
      let notes = new MajorScale(keySignature)
        .getLooseRange(...staff.range);

      return new PositionGenerator(notes, options)
    }
  },
  {
    name: "intervals",
    label: "Intervals",
    mode: "notes",
    inputs: [
      {
        name: "intervals",
        type: "toggles",
        options: [
          "2", "3", "4", "5", "6", "7"
        ]
      },
      noteRangeInput
    ],
    create: function(staff, keySignature, options) {
      let notes = new MajorScale(keySignature)
        .getLooseRange(...staffRange(staff, options.noteRange))

      return new IntervalGenerator(notes, options)
    }
  },
  {
    name: "sheet music",
    label: "Sheet music",
    mode: "notes",
    storageKey: SHEET_MUSIC_STORAGE_KEY,
    legacyStorage: {
      key: LEGACY_SHEET_MUSIC_STORAGE_KEY,
      migrate: settings => typeof settings.song == "string" ?
        {...settings, song: shiftNotationOctaves(settings.song, -1)} : settings,
    },
    inputs: [
      {
        name: "piece",
        type: "deck",
        default: "",
        emptyLabel: "Pasted song notation",
        pieces: () => loadDeck().pieces,
        importFile: (fileName, data) => importMusicXMLPiece(fileName, data),
        removePiece: id => removePiece(id),
        exportLibrary: () => exportLibraryFile(),
        importLibrary: text => importLibraryFile(text),
        // settings and staff for drilling a piece that was just picked
        pick: (settings, id) => {
          let piece = findPiece(id)
          let song = piece && pieceSong(piece)
          if (!song) {
            return {settings: {...settings, piece: ""}, staff: null}
          }

          return {
            settings: sheetMusicPieceSettings({...settings, piece: id}, song),
            staff: sheetMusicStaffFor(song),
          }
        },
        hint: "Import a MusicXML file (.musicxml, .xml or compressed .mxl). Imported pieces stay in this browser's library; export it to keep a copy or move it to another browser.",
      },
      {
        name: "song",
        label: "song notation",
        type: "text",
        default: "",
        hint: "Paste song notation (the play along format). Notes at the same beat become one column.",
        visible: settings => !sheetMusicPiece(settings),
      },
      {
        name: "startMeasure",
        label: "start measure",
        type: "measure",
        default: 1,
        bounds: settings => sectionMeasureBounds(settings),
        update: (settings, value) => sheetMusicSectionUpdate(settings, "startMeasure", value),
        value: settings => sheetMusicSectionRange(settings).startMeasure,
      },
      {
        name: "endMeasure",
        label: "end measure",
        type: "measure",
        default: 4,
        bounds: settings => sectionMeasureBounds(settings),
        update: (settings, value) => sheetMusicSectionUpdate(settings, "endMeasure", value),
        value: settings => sheetMusicSectionRange(settings).endMeasure,
        hint: settings => {
          let piece = sheetMusicPiece(settings)
          return piece ? `The score has ${measuresDescription(pieceSong(piece))}` : null
        },
      },
      {
        name: "track",
        type: "select",
        default: ALL_TRACKS,
        values: sheetMusicTrackOptions,
        visible: settings => !sheetMusicPiece(settings),
      },
      {
        name: "hand",
        type: "select",
        default: BOTH_HANDS,
        values: [
          {name: BOTH_HANDS},
          {name: RIGHT_HAND},
          {name: LEFT_HAND},
        ],
        visible: settings => !!sheetMusicPiece(settings),
      },
      {
        name: "measuresPerCard",
        label: "measures per card",
        type: "measure",
        default: WHOLE_SECTION,
        presets: [{name: WHOLE_SECTION, label: "all"}],
        // context.cardCap: null when an engine draws the cards, else why the
        // app's staff draws them, capped to what it fits on the plate (eg.
        // "while the score can't be drawn"), capped too when unset. context.mode: the page's
        // wait or scroll mode
        bounds: (settings, context={}) => {
          let {max, capped} = measuresPerCardLimit(settings, {capped: context.cardCap !== null})
          return {
            min: 1,
            max,
            caption: capped ? `max ${max}` : `of ${sheetMusicSectionLength(settings)}`,
          }
        },
        value: settings => Number(settings.measuresPerCard) >= 1 ?
          Math.floor(Number(settings.measuresPerCard)) : null,
        hint: (settings, context={}) => {
          let engine = context.cardCap === null
          let all = engine ? "All plays the whole section as one card." :
            context.mode == "scroll" ? "All plays the whole section continuously." :
            `All plays the whole section in order, up to ${MAX_MEASURES_PER_CARD} measures at a time.`
          let {capped} = measuresPerCardLimit(settings, {capped: !engine})
          let reason = context.cardCap ? ` ${context.cardCap}` : ""
          let cap = capped ?
            ` Cards stop at ${MAX_MEASURES_PER_CARD} measures${reason}, where the trainer's own staff draws them.` : ""
          return `${all} A number shows that many measures of the section at a time, like a flashcard.${cap}`
        },
        visible: settings => !!sheetMusicPiece(settings),
      },
      {
        name: "order",
        type: "select",
        default: IN_ORDER,
        values: [
          {name: IN_ORDER},
          {name: RANDOM_ORDER},
        ],
        hint: "Random picks the measures you miss most more often.",
        visible: settings => !!sheetMusicPiece(settings) && Number(settings.measuresPerCard) >= 1,
      },
    ],
    // a stored section clamped to its piece, eg. one picked on a longer piece
    fixSettings: function(settings) {
      if (typeof settings.startMeasure != "number" || typeof settings.endMeasure != "number") {
        return {}
      }
      return sheetMusicSectionRange(settings)
    },
    // shown under the inputs in the settings panel
    status: function(staff, settings) {
      return sheetMusicSection(staff, settings).status
    },
    // an imported piece is drawn in the score's key, see scoreKeySignature
    keySignature: function(settings) {
      let piece = sheetMusicPiece(settings)
      return piece ? sheetMusicKeyFor(pieceSong(piece), settings.startMeasure) : null
    },
    // shown under the key pills when the key can't follow the score
    keyHint: function(settings) {
      let piece = sheetMusicPiece(settings)
      let metadata = piece && pieceSong(piece).metadata
      return metadata && !Array.isArray(metadata.measureKeySignatures) ?
        "Re-import to follow the score key" : null
    },
    // opts.engineCards: the page draws each card with an engraving engine,
    // so a card isn't capped to what the plate fits (see measureCardDeck)
    create: function(staff, keySignature, settings, opts={}) {
      let deck = measureCardDeck(staff, settings, {capped: !opts.engineCards})
      if (deck) {
        let recordNotes = settings.startMeasure != settings.endMeasure
        return new MeasureCardGenerator(deck, {recordNotes})
      }

      // a whole section the cap fits loops as one card, its measures marked
      let piece = sheetMusicPiece(settings)
      let measures = piece ? pieceSectionMeasures(staff, settings, pieceSong(piece)) : []
      if (measures.length) {
        let card = sectionCard(measures)
        let columns = cardColumns(card)
        return new SheetMusicGenerator(columns, {card})
      }

      let {columns} = sheetMusicSection(staff, settings)
      return new SheetMusicGenerator(columns)
    }
  },
  {
    name: "random",
    label: "Random chords",
    mode: "chords",
    inputs: [
      {
        name: "scale",
        type: "select",
        values: [
          { name: "major" },
          { name: "natural minor" },
          { name: "harmonic minor"},
          { name: "melodic minor"},
        ]
      },
      {
        name: "notes",
        type: "range",
        default: 3,
        min: 3,
        max: 4,
      },
      {
        name: "ignoreAbove",
        label: "ignore above",
        type: "note",
        default: 100,
        min: 0,
        max: 100,
      },
      {
        name: "commonNotes",
        label: "common notes",
        type: "select",
        values: [
          {
            name: "any",
            value: -1
          },
          {
            name: "1",
            value: 1
          },
          {
            name: "2",
            value: 2
          }
        ]
      }
    ],
    create: function(staff, keySignature, options) {
      return new ChordGenerator(keySignature, options)
    }
  },
  {
    name: "multi-key",
    label: "Multi-key chords",
    mode: "chords",
    inputs: [
      {
        name: "notes",
        type: "range",
        default: 3,
        min: 3,
        max: 4,
      },
      {
        name: "commonNotes",
        label: "common notes",
        type: "select",
        values: [
          {
            name: "any",
            value: -1
          },
          {
            name: "1",
            value: 1
          },
          {
            name: "2",
            value: 2
          }
        ]
      }
    ],
    create: function(staff, keySignature, options) {
      return new MultiKeyChordGenerator(keySignature, options)
    }
  }

]

// An imported piece is drilled on its own page (st/components/pages/score_page)
// rather than as one of the trainer's exercises, whose clef, key and range
// settings the score supplies itself
export const SHEET_MUSIC_GENERATOR = ALL_GENERATORS.find(g => g.name == "sheet music")

// the exercises the trainer page offers
export const GENERATORS = ALL_GENERATORS.filter(g => g != SHEET_MUSIC_GENERATOR)
