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
    // The same rules as the webfetch tool, so a URL denied there is denied here.
    yield* permission
      .assert({
        action: "webfetch",
        resources: [url],
        save: ["*"],
        metadata: display([input, init]),
        sessionID: execution.sessionID,
        agent: execution.agent,
        source: { type: "tool", messageID: execution.messageID, id: execution.id },
      })
      .pipe(
        // The feedback is the user talking to the model, so it must reach the program as the error's message.
        Effect.catchTag("Permission.CorrectedError", (error) =>
          Effect.fail(new Error(`The user rejected fetching ${url}: ${error.feedback}`)),
        ),
      )
    return yield* Effect.tryPromise({ try: () => send(input, init), catch: (error) => error })
  })

const send = async (input: string | URL, init: Init) => {
  const response = await globalThis.fetch(input, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const bytes = await response.bytes()
  const headers = Object.fromEntries(response.headers)
  const text = () => new TextDecoder().decode(bytes)
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    redirected: response.redirected,
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
