export * from "./client.js"
export * from "./server.js"

import { createArgusClient } from "./client.js"
import { createArgusServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createArgus(options?: ServerOptions) {
  const server = await createArgusServer({
    ...options,
  })

  const client = createArgusClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
