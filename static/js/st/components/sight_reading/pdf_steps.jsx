import * as React from "react"
import * as types from "prop-types"

import {Card} from "st/components/salon"
import styles from "./pdf_steps.module.css"

// What to do with a PDF picked in the deck's Import MusicXML control: the app
// recognises no scores itself, so this points at the owner-run route to a
// MusicXML file (README, "From a PDF").
const AUDIVERIS_URL = "https://audiveris.github.io/audiveris/"
const HOMR_URL = "https://github.com/liebharc/homr"
const SOUNDSLICE_URL = "https://www.soundslice.com/sheet-music-scanner/"
const MUSESCORE_URL = "https://musescore.org/en/download"

export default function PdfSteps({fileName}) {
  let link = (href, text) =>
    <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>

  return <Card warm className={styles.pdf_steps}>
    <div className={styles.title}>PDFs need converting first</div>
    <div className={styles.lead}>
      {`${fileName} is a picture of a score, not notes.`} Nothing
      was added to the deck. Get a MusicXML file in three steps:
    </div>
    <ol className={styles.steps}>
      <li>
        <strong>Convert the PDF.</strong> {link(AUDIVERIS_URL, "Audiveris")} is
        free, runs on your computer and suits digitally engraved PDFs. For
        old scans try {link(HOMR_URL, "homr")} or {link(SOUNDSLICE_URL, "Soundslice")}.
      </li>
      <li>
        <strong>Fix the wrong bars</strong> in {link(MUSESCORE_URL, "MuseScore Studio")}.
        Recognition misreads notes, so correct the bar count, parts and clefs
        first, then the notes, and export as MusicXML (.mxl).
      </li>
      <li>
        <strong>Import the .mxl</strong> with Import MusicXML. Importing it again
        after more fixes keeps the piece's stats only while its title, parts and
        printed bar numbers stay the same, so set the piece's title in MuseScore
        Studio before the first import.
      </li>
    </ol>
  </Card>
}

PdfSteps.propTypes = {
  fileName: types.string.isRequired,
}
