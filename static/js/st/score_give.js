// The printed bars of a score that ask the player for give: a fermata, or a
// word that slows or broadens the tempo (rit., rall., a piacere...). The bar
// log's timing strip never judges the pulse there (st/bar_review), so the
// score page reads them from the piece's stored MusicXML when a bar's window
// opens, rather than the importer carrying them in the song model. The bar
// itself and the one after it count: a rit. mostly shows in the bar it
// leads into, and a fermata holds the bar's last note into the next onset

import {measureNumbersFor} from "st/measure_numbers"

// the words that give (abbreviated or written out, any case), each a whole
// word so "tenderly" and "a tempo" don't
const GIVE_WORDS = new RegExp(
  "\\b(?:rit(?:ard(?:ando)?|enuto)?|rall(?:entando)?|riten(?:uto)?|allarg(?:ando)?|" +
  "a piacere|ad lib(?:itum)?|calando|morendo|smorz(?:ando)?|ten(?:uto)?)(?![a-z])", "i")

const childrenNamed = (el, name) => [...el.children].filter(child => child.localName == name)

/**
 * @param {string} musicXML a piece's uncompressed source score
 * @returns {Set<number>} the printed bar numbers that ask for give, empty for
 * a score that can't be read
 */
export function giveBars(musicXML) {
  let bars = new Set()
  if (typeof musicXML != "string" || !musicXML.trim()) { return bars }

  let doc = new DOMParser().parseFromString(musicXML, "application/xml")
  let root = doc.documentElement
  if (!root || root.localName == "parsererror" || doc.getElementsByTagName("parsererror").length) {
    return bars
  }

  let parts = childrenNamed(root, "part")
  if (!parts.length) { return bars }

  let numbers = measureNumbersFor(childrenNamed(parts[0], "measure"))

  for (let part of parts) {
    childrenNamed(part, "measure").forEach((measure, idx) => {
      let gives = measure.getElementsByTagName("fermata").length > 0 ||
        [...measure.getElementsByTagName("words")].some(words => GIVE_WORDS.test(words.textContent))
      if (!gives || numbers[idx] == null) { return }

      bars.add(numbers[idx])
      if (numbers[idx + 1] != null) { bars.add(numbers[idx + 1]) }
    })
  }

  return bars
}
