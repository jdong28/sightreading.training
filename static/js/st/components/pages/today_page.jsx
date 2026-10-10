// Today, the first tab of the practice record (/stats): a summary of today's
// practice, the whole practice day from 4 am, every session and piece, in
// place of the pop-up summary that was dropped for being too intrusive. It
// never opens by itself: the score page's ended strip, the exercises page's
// rest strip and the header's Statistics link lead here. Every figure is
// worked out in st/practice_day from records the trainer already keeps
// (sessions, the bar log's rows, the bar items); this component only paints
// what practiceDay returns, and reads the two stores it needs.
//
// The first paint is from the cached sessions alone; the day's bar log rows
// are read through the store's write queue and fill in the pieces and the
// rail. A read the database refuses leaves the first paint standing.

import * as React from "react"
import classNames from "classnames"
import {useNavigate} from "react-router-dom"

import {getAppStore} from "st/storage"
import {setTitle} from "st/globals"
import {localDay, dayStart} from "st/srs/schedule"
import {pieceSong} from "st/sheet_music_deck"
import {practiceDay} from "st/practice_day"
import {
  STAVES, GENERATORS, SHEET_MUSIC_STORAGE_KEY, scoreSettingsForPiece, troublePracticeSettings,
} from "st/data"
import {storeGeneratorSettings} from "st/generators"
import {generatorLabel, staffLabel} from "st/exercise_labels"
import {Plate, Pill, StatCard, TitleBlock, SectionLabel} from "st/components/salon"
import {RecordTabs} from "st/components/record_tabs"

import styles from "./today_page.module.css"

// merges sessions lists by id, the later ones winning, oldest first
function mergeSessions(...lists) {
  let byId = new Map()
  for (let session of lists.flat()) { byId.set(session.id, session) }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt)
}

// the words of an exercise session, from the staff and generator it was
// played on, as the exercises page's evening list says them
function exerciseLabel(session) {
  let staff = STAVES.find(s => s.name == session.staff)
  let generator = GENERATORS.find(g => g.name == session.generator && (!staff || g.mode == staff.mode))

  return {
    italic: staff ? `${staffLabel(staff)} staff` : session.staff,
    small: `Exercises · ${generator ? generatorLabel(generator) : session.generator}`,
  }
}

class TodayView extends React.Component {
  constructor(props) {
    super(props)
    // read once, at mount: the day can't change while the page is open
    this.now = Date.now()

    let store = getAppStore()
    this.played = store.pieces().some(piece => store.items(piece.id).some(item => item.attempts > 0))
    this.state = {sessions: store.recentSessions(), rows: null, settled: false}
  }

