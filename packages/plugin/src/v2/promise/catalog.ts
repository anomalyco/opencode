import type { CatalogApi } from "@opencode-ai/client/promise/api"
import type { CatalogDraft, CatalogProviderRecord } from "../effect/catalog.js"
import type { Hooks, Transform } from "./registration.js"

export type { CatalogDraft, CatalogProviderRecord }

export interface CatalogHooks {}

export interface CatalogDomain extends CatalogApi {
  readonly hook: Hooks<CatalogHooks>
  readonly transform: Transform<CatalogDraft>
  readonly reload: () => Promise<void>
}
