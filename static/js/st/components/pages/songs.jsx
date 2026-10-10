import * as React from "react"
import classNames from "classnames"

import {Pill} from "st/components/salon"

import commonStyles from "st/components/common.module.css"
import sidebarStyles from "st/components/sidebar.module.css"
import styles from "./songs.module.css"

export default function SongsPage() {
  return <div className={classNames(styles.songs_page, sidebarStyles.has_sidebar)}>
    <section className={classNames(sidebarStyles.sidebar, styles.sidebar)}>
      <Pill variant="primary" to="/new-song" className={styles.new_song_button}>Create a new song</Pill>
    </section>

    <section className={classNames(sidebarStyles.content_column, styles.content_column)}>
      <h2>Play along</h2>
      <p className={commonStyles.empty_message}>There's no song library. Create a new song to write notation or import a MusicXML file, then play along with it.</p>
    </section>
  </div>
}
