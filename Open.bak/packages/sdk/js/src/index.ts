export * from "./client.js"
export * from "./server.js"

import { createOpenDeepSeekClient } from "./client.js"
import { createOpenDeepSeekServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createOpenDeepSeek(options?: ServerOptions) {
  const server = await createOpenDeepSeekServer({
    ...options,
  })

  const client = createOpenDeepSeekClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
