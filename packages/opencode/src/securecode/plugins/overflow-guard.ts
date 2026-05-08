// securecode overflow-guard plugin.
// Prevents context overflow on small-context providers (notably qwen via LiteLLM)
// by (A) head+tail truncating large tool outputs at the LLM boundary so the
// model sees compact summaries, and (B) dynamically reducing maxOutputTokens
// when the prompt is already close to the model's input budget.
//
// Truncation runs in `experimental.chat.messages.transform`, which fires once
// per build turn after every tool result has been normalized into a
// MessageV2.ToolPart with `state.output: string`. This shape is consistent
// across native tools and MCP tools (see prompt.ts:507-519 for the MCP join),
// so a single mutation point covers both. We deliberately do NOT use the
// `tool.execute.after` hook: for MCP tools, opencode passes the raw
// `{content: [...]}` MCP result through that hook and rebuilds the final
// output from `result.content` afterwards, so any mutation a plugin makes is
// silently dropped (see PR #102 review for details).
//
// The plugin lives under packages/opencode/src/securecode/ rather than the
// upstream packages/opencode/src/plugin/ directory so that securecode-only
// code stays clearly separated from opencode and merge churn is minimized.
//
// See https://github.com/acompany-develop/securecode/issues/54.

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "securecode.overflow-guard" })

const env = (key: string) => process.env[key]
const envInt = (key: string, fallback: number) => {
  const v = env(key)
  if (!v) return fallback
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

// Read env vars at call time so tests and runtime overrides take effect
// without requiring module reload.
const cfg = () => ({
  truncateThresholdBytes: envInt("SECURECODE_TOOL_OUTPUT_THRESHOLD", 20480),
  headBytes: envInt("SECURECODE_TOOL_OUTPUT_HEAD_BYTES", 8192),
  tailBytes: envInt("SECURECODE_TOOL_OUTPUT_TAIL_BYTES", 8192),
  tokenizeUrl: env("SECURECODE_TOKENIZE_URL"),
  tokenizeTimeoutMs: envInt("SECURECODE_TOKENIZE_TIMEOUT_MS", 2000),
  safetyMarginTokens: envInt("SECURECODE_OVERFLOW_GUARD_MARGIN_TOKENS", 1024),
  minOutputTokens: envInt("SECURECODE_OVERFLOW_GUARD_MIN_OUTPUT_TOKENS", 1024),
  disabled: env("SECURECODE_OVERFLOW_GUARD_DISABLE") === "1",
})

export type TruncateResult = {
  output: string
  truncated: boolean
  originalBytes: number
}

// Round n down so buf[n] (the byte AFTER the slice end) is not a UTF-8
// continuation byte (10xxxxxx). Guarantees buf.subarray(0, n).toString("utf8")
// won't emit U+FFFD from a mid-codepoint cut.
function utf8Floor(buf: Buffer, n: number): number {
  let i = Math.min(Math.max(0, n), buf.length)
  while (i > 0 && (buf[i] & 0xc0) === 0x80) i--
  return i
}

// Round n up so buf[n] (the byte AT the slice start) is not a continuation
// byte. Guarantees buf.subarray(n).toString("utf8") won't emit U+FFFD.
function utf8Ceil(buf: Buffer, n: number): number {
  let i = Math.max(0, Math.min(n, buf.length))
  while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++
  return i
}

export function truncateHeadTail(
  text: string,
  threshold?: number,
  head?: number,
  tail?: number,
): TruncateResult {
  const c = cfg()
  threshold = threshold ?? c.truncateThresholdBytes
  head = head ?? c.headBytes
  tail = tail ?? c.tailBytes
  const buf = Buffer.from(text, "utf8")
  const originalBytes = buf.byteLength
  if (originalBytes <= threshold) {
    return { output: text, truncated: false, originalBytes }
  }
  // Align both cut points to UTF-8 codepoint boundaries so CJK / emoji
  // content doesn't get sliced through a multi-byte sequence (which would
  // produce U+FFFD replacement chars in the output).
  const headEnd = utf8Floor(buf, Math.min(head, originalBytes))
  const tailStart = utf8Ceil(buf, Math.max(headEnd, originalBytes - Math.min(tail, originalBytes - headEnd)))
  const truncatedBytes = Math.max(0, tailStart - headEnd)
  const headStr = buf.subarray(0, headEnd).toString("utf8")
  const tailStr = tailStart < originalBytes ? buf.subarray(tailStart).toString("utf8") : ""
  const marker = `\n\n[... ${truncatedBytes} bytes truncated by securecode overflow-guard (original ${originalBytes} bytes; threshold ${threshold}) ...]\n\n`
  return {
    output: headStr + marker + tailStr,
    truncated: true,
    originalBytes,
  }
}

// Char-based fallback estimator. CJK characters compress less, so they are
// weighted ~1 token each; ASCII and other scripts default to chars/4.
export function estimateTokensCharBased(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const isCjk =
      (c >= 0x3040 && c <= 0x9fff) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xffef)
    if (isCjk) cjk++
    if (!isCjk) other++
  }
  return Math.ceil(other / 4 + cjk * 0.6)
}

