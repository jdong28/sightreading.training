import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import PlateFeedback, {SMUDGE_HOLD_MS} from "st/components/sight_reading/plate_feedback"

describe("plate feedback", function() {
  let container, root

  beforeEach(function() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    jasmine.clock().install()
  })

  afterEach(function() {
    flushSync(() => root.unmount())
    container.remove()
    jasmine.clock().uninstall()
  })

  // a stub element with a fixed getBoundingClientRect, since jsdom lays
  // nothing out
  let rectEl = (left, top, width, height) => {
    let el = document.createElement("div")
    el.getBoundingClientRect = () => ({
      left, top, right: left + width, bottom: top + height, width, height,
    })
    return el
  }

  let render = (props={}) => {
    flushSync(() => root.render(React.createElement(PlateFeedback, {
      smudge: 0, locateHead: () => [], ...props,
    })))
    return container
  }

  let rerender = (props) => flushSync(() => root.render(React.createElement(PlateFeedback, props)))

  let tick = ms => flushSync(() => jasmine.clock().tick(ms))

  let layer = () => container.querySelector("[data-plate-feedback]")
  let smudge = () => container.querySelector("[data-smudge]")

  // the layer's own rect, read once the smudge is placed (see
  // PlateFeedback#locate)
  let stubLayerRect = (left, top, width, height) => {
    layer().getBoundingClientRect = () => ({
      left, top, right: left + width, bottom: top + height, width, height,
    })
  }

  it("renders an aria-hidden layer with the smudge off", function() {
    render()
    expect(layer().getAttribute("aria-hidden")).toEqual("true")
    expect(smudge().dataset.smudge).toEqual("off")
  })

  it("turns the smudge on at the centre of the located elements' union rect, relative to the layer", function() {
    let elements = [rectEl(10, 20, 20, 10), rectEl(50, 40, 10, 10)]
    let locateHead = jasmine.createSpy("locateHead").and.returnValue(elements)
    let props = {smudge: 0, locateHead}
    render(props)
    stubLayerRect(0, 0, 200, 150)

    rerender({...props, smudge: 1})
    expect(locateHead.calls.count()).toEqual(1)
    expect(smudge().dataset.smudge).toEqual("on")

    // union rect: left 10, top 20, right 60, bottom 50; centre (35, 35)
    expect(parseFloat(smudge().style.left)).toBeCloseTo(35, 5)
    expect(parseFloat(smudge().style.top)).toBeCloseTo(35, 5)

    tick(SMUDGE_HOLD_MS - 1)
    expect(smudge().dataset.smudge).toEqual("on")
    tick(1)
    expect(smudge().dataset.smudge).toEqual("off")

    // a second change at 600ms keeps it on until 1500ms and moves it
    rerender({...props, smudge: 2})
    tick(600)
    expect(smudge().dataset.smudge).toEqual("on")

    locateHead.and.returnValue([rectEl(90, 100, 10, 10)])
    rerender({...props, smudge: 3})
    tick(600)
    expect(smudge().dataset.smudge).toEqual("on")
    expect(parseFloat(smudge().style.left)).toBeCloseTo(95, 5)
    expect(parseFloat(smudge().style.top)).toBeCloseTo(105, 5)

    tick(299)
    expect(smudge().dataset.smudge).toEqual("on")
    tick(1)
    expect(smudge().dataset.smudge).toEqual("off")
  })

  it("keeps the smudge at its CSS default with no located element, but still turns it on", function() {
    let props = {smudge: 0, locateHead: () => []}
    render(props)
    stubLayerRect(0, 0, 200, 150)

    rerender({...props, smudge: 1})
    expect(smudge().dataset.smudge).toEqual("on")
    expect(smudge().style.left).toEqual("")
    expect(smudge().style.top).toEqual("")
  })

  it("clamps a located rect outside the layer inside it", function() {
    let locateHead = () => [rectEl(-300, -300, 10, 10)]
    let props = {smudge: 0, locateHead}
    render(props)
    stubLayerRect(0, 0, 200, 150)

    rerender({...props, smudge: 1})
    expect(parseFloat(smudge().style.left)).toEqual(0)
    expect(parseFloat(smudge().style.top)).toEqual(0)

    locateHead = () => [rectEl(1000, 1000, 10, 10)]
    rerender({...props, locateHead, smudge: 2})
    expect(parseFloat(smudge().style.left)).toEqual(200)
    expect(parseFloat(smudge().style.top)).toEqual(150)
  })

  it("throws nothing on unmount with the timer pending, and fires no setState after", function() {
    let elements = [rectEl(10, 10, 10, 10)]
    let props = {smudge: 0, locateHead: () => elements}
    render(props)
    stubLayerRect(0, 0, 200, 150)

    rerender({...props, smudge: 1})
    expect(() => flushSync(() => root.unmount())).not.toThrow()
    root = createRoot(container)

    expect(() => jasmine.clock().tick(SMUDGE_HOLD_MS + 100)).not.toThrow()
  })
})
