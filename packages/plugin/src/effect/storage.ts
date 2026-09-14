import type { Effect, Schema } from "effect"
import type { StorageScanOptions, StorageScanResult } from "../storage.js"

export interface StorageDomain {
  readonly get: (key: string) => Effect.Effect<Schema.Json | undefined>
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
  readonly scan: (options: StorageScanOptions) => Effect.Effect<StorageScanResult>
}
