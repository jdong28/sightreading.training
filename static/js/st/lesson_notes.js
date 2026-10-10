// Notes for the next lesson (the practice record's "For my lesson"): what a
// student wants to ask the teacher, written on a bar, flagged in a session, or
// left on a piece or no piece at all, and the pure reading of them the pages
// paint. A note is a LessonNoteRecord in the local store's lessonNotes, below.
//
// A bar's or a session's note is for a range of the score's printed bar
// numbers of one piece under one hand (the setup pane's, as items are); a
// whole-piece note has a piece and no bars, and a note for "any piece" has
// neither. A flag made in a session is an open note with no words yet
// (text ""), to be given them at rest. Dropping a note keeps it stored with
// status "dropped" and never shows it, since deleting it would let a library
// merge bring it back; every change bumps updatedAt, which the merge keeps
// the newer of.
//
// The "Then" of a note is a snapshot of what the record said when it was
// written (evidenceOf): the bar's accuracy and the one sentence st/bar_review
// gives as `summary`, told by beats and never by note names. "Now" is read
// from the items as they stand, so the lesson sees whether it improved.
//
// Nothing here reads the clock, the store or the page except readEvidence,
// which is handed the store.

import {passHistory, passAccuracy, isClean, learnedness, learnedCount, learnedSince} from "st/bar_progress"
import {barReview} from "st/bar_review"
import {sessionSeconds} from "st/progress"
import {itemId, HANDS} from "st/srs/records"
import {localDay} from "st/srs/schedule"
import {measureNumberList, measureBeatRange} from "st/song_sections"

export const LESSON_TOPICS = [
  {key: "notes", label: "Notes"},
  {key: "rhythm", label: "Rhythm"},
  {key: "fingering", label: "Fingering"},
  {key: "pedal", label: "Pedal"},
  {key: "practice", label: "How to practise"},
  {key: "other", label: "Other"},
]

export const NOTE_SOURCES = ["bar", "session", "general"]
export const NOTE_STATUSES = ["open", "discussed", "dropped"]

// the most characters a note's words (or an answer) hold
export const NOTE_MAX_CHARS = 1000

// how many lesson days of discussed notes the tab lists before "and N earlier"
export const DISCUSSED_DAYS = 3

// how many passes "Over time" tells
export const OVER_TIME_PASSES = 8

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const HAND_WORDS = {both: "both hands", upper: "right hand", lower: "left hand"}
const SHEET_MUSIC = "sheet music"

/**
 * One note for a lesson, the lessonNotes store's row.
 * @typedef {Object} LessonNoteRecord
 * @property {string} id "n" + the time in base 36 + 6 random characters
 * @property {string|null} pieceId null for a note on no piece in particular
 * @property {string|null} pieceTitle the piece's title when written, which a
 * note keeps when its piece is removed
 * @property {number|null} start printed bar numbers, both null for a note on
 * a whole piece or no piece; start <= end
 * @property {number|null} end
 * @property {string} hand "both", "upper" or "lower": the setup pane's hand
 * for a bar's note (itemHand), "both" for any other
 * @property {string|null} topic a key of LESSON_TOPICS
 * @property {string} text 0 to NOTE_MAX_CHARS characters, "" only for a
 * flag made in a session until words are added
 * @property {string} source "bar", "session" or "general"
 * @property {number} createdAt
 * @property {number} updatedAt bumped on every change
 * @property {{at: number, accuracy: number|null, line: string|null}|null} evidence
 * what the record said when the note was written
 * @property {string} status "open", "discussed" or "dropped"
 * @property {number} [discussedAt] ms, when (and only when) discussed
 * @property {string} [answer] the teacher's words, "" allowed
 * @property {number} [keptAt] ms of the last "Keep for next time"
 */

const isTime = n => typeof n == "number" && Number.isFinite(n)
const optional = (value, test) => value === undefined || test(value)
const isString = s => typeof s == "string"

/**
 * @param {*} note
 * @returns {boolean} whether note has the shape of a stored lesson note
 */
