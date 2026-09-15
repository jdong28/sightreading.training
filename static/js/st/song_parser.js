
import peg from "st/song_parser_peg"
import {parseNote, noteName, KeySignature} from "st/music"

import {MultiTrackSong, SongNote} from "st/song_note_list"
import {AutoChords} from "st/auto_chords"

// tokens are separated by whitepace
// a note is a4.1.2
//   - 4 is the octave, middle C is c4
//   - 1 is the duration
//   - 2 is the start
//
//   duration and start are optional
//   duration defaults to 1 beat (or the current duration)
//   start defauls to current cusor position


// A note command (see song_parser_peg.pegjs) or a comment, in song text.
// Commands are separated by white space, a note can also follow a block's
// "{" and be followed by its timing or a "}"; a comment runs from a "#" after
// white space to the end of the line
const NOTATION_NOTE_OR_COMMENT = /(^|[\s{])(?:(#[^\n]*)|([a-gA-G][+=-]?)([0-9])(?=$|[\s.}]))/g

// Song text with the octave of every note moved by octaves, eg. ("c5 d+5.2",
// -1) -> "c4 d+4.2". Notation octaves are a single digit, so a note that
// would move out of 0-9 is left as written. Used to move songs written in
// the app's former numbering, where middle C was c5, to the current one
export function shiftNotationOctaves(text, octaves) {
  return text.replace(NOTATION_NOTE_OR_COMMENT, (match, before, comment, name, octave) => {
    let shifted = +octave + octaves
    if (comment || shifted < 0 || shifted > 9) {
      return match
    }

    return `${before}${name}${shifted}`
  })
}

export default class SongParser {
  static peg = peg

  static load(songText, opts) {
    let parser = new SongParser
    let ast = parser.parse(songText)
    return parser.compile(ast, opts)
  }

  // convert song text to ast
  parse(songText) {
    return peg.parse(songText)
  }

  // compile ast to song notes
  compile(ast, opts) {
    let state = {
      startPosition: 0,
      position: 0,
      beatsPerNote: 1,
      beatsPerMeasure: 4,
      timeScale: 1,
      keySignature: new KeySignature(0),
      currentTrack: 0,
    }

    let song = new MultiTrackSong()
    this.compileCommands(ast, state, song)

    song.metadata = {
      keySignature: state.keySignature.count,
      beatsPerMeasure: state.beatsPerMeasure,
    }

    if (song.autoChords) {
      let settings = opts ? opts.autoChordsSettings : {}
      if (opts && opts.autoChords) {
        new opts.autoChords(song, settings).addChords()
      } else {
        AutoChords.defaultChords(song, settings).addChords()
      }
    }

    return song
  }

  compileCommands(commands, state, song) {
    for (let command of commands) {
      let t = command[0]
      switch (t) {
        case "restoreStartPosition": {
          state.position = state.startPosition
          break
        }
        case "block": {
          let [, blockCommands] = command
          let blockState = {
            startPosition: state.position
          }

          Object.setPrototypeOf(blockState, state)
          this.compileCommands(blockCommands, blockState, song)

          state.position = blockState.position

          break
        }
        case "halfTime": {
          state.timeScale *= 2
          break
        }
        case "doubleTime": {
          state.timeScale *= 0.5
          break
        }
        case "tripleTime": {
          state.timeScale *= 1/3
          break
        }
        case "measure": {
          let [, measure] = command
          state.position = measure * state.beatsPerMeasure
          break
        }
        case "setTrack": {
          let [, track] = command
          state.currentTrack = +track
          break
        }
        case "cleff": {
          let [, cleff] = command
          let track = song.getTrack(state.currentTrack)
          if (!track.cleffs) {
            track.cleffs = []
          }

          track.cleffs.push([state.position, cleff])
          break
        }
        case "note": {
          let [, name, noteOpts] = command
          let duration = state.beatsPerNote * state.timeScale
          let start = null

          let hasAccidental = false

          if (noteOpts) {
            if (noteOpts.duration) {
              duration *= noteOpts.duration
            }

            start = noteOpts.start


            if (noteOpts.sharp) {
              hasAccidental = true
              name = name.substr(0, 1) + "#" + name.substr(1)
            } else if (noteOpts.flat) {
              hasAccidental = true
              name = name.substr(0, 1) + "b" + name.substr(1)
            } else if (noteOpts.natural) {
              hasAccidental = true
            } 
          }

          if (!hasAccidental) {
            // apply default accidental
            name = state.keySignature.unconvertNote(name)
          }

          if (!start) {
            start = state.position
            state.position += duration
          }

          song.pushWithTrack(new SongNote(name, start, duration), state.currentTrack)
          break
        }
        case "rest": {
          let [, restTiming] = command

          let duration = state.beatsPerNote * state.timeScale

          if (restTiming) {
            if (restTiming.start) {
              break // do nothing
            }

            if (restTiming.duration) {
              duration *= restTiming.duration
            }
          }

          state.position += duration
          break
        }
        case "keySignature": {
          state.keySignature = new KeySignature(+command[1])
          break
        }
        case "timeSignature": {
          let [, perBeat, noteValue] = command
          state.beatsPerNote = 4 / noteValue
          state.beatsPerMeasure = state.beatsPerNote * perBeat
          break
        }
        case "macro": {
          let [, macroName] = command
          let chord = AutoChords.coerceChord(macroName)

          if (chord) {
            if (!song.autoChords) {
              song.autoChords = []
            }
            song.autoChords.push([state.position, chord])
          }

          break
        }
        default: {
          console.warn("Got unknown command when parsing song", command)
        }
      }
    }

  }
}
