import {
  systemsOf, systemBands, scorePages, barOverlays, pageOfBar, ENGRAVE_MAX_WIDTH, SPACE,
} from "st/score_render/score_pages"
import {loadScoreEngines} from "st/score_render/load"

// two systems of 4 bars each (numbers 1-4 on y=100, 5-8 on y=300), the same
// fixture score_render_spec.js's shadeBands/barAt tests use
const twoSystems = () => Array.from({length: 8}, (_, idx) => ({
  index: idx,
  number: idx + 1,
  box: {x: (idx % 4) * 50, y: idx < 4 ? 100 : 300, width: 50, height: 80},
}))

// 16 bars, one quarter note a beat, grand staff, no key signature (C major)
function sixteenBarScore() {
  let measures = []
  for (let n = 1; n <= 16; n++) {
    measures.push(`
    <measure number="${n}">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type></note>
    </measure>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Fixture</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type></note>
    </measure>
    ${measures.slice(1).join("")}
  </part>
</score-partwise>`
}

describe("systemsOf", function() {
  it("gives a new system when a measure's y jumps by more than half a box height", function() {
    let systemOf = systemsOf(twoSystems())
    expect([...systemOf.entries()]).toEqual([
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 1], [5, 1], [6, 1], [7, 1],
    ])
  })
})

describe("systemBands", function() {
  it("pads each system's band 3 spaces above its boxes and 2 below", function() {
    let bands = systemBands(twoSystems())
    expect(bands.length).toEqual(2)
    expect(bands[0]).toEqual({
      system: 0, top: 100 - 3 * SPACE, bottom: 180 + 2 * SPACE, measures: twoSystems().slice(0, 4),
    })
    expect(bands[1]).toEqual({
      system: 1, top: 300 - 3 * SPACE, bottom: 380 + 2 * SPACE, measures: twoSystems().slice(4, 8),
    })
  })

  it("keeps a split bar's later position in its own system's band, not its first", function() {
    let split = [...twoSystems(), {index: 8, number: 4, box: {x: 200, y: 300, width: 50, height: 80}}]
    let bands = systemBands(split)
    expect(bands.length).toEqual(2)
    expect(bands[1].measures.map(m => m.number)).toEqual([5, 6, 7, 8, 4])
  })
})

describe("scorePages", function() {
  let bands = () => systemBands(twoSystems())
  let midpoint = (bands()[0].bottom + bands()[1].top) / 2

  it("gives nothing for no measures", function() {
    expect(scorePages([], {height: 500, budget: 1000})).toEqual([])
  })

  it("fits every system on one page when the budget allows, from 0 to the full height", function() {
    let pages = scorePages(twoSystems(), {height: 500, budget: 1000})
    expect(pages.length).toEqual(1)
    expect(pages[0].top).toEqual(0)
    expect(pages[0].bottom).toEqual(500)
    expect(pages[0].measures.length).toEqual(8)
  })

  it("cuts at the midpoint between systems when the budget doesn't fit both", function() {
    let pages = scorePages(twoSystems(), {height: 500, budget: 150})
    expect(pages.length).toEqual(2)
    expect(pages[0]).toEqual(jasmine.objectContaining({top: 0, bottom: midpoint}))
    expect(pages[1]).toEqual(jasmine.objectContaining({top: midpoint, bottom: 500}))
    expect(pages[0].measures.map(m => m.number)).toEqual([1, 2, 3, 4])
    expect(pages[1].measures.map(m => m.number)).toEqual([5, 6, 7, 8])
  })

  it("always takes at least one system, even past the budget", function() {
    let pages = scorePages(twoSystems(), {height: 500, budget: 1})
    expect(pages.length).toEqual(2)
    expect(pages.every(page => page.bands.length == 1)).toBe(true)
  })
})

describe("barOverlays", function() {
  let page = scorePages(twoSystems(), {height: 500, budget: 1000})[0]

  it("gives each bar's box as a fraction of the page's own width and height", function() {
    let overlays = barOverlays(page, 200)
    expect(overlays.length).toEqual(8)

    let first = overlays.find(o => o.number == 1)
    let band0 = systemBands(twoSystems())[0]
    expect(first.left).toEqual(0)
    expect(first.width).toEqual(50 / 200)
    expect(first.top).toEqual(band0.top / 500)
    expect(first.height).toEqual((band0.bottom - band0.top) / 500)
  })

  it("gives a split bar's two positions their own overlays, sharing one number", function() {
    let split = [...twoSystems(), {index: 8, number: 4, box: {x: 200, y: 300, width: 50, height: 80}}]
    let splitPage = scorePages(split, {height: 500, budget: 1000})[0]
    let overlays = barOverlays(splitPage, 250).filter(o => o.number == 4)
    expect(overlays.length).toEqual(2)
    expect(overlays.map(o => o.top)).not.toEqual([overlays[0].top, overlays[0].top])
  })
})

describe("pageOfBar", function() {
  it("gives the page index holding a bar number, null for none", function() {
    let pages = scorePages(twoSystems(), {height: 500, budget: 150})
    expect(pageOfBar(pages, 1)).toEqual(0)
    expect(pageOfBar(pages, 5)).toEqual(1)
    expect(pageOfBar(pages, 99)).toEqual(null)
  })
})

describe("scorePages with a real engine draw", function() {
  let bundle

  beforeAll(async function() {
    bundle = await loadScoreEngines()
  })

  it("paginates a 16-bar score drawn by OSMD into whole, contiguous systems covering every bar", async function() {
    let result = await bundle.ENGINES.osmd.renderCard({
      musicXML: sixteenBarScore(), hand: "both", width: ENGRAVE_MAX_WIDTH,
    })
    expect(result.measures.length).toEqual(16)

    let bands = systemBands(result.measures)
    expect(bands.length).toBeGreaterThan(1)

    let height = result.svg.height.baseVal.value
    let pages = scorePages(result.measures, {height, budget: 1000})
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0].top).toEqual(0)
    expect(pages[pages.length - 1].bottom).toEqual(height)

    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].top).toEqual(pages[i - 1].bottom)
    }

    let numbers = pages.flatMap(page => page.measures.map(m => m.number)).sort((a, b) => a - b)
    expect(numbers).toEqual(Array.from({length: 16}, (_, i) => i + 1))

    // a small budget still gives every page at least one system
    let tightPages = scorePages(result.measures, {height, budget: 1})
    expect(tightPages.every(page => page.bands.length >= 1)).toBe(true)
    expect(tightPages.length).toBeGreaterThanOrEqual(bands.length)
  })
})
