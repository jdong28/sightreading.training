// The notated values the importer (st/musicxml) names a note or rest with,
// kept on each note as its notation. Nothing here draws them: an imported
// score is drawn by an engraving engine (st/score_render), which reads the
// source MusicXML itself.

// every notated value, in quarter note beats
export const NOTE_TYPES = {
  breve: {beats: 8},
  whole: {beats: 4},
  half: {beats: 2},
  quarter: {beats: 1},
  eighth: {beats: 0.5},
  "16th": {beats: 0.25},
  "32nd": {beats: 0.125},
  "64th": {beats: 0.0625},
  "128th": {beats: 0.03125},
}

// the values a duration is spelled with, longest first
const TYPES_BY_LENGTH = Object.keys(NOTE_TYPES)
  .sort((a, b) => NOTE_TYPES[b].beats - NOTE_TYPES[a].beats)

// the most augmentation dots a duration is spelled with
const MAX_DOTS = 2

const BEAT_EPSILON = 1e-6

// how much longer dots make a note: one dot is 1.5x, two 1.75x
function dotFactor(dots) {
  return 2 - Math.pow(2, -(dots || 0))
}

// The notated value a duration in beats is written as: {type, dots}, exact
// when the duration spells one (with up to two dots), else the longest value
// that fits, so an unusual duration is still named. Null for a duration that
// is zero or negative.
export function typeForBeats(beats) {
  if (!(beats > 0)) { return null }

  for (let type of TYPES_BY_LENGTH) {
    for (let dots = 0; dots <= MAX_DOTS; dots++) {
      if (Math.abs(NOTE_TYPES[type].beats * dotFactor(dots) - beats) < BEAT_EPSILON) {
        return {type, dots}
      }
    }
  }

  let type = TYPES_BY_LENGTH.find(name => NOTE_TYPES[name].beats <= beats + BEAT_EPSILON)
  return {type: type || TYPES_BY_LENGTH[TYPES_BY_LENGTH.length - 1], dots: 0}
}
