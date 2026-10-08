// The score-first sheet music page's in-session rail (D9): "This session"
// (the clock, the piece-position grid, Up next) and "This evening".
// Placeholder for now -- fleshed out once planUpcoming exists;
// SightReadingPage already renders it as the rail while state.view ==
// "session" (see SCORE_PROGRAMME.SessionRail).

import * as React from "react"

import styles from "./session_rail.module.css"

export function SessionRail(props) {
  return <div data-session-rail className={styles.session_rail}>
    <span>{props.elapsedSeconds}</span>
  </div>
}

export default SessionRail
