import * as React from "react"
import classNames from "classnames"
import Slider from "st/components/slider"
import Select from "st/components/select"
import {Pill} from "st/components/salon"
import {trigger} from "st/events"
import {
  generatorDefaultSettings, fixGeneratorSettings, storeGeneratorSettings, allKeySignatures,
  scoreKeySignature
} from "st/generators"
import styles from "./programme_drawer.module.css"

import {noteName, parseNote} from "st/music"
import * as types from "prop-types"

import {ENABLE_PRESETS, FRONTEND_ONLY} from "st/globals"

import {getSession} from "st/app"

// select inputs with at most this many short options render as choice pills
const MAX_PILL_OPTIONS = 4
const MAX_PILL_LABEL = 16

// eg. "Bb" -> "B♭"
export function keyLabel(key) {
  return key.isChromatic() ? key.name() : key.name().replace(/b$/, "♭")
}

export function generatorLabel(generator) {
  return generator.label || generator.name
}

export function staffLabel(staff) {
  return staff.name.charAt(0).toUpperCase() + staff.name.slice(1)
}

function SettingsGroup({label, aside, className, children}) {
  return <section className={classNames(styles.group, className)}>
    <div className={styles.group_header}>
      <span className={styles.group_label}>{label}</span>
      {aside != null ? <span className={styles.group_aside}>{aside}</span> : null}
    </div>
    {children}
  </section>
}

// The programme drawer: the settings for the sight reading trainer, sliding
// in from the left over a scrim. Settings apply as they are picked; "Take
// your seat" closes the drawer and regenerates the passage
export class ProgrammeDrawer extends React.PureComponent {
  static propTypes = {
    open: types.bool,
    close: types.func.isRequired,
    apply: types.func.isRequired,
    staves: types.array.isRequired,
    generators: types.array.isRequired,
    currentStaff: types.object,
    currentGenerator: types.object,
    currentGeneratorSettings: types.object,
    currentKey: types.object.isRequired,
    setStaff: types.func.isRequired,
    setGenerator: types.func.isRequired,
    setKeySignature: types.func.isRequired,
    mode: types.oneOf(["wait", "scroll"]),
    setMode: types.func.isRequired,
    scrollSpeed: types.number.isRequired,
    setScrollSpeed: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {}
    this.closeButton = React.createRef()
  }

  componentDidMount() {
    if (ENABLE_PRESETS) {
      this.loadPresets()
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.open && !prevProps.open && this.closeButton.current) {
      this.closeButton.current.focus({preventScroll: true})
    }
  }

  render() {
    let open = !!this.props.open

    return <>
      <div
        className={classNames(styles.scrim, {[styles.open]: open})}
        aria-hidden="true"
        onClick={this.props.close} />

      <aside
        className={classNames(styles.drawer, {[styles.open]: open})}
        aria-label="Programme"
        aria-hidden={!open}
        onKeyDown={e => {
          if (e.key == "Escape") {
            this.props.close()
          }
        }}>
        <div className={styles.drawer_header}>
          <span className={styles.drawer_title}>
            Programme<span className={styles.drawer_ornament} aria-hidden="true">❧</span>
          </span>
          <button
            type="button"
            ref={this.closeButton}
            className={styles.close_button}
            aria-label="Close the programme"
            onClick={this.props.close}>×</button>
        </div>

        <div className={styles.drawer_rule} />

        <div className={styles.drawer_body}>
          {this.renderPresets()}

          <SettingsGroup label="Clef">
            {this.renderStaves()}
          </SettingsGroup>

          {this.props.currentStaff ?
            <SettingsGroup label="Exercise" className={styles.exercise_group}>
              {this.renderGenerators()}
            </SettingsGroup> : null}

          <SettingsGroup label="Tempo" aside={this.props.scrollSpeed}>
            {this.renderTempo()}
          </SettingsGroup>

          <SettingsGroup label="Key">
            {this.renderKeys()}
          </SettingsGroup>

          <Pill
            variant="primary"
            className={styles.apply_button}
            onClick={this.props.apply}>Take your seat</Pill>

          <Pill
            variant="ghost"
            className={styles.apply_button}
            to="/setup">Set programme</Pill>
        </div>
      </aside>
    </>
  }

