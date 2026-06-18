import type { LLMRequest } from "../../schema"

/**
 * Inline reasoning-tag extraction for OpenAI-compatible servers that stream a
 * model's chain-of-thought as plain `content` rather than a separate
 * `reasoning_content` field.
 *
 * Some local runtimes (e.g. mlx-vlm serving Cohere North / Command models)
 * emit the thinking block inline, delimited by special tokens, and — because
 * the chat template pre-opens the block — the stream begins *inside* the
 * thinking block, so only the closing marker is ever seen on the wire:
 *
 *   "The user asks ... provide \"four\".<|END_THINKING|>four"
 *
 * Without extraction that whole string is rendered as assistant text and the
 * reasoning leaks into the UI. This module splits a streamed `content` chunk
 * into ordered text/reasoning segments and strips the marker tokens, with the
 * markers allowed to straddle chunk boundaries.
 */
export interface Tags {
  /** Marker that opens a thinking block, e.g. `<|START_THINKING|>`. */
  readonly open: string
  /** Marker that closes a thinking block, e.g. `<|END_THINKING|>`. */
  readonly close: string
  /**
   * `true` when the model's chat template pre-opens the thinking block, so the
   * stream starts inside reasoning and never emits `open` on the wire.
   */
  readonly startInside: boolean
}

export interface State {
  /** Whether the cursor is currently inside a thinking block. */
  readonly inside: boolean
  /**
   * Trailing bytes withheld from emission because they may be the leading
   * prefix of a marker that is split across stream chunks. Always a proper
   * prefix of `open` or `close` by construction.
   */
  readonly buffer: string
}

export interface Segment {
  readonly kind: "text" | "reasoning"
  readonly text: string
}

export const initial = (tags: Tags | undefined): State => ({
  inside: tags?.startInside ?? false,
  buffer: "",
})

// Longest suffix of `s` that is a proper prefix of `marker` (0 when none). This
// is the slice we must withhold: it could be the start of a marker whose
// remaining bytes arrive in the next chunk.
const partialSuffix = (s: string, marker: string): number => {
  const max = Math.min(s.length, marker.length - 1)
  for (let n = max; n > 0; n--) {
    if (marker.startsWith(s.slice(s.length - n))) return n
  }
  return 0
}

/**
 * Consume one streamed `content` chunk, returning the marker-stripped segments
 * to emit and the next state. Withholds a trailing partial marker so the next
 * chunk can complete it.
 */
export const step = (state: State, chunk: string, tags: Tags): { readonly segments: Segment[]; readonly state: State } => {
  let inside = state.inside
  let work = state.buffer + chunk
  const segments: Segment[] = []
  const push = (text: string) => {
    if (text) segments.push({ kind: inside ? "reasoning" : "text", text })
  }
  for (;;) {
    const marker = inside ? tags.close : tags.open
    const idx = work.indexOf(marker)
    if (idx === -1) {
      const hold = partialSuffix(work, marker)
      push(work.slice(0, work.length - hold))
      return { segments, state: { inside, buffer: hold === 0 ? "" : work.slice(work.length - hold) } }
    }
    push(work.slice(0, idx))
    work = work.slice(idx + marker.length)
    inside = !inside
  }
}

/**
 * Drain the withheld buffer when the stream ends. A buffer left while *inside*
 * a thinking block is an incomplete close marker — drop it as noise. A buffer
 * left while *outside* is real trailing text that merely looked like the start
 * of an open marker — emit it.
 */
export const flush = (state: State): Segment | undefined =>
  !state.inside && state.buffer ? { kind: "text", text: state.buffer } : undefined

const isTags = (v: unknown): v is Tags =>
  !!v &&
  typeof v === "object" &&
  typeof (v as Record<string, unknown>).open === "string" &&
  typeof (v as Record<string, unknown>).close === "string" &&
  typeof (v as Record<string, unknown>).startInside === "boolean"

// Cohere North / Command thinking template. The chat template pre-opens
// <|START_THINKING|>, so the stream begins inside the block and only the close
// marker is seen — hence `startInside: true`.
const COHERE_THINKING: Tags = {
  open: "<|START_THINKING|>",
  close: "<|END_THINKING|>",
  startInside: true,
}

/**
 * Resolve the reasoning tags for a request, or `undefined` to leave the stream
 * untouched (the default for every provider that already reports reasoning
 * natively). An explicit `providerOptions[ns].reasoningTags` object wins;
 * otherwise a built-in default is applied to Cohere North / Command models.
 */
export const detect = (request: LLMRequest): Tags | undefined => {
  for (const ns of Object.values(request.providerOptions ?? {})) {
    const override = (ns as Record<string, unknown>)?.reasoningTags
    if (isTags(override)) return override
  }
  if (/north|command-a/i.test(String(request.model.id))) return COHERE_THINKING
  return undefined
}

export * as ReasoningTags from "./reasoning-tags"
