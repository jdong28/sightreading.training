// The score-first sheet music page's at-rest view (D1-D7, D11): the
// engraved score beside the "Tonight's session" setup pane, always on the
// right. Placeholder for now -- fleshed out once ScoreSheet, the setup pane
// and the bar pop-up exist; SightReadingPage already renders it in place of
// its own grid while state.view == "score" (see SCORE_PROGRAMME.ScoreView).

import * as React from "react"

import styles from "./score_view.module.css"

export function ScoreView(props) {
  return <div data-score-view className={styles.score_view}>
    {props.ended && <div data-ended-strip>
      {props.ended.headline} {props.ended.headlineSuffix}
      <button type="button" onClick={props.playOn}>Play on</button>
      <button type="button" onClick={props.dismissEnded}>Done</button>
    </div>}
    <button type="button" onClick={props.begin}>Begin</button>
  </div>
}

export default ScoreView
