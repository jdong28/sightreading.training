import {PlayAlongPage} from "st/components/pages/play_along_page"
import {parseMusicXML} from "st/musicxml"

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
    page.editCode("c5 d5")

    let imported = parseMusicXML(quintupletXML)
    page.importSong(imported, "c5 d5")
    expect(page.state.song).toBe(imported)

    page.refreshSong()
    expect(page.state.song).toBe(imported)

    page.editCode("c5 d5 ")
    expect(page.state.song).not.toBe(imported)
    expect(page.state.song.length).toEqual(2)

    page.editCode("c5 d5")
    expect(page.state.song).not.toBe(imported)
    expect(page.state.importedSong).toBe(null)
    expect(page.state.song.length).toEqual(2)
  })
})
