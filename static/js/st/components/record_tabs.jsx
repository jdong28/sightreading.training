// The tabs of the practice record, the Statistics page: Today and the
// Progress screen's Last 14 days, each its own route under /stats (see
// st/components/pages/practice_record_page). A later tab is one entry here.
// Its own module so a page that draws the tabs (progress_page) can import
// them without importing the router that mounts it.

import * as React from "react"

import {TabNav} from "st/components/salon"

export const RECORD_TABS = [
  {to: "/stats", label: "Today", end: true},
  {to: "/stats/last-14-days", label: "Last 14 days"},
]

export function RecordTabs() {
  return <TabNav label="Practice record" tabs={RECORD_TABS} />
}
