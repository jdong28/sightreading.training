// The instructor's review of a piece's flagged passages (stage 3, mockup
// screen III): a right-hand SidePane opened from the passages plate's
// glance row ("Review") or its detail plate ("Edit"). Every decision made
// here (st/difficulty/decisions) lives in the piece's annotation, which a
// new analysis never overwrites.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {Plate, Pill, StatCard} from "st/components/salon"
import {BarStrip} from "st/components/bar_strip"
import NumberPicker from "st/components/number_picker"
import {ScoreCard} from "st/components/score_card"
import {SidePane} from "st/components/sight_reading/settings_panel"
import {barsLabel, barsHeading} from "st/music"
import {measureNumberList, measureNumberRange, measureIndexRange, staffTracks} from "st/song_sections"
import {sheetMusicPiece} from "st/data"
import {
  pieceSong, ensureAnnotation, decideFlags, exportFlagsFile, importFlagsFile,
} from "st/sheet_music_deck"
import {getAppStore} from "st/storage"
import {heat as heatLevel} from "st/difficulty/sections"
import {LEVEL_WORDS, FLAG_KINDS, KIND_WORDS} from "st/difficulty/index"
import {
  reviewFlags, acceptDecision, editDecision, dismissDecision, restoreDecision, addDecision,
  promoteTroubleSpot,
} from "st/difficulty/decisions"
import {inForce as flagInForce, safeUrl} from "st/difficulty/records"
import {troubleSpots} from "st/difficulty/trouble"

import styles from "./review_pane.module.css"

// the reviewer's own name, remembered per browser so a decision and the
// flags file both carry it without asking every time
const NAME_KEY = "st:flags_name:v1"

function readName(storage = window.localStorage) {
  try {
    return storage.getItem(NAME_KEY) || ""
  } catch (e) {
    return ""
  }
}

function storeName(name, storage = window.localStorage) {
  try {
    storage.setItem(NAME_KEY, name)
  } catch (e) {
    // the name just isn't remembered next time
  }
}

const HAND_LABEL = {both: "Both", upper: "Right", lower: "Left"}
const SOURCE_CHIP = {score: "Score", teacher: "Teacher", player: "You", claude: "Claude"}

// how Claude says the score analysis sees a passage it proposed
const AGREEMENT_WORDS = {
  agrees: "Score analysis agrees",
  "in part": "Score analysis agrees in part",
  disagrees: "Score analysis ranks it easier",
  new: "New to the score analysis",
}

// how a queue card reads the decided-ness of a flag
function statusWords(flag, viewerName) {
  let by = !flag.by || flag.by == viewerName ? "you" : flag.by
  switch (flag.status) {
    case "waiting": return "Waiting for you"
    case "accepted": return "❖ Accepted"
    case "edited": return `❖ Edited by ${by}`
    case "added": return `❖ Added by ${by}`
    case "dismissed": return "Dismissed"
    default: return ""
  }
}

// waiting (and unplaced/check, which wait for a decision too) first, then
// hardest first, then score order
function queuePriority(flag) {
  if (flag.place == "unplaced" || flag.place == "check") { return 0 }
  return flag.status == "waiting" ? 0 : 1
}

function queueOrder(a, b) {
  if (queuePriority(a) != queuePriority(b)) { return queuePriority(a) - queuePriority(b) }
  if (b.level != a.level) { return b.level - a.level }
  return a.start - b.start
}

function placeLine(flag) {
  if (flag.place == "moved" && flag.movedFrom) {
    let who = flag.movedFrom.by ? `${flag.movedFrom.by}’s` : "the other"
    return `Moved from ${barsLabel(flag.movedFrom.start, flag.movedFrom.end)} in ${who} copy`
  }
  if (flag.place == "check") { return "These bars' notes changed since this was decided: check it" }
  if (flag.place == "unplaced") { return "Couldn't find these bars in your copy" }
  return null
}

const SIDE_BY_SIDE_WIDTH = 900
const PREVIEW_DEBOUNCE_MS = 300

