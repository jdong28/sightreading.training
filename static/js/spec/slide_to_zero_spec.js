import SlideToZero from "st/slide_to_zero"

// Drives the slider's frame loop deterministically: every call to
// requestAnimationFrame is collected, and step(dt) runs the next one at
// time += dt (ms), however many frames are queued by the callback it runs
let frames = () => {
  let queue = []
  let time = 0
  window.requestAnimationFrame = cb => queue.push(cb)

  let step = dt => {
    time += dt
    let due = queue
    queue = []
    due.forEach(cb => cb(time))
  }

  return {step}
}

describe("SlideToZero", function() {
  let realRAF

  beforeEach(function() {
    realRAF = window.requestAnimationFrame
  })

  afterEach(function() {
    window.requestAnimationFrame = realRAF
  })

  it("loops at 0 by default, settling at the floor and stopping once", function() {
    let {step} = frames()
    let loops = 0
    let stops = 0
    let slider = new SlideToZero({
      speed: 1, loopPhase: 1, initialValue: 4, floor: 0.5,
      onLoop: () => loops++,
      onStop: () => stops++,
    })

    // the first frame only timestamps, every later one moves the value by
    // speed * dt
    step(0)
    for (let i = 0; i < 100; i++) { step(100) }

    expect(slider.value).toEqual(0.5)
    expect(loops).toEqual(0)
    expect(stops).toEqual(1)
  })

  it("never stops with no floor (the value > null trap), and keeps looping past 0", function() {
    let {step} = frames()
    let loops = 0
    let stops = 0
    let slider = new SlideToZero({
      speed: 1, loopPhase: 1, initialValue: 1.5,
      onLoop: () => loops++,
      onStop: () => stops++,
    })
    slider.floor = null
    slider.passAt = -0.5
    slider.checkAndStart()

    step(0)
    // 1.5 -> 1.0 -> 0.5 -> 0.0 -> -0.5 (passAt): one loop, value raised by
    // loopPhase (1) back to 0.5. Frames stay at 500ms, the frame-gap pause
    // window's edge, so none is dropped as a hidden tab would be
    step(500)
    step(500)
    step(500)
    step(500)

    expect(loops).toEqual(1)
    expect(stops).toEqual(0)
    expect(slider.value).toBeCloseTo(0.5, 5)

    // the animation keeps going past the loop
    step(100)
    expect(slider.value).toBeCloseTo(0.4, 5)
  })

  it("drops a single frame gap over the pause window while there's no floor, moving nothing", function() {
    let {step} = frames()
    let loops = 0
    let slider = new SlideToZero({
      speed: 1, loopPhase: 1, initialValue: 2,
      onLoop: () => loops++,
    })
    slider.floor = null
    slider.checkAndStart()

    step(0)
    step(100)
    expect(slider.value).toBeCloseTo(1.9, 5)

    // the tab was hidden for 5s: the gap is dropped, not played catch-up
    step(5000)
    expect(slider.value).toBeCloseTo(1.9, 5)

    // the next normal frame resumes as usual
    step(100)
    expect(slider.value).toBeCloseTo(1.8, 5)
  })

  it("clamps to a numeric floor set while animating with no floor, and stops", function() {
    let {step} = frames()
    let stops = 0
    let slider = new SlideToZero({
      speed: 1, loopPhase: 1, initialValue: 2,
      onStop: () => stops++,
    })
    slider.floor = null
    slider.checkAndStart()

    step(0)
    step(100)
    expect(slider.value).toBeCloseTo(1.9, 5)

    slider.floor = 1.85
    step(100)
    expect(slider.value).toEqual(1.85)
    expect(stops).toEqual(1)
  })
})
