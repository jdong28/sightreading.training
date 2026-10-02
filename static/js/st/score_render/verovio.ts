// The card contract drawn by Verovio (LGPL-3.0-or-later). Its distributed
// modules are loaded unmodified, as their own files next to this bundle (see
// dev/esbuild_options.mjs and static/Tupfile), never bundled into the app.
// Verovio keeps each MusicXML note's id as the id of the note it draws, so
// the drawn heads are found by the ids card_source tagged them with

import {prepareCard} from "./card_source"
import type {CardOptions, SystemOptions, CardResult, CardNote, CardMeasure, ScoreEngine} from "./types"

export const VEROVIO_VERSION = "6.3.0"

// the files copied beside the engines bundle, loaded by URL at runtime
export const VEROVIO_FILES = ["verovio-module.mjs", "verovio.mjs"]

// Verovio's staff space is 2 units of 9px at scale 100: 44 draws it at the
// same 8px as OSMD's (st/score_render/osmd)
const SCALE = 44
// Verovio's page height limit, so a card of any length stays on one page
const PAGE_HEIGHT = 60000
const MARGIN = 20
// the brace is drawn left of the system, into the page margin
const MARGIN_LEFT = 50

interface Toolkit {
  setOptions(options: object): void
  loadData(data: string): boolean
  select(selection: object): boolean
  redoLayout(options?: object): void
  renderToSVG(page: number): string
}

let toolkitPromise: Promise<Toolkit> | null = null

function loadToolkit(): Promise<Toolkit> {
  if (!toolkitPromise) {
    const moduleURL = new URL("verovio-module.mjs", import.meta.url).href
    const toolkitURL = new URL("verovio.mjs", import.meta.url).href
    toolkitPromise = Promise.all([import(moduleURL), import(toolkitURL)])
      .then(async ([wasm, toolkit]) => {
        const module = await wasm.default()
        return new toolkit.VerovioToolkit(module) as Toolkit
      })
    toolkitPromise.catch(() => { toolkitPromise = null })
  }
  return toolkitPromise
}

let loadedXML: string | null = null

// Verovio's g.measure elements are, in DOM order, exactly the selected
// positions firstIndex..lastIndex; a measure's box is the union of its
// staves' lines (g.staff > path). Measured with the svg briefly attached
// offscreen, the way OSMD's own host stays, since getBoundingClientRect
// needs real layout; Verovio's root has no viewBox, so its drawn size is
// already in the same CSS pixels the rects come back in.
function measureBoxes(svg: SVGSVGElement, card: {firstIndex: number, numbers: number[]}): CardMeasure[] {
  const host = document.createElement("div")
  Object.assign(host.style, {
    position: "absolute", left: "-100000px", top: "0", visibility: "hidden",
  })
  host.appendChild(svg)
  document.body.appendChild(host)

  try {
    const rootRect = svg.getBoundingClientRect()
    const measures: CardMeasure[] = []

    Array.from(svg.querySelectorAll<SVGGElement>("g.measure")).forEach((measureEl, position) => {
      const lines = Array.from(measureEl.querySelectorAll<SVGPathElement>("g.staff > path"))
      if (!lines.length) { return }

      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      for (const line of lines) {
        const rect = line.getBoundingClientRect()
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
      }

      const idx = card.firstIndex + position
      measures.push({
        index: idx,
        number: card.numbers[idx] ?? idx + 1,
        box: {x: left - rootRect.left, y: top - rootRect.top, width: right - left, height: bottom - top},
      })
    })

    return measures
  } finally {
    host.removeChild(svg)
    document.body.removeChild(host)
  }
}

// the widest page Verovio lays out, which a system drawn on one line shrinks
// to the width of its music
const SYSTEM_PAGE_WIDTH = 100000

// Draws the range to the page width given, or with none on one system as
// wide as its music
async function draw(opts: SystemOptions, width: number | null): Promise<CardResult> {
  const card = prepareCard(opts.musicXML, opts)
  const tk = await loadToolkit()

  tk.setOptions({
    scale: SCALE,
    pageWidth: width == null ? SYSTEM_PAGE_WIDTH : Math.floor(width * 100 / SCALE),
    adjustPageWidth: width == null,
    pageHeight: PAGE_HEIGHT,
    adjustPageHeight: true,
    pageMarginLeft: MARGIN_LEFT, pageMarginRight: MARGIN,
    pageMarginTop: MARGIN, pageMarginBottom: MARGIN,
    header: "none", footer: "none",
    breaks: width == null ? "none" : "auto",
    svgViewBox: false,
    svgHtml5: true,
  })

  if (card.xml != loadedXML) {
    loadedXML = null
    if (!tk.loadData(card.xml)) {
      throw new Error("Verovio couldn't read the score")
    }
    loadedXML = card.xml
  }

  // Verovio numbers the range by position, 1-based
  tk.select({measureRange: `${card.firstIndex + 1}-${card.lastIndex + 1}`})
  tk.redoLayout()

  const host = document.createElement("div")
  host.innerHTML = tk.renderToSVG(1)
  const svg = host.querySelector("svg")
  if (!svg) {
    throw new Error("Verovio drew nothing")
  }

  const notes: CardNote[] = []
  for (const el of Array.from(svg.querySelectorAll<SVGGElement>("g.note"))) {
    const source = card.notes.get(el.getAttribute("data-id") || el.id)
    if (!source) { continue }
    notes.push({...source, el})
  }

  const measures = measureBoxes(svg, card)

  return {svg, notes, measures}
}

function renderCard(opts: CardOptions): Promise<CardResult> {
  return draw(opts, opts.width)
}

function renderSystem(opts: SystemOptions): Promise<CardResult> {
  return draw(opts, null)
}

export const verovio: ScoreEngine = {
  name: "Verovio",
  version: VEROVIO_VERSION,
  licence: "LGPL-3.0-or-later",
  renderCard,
  renderSystem,
}

export function verovioReady(): Promise<unknown> {
  return loadToolkit()
}
