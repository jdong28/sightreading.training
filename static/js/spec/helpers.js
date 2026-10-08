
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
// with the trill written on the continuation in bar 2, over the left hand's
// quarters G3 A3 B3 C4 in each bar
export const tiedTrillScore = () => {
  let quarters = () => ["G", "A", "B", "C"].map((step, idx) =>
    noteXML(step, idx == 3 ? 4 : 3, 1, 2, "<voice>5</voice>")).join("")

  let ornaments = marks => `<notations><ornaments>${marks}</ornaments></notations>`
  let tie = type => `<voice>1</voice><tie type="${type}"/>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${noteXML("C", 5, 4, 1, tie("start"))}
      <backup><duration>4</duration></backup>
      ${quarters()}
    </measure>
    <measure number="2">
      ${noteXML("C", 5, 4, 1, tie("stop") + ornaments("<trill-mark/>"))}
      <backup><duration>4</duration></backup>
      ${quarters()}
    </measure>
  </part>
</score-partwise>`
}

// Two bars of a descending chain of trills in G major (one sharp), 4/4, as
// MuseScore Studio 4.7 exports it, with layout, stems and beams left out: one
// trill line runs from the right hand's E5 across the bar line and a system
// break to its C5. MuseScore writes the trill mark and the line's start on
// the first note and its stop on the last, nothing on the notes between, and
// no <wavy-line type="continue"/> at the system break:
//   1: staff 1 voice 1 E5 (half, trill mark and line start), D5 (half); voice
//     2 G4 (whole); staff 2 voice 5 the eighths G2 D3 B3 D3 twice
//   2 (a new system): staff 1 voice 1 C5 (half, line stop), B4 (half); voice
//     2 F#4 (half), G4 (half); staff 2 voice 5 the eighths D2 A2 F#3 A2 G2 D3
//     B3 D3
export const trillLineScore = () => {
  let pitch = (step, alter, octave) =>
    `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`
  let note = (step, alter, octave, duration, type, voice, staff, notations="") =>
    `<note>${pitch(step, alter, octave)}<duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff>${notations}</note>`
  let half = (step, alter, octave, notations="") => note(step, alter, octave, 4, "half", 1, 1, notations)
  let eighths = pitches => pitches.map(([step, alter, octave]) =>
    note(step, alter, octave, 1, "eighth", 5, 2)).join("\n      ")
  let line = type => `<notations><ornaments>${type == "start" ? "<trill-mark/>" : ""}<wavy-line type="${type}" number="1"/></ornaments></notations>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Trill Line</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${half("E", 0, 5, line("start"))}
      ${half("D", 0, 5)}
      <backup><duration>8</duration></backup>
      ${note("G", 0, 4, 8, "whole", 2, 1)}
      <backup><duration>8</duration></backup>
      ${eighths([["G", 0, 2], ["D", 0, 3], ["B", 0, 3], ["D", 0, 3], ["G", 0, 2], ["D", 0, 3], ["B", 0, 3], ["D", 0, 3]])}
    </measure>
    <measure number="2">
      <print new-system="yes"/>
      ${half("C", 0, 5, line("stop"))}
      ${half("B", 0, 4)}
      <backup><duration>8</duration></backup>
      ${note("F", 1, 4, 4, "half", 2, 1)}
      ${note("G", 0, 4, 4, "half", 2, 1)}
      <backup><duration>8</duration></backup>
      ${eighths([["D", 0, 2], ["A", 0, 2], ["F", 1, 3], ["A", 0, 2], ["G", 0, 2], ["D", 0, 3], ["B", 0, 3], ["D", 0, 3]])}
    </measure>
  </part>
</score-partwise>`
}

// The Nocturne's repeated C#4 (the report's beats 9.5 and 10, see
// sr-note-detection-l3) as one 4/4 bar on two staves: treble G#4 (dotted
// quarter), C#4 (eighth), C#4 (half); bass C#3 (half), G#2 (half). Its
// columns are [C#3, G#4] [C#4] [G#2, C#4]: the eighth C#4 ends as the half is
// struck, so the score doesn't still sound it at the last column
export const repeatedNoteBar = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Repeated Note</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>4</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${[["G", 4, 3, "quarter"], ["C", 4, 1, "eighth"], ["C", 4, 4, "half"]].map(([step, octave, duration, type]) =>
        `<note><pitch><step>${step}</step><alter>1</alter><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${duration == 3 ? "<dot/>" : ""}<staff>1</staff></note>`).join("")}
      <backup><duration>8</duration></backup>
      ${[["C", 3], ["G", 2]].map(([step, octave]) =>
        `<note><pitch><step>${step}</step><alter>1</alter><octave>${octave}</octave></pitch><duration>4</duration><voice>2</voice><type>half</type><staff>2</staff></note>`).join("")}
    </measure>
  </part>
