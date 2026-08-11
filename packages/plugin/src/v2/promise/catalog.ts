import type { CatalogDraft, CatalogProviderRecord } from "../effect/catalog.js"
import type { Hooks } from "./registration.js"

export type { CatalogDraft, CatalogProviderRecord }

export type CatalogHooks = Hooks<{
  transform: CatalogDraft
}>
