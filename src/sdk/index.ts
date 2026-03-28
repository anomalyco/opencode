export * from "./client.js"
export * from "./server.js"

import { createAthenaClient } from "./client.js"
import { createAthenaServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createAthena(options?: ServerOptions) {
  const server = await createAthenaServer({
    ...options,
  })

  const client = createAthenaClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