</score-partwise>`

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

// "C4" / "C#4" / "Cb4" -> {step, alter, octave}
function parseNoteName(name) {
  let m = name.match(/^([A-G])(#|b)?(-?\d+)$/)
  if (!m) { throw new Error(`pianoScore: invalid note name '${name}'`) }
  return {step: m[1], alter: m[2] == "#" ? 1 : m[2] == "b" ? -1 : 0, octave: +m[3]}
}

// one <note> (or <note><rest/></note>) for st/difficulty's fixtures. note is
// a note name string (a plain quarter) or an object:
//   {name, duration=1 (beats), type="quarter", dots=0, voice, tuplet: [actual, normal],
//    chord, rest, alter (overrides the name's accidental, for double accidentals),
//    tieStart, tieStop, trill}
function pianoNoteXML(note, divisions, staff, defaultVoice) {
  if (typeof note == "string") { note = {name: note} }

  let {
    duration = 1, type = "quarter", dots = 0, voice = defaultVoice, tuplet,
    chord, rest, tieStart, tieStop, trill, alter,
  } = note

  let parts = []

  if (rest) {
    parts.push("<rest/>")
  } else {
    let {step, alter: nameAlter, octave} = parseNoteName(note.name)
    let a = alter != null ? alter : nameAlter
    parts.push(`<pitch><step>${step}</step>${a ? `<alter>${a}</alter>` : ""}<octave>${octave}</octave></pitch>`)
  }

  parts.push(`<duration>${Math.round(duration * divisions)}</duration>`)
  if (chord) { parts.push("<chord/>") }
  if (tieStart) { parts.push("<tie type=\"start\"/>") }
  if (tieStop) { parts.push("<tie type=\"stop\"/>") }
  parts.push(`<voice>${voice}</voice>`)
  parts.push(`<type>${type}</type>`)
  for (let i = 0; i < dots; i++) { parts.push("<dot/>") }
  parts.push(`<staff>${staff}</staff>`)

  if (tuplet) {
    parts.push(`<time-modification><actual-notes>${tuplet[0]}</actual-notes><normal-notes>${tuplet[1]}</normal-notes></time-modification>`)
  }

  let notations = []
  if (tieStart) { notations.push("<tied type=\"start\"/>") }
  if (tieStop) { notations.push("<tied type=\"stop\"/>") }
  if (trill) { notations.push("<ornaments><trill-mark/></ornaments>") }
  if (notations.length) { parts.push(`<notations>${notations.join("")}</notations>`) }

  return `<note>${parts.join("")}</note>`
}

function pianoDirectionXML(spec) {
  if (spec.metronome) {
    let {unit = "quarter", dot = false, perMinute} = spec.metronome
    return `<direction><direction-type><metronome><beat-unit>${unit}</beat-unit>` +
      `${dot ? "<beat-unit-dot/>" : ""}<per-minute>${perMinute}</per-minute></metronome></direction-type></direction>`
  }
  if (spec.sound != null) {
    return `<direction><sound tempo="${spec.sound}"/></direction>`
  }
  if (spec.words != null) {
    return `<direction><direction-type><words>${spec.words}</words></direction-type></direction>`
  }
  return ""
}

// a hand's content as one or more sequential "voice" layers, each starting
// back at the bar's beginning (a <backup> between layers): [notes] for one
// layer, or {layers: [[notes], [notes], ...]} for several, eg. a held note
// under moving ones, or a real voice beside a rest-only layout voice
function handLayers(hand) {
  if (!hand) { return [] }
  return hand.layers ? hand.layers : [hand]
}

function layersXML(layers, divisions, staff, voice, barBeats) {
  return layers.map((notes, idx) => {
    let backup = idx > 0 ? `<backup><duration>${Math.round(barBeats * divisions)}</duration></backup>` : ""
    let notesXML = notes.map(n => pianoNoteXML(n, divisions, staff, (typeof n == "object" && n.voice) || voice + idx)).join("")
    return `${backup}${notesXML}`
  }).join("")
}

// A piano score for st/difficulty's fixtures, built from a plain description
// (parsed through parseMusicXML like any other import, so the fixtures
// exercise the real importer). bars: [{upper: [...notes], lower: [...notes],
// beats, key, time: [beats, beatType], clef: [[sign,line],[sign,line]],
// directions: [{metronome|sound|words}]}]. "upper"/"lower" can instead be
// {layers: [[...notes], [...notes]]} for more than one voice in that hand.
// A bar without "lower" (or "lowerLayers") writes a one-staff piece (a
// melody).
export function pianoScore({title="Difficulty Fixture", key=0, time=[4, 4], divisions=48, bars=[]}={}) {
  let twoStaves = bars.some(bar => bar.lower)

  let measuresXML = bars.map((bar, idx) => {
    let number = idx + 1
    let barBeats = bar.beats || time[0]

    let attrs = ""
    if (idx == 0 || bar.key != null || bar.time) {
      let fifths = bar.key != null ? bar.key : key
      let [beats, beatType] = bar.time || time
      attrs = `<attributes>${idx == 0 ? `<divisions>${divisions}</divisions>` : ""}` +
        `<key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
        `${idx == 0 && twoStaves ? "<staves>2</staves>" : ""}` +
        `${(bar.clef || (idx == 0 ? (twoStaves ? [["G", 2], ["F", 4]] : [["G", 2]]) : [])).map(([sign, line], i) =>
          `<clef number="${i + 1}"><sign>${sign}</sign><line>${line}</line></clef>`).join("")}</attributes>`
    }

    let directionsXML = (bar.directions || []).map(pianoDirectionXML).join("")
    let upperXML = layersXML(handLayers(bar.upper), divisions, 1, 1, barBeats)
    let lowerXML = twoStaves ?
      `<backup><duration>${Math.round(barBeats * divisions)}</duration></backup>` +
      layersXML(handLayers(bar.lower), divisions, 2, 5, barBeats) : ""

    return `<measure number="${number}">${attrs}${directionsXML}${upperXML}${lowerXML}</measure>`
  }).join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${measuresXML}
  </part>
