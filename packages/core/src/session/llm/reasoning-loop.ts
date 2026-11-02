import { deflateSync } from "node:zlib"

// Lead line of the synthetic user turn injected when the model's output
// collapses into an uncontrolled loop (the full text is `loopNudgeText`: the
// step's work from its start to the loop onset, then an instruction to ACT;
// LD-05c, onset cut LD-05d). Settled loops often do useful work, so the
// session must continue.
export const REASONING_LOOP_NUDGE = "Your previous step entered a repetition loop and was stopped."

/**
 * The LD-05b thresholds (3rd copy / 4 copies >= 512 chars / 8 lines), used
 * only when a step ends by running out of output budget (`length`): a loop
 * that reached the cap did not end on its own, so it is handled as a loop
 * (pre-loop work pasted back) even if it never reached the patient mid-stream
 * thresholds (LD-05d).
 */
export const LOOP_AT_CAP: ReasoningLoopOptions = {
  minSeen: 2,
  periodCopies: 4,
  periodMinSpan: 512,
  lineRepeats: 8,
}

/**
 * Kill switch for the exact-repeat rule (LD-05, 2026-10-30). Default ON;
 * `OPENCODE_LOOP_REPEAT_DETECT=0` (or `false`/`off`) turns the repeat rule off
 * for new sessions. The older tight-loop rule is unaffected.
 */
export function repeatRuleEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.OPENCODE_LOOP_REPEAT_DETECT?.trim().toLowerCase()
  return !(value === "0" || value === "false" || value === "off" || value === "no")
}

/**
 * Kill switch for the fast short-cycle rules (LD-05b, 2026-10-30): `period`
 * and `line`. Default ON; `OPENCODE_LOOP_FAST_DETECT=0` (or `false`/`off`/`no`)
 * turns them off for new processes.
 */
export function fastRuleEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.OPENCODE_LOOP_FAST_DETECT?.trim().toLowerCase()
  return !(value === "0" || value === "false" || value === "off" || value === "no")
}

export type ReasoningLoopRule = "repeat" | "tight" | "period" | "line"

export type ReasoningLoopMetrics = {
  /** Chars fed so far (reasoning + text of the current step). */
  chars: number
  /** Consecutive positions whose shingle was already seen >= `minSeen` times. */
  run: number
  /** Positions (since the start) whose shingle was a >= `minSeen`-th repeat. */
  seen: number
  /** Which rule fired, if any. */
  rule?: ReasoningLoopRule
  /** Stream char (reasoning + text of the step) at which the rule fired. */
  fireAt?: number
  /** Repeating unit in chars, when the firing rule knows it (period/line). */
  period?: number
  /** Tight-loop window metrics from the last tight-rule evaluation, if any. */
  zlib?: number
  duplicateLine?: number
  unique5Gram?: number
}

export type TightLoopMetrics = {
  chars: number
  zlib: number
  duplicateLine: number
  unique5Gram: number
}

export type ReasoningLoopOptions = {
  /** Exact-repeat rule on/off (default: `repeatRuleEnabled()`). */
  repeat?: boolean
  /** Shingle length in chars (~32 tokens at 3.45 chars/token). */
  shingle?: number
  /** Consecutive seen positions that fire (~512 tokens). */
  runChars?: number
  /** A position is seen when its shingle occurred at least this many times before. */
  minSeen?: number
  /** Stop inserting new shingles beyond this many distinct entries. */
  maxEntries?: number
  /** Fast short-cycle rules (period + line) on/off (default: `fastRuleEnabled()`). */
  fast?: boolean
  /** Period rule: the tail must be this many identical copies of the unit. */
  periodCopies?: number
  /** Period rule: and the repeated span (all copies after the first) must be at least this many chars. */
  periodMinSpan?: number
  /** Period rule: unit lengths searched, in chars (1 = the same char over and over). */
  periodMin?: number
  periodMax?: number
  /** Line rule: this many identical complete non-empty lines in a row... */
  lineRepeats?: number
  /** ...each at least this long (after trimming trailing whitespace). */
  lineMinChars?: number
  /** Tight-loop rule (the 2026-10-25 detector) on/off. */
  tight?: boolean
  /** Rolling window of text kept for the tight rule. */
  window?: number
  /** Tight rule: do not evaluate until the window holds at least this many chars. */
  minChars?: number
  /** Tight rule: evaluate at most once per this many newly fed chars. */
  checkEvery?: number
  /** zlib compressed/original ratio must be BELOW this. */
  zlibMax?: number
  /** duplicate-line ratio must be ABOVE this. */
  duplicateLineMin?: number
  /** unique 5-gram ratio must be BELOW this. */
  unique5GramMax?: number
}