  savePreset(e) {
    e.preventDefault()
    trigger(this, "saveGeneratorPreset", this.refs.presetForm)
  }

  loadPresets() {
    const session = getSession()
    if (!session || !session.currentUser) { return }

    this.setState({
      loadingPresets: true
    })

    let request = new XMLHttpRequest()
    request.open("GET", "/presets.json")
    request.send()
    request.onload = (e) => {
      try {
        let res = JSON.parse(request.responseText)
        this.setState({
          loadingPresets: false,
          presets: res.presets
        })
      } catch (e) {
        this.setState({loadingPresets: false})
      }
    }

  }

  renderPresets() {
    if (!ENABLE_PRESETS) { return }

    const session = getSession()

    if (!session || !session.currentUser) { return }

    var presetsPicker

    if (this.state.presets && this.state.presets.length) {
      presetsPicker = <div className="presetsPicker">
        <Select
          className={styles.select_component}
          name="preset"
          options={this.state.presets.map(p => ({
              name: p.name,
              value: p.name
            }))
          }
        />
      </div>
    }

    return <SettingsGroup label="Presets">
      {presetsPicker}
      <form onSubmit={this.savePreset.bind(this)} ref="presetForm">
        <label>
          Name
          <input type="text" name="name" />
        </label>
        <button disabled={this.props.savePreset || false}>Save preset</button>
      </form>
    </SettingsGroup>
  }

  renderStaves() {
    return <div className={styles.pills}>
      {
        this.props.staves.map(staff =>
          <Pill
            variant="choice"
            key={staff.name}
            selected={this.props.currentStaff == staff}
            onClick={e => {
              e.preventDefault()
              this.props.setStaff(staff)
            }}>{staffLabel(staff)}</Pill>
        )
      }
    </div>
  }

  renderGenerators() {
    let generators = this.props.generators.filter(generator =>
      !generator.debug && generator.mode == this.props.currentStaff.mode
    )

    return <ul className={styles.exercise_list}>
      {
        generators.map(generator => {
          let selected = this.props.currentGenerator == generator

          return <li
            key={generator.name}
            className={classNames(styles.exercise, {[styles.selected]: selected})}>
            <button
              type="button"
              className={styles.exercise_row}
              aria-pressed={selected}
              onClick={e => {
                e.preventDefault()
                this.props.setGenerator(
                  generator,
                  fixGeneratorSettings(generator, this.props.currentGeneratorSettings)
                )
              }}>
              <span className={styles.exercise_name}>{generatorLabel(generator)}</span>
              {selected ? <span className={styles.exercise_mark} aria-hidden="true">❖</span> : null}
            </button>
            {selected ? this.renderGeneratorInputs() : null}
          </li>
        })
      }
    </ul>
  }

  renderGeneratorInputs() {
    let g = this.props.currentGenerator
    if (!g.inputs || !g.inputs.length) return
    return <GeneratorSettings
      key={`${g.name}-${g.mode}`}
      generator={g}
      currentKey={this.props.currentKey}
      currentStaff={this.props.currentStaff}
      currentSettings={this.props.currentGeneratorSettings}
      staves={this.props.staves}
      setStaff={this.props.setStaff}
      setGenerator={this.props.setGenerator} />
  }

  // the page's wait or scroll mode and scroll speed. The speed applies when
  // scroll mode is entered, so it is fixed while scrolling
  renderTempo() {
    return <>
      <div className={styles.pills}>
        {[["wait", "Wait"], ["scroll", "Scroll"]].map(([mode, label]) =>
          <Pill
            variant="choice"
            key={mode}
            selected={this.props.mode == mode}
            onClick={() => this.props.setMode(mode)}>{label}</Pill>
        )}
      </div>

      <div className={styles.tempo_track}>
        <Slider
          className={styles.gilt_slider}
          min={50}
          max={300}
          disabled={this.props.mode == "scroll"}
          onChange={value => this.props.setScrollSpeed(Math.round(value))}
          value={+this.props.scrollSpeed} />
      </div>

      <div className={styles.tempo_legend} aria-hidden="true">
        <span>Largo</span>
        <span>Presto</span>
      </div>
    </>
  }

