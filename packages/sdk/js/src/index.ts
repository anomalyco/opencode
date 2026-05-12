export * from "./client.js"
export * from "./server.js"

import { createOctopusClient } from "./client.js"
import { createOctopusServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createOctopus(options?: ServerOptions) {
  const server = await createOctopusServer({
    ...options,
  })

  const client = createOctopusClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
