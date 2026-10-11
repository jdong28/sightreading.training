import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route, useLocation} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {statsPageFor} from "st/components/pages/stats"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, RIGHT_HAND, FREE_PRACTICE} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {newLessonNote, noteDate, noteLongDate} from "st/lesson_notes"
import {openTestStore, pickupScore, dynamicsOpening} from "spec/helpers"

const DAY = 24 * 60 * 60 * 1000

let waitFor = async (test, {timeout=15000, message="the condition"}={}) => {
  let start = Date.now()
  for (;;) {
    let value = test()
    if (value) { return value }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

// a value put into a React textarea as a user's typing does
let type = (el, value) => flushSync(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value)
  el.dispatchEvent(new Event("input", {bubbles: true}))
})

const KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]

// The score page with notes for the next lesson, the real fixture (16 bars, a
// chord of C5 over C3 up to F5 over F3 in each) mounted through ScorePage and
// played with the page's own keys, as bar_review_spec's mounted specs do
describe("notes for the next lesson on the score page, mounted", function() {
  let container, root, page, store, previous, saved, location, clock
  let LocationProbe = () => {
    location = useLocation()
    return null
  }

  beforeEach(async function() {
    saved = KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of KEYS) { window.localStorage.removeItem(key) }
    store = await openTestStore()
    previous = setAppStore(store)
    clock = 100000
  })

  afterEach(function() {
    // a session left running keeps counting every note of every NoteStats
    // (st/measure_cards), which the next specs would see
    let generator = page && page.state && page.state.notes && page.state.notes.generator
    if (generator && generator.stop) { generator.stop() }
    page = null

    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previous)
    store.close()
    for (let [key, value] of saved) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let button = text => [...container.querySelectorAll("button")].find(b => b.textContent.trim() == text)
  let bar = number => container.querySelector(`button[aria-label="Bar ${number}"]`)
  let click = el => flushSync(() => el.click())
  let popup = () => container.querySelector('[role="dialog"]')
  let pin = measure => container.querySelector(`[data-pin="${measure}"]`)
  let ready = async (test, message="the page") => waitFor(test, {message})

  let mount = async (settings={}, {width=1440, entries, xml}={}) => {
    let musicXML = xml || await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    let {piece} = await importMusicXMLPiece("fixture.musicxml", musicXML, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: 1, practice: FREE_PRACTICE,
      startMeasure: 3, endMeasure: 3, ...settings,
    }))
    await render({width, entries})
    return piece
  }

  let render = async ({width=1440, entries=["/sheet-music"], engraved=true}={}) => {
    container = document.createElement("div")
    container.style.width = `${width}px`
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => root.render(React.createElement(MemoryRouter, {initialEntries: entries},
      React.createElement(LocationProbe),
      React.createElement(ScorePage, {ref: p => page = p}))))
    await waitFor(() => (!engraved || container.querySelector("[data-score-sheet] svg")) &&
      container.querySelector('button[aria-label^="Bar "]'), {message: "the score"})
    await paginated()
  }

  let leave = () => {
    flushSync(() => root.unmount())
    root = null
    container.remove()
    container = null
  }

  let paginated = async () => {
    let count = () => container.querySelectorAll('button[aria-label^="Bar "]').length
    let seen = -1
    for (let stable = 0; stable < 6;) {
      await new Promise(resolve => setTimeout(resolve, 50))
      let now = count()
      stable = now == seen ? stable + 1 : 0
      seen = now
    }
  }

  let play = ({wrong={}, step=500}={}) => {
    let columns = page.currentCard().card.columns.length
    for (let i = 0; i < columns; i++) {
      clock += step
      let column = [...page.state.notes.currentColumn()]
      for (let key of wrong[i] || []) {
        flushSync(() => page.pressNote(key, clock))
        flushSync(() => page.releaseNote(key, clock + 10))
      }
      for (let note of column) { flushSync(() => page.pressNote(note, clock)) }
      for (let note of column) { flushSync(() => page.releaseNote(note, clock + 20)) }
    }
  }

  // Begin, the passes, End session and Done: the bars back at rest
  let session = async (...passes) => {
    click(button("Begin"))
    for (let pass of passes) { play(pass) }
    await page.state.notes.generator.finishing
    click(button("End session"))
    await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
    click(button("Done"))
    await waitFor(() => bar(3), {message: "the score back"})
  }

  let showBar = number => {
    for (let turns = 0; !bar(number) && !button("Next page ›").disabled && turns < 10; turns++) {
      click(button("Next page ›"))
    }
    expect(bar(number)).withContext(`bar ${number} on a page`).toBeTruthy()
    return bar(number)
  }

  // three passes of bar 3 with beat 2 wrong, then bar 3's window
  let wrongThrice = {wrong: {1: ["D#3"]}}
  let openBarWindow = async number => {
    click(showBar(number))
    await ready(() => popup(), "the bar's window")
  }

  let noteForm = () => popup().querySelector("form")
  let words = "Why do I keep hitting D# here?"

  // a note on bar 3, the fields of extra given to newLessonNote and then laid
  // over the record (a status, an answer)
  let storedNote = (piece, extra={}) => {
    let fields = {
      source: "bar", pieceId: piece.id, pieceTitle: piece.title, start: 3, end: 3, text: words,
      now: Date.now() - DAY, ...extra,
    }
    return {...newLessonNote(fields), ...extra}
  }

  describe("writing a note from a bar's window", function() {
    it("keeps the words, the topic and what happened, shows them as quiet marks, and leaves the window open", async function() {
      let piece = await mount()
      await session(wrongThrice, wrongThrice, wrongThrice)

      await openBarWindow(3)
      await ready(() => popup().textContent.includes("Behind the 75%"), "the window's reading")
      click(button("❧ Note for lesson"))

      // the window's body is the form: the stats are out of the way
      expect(noteForm()).toBeTruthy()
      expect(popup().textContent).toContain("Note for your lesson")
      expect(popup().querySelector("textarea").getAttribute("placeholder")).toEqual("What do you want to ask?")
      expect(popup().textContent).toContain("Your note")
      expect(popup().textContent).toContain("Attach what happened: 75%, beat 2 went wrong in all 3 of your last passes")
      expect(popup().textContent).not.toContain("Behind the 75%")
      expect([...popup().querySelectorAll("button")].map(b => b.textContent).filter(t =>
        ["Notes", "Rhythm", "Fingering", "Pedal", "How to practise", "Other"].includes(t))).toEqual(
        ["Notes", "Rhythm", "Fingering", "Pedal", "How to practise", "Other"])

      type(popup().querySelector("textarea"), words)
      let fingering = [...popup().querySelectorAll("button")].find(b => b.textContent == "Fingering")
      click(fingering)
      expect(fingering.getAttribute("aria-pressed")).toEqual("true")
      click(button("Save note"))

      await ready(() => store.lessonNotes().length == 1, "the note")
      let [note] = store.lessonNotes()
      expect(note).toEqual(jasmine.objectContaining({
        source: "bar", pieceId: piece.id, pieceTitle: piece.title, start: 3, end: 3, hand: "both",
        topic: "fingering", text: words, status: "open",
        evidence: {at: jasmine.any(Number), accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"},
      }))

      // the form is gone, the window is back with the note as a quiet line
      await ready(() => popup() && !noteForm(), "the form to close")
      expect(popup().textContent).toContain("Behind the 75%")
      expect(popup().textContent).toContain(`Your note · ${noteDate(Date.now())}`)
      expect(popup().textContent).toContain(words)

      // a pin on the bar, a line in Tonight's session
      await ready(() => pin(3), "the pin")
      expect(pin(3).textContent).toEqual("❧ note")
      expect(container.textContent).toContain("❧ 1 note for your lesson")
      let open = [...container.querySelectorAll("a")].find(a => a.textContent == "Open")
      expect(open.getAttribute("href")).toEqual("/stats/for-my-lesson")
    })

    it("stores nothing when the form is cancelled, and Escape closes only the form", async function() {
      await mount()
      await session(wrongThrice, wrongThrice, wrongThrice)
      await openBarWindow(3)

      click(button("❧ Note for lesson"))
      type(popup().querySelector("textarea"), words)
      click(button("Cancel"))
      expect(noteForm()).toBe(null)
      expect(popup()).toBeTruthy()
      expect(store.lessonNotes()).toEqual([])
      expect(pin(3)).toBe(null)

      // Escape in the form: the form closes, the window stays
      click(button("❧ Note for lesson"))
      expect(popup().querySelector("textarea").value).toEqual("")
      flushSync(() => popup().querySelector("textarea").dispatchEvent(
        new KeyboardEvent("keydown", {key: "Escape", bubbles: true})))
      expect(noteForm()).toBe(null)
      expect(popup()).toBeTruthy()
      expect(store.lessonNotes()).toEqual([])

      // and a second Escape, with no form, closes the window as it did
      document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
      await ready(() => popup() == null, "the window to close")
    })

    it("can leave what happened off, needs words to save, and offers nothing to attach for a bar never played", async function() {
      await mount()
      await session(wrongThrice, wrongThrice, wrongThrice)
      await openBarWindow(3)
      await ready(() => popup().textContent.includes("Behind the 75%"), "the window's reading")

      click(button("❧ Note for lesson"))
      expect(button("Save note").disabled).toBe(true)
      type(popup().querySelector("textarea"), "   ")
      expect(button("Save note").disabled).toBe(true)
      type(popup().querySelector("textarea"), words)
      expect(button("Save note").disabled).toBe(false)

      let attach = popup().querySelector('input[type="checkbox"]')
      expect(attach.checked).toBe(true)
      click(attach)
      expect(attach.checked).toBe(false)
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 1, "the note")
      expect(store.lessonNotes()[0].evidence).toBe(null)
      expect(store.lessonNotes()[0].topic).toBe(null)

      // bar 4 was never played: nothing happened to attach
      click(showBar(4))
      await ready(() => popup() && popup().textContent.includes("No practice recorded for bar 4 yet."), "bar 4")
      click(button("❧ Note for lesson"))
      expect(popup().querySelector('input[type="checkbox"]')).toBe(null)
      type(popup().querySelector("textarea"), "Is this the right fingering?")
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 2, "the second note")
      expect(store.lessonNotes()[1]).toEqual(jasmine.objectContaining({start: 4, end: 4, evidence: null}))
    })

    it("writes the note under the hand the setup pane has picked", async function() {
      let piece = await mount({hand: RIGHT_HAND})
      await openBarWindow(3)
      click(button("❧ Note for lesson"))
      type(popup().querySelector("textarea"), words)
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 1, "the note")
      expect(store.lessonNotes()[0]).toEqual(jasmine.objectContaining({hand: "upper", pieceId: piece.id}))
    })
  })

  describe("on a real piece", function() {
    it("writes a note on a bar of a score with a title, key signature, dynamics, slurs and a pickup bar, its pin on that bar", async function() {
      let piece = await mount({startMeasure: 2, endMeasure: 2}, {xml: dynamicsOpening()})
      expect(container.querySelector("h1").textContent).toContain("Expressive Study")

      await openBarWindow(2)
      click(button("❧ Note for lesson"))
      type(popup().querySelector("textarea"), "How loud is the first chord?")
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 1, "the note")
      expect(store.lessonNotes()[0]).toEqual(jasmine.objectContaining({start: 2, end: 2, pieceId: piece.id}))

      await ready(() => pin(2), "the pin")
      let box = bar(2).getBoundingClientRect()
      let chip = pin(2).getBoundingClientRect()
      expect(chip.right).toBeLessThanOrEqual(box.right + 1)
      expect(chip.right).toBeGreaterThanOrEqual(box.right - 8)
      expect(chip.left).toBeGreaterThanOrEqual(box.left)
      expect(chip.top).toBeGreaterThanOrEqual(box.top - 1)
      expect(chip.bottom).toBeLessThanOrEqual(box.bottom)
    })
  })

  describe("the marks of a stored note", function() {
    it("come back from the store on a fresh visit, and a click on the pin opens the bar's window", async function() {
      let piece = await mount()
      await store.putLessonNote(storedNote(piece))
      await store.putLessonNote(storedNote(piece, {text: "A second question"}))
      leave()
      await render()

      showBar(3)
      await ready(() => pin(3), "the pin")
      expect(pin(3).textContent).toEqual("❧ 2 notes")
      expect(pin(3).getAttribute("aria-label")).toEqual("2 notes for your lesson, bar 3")
      expect(container.textContent).toContain("❧ 2 notes for your lesson")

      // inside the bar's corner, over it
      let box = bar(3).getBoundingClientRect()
      let chip = pin(3).getBoundingClientRect()
      expect(chip.right).toBeLessThanOrEqual(box.right + 1)
      expect(chip.right).toBeGreaterThanOrEqual(box.right - 8)
      expect(chip.top).toBeGreaterThanOrEqual(box.top - 1)
      expect(chip.bottom).toBeLessThanOrEqual(box.bottom)
      expect(chip.left).toBeGreaterThanOrEqual(box.left)

      expect(popup()).toBe(null)
      click(pin(3))
      await ready(() => popup(), "the window")
      expect(popup().textContent).toContain("Bar 3")
      expect(popup().textContent).toContain(words)
      expect(popup().textContent).toContain("A second question")
    })

    it("sit on the grid of a piece drawn without its score", async function() {
      let piece = await mount()
      await store.putPiece(store.piece(piece.id), {source: null})
      await store.putLessonNote(storedNote(piece))
      leave()
      await render({engraved: false})
      expect(container.querySelector("svg")).toBe(null)

      let chip = container.querySelector('button[aria-label="1 note for your lesson, bar 3"]')
      expect(chip).toBeTruthy()
      expect(chip.textContent).toEqual("❧ note")
      expect(bar(3).parentElement.contains(chip)).toBe(true)

      // over the cell it marks
      let cell = bar(3).getBoundingClientRect()
      let box = chip.getBoundingClientRect()
      expect(box.top).toBeGreaterThanOrEqual(cell.top - 8)
      expect(box.bottom).toBeLessThanOrEqual(cell.bottom)
      expect(box.right).toBeLessThanOrEqual(cell.right + 8)
      expect(box.right).toBeGreaterThanOrEqual(cell.right - 8)
      // a chip wider than the cell hangs off its left edge by the little that is over
      expect(box.left).toBeGreaterThanOrEqual(cell.left - 16)

      click(chip)
      await ready(() => popup() && popup().textContent.includes(words), "the window")

      // writing from the grid's window works as it does on the score
      click(button("❧ Note for lesson"))
      type(popup().querySelector("textarea"), "Another from the grid")
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 2, "the second note")
      expect(container.querySelector('button[aria-label="2 notes for your lesson, bar 3"]')).toBeTruthy()
    })

    it("show a note's words and the teacher's answer for the bar, and say nothing of a note with no words", async function() {
      let piece = await mount()
      await store.putLessonNote(storedNote(piece))
      await store.putLessonNote(storedNote(piece, {text: ""}))
      await store.putLessonNote(storedNote(piece, {
        text: "Thumb or third?", status: "discussed", discussedAt: Date.now() - DAY, answer: "Thumb under on the G.",
      }))
      await store.putLessonNote(storedNote(piece, {text: "Dropped one", status: "dropped"}))

      await openBarWindow(3)
      let lines = popup().querySelector('[aria-label="For your lesson"]')
      expect(lines.textContent).toContain(words)
      expect(lines.textContent).toContain(`Teacher, ${noteDate(Date.now() - DAY)}`)
      expect(lines.textContent).toContain("Thumb under on the G.")
      expect(lines.textContent).not.toContain("Dropped one")
      expect(lines.textContent).not.toContain("Thumb or third?")
    })
  })

  describe("in a session", function() {
    let status = () => container.querySelector('[role="status"]')

    it("flags the bars on the stand with one tap, no words, and keeps the keys free for the space bar", async function() {
      let piece = await mount()
      click(button("Begin"))
      play({wrong: {1: ["D#3"]}})
      await page.state.notes.generator.finishing

      expect(container.textContent).toContain("On the stand: bar 3")
      let flag = button("❧ Flag for lesson")
      click(flag)
      await ready(() => status() && status().textContent.includes("Flagged"), "the status")
      expect(status().textContent).toEqual("Flagged bar 3 for your lesson. Add words later, at rest.")

      expect(store.lessonNotes().length).toEqual(1)
      expect(store.lessonNotes()[0]).toEqual(jasmine.objectContaining({
        source: "session", pieceId: piece.id, start: 3, end: 3, text: "", hand: "both", status: "open",
        evidence: {at: jasmine.any(Number), accuracy: 75, line: "Beat 2 went wrong in your last pass"},
      }))
      expect(popup()).toBe(null)
      expect(document.activeElement).not.toBe(flag)

      // the space bar skips the note instead of pressing the flag again
      let before = [...page.state.notes.currentColumn()]
      let target = document.activeElement || document.body
      let key = type => new KeyboardEvent(type, {keyCode: 32, key: " ", code: "Space", bubbles: true})
      flushSync(() => target.dispatchEvent(key("keydown")))
      flushSync(() => target.dispatchEvent(key("keyup")))
      expect([...page.state.notes.currentColumn()]).not.toEqual(before)
      expect(store.lessonNotes().length).toEqual(1)
    })

    it("flags through a rest and a resume, after the session ends, and again in a second session of the visit", async function() {
      await mount()
      click(button("Begin"))
      play()
      await page.state.notes.generator.finishing

      // at rest in place: the stand and the flag stay, and a flag lands
      click(button("Rest"))
      expect(button("❧ Flag for lesson")).toBeTruthy()
      click(button("❧ Flag for lesson"))
      await ready(() => store.lessonNotes().length == 1, "the flag")

      // resumed, the same bars are already flagged
      click(button("Resume"))
      click(button("❧ Flag for lesson"))
      await ready(() => status() && status().textContent == "Already flagged for your lesson.", "the answer")
      expect(store.lessonNotes().length).toEqual(1)

      // the session ends: no flag at rest, the pin and the setup line stay
      click(button("End session"))
      await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
      click(button("Done"))
      await waitFor(() => bar(3), {message: "the score back"})
      expect(button("❧ Flag for lesson")).toBeUndefined()
      expect(container.textContent).toContain("❧ 1 note for your lesson")
      showBar(3)
      await ready(() => pin(3), "the pin")

      // a second session: the flag is still there, and a new card gets its own
      click(button("Begin"))
      click(button("❧ Flag for lesson"))
      await ready(() => status() && status().textContent == "Already flagged for your lesson.", "the answer")
      expect(store.lessonNotes().length).toEqual(1)
    })

    it("flags nothing when the session was begun and ended with nothing played", async function() {
      await mount()
      click(button("Begin"))
      click(button("End session"))
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(store.lessonNotes()).toEqual([])
      expect(button("❧ Flag for lesson")).toBeUndefined()
    })

    it("says so when the same bars are flagged again, and writes nothing", async function() {
      await mount()
      click(button("Begin"))
      play()
      await page.state.notes.generator.finishing

      click(button("❧ Flag for lesson"))
      await ready(() => status() && status().textContent.includes("Flagged bar 3"), "the first flag")
      click(button("❧ Flag for lesson"))
      await ready(() => status() && status().textContent == "Already flagged for your lesson.", "the second answer")
      expect(store.lessonNotes().length).toEqual(1)

      // the flag of another card is another note
      await store.updateLessonNote(store.lessonNotes()[0].id, note => ({...note, start: 5, end: 5}))
      click(button("❧ Flag for lesson"))
      await ready(() => store.lessonNotes().length == 2, "a flag of this card")
    })

    it("flags a range of bars as a range, and a flag with no finished pass has nothing happened to attach", async function() {
      let piece = await mount({startMeasure: 3, endMeasure: 4, measuresPerCard: 2})
      click(button("Begin"))
      expect(container.textContent).toContain("On the stand: bars 3–4")

      click(button("❧ Flag for lesson"))
      await ready(() => status() && status().textContent.includes("Flagged"), "the status")
      expect(status().textContent).toEqual("Flagged bars 3–4 for your lesson. Add words later, at rest.")
      expect(store.lessonNotes()[0]).toEqual(jasmine.objectContaining({
        start: 3, end: 4, pieceId: piece.id, evidence: null,
      }))
    })

    it("shows your note and the teacher's answer for the bars on the stand, never a pop-up", async function() {
      let piece = await mount()
      await store.putLessonNote(storedNote(piece))
      await store.putLessonNote(storedNote(piece, {text: ""}))
      await store.putLessonNote(storedNote(piece, {
        start: 3, end: 3, text: "Thumb or third?", status: "discussed", discussedAt: new Date(2026, 9, 2, 12).getTime(),
        answer: "Thumb under on the G; count four.",
      }))

      click(button("Begin"))
      let rail = container.querySelector("aside")
      await ready(() => container.textContent.includes("Your note · bar 3"), "the note's line")
      expect(container.textContent).toContain(words)
      expect(container.textContent).toContain("Teacher, 2 Oct · bar 3")
      expect(container.textContent).toContain("Thumb under on the G; count four.")
      expect(rail).toBeTruthy()
      expect(popup()).toBe(null)

      // a pass later there is still no window
      play()
      await page.state.notes.generator.finishing
      expect(popup()).toBe(null)
      expect(container.querySelector('[role="dialog"]')).toBe(null)
    })

    it("shows nothing of them on a card at another bar", async function() {
      let piece = await mount({startMeasure: 4, endMeasure: 4})
      await store.putLessonNote(storedNote(piece))
      await store.putLessonNote(storedNote(piece, {
        text: "Thumb or third?", status: "discussed", discussedAt: Date.now() - DAY, answer: "Thumb under.",
      }))

      click(button("Begin"))
      await ready(() => container.textContent.includes("On the stand: bar 4"), "the stand")
      expect(container.textContent).not.toContain("Your note ·")
      expect(container.textContent).not.toContain("Teacher,")
      expect(container.textContent).not.toContain(words)
    })
  })

  describe("removing a piece that has notes", function() {
    let notes = async piece => {
      await store.putLessonNote(storedNote(piece))
      await store.putLessonNote(storedNote(piece, {text: "A second question"}))
      await store.putLessonNote({...newLessonNote({source: "general", text: "Anything", now: Date.now()})})
    }

    it("asks what to do first, and Cancel changes nothing", async function() {
      let piece = await mount()
      await notes(piece)

      click(button("Remove"))
      expect(container.textContent).toContain(`${piece.title} has 2 notes for your lesson.`)
      expect(store.pieces().length).toEqual(1)

      click(button("Cancel"))
      expect(container.textContent).not.toContain("for your lesson.")
      expect(store.pieces().length).toEqual(1)
      expect(store.lessonNotes().length).toEqual(3)
    })

    it("keeps the notes with the piece's title when asked to", async function() {
      let piece = await mount()
      await notes(piece)

      click(button("Remove"))
      click(button("Keep the notes"))
      await ready(() => store.pieces().length == 0, "the piece to go")

      expect(store.lessonNotes().length).toEqual(3)
      expect(store.lessonNotes().filter(note => note.status == "open").length).toEqual(3)
      expect(store.lessonNotes().filter(note => note.pieceId == piece.id).every(note => note.pieceTitle == piece.title)).toBe(true)
      await ready(() => container.textContent.includes("its 2 lesson notes are kept in For my lesson."), "the message")
      expect(container.textContent).toContain(`Removed "${piece.title}" from the deck; its 2 lesson notes are kept in For my lesson.`)
    })

    it("removes them with it when asked to, the note on no piece staying", async function() {
      let piece = await mount()
      await notes(piece)

      click(button("Remove"))
      click(button("Remove them too"))
      await ready(() => store.pieces().length == 0, "the piece to go")

      expect(store.lessonNotes().map(note => note.text)).toEqual(["Anything"])
      await ready(() => container.textContent.includes(`Removed "${piece.title}" from the deck`), "the message")
    })

    it("removes a piece with no notes at once, as it always did", async function() {
      let piece = await mount()
      await store.putLessonNote(storedNote(piece, {status: "discussed", discussedAt: Date.now(), answer: "x"}))

      click(button("Remove"))
      await ready(() => store.pieces().length == 0, "the piece to go")
      expect(container.textContent).not.toContain("for your lesson.")
      expect(store.lessonNotes().length).toEqual(1)
    })
  })

  describe("on a narrow window", function() {
    it("keeps the actions of a bar's window and the flag within their boxes", async function() {
      let piece = await mount({}, {width: 520})
      await store.putLessonNote(storedNote(piece))
      await openBarWindow(3)

      let box = popup().getBoundingClientRect()
      for (let el of popup().querySelectorAll("button")) {
        let rect = el.getBoundingClientRect()
        expect(rect.right).toBeLessThanOrEqual(box.right + 1)
        expect(rect.left).toBeGreaterThanOrEqual(box.left - 1)
      }

      let practise = button("Practise bar 3").getBoundingClientRect()
      let note = button("❧ Note for lesson").getBoundingClientRect()
      expect(practise.height).toBeGreaterThanOrEqual(40)
      expect(note.height).toBeGreaterThanOrEqual(40)
    })
  })
})