  renderKeys() {
    let keys = allKeySignatures()
    let scoreKey = scoreKeySignature(
      this.props.currentGenerator, this.props.currentStaff, this.props.currentGeneratorSettings
    )
    let currentKey = scoreKey || this.props.currentKey

    return <>
      <div className={styles.pills}>
        {
          keys.map(key =>
            <Pill
              variant="choice"
              key={key.name()}
              className={classNames(styles.key_pill, {[styles.chromatic]: key.isChromatic()})}
              selected={currentKey.name() == key.name()}
              disabled={!!scoreKey}
              onClick={() => this.props.setKeySignature(key)}>{keyLabel(key)}</Pill>
          )
        }
      </div>
      {scoreKey ? <div className={styles.input_hint}>Set by the score</div> : null}
    </>
  }
}

export class GeneratorSettings extends React.PureComponent {
  static propTypes = {
    generator: types.object.isRequired,
    currentSettings: types.object.isRequired,
    setGenerator: types.func.isRequired,
    currentKey: types.object.isRequired,
    currentStaff: types.object.isRequired,
    staves: types.array,
    setStaff: types.func,
    // class names by this panel's style names, used in place of its styles
    // when the inputs are rendered outside the panel, eg. on the setup page
    classes: types.object,
  }

  constructor(props) {
    super(props)
    this.state = {}
  }

  // this panel's styles for any class name the passed classes don't define
  get styles() {
    return this.props.classes ? {...styles, ...this.props.classes} : styles
  }

  componentDidMount() {
    // text inputs flagged with library can be filled from the play along
    // song library, which needs a backend and a logged in user
    if (FRONTEND_ONLY) { return }
    const session = getSession()
    if (!session || !session.currentUser) { return }

    if ((this.props.generator.inputs || []).some(input => input.library)) {
      this.loadSongLibrary()
    }
  }

  render() {
    // calculate full settings with defaults
    this.cachedSettings = {
      ...generatorDefaultSettings(
        this.props.generator,
        this.props.currentStaff,
      ),
      ...this.props.currentSettings
    }

    let inputs = this.props.generator.inputs

    return <div className={this.styles.generator_inputs}>{
      inputs.map((input, idx) => {
        // inputs can depend on the other settings, eg. the sheet music track
        // picker is only for pasted notation
        if (input.visible && !input.visible(this.cachedSettings)) {
          return
        }

        let fn
        switch (input.type) {
          case "select":
            fn = this.renderSelect
            break
          case "range":
            fn = this.renderRange
            break
          case "noteRange":
            fn = this.renderNoteRange
            break
          case "note":
            fn = this.renderNote
            break
          case "bool":
            fn = this.renderBool
            break
          case "toggles":
            fn = this.renderToggles
            break
          case "text":
            fn = this.renderText
            break
          case "number":
            fn = this.renderNumber
            break
          case "deck":
            fn = this.renderDeck
            break
          default:
            console.error(`No input renderer for ${input.type}`)
            return
        }

        // multi control inputs are not wrapped in a label so clicking the
        // label text does not focus an arbitrary control
        let el = ["toggles", "text", "deck", "select", "noteRange"].includes(input.type) ? "div" : "label"

        let inside = React.createElement(el, null, ...[
          <div className={this.styles.input_label}>{input.label || input.name}</div>,
          fn.call(this, input, idx)
        ])

        return <div key={input.name} className={this.styles.generator_input}>
          {inside}
        </div>
      })
    }{this.renderStatus()}</div>
  }

  // generators can describe their current configuration under the inputs
  renderStatus() {
    let g = this.props.generator
    if (!g.status) { return }

    let text = g.status(this.props.currentStaff, this.cachedSettings)
    if (!text) { return }

    return <div className={this.styles.generator_status}>{text}</div>
  }

  updateInputValue(input, value) {
    this.updateSettings({[input.name]: value})
  }

  updateSettings(update) {
    let generator = this.props.generator

    if (generator.storageKey) {
      storeGeneratorSettings(generator.storageKey, {
        ...this.cachedSettings,
        ...update
      })
    }

    this.props.setGenerator(generator, {
      ...this.props.currentSettings,
      ...update
    })
  }

