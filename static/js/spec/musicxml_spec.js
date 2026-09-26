import {zipSync, strToU8} from "fflate"
import {
  parseMusicXML, readMusicXMLFile, MusicXMLError, COMPRESSED_MESSAGE,
  DAMAGED_ARCHIVE_MESSAGE, NO_SCORE_MESSAGE
} from "st/musicxml"
import {SongNote, measureStartsUntil, clickStartsMeasure} from "st/song_note_list"
import {reverieOpening, nocturneBars5to6, tiedTrillScore, LITTLE_WALTZ_XML, littleWaltzMXL} from "spec/helpers"

// [note, start, duration] tuples of a note list, in document order
let tuples = notes => [...notes].map(n => [n.note, n.start, n.duration])

// wraps measure xml into a single part partwise score
let partwise = (measures, opts={}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  ${opts.head || ""}
  <part-list>
    <score-part id="P1"><part-name>${opts.partName || "Piano"}</part-name></score-part>
  </part-list>
  <part id="P1">
    ${measures}
  </part>
</score-partwise>`

let attributes = ({divisions=1, fifths=0, beats=4, beatType=4, staves, clefs=[]}) => `
<attributes>
  <divisions>${divisions}</divisions>
  <key><fifths>${fifths}</fifths></key>
  <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>
  ${staves ? `<staves>${staves}</staves>` : ""}
  ${clefs.map(([number, sign, line]) =>
    `<clef number="${number}"><sign>${sign}</sign><line>${line}</line></clef>`).join("")}
</attributes>`

let note = (step, octave, duration, extra="", alter=null) => `
<note>
  <pitch><step>${step}</step>${alter != null ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>
  <duration>${duration}</duration>
  ${extra}
</note>`

let rest = (duration, extra="") => `<note><rest/><duration>${duration}</duration>${extra}</note>`

describe("musicxml", function() {
  it("imports Rêverie's opening note for note, voices, hidden rests and ties included", function() {
    let song = parseMusicXML(reverieOpening())

    expect(song.metadata.keySignature).toEqual(-1)
    expect(song.metadata.beatsPerMeasure).toEqual(4)
    // measure 1 holds only two beats of hidden rests
    expect(song.metadata.measureStarts).toEqual([0, 2, 6, 10])
    expect(song.metadata.measureNumbers).toEqual([1, 2, 3, 4])
    expect(song.metadata.measureKeySignatures).toEqual([-1, -1, -1, -1])
    expect(song.metadata.measuresEnd).toEqual(14)

    expect(song.tracks.map(t => t.cleffs)).toEqual([[[0, "g"]], [[0, "g"]]])

    // staff 1: G5 and D5 of measure 4
    expect(tuples(song.tracks[0])).toEqual([["G5", 10, 2], ["D5", 12, 2]])

    // staff 2, voice 5's ostinato with each tie merged, then voice 6's whole
    // note, measure by measure
    let ostinato = (start, tiedIn) => [
      ...(tiedIn ? [] : [["Bb3", start, 0.5]]),
      ["C4", start + 0.5, 0.5],
      ["D4", start + 1, 0.5],
      ["G4", start + 1.5, 1],
      ["D4", start + 2.5, 0.5],
      ["C4", start + 3, 0.5],
    ]

    expect(tuples(song.tracks[1])).toEqual([
      ...ostinato(2, false), ["Bb3", 5.5, 1], ["Bb3", 2, 4],
      ...ostinato(6, true), ["Bb3", 9.5, 1], ["Bb3", 6, 4],
      ...ostinato(10, true), ["Bb3", 13.5, 0.5],
    ])
  })

  it("converts a two measure piano piece with both staves", function() {
    // treble: C4 D4 E4 F4 | G4 (whole)
    // bass:   C3 (half) G3 (half) | C3 (whole)
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 2, staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
        ${note("C", 4, 2, "<voice>1</voice><staff>1</staff>")}
        ${note("D", 4, 2, "<voice>1</voice><staff>1</staff>")}
        ${note("E", 4, 2, "<voice>1</voice><staff>1</staff>")}
        ${note("F", 4, 2, "<voice>1</voice><staff>1</staff>")}
        <backup><duration>8</duration></backup>
        ${note("C", 3, 4, "<voice>2</voice><staff>2</staff>")}
        ${note("G", 3, 4, "<voice>2</voice><staff>2</staff>")}
      </measure>
      <measure number="2">
        ${note("G", 4, 8, "<voice>1</voice><staff>1</staff>")}
        <backup><duration>8</duration></backup>
        ${note("C", 3, 8, "<voice>2</voice><staff>2</staff>")}
      </measure>
    `)

    let song = parseMusicXML(xml)

    expect(song.metadata.keySignature).toEqual(0)
    expect(song.metadata.beatsPerMeasure).toEqual(4)
    expect(song.metadata.measureStarts).toEqual([0, 4])

    expect(song.tracks.length).toEqual(2)

    expect(song.tracks[0].trackName).toEqual("Piano (staff 1)")
    expect(song.tracks[0].cleffs).toEqual([[0, "g"]])
    expect(song.tracks[0].fittingStaff()).toEqual("treble")
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 1],
      ["D4", 1, 1],
      ["E4", 2, 1],
      ["F4", 3, 1],
      ["G4", 4, 4],
    ])

    expect(song.tracks[1].trackName).toEqual("Piano (staff 2)")
    expect(song.tracks[1].cleffs).toEqual([[0, "f"]])
    expect(song.tracks[1].fittingStaff()).toEqual("bass")
    expect(tuples(song.tracks[1])).toEqual([
      ["C3", 0, 2],
      ["G3", 2, 2],
      ["C3", 4, 4],
    ])

    // all notes are also in the song itself
    expect(song.length).toEqual(8)
    expect(song[0]).toEqual(jasmine.any(SongNote))
    expect(song.getStopInBeats()).toEqual(8)
  })

  it("groups chord notes at the same start", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        ${note("C", 4, 2)}
        ${note("E", 4, 2, "<chord/>")}
        ${note("G", 4, 2, "<chord/>")}
        ${note("A", 4, 2)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 2],
      ["E4", 0, 2],
      ["G4", 0, 2],
      ["A4", 2, 2],
    ])
  })

  it("merges a tie across a barline into one note", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        ${note("C", 4, 2)}
        ${note("D", 4, 2, '<tie type="start"/><notations><tied type="start"/></notations>')}
      </measure>
      <measure number="2">
        ${note("D", 4, 1, '<tie type="stop"/><notations><tied type="stop"/></notations>')}
        ${note("E", 4, 3)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 2],
      ["D4", 2, 3],
      ["E4", 5, 3],
    ])
  })

  it("chains a tie through a middle note that both stops and starts", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        ${note("C", 4, 4, '<tie type="start"/>')}
      </measure>
      <measure number="2">
        ${note("C", 4, 4, '<tie type="stop"/><tie type="start"/>')}
      </measure>
      <measure number="3">
        ${note("C", 4, 2, '<tie type="stop"/>')}
        ${note("D", 4, 2)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 10],
      ["D4", 10, 2],
    ])
  })

  it("treats a tie stop without a matching start as a normal note", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        ${note("C", 4, 2, '<tie type="stop"/>')}
        ${note("D", 4, 2)}
      </measure>
    `)

    expect(tuples(parseMusicXML(xml).tracks[0])).toEqual([
      ["C4", 0, 2],
      ["D4", 2, 2],
    ])
  })

  it("uses the dotted duration from <duration>", function() {
    // dotted quarter + eighth + half
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 2})}
        ${note("C", 4, 3, "<type>quarter</type><dot/>")}
        ${note("D", 4, 1, "<type>eighth</type>")}
        ${note("E", 4, 4, "<type>half</type>")}
      </measure>
    `)

    expect(tuples(parseMusicXML(xml).tracks[0])).toEqual([
      ["C4", 0, 1.5],
      ["D4", 1.5, 0.5],
      ["E4", 2, 2],
    ])
  })

  it("uses the tuplet-adjusted duration from <duration>", function() {
    // eighth note triplet over one beat, then a quarter
    let triplet = "<type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 12})}
        ${note("C", 4, 4, triplet)}
        ${note("D", 4, 4, triplet)}
        ${note("E", 4, 4, triplet)}
        ${note("F", 4, 12, "<type>quarter</type>")}
      </measure>
    `)

    let notes = tuples(parseMusicXML(xml).tracks[0])
    expect(notes.map(n => n[0])).toEqual(["C4", "D4", "E4", "F4"])

    expect(notes[0][1]).toBeCloseTo(0, 10)
    expect(notes[1][1]).toBeCloseTo(1/3, 10)
    expect(notes[2][1]).toBeCloseTo(2/3, 10)
    expect(notes[3][1]).toBeCloseTo(1, 10)

    expect(notes[0][2]).toBeCloseTo(1/3, 10)
    expect(notes[1][2]).toBeCloseTo(1/3, 10)
    expect(notes[2][2]).toBeCloseTo(1/3, 10)
    expect(notes[3][2]).toBeCloseTo(1, 10)
  })

  it("reads a key signature with sharps and spells notes from <alter>", function() {
    // D major: F# and C# come from alter, not from the key
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1, fifths: 2})}
        ${note("D", 4, 1)}
        ${note("F", 4, 1, "", 1)}
        ${note("C", 5, 1, "", 1)}
        ${note("C", 5, 1, "<accidental>natural</accidental>", 0)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.keySignature).toEqual(2)
    expect(tuples(song.tracks[0])).toEqual([
      ["D4", 0, 1],
      ["F#4", 1, 1],
      ["C#5", 2, 1],
      ["C5", 3, 1],
    ])
  })

  it("reads a key signature with flats", function() {
    // Eb major
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1, fifths: -3})}
        ${note("E", 4, 1, "", -1)}
        ${note("B", 3, 1, "", -1)}
        ${note("A", 3, 1, "", -1)}
        ${note("G", 4, 1)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.keySignature).toEqual(-3)
    expect(tuples(song.tracks[0])).toEqual([
      ["Eb4", 0, 1],
      ["Bb3", 1, 1],
      ["Ab3", 2, 1],
      ["G4", 3, 1],
    ])
  })

  it("spells double accidentals enharmonically", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        ${note("F", 4, 1, "", 2)}
        ${note("B", 4, 1, "", -2)}
      </measure>
    `)

    expect(tuples(parseMusicXML(xml).tracks[0])).toEqual([
      ["G4", 0, 1],
      ["A4", 1, 1],
    ])
  })

  it("maps key signatures the app can't show to their enharmonic key, keeping the score's by measure", function() {
    let xml = fifths => partwise(`
      <measure number="1">
        ${attributes({divisions: 1, fifths})}
        ${note("C", 4, 4)}
      </measure>
    `)

    for (let [fifths, shown] of [[6, -6], [7, -5], [-7, 5], [5, 5], [-6, -6]]) {
      let {metadata} = parseMusicXML(xml(fifths))
      expect(metadata.keySignature).toEqual(shown)
      expect(metadata.measureKeySignatures).toEqual([fifths])
    }
  })

  it("converts a 3/4 piece", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1, beats: 3, beatType: 4})}
        ${note("C", 4, 1)}
        ${note("D", 4, 1)}
        ${note("E", 4, 1)}
      </measure>
      <measure number="2">
        ${note("F", 4, 3)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.beatsPerMeasure).toEqual(3)
    expect(song.metadata.measureStarts).toEqual([0, 3])
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 1],
      ["D4", 1, 1],
      ["E4", 2, 1],
      ["F4", 3, 3],
    ])
  })

  it("counts 6/8 in quarter note beats", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 2, beats: 6, beatType: 8})}
        ${note("C", 4, 1)}
        ${note("D", 4, 1)}
        ${note("E", 4, 1)}
        ${note("F", 4, 3)}
      </measure>
      <measure number="2">
        ${note("G", 4, 6)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.beatsPerMeasure).toEqual(3)
    expect(song.metadata.measureStarts).toEqual([0, 3])
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 0.5],
      ["D4", 0.5, 0.5],
      ["E4", 1, 0.5],
      ["F4", 1.5, 1.5],
      ["G4", 3, 3],
    ])
  })

  it("advances past rests without emitting notes", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 2})}
        ${note("C", 4, 2)}
        ${rest(2)}
        ${note("E", 4, 1)}
        ${rest(1)}
        ${note("G", 4, 2)}
      </measure>
      <measure number="2">
        ${rest(8, '<rest measure="yes"/>')}
      </measure>
      <measure number="3">
        ${note("C", 5, 8)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.measureStarts).toEqual([0, 4, 8])
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 1],
      ["E4", 2, 0.5],
      ["G4", 3, 1],
      ["C5", 8, 4],
    ])
  })

  it("positions voices with backup and forward", function() {
    // voice 1: C4 D4 E4 F4 (quarters)
    // voice 2 (same staff): rest a beat, then G3 half, then forward an eighth, A3 eighth
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 2})}
        ${note("C", 4, 2, "<voice>1</voice>")}
        ${note("D", 4, 2, "<voice>1</voice>")}
        ${note("E", 4, 2, "<voice>1</voice>")}
        ${note("F", 4, 2, "<voice>1</voice>")}
        <backup><duration>6</duration></backup>
        ${note("G", 3, 4, "<voice>2</voice>")}
        <forward><duration>1</duration></forward>
        ${note("A", 3, 1, "<voice>2</voice>")}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.tracks.length).toEqual(1)
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 1],
      ["D4", 1, 1],
      ["E4", 2, 1],
      ["F4", 3, 1],
      ["G3", 1, 2],
      ["A3", 3.5, 0.5],
    ])
  })

  it("skips grace notes", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        <note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>
        ${note("C", 4, 2)}
        ${note("D", 4, 2)}
      </measure>
    `)

    expect(tuples(parseMusicXML(xml).tracks[0])).toEqual([
      ["C4", 0, 2],
      ["D4", 2, 2],
    ])
  })

  it("records measure starts through pickup measures and time signature changes", function() {
    let xml = partwise(`
      <measure number="0" implicit="yes">
        ${attributes({divisions: 1, beats: 4, beatType: 4})}
        ${note("G", 3, 1)}
      </measure>
      <measure number="1">
        ${note("C", 4, 4)}
      </measure>
      <measure number="2">
        <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        ${note("D", 4, 3)}
      </measure>
      <measure number="3">
        ${note("E", 4, 3)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.beatsPerMeasure).toEqual(4)
    expect(song.metadata.measureStarts).toEqual([0, 1, 5, 8])
    expect(tuples(song.tracks[0])).toEqual([
      ["G3", 0, 1],
      ["C4", 1, 4],
      ["D4", 5, 3],
      ["E4", 8, 3],
    ])
  })

  it("places measures of a pickup piece at the score's measure starts", function() {
    let xml = partwise(`
      <measure number="0" implicit="yes">
        ${attributes({divisions: 1, beats: 3, beatType: 4})}
        ${note("G", 4, 1)}
      </measure>
      <measure number="1">
        ${note("C", 5, 3)}
      </measure>
      <measure number="2">
        ${note("E", 5, 2)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.measureStarts).toEqual([0, 1, 4])
    expect(song.metadata.measuresEnd).toEqual(6)
    expect(measureStartsUntil(song.metadata, song.getStopInBeats())).toEqual([0, 1, 4, 6])
    expect(measureStartsUntil(song.metadata, 9)).toEqual([0, 1, 4, 6, 8, 10])

    expect(measureStartsUntil({beatsPerMeasure: 3}, song.getStopInBeats())).toEqual([0, 3, 6])
    expect(measureStartsUntil({}, 0)).toEqual([0])
  })

  it("accents the first metronome click of each measure after an eighth note pickup", function() {
    let xml = partwise(`
      <measure number="0" implicit="yes">
        ${attributes({divisions: 2, beats: 4, beatType: 4})}
        ${note("G", 4, 1)}
      </measure>
      <measure number="1">
        ${note("C", 5, 8)}
      </measure>
      <measure number="2">
        ${note("E", 5, 8)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.metadata.measureStarts).toEqual([0, 0.5, 4.5])

    let accented = (clicks, clicksPerBeat) => clicks
      .filter(click => clickStartsMeasure(song.metadata, click, clicksPerBeat))

    let beats = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(accented(beats, 1)).toEqual([0, 1, 5, 9])

    let halfBeats = [...Array(21).keys()]
    expect(accented(halfBeats, 2)).toEqual([0, 1, 9, 17])
  })

  it("keeps parts aligned by measure and gives each its own track", function() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name></score-part>
    <score-part id="P2"><part-name>Cello</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      ${attributes({divisions: 1, clefs: [[1, "G", 2]]})}
      ${note("C", 5, 4)}
    </measure>
    <measure number="2">
      ${note("D", 5, 4)}
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      ${attributes({divisions: 4, clefs: [[1, "F", 4]]})}
      ${note("C", 3, 16)}
    </measure>
    <measure number="2">
      ${note("G", 2, 8)}
      ${note("G", 2, 8)}
    </measure>
  </part>
</score-partwise>`

    let song = parseMusicXML(xml)
    expect(song.tracks.length).toEqual(2)
    expect(song.tracks[0].trackName).toEqual("Flute")
    expect(song.tracks[0].cleffs).toEqual([[0, "g"]])
    expect(tuples(song.tracks[0])).toEqual([
      ["C5", 0, 4],
      ["D5", 4, 4],
    ])

    expect(song.tracks[1].trackName).toEqual("Cello")
    expect(song.tracks[1].cleffs).toEqual([[0, "f"]])
    expect(tuples(song.tracks[1])).toEqual([
      ["C3", 0, 4],
      ["G2", 4, 2],
      ["G2", 6, 2],
    ])
  })

  it("records clef changes at their position", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1, clefs: [[1, "F", 4]]})}
        ${note("C", 3, 2)}
        <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
        ${note("C", 5, 2)}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.tracks[0].cleffs).toEqual([[0, "f"], [2, "g"]])
  })

  it("converts a timewise score", function() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <measure number="1">
    <part id="P1">
      ${attributes({divisions: 1, staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
      ${note("C", 4, 4, "<staff>1</staff>")}
      <backup><duration>4</duration></backup>
      ${note("C", 3, 4, "<staff>2</staff>")}
    </part>
  </measure>
  <measure number="2">
    <part id="P1">
      ${note("D", 4, 4, "<staff>1</staff>")}
      <backup><duration>4</duration></backup>
      ${note("D", 3, 4, "<staff>2</staff>")}
    </part>
  </measure>
</score-timewise>`

    let song = parseMusicXML(xml)
    expect(song.metadata.measureStarts).toEqual([0, 4])
    expect(tuples(song.tracks[0])).toEqual([
      ["C4", 0, 4],
      ["D4", 4, 4],
    ])
    expect(tuples(song.tracks[1])).toEqual([
      ["C3", 0, 4],
      ["D3", 4, 4],
    ])
  })

  it("reads the title from the work or movement title", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1})}
        ${note("C", 4, 4)}
      </measure>
    `, {head: "<work><work-title>Minuet in G</work-title></work>"})

    expect(parseMusicXML(xml).metadata.title).toEqual("Minuet in G")
  })

  it("leaves out staves that have no notes", function() {
    let xml = partwise(`
      <measure number="1">
        ${attributes({divisions: 1, staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
        ${note("C", 4, 4, "<staff>1</staff>")}
        <backup><duration>4</duration></backup>
        ${rest(4, "<staff>2</staff>")}
      </measure>
    `)

    let song = parseMusicXML(xml)
    expect(song.tracks.length).toEqual(1)
    expect(tuples(song.tracks[0])).toEqual([["C4", 0, 4]])
  })

  it("refuses the text of compressed .mxl content, which can't be unpacked", function() {
    let zip = "PK    not really a zip"
    expect(() => parseMusicXML(zip)).toThrowError(MusicXMLError, COMPRESSED_MESSAGE)
  })

  it("rejects malformed xml and non-score documents", function() {
    expect(() => parseMusicXML("<score-partwise><part>")).toThrowError(MusicXMLError)
    expect(() => parseMusicXML("<html><body>hi</body></html>")).toThrowError(MusicXMLError, /Not a MusicXML score/)
    expect(() => parseMusicXML("")).toThrowError(MusicXMLError)
  })
})

describe("reading a MusicXML file", function() {
  // a .mxl archive of the given {path: text} entries, in order
  let archive = entries => zipSync(Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, strToU8(text)])))

  let container = path => `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/><rootfile full-path="score.pdf" media-type="application/pdf"/></rootfiles></container>`

  it("reads an uncompressed file from its bytes or its text", function() {
    let xml = reverieOpening()
    expect(readMusicXMLFile(new TextEncoder().encode(xml))).toEqual(xml)
    expect(readMusicXMLFile(new TextEncoder().encode(xml).buffer)).toEqual(xml)
    expect(readMusicXMLFile(xml)).toEqual(xml)
  })

  it("unpacks the score a compressed file's container names", function() {
    // written by Info-ZIP, with an entry ahead of the score that isn't it
    let text = readMusicXMLFile(littleWaltzMXL())
    expect(text).toEqual(LITTLE_WALTZ_XML)
    expect(readMusicXMLFile(littleWaltzMXL().buffer)).toEqual(LITTLE_WALTZ_XML)

    let song = parseMusicXML(text)
    expect(tuples(song)).toEqual([["E5", 0, 1], ["G4", 1, 1], ["C5", 2, 1]])
  })

  it("reads the non-ASCII text of a compressed score", function() {
    let xml = reverieOpening()
    let text = readMusicXMLFile(archive({
      "META-INF/container.xml": container("Rêverie.musicxml"),
      "Rêverie.musicxml": xml,
    }))
    expect(text).toEqual(xml)
    expect(parseMusicXML(text).metadata.title).toEqual("Rêverie")
  })

  it("falls back to the first score entry outside META-INF", function() {
    let xml = reverieOpening()

    // no container
    expect(readMusicXMLFile(archive({
      "META-INF/other.xml": "<other/>",
      "cover.png": "not xml",
      "score.xml": xml,
      "parts/extra.musicxml": "<extra/>",
    }))).toEqual(xml)

    // a container naming an entry the archive doesn't hold
    expect(readMusicXMLFile(archive({
      "META-INF/container.xml": container("missing.musicxml"),
      "piece.MUSICXML": xml,
    }))).toEqual(xml)

    // a container that isn't XML
    expect(readMusicXMLFile(archive({
      "META-INF/container.xml": "<container><rootfiles",
      "piece.xml": xml,
    }))).toEqual(xml)
  })

  it("reads the score a container names whatever its extension", function() {
    let xml = reverieOpening()
    expect(readMusicXMLFile(archive({
      "META-INF/container.xml": container("score.mus"),
      "decoy.xml": "<decoy/>",
      "score.mus": xml,
    }))).toEqual(xml)
  })

  it("gives a readable error for an empty or damaged archive", function() {
    let fails = (data, message) =>
      expect(() => readMusicXMLFile(data)).toThrowError(MusicXMLError, message)

    // empty, and holding no score
    fails(zipSync({}), NO_SCORE_MESSAGE)
    fails(archive({"META-INF/container.xml": container("score.xml"), "cover.png": "png"}), NO_SCORE_MESSAGE)

    // cut short, and with its compressed data scrambled
    let bytes = littleWaltzMXL()
    fails(bytes.slice(0, 60), DAMAGED_ARCHIVE_MESSAGE)
    let scrambled = bytes.slice()
    scrambled.fill(0xff, 80, 200)
    fails(scrambled, DAMAGED_ARCHIVE_MESSAGE)
    fails(strToU8("PK\u0003\u0004 not really a zip"), DAMAGED_ARCHIVE_MESSAGE)
  })
})

// T7 of the note detection report: the score's ornaments are kept on the
// note they are played with, for the drill to allow them as extras
describe("musicxml ornaments", function() {
  // [note, start, ornaments] of the notes with any, by onset
  let ornaments = song => [...song].filter(n => n.ornaments)
    .sort((a, b) => a.start - b.start || a.note.localeCompare(b.note))
    .map(n => [n.note, n.start, n.ornaments])

  let ornamented = (marks, extra="") =>
    `<notations><ornaments>${marks}</ornaments></notations>${extra}`

  let treble = "<voice>1</voice><staff>1</staff>"
  let wavy = type => `<wavy-line type="${type}" number="1"/>`

  let grace = (step, octave, extra="", alter=null) => `
<note>
  <grace slash="yes"/>
  <pitch><step>${step}</step>${alter != null ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>
  ${extra}
</note>`

  it("keeps the Nocturne's grace notes with the note they lead into, and its trill's neighbour in the key", function() {
    let song = parseMusicXML(nocturneBars5to6())

    // the grace notes are no notes of their own
    expect(tuples(song.tracks[0])).toEqual([["G#5", 0, 2], ["F#5", 2, 2], ["G#5", 4, 2], ["C#5", 6, 2]])
    // four sharps: the note above F#5 is G#5
    expect(ornaments(song)).toEqual([
      ["F#5", 2, {neighbours: ["G#5"], trill: true}],
      ["G#5", 4, {graces: ["E5", "F#5"]}],
    ])
  })

  it("gives a grace note to the next note of its voice", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${grace("D", 5, "<voice>1</voice>")}
  ${grace("A", 3, "<voice>2</voice>")}
  ${note("C", 5, 2, "<voice>1</voice>")}
  ${grace("B", 4, "<voice>1</voice>")}
  ${note("E", 5, 2, "<voice>1</voice>")}
  <backup><duration>4</duration></backup>
  ${note("G", 3, 4, "<voice>2</voice>")}
</measure>`))

    expect(ornaments(song)).toEqual([
      ["C5", 0, {graces: ["D5"]}],
      ["G3", 0, {graces: ["A3"]}],
      ["E5", 2, {graces: ["B4"]}],
    ])
  })

  it("spells a trill's, turn's and mordent's neighbours by the key, the measure's accidentals and the marks", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({fifths: -2})}
  ${note("E", 5, 1, ornamented("<trill-mark/>"), -1)}
  ${note("C", 5, 1, ornamented("<mordent/>"))}
  ${note("B", 4, 1, ornamented("<inverted-mordent/>"), -1)}
  ${note("D", 5, 1, ornamented("<turn/>"))}
