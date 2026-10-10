// The Statistics page of a local user, the practice record: a tab for each
// view of what was practised, each its own route under /stats (the app
// mounts this at /stats/*). Today is the index; the Progress screen is the
// tab Last 14 days. An account keeps the backend's own Daily stats page,
// see statsPageFor in st/components/pages/stats. The tabs are RECORD_TABS
// (st/components/record_tabs).

import * as React from "react"
import {Routes, Route, Navigate} from "react-router-dom"

import TodayPage from "st/components/pages/today_page"
import ProgressPage from "st/components/pages/progress_page"

export default function PracticeRecordPage() {
  return <Routes>
    <Route index element={<TodayPage />} />
    <Route path="last-14-days" element={<ProgressPage />} />
    <Route path="*" element={<Navigate replace to="/stats" />} />
  </Routes>
}
