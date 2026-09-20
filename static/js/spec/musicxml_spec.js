import {parseMusicXML, MusicXMLError, COMPRESSED_MESSAGE} from "st/musicxml"
import {SongNote, measureStartsUntil, clickStartsMeasure} from "st/song_note_list"
import {reverieOpening, tripletScore} from "spec/helpers"

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

  it("keeps the beam groups and slurs the score writes on its notes", function() {
    let song = parseMusicXML(reverieOpening())
    // the eighth notes of the left hand's ostinato, bar by bar; its first bar
    // opens the phrase
    let eighths = [...song.tracks[1]].filter(note => note.notation.type == "eighth")
    let ostinato = eighths.slice(0, 7)

    expect(ostinato.map(note => note.notation.beams[1]))
      .toEqual(["begin", "continue", "continue", "end", "continue", "continue", "end"])

    // the G4 tied across the middle of the bar is one note to play, and the
    // head its tie runs on to carries the beam that opens the second group
    let tied = ostinato.find(note => note.notation.ties.length)
    expect([tied.note, tied.duration]).toEqual(["G4", 1])
    expect(tied.notation.ties.map(head => head.beams[1])).toEqual(["begin"])

    // one slur over the whole bar, from its first eighth to its last
    expect(ostinato[0].notation.slurs).toEqual([{type: "start", number: 2}])
    expect(ostinato[ostinato.length - 1].notation.slurs)
      .toEqual([{type: "stop", number: 2}])

    // the next bar opens its slur on a head a tie runs on to, which is drawn
    // but never played: the Bb3 its last eighth is tied into
    let across = ostinato[ostinato.length - 1]
    expect(across.notation.ties.map(head => head.slurs))
      .toEqual([[{type: "start", number: 2}]])
  })

  it("keeps the tuplet spans and the notes a tuplet is written with", function() {
    let song = parseMusicXML(tripletScore())
    let notes = [...song.tracks[0]]

    expect(notes.map(note => note.notation.tuplet))
      .toEqual([1.5, 1.5, 1.5, undefined, 1.5, 1.5, 1.5, undefined])
    expect(notes.map(note => note.notation.tupletNotes))
      .toEqual([3, 3, 3, undefined, 3, 3, 3, undefined])
    expect(notes.map(note => note.notation.tuplets && note.notation.tuplets[0].type))
      .toEqual(["start", undefined, "stop", undefined, "start", undefined, "stop", undefined])

    // a quarter note triplet carries no beams; the eighth note triplet is one
    // beam group of its own
    expect(notes.slice(0, 3).map(note => note.notation.beams)).toEqual([undefined, undefined, undefined])
    expect(notes.slice(4, 7).map(note => note.notation.beams[1]))
      .toEqual(["begin", "continue", "end"])
  })

  it("refuses compressed .mxl content", function() {
    let zip = "PK    not really a zip"
    expect(() => parseMusicXML(zip)).toThrowError(MusicXMLError, COMPRESSED_MESSAGE)
  })

  it("rejects malformed xml and non-score documents", function() {
    expect(() => parseMusicXML("<score-partwise><part>")).toThrowError(MusicXMLError)
    expect(() => parseMusicXML("<html><body>hi</body></html>")).toThrowError(MusicXMLError, /Not a MusicXML score/)
    expect(() => parseMusicXML("")).toThrowError(MusicXMLError)
  })
})