</measure>
<measure number="2">
  ${note("F", 5, 1, "", 1)}
  ${note("E", 5, 1, ornamented("<trill-mark/>"), -1)}
  ${note("A", 4, 1, ornamented("<turn/><accidental-mark placement=\"below\">sharp</accidental-mark>"))}
  ${note("D", 5, 1, ornamented("<trill-mark/><accidental-mark>natural</accidental-mark>"))}
</measure>`))

    expect(ornaments(song)).toEqual([
      // two flats, Bb and Eb: above Eb5 is F5, below C5 is Bb4 (the octave
      // turns at C), above Bb4 is C5, around D5 are Eb5 and C5
      ["Eb5", 0, {neighbours: ["F5"], trill: true}],
      ["C5", 1, {neighbours: ["Bb4"]}],
      ["Bb4", 2, {neighbours: ["C5"]}],
      ["D5", 3, {neighbours: ["Eb5", "C5"]}],
      // the F#5 written earlier in the measure is in force
      ["Eb5", 5, {neighbours: ["F#5"], trill: true}],
      // the marks: a sharp below the turn, a natural above the trill
      ["A4", 6, {neighbours: ["Bb4", "G#4"]}],
      ["D5", 7, {neighbours: ["E5"], trill: true}],
    ])
  })

  it("gives an accidental mark with no placement the next side of its ornament", function() {
    let mark = (alter, placement="") =>
      `<accidental-mark${placement ? ` placement="${placement}"` : ""}>${alter}</accidental-mark>`
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("A", 4, 1, ornamented(`<turn/>${mark("flat")}${mark("sharp")}`))}
  ${note("E", 5, 1, ornamented(`<mordent/>${mark("flat")}${mark("natural")}`))}
</measure>`))

    expect(ornaments(song)).toEqual([
      // the turn's two sides in the order the marks are written
      ["A4", 0, {neighbours: ["Bb4", "G#4"]}],
      // the mordent has only a lower side, so its second mark alters nothing
      ["E5", 1, {neighbours: ["Db5"]}],
    ])
  })

  it("trills every note under a wavy line, across the bar, in its own voice only", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({fifths: 1, staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
  ${note("D", 5, 1, ornamented(`<trill-mark/>${wavy("start")}`, treble))}
  ${note("E", 5, 1, treble)}
  ${note("G", 5, 1, treble)}
  <backup><duration>3</duration></backup>
  ${note("B", 3, 4, "<voice>5</voice><staff>2</staff>")}
</measure>
<measure number="2">
  ${note("A", 5, 1, ornamented(wavy("stop"), treble))}
  ${note("B", 5, 3, treble)}
</measure>`))

    // one sharp: each note under the line is trilled with its own upper
    // neighbour, up to and including the note the line stops on. The left
    // hand's note under the line is in another voice, so it is not trilled
    expect(ornaments(song)).toEqual([
      ["D5", 0, {neighbours: ["E5"], trill: true}],
      ["E5", 1, {neighbours: ["F#5"], trill: true}],
      ["G5", 2, {neighbours: ["A5"], trill: true}],
      ["A5", 4, {neighbours: ["B5"], trill: true}],
    ])
  })

  it("stops a wavy line on another voice of its staff", function() {
    let alto = "<voice>2</voice><staff>1</staff>"
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("D", 5, 1, ornamented(`<trill-mark/>${wavy("start")}`, treble))}
  ${note("E", 5, 1, treble)}
  <backup><duration>2</duration></backup>
  ${note("F", 5, 2, ornamented(wavy("stop"), alto))}
  ${note("G", 5, 1, treble)}
  ${note("A", 5, 1, treble)}
</measure>`))

    // the line is stopped in the staff's other voice, so it trills neither
    // the G5 nor the A5 written after it
    expect(ornaments(song)).toEqual([
      ["D5", 0, {neighbours: ["E5"], trill: true}],
      ["E5", 1, {neighbours: ["F5"], trill: true}],
    ])
  })

  it("trills only the melody note of a chord a wavy line is written over", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("C", 5, 2, ornamented(`<trill-mark/>${wavy("start")}`, treble))}
  ${note("E", 5, 2, `<chord/>${treble}`)}
  ${note("D", 5, 2, ornamented(wavy("stop"), treble))}
