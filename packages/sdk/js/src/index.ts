import { createClient } from "./gen/client/client"
import { type Config } from "./gen/client/types"
import { OpencodeClient } from "./gen/sdk.gen"
export * from "./gen/types.gen"

export function createOpencodeClient(config?: Config) {
  const client = createClient(config)
  return new OpencodeClient({ client })
}
