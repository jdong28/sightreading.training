import * as React from "react"
import {flushSync} from "react-dom"

import {getRoot} from "spec/helpers"
import SongEditor from "st/components/song_editor"
import {COMPRESSED_MESSAGE} from "st/musicxml"

// five quintuplet sixteenths, which the notation can't express
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

let renderEditor = props => {
  let ref = React.createRef()
  flushSync(() => {
    getRoot().render(React.createElement(SongEditor, Object.assign({
      ref,
      key: `editor-${Math.random()}`,
      song: {id: 1, allowed_to_edit: true},
    }, props)))
  })
  return ref.current
}

let importText = (editor, name, text) =>
  editor.importFile({target: {files: [new File([text], name)], value: name}})

let nextRender = () => new Promise(resolve => window.setTimeout(resolve, 0))

let saveButton = () => [...document.querySelectorAll("#react_root button")]
  .find(button => button.textContent == "Save")

describe("song editor", function() {
  it("blocks saving an import the notation can't express until the code is edited", async function() {
    let imported = []
    let editor = renderEditor({
      code: "c5 d5",
      onImportSong: (song, code) => imported.push([song, code]),
    })

    await importText(editor, "quintuplets.musicxml", quintupletXML)
    await nextRender()

    expect(imported.length).toEqual(1)
    expect(imported[0][0].length).toEqual(5)
    expect(imported[0][1]).toEqual("c5 d5")
    expect(editor.state.importNotice).toBeTruthy()
    expect(saveButton().disabled).toBe(true)

    editor.beforeSubmit()
    expect(editor.notesCountInputRef.current.value).toEqual("2")
    expect(editor.beatsLengthInputRef.current.value).toEqual("2")

    await importText(editor, "broken.musicxml", "<score-partwise>")
    await nextRender()

    expect(editor.state.importError).toBeTruthy()
    expect(editor.state.importNotice).toBeTruthy()
    expect(saveButton().disabled).toBe(true)

    flushSync(() => editor.updateCode("c5 d5 e5"))
    expect(editor.state.importNotice).toBe(null)
    expect(saveButton().disabled).toBe(false)

    editor.beforeSubmit()
    expect(editor.notesCountInputRef.current.value).toEqual("3")
    expect(editor.beatsLengthInputRef.current.value).toEqual("3")
  })

  it("reports compressed files from their content", async function() {
    let editor = renderEditor({code: ""})

    await importText(editor, "score.mxl", "PK not really a zip")
    await nextRender()

    expect(editor.state.importError).toEqual(COMPRESSED_MESSAGE)
    expect(saveButton().disabled).toBe(false)
  })
})
