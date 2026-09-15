import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {setTitle} from "st/globals"
import {parseMidiMessage} from "st/midi"
import {markOnboarded} from "st/onboarding"
import {Plate, Pill, DoubleRule, FleuronRule} from "st/components/salon"

import styles from "./onboarding_page.module.css"

// /setup does not exist yet (a parallel wave 2 task); update once it lands
const PRIMARY_DESTINATION = "/"

const STEPS = [
  ["I", "Connect your instrument by USB or MIDI", "The app listens for the keys you actually play"],
  ["II", "Choose a clef, a key and a tempo", "Or accept the programme set for you"],
  ["III", "Read until you care to stop", "A wrong note leaves a smudge and nothing more"],
]

export default class OnboardingPage extends React.Component {
  static propTypes = {
    midi: types.object,
    midiInput: types.object,
    onSelectInput: types.func,
  }

  constructor(props) {
    super(props)
    this.midiMessageListener = this.handleMidiMessage.bind(this)
    this.stateChangeListener = () => {
      this.attachInputs()
      this.forceUpdate()
    }
  }

  componentDidMount() {
    setTitle("Welcome")
    this.attachMidi(this.props.midi)
  }

  componentDidUpdate(prevProps) {
    // MIDI access resolves asynchronously, so it can arrive after mount
    if (prevProps.midi != this.props.midi) {
      this.detachMidi(prevProps.midi)
      this.attachMidi(this.props.midi)
    }
  }

  componentWillUnmount() {
    this.detachMidi(this.props.midi)
  }

  attachMidi(midi) {
    if (!midi) return
    midi.addEventListener("statechange", this.stateChangeListener)
    this.attachInputs()
  }

  detachMidi(midi) {
    if (!midi) return
    midi.removeEventListener("statechange", this.stateChangeListener)
    for (let input of midi.inputs.values()) {
      input.removeEventListener("midimessage", this.midiMessageListener)
    }
  }

  // addEventListener is used so the selected device's onmidimessage handler
  // owned by the app layout is left intact; re-adding the same listener is a
  // no-op, so this is safe to call on every statechange
  attachInputs() {
    if (!this.props.midi) return
    for (let input of this.props.midi.inputs.values()) {
      input.addEventListener("midimessage", this.midiMessageListener)
    }
  }

  handleMidiMessage(message) {
    if (this.props.midiInput) return

    let parsed = parseMidiMessage(message)
    if (!parsed || parsed[0] != "noteOn") return

    let idx = this.midiInputs().indexOf(message.target)
    if (idx >= 0 && this.props.onSelectInput) {
      this.props.onSelectInput(idx)
    }
  }

  midiInputs() {
    if (!this.props.midi) return []
    return [...this.props.midi.inputs.values()]
  }

  deviceState() {
    let inputs = this.midiInputs()

    if (!this.props.midi || inputs.length == 0) {
      return {state: "none"}
    }

    if (this.props.midiInput) {
      return {state: "connected", name: this.props.midiInput.name}
    }

    return {state: "listening"}
  }

  render() {
    return <div className={styles.page}>
      <Plate className={styles.card}>
        <div className={styles.intro}>
          <div className={styles.eyebrow}>Salon de Paris · 1836</div>
          <h1 className={styles.title}>
            An <span className={styles.title_italic}>invitation</span> to read
          </h1>
          <FleuronRule width={88} className={styles.fleuron} />
          <p className={styles.lede}>
            Ten minutes at the keyboard each evening. No scores to buy, no pieces to
            memorise — only the page in front of you.
          </p>
        </div>

        <DoubleRule className={styles.divider} />

        {this.renderSteps()}

        {this.renderDeviceStrip()}

        <div className={styles.actions}>
          <Pill variant="primary" to={PRIMARY_DESTINATION} onClick={markOnboarded}>
            Take your seat
          </Pill>
          <Pill variant="ghost" to="/" onClick={markOnboarded}>
            Use the on-screen keys
          </Pill>
        </div>
      </Plate>
    </div>
  }

  renderSteps() {
    return <ol className={styles.steps}>
      {STEPS.map(([numeral, title, sub]) => (
        <li className={styles.step} key={numeral}>
          <span className={styles.numeral}>{numeral}</span>
          <span className={styles.step_text}>
            {title}
            <span className={styles.step_sub}>{sub}</span>
          </span>
        </li>
      ))}
    </ol>
  }

  renderDeviceStrip() {
    let {state, name} = this.deviceState()

    if (state == "connected") {
      return <div className={classNames(styles.device_strip, styles.connected)}>
        <span className={classNames(styles.dot, styles.connected)} aria-hidden="true" />
        <span className={styles.device_label}>{name}</span>
        <span className={styles.device_aside}>at the ready</span>
      </div>
    }

    if (state == "listening") {
      return <div className={classNames(styles.device_strip, styles.listening)}>
        <span className={classNames(styles.dot, styles.listening)} aria-hidden="true" />
        <span className={styles.device_label}>Listening for an instrument</span>
        <span className={styles.device_aside}>press any key</span>
      </div>
    }

    return <div className={classNames(styles.device_strip, styles.none)}>
      <span className={classNames(styles.dot, styles.none)} aria-hidden="true" />
      <span className={styles.device_label}>No instrument found</span>
      <span className={styles.device_aside}>check the cable</span>
    </div>
  }
}