export class ReviewPane extends React.Component {
  static propTypes = {
    settings: types.object.isRequired,
    setSettings: types.func.isRequired,
    source: types.object,
    engine: types.string,
    loadEngines: types.func,
    store: types.object,
    open: types.bool,
    close: types.func.isRequired,
    // a flag the caller wants the editor to open on (eg. "Edit" on the
    // rail's detail plate), applied whenever it changes while open
    initialFlagId: types.string,
    paneRef: types.object,
  }

  constructor(props) {
    super(props)
    this.state = {
      name: readName(),
      selectedId: props.initialFlagId || null,
      draft: props.initialFlagId ? this.draftForId(props.initialFlagId) : null,
      picking: false,
      paneWidth: 0,
      previewWidth: 0,
      previewRange: null,
      previewFailed: false,
      message: null,
    }
    this.paneRef = React.createRef()
    this.previewRef = React.createRef()
    this.previewTimer = null
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.open && !prevProps.open) {
      this.observeWidth()
      this.observePreviewWidth()
    }

    if (this.props.initialFlagId && this.props.initialFlagId != prevProps.initialFlagId) {
      this.select(this.props.initialFlagId)
    }

    let draft = this.state.draft
    let previous = prevState.draft
    if (draft && previous && (draft.start != previous.start || draft.end != previous.end)) {
      this.scheduleDebouncedPreview()
    } else if (draft && !previous) {
      this.setState({previewRange: {from: draft.start, to: draft.end}, previewFailed: false})
    } else if (!draft && previous) {
      this.setState({previewRange: null})
    }

