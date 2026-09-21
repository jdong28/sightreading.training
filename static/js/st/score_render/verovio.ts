// The card contract drawn by Verovio (LGPL-3.0-or-later). Its distributed
// modules are loaded unmodified, as their own files next to this bundle (see
// dev/esbuild_options.mjs and static/Tupfile), never bundled into the app.
// Verovio keeps each MusicXML note's id as the id of the note it draws, so
// the drawn heads are found by the ids card_source tagged them with

import {prepareCard} from "./card_source"
import type {CardOptions, CardResult, CardNote, ScoreEngine} from "./types"

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

async function renderCard(opts: CardOptions): Promise<CardResult> {
  const card = prepareCard(opts.musicXML, opts)
  const tk = await loadToolkit()

  tk.setOptions({
    scale: SCALE,
    pageWidth: Math.floor(opts.width * 100 / SCALE),
    pageHeight: PAGE_HEIGHT,
    adjustPageHeight: true,
    pageMarginLeft: MARGIN_LEFT, pageMarginRight: MARGIN,
    pageMarginTop: MARGIN, pageMarginBottom: MARGIN,
    header: "none", footer: "none",
    breaks: "auto",
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

  return {svg, notes}
}

export const verovio: ScoreEngine = {
  name: "Verovio",
  version: VEROVIO_VERSION,
  licence: "LGPL-3.0-or-later",
  renderCard,
}

export function verovioReady(): Promise<unknown> {
  return loadToolkit()
}
