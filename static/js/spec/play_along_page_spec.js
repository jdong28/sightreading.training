import {PlayAlongPage} from "st/components/pages/play_along_page"
import {parseMusicXML} from "st/musicxml"
import {parseNote} from "st/music"

let quintupletXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>5</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`

// runs the page's song loading methods against plain state, standing in for
// componentDidUpdate calling refreshSong whenever the code changes
let songPage = () => {
  let page = Object.create(PlayAlongPage.prototype)
  page.state = {autoChordType: 0}
  page.setState = update => Object.assign(page.state, update)
  page.setSong = song => page.state.song = song
  page.editCode = code => {
    page.setState({currentSongCode: code})
    page.refreshSong()
  }
  return page
}

describe("play along page", function() {
  it("keeps an imported song only until its paired code is edited", function() {
    let page = songPage()
    page.editCode("c4 d4")

    let imported = parseMusicXML(quintupletXML)
    page.importSong(imported, "c4 d4", false)
    expect(page.state.song).toBe(imported)
    expect(page.importUnsaveable()).toBe(true)

    page.refreshSong()
    expect(page.state.song).toBe(imported)
    expect(page.importUnsaveable()).toBe(true)

    page.editCode("c4 d4 ")
    expect(page.importUnsaveable()).toBe(false)
    expect(page.state.song).not.toBe(imported)
    expect(page.state.song.length).toEqual(2)

    page.editCode("c4 d4")
    expect(page.state.song).not.toBe(imported)
    expect(page.state.importedSong).toBe(null)
    expect(page.importUnsaveable()).toBe(false)
    expect(page.state.song.length).toEqual(2)
  })

  it("plays a song from the server library, written with middle C as c5, at its pitches", function() {
    let realRequest = window.XMLHttpRequest
    window.XMLHttpRequest = class {
      open(method, url) { this.url = url }
      send() {
        expect(this.url).toEqual("/songs/7.json")
        this.responseText = JSON.stringify({song: {id: 7, song: "c5 e5 g5"}})
        this.onload()
      }
    }

    try {
      let page = songPage()
      page.props = {params: {song_id: "7"}}
      page.stats = {setTimerUrl: () => {}}
      page.loadSong()
      page.refreshSong()

      expect([...page.state.song].map(note => parseNote(note.note))).toEqual([60, 64, 67])
    } finally {
      window.XMLHttpRequest = realRequest
    }
  })

  it("doesn't block saving an import the code expresses", function() {
    let page = songPage()
    let imported = parseMusicXML(quintupletXML)
    page.importSong(imported, "c4 d4 e4 f4 g4", true)
    expect(page.state.song).toBe(imported)
    expect(page.importUnsaveable()).toBe(false)
  })
})
