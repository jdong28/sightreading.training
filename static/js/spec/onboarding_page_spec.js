import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route} from "react-router-dom"

import OnboardingPage from "st/components/pages/onboarding_page"
import styles from "st/components/pages/onboarding_page.module.css"
import {ONBOARDED_KEY} from "st/onboarding"

class FakeInput extends EventTarget {
  constructor(name) {
    super()
    this.name = name
    this.id = name
  }

  sendNoteOn(pitch=60, velocity=100) {
    let event = new Event("midimessage")
    event.data = [0x90, pitch, velocity]
    this.dispatchEvent(event)
  }
}

class FakeMidiAccess extends EventTarget {
  constructor(inputs=[]) {
    super()
    this.inputs = new Map(inputs.map((input, idx) => [String(idx), input]))
  }

  addInput(input) {
    this.inputs.set(String(this.inputs.size), input)
    this.dispatchEvent(new Event("statechange"))
  }

  removeInput(id) {
    this.inputs.delete(id)
    this.dispatchEvent(new Event("statechange"))
  }
}

describe("onboarding page", function() {
  let container, root

  let renderPage = (props={}) => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {initialEntries: ["/welcome"]},
        React.createElement(Routes, {},
          React.createElement(Route, {path: "/welcome", element: React.createElement(OnboardingPage, props)}),
          React.createElement(Route, {path: "/", element: React.createElement("div", {id: "target-trainer"}, "trainer")}))))
    })
    return container
  }

  let strip = el => el.querySelector(`.${styles.device_strip}`)

  afterEach(function() {
    window.localStorage.removeItem(ONBOARDED_KEY)
    flushSync(() => root.unmount())
    container.remove()
  })

  it("shows the none state without midi access", function() {
    let el = strip(renderPage({}))
    expect(el.classList.contains(styles.none)).toBe(true)
    expect(el.textContent).toContain("No instrument found")
  })

  it("shows the none state when access exists but no inputs are listed", function() {
    let midi = new FakeMidiAccess([])
    let el = strip(renderPage({midi}))
    expect(el.classList.contains(styles.none)).toBe(true)
  })

  it("shows the listening state when inputs exist but nothing has played yet", function() {
    let midi = new FakeMidiAccess([new FakeInput("Roland FP-30")])
    let el = strip(renderPage({midi}))
    expect(el.classList.contains(styles.listening)).toBe(true)
    expect(el.textContent).toContain("Listening for an instrument")
    expect(el.textContent).toContain("press any key")
  })

  it("shows the connected state immediately when an input is already selected", function() {
    let input = new FakeInput("Roland FP-30")
    let midi = new FakeMidiAccess([input])
    let el = strip(renderPage({midi, midiInput: input}))
    expect(el.classList.contains(styles.connected)).toBe(true)
    expect(el.textContent).toContain("Roland FP-30")
    expect(el.textContent).toContain("at the ready")
  })

  it("promotes to connected and selects the input once a key is pressed", function() {
    let input = new FakeInput("Roland FP-30")
    let midi = new FakeMidiAccess([input])
    let onSelectInput = jasmine.createSpy("onSelectInput")
    let el = renderPage({midi, onSelectInput})

    expect(strip(el).classList.contains(styles.listening)).toBe(true)

    flushSync(() => input.sendNoteOn())

    expect(onSelectInput).toHaveBeenCalledWith(0)
  })

  it("ignores note-on messages once an input is already selected", function() {
    let input = new FakeInput("Roland FP-30")
    let other = new FakeInput("Other keyboard")
    let midi = new FakeMidiAccess([input, other])
    let onSelectInput = jasmine.createSpy("onSelectInput")
    renderPage({midi, midiInput: input, onSelectInput})

    flushSync(() => other.sendNoteOn())

    expect(onSelectInput).not.toHaveBeenCalled()
  })

  it("updates live when a device appears", function() {
    let midi = new FakeMidiAccess([])
    let el = renderPage({midi})
    expect(strip(el).classList.contains(styles.none)).toBe(true)

    flushSync(() => midi.addInput(new FakeInput("Roland FP-30")))

    expect(strip(el).classList.contains(styles.listening)).toBe(true)
  })

  it("updates live when the only device disappears", function() {
    let midi = new FakeMidiAccess([new FakeInput("Roland FP-30")])
    let el = renderPage({midi})
    expect(strip(el).classList.contains(styles.listening)).toBe(true)

    flushSync(() => midi.removeInput("0"))

    expect(strip(el).classList.contains(styles.none)).toBe(true)
  })

  it("marks the flag and takes 'Take your seat' to the trainer (no /setup route yet)", function() {
    let el = renderPage({})
    let primary = [...el.querySelectorAll("a")].find(a => a.textContent == "Take your seat")
    expect(primary.getAttribute("href")).toEqual("/")

    flushSync(() => primary.click())

    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeTruthy()
    expect(el.querySelector("#target-trainer")).not.toBe(null)
  })

  it("marks the flag and takes 'Use the on-screen keys' to the trainer", function() {
    let el = renderPage({})
    let ghost = [...el.querySelectorAll("a")].find(a => a.textContent == "Use the on-screen keys")
    expect(ghost.getAttribute("href")).toEqual("/")

    flushSync(() => ghost.click())

    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeTruthy()
    expect(el.querySelector("#target-trainer")).not.toBe(null)
  })
})
