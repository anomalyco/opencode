export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & { directory?: string; unix?: string }) {
  if (!config?.fetch) {
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
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodedDirectory,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
