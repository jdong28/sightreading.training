import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route} from "react-router-dom"

import {HomeGate, HeaderChrome} from "st/components/app"
import {ONBOARDED_KEY} from "st/onboarding"

describe("app routing", function() {
  let container, root

  afterEach(function() {
    window.localStorage.removeItem(ONBOARDED_KEY)
    flushSync(() => root.unmount())
    container.remove()
  })

  describe("HomeGate", function() {
    let renderAt = (path, element) => {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => {
        root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
          React.createElement(Routes, {},
            React.createElement(Route, {path: "/", element}),
            React.createElement(Route, {path: "/welcome", element: React.createElement("div", {id: "welcome-stub"})}))))
      })
      return container
    }

    it("redirects the first launch to /welcome", async function() {
      window.localStorage.removeItem(ONBOARDED_KEY)
      let el = renderAt("/", React.createElement(HomeGate, {}, React.createElement("div", {id: "home-stub"})))
      // <Navigate> performs the redirect from an effect, not synchronously during render
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(el.querySelector("#welcome-stub")).not.toBe(null)
      expect(el.querySelector("#home-stub")).toBe(null)
    })

    it("renders the child once the flag is set", function() {
      window.localStorage.setItem(ONBOARDED_KEY, "1")
      let el = renderAt("/", React.createElement(HomeGate, {}, React.createElement("div", {id: "home-stub"})))
      expect(el.querySelector("#home-stub")).not.toBe(null)
      expect(el.querySelector("#welcome-stub")).toBe(null)
    })
  })

  describe("HeaderChrome", function() {
    let renderChrome = path => {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => {
        root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
          React.createElement(HeaderChrome, {midiInput: null})))
      })
      return container
    }

    it("hides the header on /welcome", function() {
      let el = renderChrome("/welcome")
      expect(el.querySelector("header")).toBe(null)
    })

    it("shows the header elsewhere", function() {
      let el = renderChrome("/")
      expect(el.querySelector("header")).not.toBe(null)
    })
  })
})
