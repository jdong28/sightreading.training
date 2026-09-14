import {serializeSong, SerializeError} from "st/song_serializer"
import {parseMusicXML} from "st/musicxml"
import SongParser from "st/song_parser"
import {MultiTrackSong, SongNote} from "st/song_note_list"

// sorted [note, start, duration] tuples, rounded so float drift from the
// parser's cursor arithmetic doesn't matter
let tuples = notes => [...notes]
  .map(n => [n.note, +n.start.toFixed(6), +n.duration.toFixed(6)])
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]) || a[2] - b[2])

let buildSong = (trackTuples, metadata={}) => {
  let song = new MultiTrackSong()
  trackTuples.forEach((notes, trackIdx) => {
    for (let [note, start, duration] of notes) {
      song.pushWithTrack(new SongNote(note, start, duration), trackIdx)
    }
  })
  song.metadata = Object.assign({keySignature: 0, beatsPerMeasure: 4}, metadata)
  return song
}

// serializes then parses again, checking that the notes survive
let roundTrip = song => {
  let code = serializeSong(song)
  let parsed = SongParser.load(code)

  expect(parsed.tracks.length).toEqual(song.tracks.length)
  song.tracks.forEach((track, idx) => {
    expect(tuples(parsed.tracks[idx])).toEqual(tuples(track))
  })

  expect(parsed.metadata.keySignature).toEqual(song.metadata.keySignature)
  expect(parsed.metadata.beatsPerMeasure).toEqual(song.metadata.beatsPerMeasure)

  return {code, parsed}
}

