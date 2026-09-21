// The FSRS-6 memory model (Free Spaced Repetition Scheduler), the across-day
// half of the scheduler (st/srs/schedule): an item's stability S (days until
// its predicted recall falls to 90%) and difficulty D (1-10), how a graded
// review moves them, and when recall falls to a target.
//
// The formulas follow the reference implementation, ts-fsrs 5.4.2, which the
// specs check this against (a dev dependency only). Grades are 1 again,
// 2 hard, 3 good, 4 easy; times are in days.

// FSRS-6's published default parameters (ts-fsrs 5.4.2 default_w), fit to
// fact recall; the reviews log keeps what fitting them to a player needs
export const DEFAULT_W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
  0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
  0.0912, 0.0658, 0.1542,
])

export const S_MIN = 0.001
export const S_MAX = 36500

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

/**
 * The memory model under the parameters w.
 * @param {number[]} [w] 21 parameters
 * @returns {Object} its functions: retr(tDays, s) the predicted recall t days
 * after a review; interval(s, r) the days until recall falls to r; init(g)
 * the {s, d} of a first review; review({s, d}, g, elapsedDays) a review a
 * day or more after the last, with the recall r it predicted; shortTerm({s, d}, g)
 * a review on the same day as the last
 */
export function makeFsrs(w=DEFAULT_W) {
  let decay = -w[20]
  let factor = Math.pow(0.9, 1 / decay) - 1

  let retr = (tDays, s) => Math.pow(1 + factor * tDays / s, decay)
  let interval = (s, r) => (s / factor) * (Math.pow(r, 1 / decay) - 1)
  // unclamped, as the reference uses it for mean reversion
  let d0raw = g => w[4] - Math.exp(w[5] * (g - 1)) + 1
  let d0 = g => clamp(d0raw(g), 1, 10)
  let init = g => ({s: Math.max(S_MIN, w[g - 1]), d: d0(g)})

  let nextD = (d, g) => {
    let damped = d - w[6] * (g - 3) * (10 - d) / 9
    return clamp(w[7] * d0raw(4) + (1 - w[7]) * damped, 1, 10)
  }

  let recall = (d, s, r, g) => s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) * (g == 2 ? w[15] : 1) * (g == 4 ? w[16] : 1))

  // a lapse never leaves stability above s / e^(w17 w18)
  let forget = (d, s, r) => Math.min(s / Math.exp(w[17] * w[18]),
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)))

  let review = ({s, d}, g, elapsedDays) => {
    let r = retr(elapsedDays, s)
    let s2 = g == 1 ? forget(d, s, r) : recall(d, s, r, g)
    return {s: clamp(s2, S_MIN, S_MAX), d: nextD(d, g), r}
  }

  let shortTerm = ({s, d}, g) => {
    let inc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19])
    // only again may lower it
    if (g >= 2) { inc = Math.max(inc, 1) }
    return {s: clamp(s * inc, S_MIN, S_MAX), d: nextD(d, g)}
  }

  return {retr, interval, init, review, shortTerm, d0}
}
