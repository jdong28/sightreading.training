
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

const clefXML = (staff, sign, line) =>
  `<clef number="${staff}"><sign>${sign}</sign><line>${line}</line></clef>`

// A one measure 4/4 piano piece: the upper staff in treble clef holds E5, and
// the lower staff, opening in bass clef, plays a quarter note [step, octave]
// on each beat of lower, where a ["clef", sign, line] entry changes its clef
export const midMeasureClefScore = lower => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Mid-Measure Clef</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clefXML(1, "G", 2)}${clefXML(2, "F", 4)}</attributes>
      ${noteXML("E", 5, 4, 1)}
      <backup><duration>4</duration></backup>
      ${lower.map(([a, b, c]) => a == "clef" ? `<attributes>${clefXML(2, b, c)}</attributes>` : noteXML(a, b, 1, 2)).join("")}
    </measure>
  </part>
</score-partwise>`

// A one measure 4/4 piano piece in F major whose upper staff holds a C5
// tied across the second beat, where the lower staff alone strikes an E2. A
// treble staff drops that beat's column whole, so the head the tie runs on to
// is drawn ahead of the column after it, leading its bar
export const tiedLeadScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Tied Lead</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clefXML(1, "G", 2)}${clefXML(2, "F", 4)}</attributes>
      ${noteXML("C", 5, 1, 1, '<tie type="start"/><voice>1</voice><type>quarter</type><notations><tied type="start"/></notations>')}
      ${noteXML("C", 5, 1, 1, '<tie type="stop"/><voice>1</voice><type>quarter</type><notations><tied type="stop"/></notations>')}
      ${noteXML("C", 5, 1, 1, "<voice>1</voice><type>quarter</type>")}
      ${noteXML("C", 5, 1, 1, "<voice>1</voice><type>quarter</type>")}
      <backup><duration>4</duration></backup>
      <note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      ${noteXML("E", 2, 1, 2, "<voice>2</voice><type>quarter</type>")}
      <note><rest/><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

// A one measure 4/4 piano piece in F major written treble over bass: the right
// hand rests the bar out while the left hand plays the eighth note ostinato
// A3 B3 C4 D4 C4 B3 A3 B3 in one voice over a held D3 in another. On the bass
// staff that ostinato runs above the middle line, where the middle line alone
// would stem it down, and its up stems reach off the top of the staff
export const bassOstinatoScore = () => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Bass Ostinato</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clefXML(1, "G", 2)}${clefXML(2, "F", 4)}</attributes>
      <note print-object="no"><rest measure="yes"/><duration>8</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      ${[["A", 3], ["B", 3], ["C", 4], ["D", 4], ["C", 4], ["B", 3], ["A", 3], ["B", 3]]
        .map(([step, octave]) => noteXML(step, octave, 1, 2, "<voice>5</voice><type>eighth</type>")).join("")}
      <backup><duration>8</duration></backup>
      ${noteXML("D", 3, 8, 2, "<voice>6</voice><type>whole</type>")}
    </measure>
  </part>
</score-partwise>`

// A 4/4 piano piece of four measures, each a whole note on both staves: the
// upper staff in treble clef plays upper; the lower staff plays notes, one
// [step, octave] (or a chord of them) a measure, opening in clefs[0] and
// changing to clefs[1] from measure 3. By
// default it opens in bass clef with C3 and E3 and changes to treble clef for
// C4 and E4, under E5
export const clefChangeScore = ({
  clefs=[["F", 4], ["G", 2]],
  notes=[["C", 3], ["E", 3], ["C", 4], ["E", 4]],
  upper=["E", 5],
}={}) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Clef Change</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${notes.map((lower, idx) => `<measure number="${idx + 1}">
      ${idx == 0 ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clefXML(1, "G", 2)}${clefXML(2, ...clefs[0])}</attributes>` : ""}
      ${idx == 2 ? `<attributes>${clefXML(2, ...clefs[1])}</attributes>` : ""}
      ${noteXML(upper[0], upper[1], 4, 1)}
      <backup><duration>4</duration></backup>
      ${(Array.isArray(lower[0]) ? lower : [lower])
        .map(([step, octave], chordIdx) => noteXML(step, octave, 4, 2, chordIdx ? "<chord/>" : "")).join("")}
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
