import * as React from "react"
import * as ReactDOM from "react-dom"
import * as types from "prop-types"
import classNames from "classnames"
import {Link, NavLink} from "react-router-dom"

import {trigger} from "st/events"

import Lightbox from "st/components/lightbox"

import {toggleActive} from "st/components/util"

import styles from "./header.module.css"

// below this nav row width the links collapse into the menu
const COLLAPSE_NAV_WIDTH = 700

export const NAV_LINKS = [
  {to: "/", label: "Sight reading", end: true},
  {to: "/play-along", label: "Play along"},
  {to: "/ear-training/interval-melodies", label: "Ear training", end: true},
  {to: "/flash-cards/note-math", label: "Flash cards", end: true},
  {to: "/stats", label: "Statistics", end: true},
  {to: "/about", label: "Guide", end: true},
]

class SizedElement extends React.Component {
  constructor(props) {
    super(props)
    this.state = { }
  }

  componentDidMount() {
    this.refreshWidth()

    this.resizeCallback = e => {
      window.clearTimeout(this.resizeTimeout)
      this.resizeTimeout = window.setTimeout(() => {
        this.refreshWidth()
      }, 100)
    }

    window.addEventListener("resize", this.resizeCallback)
    this.resizeCallback()
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.resizeCallback)
    window.clearTimeout(this.resizeTimeout)
  }

  refreshWidth() {
    let el = ReactDOM.findDOMNode(this)
    let width = el.getBoundingClientRect().width
    if (this.state.width != width) {
      this.setState({
        width: width
      }, function() {
        if (this.props.onWidth) {
          this.props.onWidth(this.state.width)
        }
      })
    }
  }

  render() {
    return <div className={this.props.className}>
      {this.state.width ? this.props.children : null}
    </div>
  }
}

export function InstrumentStatus({midiInput, pickMidi}) {
  return <button
    type="button"
    className={styles.instrument_status}
    title={midiInput ? "Change MIDI device" : "Select a MIDI device"}
    onClick={e => {
      e.preventDefault()
      pickMidi()
    }}>
    <span className={classNames(styles.instrument_dot, {
      [styles.connected]: !!midiInput
    })} aria-hidden="true" />
    <span className={styles.instrument_name}>
      {midiInput ? midiInput.name : "No instrument"}
    </span>
  </button>
}

InstrumentStatus.propTypes = {
  midiInput: types.shape({name: types.string}),
  pickMidi: types.func.isRequired,
}

export default class Header extends React.Component {
  static propTypes = {
    midiInput: types.object,
  }

  constructor(props) {
    super(props)
    this.state = {
      menuOpen: false
    }
  }

  getPageLinks() {
    return NAV_LINKS.map(link =>
      <NavLink key={link.to} to={link.to} end={link.end} {...toggleActive}>{link.label}</NavLink>
    )
  }

  renderNavigationMenu() {
    let menu = null

    if (this.state.menuOpen) {
      menu = <Lightbox
        key="navigation_menu"
        className={styles.navigation_menu}
        onClick={e => {
          if (e.target.matches("a")) {
            this.setState({ menuOpen: false })
          }
        }}
        onClose={(lb) => {
          this.setState({ menuOpen: false })
        }}
      >
        <ul>
          {this.getPageLinks().map((link, i) => <li key={i}>{link}</li>)}
        </ul>
      </Lightbox>
    }

    return <div className={styles.menu_toggle}>
      <button type="button" aria-expanded={this.state.menuOpen} onClick={e => {
        this.setState({ menuOpen: !this.state.menuOpen })
      }}><span className={styles.menu_glyph} aria-hidden="true">❧</span>Menu</button>
      {menu}
    </div>
  }

  render() {
    let enableDropdown = this.state.width && this.state.width < COLLAPSE_NAV_WIDTH

    return <header className={styles.header}>
      <div className={styles.top_row}>
        <Link to="/" className={styles.wordmark}>
          <span className={styles.wordmark_glyph} aria-hidden="true">❧</span>
          <span className={styles.wordmark_text}>
            Sight<span className={styles.wordmark_italic}>reading</span>
          </span>
          <span className={styles.wordmark_glyph} aria-hidden="true">❧</span>
        </Link>

        <InstrumentStatus
          midiInput={this.props.midiInput}
          pickMidi={() => {
            trigger(this, "pickMidi")
          }} />
      </div>

      <nav className={styles.nav}>
        <SizedElement className={styles.nav_links} onWidth={(w) => {
          this.setState({ width: w })
        }}>
          {enableDropdown ? this.renderNavigationMenu() : this.getPageLinks()}
        </SizedElement>
      </nav>
    </header>
  }
}
