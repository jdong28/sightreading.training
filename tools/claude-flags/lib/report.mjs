// The records of a run: run.json (rewritten after every piece, so an
// interrupted run is still a faithful one), the per-piece files, usage summed
// over every model, the price a run is held to, and the summary table.

import {mkdirSync, readFileSync, renameSync, writeFileSync, existsSync} from "node:fs"
import {dirname} from "node:path"

export const COST_NOTE =
  "API-equivalent list price; on a Claude subscription this counts against your plan's usage and is not billed."

/**
 * Writes a file whole or not at all: a crash never leaves half of it.
 * @param {string} path
 * @param {string} text
 */
export function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), {recursive: true})
  let temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, text)
  renameSync(temp, path)
}

export function writeJson(path, data) {
  writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`)
}

export function readJson(path) {
  if (!existsSync(path)) { return null }
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    return null
  }
}

const ADDED = ["in", "cacheWrite", "cacheRead", "out", "costUsd"]

/**
 * The usage of every piece summed per model.
 * @param {Object[]} pieces run.json piece entries
 * @returns {Object} {model: {in, cacheWrite, cacheRead, out, costUsd}}
 */
export function sumByModel(pieces) {
  let totals = {}
  for (let piece of pieces) {
    for (let [model, row] of Object.entries(piece.usage || {})) {
      let into = totals[model] || (totals[model] = Object.fromEntries(ADDED.map(key => [key, 0])))
      for (let key of ADDED) { into[key] += row[key] || 0 }
    }
  }
  return totals
}

export function totalsOf(pieces) {
  return {
    costUsd: Math.round(pieces.reduce((sum, piece) => sum + (piece.costUsd || 0), 0) * 10000) / 10000,
    durationMs: pieces.reduce((sum, piece) => sum + (piece.durationMs || 0), 0),
    byModel: sumByModel(pieces),
  }
}

// the tokens of the models whose name has `family` in it, as one row
function familyRow(usage, family) {
  let row = {in: 0, cacheWrite: 0, cacheRead: 0, out: 0}
  for (let [model, counts] of Object.entries(usage || {})) {
    if (!model.toLowerCase().includes(family)) { continue }
    for (let key of Object.keys(row)) { row[key] += counts[key] || 0 }
  }
  return row
}

const thousands = value => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)

export function minutesText(ms) {
  let seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`
}

/**
 * The table printed at the end of a run: one row per piece, then the totals.
 * @param {Object} run run.json's content
 * @returns {string}
 */
export function summaryTable(run) {
  let header = ["piece", "status", "bars", "flags", "turns", "opus in/cached/out", "haiku in", "$", "time"]
  let rows = run.pieces.map(piece => {
    let opus = familyRow(piece.usage, "opus")
    let haiku = familyRow(piece.usage, "haiku")
    let flags = piece.flags ? `${piece.flags.kept}/${piece.flags.proposed}` : "-"
    return [
      piece.title || piece.input, piece.status + (piece.reason ? ` (${piece.reason})` : ""),
      piece.bars == null ? "-" : String(piece.bars), flags, piece.turns == null ? "-" : String(piece.turns),
      `${thousands(opus.in + opus.cacheWrite)}/${thousands(opus.cacheRead)}/${thousands(opus.out)}`,
      thousands(haiku.in + haiku.cacheWrite + haiku.cacheRead),
      (piece.costUsd || 0).toFixed(2), piece.durationMs ? minutesText(piece.durationMs) : "-",
    ]
  })

  let opusTotal = familyRow(run.totals.byModel, "opus")
  let haikuTotal = familyRow(run.totals.byModel, "haiku")
  rows.push([
    "total", "", "", "", "",
    `${thousands(opusTotal.in + opusTotal.cacheWrite)}/${thousands(opusTotal.cacheRead)}/${thousands(opusTotal.out)}`,
    thousands(haikuTotal.in + haikuTotal.cacheWrite + haikuTotal.cacheRead),
    run.totals.costUsd.toFixed(2), minutesText(run.totals.durationMs),
  ])

  let widths = header.map((cell, col) => Math.max(cell.length, ...rows.map(row => row[col].length)))
  let line = row => row.map((cell, col) => cell.padEnd(widths[col])).join("  ").trimEnd()
  return [line(header), line(widths.map(width => "-".repeat(width))), ...rows.map(line), "", COST_NOTE].join("\n")
}

/**
 * What a piece is expected to cost and take, from the size of what is sent
 * (Appendix B of the plan: notation runs about one token to the character).
 * @param {number} tokens the score and instructions
 * @param {boolean} web
 * @returns {{costUsd: number, minutes: [number, number]}}
 */
export function estimatePiece(tokens, web) {
  let fresh = tokens + (web ? 11000 : 3000)
  let turns = web ? 8 : 1
  let output = web ? 10000 : 8000
  let cost = fresh * 8e-6 + (turns - 1) * fresh * 0.4e-6 + output * 20e-6 + (web ? 0.05 : 0)
  return {costUsd: Math.round(cost * 100) / 100, minutes: web ? [4, 6] : [3, 4]}
}
