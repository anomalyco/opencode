export * as DoomLoopDetector from "./detector.js"

// Pure doom-loop detection core: no Effect, no opencode imports, portable across hosts.
// Four detectors:
// - Signal A: per-signature (tool + canonical input) identical-output streak. Warn 3, block 6.
// - Signal B: global line-level information novelty. Warn 3/5, surgical block 8 (needs A streak >= 3
//   as corroboration), circuit breaker 12 (hard stop until the user speaks).
// - Signal C: per-tool failure-equivalence streak (volatile tokens normalized before hashing).
//   Warn 4, block 6. Interleaved successes of other tools do not reset it; a success of the same
//   tool does.
// - Same-message repeat guard: identical (tool, input) emitted 3 times within one assistant message
//   asks exactly once (== 3, not >= 3, so later high-tier prompts cannot be starved by it).
// Thresholds are accounted in after hooks and read in before hooks: "block at N" means the call
// emitted after the Nth accounting (the N+1th emission) is the one challenged in before.

const A_WARN = 3
const A_BLOCK = 6
const B_WARN_LOW = 3
const B_WARN_HIGH = 5
const B_BLOCK = 8
const B_CIRCUIT = 12
const B_MIN_LINES = 3
const C_WARN = 4
const C_BLOCK = 6
const GUARD_TRIGGER = 3
const UNOBSERVED_PROMPT = 6
const LINE_LIMIT = 10_000
const LINE_CAP = 1024
const TIGHTENED_LINE_KEEP = 1_000
// Per-session cap for the signature (A) and unobserved maps, each bounded independently. An
// entry is ~100 bytes, so a session worst-cases at ~400KB per map.
const SIGNATURE_LIMIT = 4_096

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_MASK = 0xffffffffffffffffn

export function fnv64(text: string): string {
  let hash = FNV_OFFSET
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return hash.toString(16).padStart(16, "0")
}

// Canonical JSON with recursively sorted keys so semantically identical inputs hash identically
// regardless of key order. Bash AST normalization is deliberately omitted (decided): `ls` vs
// `ls -la` are distinct signatures and escape A, which signal B covers instead.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value === undefined ? null : value)
    return primitive === undefined ? "null" : primitive
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const record = value as Record<string, unknown>
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")
  return `{${body}}`
}

export const signature = (tool: string, input: unknown) => fnv64(`${tool}:${canonical(input)}`)

// Volatile tokens (ids, durations, timestamps, plain numbers) collapse to placeholders so that
// "in 0.03s" and "in 0.05s" normalize to the same line and the same failure identity.
const normalizeVolatile = (line: string): string =>
  line
    .replace(/[0-9a-f]{8,}/gi, "<id>")
    .replace(/\b\d+(?:\.\d+)?(?:ns|us|ms|s|m|h)\b/g, "<duration>")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, "<timestamp>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<num>")

const SEPARATOR = /^[-=_*~ ]{3,}$/

// Lines enter the global novelty store normalized and capped at 1KB each (memory bound).
const contentLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !SEPARATOR.test(line))
    .map((line) => normalizeVolatile(line).slice(0, LINE_CAP))

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// Mirrors the runtime content normalization: a tool result carries either string content, content
// parts, or (for output-only tools) falls back to the stringified machine output. Hashing must use
// this normalized view so output-only tools do not all hash as one constant empty string.
export function outputText(
  content: string | ReadonlyArray<{ readonly type: string; readonly text?: string }> | undefined,
  output?: unknown,
): string {
  if (typeof content === "string") return content
  if (content !== undefined && content.length > 0)
    return content
      .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
      .join("\n")
  return stringify(output)
}

