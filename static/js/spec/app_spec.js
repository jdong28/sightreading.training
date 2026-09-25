import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, Routes, Route} from "react-router-dom"

import App, {HomeGate, HeaderChrome} from "st/components/app"
import drawerStyles from "st/components/sight_reading/programme_drawer.module.css"
import {SHEET_MUSIC_STORAGE_KEY} from "st/data"
import {DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {ONBOARDED_KEY, hasOnboarded} from "st/onboarding"
import {setAppStore} from "st/storage"
import {pieceSource} from "st/sheet_music_deck"
import {openTestStore, LITTLE_WALTZ_XML, littleWaltzMXL} from "spec/helpers"

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
      window.localStorage.removeItem("defaults:midiIn")
      let el = renderAt("/", React.createElement(HomeGate, {}, React.createElement("div", {id: "home-stub"})))
      // <Navigate> performs the redirect from an effect, not synchronously during render
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(el.querySelector("#welcome-stub")).not.toBe(null)
      expect(el.querySelector("#home-stub")).toBe(null)
    })

    it("lets an existing install with a saved MIDI input through", async function() {
      window.localStorage.removeItem(ONBOARDED_KEY)
      window.localStorage.setItem("defaults:midiIn", "Roland FP-30")
      try {
        let el = renderAt("/", React.createElement(HomeGate, {}, React.createElement("div", {id: "home-stub"})))
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(el.querySelector("#home-stub")).not.toBe(null)
        expect(el.querySelector("#welcome-stub")).toBe(null)
      } finally {
        window.localStorage.removeItem("defaults:midiIn")
      }
    })

    it("renders the child once the flag is set", function() {
      window.localStorage.setItem(ONBOARDED_KEY, "1")
      let el = renderAt("/", React.createElement(HomeGate, {}, React.createElement("div", {id: "home-stub"})))
      expect(el.querySelector("#home-stub")).not.toBe(null)
      expect(el.querySelector("#welcome-stub")).toBe(null)
    })
  })

  describe("trainer pages", function() {
    const STORAGE_KEYS = [DRILL_STORAGE_KEY, SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]
    let store, previousStore, saved

    beforeEach(async function() {
      saved = STORAGE_KEYS.map(key => window.localStorage.getItem(key))
      STORAGE_KEYS.forEach(key => window.localStorage.removeItem(key))
      window.localStorage.setItem(ONBOARDED_KEY, "1")
      store = await openTestStore()
      previousStore = setAppStore(store)
    })

    afterEach(async function() {
      STORAGE_KEYS.forEach((key, idx) => {
        if (saved[idx] == null) {
          window.localStorage.removeItem(key)
        } else {
          window.localStorage.setItem(key, saved[idx])
        }
      })
      setAppStore(previousStore)
      await store.close()
    })

    let renderApp = path => {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => {
        root.render(React.createElement(MemoryRouter, {initialEntries: [path]},
          React.createElement(App.Layout)))
      })
      flushSync(() => {})
      return container
    }

    let drawerText = el => el.querySelector(`.${drawerStyles.drawer}`).textContent
    let activeNav = el => [...el.querySelectorAll("nav a.active")].map(a => a.textContent)

    it("renders the score page at /sheet-music", function() {
      let el = renderApp("/sheet-music")

      expect(document.title).toEqual("Sheet music | Sight Reading Trainer")
      expect(activeNav(el)).toEqual(["Sheet music"])
      expect(drawerText(el)).toContain("Import MusicXML")
      expect(drawerText(el)).not.toContain("Clef")
    })

    it("renders the engraving engines page at /score-engines, kept out of the navigation", function() {
      let el = renderApp("/score-engines")

      expect(document.title).toEqual("Engraving engines | Sight Reading Trainer")
      expect(el.querySelector("main h1").textContent).toEqual("Engraving engines")
      expect(el.textContent).toContain("No pieces imported yet")
      expect([...el.querySelectorAll("nav a")].map(a => a.getAttribute("href"))).not.toContain("/score-engines")
    })

    it("links the score page's drawer to the engraving engines page", function() {
      let el = renderApp("/sheet-music")
      let link = [...el.querySelectorAll(`.${drawerStyles.drawer} a`)]
        .find(a => a.textContent == "Compare engraving engines")
      expect(link).toBeDefined()
      expect(link.getAttribute("href")).toMatch(/^\/score-engines/)
    })

    it("imports a compressed .mxl file picked in the score page's deck, and picks it", async function() {
      let el = renderApp("/sheet-music")
      let drawer = el.querySelector(`.${drawerStyles.drawer}`)

      let fileInput = drawer.querySelector(`.${drawerStyles.file_input} > input[type=file]`)
      expect(fileInput.accept.split(",")).toContain(".mxl")

      Object.defineProperty(fileInput, "files", {
        value: [new File([littleWaltzMXL()], "little_waltz.mxl")],
        configurable: true,
      })
      flushSync(() => fileInput.dispatchEvent(new Event("change", {bubbles: true})))

      for (let tries = 0; tries < 100 && !drawer.textContent.includes("is in the deck"); tries++) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      expect(drawer.textContent).toContain("\"little waltz\" is in the deck")
      let [piece] = store.pieces()
      expect(piece.title).toEqual("little waltz")
      expect(drawer.querySelector(`.${drawerStyles.deck_row} select`).value).toEqual(piece.id)
      expect(await pieceSource(piece.id, store)).toEqual(LITTLE_WALTZ_XML)
    })

    it("answers a PDF picked in the score page's deck with the conversion steps and adds no piece", async function() {
      let el = renderApp("/sheet-music")
      let drawer = el.querySelector(`.${drawerStyles.drawer}`)
      let fileInput = drawer.querySelector(`.${drawerStyles.file_input} > input[type=file]`)
      expect(fileInput.accept.split(",")).toContain(".pdf")

      Object.defineProperty(fileInput, "files", {
        value: [new File(["%PDF-1.4"], "nocturne.pdf", {type: "application/pdf"})],
        configurable: true,
      })
      flushSync(() => fileInput.dispatchEvent(new Event("change", {bubbles: true})))
      flushSync(() => {})

      let text = drawer.textContent
      expect(text).toContain("PDFs need converting first")
      expect(text).toContain("nocturne.pdf")
      expect(text).toContain("Audiveris")
      expect(text).toContain("MuseScore Studio")
      expect(text).toContain("keeps the piece's stats")
      expect([...drawer.querySelectorAll("a")].map(a => a.getAttribute("href")))
        .toContain("https://audiveris.github.io/audiveris/")
      expect(text).not.toContain("Importing nocturne.pdf")
      expect(store.pieces()).toEqual([])

      // a MusicXML pick still imports, and clears the steps
      Object.defineProperty(fileInput, "files", {
        value: [new File([littleWaltzMXL()], "little_waltz.mxl")],
        configurable: true,
      })
      flushSync(() => fileInput.dispatchEvent(new Event("change", {bubbles: true})))

      for (let tries = 0; tries < 100 && !drawer.textContent.includes("is in the deck"); tries++) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      expect(drawer.textContent).toContain("\"little waltz\" is in the deck")
      expect(drawer.textContent).not.toContain("PDFs need converting first")
      expect(store.pieces().length).toEqual(1)
    })

    it("answers a PDF with no file name with the conversion steps too", function() {
      let el = renderApp("/sheet-music")
      let drawer = el.querySelector(`.${drawerStyles.drawer}`)
      let fileInput = drawer.querySelector(`.${drawerStyles.file_input} > input[type=file]`)

      Object.defineProperty(fileInput, "files", {
        value: [new File(["%PDF-1.4"], "", {type: "application/pdf"})],
        configurable: true,
      })
      flushSync(() => fileInput.dispatchEvent(new Event("change", {bubbles: true})))
      flushSync(() => {})

      expect(drawer.textContent).toContain("PDFs need converting first")
      expect(drawer.textContent).toContain("keeps the piece's stats")
      expect(store.pieces()).toEqual([])
    })

    it("renders the exercises page at /", function() {
      let el = renderApp("/")

      expect(activeNav(el)).toEqual(["Sight reading"])
      expect(drawerText(el)).toContain("Clef")
      expect(drawerText(el)).not.toContain("Import MusicXML")
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

describe("hasOnboarded", function() {
  let store, previousStore

  beforeEach(async function() {
    window.localStorage.removeItem(ONBOARDED_KEY)
    window.localStorage.removeItem("defaults:midiIn")
    store = await openTestStore()
    previousStore = setAppStore(store)
  })

  afterEach(async function() {
    window.localStorage.removeItem(ONBOARDED_KEY)
    window.localStorage.removeItem("defaults:midiIn")
    setAppStore(previousStore)
    await store.close()
  })

  it("is false for a fresh browser", function() {
    expect(hasOnboarded()).toBe(false)
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBe(null)
  })

  it("treats an install with a saved MIDI input as onboarded", function() {
    window.localStorage.setItem("defaults:midiIn", "Roland FP-30")
    expect(hasOnboarded()).toBe(true)
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeTruthy()
  })

  it("treats an install with imported pieces as onboarded", async function() {
    await store.putPiece({id: "p1", title: "Nocturne", song: {}, importedAt: Date.now()})
    expect(hasOnboarded()).toBe(true)
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeTruthy()
  })
})
