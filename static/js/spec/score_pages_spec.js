import {
  systemsOf, systemBands, scorePages, barOverlays, pageOfBar,
  SPACE, ENGRAVE_MAX_WIDTH, PAGE_CHROME_PX, SCORE_SCALE, clampScale, engraveWidthFor,
} from "st/score_render/score_pages"
import {loadScoreEngines} from "st/score_render/load"

const box = (x, y, w, h) => ({x, y, width: w, height: h})
const measure = (index, number, b) => ({index, number, box: b})

// a measure per [y, height], 50 wide at x 0, numbered from 1
const systemsAt = positions => positions.map(([y, h], idx) => measure(idx, idx + 1, box(0, y, 50, h)))

describe("score pages", function() {
  describe("the score scale", function() {
    it("keeps its range and steps as constants", function() {
      expect(SCORE_SCALE).toEqual({min: 60, max: 150, step: 10, initial: 100})
    })

    it("engraves 100% at the column's width up to ENGRAVE_MAX_WIDTH, and wider or narrower as the scale goes down or up", function() {
      expect(engraveWidthFor(900, 100)).toEqual(644)
      expect(engraveWidthFor(900, 60)).toEqual(1073)
      expect(engraveWidthFor(900, 150)).toEqual(429)
      expect(engraveWidthFor(330, 100)).toEqual(330)
      expect(engraveWidthFor(330, 150)).toEqual(220)
      expect(engraveWidthFor(900, 80)).toEqual(805)
    })

    it("reads a width as a whole number of pixels and a scale off the steps as the nearest", function() {
      expect(engraveWidthFor(330.7, 100)).toEqual(330)
      expect(engraveWidthFor(900, 104)).toEqual(644)
      expect(engraveWidthFor(900, "big")).toEqual(644)
    })

    it("rounds a scale to the nearest step, clamps it to the range and reads anything else as 100", function() {
      expect(clampScale(55)).toEqual(60)
      expect(clampScale(155)).toEqual(150)
      expect(clampScale(104)).toEqual(100)
      expect(clampScale(105)).toEqual(110)
      expect(clampScale(80)).toEqual(80)
      for (let value of ["big", NaN, undefined, null, Infinity, {}]) {
        expect(clampScale(value)).withContext(String(value)).toEqual(100)
      }
    })
  })

  describe("systemsOf", function() {
    it("groups measures into systems by the y jump between them", function() {
      let measures = [
        measure(0, 1, box(50, 40, 100, 150)),
        measure(1, 2, box(150, 40, 100, 150)),
        measure(2, 3, box(50, 250, 100, 150)),
      ]
      expect([...systemsOf(measures).entries()]).toEqual([[0, 0], [1, 0], [2, 1]])
    })
  })

  describe("systemBands", function() {
    it("pads each system's band 3 spaces above its measures and 2 below", function() {
      let measures = [
        measure(0, 1, box(50, 40, 100, 150)),
        measure(1, 2, box(150, 40, 100, 150)),
      ]
      let [band] = systemBands(measures)
      expect(band.top).toEqual(40 - 3 * SPACE)
      expect(band.bottom).toEqual(190 + 2 * SPACE)
      expect(band.measures.map(m => m.number)).toEqual([1, 2])
    })
  })

  describe("scorePages", function() {
    it("fills a page greedily within the budget, cutting at the midpoint between systems", function() {
      let measures = systemsAt([[0, 100], [400, 100], [700, 100]])
      let pages = scorePages(measures, {height: 900, budget: 600})

      expect(pages.length).toEqual(2)
      expect(pages[0].top).toEqual(0)
      expect(pages[0].measures.map(m => m.number)).toEqual([1, 2])
      // the midpoint of system 2's band bottom (500 + 2·SPACE) and system
      // 3's band top (700 - 3·SPACE)
      expect(pages[0].bottom).toEqual((516 + 676) / 2)
      expect(pages[1].top).toEqual(pages[0].bottom)
      expect(pages[1].bottom).toEqual(900)
      expect(pages[1].measures.map(m => m.number)).toEqual([3])
    })

    it("always takes at least one system, even one taller than the budget", function() {
      let measures = systemsAt([[0, 5000], [6000, 100], [6300, 100]])
      let pages = scorePages(measures, {height: 6500, budget: 50})

      expect(pages.map(p => p.measures.map(m => m.number))).toEqual([[1], [2], [3]])
      expect(pages[0]).toEqual(jasmine.objectContaining({top: 0}))
      expect(pages[2].bottom).toEqual(6500)
    })

    it("gives one page from 0 to the full height with a single system", function() {
      let measures = [measure(0, 1, box(0, 0, 50, 100))]
      let pages = scorePages(measures, {height: 300, budget: 1000})

      expect(pages.length).toEqual(1)
      expect(pages[0]).toEqual(jasmine.objectContaining({top: 0, bottom: 300}))
    })

    it("gives no pages without measures", function() {
      expect(scorePages([], {height: 100, budget: 100})).toEqual([])
    })
  })

  describe("barOverlays", function() {
    it("gives a page's bars as percent boxes, sharing their system's band", function() {
      let measures = [
        measure(0, 1, box(0, 40, 100, 150)),
        measure(1, 2, box(100, 40, 50, 150)),
      ]
      let [page] = scorePages(measures, {height: 400, budget: 1000})
      let overlays = barOverlays(page, 200)

      expect(overlays.length).toEqual(2)
      expect(overlays[0].left).toBeCloseTo(0, 5)
      expect(overlays[0].width).toBeCloseTo(50, 5)
      expect(overlays[1].left).toBeCloseTo(50, 5)
      expect(overlays[1].width).toBeCloseTo(25, 5)
      expect(overlays[0].top).toEqual(overlays[1].top)
      expect(overlays[0].height).toEqual(overlays[1].height)
    })

    it("gives a split bar two overlays sharing its number", function() {
      let measures = [
        measure(0, 5, box(0, 40, 100, 150)),
        measure(1, 5, box(100, 40, 50, 150)),
      ]
      let [page] = scorePages(measures, {height: 400, budget: 1000})
      expect(barOverlays(page, 200).map(o => o.number)).toEqual([5, 5])
    })
  })

  describe("pageOfBar", function() {
    it("gives the index of the page holding a bar, 0 when it isn't on any", function() {
      let measures = systemsAt([[0, 100], [400, 100], [700, 100]])
      let pages = scorePages(measures, {height: 900, budget: 50})

      expect(pageOfBar(pages, 2)).toEqual(1)
      expect(pageOfBar(pages, 99)).toEqual(0)
    })
  })

  describe("the real fixture", function() {
    it("engraves bars 1-16 into the artboards' own systems and pages", async function() {
      let musicXML = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
      let bundle = await loadScoreEngines()
      let result = await bundle.ENGINES.osmd.renderCard({
        musicXML, fromMeasure: 1, toMeasure: 16, hand: "both", width: ENGRAVE_MAX_WIDTH,
      })

      let systemOf = systemsOf(result.measures)
      let bySystem = new Map()
      for (let measure of result.measures) {
        let system = systemOf.get(measure.index)
        bySystem.set(system, [...(bySystem.get(system) || []), measure.number])
      }
      expect([...bySystem.values()]).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16]])

      // the design's own measured budget (§A7, §D5): at 1440×1240, the
      // page box is ~836 displayed px wide, scaled up from the 644
      // engraved width, and 812 = 1240 (viewport) − 108 (header) −
      // PAGE_CHROME_PX, converted to the engraving's own natural px
      let displayedWidth = 836
      let budget = (1240 - 108 - PAGE_CHROME_PX) / (displayedWidth / ENGRAVE_MAX_WIDTH)
      let pages = scorePages(result.measures, {height: result.svg.height.baseVal.value, budget})
      expect(pages.map(page => page.measures.map(m => m.number))).toEqual([
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [16],
      ])
    })
  })
})
