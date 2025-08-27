export * from "./gen/types.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

import { createClient } from "./gen/client/client.js"
import { type Config } from "./gen/client/types.js"
import { OpencodeClient } from "./gen/sdk.gen.js"

export function createOpencodeClient(config?: Config) {
  const client = createClient(config)
  return new OpencodeClient({ client })
}
