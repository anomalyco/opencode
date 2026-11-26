export * as CodeModeFetch from "./fetch.js"

import { Extension } from "@opencode/codemode"
import { isRecord } from "@opencode/util/record"
import { Effect, Option } from "effect"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import { CodeModeApi } from "./api.js"
import { CodeModeBun } from "./bun.js"
import { CodeModeExecution } from "./execution.js"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams | Blob
}

const fetch = (input: string | URL, given: Init = {}) =>
  Effect.gen(function* () {
    // A BunFile reaches here as a plain copy, which `globalThis.fetch` would send as "[object Object]", as it would any
    // other object, such as a response or its stream.
    // Only these options reach the request, so one such as Bun's `proxy` or `unix` can't send it past the checks below.
    const init: Init = { method: given.method, headers: given.headers, body: yield* CodeModeBun.body(given.body) }
    if (
      typeof init.body === "object" &&
      init.body !== null &&
      !(init.body instanceof Uint8Array) &&
      !(init.body instanceof URLSearchParams) &&
      !(init.body instanceof Blob)
    )
      return yield* Effect.fail(
        new TypeError("A fetch body must be a string, a Uint8Array, URLSearchParams, or a file from Bun.file()."),
      )
    // Rules match the URL as written. The fragment is never sent, and would keep a rule for the exact URL from
    // matching.
    const url = String(input).split("#")[0]
    const parsed = URL.parse(url)
    if (parsed?.protocol === "file:")
      return yield* Effect.fail(new Error("fetch cannot be used for filesystem access."))
    // Rules match the URL, so `https://user@evil.com` would slip past a rule for `https://evil.com/*`.
    if (parsed?.username || parsed?.password)
      return yield* Effect.fail(new TypeError("fetch cannot be used with credentials in the URL."))
    if (parsed?.protocol === "opencode:") return yield* fetchOpencode(url, init)
    const execution = yield* CodeModeExecution.Service
    const permission = yield* Permission.Service
    const source = { type: "tool" as const, messageID: execution.messageID, id: execution.id }
    // The same rules as the webfetch tool, so a URL denied there is denied here.
    yield* permission
      .assert({
        action: "webfetch",
        // The URL as written and as requested, so rules for either apply.
        resources: [...new Set([url, parsed?.href ?? url])],
        save: Permission.site(url),
        metadata: display([input, init]),
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
    const signal = AbortSignal.any([execution.signal, AbortSignal.timeout(TIMEOUT_MS)])
    let target = url
    let request = init
    for (let redirects = 0; ; redirects++) {
      const response = yield* Effect.tryPromise({
        try: () => globalThis.fetch(target, { ...request, redirect: "manual", signal }),
        catch: (error) => error,
      })
      const location = response.headers.get("location")
      if (!redirectStatuses.has(response.status) || location === null)
        return new Extension.StreamingResponse(response, redirects > 0)
      yield* Effect.tryPromise({ try: async () => response.body?.cancel(), catch: (error) => error })
      if (redirects >= MAX_REDIRECTS)
        return yield* Effect.fail(new Error(`Too many redirects (more than ${MAX_REDIRECTS})`))
      const next = new URL(location, target)
      if (next.protocol !== "http:" && next.protocol !== "https:")
        return yield* Effect.fail(new Error(`fetch cannot follow a redirect to ${next.protocol} URLs.`))
      if (next.username || next.password)
        return yield* Effect.fail(new Error("fetch cannot follow a redirect with credentials in the URL."))
      next.hash = ""
      yield* check(next.href)
      request = redirected(request, response.status, target, next)
      target = next.href
    }
  })

export const MAX_REDIRECTS = 20
const redirectStatuses = new Set([301, 302, 303, 307, 308])

// No timeout: the request runs in this process and ends with the execute call.
const fetchOpencode = (url: string, init: Init) =>
  Effect.gen(function* () {
    const execution = yield* CodeModeExecution.Service
    const permission = yield* Permission.Service
    const path = yield* CodeModeApi.path(url, execution.sessionID)
    const api = Option.getOrElse(yield* Effect.serviceOption(CodeModeApi.Service), () => CodeModeApi.unavailable)
    const method = (init.method ?? "GET").toUpperCase()
    const source = { type: "tool" as const, messageID: execution.messageID, id: execution.id }
    // The call is checked as the `opencode api` command that would make it, so shell rules for that command cover it
    // too, and saving approval saves what the shell tool saves for it.
    yield* permission
      .assert({
        action: "shell",
        resources: [`opencode api ${method.toLowerCase()} ${path}`],
        save: ["opencode *"],
        metadata: display([url, init]),
        sessionID: execution.sessionID,
        agent: execution.agent,
        source,
      })
      .pipe(
        Effect.catchTag("Permission.CorrectedError", (error) =>
          Effect.fail(new Error(`The user rejected fetching ${url}: ${error.feedback}`)),
        ),
      )
    const headers = new Headers(init.headers)
    // Without a directory the server would answer for its own default Location, not the session's.
    const location = yield* Effect.serviceOption(Location.Service)
    if (Option.isSome(location) && !headers.has("x-opencode-directory") && !path.includes("location[directory]="))
      headers.set("x-opencode-directory", encodeURIComponent(location.value.directory))
    const response = yield* api.fetch(
      new Request(new URL(path, "http://opencode.local").href, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : init.body,
        signal: execution.signal,
      }),
    )
    return new Extension.StreamingResponse(response, false)
  })

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

export const extension = Extension.make({ name: "fetch", globals: { fetch: Extension.async(fetch) } })

/** What to show for a fetch call: its method and URL. */
export const display = (args: ReadonlyArray<unknown>) => {
  const [input, init] = args
  const method = isRecord(init) && typeof init.method === "string" ? init.method.toUpperCase() : "GET"
  return { method, url: String(input) }
}
