
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

// The opening of Debussy's Rêverie as MuseScore 4 exports it, measures 1–4
// with layout, beams, slurs and directions left out. F major, 4/4, divisions
// 6, both staves in treble clef:
//   1: two beats of hidden rests on both staves, no notes
//   2, 3: hidden whole measure rest on staff 1; on staff 2 voice 5 plays the
//     eighth note ostinato Bb3 C4 D4 G4~G4 D4 C4 Bb3~ (the last tied into the
//     next measure) over a whole note Bb3 in voice 6
//   4: staff 1 G5 (half), D5 (half, tied on); staff 2 the ostinato only
export const reverieOpening = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Rêverie</work-title></work>
  <part-list>
    <score-part id="P1"><part-name print-object="no">Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      <note print-object="no"><rest/><duration>12</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>12</duration></backup>
      <note print-object="no"><rest/><duration>12</duration><voice>5</voice><type>half</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note print-object="no"><rest measure="yes"/><duration>24</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><tie type="start"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><tie type="stop"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="stop"/></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>3</duration><tie type="start"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="start"/></notations></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>24</duration><voice>6</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="3">
      <note print-object="no"><rest measure="yes"/><duration>24</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>3</duration><tie type="stop"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="stop"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><tie type="start"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><tie type="stop"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="stop"/></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>3</duration><tie type="start"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="start"/></notations></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>24</duration><voice>6</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="4">
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>12</duration><tie type="start"/><voice>1</voice><type>half</type><staff>1</staff><notations><tied type="start"/></notations></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>3</duration><tie type="stop"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="stop"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><tie type="start"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><tie type="stop"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="stop"/></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>3</duration><tie type="start"/><voice>5</voice><type>eighth</type><staff>2</staff><notations><tied type="start"/></notations></note>
    </measure>
  </part>
</score-partwise>`

// Bars 5–6 of Chopin's Nocturne in C♯ minor as MuseScore Studio 4 exports it,
// with layout, beams, slurs, pedal marks and directions left out and the
// divisions brought down from 360360 to 2 (it reads as measures 1–2). C♯
// minor (four sharps), 4/4, both staves:
//   5: staff 1 voice 1 G#5 (half), then F#5 (half) under a trill mark; staff 2
//     voice 5 the eighths C#3 G#3 E4 C#4 C#3 A3 D#4 C#4
//   6: staff 1 the slashed grace notes E5 F#5 into G#5 (half), then C#5
//     (half); staff 2 the eighths C#3 G#3 E4 C#4 twice
export const nocturneBars5to6 = () => {
  let pitch = (step, alter, octave) =>
    `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`
  let half = (step, alter, octave, notations="") =>
    `<note>${pitch(step, alter, octave)}<duration>4</duration><voice>1</voice><type>half</type><staff>1</staff>${notations}</note>`
  let grace = (step, alter, octave) =>
    `<note><grace slash="yes"/>${pitch(step, alter, octave)}<voice>1</voice><type>eighth</type><staff>1</staff></note>`
  let eighths = pitches => pitches.map(([step, alter, octave]) =>
    `<note>${pitch(step, alter, octave)}<duration>1</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>`).join("\n      ")

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Nocturne in C sharp Minor</work-title></work>
  <part-list>
    <score-part id="P1"><part-name print-object="no">Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="5">
      <attributes><divisions>2</divisions><key><fifths>4</fifths></key><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${half("G", 1, 5)}
      ${half("F", 1, 5, "<notations><ornaments><trill-mark/><wavy-line type=\"start\" number=\"1\"/><wavy-line type=\"stop\" number=\"1\"/></ornaments></notations>")}
      <backup><duration>8</duration></backup>
      ${eighths([["C", 1, 3], ["G", 1, 3], ["E", 0, 4], ["C", 1, 4], ["C", 1, 3], ["A", 0, 3], ["D", 1, 4], ["C", 1, 4]])}
    </measure>
    <measure number="6">
      ${grace("E", 0, 5)}
      ${grace("F", 1, 5)}
      ${half("G", 1, 5)}
      ${half("C", 1, 5)}
      <backup><duration>8</duration></backup>
      ${eighths([["C", 1, 3], ["G", 1, 3], ["E", 0, 4], ["C", 1, 4], ["C", 1, 3], ["G", 1, 3], ["E", 0, 4], ["C", 1, 4]])}
    </measure>
  </part>
</score-partwise>`
}

// Two 4/4 bars in C major whose right hand holds C5 tied across the barline,
// over the left hand's quarters G3 A3 B3 C4 in each bar. The trill is written
// on the continuation in bar 2, or with span on bar 1's note, its wavy line
// running from there to the continuation
export const tiedTrillScore = ({span=false}={}) => {
  let quarters = () => ["G", "A", "B", "C"].map((step, idx) =>
    noteXML(step, idx == 3 ? 4 : 3, 1, 2, "<voice>5</voice>")).join("")

  let ornaments = marks => `<notations><ornaments>${marks}</ornaments></notations>`
  let wavy = type => `<wavy-line type="${type}" number="1"/>`
  let tie = type => `<voice>1</voice><tie type="${type}"/>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${noteXML("C", 5, 4, 1, tie("start") + (span ? ornaments(`<trill-mark/>${wavy("start")}`) : ""))}
      <backup><duration>4</duration></backup>
      ${quarters()}
    </measure>
    <measure number="2">
      ${noteXML("C", 5, 4, 1, tie("stop") + ornaments(span ? wavy("stop") : "<trill-mark/>"))}
      <backup><duration>4</duration></backup>
      ${quarters()}
    </measure>
  </part>
</score-partwise>`
}

