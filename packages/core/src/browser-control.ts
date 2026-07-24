export * as BrowserControl from "./browser-control"

export const VERSION = 2 as const

export type State = {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly generation: number
}

export type Command =
  | { readonly type: "status" }
  | { readonly type: "navigate"; readonly url: string; readonly generation: number }
  | { readonly type: "snapshot"; readonly generation: number }
  | { readonly type: "click"; readonly ref: string; readonly generation: number }
  | { readonly type: "fill"; readonly ref: string; readonly text: string; readonly generation: number }
  | {
      readonly type: "press"
      readonly generation: number
      readonly key:
        | "Enter"
        | "Tab"
        | "Escape"
        | "Backspace"
        | "Delete"
        | "ArrowUp"
        | "ArrowDown"
        | "ArrowLeft"
        | "ArrowRight"
        | "PageUp"
        | "PageDown"
        | "Home"
        | "End"
        | "Space"
    }
  | {
      readonly type: "scroll"
      readonly direction: "up" | "down" | "left" | "right"
      readonly amount: number
      readonly generation: number
    }
  | { readonly type: "screenshot"; readonly generation: number }

export type Result =
  | { readonly type: "status"; readonly attached: false }
  | { readonly type: "status"; readonly attached: true; readonly lease: string; readonly state: State }
  | { readonly type: "snapshot"; readonly state: State; readonly content: string }
  | { readonly type: "action"; readonly state: State }
  | {
      readonly type: "screenshot"
      readonly state: State
      readonly data: string
      readonly width: number
      readonly height: number
    }

export type Request = {
  readonly type: "desktop.browser.request"
  readonly version: typeof VERSION
  readonly requestID: string
  readonly sessionID: string
  readonly lease?: string
  readonly command: Command
}

export type Cancel = {
  readonly type: "desktop.browser.cancel"
  readonly version: typeof VERSION
  readonly requestID: string
}

export const ERROR_CODES = [
  "not_attached",
  "stale_ref",
  "invalid_url",
  "navigation_failed",
  "timeout",
  "aborted",
  "page_crashed",
  "result_too_large",
  "protocol",
  "internal",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type Response = {
  readonly type: "desktop.browser.response"
  readonly version: typeof VERSION
  readonly requestID: string
  readonly result?: Result
  readonly error?: {
    readonly code: ErrorCode
    readonly message: string
    readonly retryable: boolean
  }
}

/** Transport-neutral request operation implemented by desktop IPC today and server adapters later. */
export interface Interface {
  readonly request: (input: Request, signal: AbortSignal) => Promise<unknown>
}

export function isRequest(input: unknown): input is Request {
  if (!record(input)) return false
  if (input.type !== "desktop.browser.request" || input.version !== VERSION) return false
  if (typeof input.requestID !== "string" || typeof input.sessionID !== "string") return false
  if (input.lease !== undefined && typeof input.lease !== "string") return false
  if (!command(input.command)) return false
  return input.command.type === "status" || typeof input.lease === "string"
}

export function isCancel(input: unknown): input is Cancel {
  if (!record(input)) return false
  return input.type === "desktop.browser.cancel" && input.version === VERSION && typeof input.requestID === "string"
}

export function isResponse(input: unknown): input is Response {
  if (!record(input)) return false
  if (input.type !== "desktop.browser.response" || input.version !== VERSION || typeof input.requestID !== "string") {
    return false
  }
  if ((input.result === undefined) === (input.error === undefined)) return false
  if (input.error !== undefined) {
    if (!record(input.error)) return false
    if (!oneOf(ERROR_CODES, input.error.code) || typeof input.error.message !== "string") return false
    if (typeof input.error.retryable !== "boolean") return false
  }
  return input.result === undefined || result(input.result)
}

export function normalizeURL(input: string) {
  const value = input.trim()
  if (!value) return "about:blank"
  if (value === "about:blank") return value
  const candidate = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?(?:\/|$)/i.test(value)
    ? `http://${value}`
    : /^[a-z][a-z\d+.-]*:/i.test(value)
      ? value
      : `https://${value}`
  if (!URL.canParse(candidate)) throw new Error("Enter a valid HTTP or HTTPS URL")
  const url = new URL(candidate)
  if (!allowedURL(url.href)) throw new Error("Only HTTP, HTTPS, and file URLs without credentials are supported")
  return url.href
}

export function allowedURL(input: string) {
  if (input === "about:blank") return true
  if (!URL.canParse(input)) return false
  const url = new URL(input)
  return (
    (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:") &&
    !url.username &&
    !url.password
  )
}

export function normalizeRef(input: string) {
  const value = input.trim()
  return value.startsWith("@") ? value : `@${value}`
}

function command(input: unknown): input is Command {
  if (!record(input) || typeof input.type !== "string") return false
  if (input.type === "status") return true
  if (input.type === "snapshot" || input.type === "screenshot") return finite(input.generation)
  if (input.type === "navigate") return typeof input.url === "string" && finite(input.generation)
  if (input.type === "click") return typeof input.ref === "string" && finite(input.generation)
  if (input.type === "fill") {
    return typeof input.ref === "string" && typeof input.text === "string" && finite(input.generation)
  }
  if (input.type === "press") return oneOf(PRESS_KEYS, input.key) && finite(input.generation)
  if (input.type === "scroll") {
    return oneOf(SCROLL_DIRECTIONS, input.direction) && finite(input.amount) && finite(input.generation)
  }
  return false
}

function result(input: unknown): input is Result {
  if (!record(input) || typeof input.type !== "string") return false
  if (input.type === "status") {
    if (input.attached === false) return input.lease === undefined && input.state === undefined
    return input.attached === true && typeof input.lease === "string" && state(input.state)
  }
  if (input.type === "snapshot") return state(input.state) && typeof input.content === "string"
  if (input.type === "action") return state(input.state)
  if (input.type === "screenshot") {
    return state(input.state) && typeof input.data === "string" && finite(input.width) && finite(input.height)
  }
  return false
}

function state(input: unknown): input is State {
  if (!record(input)) return false
  return (
    typeof input.url === "string" &&
    typeof input.title === "string" &&
    typeof input.loading === "boolean" &&
    typeof input.canGoBack === "boolean" &&
    typeof input.canGoForward === "boolean" &&
    finite(input.generation)
  )
}

const PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Space",
] as const
const SCROLL_DIRECTIONS = ["up", "down", "left", "right"] as const

function finite(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input)
}

function oneOf<const Values extends readonly string[]>(values: Values, input: unknown): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input)
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
