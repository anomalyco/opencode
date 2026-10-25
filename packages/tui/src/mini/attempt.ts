/**
 * `bolt run --timeout <seconds> --retries <n>`: bound how long a headless run
 * may take and how often it is retried. A timed-out attempt aborts the
 * session and captures whatever partial result already streamed; a failed or
 * timed-out attempt is retried while the attempt budget lasts.
 */

export interface Settings {
  /** Seconds one attempt may take, undefined for no limit. */
  timeout?: number
  /** Additional attempts after the first, defaults to 0. */
  retries?: number
}

/** Validation error for the flag pair, or undefined when usable. */
export function invalid(settings: Settings) {
  if (settings.timeout !== undefined && !(settings.timeout > 0)) {
    return "--timeout must be a positive number of seconds"
  }
  if (settings.retries !== undefined && (!Number.isInteger(settings.retries) || settings.retries < 0)) {
    return "--retries must be a non-negative integer"
  }
  return undefined
}

/** Total attempt budget: the initial attempt plus every retry. */
export function attempts(settings: Settings) {
  return (settings.retries ?? 0) + 1
}

/** Whether another attempt should run after a failure or timeout. */
export function again(attempt: number, settings: Settings) {
  return attempt < attempts(settings)
}

interface Part {
  type: string
  text?: string
}

interface Message {
  info: { role: string }
  parts: Part[]
}

/**
 * Partial result captured when an attempt times out: every text part the
 * assistant produced so far, newest message last. Unfinished parts count;
 * a timed-out run should surface everything it paid for.
 */
export function partial(messages: Message[]): string {
  return messages
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" && part.text?.trim() ? [part.text.trim()] : []))
    .join("\n\n")
}

/** One-line status for a timed-out attempt. */
export function report(attempt: number, settings: Settings) {
  const position = attempts(settings) > 1 ? ` (attempt ${attempt}/${attempts(settings)})` : ""
  return `run timed out after ${settings.timeout}s${position}`
}

export * as Attempt from "./attempt"
