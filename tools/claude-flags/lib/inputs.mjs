// What a run reads: MusicXML files (.musicxml, .xml, .mxl), a folder of
// them, or a library export. From a library only each piece and its source
// are read, never its practice items, reviews or sessions: nothing of the
// owner's playing leaves the machine.

import {readFileSync, readdirSync, statSync} from "node:fs"
import {basename, extname, join} from "node:path"
import {gunzipSync} from "node:zlib"

const SCORE_EXTENSIONS = [".musicxml", ".xml", ".mxl"]

// the gzip bytes of a library source, as text, or null
function sourceText(source) {
  try {
    if (!source || source.encoding != "gzip" || typeof source.data != "string") { return null }
    return gunzipSync(Buffer.from(source.data, "base64")).toString("utf8")
  } catch (e) {
    return null
  }
}

/**
 * The pieces a library export holds, with their sources.
 * @param {string} path
 * @param {Object} data the parsed library
 * @returns {Object[]} inputs, each {id, label, kind: "piece", title, fileName, song, source}
 */
export function libraryInputs(path, data) {
  let sources = new Map()
  for (let source of Array.isArray(data.sources) ? data.sources : []) {
    sources.set(source.pieceId, sourceText(source))
  }

  return (Array.isArray(data.pieces) ? data.pieces : []).map(piece => ({
    id: `${path}#${piece.id}`,
    label: piece.title,
    pieceId: piece.id,
    kind: "piece",
    title: piece.title,
    fileName: piece.fileName || "",
    song: piece.song,
    source: sources.get(piece.id) || null,
  }))
}

function fileInput(path) {
  return {
    id: path,
    label: basename(path),
    kind: "musicxml",
    fileName: basename(path),
    base64: readFileSync(path).toString("base64"),
  }
}

/**
 * Reads the inputs a run was given.
 * @param {string[]} paths files, folders or library exports
 * @param {Object} opts {pieces: ids or titles to keep from a library}
 * @returns {{inputs: Object[], errors: string[]}}
 */
export function collectInputs(paths, {pieces = []} = {}) {
  let inputs = []
  let errors = []

  for (let path of paths) {
    let info
    try {
      info = statSync(path)
    } catch (e) {
      errors.push(`${path}: no such file or folder`)
      continue
    }

    if (info.isDirectory()) {
      let names = readdirSync(path).filter(name => SCORE_EXTENSIONS.includes(extname(name).toLowerCase())).sort()
      if (!names.length) { errors.push(`${path}: no MusicXML files in this folder`) }
      for (let name of names) { inputs.push(fileInput(join(path, name))) }
      continue
    }

    let extension = extname(path).toLowerCase()
    if (SCORE_EXTENSIONS.includes(extension)) {
      inputs.push(fileInput(path))
    } else if (extension == ".json") {
      let data
      try {
        data = JSON.parse(readFileSync(path, "utf8"))
      } catch (e) {
        errors.push(`${path}: not a library export`)
        continue
      }

      let found = libraryInputs(path, data)
      if (!found.length) { errors.push(`${path}: this library holds no pieces`) }
      inputs.push(...found.filter(input => !pieces.length ||
        pieces.some(wanted => wanted == input.pieceId || wanted.toLowerCase() == String(input.title).toLowerCase())))
    } else {
      errors.push(`${path}: not a MusicXML file, a folder or a library export`)
    }
  }

  return {inputs, errors}
}

/**
 * A file-name-safe name for a piece, unique among those taken.
 * @param {string} title
 * @param {Set<string>} taken slugs already used (the result is added)
 * @returns {string}
 */
export function slugFor(title, taken) {
  let base = String(title).normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "piece"

  let slug = base
  for (let n = 2; taken.has(slug); n++) { slug = `${base}-${n}` }
  taken.add(slug)
  return slug
}
