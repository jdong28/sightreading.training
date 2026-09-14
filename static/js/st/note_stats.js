
import {csrfToken} from "st/globals"

// generator settings worth keeping with a session: numbers, booleans, short
// strings and short lists of those, leaving out eg. pasted song notation
export function settingsSummary(settings) {
  let scalar = value => ["number", "boolean"].includes(typeof value) ||
    (typeof value == "string" && value.length <= 80)

  let summary = {}
  for (let [key, value] of Object.entries(settings || {})) {
    if (scalar(value) || (Array.isArray(value) && value.length <= 16 && value.every(scalar))) {
      summary[key] = value
    }
  }
  return summary
}

export default class NoteStats {
  static TIMER_SIZE = 30*1000

  constructor(currentUser, opts={}) {
    this.currentUser = currentUser
    this.id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    this.noteHitStats = {}
    this.streak = 0
    this.bestStreak = 0
    this.hits = 0
    this.misses = 0

    // times of the first and last note played
    this.startedAt = undefined
    this.endedAt = undefined

    this.lastHitTime = undefined
    this.averageHitTime = 0

    this.resetBuffer()
  }

  resetBuffer() {
    this.buffer = {
      hits: 0,
      misses: 0,
    }
  }

  setTimerUrl(url) {
    this.flushTimer()
    this.timerUrl = url
  }

  startTimer() {
    if (!this.timerUrl) {
      return
    }

    this.lastActivity = +new Date

    if (this.timerFlushTimeout) {
      return
    }

    let timerStart = +new Date
    this.timerFlushTimeout = setTimeout(() => {
      let now = +new Date
      let activityTime = this.lastActivity - timerStart

      this.flushTimer(activityTime)
      delete this.timerFlushTimeout

      let sinceLastActivity = now - this.lastActivity
      if (sinceLastActivity < NoteStats.TIMER_SIZE / 2) {
        this.startTimer()
      }

    }, NoteStats.TIMER_SIZE)
  }


  hitNotes(notes) {
    for (let note of notes) {
      this.incrementNote(note, 1);
    }

    let now = +new Date;

    this.startTimer()

    if (this.lastHitTime) {
      let timeTaken = now - this.lastHitTime;

      if (!this.isOutlierTime(timeTaken)) {
        this.averageHitTime = (this.averageHitTime * this.hits + timeTaken) / (this.hits + 1);
        for (let note of notes) {
          let noteStats = this.noteHitStats[this.normalizeNote(note)];
          noteStats.averageHitTime = ((noteStats.averageHitTime || 0) * (noteStats.hits || 0) + timeTaken) / (noteStats.hits + 1);
        }
      }
    }

    this.lastHitTime = now
    this.markActivity(now)

    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this.hits += 1;
    this.buffer.hits += 1;
    this.flushLater()
  }

  missNotes(notes) {
    for (let note of notes) {
      this.incrementNote(note, -1);
    }

    this.startTimer()
    this.markActivity(+new Date)

    this.streak = 0;
    this.misses += 1;
    this.buffer.misses += 1;
    this.flushLater()
  }

  markActivity(time) {
    if (this.startedAt == null) {
      this.startedAt = time
    }
    this.endedAt = time
  }

  // The session record for the local store (see putSession in st/storage),
  // or null before any note is played. The record keeps this object's id, so
  // writing it again as the session grows replaces the earlier one
  sessionRecord({staff, generator, settings}={}) {
    if (!this.hits && !this.misses) {
      return null
    }

    let notes = {}
    for (let [note, stats] of Object.entries(this.noteHitStats)) {
      notes[note] = {hits: stats.hits || 0, misses: stats.misses || 0}
    }

    return {
      id: this.id,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      staff: staff || null,
      generator: generator || null,
      settings: settingsSummary(settings),
      notesRead: this.hits,
      misses: this.misses,
      bestStreak: this.bestStreak,
      notes,
    }
  }

  incrementNote(note, val) {
    note = this.normalizeNote(note);
    let stats = this.noteHitStats[note] = this.noteHitStats[note] || {};

    if (val > 0) {
      stats.hits = (stats.hits || 0) + val;
    } else if (val < 0){
      stats.misses = (stats.misses || 0) - val;
    }
  }

  makeThrottle(fn, wait) {
    let timer = null
    return () => {
      let args = arguments
      if (timer) {
        return
      }

      timer = setTimeout(() => {
        timer = null
        fn.apply(args)
      }, wait)
    }
  }

  flushLater() {
    if (!this.currentUser) {
      return
    }

    this.flushLater = this.makeThrottle(this.flush.bind(this), 5000)
    window.addEventListener("beforeunload", () => {
      this.flush()
    })

    this.flushLater()
  }

  flush() {
    let d = new FormData()
    d.append("csrf_token", csrfToken())
    for (let key in this.buffer) {
      d.append(key, "" + this.buffer[key])
    }

    var request = new XMLHttpRequest()
    request.open("POST", "/hits.json")
    request.send(d)
    this.resetBuffer()
  }

  flushTimer(activityTime) {
    if (!this.timerUrl) {
      return
    }


    let d = new FormData()
    d.append("csrf_token", csrfToken())

    let sendTime = NoteStats.TIMER_SIZE

    if (activityTime < sendTime / 2) {
      sendTime = activityTime
    }

    sendTime = Math.round(sendTime / 1000)

    if (sendTime < 2) {
      return
    }

    d.append("time_spent", `${sendTime}`)

    var request = new XMLHttpRequest()
    request.open("POST", this.timerUrl)
    request.send(d)
  }

  isOutlierTime(timeTaken) {
    if (this.averageHitTime == 0) {
      return false;
    }

    return timeTaken > this.averageHitTime * 10 + 1000;
  }

  normalizeNote(note) {
    return note.replace(/\d+$/, "");
  }
}
