export * from "./gen/types.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"

export function createOpencodeClient(config?: Config & { directory?: string }) {
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

  if (config?.baseUrl) {
    const baseUrl = new URL(config.baseUrl)
    if (baseUrl.username || baseUrl.password) {
      config.headers = {
        ...config.headers,
        Authorization: `Basic ${btoa(`${baseUrl.username}:${baseUrl.password}`)}`,
      }
      baseUrl.username = ""
      baseUrl.password = ""
      config.baseUrl = baseUrl.toString()
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
