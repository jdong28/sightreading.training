// For my lesson, a tab of the practice record (/stats/for-my-lesson): the
// notes a student wants to ask the teacher, open ones first and grouped by
// piece, each with its bar engraved and what the record said then and says
// now, and the lesson's answers kept under the day they were given. Before
// teacher accounts exist the teacher reads it on the student's screen, or on
// the sheet "Print for the lesson" makes of the open notes (a print
// stylesheet on this page: the app's chrome is hidden and each note gains
// blank lines for the answer, see lesson_page.module.css).
//
// Every figure and word is worked out in st/lesson_notes' lessonView; this
// component paints it and writes the changes (discussed, kept for next time,
// dropped, edited, a new note) through the store's updateLessonNote and
// putLessonNote. The first paint is from the cached notes; the sessions since
// the last lesson and the source score of each piece with an open bar note
// are read once they are asked for, and a bar is engraved only once its source
// is known (a piece without one, or one the engine can't draw, keeps a
// placeholder with the bar's number).

import * as React from "react"
import classNames from "classnames"
import {useNavigate} from "react-router-dom"

import {getAppStore} from "st/storage"
import {setTitle} from "st/globals"
import {pieceSong} from "st/sheet_music_deck"
import {lessonView, lessonSince, newLessonNote, noteLongDate} from "st/lesson_notes"
import {SHEET_MUSIC_STORAGE_KEY, scoreSettingsForPiece} from "st/data"
import {storeGeneratorSettings, loadGeneratorSettings} from "st/generators"
import {Plate, Pill, TitleBlock, SectionLabel, Card} from "st/components/salon"
import {RecordTabs} from "st/components/record_tabs"
import {LessonNoteForm} from "st/components/lesson_note_form"
import ScoreCard from "st/components/score_card"

import styles from "./lesson_page.module.css"

// the width a note's bar is engraved at: the engraving's column
const ENGRAVE_WIDTH = 196

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const plural = (count, word) => `${count} ${word}${count == 1 ? "" : "s"}`

class LessonView extends React.Component {
  constructor(props) {
    super(props)
    // read once, at mount, as Today does
    this.now = Date.now()

    this.state = {
      // the sessions since lessonSince(notes), read from the database
      sessions: [],
      // each piece's source score, once read: {pieceId: musicXML|null}
      sources: {},
      // each engraved note's card, "drawn" or "failed" once it is
      cards: {},
      // the note whose answer, words or edit form is open, {id, kind}
      form: null,
      adding: false,
      // the note just dropped, for its Undo
      dropped: null,
      error: null,
    }
  }

  componentDidMount() {
    setTitle("For my lesson")
    this.read()
  }

