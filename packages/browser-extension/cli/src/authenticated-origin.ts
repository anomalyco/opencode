import { Effect, Match, Schema } from "effect"
import type { Page } from "patchright-core"
import {
  AuthenticatedJsonOutcome,
  type AuthenticatedJsonMethod,
  type AuthenticatedJsonRequest,
} from "./relay-schema.ts"

const defaultTimeoutMs = 30_000
const defaultMaxResponseBytes = 2_000_000

export class AuthenticatedOriginError extends Schema.TaggedError<AuthenticatedOriginError>()(
  "AuthenticatedOrigin.Error",
  {
    message: Schema.String,
    reason: Schema.Literals(["invalid-request", "page-failed"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

type RequestOptions = Omit<AuthenticatedJsonRequest, "sessionId">

type PageRequestInput = {
  readonly origin: string
  readonly method: AuthenticatedJsonMethod
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly timeoutMs: number
  readonly maxResponseBytes: number
}

export const requestJson = Effect.fn("AuthenticatedOrigin.requestJson")(function* (
  page: Page,
  request: RequestOptions,
) {
  const target = yield* Effect.try({
    try: () => {
      const origin = normalizeOrigin(request.origin)
      return {
        origin,
        requestUrl: resolveRequestUrl(origin, request.path),
        startUrl: request.startUrl === undefined ? undefined : resolveStartUrl(origin, request.startUrl),
      }
    },
    catch: (cause) => cause instanceof AuthenticatedOriginError
      ? cause
      : new AuthenticatedOriginError({
          message: "Invalid authenticated origin request",
          reason: "invalid-request",
          cause,
        }),
  })
  const { origin, requestUrl, startUrl } = target

  if (pageOrigin(page.url()) !== origin && startUrl !== undefined) {
    yield* Effect.tryPromise({
      try: () => page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: request.timeoutMs ?? defaultTimeoutMs }),
      catch: (cause) => new AuthenticatedOriginError({
        message: cause instanceof Error ? cause.message : "Navigate to authenticated origin",
        reason: "page-failed",
        cause,
      }),
    })
  }

  const actualOrigin = pageOrigin(page.url())
  if (actualOrigin !== origin) {
    return AuthenticatedJsonOutcome.cases.OriginMismatch.make({
      expectedOrigin: origin,
      actualOrigin,
    })
  }

  const input: PageRequestInput = {
    origin,
    method: request.method,
    url: requestUrl,
    ...(request.headers === undefined ? {} : { headers: request.headers }),
    ...(request.body === undefined ? {} : { body: request.body }),
    timeoutMs: request.timeoutMs ?? defaultTimeoutMs,
    maxResponseBytes: request.maxResponseBytes ?? defaultMaxResponseBytes,
  }

  const pageResult = yield* Effect.tryPromise({
    try: () => page.evaluate(runPageRequest, input),
    catch: (cause) => new AuthenticatedOriginError({
      message: cause instanceof Error ? cause.message : "Run authenticated page request",
      reason: "page-failed",
      cause,
    }),
  }).pipe(Effect.uninterruptible)

  return Match.value(pageResult).pipe(
    Match.when({ kind: "OriginMismatch" }, ({ expectedOrigin, actualOrigin }) =>
      AuthenticatedJsonOutcome.cases.OriginMismatch.make({ expectedOrigin, actualOrigin })),
    Match.when({ kind: "HttpError" }, ({ status }) =>
      AuthenticatedJsonOutcome.cases.HttpError.make({ status })),
    Match.when({ kind: "ResponseTooLarge" }, ({ status, maxResponseBytes }) =>
      AuthenticatedJsonOutcome.cases.ResponseTooLarge.make({ status, maxResponseBytes })),
    Match.when({ kind: "Success" }, ({ status, value }) =>
      AuthenticatedJsonOutcome.cases.Success.make({ status, value })),
    Match.when({ kind: "InvalidJson" }, ({ status }) =>
      AuthenticatedJsonOutcome.cases.InvalidJson.make({ status })),
    Match.when({ kind: "RequestFailed" }, ({ outcome }) =>
      AuthenticatedJsonOutcome.cases.RequestFailed.make({ outcome })),
    Match.exhaustive,
  )
})

export function normalizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new AuthenticatedOriginError({
      message: `Invalid authenticated origin: ${value}`,
      reason: "invalid-request",
      cause,
    })
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new AuthenticatedOriginError({
      message: `Authenticated origin must be an HTTP(S) origin without credentials: ${value}`,
      reason: "invalid-request",
    })
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new AuthenticatedOriginError({
      message: `Authenticated origin must not include a path, query, or fragment: ${value}`,
      reason: "invalid-request",
    })
  }
  return url.origin
}

function resolveRequestUrl(origin: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new AuthenticatedOriginError({
      message: "Authenticated request path must start with one slash",
      reason: "invalid-request",
    })
  }
  const url = new URL(path, origin)
  if (url.origin !== origin) {
    throw new AuthenticatedOriginError({
      message: `Authenticated request escaped its declared origin: ${path}`,
      reason: "invalid-request",
    })
  }
  return url.toString()
}

export function resolveStartUrl(origin: string, value: string): string {
  const url = new URL(value, origin)
  if (url.origin !== origin) {
    throw new AuthenticatedOriginError({
      message: `Authenticated origin startUrl must stay on ${origin}`,
      reason: "invalid-request",
    })
  }
  return url.toString()
}

function pageOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return "null"
  }
}

type PageRequestResult =
  | { readonly kind: "OriginMismatch"; readonly expectedOrigin: string; readonly actualOrigin: string }
  | { readonly kind: "HttpError"; readonly status: number }
  | { readonly kind: "ResponseTooLarge"; readonly status: number; readonly maxResponseBytes: number }
  | { readonly kind: "Success"; readonly status: number; readonly value: Schema.Schema.Type<typeof Schema.Json> }
  | { readonly kind: "InvalidJson"; readonly status: number }
  | { readonly kind: "RequestFailed"; readonly outcome: "not-sent" | "unknown" }

async function runPageRequest(input: PageRequestInput): Promise<PageRequestResult> {
  if (window.location.origin !== input.origin) {
    return {
      kind: "OriginMismatch",
      expectedOrigin: input.origin,
      actualOrigin: window.location.origin,
    }
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), input.timeoutMs)
  let requestStarted = false
  try {
    const body = input.body === undefined ? undefined : JSON.stringify(input.body)
    const headers: Record<string, string> = {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.headers ?? {}),
    }
    requestStarted = true
    const response = await window.fetch(input.url, {
      method: input.method,
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      signal: controller.signal,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body === undefined ? {} : { body }),
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return { kind: "HttpError", status: response.status }
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let byteCount = 0
    let text = ""
    if (reader) {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        byteCount += chunk.value.byteLength
        if (byteCount > input.maxResponseBytes) {
          await reader.cancel().catch(() => undefined)
          return {
            kind: "ResponseTooLarge",
            status: response.status,
            maxResponseBytes: input.maxResponseBytes,
          }
        }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
    }

    try {
      return {
        kind: "Success",
        status: response.status,
        value: text ? JSON.parse(text) : null,
      }
    } catch {
      return { kind: "InvalidJson", status: response.status }
    }
  } catch {
    return {
      kind: "RequestFailed",
      outcome: requestStarted ? "unknown" : "not-sent",
    }
  } finally {
    window.clearTimeout(timeout)
  }
}
