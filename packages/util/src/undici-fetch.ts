export * as UndiciFetch from "./undici-fetch.js"

import { create } from "#undici-fetch"

export { create }

let value: ReturnType<typeof create>
let loaded = false

/** One process-wide fetch, so every request shares the Agent's connection pool. Resolved on first use, not at import. */
export function shared() {
  if (loaded) return value
  loaded = true
  value = create()
  return value
}