export async function tokenizeViaVllm(
  url: string,
  model: string,
  prompt: string,
  timeoutMs?: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  timeoutMs = timeoutMs ?? cfg().tokenizeTimeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // try/catch is unavoidable around the fetch boundary because we need to
  // clear the abort timer in `finally`; AGENTS.md tolerates try/catch when
  // the alternative degrades correctness.
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { count?: unknown; tokens?: unknown }
    if (typeof json.count === "number" && Number.isFinite(json.count)) return json.count
    if (Array.isArray(json.tokens)) return json.tokens.length
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Part = { type: string; [key: string]: any }
type Message = { info: { sessionID?: string; [key: string]: any }; parts: Part[] }

// Flatten all visible text content from a message stream into a single string
// for token estimation. Order does not matter for counting; we just want every
// byte the LLM will see.
export function flattenMessageText(messages: Message[]): string {
  const out: string[] = []
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      switch (part.type) {
        case "text":
        case "reasoning":
          if (typeof part.text === "string") out.push(part.text)
          break
        case "tool": {
          const state = part.state
          if (!state) break
          if (state.input) out.push(JSON.stringify(state.input))
          if (typeof state.output === "string") out.push(state.output)
          else if (state.output) out.push(JSON.stringify(state.output))
          if (typeof state.error === "string") out.push(state.error)
          break
        }
        case "file":
          if (typeof part.filename === "string") out.push(part.filename)
          break
      }
    }
  }
  return out.join("\n")
}

export type TruncateMessagesStats = {
  truncatedParts: number
  bytesSaved: number
}

// Walk all messages and head+tail truncate any completed ToolPart whose
// `state.output` exceeds the threshold, mutating the array in place. Works
// for native and MCP tools alike because by this point the result has been
// normalized into ToolPart.state.output: string. Returns counts for tests
// and for observability metadata.
export function truncateMessagesInPlace(messages: Message[]): TruncateMessagesStats {
  const c = cfg()
  let truncatedParts = 0
  let bytesSaved = 0
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") continue
      const state = part.state
      if (!state || state.status !== "completed") continue
      if (typeof state.output !== "string") continue
      const result = truncateHeadTail(state.output, c.truncateThresholdBytes, c.headBytes, c.tailBytes)
      if (!result.truncated) continue
      const newBytes = Buffer.byteLength(result.output, "utf8")
      bytesSaved += result.originalBytes - newBytes
      truncatedParts += 1
      state.output = result.output
      log.info("truncated tool output", {
        tool: part.tool,
        originalBytes: result.originalBytes,
        newBytes,
        threshold: c.truncateThresholdBytes,
      })
      // Annotate metadata for observability without touching the original
      // message in storage (the mutated `messages` array is the in-memory
      // copy used to build the LLM call only).
      part.metadata = {
        ...(part.metadata ?? {}),
        securecodeOverflowGuard: {
          truncated: true,
          originalBytes: result.originalBytes,
          threshold: c.truncateThresholdBytes,
          headBytes: c.headBytes,
          tailBytes: c.tailBytes,
        },
      }
    }
  }
  return { truncatedParts, bytesSaved }
}

