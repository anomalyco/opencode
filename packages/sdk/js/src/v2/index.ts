export * from "./client.js"
export * from "./server.js"

import { createPencodeClient } from "./client.js"
import { createPencodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createPencode(options?: ServerOptions) {
  const server = await createPencodeServer({
    ...options,
  })

  const client = createPencodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
