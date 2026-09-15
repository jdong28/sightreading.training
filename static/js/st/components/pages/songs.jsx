import * as React from "react"
import classNames from "classnames"

import {Link} from "react-router-dom"

import commonStyles from "st/components/common.module.css"
import sidebarStyles from "st/components/sidebar.module.css"
import styles from "./songs.module.css"

export default function SongsPage() {
  return <div className={classNames(styles.songs_page, sidebarStyles.has_sidebar)}>
    <section className={classNames(sidebarStyles.sidebar, styles.sidebar)}>
      <Link to="/new-song" className={classNames("button", styles.new_song_button)}>Create a new song</Link>
    </section>

    <section className={classNames(sidebarStyles.content_column, styles.content_column)}>
      <h2>Play along</h2>
      <p className={commonStyles.empty_message}>There's no song library. Create a new song to write notation or import a MusicXML file, then play along with it.</p>
    </section>
  </div>
}
