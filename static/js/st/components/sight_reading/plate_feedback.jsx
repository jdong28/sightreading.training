import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import styles from "./plate_feedback.module.css"

// How long the gilt wash and the ink smudge stay lit after the matcher's
// latest judgement, before fading (see SightReadingPage#applyEvent and
// #countMiss, which bump the wash/smudge props once per judgement)
export const WASH_HOLD_MS = 300
export const SMUDGE_HOLD_MS = 900

// The trainer's two gentle feedback states, drawn over the staff plate: a
// gilt wash on every hit (including a chord hit), an ink smudge at the head
// column on every wrong key (including a wrong chord). This component only
// shows what the page's judgements already decided; it keeps no judgement of
// its own. Rendered as the plate's last child, so it paints above the staff
// (see SightReadingPage#renderStaffPlate)
export default class PlateFeedback extends React.Component {
  static propTypes = {
    // bumped by the page once per judgement; a changed value re-lights the
    // state, restarting its hold rather than flickering
    wash: types.number.isRequired,
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
    this.state = {washing: false, smudging: false, x: null, y: null}
  }

  componentDidUpdate(prevProps) {
    if (prevProps.wash != this.props.wash) {
      this.setState({washing: true})
      window.clearTimeout(this.washTimer)
      this.washTimer = window.setTimeout(() => this.setState({washing: false}), WASH_HOLD_MS)
    }

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
    window.clearTimeout(this.washTimer)
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
    let {washing, smudging, x, y} = this.state

    return <div ref={this.rootRef} data-plate-feedback aria-hidden="true" className={styles.feedback}>
      <span
        data-wash={washing ? "on" : "off"}
        className={classNames(styles.wash, {[styles.on]: washing})} />
      <span
        data-smudge={smudging ? "on" : "off"}
        style={x != null && y != null ? {left: x, top: y} : null}
        className={classNames(styles.smudge, {[styles.on]: smudging})} />
    </div>
  }
}