    this.observePreviewWidth()
  }

  componentWillUnmount() {
    this.unmounted = true
    if (this.previewTimer) { clearTimeout(this.previewTimer) }
    if (this.resizeObserver) { this.resizeObserver.disconnect() }
    if (this.previewResizeObserver) { this.previewResizeObserver.disconnect() }
  }

  getStore() {
    return this.props.store || getAppStore()
  }

  observeWidth() {
    let el = this.paneRef.current
    if (!el || el == this.observedEl) { return }
    this.observedEl = el

    let initial = el.getBoundingClientRect().width
    if (initial) { this.setState({paneWidth: initial}) }

    if (typeof ResizeObserver == "undefined") { return }
    if (this.resizeObserver) { this.resizeObserver.disconnect() }
    this.resizeObserver = new ResizeObserver(entries => {
      let width = entries[0] && entries[0].contentRect.width
      if (width && width != this.state.paneWidth) { this.setState({paneWidth: width}) }
    })
    this.resizeObserver.observe(el)
  }

  observePreviewWidth() {
    let el = this.previewRef.current
    if (!el || el == this.observedPreviewEl) { return }
    this.observedPreviewEl = el

    let initial = el.getBoundingClientRect().width
    if (initial) { this.setState({previewWidth: initial}) }

    if (typeof ResizeObserver == "undefined") { return }
    if (this.previewResizeObserver) { this.previewResizeObserver.disconnect() }
    this.previewResizeObserver = new ResizeObserver(entries => {
      let width = entries[0] && entries[0].contentRect.width
      if (width && width != this.state.previewWidth) { this.setState({previewWidth: width}) }
    })
    this.previewResizeObserver.observe(el)
  }

  scheduleDebouncedPreview() {
    if (this.previewTimer) { clearTimeout(this.previewTimer) }
    this.previewTimer = setTimeout(() => {
      if (this.unmounted || !this.state.draft) { return }
      this.setState({
        previewRange: {from: this.state.draft.start, to: this.state.draft.end},
        previewFailed: false,
      })
    }, PREVIEW_DEBOUNCE_MS)
  }

  piece() {
    return sheetMusicPiece(this.props.settings)
  }

  song() {
    let piece = this.piece()
    return piece && pieceSong(piece)
  }

  record() {
    let piece = this.piece()
    return piece && this.getStore().annotation(piece.id)
  }

  flags() {
    return reviewFlags(this.record())
  }

  // the player's trouble spots, leaving out the bars of the flags given: the
  // suggestion plate leaves out what is already flagged, the queue card's
  // evidence line leaves out nothing, since the bar it wants evidence for is
  // flagged by definition
  troubleList(flags) {
    let piece = this.piece()
    let song = this.song()
    if (!piece || !song) { return [] }

    return troubleSpots({
      pieceId: piece.id,
      items: this.getStore().items(piece.id),
      measures: measureNumberList(song),
      flags,
    })
  }

  // evidence is the unfiltered list render worked out once: it reads every
  // item of the piece, so no queue card computes its own
  evidenceFor(flag, evidence) {
    let overlap = evidence.find(spot => spot.start <= flag.end && spot.end >= flag.start)
    return overlap ? overlap.text : null
  }

  draftForId(id) {
    let flag = this.flags().find(f => f.id == id)
    return flag ? this.draftFor(flag) : null
  }

  // Every bar range a draft holds, from wherever it came: clamped to the
  // piece and with the indices that range really has. The editor's pickers
  // clamp for display only, and a flag's own range can be the exporting
  // copy's (an unplaced one), so Save writes exactly what the editor shows.
  draftRange(start, end) {
    let song = this.song()
    let [minBar, maxBar] = measureNumberRange(song)
    let from = Math.max(minBar, Math.min(maxBar, start))
    let to = Math.max(from, Math.min(maxBar, end))
    let [startIndex, endIndex] = measureIndexRange(song, from, to)
    return {start: from, end: to, startIndex, endIndex}
  }

  draftFor(flag) {
    let teacherLine = flag.lines.find(line => line.source == "teacher")

    return {
      ...this.draftRange(flag.start, flag.end),
      hand: flag.hand, level: flag.level, kinds: flag.kinds,
      title: flag.givenTitle !== undefined ? flag.title : "",
      reason: teacherLine ? teacherLine.text : "",
      tip: flag.tip,
      apart: flag.apart,
    }
  }

  // ---- writing decisions ----

  // every write goes through here, so the piece's annotation is ensured once
  // for all of them: the plate keeps the review open for a trouble-spot
  // suggestion alone, with no record needed, and a decision built against
  // none is rejected by the store
  save(build) {
    let piece = this.piece()
    if (!piece) { return Promise.resolve() }

    let store = this.getStore()
    return ensureAnnotation(piece.id, store).then(record => {
      if (!record) {
        this.setState({message: {
          error: true, text: "Couldn't save your decision: this piece's score hasn't been analysed.",
        }})
        return
      }

      return decideFlags(piece.id, [build(record)], store).then(result => {
        if (result.error) {
          this.setState({message: {error: true, text: result.error}})
          return
        }
        this.props.setSettings({...this.props.settings})
      })
    })
  }

  decisionOpts() {
    return {by: this.state.name, at: Date.now()}
  }

  accept(flag) {
    this.save(record => acceptDecision({record, flag, ...this.decisionOpts()}))
  }

  dismiss(flag) {
    this.save(record => dismissDecision({record, flag, ...this.decisionOpts()}))
    if (flag.id == this.state.selectedId) { this.cancelEdit() }
  }

  restore(flag) {
    this.save(record => restoreDecision({record, flag, ...this.decisionOpts()}))
  }

  flagTheseBars(spot) {
    this.save(record => promoteTroubleSpot({record, spot, song: this.song(), by: "", at: Date.now()}))
  }

  saveDraft() {
    let draft = this.state.draft
    if (!draft) { return }

    if (draft.adding) {
      let flag = {
        start: draft.start, end: draft.end, startIndex: draft.startIndex, endIndex: draft.endIndex,
        hand: draft.hand, level: draft.level, kinds: draft.kinds,
        title: draft.title || "Marked passage", reason: draft.reason, tip: draft.tip, apart: draft.apart,
      }
      this.save(record => addDecision({record, flag, ...this.decisionOpts(), source: "teacher"})).then(() => {
        this.cancelEdit()
      })
      return
    }

    let flag = this.flags().find(f => f.id == this.state.selectedId)
    if (!flag) { return }

    let overrides = {
      start: draft.start, end: draft.end, startIndex: draft.startIndex, endIndex: draft.endIndex,
      hand: draft.hand, level: draft.level, kinds: draft.kinds,
      title: draft.title, reason: draft.reason, tip: draft.tip, apart: draft.apart,
    }
    this.save(record => editDecision({record, flag, overrides, ...this.decisionOpts()}))
  }

  useAnalysisName() {
    this.updateDraft({title: ""})
  }

  // ---- selection and editing ----

  select(id) {
    let draft = this.draftForId(id)
    if (!draft) { return }
    this.setState({selectedId: id, draft, picking: false})
  }

  // "Add a passage": opens the editor at once, on the selected flag's bars
  // or bar 1, so a keyboard user (the NumberPickers are keyboard-accessible)
  // never needs the strip; it also enables the strip's pick mode, so a
  // drag across it refines the range the same editor shows
  startPick() {
    let selected = this.flags().find(flag => flag.id == this.state.selectedId)
    let [minBar] = measureNumberRange(this.song())

    this.setState({
      picking: true,
      selectedId: null,
      draft: {
        adding: true,
        ...this.draftRange(selected ? selected.start : minBar, selected ? selected.end : minBar),
        hand: "both", level: 1, kinds: [], title: "", reason: "", tip: "", apart: false,
      },
    })
  }

  onPick(start, end) {
    this.setState({
      picking: false,
      selectedId: null,
      draft: {
        adding: true,
        ...this.draftRange(start, end),
        hand: "both", level: 1, kinds: [], title: "", reason: "", tip: "", apart: false,
      },
    })
  }

  updateDraft(fields) {
    this.setState({draft: {...this.state.draft, ...fields}})
  }

  toggleKind(kind) {
    let kinds = this.state.draft.kinds
    this.updateDraft({kinds: kinds.includes(kind) ? kinds.filter(k => k != kind) : [...kinds, kind]})
  }

  updateDraftRange(which, value) {
    let draft = this.state.draft
    let start = which == "start" ? Math.round(value) : draft.start
    let end = which == "end" ? Math.round(value) : draft.end
    if (which == "start") { end = Math.max(start, end) } else { start = Math.min(start, end) }

    this.updateDraft(this.draftRange(start, end))
  }

  cancelEdit() {
    this.setState({draft: null, selectedId: null, picking: false})
  }

  setName(name) {
    this.setState({name})
    storeName(name)
  }

  exportFlags(piece) {
    return exportFlagsFile(piece.id, {by: this.state.name}, this.getStore()).then(result => {
      if (result.error) {
        this.setState({message: {error: true, text: result.error}})
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

      this.setState({message: {text: `Exported ${result.fileName}`}})
    })
  }

  importFlags(piece, e) {
    let file = e.target.files && e.target.files[0]
    if (!file) { return }
    e.target.value = ""

    return file.text().then(text => importFlagsFile(text, this.getStore(), {pieceId: piece.id})).then(result => {
      if (result.error) {
        this.setState({message: {error: true, text: result.error}})
        return
      }
      this.setState({message: {text: result.message}})
      this.props.setSettings({...this.props.settings})
    }, err => {
      this.setState({message: {error: true, text: `Couldn't read ${file.name}: ${err.message || err}`}})
    })
  }

  // ---- render ----

  renderTally(flags) {
    let waiting = flags.filter(flag =>
      flag.status == "waiting" || flag.place == "check" || flag.place == "unplaced").length
    let counts = {
      accepted: flags.filter(flag => flag.status == "accepted").length,
      edited: flags.filter(flag => flag.status == "edited").length,
      added: flags.filter(flag => flag.status == "added").length,
      dismissed: flags.filter(flag => flag.status == "dismissed").length,
    }

    return <div className={styles.tally}>
      <StatCard label="Waiting for you" value={waiting} accent={waiting > 0} />
      <StatCard label="Accepted" value={counts.accepted} />
      <StatCard label="Edited" value={counts.edited} />
      <StatCard label="Added" value={counts.added} />
      <StatCard label="Dismissed" value={counts.dismissed} />
    </div>
  }

  renderTroubleSpots(list) {
    if (!list.length) { return null }

    return <Plate header="Your trouble spots" className={styles.trouble_plate}>
      <ul className={styles.trouble_list}>
        {list.map((spot, idx) =>
          <li key={idx} className={styles.trouble_item}>
            <div className={styles.trouble_bars}>{barsHeading(spot.start, spot.end)}</div>
            <p className={styles.trouble_text}>{spot.text}</p>
            <Pill variant="ghost" className={styles.small_pill} onClick={() => this.flagTheseBars(spot)}>
              Flag these bars
            </Pill>
          </li>)}
      </ul>
    </Plate>
  }

  renderActions(flag) {
    if (flag.status == "dismissed") {
      return <Pill variant="ghost" className={styles.small_pill} onClick={() => this.restore(flag)}>Restore</Pill>
    }

    if (flag.place == "unplaced") {
      return <>
        <Pill variant="primary" className={styles.small_pill} onClick={() => this.select(flag.id)}>Place it</Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.dismiss(flag)}>Dismiss</Pill>
      </>
    }

    if (flag.place == "check") {
      return <>
        <Pill variant="primary" className={styles.small_pill} onClick={() => this.accept(flag)}>
          Keep as it is
        </Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.select(flag.id)}>Edit</Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.dismiss(flag)}>Dismiss</Pill>
      </>
    }

    if (flag.status == "waiting") {
      return <>
        <Pill variant="primary" className={styles.small_pill} onClick={() => this.accept(flag)}>Accept</Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.select(flag.id)}>Edit</Pill>
        <Pill variant="ghost" className={styles.small_pill} onClick={() => this.dismiss(flag)}>Dismiss</Pill>
      </>
    }

    return <>
      <Pill variant="ghost" className={styles.small_pill} onClick={() => this.select(flag.id)}>Edit</Pill>
      <Pill variant="ghost" className={styles.small_pill} onClick={() => this.dismiss(flag)}>Dismiss</Pill>
    </>
  }

  renderQueueCard(flag, spots) {
    let selected = flag.id == this.state.selectedId
    let evidence = this.evidenceFor(flag, spots)
    let place = placeLine(flag)

    return <li key={flag.id} className={classNames(styles.queue_card, {[styles.on]: selected})}>
      <button type="button" className={styles.queue_card_button} onClick={() => this.select(flag.id)}>
        <div className={styles.queue_card_head}>
          <span className={classNames(styles.level_label, styles[`level_${flag.level}`])}>
            {LEVEL_WORDS[flag.level]}
          </span>
          <span className={styles.queue_card_bars}>{barsHeading(flag.start, flag.end)}</span>
        </div>
        <div className={styles.queue_card_title}>{flag.title}</div>
        {flag.givenTitle !== undefined &&
          <div className={styles.queue_card_given}>Renamed; the analysis called it “{flag.givenTitle}”</div>}
        <div className={styles.queue_card_status}>{statusWords(flag, this.state.name)}</div>
        {flag.lines[0] && <p className={styles.queue_card_line}>{flag.lines[0].text}</p>}
        <div className={styles.source_chips}>
          {flag.sources.map(source =>
            <span key={source} className={classNames(styles.source_chip, {[styles.source_chip_claude]: source == "claude"})}>
              {SOURCE_CHIP[source] || source}
            </span>)}
        </div>
        {place && <p className={styles.place_line}>{place}</p>}
        {evidence && <p className={styles.trouble_line}>From your playing: {evidence}</p>}
      </button>
      {this.renderClaudeDetails(flag)}
      <div className={styles.queue_actions}>{this.renderActions(flag)}</div>
    </li>
  }

  // what Claude brought to a passage it proposed: its reading of the score
  // analysis, the bars it named when the notes it quoted were elsewhere, and
  // its sources, which the app has never opened ("not yet verified"). Drawn
  // after the card's button, never inside it (a link can't sit in a button),
  // and as React text only: every word of it is Claude's, not ours.
  renderClaudeDetails(flag) {
    let note = flag.claude
    let citations = (flag.citations || []).filter(citation => safeUrl(citation.url))
    if (!note && !citations.length) { return null }

    let agreement = note && AGREEMENT_WORDS[note.analysis]
    let shifted = note && note.shift && note.claimed

    return <div className={styles.claude_details}>
      {agreement && <p className={styles.claude_line}>
        {agreement}{note.analysisNote ? ` · ${note.analysisNote}` : ""}
      </p>}
      {shifted && <p className={styles.claude_line}>
        Claude named {barsLabel(note.claimed.start, note.claimed.end)}; the notes it quoted are
        in {barsLabel(flag.start, flag.end)}
      </p>}
      {citations.length > 0 && <ul className={styles.citations}>
        {citations.map((citation, idx) =>
          <li key={idx} className={styles.citation}>
            <a href={safeUrl(citation.url)} target="_blank" rel="noopener noreferrer">{citation.title}</a>
            {citation.says ? ` — ${citation.says}` : ""}
            {citation.quote ? <q className={styles.citation_quote}>{citation.quote}</q> : null}
          </li>)}
      </ul>}
      {citations.length > 0 && <p className={styles.claude_unverified}>
        Sources: not yet verified. Claude read them through a summary.
      </p>}
    </div>
  }

  renderPreview(song, draft) {
    let source = this.props.source
    let ready = !!(source && source.status == "ready" && source.musicXML)
    let range = this.state.previewRange

    if (!ready || this.state.previewFailed || !range) {
      return <div className={styles.preview} ref={this.previewRef} />
    }

    let [first, last] = measureNumberRange(song)
    let fromMeasure = Math.max(first, range.from - 1)
    let toMeasure = Math.min(last, range.to + 1)

    return <div className={styles.preview} ref={this.previewRef}>
      {this.state.previewWidth > 0 &&
        <ScoreCard
          overview
          musicXML={source.musicXML}
          fromMeasure={fromMeasure}
          toMeasure={toMeasure}
          hand="both"
          width={this.state.previewWidth}
          engine={this.props.engine}
          loadEngines={this.props.loadEngines}
          shades={[{id: "draft", from: draft.start, to: draft.end, level: draft.level, on: true, label: ""}]}
          onError={() => this.setState({previewFailed: true})} />}
    </div>
  }

  renderEditor(song) {
    let draft = this.state.draft
    let [minBar, maxBar] = measureNumberRange(song)
    let editing = !draft.adding && this.flags().find(flag => flag.id == this.state.selectedId)
    let namePlaceholder = editing ?
      (editing.givenTitle !== undefined ? editing.givenTitle : editing.title) : "A name for this passage"

    let staves = staffTracks(song)
    let oneStaff = !staves.treble.length || !staves.bass.length

    return <Plate header={draft.adding ? "Mark a passage" : "Edit the passage"} className={styles.editor_plate}>
      <label className={styles.field}>
        <span className={styles.field_label}>Name</span>
        <input
          type="text"
          value={draft.title}
          placeholder={namePlaceholder}
          onChange={e => this.updateDraft({title: e.target.value})} />
        {editing && editing.givenTitle !== undefined && draft.title &&
          <div className={styles.field_hint}>
            Named by the analysis: “{editing.givenTitle}” ·{" "}
            <button type="button" className={styles.link_button} onClick={() => this.useAnalysisName()}>
              Use that name
            </button>
          </div>}
      </label>

      <div className={styles.field_row}>
        <NumberPicker
          label="start bar" value={draft.start} min={minBar} max={maxBar}
          onChange={value => this.updateDraftRange("start", value)} />
        <NumberPicker
          label="end bar" value={draft.end} min={minBar} max={maxBar}
          onChange={value => this.updateDraftRange("end", value)} />
      </div>

      {this.renderPreview(song, draft)}

      <div className={styles.field}>
        <span className={styles.field_label}>Hand</span>
        <div className={styles.pill_row}>
          {["both", "upper", "lower"].map(hand =>
            <Pill
              key={hand} variant="choice" selected={draft.hand == hand}
              onClick={() => this.updateDraft({hand})}>{HAND_LABEL[hand]}</Pill>)}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.field_label}>Difficulty</span>
        <div className={styles.pill_row}>
          {[1, 2, 3].map(level =>
            <Pill
              key={level} variant="choice" selected={draft.level == level}
              onClick={() => this.updateDraft({level})}>{LEVEL_WORDS[level]}</Pill>)}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.field_label}>What makes it hard</span>
        <div className={styles.pill_row}>
          {FLAG_KINDS.map(kind =>
            <Pill
              key={kind} variant="choice" selected={draft.kinds.includes(kind)}
              onClick={() => this.toggleKind(kind)}>{KIND_WORDS[kind]}</Pill>)}
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.field_label}>Why, in a sentence</span>
        <textarea
          value={draft.reason}
          placeholder="Add your own note, beside the analysis's reasons"
          onChange={e => this.updateDraft({reason: e.target.value})} />
      </label>

      <label className={styles.field}>
        <span className={styles.field_label}>How to practise it</span>
        <textarea value={draft.tip} onChange={e => this.updateDraft({tip: e.target.value})} />
      </label>

      <label className={classNames(styles.field, styles.apart_field)}>
        <input
          type="checkbox" checked={draft.apart} disabled={oneStaff}
          onChange={e => this.updateDraft({apart: e.target.checked})} />
        <span>Start this passage hands separately</span>
        <span className={styles.field_hint}>
          (otherwise only a bar that fails on one hand goes hands apart)
        </span>
      </label>
      {oneStaff ?
        <p className={styles.field_hint}>This piece has one staff, so there are no hands to separate.</p> :
        draft.apart ?
          <p className={styles.preview_line}>Starts hands separately in today's programme</p> : null}

      <div className={styles.editor_actions}>
        <Pill variant="primary" onClick={() => this.saveDraft()}>Save</Pill>
        {editing && <Pill variant="ghost" onClick={() => this.dismiss(editing)}>Dismiss flag</Pill>}
        <Pill variant="ghost" onClick={() => this.cancelEdit()}>Cancel</Pill>
      </div>
    </Plate>
  }

  renderSendToStudent(piece) {
    let message = this.state.message

    return <Plate header="Send to your student" className={styles.send_plate}>
      <label className={styles.field}>
        <span className={styles.field_label}>Your name</span>
        <input type="text" value={this.state.name} onChange={e => this.setName(e.target.value)} />
      </label>

      <div className={styles.send_actions}>
        <Pill variant="ghost" onClick={() => this.exportFlags(piece)}>Export flags file</Pill>
        <label className={styles.file_input}>
          <span className={styles.file_pill}>Open a flags file</span>
          <input
            type="file" accept=".json,application/json"
            onChange={e => this.importFlags(piece, e)} />
        </label>
      </div>

      {message && <p className={classNames(styles.message, {[styles.error]: message.error})}>{message.text}</p>}

      <p className={styles.field_hint}>
        No "Copy link" yet — a shareable link will come once the app is hosted.
      </p>
    </Plate>
  }

  render() {
    let piece = this.piece()
    let song = this.song()
    if (!piece || !song) { return null }

    let flags = this.flags()
    let numbers = measureNumberList(song)
    let record = this.record()
    let heatPct = (record && record.runs && record.runs.score && record.runs.score.heat) || []
    let heat = numbers.map((_, idx) => heatLevel(heatPct[idx] || 0))
    let inForce = flags.filter(flagInForce)
    let trouble = this.troubleList(inForce)
    let evidence = this.troubleList([])
    let queue = [...flags].sort(queueOrder)
    let draft = this.state.draft

    return <SidePane
      side="right"
      open={this.props.open}
      close={this.props.close}
      paneRef={this.paneRef}
      title="Review the passages"
      label="Review the passages"
      closeLabel="Close the review">
      <div className={styles.pane}>
        <p className={styles.lede}>
          Accept what is right, correct what is not, and mark what the analysis missed.
          Your word is final: a new analysis never overwrites it.
        </p>

        {this.renderTally(flags)}
        {this.renderTroubleSpots(trouble)}

        <Plate header="Mark a passage" className={styles.mark_plate}>
          <p className={styles.hint}>
            Drag across the strip, or tap the first bar then the last. Dotted brackets are waiting proposals.
          </p>
          <BarStrip
            numbers={numbers}
            heat={heat}
            flags={flags}
            selectedId={this.state.selectedId}
            onSelect={id => this.select(id)}
            picking={this.state.picking}
            onPick={(start, end) => this.onPick(start, end)} />
          <Pill variant="ghost" className={styles.small_pill} onClick={() => this.startPick()}>
            Add a passage
          </Pill>
        </Plate>

        <div className={classNames(styles.columns, {[styles.side_by_side]: this.state.paneWidth >= SIDE_BY_SIDE_WIDTH})}>
          <Plate header="Queue" className={styles.queue_plate}>
            {queue.length ?
              <ul className={styles.queue}>{queue.map(flag => this.renderQueueCard(flag, evidence))}</ul> :
              <p className={styles.hint}>Nothing flagged yet.</p>}
          </Plate>

          {draft && this.renderEditor(song)}
        </div>

        {this.renderSendToStudent(piece)}
      </div>
    </SidePane>
  }
}

export default ReviewPane
