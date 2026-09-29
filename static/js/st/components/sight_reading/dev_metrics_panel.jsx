import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {getAppStore} from "st/storage"
import {HANDS, itemId} from "st/srs/records"
import {HESITATION_MIN_MS, HESITATION_PACE} from "st/srs/grade"
import {
  columnRows, runReport, formatMs, tempoOf, rangeLabel, perColumnRows, itemReviews, handItems,
  GRADE_NAMES,
} from "st/dev_metrics"

import styles from "./dev_metrics_panel.module.css"

// how many finished runs the run view keeps to pick from
const MAX_RUNS = 20

const TABS = [["live", "Live"], ["run", "Runs"], ["history", "History"]]

const keys = notes => notes && notes.length ? notes.join(" ") : "—"
const count = n => n == null ? "—" : n
const clock = at => at == null ? "—" : new Date(at).toLocaleTimeString()
const day = at => at == null ? "—" : new Date(at).toLocaleString()

// The developer metrics panel: what detection measured on each column as it
// is played, how each finished run was graded, and a bar's stored runs, for
// checking the measurements by hand at a MIDI keyboard. It reads the
// trainer's own data (see st/dev_metrics) and changes nothing. Shown on the
// practice page when enabled with ?devMetrics=1 (see devMetricsState).
export default class DevMetricsPanel extends React.Component {
  static propTypes = {
    // the notes generator; a measure card generator (st/measure_cards)
    // keeps attempt passes, any other only the matcher's measurements
    generator: types.object,
    matcher: types.object.isRequired,
    // the matcher's last hit event, with the keys it credited
    lastHit: types.object,
    session: types.bool,
    close: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      tab: "live",
      // finished passes, newest first
      runs: [],
      run: 0,
      hand: null,
      itemId: null,
      reviews: null,
    }
  }

  componentDidMount() {
    this.noteRun()
  }

  componentDidUpdate(prevProps, prevState) {
    this.noteRun()
    if (this.state.tab == "history" && prevState.tab != "history") {
      this.loadReviews()
    }
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  // the generator's pass finished last joins the runs; once the passes
  // before it are written it has the items it was graded against
  noteRun() {
    let {generator} = this.props
    let pass = generator && generator.lastPass
    if (!pass || this.state.runs.includes(pass)) { return }

    this.setState(state => ({runs: [pass, ...state.runs].slice(0, MAX_RUNS), run: 0}))
    Promise.resolve(generator.finishing).then(() => {
      if (this.unmounted) { return }
      this.forceUpdate()
      if (this.state.tab == "history") { this.loadReviews() }
    })
  }

  // the generator's deck, when it plays an imported piece
  deck() {
    let {generator} = this.props
    return generator && generator.deck && generator.deck.pieceId ? generator.deck : null
  }

  loadReviews() {
    let deck = this.deck()
    let store = getAppStore()
    if (!deck || !store || !store.reviews) { return }

    store.reviews({pieceId: deck.pieceId}).then(reviews => {
      if (!this.unmounted) { this.setState({reviews}) }
    }, err => console.warn("Couldn't read the reviews", err))
  }

  render() {
    let {tab} = this.state
    return <aside className={styles.panel} aria-label="Developer metrics" data-dev-metrics>
      <div className={styles.header}>
        <strong className={styles.title}>Metrics</strong>
        <div className={styles.tabs} role="tablist">
          {TABS.map(([name, label]) =>
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab == name}
              className={classNames(styles.tab, {[styles.active]: tab == name})}
              onClick={() => this.setState({tab: name})}>{label}</button>)}
        </div>
        <button type="button" className={styles.close} aria-label="Close metrics" onClick={this.props.close}>×</button>
      </div>
      <div className={styles.body}>
        {tab == "live" && this.renderLive()}
        {tab == "run" && this.renderRuns()}
        {tab == "history" && this.renderHistory()}
      </div>
    </aside>
  }

  renderLive() {
    let {generator, matcher, lastHit, session} = this.props
    let head = matcher.inspect()
    let pass = generator && generator.pass

    return <>
      <dl className={styles.facts}>
        <dt>Head</dt>
        <dd>{session ? `waiting ${formatMs(head.waiting)}` : "at rest, nothing is judged"}
          {" · "}latency {formatMs(head.latency)}
          {head.onLine != null && ` · on the hit line ${formatMs(head.onLine)}`}</dd>
        <dt>Keys</dt>
        <dd>struck {keys(head.touched)} · down {keys(head.held)}</dd>
        <dt>Early</dt>
        <dd>held for the next column {keys(head.early)} · credited to this one {keys(head.credited)}</dd>
        {lastHit && <>
          <dt>Last hit</dt>
          <dd>{keys(lastHit.hitNotes)}: latency {formatMs(lastHit.latency)}, spread {formatMs(lastHit.spread)},
            early {keys(lastHit.credited)}, held over {keys(lastHit.heldCredited)}
            {lastHit.late != null && `, late ${formatMs(lastHit.late)}`}</dd>
        </>}
      </dl>
      {pass ? this.renderPass(pass) :
        <p className={styles.note}>
          This drill keeps no attempts: runs are timed and graded for imported pieces on the
          sheet music page. The matcher's own measurements are above.
        </p>}
    </>
  }

  renderPass(pass) {
    let previous = pass.head == pass.from && this.state.runs[0]
    return <>
      <h3 className={styles.heading}>
        This pass, {rangeLabel(pass.card)} {pass.continued && "(rest of an abandoned pass, not graded)"}
      </h3>
      {this.renderColumns(pass)}
      {previous && <>
        <h3 className={styles.heading}>Previous pass</h3>
        {this.renderColumns(previous)}
      </>}
    </>
  }

  renderColumns(pass) {
    return <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th><th>bar</th><th>notes</th><th>state</th>
          <th title="tries gone wrong on the column">tries</th>
          <th title="time on the column: from the column before done to this one done">time</th>
          <th title="from the column becoming the head to its first own key down">latency</th>
          <th title="first to last of its keys down">spread</th>
          <th title="keys credited early, struck before it was the head">early</th>
          <th title="keys the score still sounds, held rather than struck again">held</th>
          <th title="scroll mode: time on the hit line before it completed">late</th>
        </tr>
      </thead>
      <tbody>
        {columnRows(pass).map(row =>
          <tr key={row.index} className={classNames({
            [styles.head]: row.status == "head",
            [styles.dim]: row.status == "to come" || row.status == "before",
            [styles.bad]: row.slips > 0 || row.status == "skipped",
          })}>
            <td>{row.index + 1}</td>
            <td>{row.bar}</td>
            <td title={row.sustained.length ? `sounding from before: ${keys(row.sustained)}` : undefined}>
              {keys(row.notes)}{row.sustained.length > 0 && "*"}
            </td>
            <td>{row.status}</td>
            <td>{row.slips}</td>
            <td>{formatMs(row.ms)}</td>
            <td>{formatMs(row.latency)}</td>
            <td>{formatMs(row.spread)}</td>
            <td>{count(row.early)}</td>
            <td>{count(row.heldCredit)}</td>
            <td>{formatMs(row.late)}</td>
          </tr>)}
      </tbody>
    </table>
  }

  renderRuns() {
    let {runs} = this.state
    if (!runs.length) {
      return <p className={styles.note}>No run finished yet. Play a card through to its last column.</p>
    }

    let pass = runs[Math.min(this.state.run, runs.length - 1)]
    return <>
      <label className={styles.picker}>
        Run{" "}
        <select value={this.state.run} onChange={e => this.setState({run: Number(e.target.value)})}>
          {runs.map((run, idx) =>
            <option key={idx} value={idx}>
              {idx == 0 ? "latest" : `${idx} before`}: {rangeLabel(run.card)} at {clock(run.written ? run.written.at : run.lastAt)}
            </option>)}
        </select>
      </label>
      {this.renderRun(runReport(pass))}
    </>
  }

  renderRun(report) {
    let mode = report.mode == "scroll" ? `scroll mode at speed ${report.speed ?? "—"}` : `${report.mode} mode`
    if (!report.graded) {
      return <p className={styles.note}>{mode}. Not graded: {report.why}.</p>
    }

    let unit = report.beats ? "beat" : "column"
    let paced = (ms, tempo) => ms == null ? "none (too few timed columns)" :
      `${formatMs(ms)} per ${unit}${tempo ? ` (♩ = ${tempo})` : ""}`
    let barsOf = numbers => {
      let bars = [...new Set(numbers)]
      return `${numbers.length}, ${bars.length == 1 ? "bar" : "bars"} ${bars.join(", ")}`
    }
    let hesitated = report.columns.filter(column => column.hesitated).map(column => column.bar)

    return <>
      <dl className={styles.facts}>
        <dt>Drill</dt>
        <dd>{mode}, written {clock(report.at)}{report.hand && `, ${report.hand == "both" ? "hands together" : `${report.hand} hand`}`}</dd>
        <dt>Grade pace</dt>
        <dd>{paced(report.pace, report.tempo)}: the median time on a column per notated beat before
          it, the first column and any skipped or untimed one left out, a column paused on counted
          {report.mode == "scroll" && "; not read in scroll mode"}
          {report.mode == "wait" &&
            ` · hesitations, latency over max(${formatMs(HESITATION_MIN_MS)}, ${HESITATION_PACE} × this pace × beats): ` +
            (hesitated.length ? barsOf(hesitated) : "none")}</dd>
        {report.mode == "wait" && <>
          <dt>Caption pace</dt>
          <dd>{paced(report.captionPace, report.captionTempo)}: the after-run caption's own, which
            leaves a column paused on out of the pace and counts it a stop, so it is not what the
            grade read above
            {" · "}stops {report.stops.length ? barsOf(report.stops) : "none"}</dd>
        </>}
      </dl>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th><th>bar</th><th>notes</th><th title="notated beats from the column before">gap</th>
            <th>time</th><th>latency</th><th>threshold</th><th>hesitated</th>
            <th title="tries gone wrong on the column">tries</th><th>flag</th>
          </tr>
        </thead>
        <tbody>
          {report.columns.map(column =>
            <tr key={column.index} className={classNames({
              [styles.bad]: column.misses > 0 || column.skipped || column.hesitated,
            })}>
              <td>{column.index + 1}</td>
              <td>{column.bar}</td>
              <td>{keys(column.notes)}</td>
              <td>{count(column.gap)}</td>
              <td>{formatMs(column.ms)}</td>
              <td>{formatMs(column.latency)}</td>
              <td>{formatMs(column.threshold)}</td>
              <td>{column.hesitated ? "yes" : ""}</td>
              <td>{column.misses}</td>
              <td>{column.skipped ? "skipped" : column.stuck ? "stuck" : ""}</td>
            </tr>)}
        </tbody>
      </table>

      {report.pending && <p className={styles.note}>
        Waiting for the runs before it to be written: graded below as at first sight until then.
      </p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>item</th><th>grade</th><th title="clean / columns">clean</th>
            <th title="columns with any try gone wrong">slipped cols</th>
            <th title="every try gone wrong, over all its columns">misses</th>
            <th>hesit.</th><th>usual pace</th><th>written as</th>
          </tr>
        </thead>
        <tbody>
          {report.ranges.map(range =>
            <React.Fragment key={range.label}>
              <tr>
                <td>{range.label}</td>
                <td><strong>{GRADE_NAMES[range.grade]}</strong></td>
                <td>{range.counts.clean}/{range.counts.columns}</td>
                <td>{range.counts.slips}</td>
                <td>{range.counts.misses}</td>
                <td>{range.counts.hesitations}</td>
                <td>{range.firstSight ? "first sight" : formatMs(range.usualPace)}</td>
                <td>{range.practiceOnly ? "practice only (off schedule)" : "review"}</td>
              </tr>
              <tr className={styles.reason}>
                <td colSpan={8}>{range.reason}</td>
              </tr>
            </React.Fragment>)}
        </tbody>
      </table>
    </>
  }

  renderHistory() {
    let deck = this.deck()
    let store = getAppStore()
    if (!deck || !store) {
      return <p className={styles.note}>Stored runs are kept for imported pieces on the sheet music page.</p>
    }

    let hand = this.state.hand || deck.hand || "both"
    let items = handItems(store.items(deck.pieceId), hand)
    let card = deck.card
    // the first bar of the card on the staff with anything stored
    let bars = card ? card.measures.map(measure =>
      itemId({pieceId: deck.pieceId, hand, startMeasure: measure, endMeasure: measure})) : []
    let fallback = bars.find(id => items.some(item => item.id == id))
    let id = items.some(item => item.id == this.state.itemId) ? this.state.itemId :
      fallback || items[0] && items[0].id
    let item = items.find(item => item.id == id)
    let reviews = this.state.reviews ? itemReviews(this.state.reviews, id) : null

    return <>
      <div className={styles.pickers}>
        <label className={styles.picker}>
          Hand{" "}
          <select value={hand} onChange={e => this.setState({hand: e.target.value})}>
            {HANDS.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className={styles.picker}>
          Item{" "}
          <select value={id || ""} onChange={e => this.setState({itemId: e.target.value})} disabled={!items.length}>
            {items.map(item => <option key={item.id} value={item.id}>{rangeLabel(item)}</option>)}
          </select>
        </label>
        <button type="button" className={styles.refresh} onClick={() => this.loadReviews()}>Reload</button>
      </div>

      {!item ? <p className={styles.note}>Nothing stored under this hand yet.</p> : <>
        <dl className={styles.facts}>
          <dt>Item</dt>
          <dd>{item.state}, step {item.step}, due {day(item.due)}, reps {item.reps}, lapses {item.lapses},
            {" "}attempts {item.attempts}</dd>
          <dt>Usual pace</dt>
          <dd>{formatMs(item.paceMs)} per beat{tempoOf(item.paceMs) && ` (♩ = ${tempoOf(item.paceMs)})`}:
            the running mean of its clean wait mode runs. A review stores its elapsed time and
            each column's measurements, not a pace of its own.</dd>
        </dl>
        {reviews == null ? <p className={styles.note}>Reading the reviews…</p> :
          !reviews.length ? <p className={styles.note}>No reviews of this item.</p> :
          reviews.map(review => this.renderReview(review))}
      </>}
    </>
  }

  renderReview(review) {
    let rows = perColumnRows(review.perColumn)
    return <section key={review.at} className={styles.review}>
      <h3 className={styles.heading}>
        {day(review.at)} · <strong>{GRADE_NAMES[review.grade] || review.kind}</strong>
        {review.was && ` (was ${review.was})`} · {review.mode || "—"}{review.speed != null && ` ${review.speed}`}
        {review.algo != null && ` · algo ${review.algo}`}
      </h3>
      <p className={styles.counts}>
        clean {count(review.clean)}/{count(review.columns)} · misses {count(review.misses)}
        {" "}· stuck {count(review.stuck)} · skipped {count(review.skipped)}
        {" "}· hesitations {count(review.hesitations)} · elapsed {formatMs(review.elapsedMs)}
        {" "}· lead {formatMs(review.leadMs)}
      </p>
      {rows.length > 0 && <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th><th>slips</th><th>stalled</th><th>latency</th><th>spread</th><th>early</th>
            <th>held</th><th>late</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) =>
            <tr key={idx} className={classNames({[styles.bad]: row.slips > 0 || row.stalled})}>
              <td>{idx + 1}</td>
              <td>{row.slips}</td>
              <td>{row.stalled ? "yes" : ""}</td>
              <td>{formatMs(row.latency)}</td>
              <td>{formatMs(row.spread)}</td>
              <td>{count(row.early)}</td>
              <td>{count(row.heldCredit)}</td>
              <td>{formatMs(row.late)}</td>
            </tr>)}
        </tbody>
      </table>}
    </section>
  }
}
