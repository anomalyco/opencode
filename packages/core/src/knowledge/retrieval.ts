export * as KnowledgeRetrieval from "./retrieval"

import { makeLocationNode } from "../effect/app-node"
import { Context, Effect, Layer } from "effect"
import type { RetrievalResult } from "@opencode-ai/knowledge-engine"

/** One retrieved knowledge document, trimmed to the caller-facing shape. */
export interface Doc {
  readonly title: string
  readonly section: string
  readonly content: string
  readonly similarity: number
}

export interface Interface {
  readonly search: (query: string, topK: number) => Effect.Effect<ReadonlyArray<Doc>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/KnowledgeRetrieval") {}

export const TOP_K = 3
export const MIN_SIMILARITY = 0.2

const EMPTY: ReadonlyArray<Doc> = []

const toDoc = (row: RetrievalResult): Doc => ({
  title: row.title,
  section: row.section,
  content: row.content,
  similarity: row.similarity,
})

type Searcher = (query: string, topK: number) => Effect.Effect<ReadonlyArray<Doc>>

const noop: Searcher = () => Effect.succeed(EMPTY)

const init = Effect.fn("KnowledgeRetrieval.init")(function* () {
  const mod = yield* Effect.promise(() => import("@opencode-ai/knowledge-engine/retriever"))
  const retriever = yield* Effect.sync(() => new mod.LocalRetriever())
  return (query: string, topK: number): Effect.Effect<ReadonlyArray<Doc>> =>
    Effect.promise(() => retriever.retrieveRelevant(query, topK, { minSimilarity: MIN_SIMILARITY })).pipe(
      Effect.map((rows) => rows.map(toDoc).slice(0, topK)),
      Effect.catch(() => Effect.succeed(EMPTY)),
      Effect.catchDefect(() => Effect.succeed(EMPTY)),
    )
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get = yield* Effect.cached(
      init().pipe(
        Effect.catch(() => Effect.succeed(noop)),
        Effect.catchDefect(() => Effect.succeed(noop)),
      ),
    )
    return Service.of({
      search: (query, topK) => Effect.flatMap(get, (search) => search(query, topK)),
    })
  }),
)

export const noopLayer = Layer.succeed(Service, Service.of({ search: noop }))

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [] })
