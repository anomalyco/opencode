import { Effect, Layer, ServiceMap } from "effect"
import { MemoryStore } from "./store"
import { Log } from "@/util/log"
import type { MemoryFact, MemoryWindow, MemoryArtifact } from "./types"
import type { SessionID } from "../schema"

export interface MemoryResult {
  windows: MemoryWindow[]
  facts: MemoryFact[]
  artifacts: MemoryArtifact[]
}

export namespace MemoryRetriever {
  const log = Log.create({ service: "memory.retriever" })

  export interface RetrieveInput {
    keywords: string[]
    projectID: string
    sessionID?: SessionID
    limit?: { windows?: number; facts?: number; artifacts?: number }
  }

  export interface Interface {
    readonly retrieve: (input: RetrieveInput) => Effect.Effect<MemoryResult>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MemoryRetriever") {}

  export const layer: Layer.Layer<Service, never, MemoryStore.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* MemoryStore.Service

      const retrieve = Effect.fn("MemoryRetriever.retrieve")(function* (input: RetrieveInput) {
        const limit = {
          windows: input.limit?.windows ?? 3,
          facts: input.limit?.facts ?? 5,
          artifacts: input.limit?.artifacts ?? 5,
        }
        const hasKeywords = input.keywords.length > 0 && input.keywords.some((k) => k.trim().length > 0)
        if (hasKeywords) {
          const query = input.keywords.map((k) => `"${k.replace(/"/g, '""')}"`).join(" OR ")
          const [searched, recent] = yield* Effect.all(
            [
              store.searchWindows(query, { projectID: input.projectID, limit: limit.windows }),
              store.getRecentWindows({ projectID: input.projectID, limit: 1 }),
            ],
            { concurrency: "unbounded" },
          )
          const seen = new Set(searched.map((w) => w.id))
          let windows = [...searched]
          for (const w of recent) {
            if (!seen.has(w.id)) {
              windows.unshift(w)
              seen.add(w.id)
            }
          }
          windows = windows.slice(0, limit.windows)
          const [facts, artifacts] = yield* Effect.all(
            [
              store.searchFacts(query, { projectID: input.projectID, limit: limit.facts }),
              store.searchArtifacts(query, { projectID: input.projectID, limit: limit.artifacts }),
            ],
            { concurrency: "unbounded" },
          )
          return { windows, facts, artifacts }
        } else {
          const windows = yield* store.getRecentWindows({ projectID: input.projectID, limit: limit.windows })
          const facts = yield* store.getDurableFacts(input.projectID)
          return {
            windows,
            facts: windows.length > 0 ? facts.slice(0, limit.facts) : [],
            artifacts: [] as MemoryArtifact[],
          }
        }
      })

      return Service.of({ retrieve })
    }),
  )

  export const defaultLayer = layer
}
