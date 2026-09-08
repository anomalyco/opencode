export * as ExtensionManager from "./manager.js"

import { Schema } from "effect"

export const Manifest = Schema.Struct({
  schema: Schema.Literal("opencode.desktop/1"),
  id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)),
  name: Schema.String.check(Schema.isMinLength(1)),
  version: Schema.String.check(Schema.isMinLength(1)),
  entry: Schema.String,
  main: Schema.optionalKey(Schema.String),
  style: Schema.optionalKey(Schema.String),
  imports: Schema.Array(Schema.String),
  mainImports: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type Manifest = typeof Manifest.Type

export const Installed = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  revision: Schema.String,
  generation: Schema.Number,
  enabled: Schema.Boolean,
  hasMain: Schema.Boolean,
})
export type Installed = typeof Installed.Type

export const Source = Schema.Struct({ manifest: Manifest, revision: Schema.String, source: Schema.String })
export type Source = typeof Source.Type

export const ErrorCode = Schema.Literals([
  "invalidArchive",
  "invalidManifest",
  "invalidPath",
  "tooLarge",
  "reserved",
  "notFound",
  "disabled",
  "invalidModule",
  "download",
  "url",
  "storage",
])
export type ErrorCode = typeof ErrorCode.Type
export const Failure = Schema.Struct({ code: ErrorCode })
export class ManagerError extends Error {
  constructor(
    readonly code: ErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options)
  }
}

/** The native manager owns installation; renderer code owns activation through the same plugin host. */
export interface Transport {
  list(): Promise<readonly Installed[]>
  install(data: Uint8Array): Promise<readonly Installed[]>
  installURL(url: string): Promise<readonly Installed[]>
  enable(id: string, enabled: boolean): Promise<readonly Installed[]>
  reload(id: string): Promise<readonly Installed[]>
  source(id: string, revision: string): Promise<Source>
  onChange(callback: (entries: readonly Installed[]) => void): () => void
  assetURL(id: string, revision: string, path: string): string
}
