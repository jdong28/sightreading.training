import {readConfig, writeConfig} from "st/config"
import {getAppStore} from "st/storage"

// gates the first-run "/welcome" invitation card; see docs/design/salon-de-chopin.md
export const ONBOARDED_KEY = "st:onboarded:v1"

// an install from before the invitation (a saved MIDI input or imported
// pieces) counts as onboarded, so only a fresh browser sees the card
export function hasOnboarded(store=getAppStore()) {
  if (readConfig(ONBOARDED_KEY)) {
    return true
  }

  if (readConfig("defaults:midiIn") || store.pieces().length > 0) {
    markOnboarded()
    return true
  }

  return false
}

export function markOnboarded() {
  writeConfig(ONBOARDED_KEY, "1")
}
