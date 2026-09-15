import * as React from "react"
import {flushSync} from "react-dom"

import {getRoot} from "spec/helpers"
import SongEditor, {SONG_DRAFT_KEY} from "st/components/song_editor"
import styles from "st/components/song_editor.module.css"
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

let importNotice = () => document.querySelector(`#react_root .${styles.import_notice}`)

describe("song editor", function() {
  it("reports an import the notation can't express without replacing the code", async function() {
    let imported = []
    let editor = renderEditor({
      code: "c4 d4",
      onImportSong: (...args) => imported.push(args),
    })

    await importText(editor, "quintuplets.musicxml", quintupletXML)
    await nextRender()

    expect(imported.length).toEqual(1)
    expect(imported[0][0].length).toEqual(5)
    expect(imported[0][1]).toEqual("c4 d4")
    expect(imported[0][2]).toBe(false)
    expect(editor.state.code).toEqual("c4 d4")

    editor.beforeSubmit()
    expect(editor.notesCountInputRef.current.value).toEqual("2")
    expect(editor.beatsLengthInputRef.current.value).toEqual("2")

    await importText(editor, "broken.musicxml", "<score-partwise>")
    await nextRender()

    expect(editor.state.importError).toBeTruthy()
    expect(imported.length).toEqual(1)
  })

  it("blocks saving while the page reports an unsaveable import, across remounts", function() {
    renderEditor({code: "c4 d4", importUnsaveable: true})
    expect(saveButton().disabled).toBe(true)
    expect(importNotice()).toBeTruthy()

    renderEditor({code: "c4 d4", importUnsaveable: true})
    expect(saveButton().disabled).toBe(true)
    expect(importNotice()).toBeTruthy()

    renderEditor({code: "c4 d4 e4", importUnsaveable: false})
    expect(saveButton().disabled).toBe(false)
    expect(importNotice()).toBe(null)
  })

  describe("new song draft", function() {
    let saved

    beforeEach(function() {
      saved = window.localStorage.getItem(SONG_DRAFT_KEY)
    })

    afterEach(function() {
      if (saved == null) {
        window.localStorage.removeItem(SONG_DRAFT_KEY)
      } else {
        window.localStorage.setItem(SONG_DRAFT_KEY, saved)
      }
    })

    let storedDraft = () => JSON.parse(window.localStorage.getItem(SONG_DRAFT_KEY))

    it("renumbers a draft written when middle C was c5 once", function() {
      window.localStorage.setItem(SONG_DRAFT_KEY, JSON.stringify({title: "Old", code: "c5 e5 g5"}))

      let editor = renderEditor({song: null})
      expect(editor.state.code).toEqual("c4 e4 g4")
      expect(storedDraft()).toEqual({title: "Old", code: "c4 e4 g4", middleC: "c4"})

      editor = renderEditor({song: null})
      expect(editor.state.code).toEqual("c4 e4 g4")
    })

    it("leaves a draft saved in the current numbering as it is", function() {
      window.localStorage.setItem(SONG_DRAFT_KEY, JSON.stringify({title: "New", code: "c5 e5", middleC: "c4"}))

      let editor = renderEditor({song: null})
      expect(editor.state.code).toEqual("c5 e5")
      expect(storedDraft()).toEqual({title: "New", code: "c5 e5", middleC: "c4"})
    })

    it("saves new drafts in the current numbering", function() {
      window.localStorage.removeItem(SONG_DRAFT_KEY)

      let editor = renderEditor({song: null})
      editor.updateCode("c4 d4")
      expect(storedDraft()).toEqual({code: "c4 d4", middleC: "c4"})

      expect(renderEditor({song: null}).state.code).toEqual("c4 d4")
    })
  })

  it("reports compressed files from their content", async function() {
    let editor = renderEditor({code: ""})

    await importText(editor, "score.mxl", "PK not really a zip")
    await nextRender()

    expect(editor.state.importError).toEqual(COMPRESSED_MESSAGE)
    expect(saveButton().disabled).toBe(false)
  })
})
