// Pure derivations for Today, the first tab of the practice record
// (st/components/pages/today_page): the whole practice day from 4 am (see
// st/srs/schedule localDay), every session and every piece, worked out from
// records the trainer already keeps and nothing else: the session records
// (NoteStats#sessionRecord), the bar log's rows (BarLogRecord, one row per
// bar per finished pass) and the bar items' pass histories. Nothing new is
// recorded for it and nothing is measured here, the rule st/progress and
// st/dev_metrics follow: a bar's figure for the day is the This-session rule
// (st/bar_progress barTotals) over the day's rows, and a mistake is told by
// its beat (st/bar_review beatLabel), never by a note name.
//
// Every function takes `now` and what it reads as parameters, never the
// clock or the store, so the maths needs no mocking.

import {localDay, dayStart} from "st/srs/schedule"
import {daysAgo} from "st/srs/planner"
import {sessionSeconds} from "st/progress"
import {sessionLogOf, barTotals, barMark, learnedSince, TROUBLE_BELOW} from "st/bar_progress"
import {beatLabel, HABIT_PASSES} from "st/bar_review"
import {measureNumberList, measureBeatRange} from "st/song_sections"

// how many trouble bars a piece's plate names before "and N more"
export const TODAY_TROUBLE_ROWS = 5

// how many learned bars the card names before "and N more"
export const TODAY_LEARNED_BARS = 6

// how many lines "Kept going wrong" shows
export const KEPT_GOING_WRONG_ROWS = 3

// st/data's PROGRAMME_PRACTICE, FREE_PRACTICE and WHOLE_SECTION, as a
// session's settings keep them (this module imports nothing of st/data;
// practice_day_spec checks they match)
export const PROGRAMME = "programme"
export const FREE = "free practice"
export const WHOLE = "all"

const SHEET_MUSIC = "sheet music"
const COSTLY = ["wrong", "skipped", "scrolled"]
const PHRASE = {wrong: "went wrong", skipped: "was skipped", scrolled: "went by unplayed"}
const TICKS = 960
const HAND_WORDS = {both: "", upper: "right hand", lower: "left hand"}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const plural = (count, word) => `${count} ${count == 1 ? word : word == "pass" ? "passes" : `${word}s`}`
const lower = words => words.charAt(0).toLowerCase() + words.slice(1)