export function validLessonNote(note) {
  if (!note || typeof note != "object") { return false }

  let bars = note.start !== null && note.start !== undefined
  let ok = isString(note.id) && note.id != "" &&
    (note.pieceId === null || (isString(note.pieceId) && note.pieceId != "")) &&
    (note.pieceTitle === null || isString(note.pieceTitle)) &&
    (bars ? Number.isInteger(note.start) && Number.isInteger(note.end) && note.start <= note.end :
      note.end === null) &&
    HANDS.includes(note.hand) &&
    (note.topic === null || LESSON_TOPICS.some(topic => topic.key == note.topic)) &&
    isString(note.text) && note.text.length <= NOTE_MAX_CHARS &&
    NOTE_SOURCES.includes(note.source) &&
    isTime(note.createdAt) && isTime(note.updatedAt) &&
    NOTE_STATUSES.includes(note.status) &&
    (note.evidence === null || (!!note.evidence && typeof note.evidence == "object" &&
      isTime(note.evidence.at) &&
      (note.evidence.accuracy === null || isTime(note.evidence.accuracy)) &&
      (note.evidence.line === null || isString(note.evidence.line)))) &&
    (note.status == "discussed" ? isTime(note.discussedAt) : note.discussedAt === undefined) &&
    optional(note.answer, answer => isString(answer) && answer.length <= NOTE_MAX_CHARS) &&
    optional(note.keptAt, isTime)

  // a bar's note, and a session's flag, are for bars of a piece
  return ok && (note.source == "general" || (note.pieceId !== null && bars))
}

/**
 * A new open note.
 * @param {Object} fields
 * @param {string} fields.source "bar", "session" or "general"
 * @param {string|null} [fields.pieceId]
 * @param {string|null} [fields.pieceTitle]
 * @param {number|null} [fields.start]
 * @param {number|null} [fields.end]
 * @param {string} [fields.hand] "both" by default
 * @param {string|null} [fields.topic]
 * @param {string} [fields.text]
 * @param {Object|null} [fields.evidence]
 * @param {number} [fields.now]
 * @returns {LessonNoteRecord}
 */
export function newLessonNote({
  source, pieceId=null, pieceTitle=null, start=null, end=null, hand="both", topic=null, text="",
  evidence=null, now=Date.now(),
}) {
  let random = Array.from({length: 6}, () => Math.floor(Math.random() * 36).toString(36)).join("")

  return {
    id: `n${now.toString(36)}${random}`,
    pieceId, pieceTitle, start, end: start === null ? null : end, hand, topic, text, source,
    createdAt: now, updatedAt: now, evidence, status: "open",
  }
}

/**
 * The note with its piece changed, as a library import files it under the
 * piece of this library.
 * @param {LessonNoteRecord} note
 * @param {string|null} pieceId
 * @returns {LessonNoteRecord}
 */
export function lessonNoteForPiece(note, pieceId) {
  return {...note, pieceId}
}

/**
 * @param {LessonNoteRecord[]} notes
 * @returns {LessonNoteRecord[]} the open ones
 */
export function openNotes(notes) {
  return notes.filter(note => note.status == "open")
}

const overlaps = (note, start, end) => note.start != null && note.start <= end && note.end >= start

/**
 * The open notes with words that cover any of the bars, for the lines in a
 * clicked bar's window and the session rail.
 * @param {LessonNoteRecord[]} notes
 * @param {string} pieceId
 * @param {number} start
 * @param {number} end
 * @returns {LessonNoteRecord[]} newest first
 */