type CachedEstimate = { sessionID: string; flatText: string; estimate: number; storedAt: number }

// Per-sessionID cache populated by experimental.chat.messages.transform and
// consumed by chat.params on the same build turn. Older entries are evicted
// when the map exceeds CACHE_MAX_ENTRIES so a long-running server doesn't grow
// unboundedly.
const CACHE_MAX_ENTRIES = 256
const sessionCache = new Map<string, CachedEstimate>()

function setCachedEstimate(entry: CachedEstimate) {
  if (sessionCache.has(entry.sessionID)) sessionCache.delete(entry.sessionID)
  sessionCache.set(entry.sessionID, entry)
  while (sessionCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value
    if (!oldestKey) break
    sessionCache.delete(oldestKey)
  }
}

export function _testing_resetCache() {
  sessionCache.clear()
}

export function _testing_getCache(sessionID: string) {
  return sessionCache.get(sessionID)
}

function deriveSessionID(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i]?.info?.sessionID
    if (typeof id === "string" && id) return id
  }
  return undefined
}

export type OverflowGuardOptions = {
  fetchImpl?: typeof fetch
}

export async function OverflowGuardPlugin(
  _input: PluginInput,
  options?: OverflowGuardOptions,
): Promise<Hooks> {
  if (cfg().disabled) return {}
  const fetchImpl = options?.fetchImpl ?? fetch

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output || !Array.isArray(output.messages)) return
      const messages = output.messages as unknown as Message[]
      const sessionID = deriveSessionID(messages)
      if (!sessionID) return
      // Truncate first so the token estimate reflects what the LLM will
      // actually receive.
      truncateMessagesInPlace(messages)
      const flatText = flattenMessageText(messages)
      const estimate = estimateTokensCharBased(flatText)
      setCachedEstimate({ sessionID, flatText, estimate, storedAt: Date.now() })
    },

    "chat.params": async (input, output) => {
      if (!input || !output || !input.model) return
      const ctx = input.model.limit?.context
      if (!ctx || ctx <= 0) return
      const cached = sessionCache.get(input.sessionID)
      const c = cfg()
      const exact =
        c.tokenizeUrl && cached?.flatText && input.model.id
          ? await tokenizeViaVllm(c.tokenizeUrl, input.model.id, cached.flatText, c.tokenizeTimeoutMs, fetchImpl)
          : null
      const inputTokens = exact ?? cached?.estimate
      if (inputTokens === undefined) return

      // Some providers (e.g. LiteLLM-fronted qwen3-coder-next) advertise a
      // smaller input cap than `context`; the public Model type doesn't expose
      // this, so we pull `limit.input` through `any` when present.
      const limitAny = input.model.limit as { input?: number } | undefined
      const inputCap = typeof limitAny?.input === "number" && limitAny.input > 0 ? limitAny.input : ctx
      const usable = Math.max(0, inputCap - c.safetyMarginTokens)
      if (inputTokens >= usable) {
        // No room for any output. Let opencode's compaction path handle this
        // by leaving maxOutputTokens at MIN; the next call after compaction
        // should fit.
        output.maxOutputTokens = c.minOutputTokens
        return
      }
      const remaining = usable - inputTokens
      const requested = output.maxOutputTokens ?? input.model.limit?.output ?? remaining
      const next = Math.max(c.minOutputTokens, Math.min(requested, remaining))
      if (next < requested) {
        output.maxOutputTokens = next
        log.info("reduced maxOutputTokens", {
          model: input.model.id,
          inputTokens,
          inputCap,
          requested,
          next,
          tokenizerSource: exact !== null ? "vllm" : "char-fallback",
        })
      }
    },
  }
}
