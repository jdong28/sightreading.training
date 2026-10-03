import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import styles from "./plate_feedback.module.css"

// How long the ink smudge stays lit after the matcher's latest judgement
// (see SightReadingPage#countMiss, which bumps the smudge prop once per
// judgement): it is drawn at once, holds, then the .55s fade of
// plate_feedback.module.css carries it out, so the ink is gone 900ms after
// the judgement (docs/design/salon-de-chopin.md)
export const SMUDGE_HOLD_MS = 350

// The trainer's gentle feedback state, drawn over the staff plate: an ink
// smudge at the head column on every wrong key (including a wrong chord).
// This component only shows what the page's judgements already decided; it
// keeps no judgement of its own. Rendered as the plate's last child, so it
// paints above the staff (see SightReadingPage#renderStaffPlate)
export default class PlateFeedback extends React.Component {
  static propTypes = {
    // bumped by the page once per judgement; a changed value re-lights the
    // state, restarting its hold rather than flickering
    smudge: types.number.isRequired,
    // returns the drawn heads of the column at the head of the drill, so the
    // smudge can be centred on it (see st/components/staves#headElements and
    // ScoreCard#headElements); an empty return leaves the smudge at its CSS
    // default position
    locateHead: types.func.isRequired,
  }

  constructor(props) {
    super(props)
    this.rootRef = React.createRef()
    this.state = {smudging: false, x: null, y: null}
  }

  componentDidUpdate(prevProps) {
    if (prevProps.smudge != this.props.smudge) {
      // measured after the commit, not from applyEvent: in the middle of a
      // MIDI packet the DOM still shows the list from before the batch
      let {x, y} = this.locate()
      this.setState({smudging: true, x, y})
      window.clearTimeout(this.smudgeTimer)
      this.smudgeTimer = window.setTimeout(() => this.setState({smudging: false}), SMUDGE_HOLD_MS)
    }
  }

  componentWillUnmount() {
    window.clearTimeout(this.smudgeTimer)
  }

  // the centre of the union of the head elements' rects, relative to the
  // layer's own rect and clamped inside it, or {x: null, y: null} with no
  // element located (the smudge then keeps its CSS default position)
  locate() {
    let root = this.rootRef.current
    let elements = this.props.locateHead() || []
    if (!root || !elements.length) { return {x: null, y: null} }

    let rects = elements.map(el => el.getBoundingClientRect())
    let left = Math.min(...rects.map(r => r.left))
    let right = Math.max(...rects.map(r => r.right))
    let top = Math.min(...rects.map(r => r.top))
    let bottom = Math.max(...rects.map(r => r.bottom))

    let rootRect = root.getBoundingClientRect()
    let clamp = (value, max) => Math.min(Math.max(value, 0), max)
    return {
      x: clamp((left + right) / 2 - rootRect.left, rootRect.width),
      y: clamp((top + bottom) / 2 - rootRect.top, rootRect.height),
    }
  }

  render() {
    let {smudging, x, y} = this.state

    return <div ref={this.rootRef} data-plate-feedback aria-hidden="true" className={styles.feedback}>
      <span
        data-smudge={smudging ? "on" : "off"}
        style={x != null && y != null ? {left: x, top: y} : null}
        className={classNames(styles.smudge, {[styles.on]: smudging})} />
    </div>
  }
}