// the rounded percent of notes read right, or null with neither
function percent(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

const sum = (list, field) => list.reduce((total, one) => total + (one[field] || 0), 0)
const isPiece = session => session.generator == SHEET_MUSIC
const pad = n => String(n).padStart(2, "0")

/**
 * The minutes the sessions of a practice day count for, as the strips say
 * them: the rounded Σ of each session's own seconds (st/progress
 * sessionSeconds).
 * @param {Object[]} sessions
 * @param {Object} opts
 * @param {number} opts.now the day is the one this time falls on
 * @param {Object} [opts.record] a session just ended, whose own record
 * replaces the cached one of the same id (the cache only updates once its
 * write has landed) or is added to them
 * @returns {number}
 */
export function todayMinutes(sessions, {now, record=null}) {
  let day = localDay(now)
  let all = record && record.id != null ? [...sessions.filter(s => s.id != record.id), record] : sessions
  let seconds = all.filter(s => localDay(s.startedAt) == day).reduce((total, s) => total + sessionSeconds(s), 0)
  return Math.round(seconds / 60)
}

/**
 * The strips' line about today's minutes.
 * @param {number} minutes
 * @param {number} goal the daily goal, in minutes
 * @returns {string} "15 minutes today, goal 10 met" once the goal is met,
 * else "6 of 10 minutes today"
 */
export function todayMinutesWords(minutes, goal) {
  if (minutes >= goal) { return `${plural(minutes, "minute")} today, goal ${goal} met` }
  return `${minutes} of ${plural(goal, "minute")} today`
}

// "12 min", "< 1 min" under half a minute
function sessionMinutes(session) {
  let seconds = sessionSeconds(session)
  return seconds < 30 ? "< 1 min" : `${Math.round(seconds / 60)} min`
}

// "bar 3" or "bars 1–8"
const barsWords = (first, last) => first == last ? `bar ${first}` : `bars ${first}–${last}`

// the piece sessions' pieces and the exercise sessions' generators, as the
// sessions card says them: "1 piece, 1 exercise"
function sessionsCaption(sessions) {
  let pieces = new Set(sessions.filter(isPiece).map(s => s.settings?.piece ?? s.settings?.pieceTitle))
  let exercises = new Set(sessions.filter(s => !isPiece(s)).map(s => s.generator))

  return [
    pieces.size ? plural(pieces.size, "piece") : null,
    exercises.size ? plural(exercises.size, "exercise") : null,
  ].filter(Boolean).join(", ")
}

// the accuracy card's "▲ 3 on yesterday", or null when either day read no notes
function accuracyChange(today, yesterday) {
  if (today == null || yesterday == null) { return null }
  let diff = today - yesterday
  return diff > 0 ? `▲ ${diff} on yesterday` : diff < 0 ? `▼ ${-diff} on yesterday` : "Level with yesterday"
}

// what yesterday's sessions come to, for the empty day: "Yesterday: 18
// minutes, Fixture and 2 exercises, 89%."
function yesterdayLine(sessions) {
  let minutes = Math.round(sum(sessions.map(s => ({seconds: sessionSeconds(s)})), "seconds") / 60)
  let titles = [...new Set(sessions.filter(isPiece).map(s => s.settings?.pieceTitle || "song notation"))]
  let exercises = new Set(sessions.filter(s => !isPiece(s)).map(s => s.generator)).size
  let parts = [...titles, exercises ? plural(exercises, "exercise") : null].filter(Boolean)
  let accuracy = percent(sum(sessions, "notesRead"), sum(sessions, "misses"))

  return `Yesterday: ${[
    plural(minutes, "minute"),
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0],
    accuracy == null ? null : `${accuracy}%`,
  ].filter(Boolean).join(", ")}.`
}

// the costly marks of a bar's detected rows grouped by where in the bar they
// fall, PR 82's rule: a beat on the song's clock, else the column's place.
// Each group knows the rows it was seen in, its latest kind and its beat
function markGroups(rows) {
  let groups = new Map()

  rows.forEach((row, ri) => {
    for (let [idx, kind] of (row.marks || []).filter(mark => COSTLY.includes(mark[1]))) {
      let beat = row.beats[idx]
      let id = beat == null ? `i${idx}` : `b${Math.round(beat * TICKS)}`
      let group = groups.get(id)
      if (!group) {
        group = {id, beat, index: idx, columns: row.columns, rows: new Set(), kind, last: ri}
        groups.set(id, group)
      }

      group.rows.add(ri)
      group.kind = kind
      group.last = ri
      group.index = idx
      group.columns = row.columns
    }
  })

  // most rows first, ties to the latest, then the earlier place in the bar
  return [...groups.values()].sort((a, b) =>
    b.rows.size - a.rows.size || b.last - a.last || (a.beat ?? a.index) - (b.beat ?? b.index))
}

// "in your only pass", "in all 3 passes", "once in 3 passes", "in 2 of 3 passes"
function timesWords(n, m) {
  return m == 1 ? "in your only pass" : n == m ? `in all ${m} passes` :
    n == 1 ? `once in ${m} passes` : `in ${n} of ${m} passes`
}

// a self-graded bar's most frequent "What slipped?" tag, null with none
function slippedTag(rows) {
  let counts = new Map()
  for (let row of rows) {
    for (let tag of row.slipped || []) { counts.set(tag, (counts.get(tag) || 0) + 1) }
  }

  let best = null
  for (let [tag, count] of counts) {
    if (!best || count > best[1]) { best = [tag, count] }
  }
  return best && best[0]
}

// the line under a trouble bar: what went wrong in it, told by beat
function troubleWords(measure, rows, total, barStart) {
  let detected = rows.filter(row => row.mode != "self")

  if (!detected.length) {
    let tag = slippedTag(rows.filter(row => row.mode == "self"))
    return `${total.selfClean} of ${total.selfPasses} passes clean${tag ? ` · slipped: ${tag}` : ""}`
  }

  let groups = markGroups(detected)
  let m = detected.length
  let label = group => beatLabel(group.beat, barStart, group.index, group.columns)
  let hesitations = detected.reduce((count, row) =>
    count + (row.marks || []).filter(mark => mark[1] == "hesitated").length, 0)

  let words = groups.length ?
    `${label(groups[0])} ${PHRASE[groups[0].kind]} ${timesWords(groups[0].rows.size, m)}` :
    `${Math.round(100 * total.clean / total.columns)}% today`
  if (groups.length > 1) { words += `; also ${lower(label(groups[1]))}` }
  if (hesitations) { words += ` · ${plural(hesitations, "hesitation")}, not in the %` }

  return words
}

// the bars of a piece whose items were learned today, any hand, ordered by
// bar and then hand
function learnedBars(items, todayStart) {
  return items
    .filter(item => item.startMeasure == item.endMeasure && !item.beats && learnedSince(item, todayStart))
    .sort((a, b) => a.startMeasure - b.startMeasure || (a.hand < b.hand ? -1 : a.hand > b.hand ? 1 : 0))
    .map(item => ({measure: item.startMeasure, hand: item.hand}))
}

// the learned-today card's line: "Fixture bars 1, 2, 4, 5", "Fixture bar 6,
// left hand", pieces and hands joined with "; ", the first TODAY_LEARNED_BARS
// bars and then "and N more"
function learnedCaption(learned) {
  if (!learned.length) { return "Three clean passes in a row learns a bar" }

  let shown = learned.slice(0, TODAY_LEARNED_BARS)
  let segments = []
  for (let bar of shown) {
    let last = segments[segments.length - 1]
    if (last && last.title == bar.title && last.hand == bar.hand) {
      last.measures.push(bar.measure)
    } else {
      segments.push({title: bar.title, hand: bar.hand, measures: [bar.measure]})
    }
  }

  let text = segments.map(({title, hand, measures}) => {
    let hands = HAND_WORDS[hand]
    return `${title} ${measures.length == 1 ? "bar" : "bars"} ${measures.join(", ")}${hands ? `, ${hands}` : ""}`
  }).join("; ")

  return learned.length > shown.length ? `${text} and ${learned.length - shown.length} more` : text
}

// one piece's plate: its bars shaded by the day, its trouble lines and the
// span to practise
function piecePlate(piece, rows, items, todayStart) {
  let song = piece.song
  let measures = measureNumberList(song)
  let totals = barTotals(sessionLogOf(rows))
  let learned = new Set(learnedBars(items, todayStart).map(bar => bar.measure))

  let cells = measures.map(measure => {
    let total = totals.get(measure)
    let mark = total ? barMark(total) : null
    let isLearned = learned.has(measure)

    return {
      measure,
      kind: mark ? mark.kind : null,
      label: mark ? mark.label : null,
      share: mark ? mark.share : null,
      learned: isLearned,
      ariaLabel: mark ?
        `Bar ${measure}, ${mark.label} today${isLearned ? ", learned today" : ""}` :
        `Bar ${measure}, not played today`,
    }
  })

  let played = cells.filter(cell => cell.kind)
  let under = played.filter(cell => cell.share < 100)
    .sort((a, b) => a.share - b.share || a.measure - b.measure)

  let troubles = under.slice(0, TODAY_TROUBLE_ROWS).map(cell => {
    let barRows = rows.filter(row => row.measure == cell.measure)
    let barStart = measureBeatRange(song, cell.measure, cell.measure)[0]
    return {
      measure: cell.measure,
      kind: cell.kind,
      label: cell.label,
      text: troubleWords(cell.measure, barRows, totals.get(cell.measure), barStart),
    }
  })

  let weak = played.filter(cell => cell.share < TROUBLE_BELOW).map(cell => cell.measure)
  let practise = null
  if (weak.length) {
    let start = Math.min(...weak)
    let end = Math.max(...weak)
    practise = {
      start, end,
      label: start == end ? `Practise bar ${start}` : `Practise bars ${start}–${end}`,
      note: measures.filter(m => m >= start && m <= end).some(m => !weak.includes(m)) ?
        "One bar a card, the weakest most often." : null,
    }
  }

  return {
    id: piece.id,
    title: piece.title,
    played: played.length,
    total: measures.length,
    cells,
    troubles,
    moreTrouble: under.length - troubles.length,
    practise,
  }
}

// the sessions list's rows: what was played, how long and how well
function sessionRows(sessions, rows, exerciseLabel) {
  return sessions.map(session => {
    let date = new Date(session.startedAt)
    let row = {
      id: session.id,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
      kind: isPiece(session) ? "piece" : "exercise",
      title: null,
      italic: null,
      small: null,
      minutes: sessionMinutes(session),
      figure: null,
    }

    if (isPiece(session)) {
      let settings = session.settings || {}
      let own = rows ? rows.filter(r => r.sessionId == session.id) : []
      row.title = settings.pieceTitle || "Song notation"

      if (settings.practice == PROGRAMME) {
        let passes = sessionLogOf(own).length
        row.italic = "today's programme"
        row.small = passes ? plural(passes, "pass") : null
      } else if (settings.practice == FREE) {
        let size = settings.measuresPerCard
        row.italic = barsWords(settings.startMeasure, settings.endMeasure)
        row.small = `Free practice · ${size == WHOLE || size == null ? "the section as one card" :
          `${plural(Number(size), "bar")} a card`}`
      } else if (own.length) {
        let measures = own.map(r => r.measure)
        row.italic = barsWords(Math.min(...measures), Math.max(...measures))
        row.small = plural(sessionLogOf(own).length, "pass")
      }
    } else {
      let {italic, small} = exerciseLabel(session)
      row.title = "Sight reading"
      row.italic = italic
      row.small = small
    }

    let accuracy = percent(session.notesRead, session.misses)
    if (accuracy != null) {
      row.figure = {text: `${accuracy}%`, weak: accuracy < TROUBLE_BELOW}
    } else if (session.selfGraded && session.selfGraded.passes) {
      row.figure = {text: `${session.selfGraded.clean} of ${session.selfGraded.passes} clean`, weak: false}
    } else {
      row.figure = {text: "—", weak: false}
    }

    return row
  })
}

// "Mistakes today": the costly marks of every detected row by kind, each a
// share of all of them
function mistakesOf(rows) {
  let detected = rows.filter(row => row.mode != "self")
  if (!detected.length) { return null }

  let marks = detected.flatMap(row => row.marks || [])
  let count = kinds => marks.filter(mark => kinds.includes(mark[1])).length
  let figures = [
    {kind: "wrong", label: "Wrong notes", count: count(["wrong"])},
    {kind: "skipped", label: "Skipped", count: count(["skipped", "scrolled"])},
    {kind: "hesitated", label: "Hesitations (not in the %)", count: count(["hesitated"])},
  ]
  let total = sum(figures, "count")

  return figures.map(figure => ({...figure, width: total ? Math.round(100 * figure.count / total) : 0}))
}

// "Kept going wrong": a note of a place in a bar that went wrong in
// HABIT_PASSES rows or more today, most rows first, then the latest
function habitsOf(pieces, rowsByPiece) {
  let several = [...rowsByPiece.values()].filter(rows => rows.length).length > 1
  let habits = []

  for (let piece of pieces) {
    let rows = (rowsByPiece.get(piece.id) || []).filter(row => row.mode != "self").sort((a, b) => a.at - b.at)
    let groups = new Map()

    for (let row of rows) {
      for (let [idx, kind, notes] of (row.marks || []).filter(mark => COSTLY.includes(mark[1]))) {
        let beat = row.beats[idx]
        for (let note of notes) {
          let id = `${row.measure}\n${beat == null ? `i${idx}` : `b${Math.round(beat * TICKS)}`}\n${note}`
          let group = groups.get(id)
          if (!group) {
            group = {measure: row.measure, beat, index: idx, columns: row.columns, rows: new Set(), last: 0}
            groups.set(id, group)
          }
          group.rows.add(row.at)
          group.last = row.at
          group.kind = kind
        }
      }
    }

    for (let group of groups.values()) {
      if (group.rows.size < HABIT_PASSES) { continue }

      let barStart = measureBeatRange(piece.song, group.measure, group.measure)[0]
      habits.push({
        text: `${several ? `${piece.title} · ` : ""}Bar ${group.measure}, ${lower(beatLabel(group.beat, barStart, group.index, group.columns))}`,
        times: group.rows.size,
        last: group.last,
      })
    }
  }

  return habits
    .sort((a, b) => b.times - a.times || b.last - a.last)
    .slice(0, KEPT_GOING_WRONG_ROWS)
    .map(({text, times}) => ({text, times: `${times} times`}))
}

/**
 * Today, figure by figure.
 * @param {Object} opts
 * @param {number} opts.now
 * @param {Object[]} opts.sessions every session known, a superset of the
 * two days it reads (st/storage recentSessions and sessionsSince, merged)
 * @param {Object[]|null} opts.rows the bar log's rows of the day, null until
 * they are read (the sessions and cards still show)
 * @param {Object[]} opts.pieces the pieces the rows may be of, {id, title,
 * song}; a row of a piece not in the list adds nothing
 * @param {function(string): Object[]} opts.items a piece's bar items (st/storage items)
 * @param {boolean} opts.played whether any bar has been played before
 * (any item with attempts), for the first-use state
 * @param {number} opts.goal the daily goal in minutes
 * @param {function(Object): {italic: string, small: string}} opts.exerciseLabel
 * the words of an exercise session, from the page's staves and generators
 * @returns {Object} {state: "played"|"first-use"|"nothing-today", ...}
 */
export function practiceDay({now, sessions, rows, pieces, items, played, goal, exerciseLabel}) {
  let day = localDay(now)
  let todayStart = dayStart(day)
  let date = new Date(todayStart)

  let todays = sessions.filter(s => localDay(s.startedAt) == day && s.startedAt <= now)
    .sort((a, b) => a.startedAt - b.startedAt)
  let yesterdays = sessions.filter(s => localDay(s.startedAt) == day - 1)

  let byId = new Map(pieces.map(piece => [piece.id, piece]))
  let todayRows = (rows || []).filter(row => localDay(row.at) == day && byId.has(row.pieceId))
  let rowsByPiece = new Map()
  for (let row of todayRows) {
    if (!rowsByPiece.has(row.pieceId)) { rowsByPiece.set(row.pieceId, []) }
    rowsByPiece.get(row.pieceId).push(row)
  }

  let result = {
    day,
    date: {weekday: WEEKDAYS[date.getDay()], day: date.getDate(), month: MONTHS[date.getMonth()]},
    loaded: rows != null,
  }

  if (!todays.length && !todayRows.length) {
    let latest = sessions.reduce((best, s) => !best || s.startedAt > best.startedAt ? s : best, null)
    if (!sessions.length && !played) {
      return {...result, state: "first-use"}
    }

    return {
      ...result,
      state: "nothing-today",
      yesterday: yesterdays.length ? yesterdayLine(yesterdays) : null,
      lastSeen: !yesterdays.length && latest ? `Last at the bench ${daysAgo(latest.startedAt, now)}.` : null,
    }
  }

  let minutes = Math.round(sum(todays.map(s => ({seconds: sessionSeconds(s)})), "seconds") / 60)
  let scale = Math.max(goal, minutes)
  let accuracy = percent(sum(todays, "notesRead"), sum(todays, "misses"))
  let previous = percent(sum(yesterdays, "notesRead"), sum(yesterdays, "misses"))

  let platePieces = pieces.filter(piece => rowsByPiece.has(piece.id))
  let learned = platePieces.flatMap(piece => learnedBars(items(piece.id), todayStart)
    .map(bar => ({...bar, title: piece.title})))

  return {
    ...result,
    state: "played",
    cards: {
      minutes: {
        value: minutes, goal, met: minutes >= goal,
        fill: scale ? minutes / scale : 0, tick: scale ? goal / scale : 0,
        ariaLabel: `${minutes} of ${goal} minutes`,
      },
      sessions: {value: todays.length, caption: sessionsCaption(todays)},
      accuracy: {value: accuracy, change: accuracyChange(accuracy, previous)},
      learned: {value: learned.length, caption: learnedCaption(learned)},
    },
    sessions: sessionRows(todays, rows, exerciseLabel),
    pieces: platePieces.map(piece =>
      piecePlate(piece, rowsByPiece.get(piece.id), items(piece.id), todayStart)),
    mistakes: mistakesOf(todayRows),
    habits: habitsOf(platePieces, rowsByPiece),
    closing: closingLine(minutes, learned.length, minutes >= goal),
  }
}

// "34 minutes, and 4 bars learned. A good evening at the bench.", nothing
// at all when both are 0
function closingLine(minutes, learned, met) {
  if (!minutes && !learned) { return null }

  let words = learned ? `${plural(minutes, "minute")}, and ${plural(learned, "bar")} learned.` :
    `${plural(minutes, "minute")}.`
  return met ? `${words} A good evening at the bench.` : words
}
