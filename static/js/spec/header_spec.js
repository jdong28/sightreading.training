import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import Header from "st/components/header"
import styles from "st/components/header.module.css"
import {scopeEvent} from "st/events"

describe("header", function() {
  let container, root

  // the transform makes the container the containing block of the fixed
  // header, so its width decides whether the nav collapses
  let renderHeader = (props={}, {width=1200, path="/"}={}) => {
    container = document.createElement("div")
    container.style.cssText = `position: relative; width: ${width}px; height: 120px; transform: translateZ(0); overflow: hidden`
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => {
      root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
        React.createElement(Header, props)))
    })
    return container
  }

  let navLinks = el => [...el.querySelectorAll("nav a")].map(a => [a.textContent, a.getAttribute("href")])

  afterEach(function() {
    flushSync(() => root.unmount())
    container.remove()
  })

  it("renders the nav items with Guide last", function() {
    let el = renderHeader()
    expect(navLinks(el)).toEqual([
      ["Sight reading", "/"],
      ["Sheet music", "/sheet-music"],
      ["Play along", "/play-along"],
      ["Ear training", "/ear-training/interval-melodies"],
      ["Flash cards", "/flash-cards/note-math"],
      ["Statistics", "/stats"],
      ["Guide", "/about"],
    ])
  })

  it("marks the current page active", function() {
    let el = renderHeader({}, {path: "/stats"})
    let active = [...el.querySelectorAll("nav a.active")].map(a => a.textContent)
    expect(active).toEqual(["Statistics"])
  })

  for (let [path, label] of [
    ["/ear-training/melody-playback", "Ear training"],
    ["/flash-cards/chord-identification", "Flash cards"],
    ["/play-along/recent", "Play along"],
    ["/sheet-music", "Sheet music"],
  ]) {
    it(`marks ${label} active on ${path}`, function() {
      let el = renderHeader({}, {path})
      let active = [...el.querySelectorAll("nav a.active")].map(a => a.textContent)
      expect(active).toEqual([label])
    })
  }

  it("has no account links or username", function() {
    let el = renderHeader({midiInput: {name: "Roland FP-30"}})
    let text = el.textContent
    expect(text).not.toMatch(/log ?in|log ?out|register/i)
    expect(el.querySelector("a[href='/login'], a[href='/register']")).toBe(null)
  })

  it("shows no instrument when no input is selected", function() {
    let el = renderHeader()
    let status = el.querySelector(`.${styles.instrument_status}`)
    expect(status.textContent).toEqual("No instrument")
    let dot = status.querySelector(`.${styles.instrument_dot}`)
    expect(dot.classList.contains(styles.connected)).toBe(false)
  })

  it("shows the selected input's name with the connected dot", function() {
    let el = renderHeader({midiInput: {name: "Roland FP-30"}})
    let status = el.querySelector(`.${styles.instrument_status}`)
    expect(status.textContent).toEqual("Roland FP-30")
    expect(getComputedStyle(status).textTransform).toEqual("uppercase")
    let dot = status.querySelector(`.${styles.instrument_dot}`)
    expect(dot.classList.contains(styles.connected)).toBe(true)
  })

  it("opens the device picker from the instrument status", function() {
    let el = renderHeader()
    let picked = jasmine.createSpy("pickMidi")
    el.addEventListener(scopeEvent("pickMidi"), picked)
    el.querySelector(`.${styles.instrument_status}`).click()
    expect(picked).toHaveBeenCalledTimes(1)
  })

  it("collapses the nav into a menu when narrow", function() {
    let el = renderHeader({}, {width: 400})
    expect(navLinks(el)).toEqual([])

    let toggle = el.querySelector("nav button")
    expect(toggle.textContent).toContain("Menu")
    flushSync(() => toggle.click())

    expect(navLinks(el).map(([label]) => label)).toEqual([
      "Sight reading", "Sheet music", "Play along", "Ear training", "Flash cards", "Statistics", "Guide",
    ])
  })
})
