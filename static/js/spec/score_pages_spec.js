import {
  systemsOf, systemBands, scorePages, barOverlays, pageOfBar,
  ENGRAVE_MAX_WIDTH, SPACE, PAGE_CHROME_PX, MIN_PAGE_PX,
} from "st/score_render/score_pages"
import {loadScoreEngines} from "st/score_render/load"

// three systems of 4 bars each (1-4 at y=100, 5-8 at y=300, 9-12 at y=500),
// each box 50 wide, 80 tall, 50px apart along the line
function measuresOf(systemCount=3, perSystem=4) {
  let measures = []
  for (let s = 0; s < systemCount; s++) {
    for (let b = 0; b < perSystem; b++) {
      let idx = s * perSystem + b
      measures.push({index: idx, number: idx + 1, box: {x: b * 50, y: 100 + s * 200, width: 50, height: 80}})
    }
  }
  return measures
}

describe("score_pages", function() {
  it("exports its constants", function() {
    expect(ENGRAVE_MAX_WIDTH).toEqual(644)
    expect(SPACE).toEqual(8)
    expect(PAGE_CHROME_PX).toEqual(320)
    expect(MIN_PAGE_PX).toEqual(280)
  })

  describe("systemsOf", function() {
    it("groups measures by index order, a new system on a y jump", function() {
      let measures = measuresOf(2, 4)
      let systems = systemsOf(measures)
      expect(measures.slice(0, 4).map(m => systems.get(m.index))).toEqual([0, 0, 0, 0])
      expect(measures.slice(4, 8).map(m => systems.get(m.index))).toEqual([1, 1, 1, 1])
    })
  })

  describe("systemBands", function() {
    it("pads 3 staff spaces above a system's boxes and 2 below", function() {
      let bands = systemBands(measuresOf(1, 4))
      expect(bands.length).toEqual(1)
      expect(bands[0].top).toEqual(100 - 3 * SPACE)
      expect(bands[0].bottom).toEqual(180 + 2 * SPACE)
    })

    it("gives one band per system, in order", function() {
      let bands = systemBands(measuresOf(3, 4))
      expect(bands.map(b => b.system)).toEqual([0, 1, 2])
      expect(bands.map(b => b.measures.map(m => m.number))).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])
    })
  })

  describe("scorePages", function() {
    it("gives one page with no systems", function() {
      expect(scorePages([], {height: 1000, width: 644})).toEqual([])
    })

    it("fits every system on one page within a generous budget", function() {
      let measures = measuresOf(3, 4)
      let pages = scorePages(measures, {height: 700, width: 644, budget: 10000})
      expect(pages.length).toEqual(1)
      expect(pages[0]).toEqual({top: 0, bottom: 700, width: 644, measures})
    })

    it("cuts between systems at the midpoint, the first page from 0 and the last to height", function() {
      let measures = measuresOf(3, 4)
      let bands = systemBands(measures)
      // each band is ~[top-24, bottom+16]; a budget that fits one band only
      let budget = bands[0].bottom - bands[0].top + 1
      let pages = scorePages(measures, {height: 700, width: 644, budget})
      expect(pages.length).toEqual(3)
      expect(pages[0].top).toEqual(0)
      expect(pages[pages.length - 1].bottom).toEqual(700)
      // consecutive pages share their cut
      expect(pages[0].bottom).toEqual(pages[1].top)
      expect(pages[1].bottom).toEqual(pages[2].top)
      let expectedCut = (bands[0].bottom + bands[1].top) / 2
      expect(pages[0].bottom).toEqual(expectedCut)
      expect(pages.map(p => p.measures.map(m => m.number))).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])
    })

    it("always takes at least one system, even taller than the budget", function() {
      let measures = measuresOf(2, 4)
      let pages = scorePages(measures, {height: 500, width: 644, budget: 1})
      expect(pages.length).toEqual(2)
      expect(pages[0].measures.map(m => m.number)).toEqual([1, 2, 3, 4])
      expect(pages[1].measures.map(m => m.number)).toEqual([5, 6, 7, 8])
    })

    it("takes whole systems while the next still fits, greedily", function() {
      let measures = measuresOf(3, 4)
      let bands = systemBands(measures)
      // room for the first two systems together, not the third
      let budget = (bands[1].bottom + bands[2].top) / 2 - 0 + 1
      let pages = scorePages(measures, {height: 700, width: 644, budget})
      expect(pages.length).toEqual(2)
      expect(pages[0].measures.map(m => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(pages[1].measures.map(m => m.number)).toEqual([9, 10, 11, 12])
    })
  })

  describe("barOverlays", function() {
    it("gives every bar on the page a % box sharing its system's band", function() {
      let measures = measuresOf(1, 4)
      let page = {top: 0, bottom: 200, width: 644, measures}
      let overlays = barOverlays(page)
      expect(overlays.length).toEqual(4)
      expect(overlays[0].number).toEqual(1)
      expect(overlays[0].left).toBeCloseTo(0 / 644 * 100, 5)
      expect(overlays[0].width).toBeCloseTo(50 / 644 * 100, 5)
      // every bar shares the one system's band top/height
      let tops = overlays.map(o => o.top)
      expect(tops.every(t => t == tops[0])).toBe(true)
    })

    it("numbers each bar's system on the page and how many the page holds", function() {
      let page = {top: 0, bottom: 400, width: 644, measures: measuresOf(2, 4)}
      let overlays = barOverlays(page)
      expect(overlays.map(o => o.system)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
      expect(overlays.every(o => o.systems == 2)).toBe(true)
    })

    it("gives two overlays with the same number for a split bar", function() {
      let measures = [
        {index: 0, number: 1, box: {x: 0, y: 100, width: 50, height: 80}},
        {index: 1, number: 2, box: {x: 50, y: 100, width: 50, height: 80}},
        {index: 2, number: 2, box: {x: 0, y: 300, width: 50, height: 80}},
      ]
      let page = {top: 0, bottom: 400, width: 644, measures}
      let overlays = barOverlays(page)
      expect(overlays.filter(o => o.number == 2).length).toEqual(2)
    })

    it("gives nothing for an empty page", function() {
      expect(barOverlays({top: 0, bottom: 0, width: 644, measures: []})).toEqual([])
    })
  })

  describe("pageOfBar", function() {
    it("finds the page holding a bar number, 0 when not found", function() {
      let pages = [
        {top: 0, bottom: 100, width: 644, measures: [{index: 0, number: 1, box: {x: 0, y: 0, width: 1, height: 1}}]},
        {top: 100, bottom: 200, width: 644, measures: [{index: 1, number: 2, box: {x: 0, y: 0, width: 1, height: 1}}]},
      ]
      expect(pageOfBar(pages, 2)).toEqual(1)
      expect(pageOfBar(pages, 1)).toEqual(0)
      expect(pageOfBar(pages, 99)).toEqual(0)
    })
  })

  describe("against a real engine", function() {
    let musicXML

    beforeAll(async function() {
      let response = await fetch("/tools/fingerings/tests/fixture/score.musicxml")
      musicXML = await response.text()
    })

    it("gives the fixture's 16 bars four systems of [1-5][6-10][11-15][16]", async function() {
      let bundle = await loadScoreEngines()
      let result = await bundle.ENGINES.osmd.renderCard({
        musicXML, fromMeasure: 1, toMeasure: 16, hand: "both", width: ENGRAVE_MAX_WIDTH,
      })

      let bands = systemBands(result.measures)
      expect(bands.length).toEqual(4)
      expect(bands.map(b => b.measures.map(m => m.number))).toEqual([
        [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16],
      ])
    })

    it("keeps a whole system off the page once it no longer fits the budget", async function() {
      let bundle = await loadScoreEngines()
      let result = await bundle.ENGINES.osmd.renderCard({
        musicXML, fromMeasure: 1, toMeasure: 16, hand: "both", width: ENGRAVE_MAX_WIDTH,
      })

      let height = result.svg.height.baseVal.value
      let width = result.svg.width.baseVal.value
      let bands = systemBands(result.measures)

      // just enough room for the first three systems (bars 1-15), not the fourth
      let budget = (bands[2].bottom + bands[3].top) / 2 - 0 + 1
      let pages = scorePages(result.measures, {height, width, budget})

      expect(pages.length).toEqual(2)
      expect(pages[0].measures.map(m => m.number)).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      expect(pages[1].measures.map(m => m.number)).toEqual([16])
    })
  })
})
