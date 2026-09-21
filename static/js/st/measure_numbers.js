// The bar numbers printed on the score, by measure index. Notation software
// doesn't count implicit measures: a leading pickup is measure 0 and the
// second half of a bar split around a repeat keeps the number of the first.
// Some exporters mark a pickup only by numbering it 0. Shared by the
// importer (st/musicxml) and the engraving engines (st/score_render), so a
// bar number names the same measures in both
export function measureNumbersFor(measureEls, measureCount=measureEls.length) {
  let numbers = []
  let number = 0

  for (let i = 0; i < measureCount; i++) {
    let el = measureEls[i]
    if (el && el.localName == "part") {
      el = el.parentElement
    }

    let implicit = el && (el.getAttribute("implicit") == "yes" ||
      (i == 0 && (el.getAttribute("number") || "").trim() == "0"))

    if (!implicit) {
      number += 1
    }

    numbers.push(number)
  }

  return numbers
}
