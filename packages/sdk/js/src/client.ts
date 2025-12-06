export * from "./gen/types.gen.js"
export { ForgeClient } from "./gen/sdk.gen.js"
export { type Config as ForgeClientConfig } from "./gen/client/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { ForgeClient } from "./gen/sdk.gen.js"

export function createForgeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    config = {
      ...config,
      fetch: (req) => {
        // @ts-ignore
        req.timeout = false
        return fetch(req)
      },
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": config.directory,
    }
  }

  const client = createClient(config)
  return new ForgeClient({ client })
}
