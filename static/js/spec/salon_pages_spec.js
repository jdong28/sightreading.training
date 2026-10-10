// The ear training, flash cards, play along and guide pages wear the Salon de
// Chopin primitives (docs/design/salon-de-chopin.md): these walk each page as
// a user would and check what is drawn, and where, against what it covers

import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes} from "react-router-dom"

import EarTrainingPage from "st/components/pages/ear_training_page"
import FlashCardPage from "st/components/pages/flash_card_page"
import SongsPage from "st/components/pages/songs"
import {PlayAlongPage} from "st/components/pages/play_along_page"
import {GuideContents, guideRoutes} from "st/components/pages/guide_pages"

import salonStyles from "st/components/salon.module.css"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"
import flashStyles from "st/components/flash_cards/flash_cards.module.css"
import settingsPanelStyles from "st/components/settings_panel.module.css"
import earStyles from "st/components/pages/ear_training_page.module.css"
import guideStyles from "st/components/pages/guide_pages.module.css"
import staffStyles from "st/components/staff.module.css"

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(check, what, timeout=5000) {
  let start = Date.now()
  while (Date.now() - start < timeout) {
    if (check()) {
      return
    }
    await sleep(20)
  }
  throw new Error(`timed out waiting for ${what}`)
}

// a MIDI output that plays nothing, finishing at once
const silentOutput = () => ({
  noteOn() {},
  noteOff() {},
  playNoteList: () => Promise.resolve(),
  getMetronome: () => null,
})

