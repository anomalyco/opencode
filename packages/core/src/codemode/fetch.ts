export * as CodeModeFetch from "./fetch.js"

import { Extension } from "@opencode/codemode"
import { isRecord } from "@opencode/util/record"
import { Effect } from "effect"
import { Permission } from "../permission.js"
import { CodeModeExecution } from "./execution.js"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
}

const fetch = (input: string | URL, init: Init = {}) =>
  Effect.gen(function* () {
    const url = String(input)
    if (URL.parse(url)?.protocol === "file:")
      return yield* Effect.fail(new Error("fetch cannot be used for filesystem access."))
    const execution = yield* CodeModeExecution.Service
    const permission = yield* Permission.Service
    const source = { type: "tool" as const, messageID: execution.messageID, id: execution.id }
    // The same rules as the webfetch tool, so a URL denied there is denied here.
    yield* permission
      .assert({
        action: "webfetch",
        resources: [url],
        save: ["*"],
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
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    const follow = (
      target: string,
      request: Init,
      redirects: number,
    ): Effect.Effect<{ response: Response; url: string; redirects: number }, unknown> =>
      Effect.tryPromise({
        try: () => globalThis.fetch(target, { ...request, redirect: "manual", signal }),
        catch: (error) => error,
      }).pipe(
        Effect.flatMap((response) => {
          const location = response.headers.get("location")
          if (!redirectStatuses.has(response.status) || location === null)
            return Effect.succeed({ response, url: target, redirects })
          if (redirects >= MAX_REDIRECTS)
            return Effect.fail(new Error(`Too many redirects (more than ${MAX_REDIRECTS})`))
          const next = new URL(location, target)
          if (next.protocol !== "http:" && next.protocol !== "https:")
            return Effect.fail(new Error(`fetch cannot follow a redirect to ${next.protocol} URLs.`))
          return check(next.href).pipe(
            Effect.andThen(follow(next.href, redirected(request, response.status, target, next), redirects + 1)),
          )
        }),
      )
    const result = yield* follow(url, init, 0)
    return yield* Effect.tryPromise({ try: () => read(result), catch: (error) => error })
  })

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

const read = async (result: { response: Response; url: string; redirects: number }) => {
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

export const extension = Extension.make({ name: "fetch", globals: { fetch: Extension.async(fetch) } })

/** What to show for a fetch call: its method and URL. */
export const display = (args: ReadonlyArray<unknown>) => {
  const [input, init] = args
  const method = isRecord(init) && typeof init.method === "string" ? init.method.toUpperCase() : "GET"
  return { method, url: String(input) }
}
