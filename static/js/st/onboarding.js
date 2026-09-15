import {readConfig, writeConfig} from "st/config"

// gates the first-run "/welcome" invitation card; see docs/design/salon-de-chopin.md
export const ONBOARDED_KEY = "st:onboarded:v1"

export function hasOnboarded() {
  return !!readConfig(ONBOARDED_KEY)
}

export function markOnboarded() {
  writeConfig(ONBOARDED_KEY, "1")
}
