export * as SessionTurn from "./session-turn.js"

/** The fields of a session message that turn measurements read. Client session messages satisfy it as they are. */
export interface Message {
  readonly id: string
  readonly type: string
  readonly time: { readonly created: number; readonly streamed?: number; readonly completed?: number }
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

/** Output and reasoning tokens per second across the turn's steps up to `message`, or undefined until every step has streamed. */
export function tokensPerSecond(messages: readonly Message[], message: Message, options: Options = {}) {
  const index = options.index ?? messages.findIndex((item) => item.id === message.id)
  const end = index === -1 ? messages.length : index + 1
  const start = inputIndex(messages, end, options.legacy ?? legacy(messages))
  const steps = messages.slice(start + 1, end).filter((item) => item.type === "assistant")
  const durations = steps.flatMap((step) =>
    step.time.streamed === undefined ? [] : [Math.max(0, step.time.streamed - step.time.created)],
  )
  if (steps.length === 0 || durations.length !== steps.length) return
  const output = steps.reduce((total, step) => total + (step.tokens?.output ?? 0) + (step.tokens?.reasoning ?? 0), 0)
  const total = durations.reduce((sum, value) => sum + value, 0)
  if (output <= 0 || total <= 0) return
  // Aggregate before dividing so each step is weighted by its provider-active duration.
  return output / (total / 1_000)
}

export function legacy(messages: readonly Message[]) {
  return !messages.some((message) => message.type === "idle")
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
