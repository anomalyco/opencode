export * as CodeModeFetch from "./fetch.js"

import { Extension } from "@opencode/codemode"
import { isRecord } from "@opencode/util/record"
import { Effect, Schema } from "effect"
import { Permission } from "../permission.js"
import { CodeModeExecution } from "./execution.js"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
}

type Result = { response: Response; url: string; redirects: number }

const request = <A>(url: string, init: Init, read: (result: Result) => Promise<A>) =>
  Effect.gen(function* () {
    const execution = yield* CodeModeExecution.Service
    const permission = yield* Permission.Service
    const source = { type: "tool" as const, messageID: execution.messageID, id: execution.id }
    // The same rules as the webfetch tool, so a URL denied there is denied here.
    yield* permission
      .assert({
        action: "webfetch",
        resources: [url],
        save: ["*"],
        metadata: display([url, init]),
        sessionID: execution.sessionID,
        agent: execution.agent,
        source,
      })
      .pipe(
        // The feedback is the user talking to the model, so it must reach the program as the error's message.
        Effect.catchTag("Permission.CorrectedError", (error) =>
          Effect.fail(new Error(`The user rejected fetching ${url}: ${error.feedback}`)),
        ),
      )
    // Redirects are followed here so each new URL meets the same deny rules as the webfetch tool's hops.
    const check = (next: string) =>
      permission.assertNotDenied({
        action: "webfetch",
        resources: [next],
        metadata: { ...display([next, init]), redirectedFrom: url },
        sessionID: execution.sessionID,
        agent: execution.agent,
        source,
      })
    // One scope and deadline cover the entire chain, including reads after fetch resolves.
    const signal = AbortSignal.any([yield* Effect.abortSignal, AbortSignal.timeout(TIMEOUT_MS)])
    let target = url
    let current = init
    for (let redirects = 0; ; redirects++) {
      const response = yield* Effect.tryPromise({
        try: () => globalThis.fetch(target, { ...current, redirect: "manual", signal }),
        catch: (error) => error,
      })
      const location = response.headers.get("location")
      if (!redirectStatuses.has(response.status) || location === null)
        return yield* Effect.tryPromise({
          try: () => read({ response, url: target, redirects }),
          catch: (error) => error,
        })
      const body = response.body
      if (body) yield* Effect.tryPromise(() => body.cancel())
      if (redirects >= MAX_REDIRECTS)
        return yield* Effect.fail(new Error(`Too many redirects (more than ${MAX_REDIRECTS})`))
      const next = URL.parse(location, target)
      if (!next) return yield* Effect.fail(new TypeError("fetch received an invalid redirect URL"))
      if (next.protocol !== "http:" && next.protocol !== "https:")
        return yield* Effect.fail(new Error(`fetch cannot follow a redirect to ${next.protocol} URLs.`))
      if (next.username || next.password)
        return yield* Effect.fail(new Error("fetch cannot follow a redirect with credentials"))
      yield* check(next.href)
      current = redirected(current, response.status, target, next)
      target = next.href
    }
  }).pipe(Effect.scoped)

export const MAX_REDIRECTS = 20
const redirectStatuses = new Set([301, 302, 303, 307, 308])

// The request a browser sends after a redirect: 303, and 301/302 after a POST, become a GET without a body, and
// credentials are not sent to another origin.
const redirected = (request: Init, status: number, from: string, to: URL): Init => {
  const method = request.method?.toUpperCase() ?? "GET"
  const toGet = status === 303 ? method !== "HEAD" : (status === 301 || status === 302) && method === "POST"
  const headers = new Headers(request.headers)
  if (toGet)
    ["content-type", "content-length", "content-encoding", "content-language", "content-location"].forEach((name) =>
      headers.delete(name),
    )
  if (new URL(from).origin !== to.origin)
    ["authorization", "cookie", "proxy-authorization"].forEach((name) => headers.delete(name))
  return {
    method: toGet ? "GET" : request.method,
    headers: Array.from(headers),
    body: toGet ? undefined : request.body,
  }
}

const read = async (result: Result) => {
  const response = result.response
  const bytes = await response.bytes()
  const headers = Object.fromEntries(response.headers)
  const text = () => new TextDecoder().decode(bytes)
  return {
    url: result.url,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    redirected: result.redirects > 0,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in headers,
      entries: () => Object.entries(headers),
    },
    text: async () => text(),
    json: async () => JSON.parse(text()) as unknown,
    bytes: async () => bytes,
  }
}

const fetch = (input: string | URL, init: Init = {}) => {
  const parsed = URL.parse(String(input))
  if (!parsed) return Effect.fail(new TypeError(`fetch received an invalid URL: ${String(input)}`))
  if (parsed.protocol === "file:") return Effect.fail(new Error("fetch cannot be used for filesystem access."))
  return request(parsed.href, init, read)
}

export const extension = Extension.make({ name: "fetch", globals: { fetch: Extension.async(fetch) } })

const decodeInit = Schema.decodeUnknownEffect(
  Schema.Struct({
    method: Schema.optionalKey(Schema.String),
    headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    body: Schema.optionalKey(Schema.String),
  }),
  { onExcessProperty: "error" },
)

const luaFetch = Effect.fnUntraced(function* (...args: unknown[]) {
  const [input, init] = args
  if (typeof input !== "string" || args.length > 2)
    return yield* Effect.fail(new TypeError("Expected fetch(url[, init])"))
  const parsed = URL.parse(input)
  if (parsed?.protocol === "file:") return yield* Effect.fail(new Error("fetch cannot be used for filesystem access."))
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:"))
    return yield* Effect.fail(new TypeError("fetch requires an HTTP or HTTPS URL"))
  if (parsed.username || parsed.password)
    return yield* Effect.fail(new TypeError("fetch URL must not contain credentials"))
  const options = yield* decodeInit(init === undefined ? {} : init).pipe(
    Effect.mapError(
      () => new TypeError("fetch init accepts only method (string), headers (string record), and body (string)"),
    ),
  )
  return yield* request(parsed.href, options, readLua).pipe(
    // The Lua bridge exposes only own data properties of host errors, not prototype accessors.
    Effect.mapError((error) => (error instanceof Permission.BlockedError ? new Error(error.message) : error)),
  )
})

const MAX_BODY_BYTES = 1024 * 1024

async function readLua({ response, url, redirects }: Result) {
  const decoder = new TextDecoder()
  let size = 0
  let body = ""
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) throw new RangeError("fetch response body exceeds 1 MiB")
      body += decoder.decode(chunk, { stream: true })
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    url,
    redirected: redirects > 0,
    headers: Object.fromEntries(response.headers),
    body: body + decoder.decode(),
  }
}

export const luaExtension = Extension.lua({ name: "fetch", globals: { fetch: luaFetch } })

/** What to show for a fetch call: its method and URL. */
export const display = (args: ReadonlyArray<unknown>) => {
  const [input, init] = args
  const method = isRecord(init) && typeof init.method === "string" ? init.method.toUpperCase() : "GET"
  return { method, url: String(input) }
}
