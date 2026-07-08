import type { CatalogApi } from "@opencode-ai/client/promise/api"
import type { CatalogDraft, CatalogProviderRecord } from "../effect/catalog.js"
import type { Transform } from "./registration.js"

export type { CatalogDraft, CatalogProviderRecord }

export interface CatalogDomain extends CatalogApi {
  readonly transform: Transform<CatalogDraft>
  readonly reload: () => Promise<void>
}