// LD-05d (Jonathan 2026-10-30: "two loops or three loops may be too soon ...
// if the loop ends, we want the good stuff"): the mid-stream rules wait for
// 8 copies. From v2/cuteafd/loop-patience-replay-2026-10-30.py (dgxraid): on
// replica-d the longest self-ending repeat reached 4 copies (C5Kqbw, 4,372
// verbatim chars at copy 4; nothing past copy 4 runs over 640 chars), the
// longest self-ending short cycle ran 443 chars; 8 copies / 1,024 chars is
// >= 2x both.
const DEFAULTS = {
  shingle: 110,
  runChars: 1800,
  minSeen: 7,
  maxEntries: 262_144,
  periodCopies: 8,
  periodMinSpan: 1024,
  periodMin: 1,
  periodMax: 880,
  lineRepeats: 16,
  lineMinChars: 32,
  tight: true,
  window: 6000,
  minChars: 4000,
  checkEvery: 512,
  zlibMax: 0.05,
  duplicateLineMin: 0.9,
  unique5GramMax: 0.3,
} as const

// Two polynomial rolling hashes modulo primes below 2^26, so every product
// stays below 2^53 and the pair packs into one exact JS number key.
const P1 = 67_108_859
const P2 = 67_108_837
const B1 = 131_071
const B2 = 65_599
const SHIFT = 67_108_864 // 2^26

function powMod(base: number, exp: number, mod: number) {
  let out = 1
  for (let i = 0; i < exp; i++) out = (out * base) % mod
  return out
}

/** The 2026-10-25 tight-loop metrics (zlib, duplicate lines, unique 5-grams). */
export function reasoningLoopMetrics(text: string): TightLoopMetrics {
  const chars = text.length
  if (chars === 0) return { chars: 0, zlib: 1, duplicateLine: 0, unique5Gram: 1 }

  const bytes = Buffer.byteLength(text, "utf8")
  const zlib = bytes === 0 ? 1 : deflateSync(Buffer.from(text, "utf8")).length / bytes

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const duplicateLine = lines.length < 2 ? 0 : 1 - new Set(lines).size / lines.length

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim()
  const grams = new Set<string>()
  let total = 0
  for (let at = 0; at + 5 <= normalized.length; at++) {
    grams.add(normalized.slice(at, at + 5))
    total++
  }
  const unique5Gram = total === 0 ? 1 : grams.size / total

  return { chars, zlib, duplicateLine, unique5Gram }
}

/**
 * Streaming reasoning/text loop detector. Two rules, either fires:
 *
 * - repeat (LD-05, the engine's R(32,512,N) in chars): a 110-char shingle is
 *   slid one char at a time with a rolling hash; a position is "seen" when the
 *   same shingle already occurred >= 7 times earlier in this step (LD-05d; was
 *   2); fire when 1,800 consecutive positions are seen, i.e. the last ~1,900
 *   chars are the eighth-or-later verbatim copy. O(1) per char. Catches the
 *   paragraph-scale loops (1-15k-char period) the tight rule misses.
 * - tight (2026-10-25): zlib < 0.05 AND duplicate-line > 0.9 AND unique-5-gram
 *   < 0.3 over a 6,000-char window. Kept because it is whitespace/line-order
 *   tolerant, which the exact rule is not.
 * - period (LD-05b, idea from MiaAI's DS41 loop_abort, own code): the tail is
 *   8 identical copies of a 1..880-char unit AND the copies after the first
 *   span >= 1,024 chars (LD-05d; was 4 / 512). Catches SHORT cycles within
 *   ~8k chars instead of ~10k+. O(periodMax) per char.
 * - line (LD-05b): the last 16 complete non-empty lines are identical and
 *   >= 32 chars (trailing whitespace ignored; LD-05d, was 8).
 *
 * The caller treats a hit as a SOFT interrupt (nudge + continue).
 */
