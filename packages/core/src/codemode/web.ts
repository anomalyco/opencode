export * as CodeModeWeb from "./web.js"

import { Extension } from "@opencode/codemode"
import { Effect } from "effect"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { FileAccess } from "../file-access.js"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
}

const fetch = async (
  input: string | URL,
  init: Init,
  access: Pick<FileAccess.Interface, "authorizeRead">,
  context: FileAccess.Invocation,
  signal: AbortSignal,
) => {
  const url = new URL(input)
  const target =
    url.protocol === "file:"
      ? pathToFileURL((await Effect.runPromise(access.authorizeRead(fileURLToPath(url), context), { signal })).absolute)
      : url
  signal.throwIfAborted()
  const response = await globalThis.fetch(target, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
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

export const extension = (
  access: Pick<FileAccess.Interface, "authorizeRead">,
  context: FileAccess.Invocation,
  signal: AbortSignal,
) =>
  Extension.make({
    name: "web",
    globals: { fetch: (input: string | URL, init: Init = {}) => fetch(input, init, access, context, signal) },
  })

/** What to show for a fetch call: its method and URL. */
export const display = (args: ReadonlyArray<unknown>) => {
  const [input, init] = args as [string | URL, Init | undefined]
  return { method: init?.method?.toUpperCase() ?? "GET", url: String(input) }
}