  componentDidUpdate() {
    this.read()
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  notes() {
    return getAppStore().lessonNotes()
  }

  // Reads what the model asks of the database: the sessions since the last
  // lesson (when that moves) and the source of each piece with an open bar
  // note (once)
  read() {
    let store = getAppStore()
    let notes = this.notes()
    let since = lessonSince(notes)

    if (since != this.sessionsSince) {
      this.sessionsSince = since
      if (since == null) {
        if (this.state.sessions.length) { this.setState({sessions: []}) }
      } else {
        store.sessionsSince(since).then(sessions => {
          if (!this.unmounted && this.sessionsSince == since) { this.setState({sessions}) }
        }).catch(err => console.error("Couldn't read the sessions since your lesson", err))
      }
    }

    this.requested ||= new Set()
    for (let note of notes) {
      if (note.status != "open" || note.start == null || !store.piece(note.pieceId) ||
          this.requested.has(note.pieceId)) { continue }

      this.requested.add(note.pieceId)
      store.pieceSource(note.pieceId).then(source => {
        if (!this.unmounted) { this.setState(state => ({sources: {...state.sources, [note.pieceId]: source}})) }
      }).catch(err => {
        console.warn("Couldn't read a piece's score", err)
        if (!this.unmounted) { this.setState(state => ({sources: {...state.sources, [note.pieceId]: null}})) }
      })
    }
  }

  view() {
    let store = getAppStore()
    let pieces = store.pieces().map(piece => ({id: piece.id, title: piece.title, song: pieceSong(piece)}))
      .filter(piece => piece.song)

    return lessonView({
      notes: this.notes(), pieces, items: store.items(), sessions: this.state.sessions, now: this.now,
    })
  }

  // runs a write to the store and paints what it changed, saying so when it fails
  async write(change) {
    try {
      this.setState({error: null})
      await change()
      if (!this.unmounted) { this.forceUpdate() }
    } catch (err) {
      console.error("Couldn't save the note", err)
      if (!this.unmounted) { this.setState({error: `Couldn't save that. ${err.message || err}`}) }
    }
  }

  update(id, build) {
    return this.write(() => getAppStore().updateLessonNote(id, build))
  }

  discuss(id, answer) {
    this.setState({form: null, dropped: null})
    return this.update(id, note => ({...note, status: "discussed", discussedAt: Date.now(), answer}))
  }

  keep(id) {
    this.setState({dropped: null})
    return this.update(id, note => ({...note, keptAt: Date.now()}))
  }

  drop(id) {
    this.setState({form: null, dropped: {id}})
    return this.update(id, note => ({...note, status: "dropped"}))
  }

  undrop(id) {
    this.setState({dropped: null})
    return this.update(id, note => ({...note, status: "open"}))
  }

  edit(id, {text, topic}) {
    this.setState({form: null})
    return this.update(id, note => ({...note, text, topic}))
  }

  addNote({text, topic, piece}) {
    let store = getAppStore()
    let chosen = piece && store.piece(piece)

    this.setState({adding: false})
    return this.write(() => store.putLessonNote(newLessonNote({
      source: "general", pieceId: chosen ? chosen.id : null, pieceTitle: chosen ? chosen.title : null,
      topic, text,
    })))
  }

  // goes to the note's bar on the score, with the piece set as the one it opens on
  openScore({pieceId, bar}) {
    storeGeneratorSettings(SHEET_MUSIC_STORAGE_KEY, scoreSettingsForPiece(pieceId))
    this.props.navigate(bar == null ? "/sheet-music" : `/sheet-music?bar=${bar}`)
  }

  // the open notes with a bar to engrave: their card is the thing to wait for
  engraving(view) {
    let {sources, cards} = this.state
    return view.groups.flatMap(group => group.notes).filter(note => note.engrave &&
      !(note.id in cards) && sources[note.engrave.pieceId] !== null)
  }

  setCard(id, state) {
    this.setState(current => ({cards: {...current.cards, [id]: state}}))
  }

  // The bar of a note engraved by the same engine as the score page, or the
  // placeholder in its place: a whole piece or no piece, a bar of a piece
  // with no stored score, a card the engine couldn't draw
  renderPicture(note) {
    let {sources, cards} = this.state
    let source = note.engrave && sources[note.engrave.pieceId]
    let drawn = source && cards[note.id] != "failed"

    return <div className={styles.picture}>
      {drawn ? <ScoreCard
        overview
        musicXML={source}
        fromMeasure={note.engrave.measure}
        toMeasure={note.engrave.measure}
        hand="both"
        width={ENGRAVE_WIDTH}
        onDrawn={() => this.setCard(note.id, "drawn")}
        onError={() => this.setCard(note.id, "failed")} /> :
        <span className={styles.placeholder}>{note.placeholder}</span>}
    </div>
  }

  renderForm(note) {
    let {form} = this.state
    if (!form || form.id != note.id) { return null }

    if (form.kind == "answer") {
      return <AnswerForm onSave={answer => this.discuss(note.id, answer)} onCancel={() => this.setState({form: null})} />
    }

    return <LessonNoteForm
      className={styles.edit_form}
      initialText={note.text}
      initialTopic={note.note.topic}
      onSave={fields => this.edit(note.id, fields)}
      onCancel={() => this.setState({form: null})} />
  }

  renderOpenNote(note) {
    let {form} = this.state
    let busy = form && form.id == note.id

    return <article key={note.id} className={styles.note} data-note={note.id}>
      {this.renderPicture(note)}

      <div className={styles.body}>
        <div className={styles.heading}>
          <span className={styles.place}>{note.place}</span>
          <span className={styles.label}>{note.label}</span>
        </div>

        {note.wordless ? <p className={styles.no_words}>
          No words yet. <button type="button" className={styles.link} onClick={() => this.setState({form: {id: note.id, kind: "edit"}})}>Add words</button>
        </p> : <p className={styles.quote} data-quote>“{note.text}”</p>}

        {(note.then || note.now || note.over || note.evidence) && <p className={styles.evidence}>
          {[note.then, note.now, note.over, note.evidence].filter(Boolean).join(" ")}
        </p>}

        <div className={styles.actions} data-print="hide">
          <Pill variant="primary" className={styles.action} onClick={() => this.setState({form: {id: note.id, kind: "answer"}, dropped: null})}>Discussed…</Pill>
          <Pill variant="ghost" className={styles.action} onClick={() => this.keep(note.id)}>Keep for next time</Pill>
          <Pill variant="ghost" className={styles.action} onClick={() => this.drop(note.id)}>Drop</Pill>
          {note.open && <button type="button" className={styles.link} onClick={() => this.openScore(note.open)}>Open on the score</button>}
          {!note.wordless && !busy && <button type="button" className={styles.link} onClick={() => this.setState({form: {id: note.id, kind: "edit"}})}>Edit</button>}
        </div>

        {this.renderForm(note)}

        <div className={styles.answer_box} data-print="only">
          <span className={styles.answer_label}>The teacher's answer</span>
          <span className={styles.answer_line} />
          <span className={styles.answer_line} />
          <span className={styles.answer_line} />
        </div>
      </div>
    </article>
  }

  renderGroup(group) {
    return <section key={group.key} className={styles.group} aria-label={group.header}>
      <SectionLabel ornament="❧">{group.header}</SectionLabel>
      {group.notes.map(note => this.renderOpenNote(note))}
    </section>
  }

  renderDiscussed(view) {
    if (!view.discussed.length) { return null }

    return <div className={styles.discussed} data-print="hide">
      {view.discussed.map(day => <section key={day.key} className={styles.group} aria-label={day.label}>
        <SectionLabel ornament="❧">{day.label}</SectionLabel>
        {day.notes.map(note => <article key={note.id} className={classNames(styles.note, styles.done)} data-note={note.id}>
          <div className={styles.picture}><span className={styles.placeholder}>{note.placeholder}</span></div>
          <div className={styles.body}>
            <div className={styles.heading}>
              <span className={styles.place}>{note.place}</span>
              <span className={styles.label}>{note.label}</span>
            </div>
            {!note.wordless && <p className={styles.quote} data-quote>“{note.text}”</p>}
            {note.answer && <div className={styles.teacher}>
              <span className={styles.teacher_label}>Teacher</span>
              <span className={styles.teacher_text}>“{note.answer}”</span>
            </div>}
            {note.since && <p className={styles.evidence}>{note.since}</p>}
          </div>
        </article>)}
      </section>)}
      {view.earlier > 0 && <p className={styles.earlier}>and {view.earlier} earlier</p>}
    </div>
  }

  renderAdding() {
    let store = getAppStore()
    let current = store.piece(loadGeneratorSettings(SHEET_MUSIC_STORAGE_KEY).piece)
    let pieces = [
      ...(current ? [{key: current.id, label: `Whole piece: ${current.title}`}] : []),
      {key: "", label: "Any piece"},
    ]

    return <Plate className={styles.add_plate} header={<>For your <span className={styles.italic}>lesson</span></>}>
      <LessonNoteForm
        pieces={pieces}
        initialPiece={pieces[0].key}
        onSave={fields => this.addNote(fields)}
        onCancel={() => this.setState({adding: false})} />
    </Plate>
  }

  renderRail(view, pending) {
    let {since} = view

    return <aside className={styles.rail} data-print="hide">
      {since && <Card>
        <div className={styles.since_label}>{since.label}</div>
        <div className={styles.since_value}>{since.days} <span className={styles.italic}>{since.daysWords}</span></div>
        <div className={styles.since_detail}>{since.detail}</div>
      </Card>}

      <Pill
        variant="primary"
        className={styles.rail_pill}
        disabled={pending > 0 || view.count == 0}
        onClick={() => window.print()}>
        {pending > 0 ? "Engraving the bars…" : "Print for the lesson"}
      </Pill>
      <Pill variant="ghost" className={styles.rail_pill} onClick={() => this.setState({adding: true})}>Add a note</Pill>
      <p className={styles.quote_line}>“Bring the questions; leave with the answers.”</p>
    </aside>
  }

  // the heading and the since line of the printed sheet
  renderPrintHead(view) {
    let date = new Date(this.now)
    let {since} = view

    return <div className={styles.print_head} data-print="only">
      <h2 className={styles.print_title}>
        For my lesson · {WEEKDAYS[date.getDay()]} {noteLongDate(this.now)}
      </h2>
      {since && <p className={styles.print_since}>
        {since.label}: {plural(since.days, "day")} · {since.detail}
      </p>}
    </div>
  }

  renderEmpty() {
    return <Plate className={styles.empty_plate}>
      <h2 className={styles.empty_title}>Nothing to ask <span className={styles.italic}>yet</span></h2>
      <p className={styles.empty_text}>
        Click a bar on the score and choose "Note for lesson", or flag bars during a session.
      </p>
      <Pill variant="primary" onClick={() => this.setState({adding: true})}>Add a note</Pill>
    </Plate>
  }

  render() {
    let view = this.view()
    let pending = this.engraving(view).length
    let {adding, dropped, error} = this.state

    return <main className={styles.lesson_page}>
      <div data-print="hide">
        <TitleBlock eyebrow="Practice record" title="For my" italic="lesson" />
        <RecordTabs />
      </div>

      {error && <p className={styles.error} role="alert" data-print="hide">{error}</p>}
      {dropped && <p className={styles.dropped} role="status" data-print="hide">
        Dropped. <button type="button" className={styles.link} onClick={() => this.undrop(dropped.id)}>Undo</button>
      </p>}

      {view.empty && !adding ? this.renderEmpty() : <div className={styles.body_grid}>
        <div className={styles.main}>
          {this.renderPrintHead(view)}
          {adding && <div data-print="hide">{this.renderAdding()}</div>}
          {view.groups.length || view.discussed.length ? <Plate className={styles.notes_plate}>
            {view.groups.map(group => this.renderGroup(group))}
            {!view.groups.length && <p className={styles.nothing_open} data-print="hide">
              Nothing is open for your next lesson.
            </p>}
            {this.renderDiscussed(view)}
          </Plate> : null}
        </div>
        {this.renderRail(view, pending)}
      </div>}
    </main>
  }
}

// the teacher's answer, asked when a note is marked discussed; it may be left empty
class AnswerForm extends React.Component {
  state = {text: ""}

  onKeyDown(e) {
    if (e.key == "Escape") {
      e.stopPropagation()
      this.props.onCancel()
    }
  }

  render() {
    return <form
      className={styles.answer_form}
      onKeyDown={e => this.onKeyDown(e)}
      onSubmit={e => { e.preventDefault(); this.props.onSave(this.state.text.trim()) }}>
      <label className={styles.answer_field}>
        <span className={styles.answer_field_label}>The teacher's answer (optional)</span>
        <textarea
          className={styles.answer_text}
          rows={3}
          maxLength={1000}
          autoFocus
          value={this.state.text}
          onChange={e => this.setState({text: e.target.value})} />
      </label>
      <div className={styles.answer_actions}>
        <Pill variant="primary" type="submit">Save</Pill>
        <Pill variant="ghost" onClick={this.props.onCancel}>Cancel</Pill>
      </div>
    </form>
  }
}

// the router's navigate, handed to the class
export default function LessonPage() {
  return <LessonView navigate={useNavigate()} />
}