describe("pages in the salon style", function() {
  let container, root

  let mount = (element, path="/") => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {initialEntries: [path]}, element))
    })
    return container
  }

  afterEach(function() {
    flushSync(() => root.unmount())
    container.remove()
  })

  let buttonsByText = (el, text) =>
    [...el.querySelectorAll("button, a")].filter(b => b.textContent.trim() == text)

  let click = (el, text) => {
    let [button] = buttonsByText(el, text)
    if (!button) {
      throw new Error(`no button "${text}"`)
    }
    flushSync(() => button.click())
  }

  let isPrimary = el => el.classList.contains(salonStyles.primary)

  // a plate's four lozenges sit inside the plate's own box
  let expectPlate = plate => {
    expect(plate).not.toBe(null)
    let lozenges = plate.querySelectorAll(`.${salonStyles.lozenge}`)
    expect(lozenges.length).toEqual(4)
    let box = plate.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)
    for (let lozenge of lozenges) {
      let inner = lozenge.getBoundingClientRect()
      expect(inner.left).toBeGreaterThanOrEqual(box.left)
      expect(inner.right).toBeLessThanOrEqual(box.right)
      expect(inner.top).toBeGreaterThanOrEqual(box.top)
      expect(inner.bottom).toBeLessThanOrEqual(box.bottom)
    }
  }

  let within = (inner, outer) => {
    let a = inner.getBoundingClientRect()
    let b = outer.getBoundingClientRect()
    expect(a.left).toBeGreaterThanOrEqual(b.left - 1)
    expect(a.right).toBeLessThanOrEqual(b.right + 1)
    expect(a.top).toBeGreaterThanOrEqual(b.top - 1)
    expect(a.bottom).toBeLessThanOrEqual(b.bottom + 1)
  }

  describe("ear training", function() {
    it("asks for an output device on a plate until one is chosen", function() {
      let el = mount(React.createElement(EarTrainingPage, {exercise: "melody_playback"}))

      let plate = el.querySelector(`.${earStyles.exercise_plate}`)
      expectPlate(plate)
      expect(plate.textContent).toContain("Choose a MIDI output device for ear training")
      expect(el.querySelector("nav").textContent).toContain("Learn Intervals")
      expect(el.querySelector("nav").textContent).toContain("Play Back Melodies")

      // picking the device is still the plate's one button
      expect([...plate.querySelectorAll("button")].map(b => b.textContent.trim())).toEqual(["Select device"])
    })

    describe("interval recognition", function() {
      let page = async () => {
        let el = mount(React.createElement(EarTrainingPage, {
          exercise: "melody_recognition",
          midiOutput: silentOutput(),
        }))
        await until(() => buttonsByText(el, "Next melody").length > 0, "the melodies to load")
        return el
      }

      it("loads onto a plate, then plays a melody picked from the primary pill", async function() {
        let el = mount(React.createElement(EarTrainingPage, {
          exercise: "melody_recognition",
          midiOutput: silentOutput(),
        }))

        // the load shows on the plate too
        if (buttonsByText(el, "Next melody").length == 0) {
          expectPlate(el.querySelector(`.${earStyles.exercise_plate}`))
        }

        await until(() => buttonsByText(el, "Next melody").length > 0, "the melodies to load")
        let plate = el.querySelector(`.${earStyles.exercise_plate}`)
        expectPlate(plate)
        expect(el.querySelector("h1").textContent).toEqual("Interval Recognition")
        expect(el.querySelector("h1").classList.contains(earStyles.exercise_label)).toBe(true)

        let [next] = buttonsByText(el, "Next melody")
        expect(isPrimary(next)).toBe(true)
        expect(plate.contains(next)).toBe(true)
        within(next, plate)

        expect(plate.textContent).toContain("Press Next melody to randomly pick a interval to practice")
        expect(buttonsByText(el, "Play root").length).toEqual(0)

        click(el, "Next melody")
        expect(plate.textContent).not.toContain("Press Next melody to randomly")
        for (let label of ["Play root", "Play interval", "Play melody"]) {
          expect(buttonsByText(el, label).length).toEqual(1)
        }

        // a second melody in the same visit keeps the tools
        click(el, "Next melody")
        expect(buttonsByText(el, "Play root").length).toEqual(1)
      })

      it("draws the tempo and transpose sliders gilt, inside the plate", async function() {
        let el = await page()
        let plate = el.querySelector(`.${earStyles.exercise_plate}`)
        let sliders = [...el.querySelectorAll(".slider_component")]
        expect(sliders.length).toEqual(2)
        for (let slider of sliders) {
          expect(slider.classList.contains(drawerStyles.gilt_slider)).toBe(true)
          // the fill is shown only by the gilt rules
          expect(getComputedStyle(slider.querySelector(".slider_fill")).display).toEqual("block")
          within(slider, plate)
        }
      })

      it("walks the interval toggles through off, on and a direction", async function() {
        let el = await page()
        let intervals = [...el.querySelectorAll("fieldset")]
          .find(f => f.querySelector("legend").textContent == "Intervals")
        let checked = () => intervals.querySelectorAll("input[type=checkbox]:checked").length
        let total = intervals.querySelectorAll("input[type=checkbox]").length
        expect(total).toEqual(19)
        expect(checked()).toEqual(total)

        click(el, "All off")
        expect(checked()).toEqual(0)
        expect(buttonsByText(el, "All on").length).toEqual(1)

        click(el, "All on")
        expect(checked()).toEqual(total)

        click(el, "All Ascending")
        let asc = [...intervals.querySelectorAll("li")].filter(li => li.textContent.includes("(asc)")).length
        expect(asc).toBeGreaterThan(0)
        expect(asc).toBeLessThan(total)
        expect(checked()).toEqual(asc)

        click(el, "All Descending")
        expect(checked()).toEqual(total - asc)
      })

      it("starts and stops the autoplay from its primary pill", async function() {
        let el = await page()
        let [start] = buttonsByText(el, "Start autoplay")
        expect(isPrimary(start)).toBe(true)

        click(el, "Start autoplay")
        expect(buttonsByText(el, "Start autoplay").length).toEqual(0)
        let [stop] = buttonsByText(el, "Stop")
        expect(isPrimary(stop)).toBe(true)

        click(el, "Stop")
        expect(buttonsByText(el, "Start autoplay").length).toEqual(1)
        // the interval it was playing stops with it, taking its own Stop away
        await until(() => buttonsByText(el, "Stop").length == 0, "the playing interval to stop")

        // a second run in the same visit
        click(el, "Start autoplay")
        expect(buttonsByText(el, "Stop").length).toBeGreaterThan(0)
        click(el, "Stop")
        await until(() => buttonsByText(el, "Stop").length == 0, "the second run to stop")
      })
    })

    describe("melody playback", function() {
      let page = () => mount(React.createElement(EarTrainingPage, {
        exercise: "melody_playback",
        midiOutput: silentOutput(),
      }))

      let ranges = el => [...el.querySelectorAll("fieldset")]
        .find(f => f.querySelector("legend").textContent == "Range")

      it("picks a range from choice pills and shows it", function() {
        let el = page()
        let range = ranges(el)
        let pills = [...range.querySelectorAll("button")]
        expect(pills.map(p => p.textContent)).toEqual(["singing", "treble", "bass", "grand"])
        expect(pills.every(p => p.classList.contains(salonStyles.choice))).toBe(true)

        let pressed = () => [...range.querySelectorAll("button[aria-pressed=true]")].map(p => p.textContent)
        expect(pressed()).toEqual(["singing"])
        expect(range.textContent).toContain("C3 - C5")

        click(range, "bass")
        expect(pressed()).toEqual(["bass"])
        expect(range.textContent).not.toContain("C3 - C5")
        let bassRange = range.textContent
        expect(bassRange).toMatch(/[A-G]#?\d - [A-G]#?\d/)

        click(range, "treble")
        expect(pressed()).toEqual(["treble"])
        expect(range.textContent).not.toEqual(bassRange)

        click(range, "singing")
        expect(pressed()).toEqual(["singing"])
        expect(range.textContent).toContain("C3 - C5")
      })

      it("starts a melody from the primary pill and repeats it", function() {
        let el = page()
        let plate = el.querySelector(`.${earStyles.exercise_plate}`)
        expectPlate(plate)

        let [newMelody] = buttonsByText(el, "New melody")
        expect(isPrimary(newMelody)).toBe(true)
        expect(buttonsByText(el, "Repeat melody").length).toEqual(0)

        click(el, "New melody")
        expect(buttonsByText(el, "Repeat melody").length).toEqual(1)

        click(el, "New melody")
        expect(buttonsByText(el, "Repeat melody").length).toEqual(1)
      })

      it("keeps the plate clear of the keyboard under it, which wears the piano lid", function() {
        let el = page()
        let plate = el.querySelector(`.${earStyles.exercise_plate}`)
        // the keyboard component's own root
        let root = [...el.querySelectorAll("div")].find(d =>
          d.querySelector("[data-note]") && getComputedStyle(d).overflow == "auto")
        expect(root).toBeTruthy()

        expect(plate.getBoundingClientRect().bottom).toBeLessThanOrEqual(root.getBoundingClientRect().top + 1)
        expect(getComputedStyle(root).backgroundImage).toContain("linear-gradient")
      })
    })
  })

  describe("flash cards", function() {
    let page = exercise => mount(
      React.createElement(FlashCardPage, {key: exercise, exercise}))

    let cardPlate = el => el.querySelector(`.${flashStyles.flash_card}`)

    describe("note math", function() {
      let card = el => cardPlate(el).textContent
      let options = el => [...el.querySelectorAll(`.${flashStyles.card_options} button`)]

      it("shows the question on an engraved plate over its seven answers", function() {
        let el = page("note_math")
        expect(el.querySelector(`.${flashStyles.exercise_label}`).textContent).toEqual("Note Math")

        expectPlate(cardPlate(el))
        expect(cardPlate(el).classList.contains(salonStyles.plate)).toBe(true)
        expect(card(el)).toMatch(/^[2-7] of D is$/)
        expect(options(el).map(b => b.textContent)).toEqual(["C", "D", "E", "F", "G", "A", "B"])

        // the question is set inside its plate, not spilling over the edge
        let text = document.createRange()
        text.selectNodeContents(cardPlate(el))
        within(text, cardPlate(el))
      })

      it("disables a wrong answer, then moves on after the right one", async function() {
        let el = page("note_math")
        let notes = ["C", "D", "E", "F", "G", "A", "B"]
        let offset = +card(el)[0] - 1
        let answer = notes[(1 + offset) % 7]
        let wrong = notes.find(n => n != answer)

        click(el, wrong)
        expect(options(el).find(b => b.textContent == wrong).disabled).toBe(true)
        expect(options(el).filter(b => b.disabled).length).toEqual(1)
        expect(cardPlate(el).classList.contains(staffStyles.errorshake)).toBe(true)

        // the shake ends by itself
        await until(() => !cardPlate(el).classList.contains(staffStyles.errorshake), "the shake to end")

        click(el, answer)
        // the next card starts with every answer open again
        expect(options(el).filter(b => b.disabled).length).toEqual(0)
        expect(card(el)).toMatch(/^[2-7] of D is$/)
      })

      it("walks the root notes from none to some again, and closes the settings", async function() {
        let el = page("note_math")
        expect(el.querySelector(`.${settingsPanelStyles.settings_panel}`)).toBe(null)

        click(el, "Settings")
        let panel = el.querySelector(`.${settingsPanelStyles.settings_panel}`)
        expect(panel).not.toBe(null)
        // it slides in from the left, so measure once it has arrived
        await sleep(350)
        expect(getComputedStyle(panel).position).toEqual("fixed")
        // the panel is the drawer's paper, not the old grey
        expect(getComputedStyle(panel).backgroundColor).toEqual("rgb(253, 250, 244)")
        let box = panel.getBoundingClientRect()
        expect(box.left).toEqual(0)
        expect(box.width).toEqual(270)

        let rootNote = note => [...panel.querySelectorAll(`.${flashStyles.test_group}`)]
          .find(l => l.textContent.trim() == note)
        let selected = () => [...panel.querySelectorAll(`.${flashStyles.test_group}.${flashStyles.selected}`)]
          .map(l => l.textContent.trim())
        expect(selected()).toEqual(["D"])

        // an empty run: nothing enabled, no card and no plate
        flushSync(() => rootNote("D").querySelector("input").click())
        expect(selected()).toEqual([])
        await until(() => cardPlate(el) == null, "the card to go")
        expect(el.textContent).toContain("Please enable some cards from settings")
        expect(options(el).length).toEqual(0)

        flushSync(() => rootNote("G").querySelector("input").click())
        expect(selected()).toEqual(["G"])
        await until(() => cardPlate(el) != null, "a card for G")
        expect(card(el)).toMatch(/^[2-7] of G is$/)
        expect(options(el).length).toEqual(7)

        click(el, "Close")
        await until(() => el.querySelector(`.${settingsPanelStyles.settings_panel}`) == null, "the panel to leave")
      })
    })

    describe("chord identification", function() {
      let options = el => [...el.querySelectorAll(`.${flashStyles.card_options} button`)].map(b => b.textContent.trim())

      it("draws the chord on a plate and steps through its answer", async function() {
        let el = page("chord_identification")
        await until(() => cardPlate(el) != null, "the first chord")

        expect(el.querySelector(`.${flashStyles.exercise_label}`).textContent).toEqual("Chord Identification")
        expectPlate(cardPlate(el))
        expect(cardPlate(el).querySelector(`.${staffStyles.staff}`)).not.toBe(null)

        // the chord is drawn inside the plate, not spilling beyond it
        let box = cardPlate(el).getBoundingClientRect()
        let drawn = [...cardPlate(el).querySelectorAll(`.${staffStyles.staff} *`)]
          .filter(e => e.getBoundingClientRect().width > 0)
        expect(drawn.length).toBeGreaterThan(0)
        for (let e of drawn) {
          let r = e.getBoundingClientRect()
          expect(r.left).toBeGreaterThanOrEqual(box.left)
          expect(r.right).toBeLessThanOrEqual(box.right + 1)
        }

        expect(options(el)).toEqual(["C", "D", "E", "F", "G", "A", "B"])

        click(el, "C")
        expect(options(el)).toEqual(["M", "m", "dim", "♭", "♯", "◀ Back"])

        click(el, "◀ Back")
        expect(options(el)).toEqual(["C", "D", "E", "F", "G", "A", "B"])

        // a wrong chord shakes the plate, leaving the answer closed
        click(el, "C")
        click(el, "dim")
        let wrongRoot = ["C", "D", "E", "F", "G", "A", "B"]
        // C dim is never drawn from the major key list, so it is wrong
        expect(cardPlate(el).classList.contains(staffStyles.errorshake)).toBe(true)
        expect(options(el)).toEqual(wrongRoot)
        await until(() => !cardPlate(el).classList.contains(staffStyles.errorshake), "the shake to end")
      })

      it("opens the settings over the page with the key list as pills of the same panel", function() {
        let el = page("chord_identification")
        click(el, "Settings")
        let panel = el.querySelector(`.${settingsPanelStyles.settings_panel}`)
        expect(panel.textContent).toContain("Key signature")
        expect(panel.textContent).toContain("Inversions")
        expect(panel.querySelectorAll("input[type=checkbox]:checked").length).toEqual(1)
      })
    })
  })

  describe("play along", function() {
    it("offers a new song from the primary pill", function() {
      let el = mount(React.createElement(SongsPage), "/play-along")
      let link = el.querySelector("a")
      expect(link.getAttribute("href")).toEqual("/new-song")
      expect(isPrimary(link)).toBe(true)
      expect(el.querySelector("h2").textContent).toEqual("Play along")
    })

    describe("the player", function() {
      let page = () => mount(React.createElement(PlayAlongPage, {
        editorOpen: true,
        midiOutput: silentOutput(),
      }))

      let type = (el, code) => {
        let textarea = el.querySelector("textarea")
        let setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
        flushSync(() => {
          setter.call(textarea, code)
          textarea.dispatchEvent(new Event("input", {bubbles: true}))
        })
      }

      it("plays and pauses a typed song from the primary pill, twice", async function() {
        let el = page()
        expect(buttonsByText(el, "Play").length).toEqual(0)

        type(el, "c4 d4 e4 f4")
        await until(() => buttonsByText(el, "Play").length == 1, "the song to load")

        let [play] = buttonsByText(el, "Play")
        expect(isPrimary(play)).toBe(true)

        // the rewind button's icon is dark enough to read on its pill
        let rewind = el.querySelector("button[title='Rewind to beginning']")
        expect(getComputedStyle(rewind.querySelector("svg")).fill).not.toEqual("rgb(255, 255, 255)")

        for (let run = 0; run < 2; run++) {
          click(el, "Play")
          expect(buttonsByText(el, "Pause").length).toEqual(1)
          click(el, "Pause")
          expect(buttonsByText(el, "Play").length).toEqual(1)
        }
      })

      it("keeps the staff band between the editor and the transport", async function() {
        let el = page()
        type(el, "c4 d4")
        await until(() => buttonsByText(el, "Play").length == 1, "the song to load")

        let wrapper = el.querySelector(`.${staffStyles.staff_wrapper}`)
        expect(getComputedStyle(wrapper).backgroundColor).toEqual("rgb(253, 250, 244)")
        let transport = [...el.querySelectorAll("button")].find(b => b.textContent == "Editor").parentElement
        within(transport, wrapper)
        expect(wrapper.getBoundingClientRect().bottom)
          .toBeLessThanOrEqual(el.querySelector("textarea").getBoundingClientRect().top + 1)
      })

      it("chooses an autochord pattern from choice pills in the settings", async function() {
        let el = page()
        click(el, "Settings")

        let panel = el.querySelector(`.${settingsPanelStyles.settings_panel}`)
        let pills = [...panel.querySelectorAll(`button.${salonStyles.choice}`)]
        expect(pills.map(p => p.textContent)).toEqual(["Root", "Triad", "Root+5", "Arp", "Bossa Nova"])

        let pressed = () => [...panel.querySelectorAll("button[aria-pressed=true]")].map(p => p.textContent)
        expect(pressed()).toEqual(["Root"])

        click(panel, "Triad")
        expect(pressed()).toEqual(["Triad"])
        click(panel, "Bossa Nova")
        expect(pressed()).toEqual(["Bossa Nova"])
        click(panel, "Root")
        expect(pressed()).toEqual(["Root"])

        // the chord sliders are gilt too
        let sliders = [...panel.querySelectorAll(".slider_component")]
        expect(sliders.length).toEqual(2)
        expect(sliders.every(s => s.classList.contains(drawerStyles.gilt_slider))).toBe(true)

        click(panel, "Close")
        await until(() => el.querySelector(`.${settingsPanelStyles.settings_panel}`) == null, "the panel to leave")
      })

      it("swaps the editor for the keyboard and back", function() {
        let el = page()
        expect(el.querySelector("textarea")).not.toBe(null)

        click(el, "Editor")
        expect(el.querySelector("textarea")).toBe(null)
        expect(el.querySelector("[data-note]")).not.toBe(null)

        click(el, "Editor")
        expect(el.querySelector("textarea")).not.toBe(null)
      })
    })
  })

  describe("guide", function() {
    it("loads a page onto a plate, the edit link inside it", async function() {
      let el = mount(React.createElement(GuideContents, {title: "About", pageSource: "about"}))

      // loading is a plate too
      expectPlate(el.querySelector(`.${guideStyles.page_container}`))
      expect(el.textContent).toContain("Loading...")

      await until(() => el.querySelector(`.${guideStyles.contents}`) != null, "the guide to load")
      let plate = el.querySelector(`.${guideStyles.page_container}`)
      expectPlate(plate)
      expect(plate.querySelectorAll(`.${guideStyles.contents} h1`).length).toBeGreaterThan(0)

      let edit = el.querySelector(`.${guideStyles.edit_link} a`)
      expect(edit.textContent.trim()).toEqual("Edit this page on GitHub")
      expect(edit.getAttribute("href")).toContain("static/guides/about.md")
      within(edit, plate)
      // the link follows the contents, within the one plate
      expect(edit.getBoundingClientRect().top)
        .toBeGreaterThan(el.querySelector(`.${guideStyles.contents}`).getBoundingClientRect().bottom - 1)

      // a second page in the same visit replaces the first
      flushSync(() => root.render(React.createElement(MemoryRouter, {},
        React.createElement(GuideContents, {title: "Chords", pageSource: "chord_generators"}))))
      await until(() => document.title.startsWith("Chords"), "the title to change")
    })

    it("says so on a plate when a guide page isn't found", function() {
      let el = mount(
        React.createElement(Routes, {}, guideRoutes()),
        "/guide/nothing-here")
      expect(el.textContent).toContain("Failed to find documentation page")
      expectPlate(el.querySelector(`.${guideStyles.page_container}`))
      // the navigation beside it still lists the pages
      expect(el.querySelector(`.${guideStyles.page_navigation}`).textContent).toContain("Ear Training")
    })
  })
})
