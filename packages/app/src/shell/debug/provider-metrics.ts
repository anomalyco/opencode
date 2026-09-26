import type {
  SessionLogItem,
  SessionMessageAssistant,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise"

type ProviderMetricEventType =
  | "session.step.started"
  | "session.step.streamed"
  | "session.step.ended"
  | "session.step.failed"
  | "session.text.started"
  | "session.reasoning.started"
  | "session.tool.input.started"

const types: ReadonlySet<string> = new Set<ProviderMetricEventType>([
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.reasoning.started",
  "session.tool.input.started",
])

export type ProviderMetricEvent = Extract<SessionLogItem, { type: ProviderMetricEventType }>

export type ProviderMetrics = {
  tps?: number
  ttft?: number
  ttfa?: number
  e2e?: number
}

type Attempt = {
  assistantMessageID: string
  started: number
  first?: number
  answer?: number
  streamed?: number
  tokens?: TokenUsageInfo
}

export type ProviderMetricState = { attempt?: Attempt; latest?: ProviderMetrics }

export function isProviderMetricEvent(event: { type: string }): event is ProviderMetricEvent {
  return types.has(event.type)
}

export function applyProviderMetricEvent(state: ProviderMetricState, event: ProviderMetricEvent) {
  if (event.type === "session.step.started") {
    state.attempt = {
      assistantMessageID: event.data.assistantMessageID,
      started: event.data.started,
    }
    return
  }

  if (!state.attempt || event.data.assistantMessageID !== state.attempt.assistantMessageID) return

  if (
    event.type === "session.text.started" ||
    event.type === "session.reasoning.started" ||
    event.type === "session.tool.input.started"
  ) {
    state.attempt.first ??= event.created
    if (event.type === "session.text.started") state.attempt.answer ??= event.created
    return
  }

  if (event.type === "session.step.streamed") {
    state.attempt.streamed = event.created
    return
  }

  // Interrupted or failed attempts without usage would publish misleading partial numbers.
  if (!event.data.tokens || state.attempt.first === undefined || state.attempt.streamed === undefined) return
  state.attempt.tokens = event.data.tokens
  state.latest = attemptMetrics(state.attempt)
}

export function foldProviderMetrics(events: readonly ProviderMetricEvent[]) {
  const state: ProviderMetricState = {}
  events.forEach((event) => applyProviderMetricEvent(state, event))
  return state.latest
}

/**
 * Baseline from already-loaded history. Text parts carry no start timestamp yet, so TTFT, TTFA,
 * and TPS stay unavailable for text-first requests until a live request supplies them.
 */
export function projectedProviderMetrics(messages: readonly SessionMessageInfo[]): ProviderMetrics | undefined {
  const message = messages.findLast(
    (item): item is SessionMessageAssistant =>
      item.type === "assistant" && item.time.streamed !== undefined && item.tokens !== undefined,
  )
  if (!message) return
  // Content is chronological; only a non-text head carries the first-output time.
  const head = message.content[0]
  const first = head && head.type !== "text" ? head.time?.created : undefined
  // Reasoning ends when the answer starts, so a reasoning part right before the first text
  // approximates the live `session.text.started` timestamp.
  const text = message.content.findIndex((item) => item.type === "text")
  const before = text > 0 ? message.content[text - 1] : undefined
  const answer = first !== undefined && before?.type === "reasoning" ? before.time?.completed : undefined
  return attemptMetrics({
    assistantMessageID: message.id,
    started: message.time.created,
    first,
    answer,
    streamed: message.time.streamed,
    tokens: message.tokens,
  })
}

function attemptMetrics(attempt: Attempt): ProviderMetrics {
  const ttft = elapsed(attempt.started, attempt.first)
  const ttfa = elapsed(attempt.started, attempt.answer)
  const e2e = elapsed(attempt.started, attempt.streamed)
  // Output tokens exclude reasoning, so measure them from the answer start when one exists.
  const generation = elapsed(attempt.answer ?? attempt.first, attempt.streamed)
  const output = attempt.tokens?.output
  return {
    tps: generation && output && generation > 0 && output > 0 ? output / (generation / 1_000) : undefined,
    ttft,
    ttfa,
    e2e,
  }
}

function elapsed(start: number | undefined, end: number | undefined) {
  if (start === undefined || end === undefined) return
  return Math.max(0, end - start)
}