</measure>`))

    // the line is written on the C5, so the E5 above it in the same chord is
    // not trilled; the D5 the line stops on still is
    expect(ornaments(song)).toEqual([
      ["C5", 0, {neighbours: ["D5"], trill: true}],
      ["D5", 2, {neighbours: ["E5"], trill: true}],
    ])
  })

  it("keeps a wavy line to its own staff in a score that writes no voices", function() {
    let upper = "<staff>1</staff>"
    let lower = "<staff>2</staff>"
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
  ${note("D", 5, 1, ornamented(`<trill-mark/>${wavy("start")}`, upper))}
  ${note("E", 5, 1, upper)}
  ${note("F", 5, 1, upper)}
  ${note("G", 5, 1, upper)}
  <backup><duration>4</duration></backup>
  ${note("G", 3, 1, lower)}
  ${note("A", 3, 1, lower)}
  ${note("B", 3, 1, lower)}
  ${rest(1, lower)}
</measure>
<measure number="2">
  ${note("A", 5, 1, ornamented(wavy("stop"), upper))}
</measure>`))

    // every note is voice 0, so only the staff tells the hands apart: the
    // left hand's notes are not trilled and its rest doesn't end the line,
    // which still runs to the A5 the score stops it on
    expect(ornaments(song)).toEqual([
      ["D5", 0, {neighbours: ["E5"], trill: true}],
      ["E5", 1, {neighbours: ["F5"], trill: true}],
      ["F5", 2, {neighbours: ["G5"], trill: true}],
      ["G5", 3, {neighbours: ["A5"], trill: true}],
      ["A5", 4, {neighbours: ["B5"], trill: true}],
    ])
  })

  it("ends a wavy line the score never stops at the first rest of its voice", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("D", 5, 1, ornamented(`<trill-mark/>${wavy("start")}`, treble))}
  ${note("E", 5, 1, treble)}
  ${rest(1, treble)}
  ${note("G", 5, 1, treble)}