  renderSelect(input, idx) {
    let currentValue = this.cachedSettings[input.name]

    // option lists can depend on the other settings
    let values = typeof input.values == "function" ?
      input.values(this.cachedSettings) : input.values

    let options = values.map((input_val, input_val_idx) => {
      return {
        name: input_val.name,
        value: input_val.name,
      }
    })

    if (!options.some(o => o.value == currentValue)) {
      currentValue = options[0].value
    }

    // a few short choices are pills, longer lists keep the select
    if (options.length <= MAX_PILL_OPTIONS && options.every(o => o.name.length <= MAX_PILL_LABEL)) {
      return <div className={this.styles.pills} role="group" aria-label={input.label || input.name}>
        {options.map(option =>
          <Pill
            variant="choice"
            key={option.value}
            className={this.styles.small_pill}
            selected={option.value == currentValue}
            onClick={() => {
              if (option.value != currentValue) {
                this.updateInputValue(input, option.value)
              }
            }}>{option.name}</Pill>
        )}
      </div>
    }

    return <Select
      className={this.styles.select_component}
      onChange={ value => this.updateInputValue(input, value) }
      value={currentValue}
      options={options} />
  }

  // the raw text is kept while it does not parse (eg. emptied to retype) and
  // the clamped number is committed as soon as it does
  renderNumber(input, idx) {
    let drafts = this.state.drafts || {}
    let draft = drafts[input.name]
    let currentValue = this.cachedSettings[input.name]

    let setDraft = text => this.setState({
      drafts: {...drafts, [input.name]: text}
    })

    let hint = typeof input.hint == "function" ?
      input.hint(this.cachedSettings) : input.hint

    let numberInput = <input
      type="number"
      className={this.styles.number_input}
      min={input.min}
      max={input.max}
      value={draft != null ? draft : (currentValue == null ? "" : currentValue)}
      onBlur={() => setDraft(null)}
      onChange={e => {
        let text = e.target.value
        let value = parseInt(text, 10)
        if (isNaN(value)) {
          setDraft(text)
          return
        }
        if (input.min != null) { value = Math.max(input.min, value) }
        if (input.max != null) { value = Math.min(input.max, value) }
        setDraft(null)
        this.updateInputValue(input, value)
      }} />

    if (!hint) {
      return numberInput
    }

    return <>
      {numberInput}
      <div className={this.styles.input_hint}>{hint}</div>
    </>
  }

  // A picker of the pieces imported into a deck (see st/sheet_music_deck),
  // with a MusicXML file import, removal of the picked piece, and export and
  // import of the whole library. Picking an empty value leaves the deck, eg.
  // for the sheet music generator's pasted notation. The input provides the
  // deck through a synchronous pieces function, the async importFile,
  // removePiece, exportLibrary and importLibrary functions, and pick.
  renderDeck(input, idx) {
    let pieces = input.pieces()
    let currentValue = this.cachedSettings[input.name] || ""

    if (!pieces.some(piece => piece.id == currentValue)) {
      currentValue = ""
    }

    let options = [{name: input.emptyLabel || "None", value: ""}].concat(
      pieces.map(piece => ({name: piece.title, value: piece.id}))
    )

    let message = this.state.deckMessage

    return <div className={this.styles.deck_input}>
      <div className={this.styles.deck_row}>
        <Select
          className={this.styles.select_component}
          value={currentValue}
          options={options}
          onChange={id => {
            this.setState({deckMessage: null})
            this.pickPiece(input, id)
          }} />
        {currentValue ?
          <Pill
            variant="ghost"
            className={this.styles.small_pill}
            onClick={() => {
              let piece = pieces.find(piece => piece.id == currentValue)
              input.removePiece(currentValue).then(result => {
                if (result.error) {
                  this.setState({deckMessage: {error: true, text: result.error}})
                  return
                }
                this.setState({deckMessage: {text: `Removed "${piece.title}" from the deck`}})
                this.pickPiece(input, "")
              })
            }}>Remove</Pill> : null}
      </div>
      <div className={this.styles.deck_actions}>
        <label className={this.styles.file_input}>
          <span className={this.styles.file_pill}>Import MusicXML</span>
          <input
            type="file"
            accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
            onChange={e => this.importPiece(input, e)} />
        </label>
        {input.exportLibrary ?
          <Pill
            variant="ghost"
            className={this.styles.small_pill}
            onClick={() => this.exportLibrary(input)}>Export library</Pill> : null}
        {input.importLibrary ?
          <label className={this.styles.file_input}>
            <span className={this.styles.file_pill}>Import library</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={e => this.importLibrary(input, e)} />
          </label> : null}
      </div>
      {message ?
        <div className={message.error ? this.styles.input_error : this.styles.input_notice}>{message.text}</div> : null}
      {input.hint ? <div className={this.styles.input_hint}>{input.hint}</div> : null}
    </div>
  }