export function reasoningLoopDetector(options: ReasoningLoopOptions = {}) {
  const opts = { ...DEFAULTS, ...options }
  const repeatOn = options.repeat ?? repeatRuleEnabled()
  const W = opts.shingle
  const pow1 = powMod(B1, W - 1, P1)
  const pow2 = powMod(B2, W - 1, P2)

  let ring = new Uint16Array(W)
  let counts = new Map<number, number>()
  let filled = 0
  let h1 = 0
  let h2 = 0
  let chars = 0
  let run = 0
  let seen = 0

  let buffer = ""
  let sinceCheck = 0
  let tightLast: TightLoopMetrics | undefined

  const fastOn = options.fast ?? fastRuleEnabled()
  // Period rule, exact but cheap: char i continues a p-periodic run of length
  // r >= G iff the G-char window ending at i equals the one ending at i - p, so
  // r >= need[p] iff need[p] - G + 1 consecutive windows match at distance p.
  // Windows are keyed by the same two-prime rolling hash as the repeat rule;
  // only distances where the current window re-occurs are visited, so normal
  // prose costs one map lookup per char. Every need[p] is >= periodMinSpan > G.
  const PM = opts.periodMax
  const G = Math.min(32, opts.periodMinSpan)
  const gpow1 = powMod(B1, G - 1, P1)
  const gpow2 = powMod(B2, G - 1, P2)
  const need = new Int32Array(PM + 1)
  for (let p = 1; p <= PM; p++) need[p] = Math.max((opts.periodCopies - 1) * p, opts.periodMinSpan) - G + 1
  let gring = new Uint16Array(G)
  let gkeys = new Float64Array(PM + 1)
  let g1 = 0
  let g2 = 0
  let gpos = new Map<number, number[]>()
  let lastAt = new Int32Array(PM + 1).fill(-2)
  let streak = new Int32Array(PM + 1)
  let fastChars = 0
  let line = ""
  let lineLong = false
  let lastLine: string | undefined
  let lastLineEnd = 0
  let lineCount = 0

  let fired = false
  let rule: ReasoningLoopRule | undefined
  let fireAt: number | undefined
  let period: number | undefined

  const pushRepeat = (delta: string) => {
    for (let i = 0; i < delta.length; i++) {
      const c = delta.charCodeAt(i)
      const slot = chars % W
      chars++
      if (filled < W) {
        h1 = (h1 * B1 + c) % P1
        h2 = (h2 * B2 + c) % P2
        ring[slot] = c
        filled++
        if (filled < W) continue
      } else {
        const out = ring[slot]
        h1 = (((h1 - ((out * pow1) % P1) + P1) % P1) * B1 + c) % P1
        h2 = (((h2 - ((out * pow2) % P2) + P2) % P2) * B2 + c) % P2
        ring[slot] = c
      }
      const key = h1 * SHIFT + h2
      const prior = counts.get(key)
      if (prior === undefined) {
        if (counts.size < opts.maxEntries) counts.set(key, 1)
        run = 0
        continue
      }
      if (prior < opts.minSeen + 1) counts.set(key, prior + 1)
      if (prior >= opts.minSeen) {
        seen++
        run++
        if (run >= opts.runChars) return true
      } else run = 0
    }
    return false
  }

  const endLine = () => {
    const done = lineLong ? undefined : line.trimEnd()
    line = ""
    lineLong = false
    if (done === undefined) {
      lastLine = undefined
      lineCount = 0
      return false
    }
    if (done.trim().length === 0) return false // blank lines neither break nor extend a run
    if (done === lastLine) {
      lineCount++
      const unit = fastChars - lastLineEnd
      lastLineEnd = fastChars
      if (lineCount >= opts.lineRepeats && done.length >= opts.lineMinChars) {
        period = unit
        return true
      }
      return false
    }
    lastLine = done
    lastLineEnd = fastChars
    lineCount = 1
    return false
  }

  const pushPeriod = (c: number) => {
    const at = fastChars // index of this char
    const slot = at % G
    if (at < G) {
      g1 = (g1 * B1 + c) % P1
      g2 = (g2 * B2 + c) % P2
      gring[slot] = c
      if (at < G - 1) return undefined
    } else {
      const out = gring[slot]
      g1 = (((g1 - ((out * gpow1) % P1) + P1) % P1) * B1 + c) % P1
      g2 = (((g2 - ((out * gpow2) % P2) + P2) % P2) * B2 + c) % P2
      gring[slot] = c
    }
    const key = g1 * SHIFT + g2
    // expire the window that just left the PM range
    const old = at - PM - 1
    if (old >= G - 1) {
      const oldKey = gkeys[old % (PM + 1)]
      const list = gpos.get(oldKey)
      if (list) {
        if (list[0] === old) list.shift()
        if (list.length === 0) gpos.delete(oldKey)
      }
    }
    let hit: number | undefined
    const list = gpos.get(key)
    if (list) {
      for (let k = list.length - 1; k >= 0; k--) {
        const p = at - list[k]
        if (p < opts.periodMin) continue
        const n = lastAt[p] === at - 1 ? streak[p] + 1 : 1
        streak[p] = n
        lastAt[p] = at
        if (hit === undefined && n >= need[p]) hit = p
      }
      list.push(at)
    } else gpos.set(key, [at])
    gkeys[at % (PM + 1)] = key
    return hit
  }

  const pushFast = (delta: string) => {
    for (let i = 0; i < delta.length; i++) {
      const c = delta.charCodeAt(i)
      const p = pushPeriod(c)
      fastChars++
      if (p !== undefined) {
        period = p
        return "period" as const
      }
      if (c === 10) {
        if (endLine()) return "line" as const
      } else if (!lineLong) {
        line += delta[i]
        if (line.length > 4096) lineLong = true
      }
    }
    return undefined
  }

  const checkTight = (delta: string) => {
    buffer = `${buffer}${delta}`.slice(-opts.window)
    sinceCheck += delta.length
    if (buffer.length < opts.minChars || sinceCheck < opts.checkEvery) return false
    sinceCheck = 0
    tightLast = reasoningLoopMetrics(buffer)
    return (
      tightLast.zlib < opts.zlibMax &&
      tightLast.duplicateLine > opts.duplicateLineMin &&
      tightLast.unique5Gram < opts.unique5GramMax
    )
  }

  return {
    /** Feed the next reasoning/text delta. Returns true exactly once, on the first hit. */
    feed(delta: string): boolean {
      if (fired || !delta) return false
      if (repeatOn && pushRepeat(delta)) {
        rule = "repeat"
        fireAt = chars
      } else if (!repeatOn) chars += delta.length
      if (fastOn) {
        const hit = pushFast(delta)
        if (hit && (fireAt === undefined || fastChars <= fireAt)) {
          rule = hit
          fireAt = fastChars
        } else period = undefined
      }
      if (!rule && opts.tight && checkTight(delta)) {
        rule = "tight"
        fireAt = chars
      }
      if (!rule) return false
      fired = true
      return true
    },
    reset() {
      ring = new Uint16Array(W)
      counts = new Map()
      filled = 0
      h1 = 0
      h2 = 0
      chars = 0
      run = 0
      seen = 0
      buffer = ""
      sinceCheck = 0
      tightLast = undefined
      gring = new Uint16Array(G)
      gkeys = new Float64Array(PM + 1)
      g1 = 0
      g2 = 0
      gpos = new Map()
      lastAt = new Int32Array(PM + 1).fill(-2)
      streak = new Int32Array(PM + 1)
      fastChars = 0
      line = ""
      lineLong = false
      lastLine = undefined
      lastLineEnd = 0
      lineCount = 0
      fired = false
      rule = undefined
      fireAt = undefined
      period = undefined
    },
    metrics(): ReasoningLoopMetrics {
      return {
        chars,
        run,
        seen,
        ...(rule ? { rule } : {}),
        ...(fireAt !== undefined ? { fireAt } : {}),
        ...(period !== undefined ? { period } : {}),
        ...(tightLast
          ? { zlib: tightLast.zlib, duplicateLine: tightLast.duplicateLine, unique5Gram: tightLast.unique5Gram }
          : {}),
      }
    },
    get fired() {
      return fired
    },
    get rule() {
      return rule
    },
    /** Repeating unit in chars, when known (period/line rules). */
    get period() {
      return period
    },
  }
}