export const copy = {
  warnA: (tool: string, streak: number): string =>
    `The ${tool} call with these exact arguments has returned byte-identical output ${streak} times in a row. It is not producing new information. Change approach: inspect the actual current state, or ask the user.`,
  warnB3: `Your recent tool calls have produced no new information. Before making another call, write down what new information you expect the next call to reveal.`,
  warnB5: `These repeated calls keep returning nothing new. Choose one: run a falsification check on your current hypothesis, ask the user for the missing input, or conclude based on the evidence you already have.`,
  warnC: (tool: string, streak: number): string =>
    `The ${tool} tool has failed ${streak} times in a row with the same error. Stop retrying it unchanged. Inspect the target or ask the user before trying again.`,
  blockA: (tool: string, streak: number): string =>
    `This exact ${tool} call has returned identical output ${streak} times in a row and is blocked as a suspected repetition loop. If this repetition is intentional (for example user-requested polling), approve the doom_loop permission to continue.`,
  blockB: `Recent calls keep producing nothing new, and this exact call has already returned identical output repeatedly. It is blocked as suspected non-progress. Run a falsification check, ask the user for missing input, or conclude with the evidence at hand.`,
  blockC: (tool: string, streak: number): string =>
    `The ${tool} tool has failed ${streak} times in a row with the same error and is blocked as a suspected retry loop. Inspect the target state or ask the user before trying again.`,
  circuit: `Twelve recent tool calls in a row produced no new information. Stop making tool calls entirely. Summarize the current state, the hypotheses you have ruled out, and what input you need from the user, in plain text.`,
  guard: (count: number, tool: string): string =>
    `This exact ${tool} call has already been emitted ${count} times within the current assistant message. If the same invocation is repeating without progress, stop and report to the user instead.`,
  guardMerged: (count: number, tool: string, aStreak: number): string =>
    `This exact ${tool} call has been emitted ${count} times within the current assistant message and returned identical output ${aStreak} times before. Stop repeating it and report to the user instead.`,
  unobserved: `This call's progress cannot be observed from the session output (for example a background shell). If you are running it in a loop: write progress to a file and report from it, report the current status directly to the user, or stop and summarize.`,
} as const

// Resource/save strings are `${tool}:${sigHash}` with a per-signal suffix so an "always" answer on
// one prompt never silently exempts another signal's prompt for the same signature.
export const resourceSuffix = { guard: ":repeat", unobserved: ":unobserved", a: "", b: "", c: "" } as const

// Host-specific strings that mark argument-validation rejections (the tool never executed).
// Kept in one place so a host copy change is a one-line fix; an unmatched message is treated as a
// real failure (conservative: counts into C rather than silently exempting it).
export const VALIDATION_PREFIX = "Invalid arguments for tool"

// Texts the live after hook can inject into a persisted result: warnings prepend to a completed
// result's content and append to a failed call's error message. They fire only at fixed streaks,
// so the complete set is enumerable. The fold strips them to hash the same text the live path
// accounted — live hashes before injecting.
export function injectedWarnings(tool: string): ReadonlyArray<string> {
  const a = copy.warnA(tool, A_WARN)
  return [a, copy.warnB3, copy.warnB5, `${a}\n\n${copy.warnB3}`, `${a}\n\n${copy.warnB5}`]
}

export const injectedFailureSuffix = (tool: string): string => `\n\n${copy.warnC(tool, C_WARN)}`

// Marker the plugin attaches to Tool.Errors raised by its before hook. It persists on the error
// part (runner failTool -> Tool.Failed metadata), letting the fold tell a blocked call — never
// executed, never accounted live — apart from a real execution failure.
export const blockedMetadata = { doom_loop: "blocked" } as const

export const hasBlockedMetadata = (metadata: Record<string, unknown> | undefined): boolean =>
  metadata?.doom_loop === blockedMetadata.doom_loop

export type Verdict =
  | { readonly kind: "pass" }
  | { readonly kind: "circuit"; readonly message: string; readonly sticky: boolean }
  | {
      readonly kind: "assert"
      readonly signal: keyof typeof resourceSuffix
      readonly message: string
    }

export interface SignatureEntry {
  lastOutputHash: string
  streak: number
}

export interface FailureEntry {
  lastFailureHash: string
  streak: number
}

export interface SessionState {
  signatures: Map<string, SignatureEntry>
  lines: { set: Set<string>; order: string[] }
  bStreak: number
  failures: Map<string, FailureEntry>
  // Only the current message's bucket is retained; a new messageID drops the old one.
  emitted: { messageID: string; counts: Map<string, number> }
  unobserved: Map<string, number>
  highTierPrompted: boolean
  circuitBroken: boolean
}

