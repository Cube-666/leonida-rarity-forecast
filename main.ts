// LEONIDA RARITY FORECAST — GTA 6 trophy earn-rate forecaster (Node 22, stdlib only).
//
// Forecasts, for every trophy of Grand Theft Auto VI on PlayStation 5, its earn
// rate on Exophase at the case's target, as five quantiles (5/25/50/75/95%).
// Reads every <id>.in in the input directory and writes <id>.out to the output
// directory: {"trophies": [{"id": n, "q": [q05, q25, q50, q75, q95]}]}.
//
// The model works in COUNTS, not rates, because the page's rates are a ratio
// whose denominator (players tracked) moves violently at launch:
//
//   rate_i(t) = earners_i(t) / tracked(t)
//
// Two forces move it, and the house persistence baseline models neither:
//   1. DILUTION. Exophase refreshes a game's counts on its own schedule, hours
//      apart, not continuously. Between refreshes the page is frozen; at a
//      refresh the tracked base jumps (launch night: 638 -> 3,868 players in
//      one refresh) and almost every rate falls, because the new players have
//      earned almost nothing yet. The displayed base is stale by the time
//      since the last refresh, so the forecast grows it over
//      (staleness + horizon) at the launch-surge growth rate (fitted from the
//      history when it moves, a prior when the history is flat).
//   2. PROGRESSION. Players earn trophies as they play. A new player earns
//      the opening trophy at once, an early chapter or an easy activity
//      (fishing, arcade) within hours, and almost nothing else in the window;
//      the old cohort keeps playing through the story. Each trophy gets a
//      class from its description (story chapter, easy activity, grind, ...)
//      with an earn-probability curve that saturates with horizon, so the
//      same equations cover a 90-minute practice horizon and the 4.5-day
//      final horizon.
//
// The spread is honest about the refresh: it widens with the log growth of
// the tracked base and with the horizon, so the 5-95% band aims at ~90%
// coverage instead of the baseline's ~0%.
//
// Deterministic: no randomness, no network, no clock reads inside the
// forecast (every time comes from the case file). Two runs on the same case
// write byte-identical output.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];

// Launch-surge prior for the hourly log-growth of the tracked base, used only
// when the history is flat (no read ever moved the tracked count). Launch
// night it took the base 638 -> 3,868 over one refresh interval, i.e. the
// page's staleness hid ~4.7 h of growth at ~0.38 log units an hour.
const GAMMA_PRIOR_PER_HOUR = 0.38;
// The surge decays: growth halves roughly every 3 days after launch.
const DECAY_TAU_HOURS = 72;

// Per-class earn curves. A: the eventual share of new players who earn the
// trophy; tauP: the timescale (hours) on which they get there. g: the old
// cohort's fractional earner growth; tauG: its timescale.
const CLASSES = {
  story1:     { A: 0.15,  tauP: 72,  g: 0.5,  tauG: 72 },
  storyLate:  { A: 0.10,  tauP: 240, g: 0.3,  tauG: 120 },
  storySide:  { A: 0.10,  tauP: 240, g: 0.3,  tauG: 120 },
  quick:      { A: 0.15,  tauP: 24,  g: 0.2,  tauG: 48 },
  activityEasy: { A: 0.08, tauP: 48, g: 0.15, tauG: 72 },
  activity:   { A: 0.03,  tauP: 120, g: 0.15, tauG: 96 },
  grind:      { A: 0.02,  tauP: 240, g: 0.05, tauG: 240 },
  platinum:   { A: 0.002, tauP: 240, g: 0.02, tauG: 240 },
  completion: { A: 0.002, tauP: 240, g: 0.02, tauG: 240 },
};

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function logit(p) {
  const x = clamp(p, 0.01, 99.99) / 100;
  return Math.log(x / (1 - x));
}

