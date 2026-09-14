import * as React from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {MemoryRouter} from "react-router-dom"

import {Plate, StatCard, Pill, SectionLabel, TitleBlock, PullQuote, FleuronRule} from "st/components/salon"
import styles from "st/components/salon.module.css"

let renderElement = (...elements) => {
  let el = document.createElement("div")
  el.innerHTML = renderToStaticMarkup(
    React.createElement(MemoryRouter, {}, ...elements))
  return el
}

describe("salon primitives", function() {
  it("renders a plate with four lozenges and a header", function() {
    let el = renderElement(React.createElement(Plate, {header: "Minutes at the bench", headerAside: "Goal 10"}, "body"))
    expect(el.querySelectorAll(`.${styles.lozenge}`).length).toEqual(4)
    expect(el.querySelector(`.${styles.plate_header}`).textContent).toEqual("Minutes at the benchGoal 10")
  })

  it("renders a plate without a header", function() {
    let el = renderElement(React.createElement(Plate, {}, "body"))
    expect(el.querySelector(`.${styles.plate_header}`)).toBe(null)
  })

  it("renders a stat card with an accented value and suffix", function() {
    let el = renderElement(React.createElement(StatCard, {label: "Accuracy", value: "94", suffix: "%", accent: true}))
    expect(el.querySelector(`.${styles.stat_label}`).textContent).toEqual("Accuracy")
    let value = el.querySelector(`.${styles.stat_value}`)
    expect(value.textContent).toEqual("94%")
    expect(value.classList.contains(styles.accent)).toBe(true)
  })

  it("renders pills as buttons or links", function() {
    let el = renderElement(
      React.createElement(Pill, {variant: "primary"}, "Begin"),
      React.createElement(Pill, {variant: "ghost", to: "/stats"}, "See all progress"),
      React.createElement(Pill, {variant: "choice", selected: true}, "Grand"),
    )

    let [primary, choice] = el.querySelectorAll("button")
    expect(primary.getAttribute("type")).toEqual("button")
    expect(primary.classList.contains(styles.primary)).toBe(true)

    let link = el.querySelector("a")
    expect(link.getAttribute("href")).toEqual("/stats")
    expect(link.classList.contains(styles.ghost)).toBe(true)

    expect(choice.classList.contains(styles.selected)).toBe(true)
    expect(choice.getAttribute("aria-pressed")).toEqual("true")
  })

  it("renders the text primitives", function() {
    let el = renderElement(
      React.createElement(SectionLabel, {ornament: "❧"}, "By clef"),
      React.createElement(TitleBlock, {eyebrow: "Fortnight ending 14 September", title: "A record of the", italic: "evenings"}),
      React.createElement(FleuronRule),
      React.createElement(PullQuote, {}, "Read ahead by one column."),
    )

    expect(el.querySelector(`.${styles.section_label}`).textContent).toEqual("❧By clef")
    expect(el.querySelector("h1").textContent).toEqual("A record of the evenings")
    expect(el.querySelector(`.${styles.title_italic}`).textContent).toEqual("evenings")
    expect(el.querySelector(`.${styles.fleuron_rule}`).textContent).toEqual("❖")
    expect(el.querySelector("blockquote").textContent).toEqual("❖Read ahead by one column.")
  })
})
