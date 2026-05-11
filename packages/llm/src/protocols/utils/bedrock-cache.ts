import { Schema } from "effect"
import type { CacheHint } from "../../schema"

// Bedrock cache markers are positional: emit a `cachePoint` block immediately
// after the content the caller wants treated as a cacheable prefix.
export const CachePointBlock = Schema.Struct({
  cachePoint: Schema.Struct({ type: Schema.tag("default") }),
})
export type CachePointBlock = Schema.Schema.Type<typeof CachePointBlock>

// Bedrock recently added optional `ttl: "5m" | "1h"` on cachePoint. Map
// `CacheHint.ttlSeconds` here once a recorded cassette validates the wire shape.
const DEFAULT: CachePointBlock = { cachePoint: { type: "default" } }

export const block = (cache: CacheHint | undefined): CachePointBlock | undefined => {
  if (cache?.type !== "ephemeral" && cache?.type !== "persistent") return undefined
  return DEFAULT
}

export * as BedrockCache from "./bedrock-cache"
