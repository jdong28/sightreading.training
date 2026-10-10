// The tabs of the practice record, the Statistics page: Today, For my lesson
// (the notes for the next lesson, st/lesson_notes) and the Progress screen's
// Last 14 days, each its own route under /stats (see
// st/components/pages/practice_record_page). A later tab is one entry here;
// For my lesson carries the count of its open notes.
// Its own module so a page that draws the tabs (progress_page) can import
// them without importing the router that mounts it.

import * as React from "react"

import {TabNav} from "st/components/salon"
import {getAppStore} from "st/storage"
import {openNotes} from "st/lesson_notes"

export const LESSON_TAB = "/stats/for-my-lesson"

export const RECORD_TABS = [
  {to: "/stats", label: "Today", end: true},
  {to: LESSON_TAB, label: "For my lesson"},
  {to: "/stats/last-14-days", label: "Last 14 days"},
]

export function RecordTabs() {
  let open = openNotes(getAppStore().lessonNotes()).length
  let tabs = RECORD_TABS.map(tab => tab.to == LESSON_TAB && open > 0 ? {...tab, count: open} : tab)

  return <TabNav label="Practice record" tabs={tabs} />
}
