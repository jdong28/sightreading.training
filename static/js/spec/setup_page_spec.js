import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route} from "react-router-dom"

import SetupPage, {exercisesFor, exerciseTitle, exerciseQualifier} from "st/components/pages/setup_page"
import styles from "st/components/pages/setup_page.module.css"
import inputStyles from "st/components/pages/setup_generator_inputs.module.css"
import {STAVES, GENERATORS, SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {
  DRILL_STORAGE_KEY, currentStaffFor, currentGeneratorFor, currentKeySignature,
  currentDrillMode, currentScrollSpeed, generatorDefaultSettings,
} from "st/generators"
import {setAppStore} from "st/storage"
import {addPiece} from "st/sheet_music_deck"
import {parseSongText} from "st/song_sections"
import {HomeGate} from "st/components/app"
import {ONBOARDED_KEY} from "st/onboarding"

import {openTestStore} from "spec/helpers"

describe("setup page", function() {
  // the keys are shared with the app on this origin, so put back whatever
  // the user was drilling once the specs are done
  const STORAGE_KEYS = [DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY, ONBOARDED_KEY, "defaults:midiIn"]

  let container, root, saved, store, appStore

  beforeEach(async function() {
    saved = STORAGE_KEYS.map(key => window.localStorage.getItem(key))
    STORAGE_KEYS.forEach(key => window.localStorage.removeItem(key))

    // the sheet music inputs read the deck from the app's store
    store = await openTestStore()
    appStore = setAppStore(store)
  })

  afterEach(async function() {
    if (root) {
      flushSync(() => root.unmount())
      container.remove()
      root = null
    }

    STORAGE_KEYS.forEach((key, idx) => {
      if (saved[idx] == null) {
        window.localStorage.removeItem(key)
      } else {
        window.localStorage.setItem(key, saved[idx])
      }
    })

    setAppStore(appStore)
    await store.close()
  })

  let renderSetup = (home=React.createElement("div", {id: "trainer"}, "trainer")) => {
    container = document.createElement("div")
    container.style.cssText = "position: relative; width: 1240px"
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {initialEntries: ["/setup"]},
        React.createElement(Routes, {},
          React.createElement(Route, {path: "/setup", element: React.createElement(SetupPage)}),
          React.createElement(Route, {path: "/", element: home}),
          React.createElement(Route, {path: "/welcome", element: React.createElement("div", {id: "welcome"}, "welcome")}),
        )))
    })
    return container
  }

  let rerender = () => {
    flushSync(() => root.unmount())
    container.remove()
    return renderSetup()
  }

  let click = el => flushSync(() => el.click())

  // an exercise row is named by its title, without the qualifier or mark
  let buttonLabel = b => (b.querySelector(`.${styles.exercise_title}`) || b).textContent

  let findButton = (el, text) => {
    let button = [...el.querySelectorAll("button, a")].find(b => buttonLabel(b) == text)
    if (!button) {
      throw new Error(`no button "${text}"`)
    }
    return button
  }

  let exerciseRows = el => [...el.querySelectorAll(`.${styles.exercise_row}`)].map(row => [
    row.querySelector(`.${styles.exercise_title}`).textContent,
    row.querySelector(`.${styles.exercise_qualifier}`)?.textContent || "❖",
  ])

  let summary = el => ({
    title: el.querySelector(`.${styles.programme_title}`).textContent,
    italic: el.querySelector(`.${styles.programme_title} .${styles.italic}`).textContent,
    subtitle: el.querySelector(`.${styles.programme_subtitle}`).textContent,
    rows: [...el.querySelectorAll(`.${styles.programme_rows} > div`)].map(row =>
      [row.querySelector("dt").textContent, row.querySelector("dd").textContent]),
  })

  // sets a form control's value the way typing does, so React sees the change
  let changeValue = (input, value, eventName) => {
    let proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value)
    flushSync(() => input.dispatchEvent(new Event(eventName, {bubbles: true})))
  }

  let selectedPills = el => [...el.querySelectorAll("button[aria-pressed=true]")].map(buttonLabel)

  it("lists the exercises for the chosen staff from GENERATORS", function() {
    let el = renderSetup()

    let treble = STAVES.find(s => s.name == "treble")
    let notesExercises = GENERATORS.filter(g => g.mode == "notes" && !g.debug)
    expect(exercisesFor(treble)).toEqual(notesExercises)

    expect(exerciseRows(el)).toEqual(notesExercises.map((g, idx) => [
      exerciseTitle(g).filter(part => part).join(" "),
      idx == 0 ? "❖" : exerciseQualifier(g),
    ]))
    expect(exerciseRows(el)[0]).toEqual(["Random notes", "❖"])
    expect(exerciseRows(el).find(([title]) => title == "Sheet music")).toEqual(["Sheet music", "Imported piece"])

    click(findButton(el, "Chord"))
    expect(exerciseRows(el).map(([title]) => title)).toEqual(["Random chords", "Chords in many keys"])
    expect(el.querySelectorAll(`.${styles.exercise_title}`).length).toEqual(
      GENERATORS.filter(g => g.mode == "chords" && !g.debug).length)
  })

  it("offers the trainer's keys with accidental glyphs", function() {
    let el = renderSetup()
    let keys = [...el.querySelectorAll(`.${styles.key_pill}`)].map(b => b.textContent)
    expect(keys).toEqual(["C", "G", "D", "A", "E", "B", "F", "B♭", "E♭", "A♭", "D♭", "G♭", "Chromatic"])
    expect(el.querySelector(`.${styles.key_pill}[aria-pressed=true]`).textContent).toEqual("C")
  })

  it("updates the summary with the selection", function() {
    let el = renderSetup()

    expect(summary(el)).toEqual({
      title: "Random notes",
      italic: "notes",
      subtitle: "Treble staff in C major",
      rows: [["Range", "A4 – C7"], ["Tempo", "Wait · speed 100"], ["Length", "Until you stop"]],
    })

    click(findButton(el, "Grand"))
    click(findButton(el, "B♭"))
    click(findButton(el, "Triad chords"))
    click(findButton(el, "Scroll"))
    changeValue(el.querySelector(`.${styles.range_input}`), "150", "input")

    expect(selectedPills(el)).toEqual(["Grand", "B♭", "Triad chords", "Scroll"])
    expect(summary(el)).toEqual({
      title: "Triad chords",
      italic: "chords",
      subtitle: "Grand staff in B♭ major",
      rows: [["Range", "C3 – C7"], ["Tempo", "Scroll · speed 150"], ["Length", "Until you stop"]],
    })

    click(findButton(el, "Chromatic"))
    expect(summary(el).subtitle).toEqual("Grand staff, chromatic")

    click(findButton(el, "Chord"))
    expect(summary(el).title).toEqual("Random chords")
    expect(summary(el).rows[0]).toEqual(["Range", "3-note chords"])
  })

  it("stores the selection the trainer reads when beginning, and shows it on return", function() {
    let el = renderSetup()

    click(findButton(el, "Grand"))
    click(findButton(el, "E♭"))
    click(findButton(el, "Open sevenths"))
    click(findButton(el, "Scroll"))
    changeValue(el.querySelector(`.${styles.range_input}`), "175", "input")

    click(findButton(el, "Begin reading"))
    expect(el.querySelector("#trainer")).not.toBe(null)

    expect(currentStaffFor(STAVES).name).toEqual("grand")
    expect(currentGeneratorFor(GENERATORS, "notes").name).toEqual("sevens")
    expect(currentKeySignature().name()).toEqual("Eb")
    expect(currentDrillMode()).toEqual("scroll")
    expect(currentScrollSpeed()).toEqual(175)

    el = rerender()
    expect(selectedPills(el)).toEqual(["Grand", "E♭", "Open sevenths", "Scroll"])
    expect(summary(el).rows[1]).toEqual(["Tempo", "Scroll · speed 175"])
  })

  it("counts beginning from setup as onboarded, so a fresh browser lands on the trainer", async function() {
    let el = renderSetup(React.createElement(HomeGate, {}, React.createElement("div", {id: "trainer"}, "trainer")))

    click(findButton(el, "Begin reading"))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(el.querySelector("#trainer")).not.toBe(null)
    expect(el.querySelector("#welcome")).toBe(null)
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeTruthy()
  })

  it("renders the sheet music inputs under the sheet music row in the salon's style", function() {
    let el = renderSetup()
    expect(el.querySelector(`.${styles.exercise_inputs}`)).toBe(null)

    click(findButton(el, "Sheet music"))

    let inputs = el.querySelectorAll(`.${styles.exercise_inputs}`)
    expect(inputs.length).toEqual(1)

    let row = findButton(el, "Sheet music")
    expect(row.getAttribute("aria-pressed")).toEqual("true")
    expect(inputs[0].parentElement).toBe(row.parentElement)
    expect(row.nextElementSibling).toBe(inputs[0])

    let form = inputs[0].querySelector(`.${inputStyles.generator_inputs}`)
    expect(form).not.toBe(null)
    expect(getComputedStyle(form).display).toEqual("flex")

    let labels = [...form.querySelectorAll(`.${inputStyles.input_label}`)]
    expect(labels.length).toBeGreaterThan(0)
    labels.forEach(label => {
      expect(getComputedStyle(label).textTransform).toEqual("uppercase")
    })

    let pieceSelect = form.querySelector(`.${inputStyles.deck_row} > .${inputStyles.select_component}`)
    expect(pieceSelect).not.toBe(null)
    expect(getComputedStyle(pieceSelect).flexBasis).toEqual("180px")

    let fileLabel = form.querySelector(`.${inputStyles.file_input} > span`)
    expect(fileLabel.textContent).toEqual("Import MusicXML")
    expect(getComputedStyle(fileLabel).textTransform).toEqual("uppercase")

    click(findButton(el, "Random notes"))
    expect(el.querySelector(`.${styles.exercise_inputs}`)).toBe(null)
  })

  it("sets up a drill of an imported piece with the sheet music inputs", async function() {
    let {song} = parseSongText("c5 d5 e5 f5 g5 a5 b5 c6")
    let {piece} = await addPiece("Little Study", song)

    let el = renderSetup()
    click(findButton(el, "Sheet music"))

    let inputs = el.querySelector(`.${styles.exercise_inputs}`)
    expect(inputs).not.toBe(null)
    expect(summary(el).rows[0]).toEqual(["Range", "No piece chosen"])

    let pieceSelect = inputs.querySelector("select")
    expect([...pieceSelect.options].map(o => o.textContent)).toEqual(["Pasted song notation", "Little Study"])
    changeValue(pieceSelect, piece.id, "change")

    expect(summary(el)).toEqual({
      title: "Sheet music",
      italic: "music",
      subtitle: "Little Study, treble staff in C major",
      rows: [["Range", "Measures 1–2"], ["Tempo", "Wait · speed 100"], ["Length", "Until you stop"]],
    })

    click(findButton(el, "Begin reading"))

    let sheetMusic = GENERATORS.find(g => g.name == "sheet music")
    expect(currentGeneratorFor(GENERATORS, "notes")).toBe(sheetMusic)
    let settings = generatorDefaultSettings(sheetMusic, currentStaffFor(STAVES))
    expect([settings.piece, settings.startMeasure, settings.endMeasure]).toEqual([piece.id, 1, 2])
  })
})
