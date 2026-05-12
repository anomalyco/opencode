import { Option } from "effect"
import { decodeJson } from "./matching"
import { redactHeaders, redactUrl } from "./redaction"
import type { RequestSnapshot, ResponseSnapshot } from "./schema"

export const DEFAULT_REQUEST_HEADERS: ReadonlyArray<string> = ["content-type", "accept", "openai-beta"]
export const DEFAULT_RESPONSE_HEADERS: ReadonlyArray<string> = ["content-type"]

const identity = <T>(value: T) => value

export interface Redactor {
  readonly request: (snapshot: RequestSnapshot) => RequestSnapshot
  readonly response: (snapshot: ResponseSnapshot) => ResponseSnapshot
}

export const compose = (...redactors: ReadonlyArray<Partial<Redactor>>): Redactor => {
  const requests = redactors.map((r) => r.request).filter((fn): fn is Redactor["request"] => fn !== undefined)
  const responses = redactors.map((r) => r.response).filter((fn): fn is Redactor["response"] => fn !== undefined)
  return {
    request: requests.length === 0 ? identity : (snapshot) => requests.reduce((acc, fn) => fn(acc), snapshot),
    response: responses.length === 0 ? identity : (snapshot) => responses.reduce((acc, fn) => fn(acc), snapshot),
  }
}

export interface HeaderOptions {
  readonly allow?: ReadonlyArray<string>
  readonly redact?: ReadonlyArray<string>
}

export const requestHeaders = (options: HeaderOptions = {}): Partial<Redactor> => ({
  request: (snapshot) => ({
    ...snapshot,
    headers: redactHeaders(snapshot.headers, options.allow ?? DEFAULT_REQUEST_HEADERS, options.redact),
  }),
})

export const responseHeaders = (options: HeaderOptions = {}): Partial<Redactor> => ({
  response: (snapshot) => ({
    ...snapshot,
    headers: redactHeaders(snapshot.headers, options.allow ?? DEFAULT_RESPONSE_HEADERS, options.redact),
  }),
})

export interface UrlOptions {
  readonly query?: ReadonlyArray<string>
  readonly transform?: (url: string) => string
}

export const url = (options: UrlOptions = {}): Partial<Redactor> => ({
  request: (snapshot) => ({ ...snapshot, url: redactUrl(snapshot.url, options.query, options.transform) }),
})

export const body = (transform: (parsed: unknown) => unknown): Partial<Redactor> => ({
  request: (snapshot) => ({
    ...snapshot,
    body: Option.match(decodeJson(snapshot.body), {
      onNone: () => snapshot.body,
      onSome: (parsed) => JSON.stringify(transform(parsed)),
    }),
  }),
})

export interface DefaultRedactorOverrides {
  readonly requestHeaders?: HeaderOptions
  readonly responseHeaders?: HeaderOptions
  readonly url?: UrlOptions
  readonly body?: (parsed: unknown) => unknown
}

export const defaults = (overrides: DefaultRedactorOverrides = {}): Redactor =>
  compose(
    requestHeaders(overrides.requestHeaders),
    responseHeaders(overrides.responseHeaders),
    url(overrides.url),
    ...(overrides.body ? [body(overrides.body)] : []),
  )
