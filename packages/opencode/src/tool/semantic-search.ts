import path from "path"
import { Effect, Option, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SemanticEmbedder } from "@opencode-ai/core/semantic/embedder"
import { SemanticCache } from "@opencode-ai/core/semantic/cache"
import {
  chunkFile,
  toModelOutput,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_CHUNKS_TO_EMBED,
  type SemanticMatch,
} from "@opencode-ai/core/tool/semantic-search"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./semantic-search.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The natural language query describing the concept or feature to search for",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.ts", "*.py")',
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of semantically relevant snippets to return (default: 5, max: 20)",
  }),
})

export const SemanticSearchTool = Tool.define(
  "semantic_search",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const embedderOpt = yield* Effect.serviceOption(SemanticEmbedder.Service)
    const cacheOpt = yield* Effect.serviceOption(SemanticCache.Service)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { query: string; path?: string; include?: string; limit?: number },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          if (!params.query) {
            throw new Error("query is required")
          }

          yield* ctx.ask({
            permission: "semantic_search",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              path: params.path,
              include: params.include,
              limit: params.limit,
            },
          })

          const ins = yield* InstanceState.context
          const requested = path.isAbsolute(params.path ?? ins.directory)
            ? (params.path ?? ins.directory)
            : path.join(ins.directory, params.path ?? ".")
          const requestedInfo = yield* fs.stat(requested).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, requested, {
            bypass: false,
            kind: requestedInfo?.type === "Directory" ? "directory" : "file",
          })

          const search = FSUtil.resolve(requested)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const searchDir = info?.type === "Directory" ? search : path.dirname(search)
          const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

          const embedder = Option.getOrUndefined(embedderOpt)
          const cache = Option.getOrUndefined(cacheOpt)
          const isOllamaUp = embedder ? yield* embedder.isAvailable() : false

          if (!isOllamaUp || !embedder) {
            // Graceful fallback to keyword search with ripgrep
            const words = params.query
              .split(/\s+/)
              .map((w) => w.replace(/[^\w-]/g, ""))
              .filter((w) => w.length >= 3)
            const fallbackPattern = words.length > 0 ? words.slice(0, 3).join("|") : params.query

            const result = yield* ripgrep
              .grep({
                cwd: searchDir,
                pattern: fallbackPattern,
                include: params.include,
                limit,
              })
              .pipe(Effect.catch(() => Effect.succeed([])))

            const matches: SemanticMatch[] = result.map((item) => ({
              path: path.relative(ins.directory, path.resolve(searchDir, item.entry.path)),
              startLine: item.line,
              endLine: item.line,
              score: 0.5,
              snippet: item.text,
              fallback: true,
            }))

            return {
              title: params.query,
              metadata: { matches: matches.length, fallback: true },
              output: toModelOutput(matches),
            }
          }

          // Full semantic search with Ollama embeddings & SQLite cache
          const globPattern = params.include ?? "**/*.{ts,tsx,js,jsx,py,go,rs,md}"
          const candidateEntries = yield* ripgrep
            .glob({
              cwd: searchDir,
              pattern: globPattern,
              limit: 40,
            })
            .pipe(Effect.catch(() => Effect.succeed([])))

          const allChunks = []
          for (const entry of candidateEntries) {
            if (allChunks.length >= MAX_CHUNKS_TO_EMBED) break
            const fullPath = path.resolve(searchDir, entry.path)
            const content = yield* fs.readFileStringSafe(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!content || content.length > 100_000) continue
            const rel = path.relative(ins.directory, fullPath)
            const fileChunks = chunkFile(rel, content)
            for (const chunk of fileChunks) {
              allChunks.push(chunk)
              if (allChunks.length >= MAX_CHUNKS_TO_EMBED) break
            }
          }

          if (allChunks.length === 0) {
            return {
              title: params.query,
              metadata: { matches: 0, fallback: false },
              output: "No matching files found in the specified path.",
            }
          }

          const embedModel = process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text"
          let queryVector: readonly number[] | undefined

          if (cache) {
            const queryHash = cache.hashText(params.query)
            queryVector = yield* cache.get(queryHash, embedModel).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!queryVector) {
              queryVector = yield* embedder.embedOne(params.query).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (queryVector) {
                yield* cache.set(queryHash, embedModel, queryVector).pipe(Effect.catch(() => Effect.void))
              }
            }
          } else {
            queryVector = yield* embedder.embedOne(params.query).pipe(Effect.catch(() => Effect.succeed(undefined)))
          }

          if (!queryVector) {
            return {
              title: params.query,
              metadata: { matches: 0, fallback: false },
              output: "Failed to generate query embedding.",
            }
          }

          // Vector cache lookup for chunks
          const cachedMap = cache
            ? yield* cache.getBatch(allChunks.map((c) => cache.hashText(c.text)), embedModel).pipe(
                Effect.catch(() => Effect.succeed(new Map<string, readonly number[]>())),
              )
            : new Map<string, readonly number[]>()

          const missingChunks = []
          for (let i = 0; i < allChunks.length; i++) {
            const chunk = allChunks[i]!
            const h = cache ? cache.hashText(chunk.text) : `${i}`
            if (!cachedMap.has(h)) {
              missingChunks.push({ index: i, text: chunk.text, hash: h })
            }
          }

          if (missingChunks.length > 0) {
            const newEmbeddings = yield* embedder
              .embed(missingChunks.map((m) => m.text))
              .pipe(Effect.catch(() => Effect.succeed([] as readonly (readonly number[])[])))
            const newEntries = missingChunks
              .map((m, idx) => ({
                hash: m.hash,
                vector: newEmbeddings[idx],
              }))
              .filter((entry): entry is { hash: string; vector: readonly number[] } => !!entry.vector)
            for (const entry of newEntries) {
              cachedMap.set(entry.hash, entry.vector)
            }
            if (cache && newEntries.length > 0) {
              yield* cache.setBatch(newEntries, embedModel).pipe(Effect.catch(() => Effect.void))
            }
          }

          const scoredChunks = allChunks.map((chunk, index) => {
            const h = cache ? cache.hashText(chunk.text) : `${index}`
            const vec = cachedMap.get(h)
            const score = vec ? SemanticEmbedder.cosineSimilarity(queryVector, vec) : 0
            return {
              path: chunk.relativePath,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              score,
              snippet: chunk.text,
            }
          })

          scoredChunks.sort((a, b) => b.score - a.score)
          const topMatches = scoredChunks.slice(0, limit)

          return {
            title: params.query,
            metadata: { matches: topMatches.length, fallback: false },
            output: toModelOutput(topMatches),
          }
        }),
    }
  }),
)