// A 4/4 single staff piece of four whole notes in the given key signatures
// (in fifths): the first key from measure 1, the second, if any, from
// measure 3
export const keyChangeScore = ({title="Key Change", keys=[-1, 4]}={}) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    ${[1, 2, 3, 4].map(number => `<measure number="${number}">
      ${number == 1 ? `<attributes><divisions>1</divisions><key><fifths>${keys[0]}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : ""}
      ${number == 3 && keys.length > 1 ? `<attributes><key><fifths>${keys[1]}</fifths></key></attributes>` : ""}
      ${noteXML("A", 5, 4, 1)}
    </measure>`).join("\n    ")}
  </part>
</score-partwise>`

// A one measure 3/4 waltz with no title of its own, E5 G4 C5 in quarter notes,
// as the uncompressed MusicXML text of LITTLE_WALTZ_MXL
export const LITTLE_WALTZ_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<score-partwise version=\"4.0\">\n  <part-list><score-part id=\"P1\"><part-name>Piano</part-name></score-part></part-list>\n  <part id=\"P1\">\n    <measure number=\"1\">\n      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>\n      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>\n      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>\n      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>\n    </measure>\n  </part>\n</score-partwise>"

// LITTLE_WALTZ_XML compressed as a .mxl file by Info-ZIP (zip -X -9): its
// META-INF/container.xml names Little_Waltz.musicxml as the score, stored
// after decoy.xml, a first entry that isn't the score
export const LITTLE_WALTZ_MXL_BASE64 =
  "UEsDBBQAAgAIAPWZNF0NbMdriwAAALYAAAAWAAAATUVUQS1JTkYvY29udGFpbmVyLnhtbE3OsQ7CMAwE0J2viLyiNrAxJO3GxAhi" +
  "RFbigqU0iRK3Ar6eslC2G+70zvTPMaiZSuUULezbHSiKLnmOdwuX87E5QN9tjEtRkCOVzpSUZOBAdY1qmEJoMsrDwolFAt2uGOTd" +
  "jlNltwigRvKMjbwyWcCcAzuUhdRz9G0hl4rHQr/+9rvRndF/mF4/fABQSwMECgACAAAA9Zk0XYshJsMLAAAACwAAAAkAAABkZWNv" +
  "eS54bWxub3QgYSBzY29yZVBLAwQUAAIACAD1mTRdicPvCDIBAAAbAwAAFQAAAExpdHRsZV9XYWx0ei5tdXNpY3htbL1SsVLDMAzd" +
  "+xW57MEtlDsGVR046NoBPsBN1FbXxA62E+jfo9gpKdyxdpL0JD096QTrr6bOenKerVnli7t5npEpbcXmsMrf316Lp3yNM/CldVS0" +
  "2oVP9jQ1LKUBZ1kGQ6qo2Qe8qs24WuXbRY4pbXRDuGVtLKgJADU14JiIRBfaHxYBBGpI+85RZrpmR040jwlJ6RAc77pAHqHingeN" +
  "HhegpgBOdEbY8z4cPc5BjR6oiAceBO1IB48PoJIT4yKcW8JlwlIAKpWXNe1laz4Y3Mgyg4WaDeE9qGhBpRJ1pe8i2dggBS2H8igc" +
  "gVp8EY7Bgi2D7gkfQY2eHCfVVZ3TQdaJq1186C2XNEDJgSjyo5MLkhOtSXKc9//wzZ/hy1sOf77R5qDGH4ovFj9OXlz9/nH8BlBL" +
  "AQIeAxQAAgAIAPWZNF0NbMdriwAAALYAAAAWAAAAAAAAAAEAAACkgQAAAABNRVRBLUlORi9jb250YWluZXIueG1sUEsBAh4DCgAC" +
  "AAAA9Zk0XYshJsMLAAAACwAAAAkAAAAAAAAAAQAAAKSBvwAAAGRlY295LnhtbFBLAQIeAxQAAgAIAPWZNF2Jw+8IMgEAABsDAAAV" +
  "AAAAAAAAAAEAAACkgfEAAABMaXR0bGVfV2FsdHoubXVzaWN4bWxQSwUGAAAAAAMAAwC+AAAAVgIAAAAA"

// the bytes of LITTLE_WALTZ_MXL_BASE64, as a picked file reads
export const littleWaltzMXL = () => Uint8Array.from(atob(LITTLE_WALTZ_MXL_BASE64), c => c.charCodeAt(0))