  componentDidMount() {
    setTitle("Today's practice")
    this.load()
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  // recentSessions() alone can miss the session a visit here just ended (its
  // write is still queued) and whatever another tab wrote, so the first paint
  // is replaced with reads through the store's write queue
  async load() {
    let store = getAppStore()
    let today = localDay(this.now)

    try {
      let [sessions, rows] = await Promise.all([
        store.sessionsSince(dayStart(today - 1)), store.barLogSince(dayStart(today)),
      ])
      if (this.unmounted) { return }
      this.setState(state => ({sessions: mergeSessions(state.sessions, sessions), rows, settled: true}))
    } catch (err) {
      console.error("Couldn't read today's practice", err)
      if (!this.unmounted) { this.setState({settled: true}) }
    }
  }

  today() {
    let store = getAppStore()
    let pieces = store.pieces().map(piece => ({id: piece.id, title: piece.title, song: pieceSong(piece)}))
      .filter(piece => piece.song)

    return practiceDay({
      now: this.now,
      sessions: this.state.sessions,
      rows: this.state.rows,
      pieces,
      items: id => store.items(id),
      played: this.played,
      goal: store.practiceSettings().dailyGoalMinutes,
      exerciseLabel,
    })
  }

  // saves the settings the score page opens on, as its own setup pane does,
  // and goes to it: the page opens at rest and never begins
  openScore(settings, bar=null) {
    storeGeneratorSettings(SHEET_MUSIC_STORAGE_KEY, settings)
    this.props.navigate(bar == null ? "/sheet-music" : `/sheet-music?bar=${bar}`)
  }

  openPiece(plate, bar=null) {
    this.openScore(scoreSettingsForPiece(plate.id), bar)
  }

  practise(plate) {
    let {start, end} = plate.practise
    this.openScore(troublePracticeSettings(scoreSettingsForPiece(plate.id), [start, end]))
  }

  renderCards({cards}) {
    let {minutes, sessions, accuracy, learned} = cards

    return <div className={styles.headline_grid}>
      <StatCard label="Minutes" value={minutes.value} suffix={`of ${minutes.goal}`}>
        <div className={styles.goal_track} role="img" aria-label={minutes.ariaLabel}>
          <div className={styles.goal_fill} style={{width: `${minutes.fill * 100}%`}} data-met={minutes.met || undefined} />
          <div className={styles.goal_tick} style={{left: `${minutes.tick * 100}%`}} />
        </div>
      </StatCard>

      <StatCard label="Sessions" value={sessions.value}>
        {sessions.caption ? <div className={styles.card_caption}>{sessions.caption}</div> : null}
      </StatCard>

      <StatCard
        label="Accuracy"
        value={accuracy.value == null ? "—" : accuracy.value}
        suffix={accuracy.value == null ? null : "%"}
        accent>
        {accuracy.change ? <div className={styles.card_caption}>{accuracy.change}</div> : null}
      </StatCard>

      <StatCard label="Bars learned" value={learned.value}>
        <div className={styles.card_caption}>{learned.caption}</div>
      </StatCard>
    </div>
  }

  renderSessions({sessions}) {
    return <Plate header="Sessions today" headerAside={`${sessions.length}`}>
      <ol className={styles.session_list}>
        {sessions.map(session =>
          <li key={session.id} className={styles.session_row} data-kind={session.kind}>
            <span className={styles.session_time}>{session.time}</span>
            <span className={styles.session_what}>
              <span className={styles.session_title}>{session.title}</span>
              {session.italic ? <span className={styles.session_italic}>{session.italic}</span> : null}
              {session.small ? <span className={styles.session_small}>{session.small}</span> : null}
            </span>
            <span className={styles.session_minutes}>{session.minutes}</span>
            <span className={classNames(styles.session_figure, {[styles.weak]: session.figure.weak})}>
              {session.figure.text}
            </span>
          </li>)}
      </ol>
    </Plate>
  }

  renderPiece(plate) {
    return <Plate
      key={plate.id}
      className={styles.piece_plate}
      header={<>{plate.title} <span className={styles.header_italic}>bars played today</span></>}
      headerAside={`${plate.played} of ${plate.total} bars`}>
      <div className={styles.bars}>
        {plate.cells.map(cell =>
          <button
            key={cell.measure}
            type="button"
            className={classNames(styles.bar_cell, cell.kind && styles[cell.kind])}
            aria-label={cell.ariaLabel}
            onClick={() => this.openPiece(plate, cell.measure)}>
            {cell.measure}
            {cell.learned ? <span className={styles.learned_mark} aria-hidden="true">◆</span> : null}
          </button>)}
      </div>

      <div className={styles.legend}>
        <span className={styles.legend_learned}><span aria-hidden="true">◆</span> learned today</span>
        <span>Shaded by today's accuracy: clean, nearly, under 80%</span>
      </div>

      {plate.troubles.length ? <ul className={styles.trouble_list}>
        {plate.troubles.map(trouble =>
          <li key={trouble.measure} className={styles.trouble_row} data-kind={trouble.kind}>
            <span className={styles.trouble_bar}>Bar {trouble.measure}</span>
            <span className={styles.trouble_label}>{trouble.label}</span>
            <span className={styles.trouble_text}>{trouble.text}</span>
            <button
              type="button"
              className={styles.trouble_open}
              aria-label={`Open bar ${trouble.measure}`}
              onClick={() => this.openPiece(plate, trouble.measure)}>Open</button>
          </li>)}
        {plate.moreTrouble ? <li className={styles.trouble_more}>
          and {plate.moreTrouble} more {plate.moreTrouble == 1 ? "bar" : "bars"} under 100%
        </li> : null}
      </ul> : null}

      <div className={styles.piece_actions}>
        {plate.practise ? <div className={styles.practise}>
          <Pill variant="primary" onClick={() => this.practise(plate)}>{plate.practise.label}</Pill>
          {plate.practise.note ? <span className={styles.practise_note}>{plate.practise.note}</span> : null}
        </div> : null}
        <Pill variant="ghost" onClick={() => this.openPiece(plate)}>Open the score</Pill>
      </div>
    </Plate>
  }

  renderRail({mistakes, habits}) {
    if (!mistakes && !habits.length) { return null }

    return <aside className={styles.rail}>
      {mistakes ? <div className={styles.rail_section}>
        <SectionLabel ornament="❧">Mistakes today</SectionLabel>
        <ul className={styles.mistake_list}>
          {mistakes.map(mistake =>
            <li key={mistake.kind} className={styles.mistake_row} data-kind={mistake.kind}>
              <span className={styles.mistake_label}>{mistake.label}</span>
              <span className={styles.mistake_count}>{mistake.count}</span>
              <span className={styles.mistake_rule} aria-hidden="true">
                <span className={styles.mistake_fill} style={{width: `${mistake.width}%`}} />
              </span>
            </li>)}
        </ul>
      </div> : null}

      {habits.length ? <div className={styles.rail_section}>
        <SectionLabel ornament="❧">Kept going wrong</SectionLabel>
        <ul className={styles.habit_list}>
          {habits.map((habit, idx) =>
            <li key={idx} className={styles.habit_row}>
              <span>{habit.text}</span>
              <span className={styles.habit_times}>{habit.times}</span>
            </li>)}
        </ul>
      </div> : null}
    </aside>
  }

  renderEmpty(day) {
    if (day.state == "first-use") {
      return <Plate className={styles.empty_plate}>
        <h2 className={styles.empty_title}>Today's practice <span className={styles.header_italic}>fills in as you play</span></h2>
        <p className={styles.empty_text}>
          Each session you end appears here, with the bars you played and what went wrong in them.
        </p>
        <Pill variant="primary" to="/setup">Take your seat</Pill>
      </Plate>
    }

    return <Plate className={styles.empty_plate}>
      <h2 className={styles.empty_title}>The bench is <span className={styles.header_italic}>waiting</span></h2>
      <p className={styles.empty_text}>
        Nothing played yet today. {day.yesterday || day.lastSeen}
      </p>
      <Pill variant="primary" to="/setup">Tonight's programme</Pill>
    </Plate>
  }

  renderPlayed(day) {
    return <>
      {this.renderCards(day)}

      <div className={classNames(styles.today_body, {[styles.one_column]: !day.mistakes && !day.habits.length})}>
        <div className={styles.main_column}>
          {this.renderSessions(day)}
          {day.pieces.map(plate => this.renderPiece(plate))}
        </div>
        {this.renderRail(day)}
      </div>

      {day.closing ? <p className={styles.closing}>{day.closing}</p> : null}
    </>
  }

  render() {
    let day = this.today()
    let {weekday, day: dayOfMonth, month} = day.date

    return <main className={styles.today_page}>
      <TitleBlock eyebrow="Practice record" title="Today," italic={`${weekday} ${dayOfMonth} ${month}`} />
      <RecordTabs />

      {day.state == "played" ? this.renderPlayed(day) : this.state.settled ? this.renderEmpty(day) : null}
    </main>
  }
}

// the router's navigate, handed to the class
export default function TodayPage() {
  return <TodayView navigate={useNavigate()} />
}
