import * as React from "react"
import {flushSync} from "react-dom"
import {MemoryRouter} from "react-router-dom"

import {getRoot} from "spec/helpers"
import SongsPage from "st/components/pages/songs"

describe("songs page", function() {
  it("renders without requesting a song library", function() {
    spyOn(XMLHttpRequest.prototype, "open")
    spyOn(XMLHttpRequest.prototype, "send")
    spyOn(window, "fetch")

    flushSync(() => {
      getRoot().render(React.createElement(MemoryRouter, {initialEntries: ["/play-along"], key: "songs-page"},
        React.createElement(SongsPage)))
    })

    let root = document.getElementById("react_root")
    expect(root.textContent).toContain("There's no song library")
    expect([...root.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/new-song"])

    expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled()
    expect(XMLHttpRequest.prototype.send).not.toHaveBeenCalled()
    expect(window.fetch).not.toHaveBeenCalled()
  })
})