// The tab of the practice record, mounted at /stats/for-my-lesson with the
// real fixture and its notes in the store
describe("the For my lesson tab, mounted", function() {
  let container, root, store, previous, saved, location, piece, other
  let Probe = () => {
    location = useLocation()
    return null
  }

  const STORAGE_KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]
  const today = () => noteDate(Date.now())

  beforeEach(async function() {
    saved = STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of STORAGE_KEYS) { window.localStorage.removeItem(key) }
    store = await openTestStore()
    previous = setAppStore(store)
    let xml = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    piece = (await importMusicXMLPiece("fixture.musicxml", xml, store)).piece
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: 1, practice: FREE_PRACTICE, startMeasure: 3, endMeasure: 3,
    }))
  })

  afterEach(function() {
    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previous)
    store.close()
    for (let [key, value] of saved) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let mount = (path="/stats/for-my-lesson", width=1100) => {
    container = document.createElement("div")
    container.style.width = `${width}px`
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
      React.createElement(Probe),
      React.createElement(Routes, {},
        React.createElement(Route, {path: "/stats/*", element: statsPageFor(null)}),
        React.createElement(Route, {path: "/sheet-music", element: React.createElement("div", {id: "score"}, "score")})))))
  }

  let remount = (path) => {
    flushSync(() => root.unmount())
    root = null
    container.remove()
    mount(path)
  }

  let click = el => flushSync(() => el.click())
  let button = text => [...container.querySelectorAll("button")].find(b => b.textContent.trim() == text)
  let buttons = text => [...container.querySelectorAll("button")].filter(b => b.textContent.trim() == text)
  let ready = test => waitFor(test, {message: "the tab"})
  let tabs = () => [...container.querySelectorAll('nav[aria-label="Practice record"] a')].map(a => a.textContent)
  let article = id => container.querySelector(`[data-note="${id}"]`)
  let sheets = () => container.querySelectorAll("[data-score-overview] svg")

  let words = "Why do I keep hitting D# here?"
  let evidence = {at: Date.now(), accuracy: 75, line: "Beat 2 went wrong in all 3 of your last passes"}
  // a note on bar 3, the fields of extra given to newLessonNote and then laid
  // over the record (a status, an answer)
  let put = (extra={}) => {
    let fields = {
      source: "bar", pieceId: piece.id, pieceTitle: piece.title, start: 3, end: 3, text: words, topic: "fingering",
      evidence, now: Date.now() - DAY, ...extra,
    }
    return store.putLessonNote({...newLessonNote(fields), ...extra})
  }
  let putWhole = (extra={}) => store.putLessonNote({...newLessonNote({
    source: "general", pieceId: piece.id, pieceTitle: piece.title, text: "How many times a day should I play the hard bars?",
    topic: "practice", now: Date.now() - 2 * DAY, ...extra,
  }), ...extra})

  describe("the tabs and the empty state", function() {
    it("counts the open notes on its tab, and none when there are none", async function() {
      mount("/stats")
      expect(tabs()).toEqual(["Today", "For my lesson", "Last 14 days"])

      await put()
      await putWhole()
      await put({status: "discussed", discussedAt: Date.now(), answer: ""})
      await put({status: "dropped"})
      remount("/stats")
      expect(tabs()).toEqual(["Today", "For my lesson2", "Last 14 days"])

      // the tab of the page we are on is the active one
      remount("/stats/for-my-lesson")
      let active = container.querySelector('nav[aria-label="Practice record"] a[aria-current="page"]')
      expect(active.textContent).toEqual("For my lesson2")
      expect(container.querySelector("h1").textContent).toContain("For my lesson")
    })

    it("says there is nothing to ask yet, and offers to add a note", async function() {
      mount()
      expect(container.textContent).toContain("Nothing to ask yet")
      expect(container.textContent).toContain('Click a bar on the score and choose "Note for lesson", or flag bars during a session.')
      expect(button("Add a note")).toBeTruthy()

      click(button("Add a note"))
      expect(container.querySelector("textarea")).toBeTruthy()
    })
  })

  describe("the open notes", function() {
    it("groups them by piece, with the bar engraved, the words, what happened and what is now", async function() {
      let bar3 = await put()
      let whole = await putWhole()
      other = (await importMusicXMLPiece("pickup.musicxml", pickupScore({title: "Pickup Minuet"}), store)).piece
      await store.putPiece(store.piece(other.id), {source: null})
      let noSource = await store.putLessonNote(newLessonNote({
        source: "bar", pieceId: other.id, pieceTitle: other.title, start: 1, end: 1, text: "A question on the pickup piece",
        now: Date.now() - 3 * DAY,
      }))

      mount()
      await ready(() => sheets().length == 1)

      let headers = [...container.querySelectorAll("section[aria-label]")].map(s => s.getAttribute("aria-label"))
      expect(headers).toEqual([`${piece.title} · 2 open notes`, `${other.title} · 1 open note`])

      // the engraved bar, drawn by the engine in place of its picture
      expect(article(bar3.id).querySelector("[data-score-overview] svg")).toBeTruthy()
      expect(article(bar3.id).textContent).toContain("Bar 3")
      expect(article(bar3.id).textContent).toContain(`Fingering · both hands · ${noteDate(bar3.createdAt)}`)
      expect(article(bar3.id).textContent).toContain(`“${words}”`)
      expect(article(bar3.id).textContent).toContain("Then: 75%, beat 2 went wrong in all 3 of your last passes.")
      expect(article(bar3.id).textContent).toContain("Now: not played yet.")

      // a whole piece has no bar to draw, a piece with no score the bar's number
      expect(article(whole.id).querySelector("svg")).toBe(null)
      expect(article(whole.id).textContent).toContain("Whole piece")
      expect(article(whole.id).textContent).toContain("Not practised yet.")
      expect(article(noSource.id).querySelector("svg")).toBe(null)
      expect(article(noSource.id).textContent).toContain("Bar 1")
    })

    it("tells a bar played since, and the passes over time", async function() {
      await put()
      let id = `${piece.id}:both:3-3`
      let item = {
        id, pieceId: piece.id, hand: "both", startMeasure: 3, endMeasure: 3, level: "bar", state: "learning",
        step: 1, reps: 1, lapses: 0, streak: 0, hits: 4, misses: 0, attempts: 3, lastPracticed: Date.now(), recent: [],
        passes: [[Date.now() - 3000, 4, 2, 2], [Date.now() - 2000, 4, 3, 2], [Date.now() - 1000, 4, 3, 2]], algo: 1,
        createdAt: 1,
      }
      await store.recordAttempt({
        item, review: {itemId: id, at: Date.now(), pieceId: piece.id, kind: "legacy", hits: 1, misses: 0, attempts: 1},
      })

      mount()
      await ready(() => container.textContent.includes("Now: 75% latest, 0 of 3 towards learned."))
      expect(container.textContent).toContain("Over time: 50 → 75 → 75.")
    })

    it("marks a note discussed with the teacher's answer, and the count falls", async function() {
      let first = await put()
      let second = await put({text: "A second question", start: 5, end: 5})
      mount()
      await ready(() => article(first.id))
      expect(tabs()[1]).toEqual("For my lesson2")

      click(buttons("Discussed…")[0])
      expect(container.textContent).toContain("The teacher's answer (optional)")
      type(container.querySelector("textarea"), "Fingers 1-2-3-4; slow, eyes on the page.")
      click(button("Save"))

      await ready(() => store.lessonNotes().find(n => n.id == first.id).status == "discussed")
      let stored = store.lessonNotes().find(n => n.id == first.id)
      expect(stored).toEqual(jasmine.objectContaining({
        status: "discussed", answer: "Fingers 1-2-3-4; slow, eyes on the page.", discussedAt: jasmine.any(Number),
      }))
      expect(stored.updatedAt).toBeGreaterThan(first.updatedAt)

      await ready(() => tabs()[1] == "For my lesson1")
      expect(container.textContent).toContain(`Discussed · ${noteLongDate(Date.now())}`)
      let done = article(first.id)
      expect(done.textContent).toContain("Teacher")
      expect(done.textContent).toContain("Fingers 1-2-3-4; slow, eyes on the page.")
      expect(done.textContent).toContain(`discussed ${today()}`)
      // no actions on a discussed note, and the other note is still open
      expect(done.querySelector("button")).toBe(null)
      expect(button("Discussed…")).toBeTruthy()
      expect(container.querySelector('section[aria-label$="1 open note"]')).toBeTruthy()
      expect(second.status).toEqual("open")
    })

    it("lets the answer be left empty, and Escape in the answer closes only the answer", async function() {
      let note = await put()
      mount()
      await ready(() => article(note.id))

      click(button("Discussed…"))
      flushSync(() => container.querySelector("textarea").dispatchEvent(
        new KeyboardEvent("keydown", {key: "Escape", bubbles: true})))
      expect(container.textContent).not.toContain("The teacher's answer (optional)")
      expect(store.lessonNotes()[0].status).toEqual("open")

      click(button("Discussed…"))
      click(button("Save"))
      await ready(() => store.lessonNotes()[0].status == "discussed")
      await ready(() => container.textContent.includes("Discussed · "))
      expect(store.lessonNotes()[0].answer).toEqual("")
      expect(article(note.id).textContent).not.toContain("Teacher")
    })

    it("keeps a note for next time: still open, and says so", async function() {
      let note = await put()
      mount()
      await ready(() => article(note.id))
      expect(article(note.id).textContent).not.toContain("kept for next time")

      click(button("Keep for next time"))
      await ready(() => store.lessonNotes()[0].keptAt)
      await ready(() => article(note.id).textContent.includes("kept for next time"))
      let stored = store.lessonNotes()[0]
      expect(stored.status).toEqual("open")
      expect(stored.keptAt).toBeGreaterThan(Date.now() - 5000)
      expect(article(note.id).textContent).toContain(`Fingering · both hands · ${noteDate(note.createdAt)} · kept for next time`)
      expect(tabs()[1]).toEqual("For my lesson1")
    })

    it("drops a note, with an Undo for the visit; a reload with no Undo keeps it gone", async function() {
      let note = await put()
      let keep = await put({text: "Another question", start: 6, end: 6})
      mount()
      await ready(() => article(note.id))

      click(buttons("Drop")[0])
      await ready(() => store.lessonNotes().find(n => n.id == note.id).status == "dropped")
      await ready(() => article(note.id) == null)
      expect(container.querySelector('[role="status"]').textContent).toEqual("Dropped. Undo")
      expect(tabs()[1]).toEqual("For my lesson1")

      // Undo gives it back
      click(button("Undo"))
      await ready(() => store.lessonNotes().find(n => n.id == note.id).status == "open")
      await ready(() => article(note.id))
      await ready(() => !container.querySelector('[role="status"]'))
      expect(container.querySelector('[role="status"]')).toBe(null)

      // dropped again, and the page left: it never comes back
      click(buttons("Drop")[0])
      await ready(() => store.lessonNotes().find(n => n.id == note.id).status == "dropped")
      remount()
      await ready(() => article(keep.id))
      expect(article(note.id)).toBe(null)
      expect(container.textContent).not.toContain("Undo")
      // still stored, so a library merge can't bring it back
      expect(store.lessonNotes().length).toEqual(2)
    })

    it("gives a wordless flag its words, and edits the words of another", async function() {
      let flag = await store.putLessonNote(newLessonNote({
        source: "session", pieceId: piece.id, pieceTitle: piece.title, start: 3, end: 4, evidence, now: Date.now() - DAY,
      }))
      let wordy = await put({start: 7, end: 7, text: "A tyop in my note"})
      mount()
      await ready(() => article(flag.id))

      expect(article(flag.id).textContent).toContain("No words yet.")
      expect(article(flag.id).textContent).toContain(`Flagged in a session · ${noteDate(flag.createdAt)}`)
      expect(article(flag.id).textContent).toContain("Bars 3–4")

      click(button("Add words"))
      expect(button("Save note").disabled).toBe(true)
      type(container.querySelector("textarea"), "Where do I breathe here?")
      click(button("Save note"))
      await ready(() => store.lessonNotes().find(n => n.id == flag.id).text == "Where do I breathe here?")
      await ready(() => !article(flag.id).textContent.includes("No words yet"))
      expect(article(flag.id).textContent).toContain("“Where do I breathe here?”")
      expect(store.lessonNotes().find(n => n.id == flag.id).evidence).toEqual(evidence)

      // an open note with words has its own Edit
      expect(article(flag.id).querySelector("textarea")).toBe(null)
      click([...article(wordy.id).querySelectorAll("button")].find(b => b.textContent == "Edit"))
      expect(article(wordy.id).querySelector("textarea").value).toEqual("A tyop in my note")
      type(article(wordy.id).querySelector("textarea"), "A typo in my note")
      click([...article(wordy.id).querySelectorAll("button")].find(b => b.textContent == "Save note"))
      await ready(() => store.lessonNotes().find(n => n.id == wordy.id).text == "A typo in my note")
      await ready(() => article(wordy.id).textContent.includes("“A typo in my note”"))
      expect(store.lessonNotes().find(n => n.id == wordy.id).topic).toEqual("fingering")
    })

    it("adds a note on the whole piece or on any piece", async function() {
      await put()
      mount()
      await ready(() => sheets().length == 1)

      click(button("Add a note"))
      let chips = [...container.querySelectorAll('[aria-label="What the note is about"] button')]
      expect(chips.map(c => c.textContent)).toEqual([`Whole piece: ${piece.title}`, "Any piece"])
      expect(chips.map(c => c.getAttribute("aria-pressed"))).toEqual(["true", "false"])

      type(container.querySelector("textarea"), "How many times a day should I play the hard bars?")
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 2)
      expect(store.lessonNotes()[1]).toEqual(jasmine.objectContaining({
        source: "general", pieceId: piece.id, pieceTitle: piece.title, start: null, end: null, evidence: null,
      }))
      await ready(() => container.textContent.includes(`${piece.title} · 2 open notes`))
      expect(container.querySelector("textarea")).toBe(null)

      click(button("Add a note"))
      click(button("Any piece"))
      type(container.querySelector("textarea"), "Should I buy a metronome?")
      click(button("Save note"))
      await ready(() => store.lessonNotes().length == 3)
      expect(store.lessonNotes()[2]).toEqual(jasmine.objectContaining({source: "general", pieceId: null, pieceTitle: null}))
      await ready(() => container.textContent.includes("Any piece · 1 open note"))
      let groups = [...container.querySelectorAll("section[aria-label]")].map(s => s.getAttribute("aria-label"))
      expect(groups[groups.length - 1]).toEqual("Any piece · 1 open note")
    })

    it("opens a note's bar on the score", async function() {
      let note = await put()
      let toPiece = (await importMusicXMLPiece("pickup.musicxml", pickupScore({title: "Pickup Minuet"}), store)).piece
      window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({piece: toPiece.id}))
      mount()
      await ready(() => article(note.id))

      click([...article(note.id).querySelectorAll("button")].find(b => b.textContent == "Open on the score"))
      expect(location.pathname).toEqual("/sheet-music")
      expect(location.search).toEqual("?bar=3")
      expect(JSON.parse(window.localStorage.getItem(SHEET_MUSIC_STORAGE_KEY)).piece).toEqual(piece.id)
    })

    it("has no way into the score for the note of a piece that was removed", async function() {
      let note = await put()
      await store.deletePiece(piece.id)
      mount()
      await ready(() => article(note.id))

      expect(container.querySelector("section[aria-label]").getAttribute("aria-label")).toEqual(`${piece.title} (removed) · 1 open note`)
      expect(article(note.id).textContent).not.toContain("Open on the score")
      expect(article(note.id).querySelector("svg")).toBe(null)
      expect(article(note.id).textContent).toContain("Bar 3")
      // it can still be discussed
      expect(button("Discussed…")).toBeTruthy()
    })
  })

  describe("the right column and the printed sheet", function() {
    it("counts the days, minutes, bars learned and notes since the last lesson", async function() {
      await put()
      await put({text: "Thumb or third?", start: 4, end: 4, status: "discussed", discussedAt: Date.now() - 7 * DAY, answer: "Thumb."})
      let session = (days, seconds) => ({
        id: `s${days}`, startedAt: Date.now() - days * DAY, endedAt: Date.now() - days * DAY + 1, activeSeconds: seconds,
        elapsedSeconds: seconds, staff: "grand", generator: "sheet music", notesRead: 3, misses: 0, bestStreak: 3, notes: {},
        settings: {piece: piece.id},
      })
      await store.putSession(session(8, 3000))
      await store.putSession(session(5, 1800))
      await store.putSession(session(2, 1320))

      mount()
      await ready(() => container.textContent.includes("52 minutes"))
      let card = container.querySelector("aside")
      expect(card.textContent).toContain("Since your last lesson")
      expect(card.textContent).toContain("7 days")
      expect(card.textContent).toContain("52 minutes · 0 bars learned · 1 note")
    })

    it("prints once every bar is drawn, with a blank answer under each open note and nothing else", async function() {
      let note = await put()
      let whole = await putWhole()
      await put({text: "Discussed one", start: 6, end: 6, status: "discussed", discussedAt: Date.now() - DAY, answer: "Yes."})
      spyOn(window, "print")

      mount()
      let print = () => button("Print for the lesson") || button("Engraving the bars…")
      expect(button("Engraving the bars…")).toBeTruthy()
      expect(button("Engraving the bars…").disabled).toBe(true)
      click(button("Engraving the bars…"))
      expect(window.print).not.toHaveBeenCalled()

      await ready(() => button("Print for the lesson"))
      expect(print().disabled).toBe(false)
      expect(sheets().length).toEqual(1)
      click(print())
      expect(window.print).toHaveBeenCalledTimes(1)

      // an answer block for each open note, the discussed ones and the actions marked to hide
      let answers = [...container.querySelectorAll('[data-print="only"]')].filter(el => el.textContent.includes("The teacher's answer"))
      expect(answers.length).toEqual(2)
      expect(article(note.id).contains(answers[0]) || article(note.id).contains(answers[1])).toBe(true)
      expect(article(whole.id).querySelector('[data-print="only"]')).toBeTruthy()
      expect(container.querySelector('[data-print="only"]').textContent).toContain("For my lesson · ")
      let hidden = [...container.querySelectorAll('[data-print="hide"]')]
      expect(hidden.some(el => el.textContent.includes("Discussed one"))).toBe(true)
      expect(hidden.some(el => el.textContent.includes("Discussed…"))).toBe(true)
      expect(hidden.some(el => el.querySelector('nav[aria-label="Practice record"]'))).toBe(true)
      for (let el of container.querySelectorAll('[data-print="only"]')) {
        expect(getComputedStyle(el).display).toEqual("none")
      }
    })

    it("prints once the engraving fails too, and not with nothing to print", async function() {
      await put()
      await store.putPiece(store.piece(piece.id), {source: null})
      spyOn(window, "print")
      mount()
      await ready(() => button("Print for the lesson"))
      expect(button("Print for the lesson").disabled).toBe(false)

      // nothing open: nothing to print
      let flagged = store.lessonNotes()[0]
      await store.updateLessonNote(flagged.id, n => ({...n, status: "discussed", discussedAt: Date.now(), answer: ""}))
      remount()
      await ready(() => button("Print for the lesson"))
      expect(button("Print for the lesson").disabled).toBe(true)
    })

    it("stacks the note under its bar on a phone, within the width", async function() {
      let note = await put()
      mount("/stats/for-my-lesson", 390)
      await ready(() => sheets().length == 1)

      let box = container.getBoundingClientRect()
      for (let el of article(note.id).querySelectorAll("button, [data-quote]")) {
        let rect = el.getBoundingClientRect()
        expect(rect.right).toBeLessThanOrEqual(box.right + 1)
      }

      let picture = article(note.id).querySelector("[data-score-overview]").getBoundingClientRect()
      let quote = article(note.id).querySelector("[data-quote]").getBoundingClientRect()
      expect(quote.top).toBeGreaterThanOrEqual(picture.bottom - 1)
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth + 1)
    })
  })
})