  importPiece(input, e) {
    let file = e.target.files && e.target.files[0]
    if (!file) { return }

    // let the same file be picked again
    e.target.value = ""

    this.setState({deckMessage: {text: `Importing ${file.name}…`}})

    return file.text().then(text => {
      return input.importFile(file.name, text).then(result => {
        if (result.error) {
          this.setState({deckMessage: {error: true, text: result.error}})
          return
        }

        let text = `"${result.piece.title}" is in the deck`
        this.setState({deckMessage: {text: result.warning ? `${text}. ${result.warning}` : text}})
        this.pickPiece(input, result.piece.id)
      })
    }, err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  // downloads the library file, see exportLibraryFile in st/sheet_music_deck
  exportLibrary(input) {
    return input.exportLibrary().then(result => {
      if (result.error) {
        this.setState({deckMessage: {error: true, text: result.error}})
        return
      }

      let url = URL.createObjectURL(new Blob([result.text], {type: "application/json"}))
      let link = document.createElement("a")
      link.href = url
      link.download = result.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      this.setState({deckMessage: {text: `Exported ${result.pieces} piece${result.pieces == 1 ? "" : "s"} to ${result.fileName}`}})
    })
  }

  importLibrary(input, e) {
    let file = e.target.files && e.target.files[0]
    if (!file) { return }

    // let the same file be picked again
    e.target.value = ""

    this.setState({deckMessage: {text: `Importing ${file.name}…`}})

    return file.text().then(text => {
      return input.importLibrary(text).then(result => {
        if (result.error) {
          this.setState({deckMessage: {error: true, text: result.error}})
          return
        }

        let text = result.warning ? `${result.message}. ${result.warning}` : result.message
        this.setState({deckMessage: {text}})
      })
    }, err => {
      this.setState({deckMessage: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  pickPiece(input, id) {
    if (!id) {
      this.updateSettings({[input.name]: ""})
      return
    }

    let {settings, staff} = input.pick(this.cachedSettings, id)
    this.updateSettings(settings)

    // eg. the grand staff for a piece with both hands, so neither is skipped
    let singleStaff = ["treble", "bass"].includes(this.props.currentStaff.name)
    let staffObj = staff && (this.props.staves || []).find(s => s.name == staff)
    if (singleStaff && staffObj && this.props.setStaff && this.props.currentStaff != staffObj) {
      this.props.setStaff(staffObj)
    }
  }

  renderText(input, idx) {
    let currentValue = this.cachedSettings[input.name] || ""

    return <div className={this.styles.text_input_row}>
      {input.library ? this.renderSongLibrary(input) : null}
      <textarea
        className={this.styles.text_input}
        aria-label={input.label || input.name}
        rows={8}
        spellCheck={false}
        value={currentValue}
        onChange={e => this.updateInputValue(input, e.target.value)} />
      {input.hint ? <div className={this.styles.input_hint}>{input.hint}</div> : null}
    </div>
  }

  // pick a song from the play along library to fill the text input, see
  // componentDidMount for when the library is loaded. The public list is the
  // library's first page only (its newest songs)
  renderSongLibrary(input) {
    let library = this.state.songLibrary
    if (!library) { return }

    let groups = [
      ["your songs", library.mySongs],
      ["recent public songs", library.publicSongs],
    ]

    return groups.map(([label, songs]) => {
      if (!songs.length) { return }

      let options = [{name: `Load from ${label}…`, value: ""}].concat(
        songs.map(song => ({name: song.title, value: String(song.id)}))
      )

      return <Select
        key={label}
        className={this.styles.select_component}
        value=""
        options={options}
        onChange={songId => {
          if (!songId) { return }
          let request = new XMLHttpRequest()
          request.open("GET", `/songs/${songId}.lml`)
          request.onload = () => {
            if (request.status == 200) {
              this.updateInputValue(input, request.responseText)
            }
          }
          request.send()
        }} />
    })
  }

  loadSongLibrary() {
    let request = new XMLHttpRequest()
    request.open("GET", "/songs.json")
    request.onload = () => {
      try {
        let res = JSON.parse(request.responseText)
        this.setState({songLibrary: {
          mySongs: res.my_songs || [],
          publicSongs: res.songs || [],
        }})
      } catch (e) {
        this.setState({songLibrary: null})
      }
    }
    request.send()
  }

  renderNote(input, idx) {
    let currentValue = this.cachedSettings[input.name]

    let options = []

    for (let i=input.max; i >= input.min; i--) {
      options.push(noteName(i))
    }

    return <Select
      className={this.styles.select_component}
      onChange={value => {
        this.updateInputValue(input, parseNote(value))
      }}
      value={noteName(currentValue)}
      options={options.map(name => ({ value: name, name }))}
    />
  }

  renderNoteRange(input, idx) {
    let currentValue = this.cachedSettings[input.name]
    let [min, max] = currentValue

    let possibleMin = []
    let possibleMax = []

    let staffMin, staffMax

    if (this.props.currentStaff) {
      let staff = this.props.currentStaff
      staffMin = parseNote(staff.range[0])
      staffMax = parseNote(staff.range[1])
    }

    for (let i=input.max; i >= input.min; i--) {
      let iName = noteName(i)

      if (i < staffMin) { continue }
      if (i > staffMax) { continue }

      if (i >= min) {
        possibleMax.push(iName)
      }

      if (i <= max) {
        possibleMin.push(iName)
      }
    }

    return <div className={this.styles.note_range_row}>
      <label>
        <span className={this.styles.sub_label}>Min</span>
        <Select
          className={this.styles.select_component}
          onChange={value => {
            this.updateInputValue(input, [
              parseNote(value),
              currentValue[1],
            ])
          }}
          value={noteName(currentValue[0])}
          options={possibleMin.map(name => ({ value: name, name }))}
        />
      </label>

      <label>
        <span className={this.styles.sub_label}>Max</span>
        <Select
          className={this.styles.select_component}
          onChange={value => {
            this.updateInputValue(input, [
              currentValue[0],
              parseNote(value),
            ])
          }}
          value={noteName(currentValue[1])}
          options={possibleMax.map(name => ({ value: name, name }))}
        />
      </label>
    </div>
  }

  renderRange(input, idx) {
    let currentValue = this.cachedSettings[input.name]

    return <div className={this.styles.slider_row}>
      <Slider
        className={this.styles.gilt_slider}
        min={input.min}
        max={input.max}
        onChange={(value) => this.updateInputValue(input, value)}
        value={currentValue} />
      <span className={this.styles.current_value}>{currentValue}</span>
    </div>
  }

  renderBool(input, idx) {
    let currentValue = !!this.cachedSettings[input.name]

    return <div className={this.styles.bool_row}>
      <input
        type="checkbox"
        checked={currentValue}
        onChange={e => this.updateInputValue(input, e.target.checked)} />
      {input.hint}
    </div>
  }

  renderToggles(input, idx) {
    let currentValue = this.cachedSettings[input.name] || {}

    return <div className={this.styles.pills} role="group" aria-label={input.label || input.name}>
      {input.options.map(subName =>
        <Pill
          variant="choice"
          key={subName}
          className={this.styles.small_pill}
          selected={!!currentValue[subName]}
          onClick={() =>
            this.updateInputValue(input, {...currentValue, [subName]: !currentValue[subName]})
          }>{subName}</Pill>
      )}
    </div>
  }
}
