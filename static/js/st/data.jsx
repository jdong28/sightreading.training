
import * as React from "react"

import {MajorScale, parseNote, noteName} from "st/music"

import {
  RandomNotes, SweepRangeNotes, MiniSteps, TriadNotes, SevenOpenNotes,
  ProgressionGenerator, PositionGenerator, IntervalGenerator, SheetMusicGenerator
} from "st/generators"

import {
  extractSectionColumns, filterColumnsToRange, parseSongText, countMeasures,
  measureNumberRange, measureNumberList, staffTracks
} from "st/song_sections"

import {
  MeasureCardDeck, MeasureCardGenerator, measureCards, IN_ORDER, RANDOM_ORDER,
  MAX_MEASURES_PER_CARD
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
// text, measure range, hand or track) so a reload in frontend-only mode (no
// server side song library) restores it. Imported pieces themselves live in
// the deck, see st/sheet_music_deck
export const SHEET_MUSIC_STORAGE_KEY = "st:sheet_music_deck"

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
function handTracks(song, hand) {
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

// The measures of the piece section as flashcards (see st/measure_cards),
// or null for pasted notation, the whole section drill or a section without
// notes on the staff. The
// deck of the latest settings is kept so the status line and the generator
// share the card being shown
let cardDeck = null

export function measureCardDeck(staff, settings) {
  let piece = sheetMusicPiece(settings)
  if (!piece || !(Number(settings.measuresPerCard) >= 1)) {
    return null
  }

  let key = JSON.stringify([
    piece.id, staff.name, staff.range, settings.startMeasure, settings.endMeasure,
    settings.hand, settings.measuresPerCard, settings.order,
  ])

  if (cardDeck && cardDeck.key == key && cardDeck.piece == piece) {
    return cardDeck.deck
  }

  let song = pieceSong(piece)
  let tracks = handTracks(song, settings.hand)
  let [firstMeasure] = measureNumberRange(song)
  let start = Math.max(firstMeasure, Math.floor(settings.startMeasure) || 0)
  let end = Math.floor(settings.endMeasure)

  let measures = measureNumberList(song)
    .filter(number => number >= start && number <= end)
    .map(number => {
      let columns = extractSectionColumns(song, {startMeasure: number, endMeasure: number, track: tracks})
      let [visible] = filterColumnsToRange(columns, staff.range[0], staff.range[1])
      return {number, columns: visible}
    })

  let deck = new MeasureCardDeck(measureCards(measures, settings.measuresPerCard), {
    pieceId: piece.id,
    order: settings.order,
  })

  if (!deck.playable) {
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
    range: ["A4", "C7"],
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
    range: ["C3", "E5"],
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
    range: ["C3", "C7"],
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
    range: ["B7", "C8"],
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

export const GENERATORS = [
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
    inputs: [
      {
        name: "piece",
        type: "deck",
        default: "",
        emptyLabel: "Pasted song notation",
        pieces: () => loadDeck().pieces,
        importFile: (fileName, text) => importMusicXMLPiece(fileName, text),
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
        hint: "Import an uncompressed MusicXML file (.musicxml or .xml). Imported pieces stay in this browser's library; export it to keep a copy or move it to another browser.",
      },
      {
        name: "song",
        label: "song notation",
        type: "text",
        library: true, // offer play along library songs when logged in
        default: "",
        hint: "Paste song notation (the play along format). Notes at the same beat become one column.",
        visible: settings => !sheetMusicPiece(settings),
      },
      {
        name: "startMeasure",
        label: "start measure",
        type: "number",
        default: 1,
        min: 0,
        max: 9999,
      },
      {
        name: "endMeasure",
        label: "end measure",
        type: "number",
        default: 4,
        min: 0,
        max: 9999,
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
        type: "select",
        default: WHOLE_SECTION,
        values: [
          {name: WHOLE_SECTION},
          ...Array.from({length: MAX_MEASURES_PER_CARD}, (_, idx) => ({name: `${idx + 1}`})),
        ],
        hint: "All loops the whole section. A number shows that many measures of the section at a time, like a flashcard.",
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
        visible: settings => !!sheetMusicPiece(settings),
      },
    ],
    // shown under the inputs in the settings panel
    status: function(staff, settings) {
      let {status} = sheetMusicSection(staff, settings)
      let deck = measureCardDeck(staff, settings)
      return deck ? `${deck.status()}. ${status}` : status
    },
    create: function(staff, keySignature, settings) {
      let deck = measureCardDeck(staff, settings)
      if (deck) {
        let recordNotes = settings.startMeasure != settings.endMeasure
        return new MeasureCardGenerator(deck, {recordNotes})
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
