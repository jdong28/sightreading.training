// Verified proposals into the version 2 flags file the app opens, read back
// through the app's own reader before it is trusted.

import {flagsFileFor, readFlagsFile, reanchorProposals, FLAGS_VERSION} from "st/difficulty/flags_file"

/**
 * The flags file for a piece's verified Claude proposals.
 * @param {Object} opts {title, song, fingerprint, proposals, run, at}
 * @returns {Object} the file, ready to JSON.stringify
 */
export function claudeFlagsFile({title, song, fingerprint, proposals, run, at}) {
  let record = {fingerprint, decisions: []}
  let file = flagsFileFor(record, {title}, song, {by: "Claude", at})
  return {...file, version: FLAGS_VERSION, proposals, run}
}

/**
 * Reads a file back as the app will: every proposal must survive the reader
 * and land on the piece's own bars without a move.
 * @returns {{ok: true}|{ok: false, error: string}}
 */
export function selfCheck({file, song, fingerprint}) {
  let {data, error} = readFlagsFile(JSON.stringify(file))
  if (error) { return {ok: false, error: `the app can't read the file: ${error}`} }

  if (data.proposals.length != file.proposals.length) {
    return {ok: false, error: `the app keeps ${data.proposals.length} of ${file.proposals.length} proposals`}
  }

  let record = {fingerprint, proposals: [], decisions: [], runs: {}}
  let {report} = reanchorProposals(data, record, song)
  if (report.placed != file.proposals.length) {
    return {ok: false, error: `${report.placed} of ${file.proposals.length} proposals place on the piece unmoved`}
  }

  let ids = new Set(file.proposals.map(p => p.id))
  if (ids.size != file.proposals.length) { return {ok: false, error: "two proposals share an id"} }

  return {ok: true}
}
