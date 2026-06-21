import { Context, Effect, Layer, Option } from "effect"
import { Database } from "../database/database"
import { CodeIndexTable } from "./sql"
import { eq } from "drizzle-orm"
import { Identifier } from "../util/identifier"
import fs from "fs/promises"
import path from "path"
import { VectorCache, parseEmbeddingJson } from "./embedding"

export { getEmbedding, cosineSimilarity } from "./embedding"

export interface CodeIndexEntry {
  id: string
  filepath: string
  content: string
  metadata: {
    startLine: number
    endLine: number
    filepath: string
  }
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly indexProject: (directory: string) => Effect.Effect<{ filesIndexed: number; chunksCreated: number }>
  readonly searchCode: (query: string, limit?: number) => Effect.Effect<CodeIndexEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CodeIndex") {}

async function getFiles(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (
          dirent.name === "node_modules" ||
          dirent.name === ".git" ||
          dirent.name === "dist" ||
          dirent.name === "build" ||
          dirent.name === ".zero" ||
          dirent.name === ".gemini"
        ) {
          return []
        }
        return getFiles(res)
      } else {
        const ext = path.extname(dirent.name).toLowerCase()
        const textExtensions = [
          ".ts",
          ".js",
          ".json",
          ".md",
          ".txt",
          ".py",
          ".rs",
          ".go",
          ".c",
          ".h",
          ".cpp",
          ".css",
          ".html",
        ]
        if (textExtensions.includes(ext)) {
          return res
        }
        return []
      }
    }),
  )
  return Array.prototype.concat(...files)
}

function chunkFile(filepath: string, content: string): { content: string; metadata: any }[] {
  const lines = content.split("\n")
  const chunks: { content: string; metadata: any }[] = []
  const chunkSize = 30
  const overlap = 5

  for (let i = 0; i < lines.length; i += chunkSize - overlap) {
    const chunkLines = lines.slice(i, i + chunkSize)
    if (chunkLines.length === 0) break
    const chunkText = chunkLines.join("\n")
    chunks.push({
      content: chunkText,
      metadata: {
        startLine: i + 1,
        endLine: i + chunkLines.length,
        filepath,
      },
    })
    if (i + chunkSize >= lines.length) break
  }
  return chunks
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      indexProject: (directory) =>
        Effect.gen(function* () {
          const { getEmbedding } = yield* Effect.promise(() => import("./embedding"))
          const files = yield* Effect.promise(() => getFiles(directory))
          let chunksCreated = 0

          // Delete existing index entries for the files to avoid duplication
          for (const filepath of files) {
            yield* db.delete(CodeIndexTable).where(eq(CodeIndexTable.filepath, filepath)).pipe(Effect.orDie)

            const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
            const chunks = chunkFile(filepath, content)

            for (const chunk of chunks) {
              const id = "chunk_" + Identifier.ascending()
              const embeddingArray = yield* Effect.promise(() => getEmbedding(chunk.content))
              const embeddingStr = JSON.stringify(embeddingArray)
              const metadataStr = JSON.stringify(chunk.metadata)
              const now = Date.now()

              yield* db
                .insert(CodeIndexTable)
                .values({
                  id,
                  filepath,
                  content: chunk.content,
                  embedding: embeddingStr,
                  metadata: metadataStr,
                  time_created: now,
                  time_updated: now,
                })
                .pipe(Effect.orDie)

              chunksCreated++
            }
          }

          return {
            filesIndexed: files.length,
            chunksCreated,
          }
        }),

      searchCode: (query, limit = 5) =>
        Effect.gen(function* () {
          const { getEmbedding, cosineSimilarity } = yield* Effect.promise(() => import("./embedding"))
          const queryEmbedding = yield* Effect.promise(() => getEmbedding(query))
          const rows = yield* db.select().from(CodeIndexTable).all().pipe(Effect.orDie)

          const scored = rows.map((row) => {
            const embedding = parseEmbeddingJson(row.embedding)
            const metadata = Option.try(() => row.metadata ? JSON.parse(row.metadata) : { startLine: 0, endLine: 0, filepath: row.filepath }).pipe(Option.getOrElse(() => ({ startLine: 0, endLine: 0, filepath: row.filepath })))

            const score = embedding.length > 0 ? cosineSimilarity(queryEmbedding, embedding) : 0
            return { score, entry: { id: row.id, filepath: row.filepath, content: row.content, metadata, time_created: row.time_created, time_updated: row.time_updated } }
          })

          return scored
            .filter((item) => item.score > 0.1)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((item) => item.entry)
        }),
    })
  }),
)
