// The Progress screen ("Progress" in docs/design/salon-de-chopin.md): local
// practice history read from the session records the trainer writes at Rest
// (NoteStats#sessionRecord, putSession in st/storage). Every figure is a
// pure fold of st/progress over those records; this component only paints
// what progressSummary returns. See statsPageFor in st/components/pages/
// stats for how a local user reaches this page rather than the backend
// Daily stats one.

import * as React from "react"
import classNames from "classnames"

import {getAppStore} from "st/storage"
import {setTitle} from "st/globals"
import {displayNoteName} from "st/music"
import {progressSummary, readSince, accuracyChangeCaption, PROGRESS_DAYS} from "st/progress"
import {Plate, Pill, StatCard, TitleBlock, SectionLabel, AccuracyRule} from "st/components/salon"

import styles from "./progress_page.module.css"

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const DAY_MS = 24 * 60 * 60 * 1000

// eg. "2 October", for a bar's aria-label; built from the UTC getters
// progressSummary's own day-of-month figure uses (see st/progress), so both
// read the same calendar date regardless of the viewer's timezone offset
function dayLabel(day) {
  let date = new Date(day.day * DAY_MS)
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`
}

export default class ProgressPage extends React.Component {
  constructor(props) {
    super(props)
    // read once, at mount: the chart's "today" and the goal line stay still
    // while the screen is open
    this.now = Date.now()
    this.state = {summary: this.summarize(getAppStore().recentSessions())}
  }

  componentDidMount() {
    setTitle("Progress")
    this.loadSessions()
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  summarize(sessions) {
    return progressSummary(sessions, {
      now: this.now,
      goalMinutes: getAppStore().practiceSettings().dailyGoalMinutes,
    })
  }

  // recentSessions() alone can miss the session a visit here just ended (its
  // write is still queued) and whatever another tab wrote, so the first
  // paint above is replaced with a read through the store's write queue; a
  // read the database refuses leaves that first paint standing
  async loadSessions() {
    let sessions
    try {
      sessions = await getAppStore().sessionsSince(readSince(this.now))
    } catch (err) {
      console.error("Couldn't read the practice history", err)
      return
    }
    if (this.unmounted) { return }
    this.setState({summary: this.summarize(sessions)})
  }

  renderChart() {
    let {days, scale, goalMinutes} = this.state.summary

    return <Plate header="Minutes at the bench" headerAside={`Goal ${goalMinutes}`} className={styles.chart_plate}>
      <div className={styles.chart_plot} style={{height: `${scale.plotHeight}px`}}>
        <div className={styles.goal_line} style={{bottom: `${scale.goalPx}px`}} aria-hidden="true" />
        {days.map(day => {
          let missed = day.sessions == 0
          return <div
            key={day.day}
            className={classNames(styles.bar, {[styles.today]: day.today, [styles.missed]: missed})}
            style={{height: `${Math.max(0, day.minutes * scale.pxPerMinute)}px`}}
            data-today={day.today || undefined}
            data-missed={missed || undefined}
            role="img"
            aria-label={`${dayLabel(day)}: ${Math.round(day.minutes)} minutes`}
          />
        })}
      </div>
      <div className={styles.day_numbers}>
        {days.map(day =>
          <span key={day.day} className={classNames(styles.day_number, {[styles.today]: day.today})}>
            {day.date}
          </span>)}
      </div>
    </Plate>
  }

  renderClefs() {
    let {clefs} = this.state.summary
    if (!clefs.length) {
      return <p className={styles.rail_empty}>Nothing played yet</p>
    }

    return <ul className={styles.clef_list}>
      {clefs.map(clef =>
        <li key={clef.sign} className={styles.clef_row} data-weak={clef.weak || undefined}>
          <span className={styles.clef_label}>{clef.label}</span>
          <AccuracyRule percent={clef.percent} weak={clef.weak} className={styles.clef_rule} />
          <span className={styles.clef_percent}>{clef.percent}%</span>
        </li>)}
    </ul>
  }

  renderNotes() {
    let {notes, showNoteGrid} = this.state.summary
    if (!showNoteGrid) {
      return <p className={styles.rail_empty}>Nothing played yet</p>
    }

    return <div className={styles.note_grid}>
      {notes.map(note =>
        <div
          key={note.offset}
          className={classNames(styles.note_tile, {[styles.weak]: note.weak})}
          data-weak={note.weak || undefined}>
          <span className={styles.note_name}>{displayNoteName(note.label)}</span>
          <span className={styles.note_percent}>{note.percent}%</span>
        </div>)}
    </div>
  }

  render() {
    let {cards} = this.state.summary
    let changeCaption = accuracyChangeCaption(cards.accuracyDelta)

    return <main className={styles.progress_page}>
      <TitleBlock eyebrow="Practice history" title="Your" italic="progress" />

      <div className={styles.headline_grid}>
        <StatCard label="Evenings kept" value={cards.eveningsKept} suffix={`/ ${PROGRESS_DAYS}`} />
        <StatCard label="Notes read" value={cards.notesRead} />
        <StatCard
          label="Accuracy"
          value={cards.accuracy == null ? "—" : cards.accuracy}
          suffix={cards.accuracy == null ? null : "%"}
          accent>
          {changeCaption ? <div className={styles.accuracy_change}>{changeCaption}</div> : null}
        </StatCard>
        <StatCard label="Minutes" value={cards.minutes} />
      </div>

      <div className={styles.progress_body}>
        <div className={styles.main_column}>
          {this.renderChart()}
        </div>

        <aside className={styles.rail}>
          <div className={styles.rail_section}>
            <SectionLabel ornament="❧">By clef</SectionLabel>
            {this.renderClefs()}
          </div>

          <div className={styles.rail_section}>
            <SectionLabel ornament="❧">By note</SectionLabel>
            {this.renderNotes()}
          </div>

          <Pill variant="primary" to="/setup">Tonight's programme</Pill>
        </aside>
      </div>
    </main>
  }
}
