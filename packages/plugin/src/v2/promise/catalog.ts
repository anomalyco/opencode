import type { CatalogApi } from "@opencode-ai/client/promise/api"
import type { CatalogDraft, CatalogProviderRecord } from "../effect/catalog.js"
import type { Transform } from "./registration.js"

export type { CatalogDraft, CatalogProviderRecord }

export interface CatalogDomain extends CatalogApi {
  readonly model: CatalogApi["model"] & {
    readonly get: (providerID: string, modelID: string) => Promise<ModelGetOutput | undefined>
  }
  readonly transform: Transform<CatalogDraft>
  readonly reload: () => Promise<void>
}

type ModelGetOutput = Awaited<ReturnType<CatalogApi["model"]["list"]>>["data"][number]