</measure>`))

    expect(ornaments(song)).toEqual([
      ["D5", 0, {neighbours: ["E5"], trill: true}],
      ["E5", 1, {neighbours: ["F5"], trill: true}],
    ])
  })

  it("ends a wavy line the score never stops at the next note writing its own ornament", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("D", 5, 1, ornamented(`<trill-mark/>${wavy("start")}`, treble))}
  ${note("E", 5, 1, treble)}
  ${note("F", 5, 1, ornamented("<mordent/>", treble))}
  ${note("G", 5, 1, treble)}
</measure>`))

    // the mordent's own lower note is F5's, and the line ends there, so the
    // G5 after it is not trilled
    expect(ornaments(song)).toEqual([
      ["D5", 0, {neighbours: ["E5"], trill: true}],
      ["E5", 1, {neighbours: ["F5"], trill: true}],
      ["F5", 2, {neighbours: ["E5"]}],
    ])
  })

  it("ends a wavy line on the note the score stops it on, even one it skips", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("D", 5, 1, ornamented(`<trill-mark/>${wavy("start")}`, treble))}
  ${note("E", 5, 1, treble)}
  ${rest(1, `${treble}${ornamented(wavy("stop"))}`)}
  ${note("G", 5, 1, treble)}
</measure>`))

    // the rest carrying the stop is no note of the song, so the line would
    // otherwise run on and trill the G5 after it
    expect(ornaments(song)).toEqual([
      ["D5", 0, {neighbours: ["E5"], trill: true}],
      ["E5", 1, {neighbours: ["F5"], trill: true}],
    ])
  })

  it("gives a grace note written on the other staff to the note it leads into", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
  ${grace("A", 3, "<voice>1</voice><staff>2</staff>")}
  ${note("C", 5, 2, treble)}
  ${note("E", 5, 2, treble)}
  ${grace("F", 5, treble)}
</measure>
<measure number="2">
  ${note("G", 3, 4, "<voice>1</voice><staff>2</staff>")}
</measure>`))

    // the left hand's grace note leads into the right hand's C5, and the one
    // left over at the end of the bar leads into no note of it, so it reaches
    // neither the G3 of the next bar nor anything else
    expect(ornaments(song)).toEqual([["C5", 0, {graces: ["A3"]}]])
  })

  it("trills nothing for a wavy line written with no trill mark", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("C", 5, 1, ornamented(wavy("start"), treble))}
  ${note("D", 5, 1, treble)}
  ${note("E", 5, 1, ornamented(wavy("stop"), treble))}
  ${note("F", 5, 1, treble)}
