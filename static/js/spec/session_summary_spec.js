import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import {
  TROUBLE_ACCURACY, TROUBLE_ROWS, detectedSession, summaryCards, troubleNotes, summaryInsight,
  focusFromRows,
} from "st/session_summary"
import {SessionSummary} from "st/components/sight_reading/session_summary"
import styles from "st/components/sight_reading/session_summary.module.css"

describe("session summary derivations", function() {
  it("picks out the notes with misses, worst accuracy first", function() {
    let rows = troubleNotes({
      notes: {C: {hits: 9, misses: 1}, "F#": {hits: 2, misses: 3}, G: {hits: 5, misses: 0}},
    })
    expect(rows.map(r => [r.note, r.accuracy, r.weak])).toEqual([
      ["F#", 40, true],
      ["C", 90, false],
    ])
  })

  it("draws the weak line at 75%, gilt at or above it", function() {
    expect(TROUBLE_ACCURACY).toEqual(75)
    // 3 of 4 = 75% exactly: gilt
    expect(troubleNotes({notes: {C: {hits: 3, misses: 1}}})[0].weak).toBe(false)
    // 37 of 50 = 74%: oxblood
    expect(troubleNotes({notes: {C: {hits: 37, misses: 13}}})[0].weak).toBe(true)
  })

  it("keeps only the worst four, ties broken by more misses then note name", function() {
    let notes = {}
    ;["A", "B", "C", "D", "E", "F"].forEach((note, idx) => {
      notes[note] = {hits: 9 - idx, misses: idx + 1}
    })
    expect(TROUBLE_ROWS).toEqual(4)
    expect(troubleNotes({notes}).map(r => r.note)).toEqual(["F", "E", "D", "C"])

    let tied = troubleNotes({notes: {
      D: {hits: 1, misses: 1}, B: {hits: 2, misses: 2}, C: {hits: 1, misses: 1},
    }})
    expect(tied.map(r => r.note)).toEqual(["B", "C", "D"])
  })

  it("has no rows without any missed note", function() {
    expect(troubleNotes({notes: {}})).toEqual([])
    expect(troubleNotes({notes: {C: {hits: 5, misses: 0}}})).toEqual([])
  })

  // a hit is named from the pitch played (always sharp), a miss by the
  // written column (flat in a flat key), so one note holds two keys
  it("adds up the spellings of one pitch class, labelled the way it was missed", function() {
    let rows = troubleNotes({notes: {Bb: {hits: 0, misses: 3}, "A#": {hits: 10, misses: 0}}})
    expect(rows.length).toEqual(1)
    expect(rows[0].note).toEqual("Bb")
    expect(rows[0].hits).toEqual(10)
    expect(rows[0].misses).toEqual(3)
    expect(rows[0].accuracy).toEqual(77)
    expect(rows[0].weak).toBe(false)
  })

  it("labels a merged row with the sharp spelling when that is the missed one", function() {
    let rows = troubleNotes({notes: {Gb: {hits: 4, misses: 0}, "F#": {hits: 0, misses: 4}}})
    expect(rows.map(r => [r.note, r.accuracy])).toEqual([["F#", 50]])
  })

  it("merges Cb with B, the enharmonic a flat key writes", function() {
    let rows = troubleNotes({notes: {Cb: {hits: 1, misses: 1}, B: {hits: 1, misses: 1}}})
    expect(rows.length).toEqual(1)
    expect(rows[0].misses).toEqual(2)
    expect(rows[0].accuracy).toEqual(50)
  })

  it("gives the four live detected cards", function() {
    let record = {elapsedSeconds: 65, notesRead: 47, misses: 3, bestStreak: 21}
    expect(detectedSession(record)).toBe(true)

    let cards = summaryCards(record)
    expect(cards.map(c => c.label)).toEqual(["Elapsed", "Accuracy", "Notes read", "Best streak"])
    expect(cards.map(c => c.value)).toEqual(["1:05", 94, 47, 21])
    expect(cards[1].accent).toBe(true)
    expect(cards[1].suffix).toEqual("%")
  })

  it("falls back to activeSeconds without an elapsed clock", function() {
    let cards = summaryCards({activeSeconds: 42, notesRead: 1, misses: 0, bestStreak: 1})
    expect(cards[0]).toEqual({label: "Elapsed", value: "0:42"})
  })

  it("gives the three live acoustic cards when nothing was detected", function() {
    let record = {notesRead: 0, misses: 0, elapsedSeconds: 10, selfGraded: {passes: 5, clean: 3}}
    expect(detectedSession(record)).toBe(false)

    let cards = summaryCards(record)
    expect(cards.map(c => c.label)).toEqual(["Elapsed", "Passes", "Clean"])
    expect(cards.map(c => c.value)).toEqual(["0:10", 5, 3])
  })

  it("names the perfect session, the weakest note, or nothing to say", function() {
    let perfect = {notesRead: 10, misses: 0}
    expect(summaryInsight(perfect, troubleNotes(perfect))).toEqual("Not a note out of place this evening.")

    let record = {notesRead: 5, misses: 3, notes: {"F#": {hits: 2, misses: 3}, C: {hits: 9, misses: 1}}}
    expect(summaryInsight(record, troubleNotes(record))).toEqual("F♯ asked the most of you tonight.")

    // a chord miss counts no note (NoteStats#hitNotes([])), so there's
    // nothing to name even though misses > 0
    let chordMiss = {notesRead: 1, misses: 1, notes: {}}
    expect(summaryInsight(chordMiss, troubleNotes(chordMiss))).toBe(null)

    let acoustic = {notesRead: 0, misses: 0, selfGraded: {passes: 4, clean: 4}}
    expect(summaryInsight(acoustic, troubleNotes(acoustic))).toEqual("4 of 4 passes clean.")
  })

  it("seeds a focus from the weak rows alone", function() {
    let rows = troubleNotes({notes: {"F#": {hits: 2, misses: 3}, Bb: {hits: 1, misses: 1}}})
    expect(focusFromRows(rows)).toEqual({"F#": true, Bb: true})

    // C is shown (it has a miss) but read at 90%, above the weak line, so
    // the seed leaves it out
    let mixed = troubleNotes({notes: {"F#": {hits: 2, misses: 3}, C: {hits: 9, misses: 1}}})
    expect(mixed.map(r => r.note)).toEqual(["F#", "C"])
    expect(focusFromRows(mixed)).toEqual({"F#": true})

    expect(focusFromRows(troubleNotes({notes: {C: {hits: 9, misses: 1}}}))).toEqual({})
  })
})

