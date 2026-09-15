import * as React from "react"
import {shiftNotationOctaves} from "st/song_parser"

import {TextInputRow} from "st/components/forms"

import styles from "st/components/song_editor.module.css"

import { KeySignature } from "st/music"
import {readConfig, writeConfig} from "st/config"
import {parseMusicXML, MusicXMLError} from "st/musicxml"
import {serializeSong, SerializeError} from "st/song_serializer"

export const SONG_DRAFT_KEY = "wip:newSong"

// The song being written in the editor, in the current numbering. Drafts
// without middleC were written with middle C as c5 and are renumbered, and
// saved, the first time they're read
export function readSongDraft() {
  let draft = readConfig(SONG_DRAFT_KEY)
  if (draft && draft.middleC != "c4") {
    draft = {
      ...draft,
      middleC: "c4",
      code: typeof draft.code == "string" ? shiftNotationOctaves(draft.code, -1) : draft.code,
    }
    writeConfig(SONG_DRAFT_KEY, draft)
  }

  return draft
}

export default class SongEditor extends React.Component {
  constructor(props) {
    super(props)

    this.codeInputRef = React.createRef()

    this.fieldUpdaters = {
      code: e => this.updateCode(e.target.value)
    }

    this.importFile = this.importFile.bind(this)

    let initial = readSongDraft()
    // render the initial song
    if (initial) {
      window.setTimeout(() => {
        if (this.state.code == initial.code) {
          if (this.props.onCode) {
            this.props.onCode(initial.code)
          }
        }
      }, 0)
    }

    this.state = {
      title: initial ? initial.title : "",
      code: this.props.code || (initial ? initial.code : null) || "",
      source: initial ? initial.source : "",
      album: initial ? initial.album : "",
      artist: initial ? initial.artist : "",
    }
  }

  updateCode(code, callback) {
    this.setState({ code }, callback)
    this.updateWip({ code })

    if (this.props.onCode) {
      this.props.onCode(code)
    }
  }

  // Loads a MusicXML file into the player. When the imported rhythm can be
  // written in the editor's notation the generated code replaces the editor
  // contents so the song can be edited; otherwise the song is only played.
  importFile(e) {
    let file = e.target.files && e.target.files[0]
    if (!file) {
      return
    }

    // let the same file be picked again
    e.target.value = ""

    this.setState({importError: null})

    return file.text().then(text => {
      let song
      try {
        song = parseMusicXML(text)
      } catch (err) {
        let message = err instanceof MusicXMLError ? err.message : `Failed to import: ${err.message}`
        this.setState({importError: message})
        return
      }

      let code = null
      try {
        code = serializeSong(song)
      } catch (err) {
        if (!(err instanceof SerializeError)) {
          this.setState({importError: `Failed to import: ${err.message}`})
          return
        }
      }

      if (this.props.onImportSong) {
        this.props.onImportSong(song, code == null ? this.state.code : code, code != null)
      }

      if (code != null) {
        this.updateCode(code)
      }

      if (!this.state.title && song.metadata && song.metadata.title) {
        let update = {title: song.metadata.title}
        this.setState(update)
        this.updateWip(update)
      }
    }, err => {
      this.setState({importError: `Failed to read file: ${err.message}`})
    })
  }

  updateWip(update) {
    writeConfig(SONG_DRAFT_KEY, {...readSongDraft(), ...update, middleC: "c4"})
  }

  render() {
    return <div className={styles.song_editor}>
      <textarea
        ref={this.codeInputRef}
        placeholder="Type some LML"
        value={this.state.code}
        onChange={this.fieldUpdaters.code}></textarea>

      <div className={styles.song_editor_tools}>
        <div className={styles.import_row}>
          <label>
            <div className={styles.import_label}>Import MusicXML</div>
            <input
              type="file"
              accept=".xml,.musicxml,.mxl,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
              onChange={this.importFile} />
          </label>
          {this.state.importError ?
            <div className={styles.import_error}>{this.state.importError}</div> : null}
          {this.props.importUnsaveable ?
            <div className={styles.import_notice}>This piece uses rhythms the editor's notation can't express, so it plays from the imported file until you edit the notation.</div> : null}
        </div>
        {this.textInput("Title", "title")}
        {this.textInput("Source", "source")}
        {this.textInput("Artist", "artist")}
        {this.textInput("Album", "album")}
      </div>
    </div>
  }

  textInput(title, field) {
    if (!this.fieldUpdaters[field]) {
      this.fieldUpdaters[field] = e => {
        let update = {
          [field]: e.target.value
        }
        this.setState(update)
        this.updateWip(update)
      }
    }

    return <TextInputRow
      onChange={this.fieldUpdaters[field]}
      value={this.state[field] || ""}
      name={field}
      >{title}</TextInputRow>
  }

  pressNote(note) {
    let input = this.codeInputRef.current
    if (!input) {
      return
    }

    let code = this.state.code

    let selectionStart = input.selectionStart
    let selectionEnd = input.selectionEnd

    let before = code.substring(0, input.selectionStart)
    let after = code.substring(input.selectionEnd, code.length)

    let keySignature = KeySignature.forCount(0)
    if (this.props.songNotes && this.props.songNotes.metadata) {
      keySignature = KeySignature.forCount(this.props.songNotes.metadata.keySignature || 0)
    }

    let [, noteName, , octave] = note.match(/([A-G])(#|b)?(\d+)/)

    let accidental = ""
    switch (keySignature.accidentalsForNote(note)) {
      case 0: {
        accidental = "="
        break
      }
      case 1: {
        accidental = "-"
        break
      }
      case -1: {
        accidental = "+"
        break
      }
    }

    let noteCode = noteName.toLowerCase() + accidental + octave

    if (before && !before.match(/\s$/)) {
      noteCode = " " + noteCode
    }

    if (after && !after.match(/^\s/)) {
      noteCode = noteCode + " "
    }

    this.updateCode(before + noteCode + after, () => {
      // make the modification using execCommand to ensure undo works
      input.value = code
      input.selectionStart = selectionStart
      input.selectionEnd = selectionEnd
      input.focus()
      document.execCommand("insertText", false, noteCode)
    })
  }
}
