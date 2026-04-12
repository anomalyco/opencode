export * from "./gen/types.gen.js"

import { context, propagation, trace } from "@opentelemetry/api"
import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

const headerGetterSetter = {
  set(carrier: Headers, key: string, value: string) {
    carrier.set(key, value)
  },
  get(carrier: Headers, key: string) {
    return carrier.get(key) ?? undefined
  },
  keys(carrier: Headers) {
    return [...carrier.keys()]
  },
}

export function createOpencodeClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      if (req instanceof Request && trace.getActiveSpan()) {
        const headers = new Headers(req.headers)
        propagation.inject(context.active(), headers, headerGetterSetter)
        req = new Request(req, { headers })
      }
      // @ts-ignore
      req.timeout = false
      return fetch(req)
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

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-opencode-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