describe("session summary card", function() {
  let container, root

  afterEach(function() {
    if (root) {
      flushSync(() => root.unmount())
      root = null
    }
    if (container) {
      container.remove()
      container = null
    }
  })

  let renderSummary = props => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {},
        React.createElement(SessionSummary, props)))
    })
    return container
  }

  let buttonNamed = (el, text) =>
    [...el.querySelectorAll("button")].find(b => b.textContent.trim() == text)

  let statValue = (el, label) => {
    let labelEl = [...el.querySelectorAll("div")].find(div =>
      div.children.length == 0 && div.textContent == label)
    return labelEl.nextElementSibling.textContent
  }

  let record = {
    elapsedSeconds: 65, notesRead: 47, misses: 3, bestStreak: 21,
    notes: {"F#": {hits: 2, misses: 3}, C: {hits: 9, misses: 1}},
  }

  it("opens showing the eyebrow, title, stat cards and trouble rows", function() {
    let onPractise = jasmine.createSpy("onPractise")
    let el = renderSummary({
      record, eyebrow: "Random notes · in G major",
      newProgrammeTo: "/setup", onPractise, onClose: () => {},
    })

    let dialog = el.querySelector("dialog")
    expect(dialog.open).toBe(true)
    expect(el.textContent).toContain("Random notes · in G major")
    expect(el.querySelector("h1").textContent).toEqual("The session is ended")

    expect(statValue(el, "Elapsed")).toEqual("1:05")
    expect(statValue(el, "Notes read")).toEqual("47")
    expect(statValue(el, "Best streak")).toEqual("21")

    let rows = [...el.querySelectorAll(`.${styles.trouble_row}`)]
    expect(rows.length).toEqual(2)
    expect(rows.map(row => row.querySelector(`.${styles.trouble_note}`).textContent)).toEqual(["F♯", "C"])

    let fill = rows[0].querySelector(`.${styles.fill}`)
    expect(fill.style.width).toEqual("40%")
    expect(fill.dataset.weak).toEqual("true")
    expect(rows[1].querySelector(`.${styles.fill}`).dataset.weak).toEqual("false")

    let practise = buttonNamed(el, "Practise these notes")
    expect(practise).not.toBeUndefined()
    flushSync(() => practise.click())
    expect(onPractise).toHaveBeenCalled()
  })

  it("hides the trouble section, the insight and the practise pill without rows", function() {
    let clean = {elapsedSeconds: 10, notesRead: 5, misses: 0, bestStreak: 5, notes: {}}
    let el = renderSummary({
      record: clean, newProgrammeTo: "/setup", onPractise: () => {}, onClose: () => {},
    })

    expect(el.textContent).not.toContain("Notes that gave trouble")
    expect(buttonNamed(el, "Practise these notes")).toBeUndefined()
    // a perfect detected session still has an insight (tested below), so
    // use the chord-miss shape (misses > 0, no rows) to isolate tone: 'plain'
  })

  it("omits the insight line when there's nothing to say (tone: 'plain')", function() {
    let chordMiss = {elapsedSeconds: 5, notesRead: 1, misses: 1, bestStreak: 1, notes: {}}
    let el = renderSummary({record: chordMiss, newProgrammeTo: "/setup", onClose: () => {}})
    expect(el.querySelector(`.${styles.insight}`)).toBe(null)
  })

  it("hides the practise pill without onPractise", function() {
    let el = renderSummary({record, newProgrammeTo: "/setup", onClose: () => {}})
    expect(buttonNamed(el, "Practise these notes")).toBeUndefined()
  })

  it("shows a gilt row but no practise pill when nothing shown is weak", function() {
    let gilt = {
      elapsedSeconds: 30, notesRead: 9, misses: 1, bestStreak: 9,
      notes: {C: {hits: 9, misses: 1}},
    }
    let el = renderSummary({
      record: gilt, newProgrammeTo: "/setup", onPractise: () => {}, onClose: () => {},
    })

    let rows = [...el.querySelectorAll(`.${styles.trouble_row}`)]
    expect(rows.length).toEqual(1)
    expect(rows[0].querySelector(`.${styles.fill}`).dataset.weak).toEqual("false")
    expect(buttonNamed(el, "Practise these notes")).toBeUndefined()
  })

  it("closes on Esc and on the dismiss ×", function() {
    let onClose = jasmine.createSpy("onClose")
    let el = renderSummary({record, newProgrammeTo: "/setup", onClose})

    let dialog = el.querySelector("dialog")
    flushSync(() => dialog.dispatchEvent(new Event("cancel", {cancelable: true})))
    expect(onClose).toHaveBeenCalledTimes(1)

    flushSync(() => el.querySelector(`.${styles.dismiss}`).click())
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("renders New programme as a link to newProgrammeTo, and See all progress as a link", function() {
    let el = renderSummary({record, newProgrammeTo: "/setup", onClose: () => {}})
    let link = [...el.querySelectorAll("a")].find(a => a.textContent == "New programme")
    expect(link.getAttribute("href")).toEqual("/setup")
    let progress = [...el.querySelectorAll("a")].find(a => a.textContent.includes("See all progress"))
    expect(progress.getAttribute("href")).toEqual("/stats")
  })

  it("renders New programme as a button calling onNewProgramme without newProgrammeTo", function() {
    let onNewProgramme = jasmine.createSpy("onNewProgramme")
    let el = renderSummary({record, onNewProgramme, onClose: () => {}})
    let button = buttonNamed(el, "New programme")
    flushSync(() => button.click())
    expect(onNewProgramme).toHaveBeenCalled()
  })
})
