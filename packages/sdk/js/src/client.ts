export * from "./gen/types.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"

export function createOpencodeClient(config?: Config, options?: { directory?: string }) {
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

  const client = createClient(config)

  if (options?.directory) {
    async function middleware(request: Request) {
      const url = new URL(request.url)
      url.searchParams.set("directory", options!.directory!)
      return new Request(url.toString(), request)
    }
    client.interceptors.request.use(middleware)
  }

  return new OpencodeClient({ client })
}