export function notesOnBars(notes, pieceId, start, end) {
  return openNotes(notes)
    .filter(note => note.pieceId == pieceId && note.text != "" && overlaps(note, start, end))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * The discussed notes with an answer that cover any of the bars.
 * @param {LessonNoteRecord[]} notes
 * @param {string} pieceId
 * @param {number} start
 * @param {number} end
 * @returns {LessonNoteRecord[]} newest discussion first
 */
export function answersOnBars(notes, pieceId, start, end) {
  return notes
    .filter(note => note.status == "discussed" && note.answer && note.pieceId == pieceId &&
      overlaps(note, start, end))
    .sort((a, b) => b.discussedAt - a.discussedAt)
}

/**
 * The pins the score draws: one at the first bar of each open note's bars
 * (words or not), counting the notes there.
 * @param {LessonNoteRecord[]} notes
 * @param {string} pieceId
 * @returns {{measure: number, count: number}[]} by bar
 */
export function notePins(notes, pieceId) {
  let counts = new Map()
  for (let note of openNotes(notes)) {
    if (note.pieceId == pieceId && note.start != null) {
      counts.set(note.start, (counts.get(note.start) || 0) + 1)
    }
  }

  return [...counts].map(([measure, count]) => ({measure, count})).sort((a, b) => a.measure - b.measure)
}

/**
 * @param {LessonNoteRecord[]} notes
 * @returns {number|null} when the teacher last answered a note, the latest discussedAt
 */
export function lastLesson(notes) {
  let times = notes.filter(note => note.status == "discussed").map(note => note.discussedAt)
  return times.length ? Math.max(...times) : null
}

/**
 * Where "since your last lesson" counts from: the last lesson, else the
 * oldest open note. Null with neither.
 * @param {LessonNoteRecord[]} notes
 * @returns {number|null}
 */
export function lessonSince(notes) {
  let last = lastLesson(notes)
  if (last != null) { return last }

  let times = openNotes(notes).map(note => note.createdAt)
  return times.length ? Math.min(...times) : null
}

const lowerFirst = words => words.charAt(0).toLowerCase() + words.slice(1)

/**
 * What a snapshot says as words to follow "Then:" or "Attach what happened:":
 * "75%, beat 2 went wrong in all 3 of your last passes", never a note name.
 * @param {{accuracy: number|null, line: string|null}|null} evidence
 * @returns {string|null}
 */
export function evidenceWords(evidence) {
  if (!evidence) { return null }

  let line = evidence.line && (/^Bar \d/.test(evidence.line) ? evidence.line : lowerFirst(evidence.line))
  if (evidence.accuracy == null) { return line || null }
  return line ? `${evidence.accuracy}%, ${line}` : `${evidence.accuracy}%`
}

// the latest detected pass of an item as [columns, clean], null without one
function latestPass(item) {
  let passes = passHistory(item).filter(entry => entry[1] > 0)
  return passes.length ? passes[passes.length - 1] : null
}

const percentOf = (columns, clean) => columns ? Math.round(100 * clean / columns) : null

/**
 * What the record says of bars as a note is written: the accuracy of each
 * bar's latest detected pass added up, and one sentence about the worst bar.
 * @param {Object} opts
 * @param {{measure: number, item: Object|null, review: Object|null}[]} opts.bars
 * each bar's single-bar item under the note's hand and its barReview
 * @param {number} opts.now
 * @returns {{at: number, accuracy: number|null, line: string|null}|null} null
 * when none of the bars was played
 */
export function evidenceOf({bars, now}) {
  let played = bars.filter(bar => bar.review && bar.review.state != "never")
  if (!played.length) { return null }

  let acoustic = played.filter(bar => bar.review.state == "acoustic")
  let detected = played.filter(bar => bar.review.state == "detected")

  let columns = 0
  let clean = 0
  let latest = []
  for (let {measure, item} of [...detected, ...played.filter(bar => bar.review.state == "before")]) {
    let pass = latestPass(item)
    if (!pass) { continue }
    columns += pass[1]
    clean += pass[2]
    latest.push({measure, accuracy: percentOf(pass[1], pass[2])})
  }
  let accuracy = percentOf(columns, clean)

  if (!detected.length) {
    let tags = [...new Set(acoustic.flatMap(bar => bar.review.tags || []))].map(lowerFirst)
    if (acoustic.length && tags.length) {
      return {at: now, accuracy: null, line: `You noted: ${tags.join(", ")}`}
    }
    return accuracy == null ? null : {at: now, accuracy, line: null}
  }

  if (detected.length == 1 && bars.length == 1) {
    return {at: now, accuracy, line: detected[0].review.summary}
  }

  // the lowest of the bars, one that went wrong before one that didn't on a
  // tie and the first of them after that
  let allRight = bar => bar.review.summary.startsWith("Every note right")
  let rank = bar => (latest.find(l => l.measure == bar.measure) || {accuracy: 100}).accuracy
  let worst = detected.reduce((low, bar) => !low || rank(bar) < rank(low) ||
    (rank(bar) == rank(low) && allRight(low) && !allRight(bar)) ? bar : low, null)

  let line = allRight(worst) ? "Every note right in your last passes" :
    `Bar ${worst.measure}: ${lowerFirst(worst.review.summary)}`

  return {at: now, accuracy, line}
}

/**
 * Reads the record for bars: their bar log rows and items, and what
 * evidenceOf makes of them.
 * @param {LocalStore} store
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {string} opts.hand the note's hand, one of HANDS
 * @param {number} opts.start
 * @param {number} opts.end
 * @param {Object} opts.song the piece's song (st/sheet_music_deck pieceSong)
 * @param {number} [opts.now]
 * @returns {Promise<{at: number, accuracy: number|null, line: string|null}|null>}
 */
export async function readEvidence(store, {pieceId, hand, start, end, song, now=Date.now()}) {
  let measures = measureNumberList(song).filter(measure => measure >= start && measure <= end)

  let bars = await Promise.all(measures.map(async measure => {
    let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
    let rows = await store.barLog({itemId: id})
    let item = store.item(id)
    return {
      measure, item,
      review: barReview({rows, item, measure, barStart: measureBeatRange(song, measure, measure)[0], now}),
    }
  }))

  return evidenceOf({bars, now})
}

const shortDate = at => `${new Date(at).getDate()} ${MONTHS[new Date(at).getMonth()].slice(0, 3)}`
const longDate = at => `${new Date(at).getDate()} ${MONTHS[new Date(at).getMonth()]}`

/**
 * A time as a note shows it, "9 Oct".
 * @param {number} at
 * @returns {string}
 */
export const noteDate = shortDate

/**
 * A time as a heading shows it, "9 October".
 * @param {number} at
 * @returns {string}
 */
export const noteLongDate = longDate

const plural = (count, word) => `${count} ${word}${count == 1 ? "" : "s"}`

/**
 * @param {number} start
 * @param {number} end
 * @returns {string} "Bar 3" or "Bars 3–4"
 */
export const barsPlace = (start, end) => start == end ? `Bar ${start}` : `Bars ${start}–${end}`

// where a note sits in the lesson tab: "Bar 3", the piece's title, "Any piece"
function placeOf(note, title) {
  return note.start != null ? barsPlace(note.start, note.end) : note.pieceId == null ? "Any piece" : title
}

function labelOf(note, {discussed}) {
  let topic = LESSON_TOPICS.find(t => t.key == note.topic)
  let parts = []

  if (!discussed && note.source == "session" && note.text == "") {
    parts.push("Flagged in a session")
  } else {
    if (topic) { parts.push(topic.label) }
    if (note.start != null) { parts.push(HAND_WORDS[note.hand]) }
  }

  parts.push(discussed ? `discussed ${shortDate(note.discussedAt)}` : shortDate(note.createdAt))
  if (!discussed && note.keptAt != null) { parts.push("kept for next time") }
  return parts.join(" · ")
}

// The words of a bar note's or range's "Then", "Now" and "Over time", from
// the items under the note's hand
function barEvidence(note, {items, song}) {
  let measures = song ? measureNumberList(song).filter(m => m >= note.start && m <= note.end) : []
  if (!measures.length) { measures = [note.start] }

  let bars = measures.map(measure => items.get(itemId({
    pieceId: note.pieceId, hand: note.hand, startMeasure: measure, endMeasure: measure,
  })) || null)

  let passes = bars.map(latestPass).filter(Boolean)
  let columns = passes.reduce((sum, pass) => sum + pass[1], 0)
  let clean = passes.reduce((sum, pass) => sum + pass[2], 0)
  let accuracy = percentOf(columns, clean)
  let ranks = bars.map(learnedness)

  let now
  if (bars.length == 1) {
    let parts = []
    if (accuracy != null) { parts.push(`${accuracy}% latest`) }
    if (ranks[0] === 3) { parts.push("learned") }
    else if (ranks[0] != null) { parts.push(`${ranks[0]} of 3 towards learned`) }
    now = `Now: ${parts.length ? parts.join(", ") : "not played yet"}.`
  } else {
    let learned = ranks.filter(rank => rank === 3).length
    now = accuracy == null ? "Now: not played yet." :
      `Now: ${accuracy}% latest across ${barsPlace(note.start, note.end).toLowerCase()}, ${learned} of ${bars.length} bars learned.`
  }

  let history = bars.length == 1 ? passHistory(bars[0]).filter(entry => entry[1] > 0)
    .slice(-OVER_TIME_PASSES).map(entry => passAccuracy(entry)) : []
  let over = history.length > 1 ? `Over time: ${history.join(" → ")}.` : null

  return {bars, now, over, accuracy}
}

// "Since then" of a discussed bar note: when it was learned, or how the bar
// plays now
function sinceThen(note, {items}) {
  if (note.start == null || note.start != note.end) { return null }

  let item = items.get(itemId({
    pieceId: note.pieceId, hand: note.hand, startMeasure: note.start, endMeasure: note.end,
  })) || null

  if (learnedSince(item, note.discussedAt)) {
    // the pass that made the third clean one of the run it ends with
    let history = passHistory(item).filter(entry => entry[1] !== 0)
    let run = history.length
    while (run > 0 && isClean(history[run - 1])) { run -= 1 }
    return `Since then: learned on ${longDate(history[run + 2][0])}.`
  }

  let after = passHistory(item).filter(entry => entry[0] >= note.discussedAt && entry[1] > 0)
  if (!after.length) { return "Since then: not played." }

  let last = after[after.length - 1]
  return `Since then: ${passAccuracy(last)}% latest.`
}

/**
 * The tab's model, as Today's is practiceDay's: every note's words worked out
 * and nothing left to the component but painting them. Dropped notes are
 * never in it.
 * @param {Object} opts
 * @param {LessonNoteRecord[]} opts.notes every note, any status
 * @param {{id: string, title: string, song: Object}[]} opts.pieces the pieces
 * in the library, song as pieceSong gives it
 * @param {ItemRecord[]} opts.items every item
 * @param {SessionRecord[]} opts.sessions the sessions since lessonSince(notes)
 * @param {number} opts.now
 * @returns {Object} {count, empty, since, groups, discussed, earlier}: count
 * the open notes; since the card ({label, days, daysWords, detail}, null with
 * no notes); groups the open notes by piece, each {key, pieceId, title,
 * removed, header, notes}; discussed the last DISCUSSED_DAYS lesson days
 * {key, label, notes}, newest first; earlier the discussed notes before them
 */
export function lessonView({notes, pieces, items, sessions, now}) {
  let shown = notes.filter(note => note.status != "dropped")
  let open = shown.filter(note => note.status == "open")
  let discussed = shown.filter(note => note.status == "discussed")

  let pieceById = new Map(pieces.map(piece => [piece.id, piece]))
  let itemById = new Map(items.map(item => [item.id, item]))
  let since = lessonSince(notes)
  let lessonGiven = lastLesson(notes) != null

  let viewOf = (note, {isDiscussed}) => {
    let piece = note.pieceId == null ? null : pieceById.get(note.pieceId) || null
    let removed = note.pieceId != null && !piece
    let title = removed ? `${note.pieceTitle || "A piece"} (removed)` : piece ? piece.title : null
    let song = piece && piece.song
    let kind = note.start != null ? "bar" : note.pieceId == null ? "any" : "piece"

    let view = {
      id: note.id, note, kind, removed,
      place: placeOf(note, title),
      label: labelOf(note, {discussed: isDiscussed}),
      text: note.text, wordless: note.text == "",
      answer: note.answer || null,
      // the first bar of its range, one bar a note
      engrave: kind == "bar" && !removed ? {pieceId: note.pieceId, measure: note.start, hand: note.hand} : null,
      open: removed || kind == "any" ? null : {pieceId: note.pieceId, bar: note.start},
      placeholder: kind == "piece" ? "Whole piece" : kind == "any" ? "Any piece" :
        barsPlace(note.start, note.end),
      then: null, now: null, over: null, evidence: null, since: null,
    }

    if (isDiscussed) {
      view.since = !removed && kind == "bar" ? sinceThen(note, {items: itemById}) : null
      return view
    }

    if (kind == "bar" && !removed) {
      let {now: nowWords, over} = barEvidence(note, {items: itemById, song})
      view.now = nowWords
      view.over = over
    }

    let words = evidenceWords(note.evidence)
    if (words) { view.then = `Then: ${words}.` }

    if (kind == "piece" && !removed) {
      let own = sessions.filter(session => session.generator == SHEET_MUSIC &&
        session.settings && session.settings.piece == note.pieceId && since != null && session.startedAt >= since)
      if (own.length) {
        let days = new Set(own.map(session => localDay(session.startedAt))).size
        let minutes = Math.round(own.reduce((sum, session) => sum + sessionSeconds(session), 0) / 60)
        let measures = song ? measureNumberList(song) : []
        let learned = learnedCount(items.filter(item => item.pieceId == note.pieceId), measures, "both")
        view.evidence = `Practised ${plural(days, "day")}, ${plural(minutes, "minute")}, ${learned} of ${measures.length} bars learned.`
      } else {
        view.evidence = lessonGiven ? "Not practised since your last lesson." : "Not practised yet."
      }
    }

    return view
  }

  // the open notes by piece, the piece with the newest note first, "Any piece" last
  let byPiece = new Map()
  for (let note of open) {
    let key = note.pieceId == null ? "any" : note.pieceId
    if (!byPiece.has(key)) { byPiece.set(key, []) }
    byPiece.get(key).push(note)
  }

  let newest = list => Math.max(...list.map(note => note.createdAt))
  let order = (a, b) => {
    if (a.start != null && b.start != null) { return a.start - b.start || a.createdAt - b.createdAt }
    if (a.start != null) { return -1 }
    if (b.start != null) { return 1 }
    return a.createdAt - b.createdAt
  }

  let groups = [...byPiece].sort(([ka, a], [kb, b]) =>
    (ka == "any") - (kb == "any") || newest(b) - newest(a)).map(([key, list]) => {
    let piece = key == "any" ? null : pieceById.get(key) || null
    let removed = key != "any" && !piece
    let title = key == "any" ? "Any piece" :
      removed ? `${list[0].pieceTitle || "A piece"} (removed)` : piece.title

    return {
      key, pieceId: key == "any" ? null : key, title, removed,
      header: `${title} · ${plural(list.length, "open note")}`,
      notes: [...list].sort(order).map(note => viewOf(note, {isDiscussed: false})),
    }
  })

  // the discussed notes by the day of the lesson, the last few lesson days
  let days = new Map()
  for (let note of discussed) {
    let day = localDay(note.discussedAt)
    if (!days.has(day)) { days.set(day, []) }
    days.get(day).push(note)
  }

  let lessonDays = [...days].sort(([a], [b]) => b - a)
  let discussedGroups = lessonDays.slice(0, DISCUSSED_DAYS).map(([day, list]) => ({
    key: day,
    label: `Discussed · ${longDate(Math.max(...list.map(note => note.discussedAt)))}`,
    notes: [...list].sort((a, b) => b.discussedAt - a.discussedAt).map(note => viewOf(note, {isDiscussed: true})),
  }))
  let earlier = lessonDays.slice(DISCUSSED_DAYS).reduce((sum, [, list]) => sum + list.length, 0)

  let card = null
  if (since != null) {
    let minutes = Math.round(sessions.filter(session => session.startedAt >= since)
      .reduce((sum, session) => sum + sessionSeconds(session), 0) / 60)

    let learned = new Set()
    for (let item of items) {
      if (item.startMeasure == item.endMeasure && !item.beats && learnedSince(item, since)) {
        learned.add(`${item.pieceId}:${item.startMeasure}`)
      }
    }

    let days = Math.max(0, localDay(now) - localDay(since))
    card = {
      label: lessonGiven ? "Since your last lesson" : "Before your first lesson",
      days, daysWords: days == 1 ? "day" : "days",
      detail: `${plural(minutes, "minute")} · ${plural(learned.size, "bar")} learned · ${plural(open.length, "note")}`,
    }
  }

  return {
    count: open.length,
    empty: !open.length && !discussed.length,
    since: card,
    groups,
    discussed: discussedGroups,
    earlier,
  }
}
