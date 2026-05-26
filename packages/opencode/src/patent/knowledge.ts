import { Context, Effect, Layer, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service

    const getDataDir = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      return cfg.patent?.dataDir ?? path.join(process.env.HOME ?? "", ".opencode", "patent")
    })

    const searchSemantic = Effect.fn("PatentKnowledge.searchSemantic")(
      function* (query: string, opts: { limit: number; threshold: number }) {
        const dataDir = yield* getDataDir()
        const dbPath = path.join(dataDir, "semantic-index.db")
        const exists = yield* fs.existsSafe(dbPath)
        if (!exists) return []

        const results = yield* Effect.gen(function* () {
          const db = yield* Effect.acquireRelease(
            Effect.sync(() => new Database(dbPath, { readonly: true })),
            (db) => Effect.sync(() => db.close()),
          )
          return (db
            .query(`SELECT title, content FROM chunks WHERE content LIKE ? LIMIT ?`)
            .all(`%${query}%`, opts.limit) as Array<{ title: string; content: string }>)
            .map((row) => ({
              title: row.title,
              content: row.content,
              score: 1.0,
            }))
        }).pipe(Effect.scoped)
        return results
      },
    )

    const searchCards = Effect.fn("PatentKnowledge.searchCards")(function* (keyword: string) {
      const dataDir = yield* getDataDir()
      const cardsDir = path.join(dataDir, "cards")
      const exists = yield* fs.existsSafe(cardsDir)
      if (!exists) return []

      const entries = yield* fs.readDirectoryEntries(cardsDir).pipe(Effect.orElseSucceed(() => []))

      const results = yield* Effect.all(
        entries
          .filter((entry) => entry.name.includes(keyword))
          .map((entry) =>
            Effect.gen(function* () {
              const filePath = path.join(cardsDir, entry.name)
              const content = yield* fs.readFileStringSafe(filePath).pipe(Effect.orElseSucceed(() => ""))
              return {
                title: entry.name.replace(/\.md$/, ""),
                content: content ?? "",
              }
            }),
          ),
      )

      return results.filter(
        (item) => item.content.toLowerCase().includes(keyword.toLowerCase()),
      )
    })

    const searchGuidelines = Effect.fn("PatentKnowledge.searchGuidelines")(function* (topic: string) {
      const dataDir = yield* getDataDir()
      const guidelinesDir = path.join(dataDir, "审查指南")
      const exists = yield* fs.existsSafe(guidelinesDir)
      if (!exists) return ""

      const entries = yield* fs.readDirectoryEntries(guidelinesDir).pipe(Effect.orElseSucceed(() => []))
      const matchedFiles = entries.filter((entry) =>
        entry.name.toLowerCase().includes(topic.toLowerCase()),
      )

      if (matchedFiles.length === 0) return ""

      const content = yield* fs.readFileStringSafe(path.join(guidelinesDir, matchedFiles[0].name)).pipe(
        Effect.orElseSucceed(() => ""),
      )
      return content ?? ""
    })

    const searchInvalidation = Effect.fn("PatentKnowledge.searchInvalidation")(function* (topic: string) {
      const dataDir = yield* getDataDir()
      const invalidationDir = path.join(dataDir, "复审无效")
      const exists = yield* fs.existsSafe(invalidationDir)
      if (!exists) return ""

      const entries = yield* fs.readDirectoryEntries(invalidationDir).pipe(Effect.orElseSucceed(() => []))
      const matchedFiles = entries.filter((entry) =>
        entry.name.toLowerCase().includes(topic.toLowerCase()),
      )

      if (matchedFiles.length === 0) return ""

      const content = yield* fs.readFileStringSafe(path.join(invalidationDir, matchedFiles[0].name)).pipe(
        Effect.orElseSucceed(() => ""),
      )
      return content ?? ""
    })

    return Service.of({ searchSemantic, searchCards, searchGuidelines, searchInvalidation })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export * as PatentKnowledge from "./knowledge"
