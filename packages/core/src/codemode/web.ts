export * as CodeModeWeb from "./web.js"

import { Extension } from "@opencode/codemode"
import { Effect } from "effect"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
}

/** Runs before the request leaves the process, so a failure keeps it off the network entirely. */
type Guard = (url: string) => Effect.Effect<void, unknown>

const fetch = (guard: Guard, signal: AbortSignal | undefined) =>
  async function fetch(input: string | URL, init: Init = {}) {
    if (URL.parse(String(input))?.protocol === "file:")
      throw new Error("fetch cannot be used for filesystem access.")
    // The signal is the Code Mode call's lifetime, so interrupting the call also interrupts a
    // permission prompt that is still waiting for an answer.
    await Effect.runPromise(guard(String(input)), { signal })
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

export const extension = (guard: Guard = () => Effect.void, lifetime?: AbortSignal) =>
  Extension.make({ name: "web", globals: { fetch: fetch(guard, lifetime) } })

/** What to show for a fetch call: its method and URL. */
export const display = (args: ReadonlyArray<unknown>) => {
  const [input, init] = args as [string | URL, Init | undefined]
  return { method: init?.method?.toUpperCase() ?? "GET", url: String(input) }
}
