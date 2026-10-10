// The strip a session leaves behind, quiet: what the session came to, a line
// to Today's practice (/stats, the practice record's first tab) and its
// actions. The score page shows it above the score once a session ends
// (st/components/sight_reading/score_view), the exercises page under its stat
// cards once Rest is pressed (st/components/pages/sight_reading_page): the
// same strip, in place of the pop-up summary that was dropped for being too
// intrusive.

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"
import {Link} from "react-router-dom"

import styles from "./ended_strip.module.css"

export function EndedStrip({eyebrow="Session ended", headline, italic, detail, today, actions, className, ...rest}) {
  return <div className={classNames(styles.ended_strip, className)} {...rest}>
    <div className={styles.ended_left}>
      <div className={styles.ended_eyebrow}>{eyebrow}</div>
      <div className={styles.ended_headline}>
        {headline} {italic ? <span className={styles.ended_headline_italic}>{italic}</span> : null}
      </div>
    </div>
    <div className={styles.ended_detail}>
      {detail}
      {today ? <div className={styles.ended_today}>
        <Link to="/stats">Today's practice →</Link> · {today.words}
      </div> : null}
    </div>
    <div className={styles.ended_actions}>{actions}</div>
  </div>
}

EndedStrip.propTypes = {
  eyebrow: types.node,
  headline: types.node,
  italic: types.node,
  // the strip's words, under the headline
  detail: types.node,
  // {words}: today's minutes, after the link to Today's practice
  today: types.shape({words: types.string.isRequired}),
  actions: types.node,
  className: types.string,
}
