import type { Schema } from "effect"

export interface StorageEntry {
  readonly key: string
  readonly value: Schema.Json
}

export interface StorageScanOptions {
  readonly prefix: string
  readonly after?: string
  readonly limit?: number
}

export interface StorageScanResult {
  readonly entries: readonly StorageEntry[]
  readonly next?: string
}
