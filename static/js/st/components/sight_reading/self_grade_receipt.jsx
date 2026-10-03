import * as React from "react"

import {receiptParts, SELF_GRADE_INSTRUCTION} from "st/srs/self_grade"

import styles from "./self_grade_receipt.module.css"

// The receipt line of acoustic mode (option C, the design report's "Receipt
// line"): a fixed-height line between the staff plate and the grade row,
// replacing the plate caption while acoustic mode is on (see
// SightReadingPage#renderSelfGrade/renderCaption). It names what the last
// self-graded pass recorded (receiptParts, st/srs/self_grade), or the
// instruction before the first grade of the sitting.
//
// This element stays mounted for the whole session (never keyed or
// remounted, which SightReadingPage#renderSelfGrade must keep true): a
// freshly inserted aria-live region isn't reliably announced, so only the
// text inside it changes. The brief highlight on a new receipt is instead
// played by keying the inner text by the receipt's own identity (receipt.at).
export default function SelfGradeReceipt({receipt}) {
  return <p className={styles.receipt} aria-live="polite" aria-atomic="true" data-self-grade-receipt>
    {receipt ?
      <ReceiptText key={receipt.at} receipt={receipt} /> :
      <span className={styles.instruction}>{SELF_GRADE_INSTRUCTION}</span>}
  </p>
}

function ReceiptText({receipt}) {
  let {head, grade, where, slipped, when} = receiptParts(receipt)

  return <span className={styles.highlight}>
    <span className={styles.tick} aria-hidden="true">✓</span>{" "}
    {head} · <b>{grade}</b>
    {where ? ` ${where}` : null}
    {slipped ? ` · ${slipped}` : null}
    {when ? <> — <span className={styles.when}>{when}</span></> : null}
  </span>
}
