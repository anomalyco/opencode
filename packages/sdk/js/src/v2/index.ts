export * from "./client.js"
export * from "./server.js"

import { createDaemonCodeClient } from "./client.js"
import { createDaemonCodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createDaemonCode(options?: ServerOptions) {
  const server = await createDaemonCodeServer({
    ...options,
  })

  const client = createDaemonCodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