export function state(): SessionState {
  return {
    signatures: new Map(),
    lines: { set: new Set(), order: [] },
    bStreak: 0,
    failures: new Map(),
    emitted: { messageID: "", counts: new Map() },
    unobserved: new Map(),
    highTierPrompted: false,
    circuitBroken: false,
  }
}

export interface Call {
  readonly tool: string
  readonly sigHash: string
  readonly messageID: string
}

// Short-circuit order: circuit breaker -> same-message guard (==3, one-shot) -> unobserved-layer
// one-time prompt -> A >= 6 -> B >= 8 surgical (requires A streak >= 3 corroboration) -> C >= 6.
// The first hit is the only action for this call. A circuit hit is a permission ask like every
// other signal: allow resets B and lets the run continue; a denial makes it sticky (hard stop).
export function beforeCall(current: SessionState, call: Call): Verdict {
  if (current.circuitBroken) return { kind: "circuit", message: copy.circuit, sticky: true }
  if (current.bStreak >= B_CIRCUIT) return { kind: "circuit", message: copy.circuit, sticky: false }
  if (current.emitted.messageID !== call.messageID) {
    current.emitted = { messageID: call.messageID, counts: new Map() }
  }
  const emitted = (current.emitted.counts.get(call.sigHash) ?? 0) + 1
  current.emitted.counts.set(call.sigHash, emitted)
  if (emitted === GUARD_TRIGGER) {
    const entry = current.signatures.get(call.sigHash)
    const message =
      entry !== undefined && entry.streak >= A_WARN
        ? copy.guardMerged(emitted, call.tool, entry.streak)
        : copy.guard(emitted, call.tool)
    return { kind: "assert", signal: "guard", message }
  }
  const unobserved = current.unobserved.get(call.sigHash) ?? 0
  if (unobserved >= UNOBSERVED_PROMPT && !current.highTierPrompted) {
    current.highTierPrompted = true
    return { kind: "assert", signal: "unobserved", message: copy.unobserved }
  }
  const entry = current.signatures.get(call.sigHash)
  if (entry !== undefined && entry.streak >= A_BLOCK) {
    return { kind: "assert", signal: "a", message: copy.blockA(call.tool, entry.streak) }
  }
  if (current.bStreak >= B_BLOCK && entry !== undefined && entry.streak >= A_WARN) {
    return { kind: "assert", signal: "b", message: copy.blockB }
  }
  const failure = current.failures.get(call.sigHash)
  if (failure !== undefined && failure.streak >= C_BLOCK) {
    return { kind: "assert", signal: "c", message: copy.blockC(call.tool, failure.streak) }
  }
  return { kind: "pass" }
}

export interface Completed {
  readonly tool: string
  readonly sigHash: string
  readonly text: string
}

// LRU write for the signature-keyed maps: a write moves the key to the newest position, and the
// oldest entry is evicted past SIGNATURE_LIMIT. Eviction is indistinguishable from the
// output-changed branch — a recurred signature restarts at streak 1 — so the loss is
// miss-direction only and never a false block. A genuinely looping signature re-fires on every
// call and stays hot; only one not seen for 4096 distinct others is dropped.
function lruSet<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key)
  map.set(key, value)
  if (map.size <= SIGNATURE_LIMIT) return
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}

// Accounts a successful call into A and B. Error events never reach this function: failures feed
// signal C only, so a run of failed calls cannot masquerade as a run of identical empty outputs.
// Returns warning text to append to the model-visible output, if any.
export function recordCompleted(current: SessionState, call: Completed): string | undefined {
  // Only a success of the same signature proves the retry loop is over.
  current.failures.delete(call.sigHash)

  const outputHash = fnv64(call.text)
  const previous = current.signatures.get(call.sigHash)
  const entry: SignatureEntry =
    previous !== undefined && previous.lastOutputHash === outputHash
      ? { lastOutputHash: outputHash, streak: previous.streak + 1 }
      : { lastOutputHash: outputHash, streak: 1 }
  lruSet(current.signatures, call.sigHash, entry)

  const warnings: string[] = []
  if (entry.streak === A_WARN) warnings.push(copy.warnA(call.tool, entry.streak))

  const lines = contentLines(call.text)
  // Outputs shorter than 3 lines are exempt from B: one-line receipts (edit/write) never streak.
  if (lines.length >= B_MIN_LINES) {
    // Novelty counts distinct lines: one new line repeated k times inside a single output is still
    // one new fact and must not inflate the count. The ratio keeps the total line count as its
    // denominator — "1 new line out of 4" is a decorator variant, not productivity.
    const distinct = [...new Set(lines)]
    let novel = 0
    for (const line of distinct) {
      if (!current.lines.set.has(line)) novel++
    }
    const productive = novel >= 2 || novel / lines.length >= 0.5
    if (productive) {
      current.bStreak = 0
    } else {
      current.bStreak++
      if (current.bStreak === B_WARN_LOW) warnings.push(copy.warnB3)
      if (current.bStreak === B_WARN_HIGH) warnings.push(copy.warnB5)
    }
    for (const line of distinct) addLine(current, line)
  }
  return warnings.length === 0 ? undefined : warnings.join("\n\n")
}