function invLogit(l) {
  return 100 / (1 + Math.exp(-l));
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

// Classify a trophy from its official description and tier. The description
// is the only per-trophy text the case carries, and it names the deed.
function classify(t) {
  const d = t.description || '';
  const name = t.name || '';
  if (t.tier === 'platinum') return 'platinum';
  if (/100% Completion/.test(d)) return 'completion';
  if (/Complete Gone Fishing/.test(d)) return 'story1';
  if (/Complete Chapter 1/.test(d)) return 'story1';
  if (/Complete Chapter [234]/.test(d) || /Complete the final mission/.test(d)) return 'storyLate';
  if (/Complete (Breakfast Run|The Cartel Heist|Child's Play|Headliners|VCIA Takedown|Operation Savage Glory)/.test(d)) return 'storySide';
  if (/fishing challenge/.test(d)) return 'quick';
  if (/arcade game|Discover \d+ vehicles/.test(d)) return 'activityEasy';
  if (/250 Stunts|100 locations|50 Challenges|20 different races|8 mission strands|3 Collectible Card sets/.test(d)) return 'grind';
  return 'activity';
}

// Least-squares slope of ln(players_tracked) against time (hours), over the
// reads. Returns null when the tracked count never moves.
function fitGrowth(reads) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  let firstN = -1, lastN = -1;
  const t0 = Date.parse(reads[0].at);
  for (const r of reads) {
    const N = r.players_tracked;
    if (firstN < 0) firstN = N;
    lastN = N;
    const x = (Date.parse(r.at) - t0) / 3600000;
    const y = Math.log(Math.max(1, N));
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  if (lastN === firstN) return null; // flat history: no growth signal
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return clamp((n * sxy - sx * sy) / denom, 0, 0.6);
}

function forecastCase(c) {
  const trophies = c.trophies;
  const history = c.history;
  const last = history[history.length - 1];
  const N0 = last.players_tracked;
  const rates = last.rates;
  const t0 = Date.parse(c.at);
  const tTarget = Date.parse(c.target);
  const horizonH = Math.max(0, (tTarget - t0) / 3600000);
  const horizonDays = horizonH / 24;

  // Staleness: the page is frozen between refreshes, so the last read's
  // tracked count is the truth as of the last refresh, not as of t0. Find
  // the most recent read whose count differs from N0; if none ever differs,
  // the page has been stale since the first read.
  let lastChangeMs = Date.parse(history[0].at);
  for (let i = 1; i < history.length; i++) {
    if (history[i].players_tracked !== N0) lastChangeMs = Date.parse(history[i].at);
  }
  const stalenessH = Math.max(0, (t0 - lastChangeMs) / 3600000);

  // Growth of the tracked base over (staleness + horizon), decaying as the
  // launch surge passes: gamma_eff is the average hourly log-growth over
  // the window under gamma(t) = gamma * exp(-t / DECAY_TAU_HOURS).
  const gammaFit = fitGrowth(history);
  const gamma = gammaFit === null ? GAMMA_PRIOR_PER_HOUR : gammaFit;
  const windowH = stalenessH + horizonH;
  const decayAvg = windowH > 0
    ? (DECAY_TAU_HOURS / windowH) * (1 - Math.exp(-windowH / DECAY_TAU_HOURS))
    : 1;
  const gammaEff = gamma * decayAvg;
  const growthFactor = Math.exp(gammaEff * windowH);
  const Ntarget = N0 * growthFactor;
  const Nnew = Math.max(0, Ntarget - N0);
  const logGrowth = Math.log(Math.max(1, growthFactor));

  // The spread widens with how much the base grows (refresh uncertainty)
  // and with the horizon (progression uncertainty). The base and growth
  // terms are scaled so the practice band lands near 90% coverage instead
  // of ~98%; the horizon term is left whole, so a 4.5-day final keeps a
  // solid floor under its spread.
  const spread = Math.sqrt(
    0.25 * 0.25 +
    (0.32 * logGrowth) * (0.32 * logGrowth) +
    (0.25 * Math.sqrt(horizonDays)) * (0.25 * Math.sqrt(horizonDays)),
  );

  const rows = [];
  let minRate = Infinity;
  const medians = new Array(trophies.length);
  for (let i = 0; i < trophies.length; i++) {
    const t = trophies[i];
    const rateLast = rates[i] == null ? 0 : rates[i];
    const E = (rateLast * N0) / 100;
    const cls = CLASSES[classify(t)];
    // Old cohort keeps playing: earners grow a little with horizon.
    const oldGrowth = 1 + cls.g * (1 - Math.exp(-horizonH / cls.tauG));
    // New players earn it with a saturating probability in horizon.
    const pNew = cls.A * (1 - Math.exp(-horizonH / cls.tauP));
    const Etarget = E * oldGrowth + Nnew * pNew;
    let rate = (Etarget / Ntarget) * 100;
    rate = clamp(rate, 0.01, 99.99);
    medians[i] = rate;
    if (rate < minRate) minRate = rate;
  }

  for (let i = 0; i < trophies.length; i++) {
    const t = trophies[i];
    // The opening trophy is earned by every tracked player, at 638 and at
    // 3,868 alike: forecast it at the clamp, no spread.
    if (rates[i] != null && rates[i] >= 99.99) {
      rows.push({ id: t.id, q: [99.99, 99.99, 99.99, 99.99, 99.99] });
      continue;
    }
    let rate = medians[i];
    // The platinum and the 100%-completion trophy need (nearly) every other
    // trophy, so neither can sit above the slowest trophy's rate.
    if (t.tier === 'platinum' || /100% Completion/.test(t.description || '')) {
      rate = Math.min(rate, minRate * 0.99);
      rate = clamp(rate, 0.01, 99.99);
    }
    const l0 = logit(rate);
    const q = LEVELS.map((_, k) => {
      const v = round4(clamp(invLogit(l0 + Z[k] * spread), 0.01, 99.99));
      return v;
    });
    // Enforce non-decreasing quantiles after rounding.
    for (let k = 1; k < q.length; k++) {
      if (q[k] < q[k - 1]) q[k] = q[k - 1];
    }
    rows.push({ id: t.id, q });
  }
  return { trophies: rows };
}

function main() {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  mkdirSync(outputDir, { recursive: true });
  const files = readdirSync(inputDir).filter((f) => f.endsWith('.in')).sort();
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(inputDir, f), 'utf8'));
    const out = forecastCase(c);
    const id = f.replace(/\.in$/, '');
    const text = JSON.stringify(out);
    if (text.length > 65536) throw new Error(`output for ${id} exceeds 65536 bytes`);
    writeFileSync(join(outputDir, `${id}.out`), text);
  }
}

main();
