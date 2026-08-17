import type { ModelApi, ProviderApi, WebsearchApi } from "./api/api.js"

export type * from "./api/api.js"

export type WebSearchApi<E = never> = WebsearchApi<E>

export interface CatalogApi<E = never> {
  readonly provider: ProviderApi<E>
  readonly model: ModelApi<E>
}
