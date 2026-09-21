// Loads the engraving engines bundle (st/score_render/index.ts, built as its
// own ES module file beside the app bundle) on demand, so the engines are
// downloaded only by a page that calls this, never with the app. The bundle
// is found next to the script this module was bundled into: score_engines.js
// beside main.js (or specs.js), score_engines.min.js beside main.min.js,
// with the same cache-busting query

// captured while the bundle's script runs, the only time currentScript is set
const SCRIPT_SRC = typeof document != "undefined" && document.currentScript ?
  document.currentScript.src : null

/**
 * @param {string|null} scriptSrc URL of the app bundle's script
 * @returns {string} URL of the engines bundle beside it
 */
export function enginesURL(scriptSrc=SCRIPT_SRC) {
  if (!scriptSrc) {
    return "/static/score_engines.js"
  }

  let script = new URL(scriptSrc, location.href)
  let name = /\.min\.js$/.test(script.pathname) ? "score_engines.min.js" : "score_engines.js"
  let url = new URL(name, script)
  url.search = script.search
  return url.href
}

let loading = null

/**
 * @returns {Promise<object>} the engines bundle's exports (ENGINES,
 * enginesReady), loaded once
 */
export function loadScoreEngines() {
  if (!loading) {
    let url = enginesURL()
    loading = import(url)
    loading.catch(() => { loading = null })
  }
  return loading
}
