
import * as React from "react"
import { createRoot } from "react-dom/client";
import {deleteDB} from "idb"
import {LocalStore} from "st/storage"

let root = null

export const getRoot = () => {
  if (!root) {
    const el = document.getElementById("react_root")
    if (!el) {
      throw new Error("Failed to find react_root element on the page")
    }
    root = createRoot(el)
  }

  return root
}

// the keyCounter ensures that a full re-render happens on every call even if
// the component is shared
let keyCounter = 0
export const render = (...args) => {
  getRoot().render(React.createElement(React.Fragment, {key: `key-${keyCounter++}`}, ...args))
}


// localStorage stand in, so specs never touch the real one
export class MemoryStorage {
  constructor(items={}) {
    this.items = {...items}
  }

  getItem(key) {
    return key in this.items ? this.items[key] : null
  }

  setItem(key, value) {
    this.items[key] = String(value)
  }

  removeItem(key) {
    delete this.items[key]
  }
}

export const TEST_DB_NAME = "sightreading-specs"

// A ready local store on the specs' own database, emptied first unless keep
// is set (eg. to reopen what a spec wrote). Close it after the spec, or the
// next spec can't empty the database
export async function openTestStore({keep=false, ...opts}={}) {
  if (!keep) {
    await deleteDB(TEST_DB_NAME)
  }

  let store = new LocalStore({name: TEST_DB_NAME, localStorage: new MemoryStorage(), ...opts})
  await store.init()
  return store
}

export const noteXML = (step, octave, duration, staff, extra="") => `
<note>
  <pitch><step>${step}</step><octave>${octave}</octave></pitch>
  <duration>${duration}</duration>
  <staff>${staff}</staff>
  ${extra}
</note>`

// A 3/4 piano minuet opening with a one beat pickup, numbered like a score:
//   pickup (0): treble D5
//   1: treble G4 A4 B4, bass G3 (dotted half)
//   2: treble C5 (dotted half), bass C3 E3 G3 chord (dotted half)
export const pickupScore = ({title="Pickup Minuet", clefs=[["G", 2], ["F", 4]]}={}) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${title ? `<work><work-title>${title}</work-title></work>` : ""}
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>1</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        ${clefs.map(([sign, line], idx) =>
          `<clef number="${idx + 1}"><sign>${sign}</sign><line>${line}</line></clef>`).join("")}
      </attributes>
      ${noteXML("D", 5, 1, 1)}
    </measure>
    <measure number="1">
      ${noteXML("G", 4, 1, 1)}
      ${noteXML("A", 4, 1, 1)}
      ${noteXML("B", 4, 1, 1)}
      <backup><duration>3</duration></backup>
      ${noteXML("G", 3, 3, 2)}
    </measure>
    <measure number="2">
      ${noteXML("C", 5, 3, 1)}
      <backup><duration>3</duration></backup>
      ${noteXML("C", 3, 3, 2)}
      ${noteXML("E", 3, 3, 2, "<chord/>")}
      ${noteXML("G", 3, 3, 2, "<chord/>")}
    </measure>
  </part>
</score-partwise>`
