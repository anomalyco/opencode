export * from "./client.js"
export * from "./server.js"

import { createWeaponClient } from "./client.js"
import { createWeaponServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createWeapon(options?: ServerOptions) {
  const server = await createWeaponServer({
    ...options,
  })

  const client = createWeaponClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
