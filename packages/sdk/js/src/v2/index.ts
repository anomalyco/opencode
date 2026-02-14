export * from "./client.js"
export * from "./server.js"

import { createCyberstrikeClient } from "./client.js"
import { createCyberstrikeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createCyberstrike(options?: ServerOptions) {
  const server = await createCyberstrikeServer({
    ...options,
  })

  const client = createCyberstrikeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