function addLine(current: SessionState, line: string) {
  if (current.lines.set.has(line)) return
  current.lines.set.add(line)
  current.lines.order.push(line)
  // FIFO eviction of the oldest half at the 10k cap keeps the store bounded.
  if (current.lines.order.length > LINE_LIMIT) {
    const evicted = current.lines.order.splice(0, LINE_LIMIT / 2)
    for (const old of evicted) current.lines.set.delete(old)
  }
}

export interface Failed {
  readonly tool: string
  readonly sigHash: string
  readonly errorText: string
  // Argument-validation rejections that never executed do not count (OpenClaw argument-validation
  // semantics); the model must be free to fix its arguments.
  readonly validation: boolean
}

// Failure equivalence is keyed by signature (tool + canonical input), not by tool name alone:
// different commands of one tool failing with the same normalized error would otherwise block an
// unrelated call of that tool. A different error means progress and resets the streak. Interleaved
// successes of other tools deliberately do not reset it.
export function recordFailed(current: SessionState, call: Failed): string | undefined {
  if (call.validation) return undefined
  const failureHash = fnv64(normalizeVolatile(call.errorText))
  const previous = current.failures.get(call.sigHash)
  const entry: FailureEntry =
    previous !== undefined && previous.lastFailureHash === failureHash
      ? { lastFailureHash: failureHash, streak: previous.streak + 1 }
      : { lastFailureHash: failureHash, streak: 1 }
  lruSet(current.failures, call.sigHash, entry)
  if (entry.streak === C_WARN) return copy.warnC(call.tool, entry.streak)
  return undefined
}

// Unobserved layer (background shell, question): A/B/C abstain; only the accounting for the
// one-time high-tier prompt happens here.
export function recordUnobserved(current: SessionState, sigHash: string) {
  lruSet(current.unobserved, sigHash, (current.unobserved.get(sigHash) ?? 0) + 1)
}

// Context discontinuity (compaction): A's per-signature streaks reset but keep their output hashes,
// B's line store and streak reset. C intentionally survives: failure equivalence does not depend on
// context content.
export function compacted(current: SessionState) {
  for (const entry of current.signatures.values()) entry.streak = 0
  current.lines.set.clear()
  current.lines.order = []
  current.bStreak = 0
}

// User message: the circuit breaker's defined escape hatch and the per-turn scope boundary. B and
// the breaker reset, and A/C counters reset too — a new user turn opens a fresh observation window,
// so a periodic legitimate re-check cannot accumulate into a block over days. A real loop
// re-accumulates within seconds after an interrupt, so detection is preserved.
export function userMessage(current: SessionState) {
  current.signatures.clear()
  current.failures.clear()
  current.bStreak = 0
  current.circuitBroken = false
}

// Files actually changed on disk: the world-observable escape for B.
export function filesChanged(current: SessionState) {
  current.bStreak = 0
}

// Execution-end sweep (memory bound): tighten the line store of the session that just finished.
// A/C counters are preserved here — they only reset on a new user message (per-turn scoping).
export function tighten(current: SessionState) {
  if (current.lines.order.length <= TIGHTENED_LINE_KEEP) return
  const evicted = current.lines.order.splice(0, current.lines.order.length - TIGHTENED_LINE_KEEP)
  for (const old of evicted) current.lines.set.delete(old)
}
