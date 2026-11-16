export * as SessionTurn from "./session-turn.js"

/** The fields of a session message that turn measurements read. Client session messages satisfy it as they are. */
export interface Message {
  readonly id: string
  readonly type: string
  readonly time: {
    readonly created: number
    /** When the provider streamed the first output token; steps recorded before this existed leave it unset. */
    readonly firstToken?: number
    readonly streamed?: number
    readonly completed?: number
  }
  readonly tokens?: { readonly output: number; readonly reasoning: number }
}

export interface Options {
  /** The position of `message` in `messages`. Reactive callers should pass it so the lookup does not read every message. */
  readonly index?: number
  /**
   * Whether the session has no idle markers, so a turn ends at the next prompt. Reactive callers should pass it from a
   * shared memo: the default scans every message, which subscribes the caller to the whole history.
   */
  readonly legacy?: boolean
}

/** Milliseconds from the prompt that started the turn until `message` completed, or 0 while it runs. */
export function duration(messages: readonly Message[], message: Message, options: Options = {}) {
  if (message.time.completed === undefined) return 0
  const index = options.index ?? messages.findIndex((item) => item.id === message.id)
  const input =
    messages[inputIndex(messages, index === -1 ? messages.length : index, options.legacy ?? legacy(messages))]
  return Math.max(0, message.time.completed - (input?.time.created ?? message.time.created))
}

/**
 * The fastest rate a step's first-token window is trusted to show. Providers can generate tokens before their first
 * output event, such as hidden reasoning or a buffered tool call, and then deliver them in a burst; dividing those
 * tokens by the burst alone reports rates no provider decodes at.
 */
const MAX_DECODE_TOKENS_PER_SECOND = 3_000

/**
 * Output and reasoning tokens per second while the provider streamed them, or undefined until every step has streamed.
 *
 * Each step counts from its first streamed token to the end of the response body, so the wait for that first token
 * (time to first token) is not divided into the output rate. A step whose tokens could not have been decoded in that
 * window, and steps recorded before `time.firstToken` existed, count from request dispatch instead.
 */
export function tokensPerSecond(messages: readonly Message[], message: Message, options: Options = {}) {
  const steps = turnSteps(messages, message, options)
  const durations = steps.flatMap((step) => {
    if (step.time.streamed === undefined) return []
    const request = Math.max(0, step.time.streamed - step.time.created)
    if (step.time.firstToken === undefined) return [request]
    const decode = Math.max(0, step.time.streamed - step.time.firstToken)
    return [stepTokens(step) > (decode / 1_000) * MAX_DECODE_TOKENS_PER_SECOND ? request : decode]
  })
  if (steps.length === 0 || durations.length !== steps.length) return
  const output = steps.reduce((total, step) => total + stepTokens(step), 0)
  const total = durations.reduce((sum, value) => sum + value, 0)
  if (output <= 0 || total <= 0) return
  // Aggregate before dividing so each step is weighted by its provider-active duration.
  return output / (total / 1_000)
}

function stepTokens(step: Message) {
  return (step.tokens?.output ?? 0) + (step.tokens?.reasoning ?? 0)
}

export function legacy(messages: readonly Message[]) {
  return !messages.some((message) => message.type === "idle")
}

function turnSteps(messages: readonly Message[], message: Message, options: Options) {
  const index = options.index ?? messages.findIndex((item) => item.id === message.id)
  const end = index === -1 ? messages.length : index + 1
  const start = inputIndex(messages, end, options.legacy ?? legacy(messages))
  return messages.slice(start + 1, end).filter((item) => item.type === "assistant")
}

function inputIndex(messages: readonly Message[], end: number, legacy: boolean) {
  // Reading a sliced prefix subscribes every caller to unrelated historical messages, so walk
  // back only as far as the turn boundary: the nearest input in legacy sessions, otherwise the
  // first input after the previous idle marker.
  let input = -1
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === "idle") return input
    if (message.type !== "user" && message.type !== "synthetic") continue
    if (legacy) return index
    input = index
  }
  return input
}
