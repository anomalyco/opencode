export * as CodeModeWeb from "./web.js"

import { Extension } from "@opencode/codemode"

const TIMEOUT_MS = 30_000

type Init = {
  readonly method?: string
  readonly headers?: Record<string, string> | Array<[string, string]>
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
}

const fetch = async (input: string | URL, init: Init = {}) => {
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

export const extension = Extension.make({ name: "web", globals: { fetch } })
