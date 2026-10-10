import * as React from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route} from "react-router-dom"

import {Plate, StatCard, Pill, SectionLabel, TitleBlock, PullQuote, FleuronRule, AccuracyRule, TabNav} from "st/components/salon"
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

  it("renders an accuracy rule's fill width and weak state", function() {
    let el = renderElement(React.createElement(AccuracyRule, {percent: 83}))
    let rule = el.querySelector(`.${styles.accuracy_rule}`)
    expect(rule.hasAttribute("data-weak")).toBe(false)
    expect(rule.querySelector(`.${styles.accuracy_fill}`).style.width).toEqual("83%")

    let weak = renderElement(React.createElement(AccuracyRule, {percent: 57, weak: true}))
      .querySelector(`.${styles.accuracy_rule}`)
    expect(weak.getAttribute("data-weak")).toEqual("true")
  })
  describe("TabNav", function() {
    let tabs = [{to: "/stats", label: "Today", end: true}, {to: "/stats/last-14-days", label: "Last 14 days", count: 2}]

    let root, container
    afterEach(function() {
      if (root) { flushSync(() => root.unmount()); container.remove(); root = null }
    })

    let render = path => {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
        React.createElement(Routes, {}, React.createElement(Route, {
          path: "/stats/*", element: React.createElement(TabNav, {label: "Practice record", tabs}),
        })))))
      return container
    }

    it("renders each tab as a link in a labelled nav, only the active one marked", function() {
      let el = render("/stats")
      let nav = el.querySelector("nav")
      expect(nav.getAttribute("aria-label")).toEqual("Practice record")

      let links = [...nav.querySelectorAll("a")]
      expect(links.map(a => a.getAttribute("href"))).toEqual(["/stats", "/stats/last-14-days"])
      expect(links.map(a => a.getAttribute("aria-current"))).toEqual(["page", null])
      expect(links.map(a => a.classList.contains(styles.active))).toEqual([true, false])
    })

    it("marks the tab under the path, and an index tab only on its own path", function() {
      let links = [...render("/stats/last-14-days").querySelectorAll("a")]
      expect(links.map(a => a.getAttribute("aria-current"))).toEqual([null, "page"])
      expect(links[1].querySelector(`.${styles.tab_count}`).textContent).toEqual("2")
    })
  })
})
