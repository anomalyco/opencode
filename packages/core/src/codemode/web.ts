export * as CodeModeWeb from "./web.js"

import { Extension } from "@opencode/codemode"
import { isRecord } from "@opencode/util/record"
import { Effect } from "effect"
import { CodeModeRun } from "./run.js"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
}

const fetch = (input: string | URL, init: Init = {}) =>
  Effect.gen(function* () {
    if (URL.parse(String(input))?.protocol === "file:")
      return yield* Effect.fail(new Error("fetch cannot be used for filesystem access."))
    const run = yield* CodeModeRun.Service
    // Shares the webfetch permission, so one rule governs both.
    yield* run.permission.assert({
      action: "webfetch",
      resources: [String(input)],
      save: ["*"],
      metadata: display([input, init]),
      sessionID: run.context.sessionID,
      agent: run.context.agent,
      source: { type: "tool", messageID: run.context.messageID, id: run.context.id },
    })
    const { response, bytes } = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await globalThis.fetch(input, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        })
        return { response, bytes: await response.bytes() }
      },
      catch: (error) => error,
    })
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
  })

export const extension = Extension.make({ name: "web", globals: { fetch } })

/** What to show and ask permission for on a fetch call: its method and URL. */
export const display = (args: ReadonlyArray<unknown>) => {
  const [input, init] = args
  const method = isRecord(init) && typeof init.method === "string" ? init.method.toUpperCase() : "GET"
  return { method, url: String(input) }
}