</score-partwise>`
}

// "Fixture": the 16-bar, grand-staff, C-major piece the score-first sheet
// music plan's artboards and owner-check script use (bars 5-9 flagged
// "Hardest · Wide leaps in the left hand"), copied verbatim from
// tools/fingerings/tests/fixture/score.musicxml so integration specs can
// reproduce the plan's own pagination and learnedness numbers exactly
export const fixtureScore = () => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>Fixture</work-title>
  </work>
  <movement-title>Fixture</movement-title>
  <identification>
    <creator type="composer">Music21</creator>
    <encoding>
      <encoding-date>2026-10-02</encoding-date>
      <software>music21 v.10.5.0</software>
      <supports element="beam" type="yes" />
      <supports element="stem" type="yes" />
      <supports element="accidental" type="yes" />
    </encoding>
  </identification>
  <defaults>
    <scaling>
      <millimeters>7</millimeters>
      <tenths>40</tenths>
    </scaling>
  </defaults>
  <part-list>
    <score-part id="Pbd3499ef06bf38ba406b81d68a59602c">
      <part-name />
    </score-part>
  </part-list>
  <!--=========================== Part 1 ===========================-->
  <part id="Pbd3499ef06bf38ba406b81d68a59602c">
    <!--========================= Measure 1 ==========================-->
    <measure implicit="no" number="1">
      <attributes>
        <divisions>10080</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 2 ==========================-->
    <measure implicit="no" number="2">
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 3 ==========================-->
    <measure implicit="no" number="3">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 4 ==========================-->
    <measure implicit="no" number="4">
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>6</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 5 ==========================-->
    <measure implicit="no" number="5">
      <print new-system="yes" />
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>20160</duration>
        <voice>1</voice>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <chord />
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>20160</duration>
        <voice>1</voice>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <chord />
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>20160</duration>
        <voice>1</voice>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 6 ==========================-->
    <measure implicit="no" number="6">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <chord />
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 7 ==========================-->
    <measure implicit="no" number="7">
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>20160</duration>
        <voice>1</voice>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 8 ==========================-->
    <measure implicit="no" number="8">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 9 ==========================-->
    <measure implicit="no" number="9">
      <print new-page="yes" new-system="yes" />
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>6</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>20160</duration>
        <voice>2</voice>
        <type>half</type>
        <staff>2</staff>
      </note>
      <note>
        <chord />
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>20160</duration>
        <voice>2</voice>
        <type>half</type>
        <staff>2</staff>
      </note>
      <note>
        <chord />
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>20160</duration>
        <voice>2</voice>
        <type>half</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 10 =========================-->
    <measure implicit="no" number="10">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 11 =========================-->
    <measure implicit="no" number="11">
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>6</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 12 =========================-->
    <measure implicit="no" number="12">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 13 =========================-->
    <measure implicit="no" number="13">
      <print new-system="yes" />
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>6</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 14 =========================-->
    <measure implicit="no" number="14">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 15 =========================-->
    <measure implicit="no" number="15">
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>6</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <!--========================= Measure 16 =========================-->
    <measure implicit="no" number="16">
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>10080</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>40320</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>10080</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`