describe("song serializer", function() {
  it("writes a simple melody as one voice", function() {
    let song = buildSong([[
      ["C5", 0, 1],
      ["D5", 1, 1],
      ["E5", 2, 2],
    ]])

    let {code} = roundTrip(song)
    expect(code).toEqual([
      "ks0 ts4/4",
      "tt dt dt",
      "",
      "t0 m0",
      "{",
      "    c=5.12 d=5.12 e=5.24",
      "}",
      "",
    ].join("\n"))
  })

  it("writes explicit accidentals regardless of key signature", function() {
    let song = buildSong([[
      ["F#5", 0, 1],
      ["Bb4", 1, 1],
      ["F5", 2, 1],
    ]], {keySignature: 2})

    let {code} = roundTrip(song)
    expect(code).toContain("ks2 ts4/4")
    expect(code).toContain("f+5.12 b-4.12 f=5.12")
  })

  it("writes rests for gaps and chords for simultaneous notes", function() {
    let song = buildSong([[
      ["C5", 1, 1],
      ["E5", 1, 1],
      ["G5", 1, 1],
      ["A5", 3, 0.5],
    ]])

    let {code} = roundTrip(song)
    expect(code).toContain("r12 {c=5.12 | e=5.12 | g=5.12} r12 a=5.6")
  })

  it("splits overlapping notes into voices", function() {
    let song = buildSong([[
      ["C4", 0, 4], // held bass note
      ["E5", 0, 1],
      ["F5", 1, 1],
      ["G5", 2, 2],
    ]])

    let {code} = roundTrip(song)
    expect(code).toContain("    e=5.12 f=5.12 g=5.24\n  | c=4.48")
  })

  it("writes each track with its clef", function() {
    let song = buildSong([
      [["C5", 0, 4], ["D5", 4, 4]],
      [["C4", 0, 4], ["G3", 4, 2], ["G3", 6, 2]],
    ])
    song.tracks[0].cleffs = [[0, "g"]]
    song.tracks[1].cleffs = [[0, "f"]]

    let {code, parsed} = roundTrip(song)
    expect(code).toContain("t0 m0 /g")
    expect(code).toContain("t1 m0 /f")
    expect(parsed.tracks[0].cleffs).toEqual([[0, "g"]])
    expect(parsed.tracks[1].cleffs).toEqual([[0, "f"]])
    expect(parsed.tracks[0].fittingStaff()).toEqual("treble")
    expect(parsed.tracks[1].fittingStaff()).toEqual("bass")
  })

  it("keeps a left hand staff that switches to treble mid-piece", function() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><staff>2</staff></note>
    </measure>
    <measure number="3">
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><staff>2</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    let song = parseMusicXML(xml)
    expect(song.tracks[1].cleffs).toEqual([[0, "f"], [8, "g"]])
    expect(song.tracks[1].fittingStaff()).toEqual("bass")

    let {code, parsed} = roundTrip(song)
    expect(code).toContain("t1 m0 /f")
    expect(parsed.tracks[1].cleffs.length).toEqual(2)
    expect(parsed.tracks[1].cleffs[0]).toEqual([0, "f"])
    expect(parsed.tracks[1].cleffs[1][0]).toBeCloseTo(8, 6)
    expect(parsed.tracks[1].cleffs[1][1]).toEqual("g")
    expect(parsed.tracks[1].fittingStaff()).toEqual("bass")
    expect(parsed.tracks[0].fittingStaff()).toEqual("treble")
  })

  it("round trips triplets and sixteenths at 1/12 beat resolution", function() {
    let song = buildSong([[
      ["C5", 0, 1/3],
      ["D5", 1/3, 1/3],
      ["E5", 2/3, 1/3],
      ["F5", 1, 0.25],
      ["G5", 1.25, 0.25],
      ["A5", 1.5, 0.5],
    ]])

    let {code} = roundTrip(song)
    expect(code).toContain("tt dt dt\n")
    expect(code).toContain("c=5.4 d=5.4 e=5.4 f=5.3 g=5.3 a=5.6")
  })

  it("uses a finer grid for 32nd notes", function() {
    let song = buildSong([[
      ["C5", 0, 0.125],
      ["D5", 0.125, 0.125],
      ["E5", 0.25, 0.75],
    ]])

    let {code} = roundTrip(song)
    expect(code).toContain("tt dt dt dt\n")
    expect(code).toContain("c=5.3 d=5.3 e=5.18")
  })

  it("writes 3/4 and 6/8 time signatures", function() {
    let waltz = buildSong([[["C5", 0, 1], ["E5", 1, 1], ["G5", 2, 1]]], {beatsPerMeasure: 3})
    expect(roundTrip(waltz).code).toContain("ks0 ts3/4")

    let jig = buildSong([[["C5", 0, 0.5], ["E5", 0.5, 0.5], ["G5", 1, 0.5], ["C6", 1.5, 1.5]]],
      {beatsPerMeasure: 3, keySignature: -1})
    expect(roundTrip(jig).code).toContain("ks-1 ts3/4")

    let five8 = buildSong([[["C5", 0, 1.5], ["E5", 1.5, 1]]], {beatsPerMeasure: 2.5})
    let {code} = roundTrip(five8)
    expect(code).toContain("ts5/8")
    expect(code).toContain("tt dt\n")
  })

  it("refuses rhythms the notation can't express", function() {
    let quintuplet = buildSong([[["C5", 0, 0.2], ["D5", 0.2, 0.2]]])
    expect(() => serializeSong(quintuplet)).toThrowError(SerializeError)

    let tooHigh = buildSong([[["C10", 0, 1]]])
    expect(() => serializeSong(tooHigh)).toThrowError(SerializeError)
  })

  it("round trips a converted MusicXML piano piece", function() {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>6</divisions>
        <key><fifths>-2</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>6</duration><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>
      <note><pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>6</duration><staff>1</staff><tie type="start"/></note>
      <backup><duration>18</duration></backup>
      <note><pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><duration>18</duration><staff>2</staff></note>
      <backup><duration>18</duration></backup>
      <forward><duration>6</duration></forward>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>6</duration><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>6</duration><staff>2</staff><chord/></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>6</duration><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>6</duration><staff>2</staff><chord/></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>9</duration><staff>1</staff><tie type="stop"/></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>3</duration><staff>1</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>5</octave></pitch><duration>6</duration><staff>1</staff></note>
      <backup><duration>18</duration></backup>
      <note><pitch><step>E</step><alter>-1</alter><octave>3</octave></pitch><duration>18</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

    let song = parseMusicXML(xml)
    let {parsed} = roundTrip(song)
    expect(parsed.tracks[0].fittingStaff()).toEqual("treble")
    expect(parsed.tracks[1].fittingStaff()).toEqual("bass")
  })
})
