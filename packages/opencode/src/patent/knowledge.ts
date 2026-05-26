import { Context, Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"
import { Database } from "bun:sqlite"

export interface Interface {
  readonly searchSemantic: (
    query: string,
    opts: { limit: number; threshold: number },
  ) => Effect.Effect<Array<{ title: string; content: string; score: number }>>
  readonly searchCards: (keyword: string) => Effect.Effect<Array<{ title: string; content: string }>>
  readonly searchGuidelines: (topic: string) => Effect.Effect<string>
  readonly searchInvalidation: (topic: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentKnowledge") {}

export const make = (dataDir: string) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const searchSemantic = Effect.fn("PatentKnowledge.searchSemantic")(
      function* (query: string, opts: { limit: number; threshold: number }) {
        const dbPath = path.join(dataDir, "semantic-index.db")
        const exists = yield* fs.existsSafe(dbPath)
        if (!exists) return []

        const db = new Database(dbPath, { readonly: true })
        const results = db
          .query(`SELECT title, content FROM chunks WHERE content LIKE ? LIMIT ?`, [`%${query}%`, opts.limit])
          .all()
          .map((row: any) => ({
            title: row.title,
            content: row.content,
            score: 1.0,
          }))
        db.close()
        return results
      },
    )

    const searchCards = Effect.fn("PatentKnowledge.searchCards")(function* (keyword: string) {
      const cardsDir = path.join(dataDir, "cards")
      const exists = yield* fs.existsSafe(cardsDir)
      if (!exists) return []

      const files = yield* fs.readDirectorySafe(cardsDir).pipe(Effect.orElseSucceed(() => [] as string[]))
      const results: Array<{ title: string; content: string }> = []

      for (const file of files) {
        if (!file.includes(keyword)) continue
        const filePath = path.join(cardsDir, file)
        const content = yield* fs.readFileStringSafe(filePath).pipe(Effect.orElseSucceed(() => ""))
        if (content.toLowerCase().includes(keyword.toLowerCase())) {
          const title = file.replace(/\.md$/, "")
          results.push({ title, content })
        }
      }

      return results
    })

    const searchGuidelines = Effect.fn("PatentKnowledge.searchGuidelines")(function* (topic: string) {
      const guidelinesDir = path.join(dataDir, "审查指南")
      const exists = yield* fs.existsSafe(guidelinesDir)
      if (!exists) return ""

      const files = yield* fs.readDirectorySafe(guidelinesDir).pipe(Effect.orElseSucceed(() => [] as string[]))
      const matchedFiles = files.filter((f) => f.toLowerCase().includes(topic.toLowerCase()))

      if (matchedFiles.length === 0) return ""

      const content = yield* fs.readFileStringSafe(path.join(guidelinesDir, matchedFiles[0])).pipe(
        Effect.orElseSucceed(() => ""),
      )
      return content
    })

    const searchInvalidation = Effect.fn("PatentKnowledge.searchInvalidation")(function* (topic: string) {
      const invalidationDir = path.join(dataDir, "复审无效")
      const exists = yield* fs.existsSafe(invalidationDir)
      if (!exists) return ""

      const files = yield* fs.readDirectorySafe(invalidationDir).pipe(Effect.orElseSucceed(() => [] as string[]))
      const matchedFiles = files.filter((f) => f.toLowerCase().includes(topic.toLowerCase()))

      if (matchedFiles.length === 0) return ""

      const content = yield* fs.readFileStringSafe(path.join(invalidationDir, matchedFiles[0])).pipe(
        Effect.orElseSucceed(() => ""),
      )
      return content
    })

    return Service.of({ searchSemantic, searchCards, searchGuidelines, searchInvalidation })
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const dataDir = path.join(process.env.HOME ?? "", ".opencode", "patent")
    return yield* make(dataDir)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as PatentKnowledge from "./knowledge"