import * as React from "react"
import classNames from "classnames"
import * as types from "prop-types"

import styles from "./number_picker.module.css"

// holding a step button steps once, then again after HOLD_DELAY and every
// HOLD_INTERVAL after that, by HOLD_FAST_STEP once it has run HOLD_FAST_AFTER
// steps, so a long piece's far measures are a short hold away
const HOLD_DELAY = 400
const HOLD_INTERVAL = 70
const HOLD_FAST_AFTER = 10
const HOLD_FAST_STEP = 5

// the page keys' step
const PAGE_STEP = 10

// a range this small or smaller also gets a slider beside the number
export const MAX_SLIDER_SPAN = 24

export function clampNumber(value, min, max) {
  value = Math.round(value)
  if (min != null) { value = Math.max(min, value) }
  if (max != null) { value = Math.min(max, value) }
  return value
}

// A whole number picked from min to max, fast whichever way it is picked: typed
// into the field (committed on Enter or on leaving it, clamped to the range),
// stepped with the large minus and plus buttons (held to run on), the arrow
// keys (page up and down by ten, home and end for the bounds) or, over a small
// range, dragged on a slider. value null shows placeholder, eg. a choice made
// outside the picker, and the first step starts from the nearer bound
export default class NumberPicker extends React.PureComponent {
  static propTypes = {
    label: types.string.isRequired,
    value: types.number,
    min: types.number.isRequired,
    max: types.number.isRequired,
    onChange: types.func.isRequired,
    placeholder: types.string,
    // shown after the field, eg. "of 102"
    caption: types.node,
    // whether a slider accompanies the number, by default when the range
    // is at most MAX_SLIDER_SPAN
    slider: types.bool,
    className: types.string,
  }

  constructor(props) {
    super(props)
    // the text being typed, null when the field shows the value
    this.state = {draft: null}
    this.captionId = `number-picker-${++NumberPicker.count}`
  }

  static count = 0

  componentWillUnmount() {
    this.stopHold()
  }

  current() {
    let {value, min, max} = this.props
    return value == null ? null : clampNumber(value, min, max)
  }

  commit(value) {
    let {min, max} = this.props
    value = clampNumber(value, min, max)
    if (value != this.current()) {
      this.props.onChange(value)
    }
  }

  // from no value, down steps from the top and up from the bottom
  step(delta) {
    let current = this.current()
    if (current == null) {
      this.commit(delta < 0 ? this.props.max : this.props.min)
    } else {
      this.commit(current + delta)
    }
  }

  commitDraft() {
    let draft = this.state.draft
    if (draft == null) { return }
    this.setState({draft: null})

    let value = parseInt(draft, 10)
    if (!isNaN(value)) {
      this.commit(value)
    }
  }

  onKeyDown(e) {
    let {min, max} = this.props
    let handled = true

    // left and right keep moving the caret through typed text
    if ((e.key == "ArrowLeft" || e.key == "ArrowRight") && this.state.draft != null) {
      return
    }

    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        this.commitDraft()
        this.step(1)
        break
      case "ArrowDown":
      case "ArrowLeft":
        this.commitDraft()
        this.step(-1)
        break
      case "PageUp":
        this.commitDraft()
        this.step(PAGE_STEP)
        break
      case "PageDown":
        this.commitDraft()
        this.step(-PAGE_STEP)
        break
      case "Home":
        this.setState({draft: null})
        this.commit(min)
        break
      case "End":
        this.setState({draft: null})
        this.commit(max)
        break
      case "Enter":
        this.commitDraft()
        break
      case "Escape":
        if (this.state.draft == null) { handled = false }
        this.setState({draft: null})
        break
      default:
        handled = false
    }

    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // a pointer steps on press and runs on while held; a keyboard press of the
  // button arrives as a click alone (detail 0)
  startHold(e, delta) {
    if (e.button != null && e.button != 0) { return }
    e.preventDefault()
    this.stopHold()
    this.commitDraft()
    this.step(delta)

    let steps = 0
    let run = () => {
      let current = this.current()
      if (current != null && (delta < 0 ? current <= this.props.min : current >= this.props.max)) {
        this.holdTimer = null
        return
      }
      steps += 1
      this.step(steps > HOLD_FAST_AFTER ? delta * HOLD_FAST_STEP : delta)
      this.holdTimer = setTimeout(run, HOLD_INTERVAL)
    }
    this.holdTimer = setTimeout(run, HOLD_DELAY)
  }

  stopHold() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
  }

  renderStepButton(delta, glyph, name) {
    let {min, max, label} = this.props
    let current = this.current()
    let disabled = current != null && (delta < 0 ? current <= min : current >= max)

    return <button
      type="button"
      className={styles.step_button}
      aria-label={`${name} ${label}`}
      disabled={disabled}
      onPointerDown={e => this.startHold(e, delta)}
      onPointerUp={() => this.stopHold()}
      onPointerLeave={() => this.stopHold()}
      onPointerCancel={() => this.stopHold()}
      onClick={e => {
        if (e.detail == 0) {
          this.commitDraft()
          this.step(delta)
        }
      }}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  }

  renderSlider() {
    let {min, max, label} = this.props
    let current = this.current()
    let show = this.props.slider ?? (max - min <= MAX_SLIDER_SPAN)
    if (!show || max <= min) { return null }

    return <input
      type="range"
      className={styles.slider}
      aria-label={`${label} slider`}
      min={min}
      max={max}
      step={1}
      value={current ?? max}
      onChange={e => this.commit(+e.target.value)} />
  }

  render() {
    let {min, max, label, placeholder, caption} = this.props
    let current = this.current()
    let draft = this.state.draft

    return <div className={classNames(styles.number_picker, this.props.className)}>
      <div className={styles.stepper}>
        {this.renderStepButton(-1, "−", "Decrease")}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          role="spinbutton"
          className={classNames(styles.field, {[styles.unset]: current == null && draft == null})}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current ?? undefined}
          aria-valuetext={current == null ? placeholder : undefined}
          aria-describedby={caption ? this.captionId : undefined}
          placeholder={placeholder}
          value={draft ?? (current == null ? "" : `${current}`)}
          onFocus={e => e.target.select()}
          onBlur={() => this.commitDraft()}
          onKeyDown={e => this.onKeyDown(e)}
          onChange={e => this.setState({draft: e.target.value.replace(/[^0-9]/g, "")})} />
        {this.renderStepButton(1, "+", "Increase")}
        {caption ? <span id={this.captionId} className={styles.caption}>{caption}</span> : null}
      </div>
      {this.renderSlider()}
    </div>
  }
}