/**
 * The verbatim periodic tail of a looped stream (LD-05b): with unit `p`, every
 * char in `[keep, text.length)` satisfies text[j] === text[j - p], and the scan
 * stops where that breaks, so `[keep - unit, text.length)` is the maximal
 * periodic region. When the unit is unknown (repeat/tight rules) it is the
 * distance to the previous occurrence of the last `probe` chars; the scan is
 * repeated (at most `rounds` times) to peel off earlier copies whose
 * boundaries jittered. `unit` is 0 when nothing repeats.
 */
export function loopCut(text: string, period?: number, probe = 110, rounds = 8) {
  let keep = text.length
  let unit = period
  let last = 0
  for (let round = 0; round < rounds; round++) {
    let p = unit
    unit = undefined
    if (!p) {
      if (keep < probe * 2) break
      const at = keep - probe
      const prev = text.lastIndexOf(text.slice(at, keep), at - 1)
      if (prev < 0) break
      p = at - prev
    }
    if (p <= 0 || p >= keep) break
    let j = keep - 1
    while (j - p >= 0 && text.charCodeAt(j) === text.charCodeAt(j - p)) j--
    const run = keep - 1 - j
    if (run < Math.min(p, probe)) break
    keep -= run
    last = p
  }
  return { keep, unit: Math.min(last, keep) }
}

