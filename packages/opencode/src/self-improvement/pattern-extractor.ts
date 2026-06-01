import { Context, Effect, Layer } from "effect"
import { MemoryStore } from "./memory-store"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "memory.pattern" })

export interface Interface {
  readonly extractPatterns: (input: { sessionID: string }) => Effect.Effect<{ patternsFound: number }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovement/PatternExtractor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* MemoryStore.Service

    const extractPatterns = Effect.fn("PatternExtractor.extractPatterns")(function* (input: {
      sessionID: string
    }) {
      const recent = yield* store.search({ query: "", max_results: 20 })

      // Group memories by shared tags
      const tagGroups = new Map<string, typeof recent>()
      for (const mem of recent) {
        if (mem.importance < 0.5) continue
        for (const tag of mem.tags) {
          const group = tagGroups.get(tag) ?? []
          group.push(mem)
          tagGroups.set(tag, group)
        }
      }

      let patternsFound = 0
      for (const [tag, group] of tagGroups) {
        if (group.length < 3) continue

        const combinedContent = group.map(m => `- ${m.title}: ${m.content.slice(0, 200)}`).join("\n")

        // Store a pattern memory
        yield* store.store({
          sessionID: input.sessionID,
          title: `Pattern: ${tag}`,
          content: `Discovered pattern across ${group.length} memories sharing tag "${tag}":\n${combinedContent}`,
          type: "pattern",
          tags: [...new Set(group.flatMap(m => m.tags))],
          importance: 0.6,
          confidence: 0.5,
        })
        patternsFound++
      }

      log.info("pattern extraction complete", { patternsFound, groups: tagGroups.size })
      return { patternsFound }
    })

    return Service.of({ extractPatterns })
  }),
)

export const defaultLayer = layer

export * as PatternExtractor from "./pattern-extractor"