</measure>`))

    expect(ornaments(song)).toEqual([])
  })

  it("opens no span for a wavy line that doesn't say whether it starts or stops", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${note("C", 5, 1, ornamented("<trill-mark/><wavy-line/>", treble))}
  ${note("D", 5, 1, treble)}
  ${note("E", 5, 1, treble)}
</measure>`))

    // the trill mark still trills its own note; the line says nothing the
    // importer can run to a stop, so the notes after it are not trilled
    expect(ornaments(song)).toEqual([["C5", 0, {neighbours: ["D5"], trill: true}]])
  })

  it("gives a grace note to a note written after it, never one a backup put before it", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({staves: 2, clefs: [[1, "G", 2], [2, "F", 4]]})}
  ${note("F", 5, 2, "<staff>1</staff>")}
  ${grace("E", 5, "<staff>1</staff>")}
  <backup><duration>2</duration></backup>
  ${note("C", 3, 2, "<staff>2</staff>")}
  ${note("D", 3, 2, "<staff>2</staff>")}
</measure>`))

    // no note writes a <voice>, so every note of the bar shares one: the
    // grace is written half way through it, so the C3 the backup put on the
    // downbeat isn't the note it leads into, the D3 after it is
    expect(ornaments(song)).toEqual([["D3", 2, {graces: ["E5"]}]])
  })

  it("starts an ornament written on a tie's continuation at that continuation", function() {
    let song = parseMusicXML(tiedTrillScore())

    expect(tuples(song.tracks[0])).toEqual([["C5", 0, 8]])
    // the trill is written in bar 2, so it sounds from beat 4, not from the
    // merged note's own start
    expect(ornaments(song)).toEqual([["C5", 0, {neighbours: ["D5"], trill: true, at: 4}]])
  })

  it("keeps a trill written on a tie's first note over the whole tie, wavy line and all", function() {
    let song = parseMusicXML(tiedTrillScore({span: true}))

    expect(tuples(song.tracks[0])).toEqual([["C5", 0, 8]])
    // the trill mark is written in bar 1 and its wavy line runs to the
    // continuation, so the merged note is trilled from its own start
    expect(ornaments(song)).toEqual([["C5", 0, {neighbours: ["D5"], trill: true}]])
  })

  it("keeps the ornaments of the notes a tie merges", function() {
    let song = parseMusicXML(partwise(`
<measure number="1">
  ${attributes({})}
  ${grace("B", 4)}
  ${note("C", 5, 4, `<tie type="start"/>${ornamented("<trill-mark/>")}`)}
</measure>
<measure number="2">
  ${note("C", 5, 4, "<tie type=\"stop\"/>")}
</measure>`))

    expect(tuples(song)).toEqual([["C5", 0, 8]])
    expect(ornaments(song)).toEqual([["C5", 0, {graces: ["B4"], neighbours: ["D5"], trill: true}]])
  })
})