// Walk left from the verbatim onset over text that still belongs to the loop
// (LD-05d): 32-char blocks that occur somewhere in the first two copies of the
// unit. An earlier copy that differs (a changed word, number or sentence, an
// inserted char, a partial first copy) leaves gaps of non-matching blocks; a
// gap of up to max(2, unit/256) blocks (~1/8 of the unit) is bridged when
// two matching blocks in a row lie past it. A longer gap is pre-loop text.
// The boundary is then refined to the char.
function loopStart(text: string, onset: number, unit: number) {
  const A = 32
  if (unit < A || onset < A) return onset
  const loop = text.slice(onset, Math.min(text.length, onset + 2 * unit + A))
  const gap = Math.max(2, Math.floor(unit / 256))
  const hit = (j: number) => j - A >= 0 && loop.includes(text.slice(j - A, j))
  let start = onset
  let misses = 0
  for (let j = onset; j - A >= 0; j -= A) {
    if (hit(j) && (misses === 0 || hit(j - A))) {
      start = j - A
      misses = 0
    } else if (++misses > gap) break
  }
  while (start > 0 && start < onset && loop.includes(text.slice(start - 1, start - 1 + A))) start--
  return start
}

/**
 * Where the loop STARTED (LD-05d, Jonathan 2026-10-30: "anything pasted back
 * should cut off the looping section and just keep what is before it"): the
 * start of the FIRST copy of the repeated unit. Begins at the maximal verbatim
 * periodic region (`loopCut`, so a partial first copy that matches the unit's
 * tail is included), then walks back over earlier copies that differ slightly
 * (`loopStart`). A split a few chars before a line start (the text before
 * the loop ended like the unit does, e.g. ".\n") moves to that line start, so
 * no pre-loop word is cut. Returns `text.length` when nothing repeats.
 */
export function loopOnset(text: string, period?: number, probe = 110, rounds = 8) {
  const cut = loopCut(text, period, probe, rounds)
  if (cut.unit <= 0) return text.length
  const unit = cut.unit
  let onset = loopStart(text, cut.keep - unit, unit)
  // display-safe split: the scan can reach a few chars into the pre-loop
  // text's last line; never move a split that is already at a line start
  if (onset > 0 && text.charCodeAt(onset - 1) !== 10) {
    const nl = text.indexOf("\n", onset)
    if (unit > 16 && nl >= 0 && nl - onset < 8 && nl + 1 < cut.keep) onset = nl + 1
  }
  return onset
}

/**
 * How many leading chars of a looped stream to keep in the transcript
 * (LD-05d): everything before the loop onset, no copy of the repeated unit.
 * `text.length` means "nothing to cut".
 */
export function loopKeep(text: string, period?: number, probe = 110, rounds = 8) {
  return loopOnset(text, period, probe, rounds)
}

/**
 * Loop-recovery nudge (LD-05c, Jonathan 2026-10-30: "pasting that information
 * in and saying it looped will let it get on the task and next step"). The
 * nudge carries ONLY the step's work from its start to the loop onset (LD-05d:
 * no copy of the repeated unit), so the next step starts from that work instead
 * of re-deriving it. Bounded by LOOP_NUDGE_MAX_CHARS: over it, the work keeps
 * a head (LOOP_NUDGE_HEAD share) + tail with the elided middle stated.
 */
export const LOOP_NUDGE_MAX_CHARS = 32_000
export const LOOP_NUDGE_HEAD = 1 / 3

export function loopNudgeParts(stream: string, period?: number) {
  const keep = loopOnset(stream, period)
  return { preLoop: stream.slice(0, keep), keep }
}

const elide = (text: string, max: number, head: number) => {
  if (text.length <= max) return { text, elided: 0 }
  const h = Math.floor(max * head)
  const t = max - h
  const elided = text.length - h - t
  return {
    text: `${text.slice(0, h)}\n\n[... ${elided} chars of this work elided from the middle ...]\n\n${text.slice(text.length - t)}`,
    elided,
  }
}

export function loopNudgeText(work: { preLoop: string }, max = LOOP_NUDGE_MAX_CHARS) {
  const pre = elide(work.preLoop.trim() ? work.preLoop : "", max, LOOP_NUDGE_HEAD)
  const lines = [REASONING_LOOP_NUDGE]
  if (pre.text) {
    lines.push(
      "Here is the work you produced before the loop started:",
      "",
      "<work-before-loop>",
      pre.text,
      "</work-before-loop>",
    )
  } else lines.push("You produced no work before the loop started.")
  lines.push(
    "",
    "The repeated part was removed. Do not start it again; continue the task from here with the next concrete step (make the tool call / write the answer).",
  )
  return { text: lines.join("\n"), elided: pre.elided }
}
