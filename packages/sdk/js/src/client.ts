export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & { directory?: string; unix?: string }) {
  if (!config?.fetch) {
    // Handle Unix domain socket if specified
    if (config?.unix) {
      const unixPath = config.unix
      const customFetch: any = (req: any) => {
        return fetch(
          req.url,
          {
            method: req.method,
            headers: req.headers,
            body: req.body,
            unix: unixPath,
            timeout: false,
          } as any,
        )
      }
      config = {
        ...config,
        fetch: customFetch,
      }
    } else {
      const customFetch: any = (req: any) => {
        // @ts-ignore
        req.timeout = false
        return fetch(req)
      }
      config = {
        ...config,
        fetch: customFetch,
      }
    }
  } else if (config?.unix) {
    // Handle Unix domain socket when fetch is already provided
    const unixPath = config.unix
    const originalFetch: any = config.fetch
    const customFetch: any = (req: any) => {
      return originalFetch(
        req.url,
        {
          method: req.method,
          headers: req.headers,
          body: req.body,
          unix: unixPath,
          timeout: false,
        } as any,
      )
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": config.directory,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
