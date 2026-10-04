export * as SemanticIndexer from "./indexer"

import { Context, Effect, Layer } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"
import { Ripgrep } from "../ripgrep"
import { SemanticEmbedder } from "./embedder"
import { SemanticCache } from "./cache"
import { chunkFile } from "../tool/semantic-search"
import { makeGlobalNode } from "../effect/app-node"

export interface IndexOptions {
  readonly directory: string
  readonly include?: string
  readonly model?: string
  readonly batchSize?: number
  readonly maxFiles?: number
}

export interface IndexResult {
  readonly ok: boolean
  readonly directory: string
  readonly totalFiles: number
  readonly indexedFiles: number
  readonly totalChunks: number
  readonly cachedChunks: number
  readonly newChunks: number
  readonly durationMs: number
  readonly error?: string
}

export interface CacheStatusResult {
  readonly available: boolean
  readonly model: string
  readonly totalCached: number
  readonly modelCached: number
}

export interface Interface {
  readonly indexDirectory: (options: IndexOptions) => Effect.Effect<IndexResult>
  readonly status: (model?: string) => Effect.Effect<CacheStatusResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticIndexer") {}

const DEFAULT_INCLUDE = "**/*.{ts,tsx,js,jsx,py,go,rs,md}"
const DEFAULT_BATCH_SIZE = 20
const DEFAULT_MAX_FILES = 500

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const embedder = yield* SemanticEmbedder.Service
    const cache = yield* SemanticCache.Service

    const status = (model = process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text") =>
      Effect.gen(function* () {
        const available = yield* embedder.isAvailable()
        const totalCached = yield* cache.count().pipe(Effect.catch(() => Effect.succeed(0)))
        const modelCached = yield* cache.count(model).pipe(Effect.catch(() => Effect.succeed(0)))
        return {
          available,
          model,
          totalCached,
          modelCached,
        }
      })

    const indexDirectory = (options: IndexOptions) =>
      Effect.gen(function* () {
        const t0 = performance.now()
        const model = options.model ?? (process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text")
        const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
        const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
        const pattern = options.include ?? DEFAULT_INCLUDE

        const isUp = yield* embedder.isAvailable()
        if (!isUp) {
          return {
            ok: false,
            directory: options.directory,
            totalFiles: 0,
            indexedFiles: 0,
            totalChunks: 0,
            cachedChunks: 0,
            newChunks: 0,
            durationMs: performance.now() - t0,
            error: `Ollama embedding service is offline or model '${model}' is not installed.`,
          }
        }

        const entries = yield* ripgrep
          .glob({
            cwd: options.directory,
            pattern,
            limit: maxFiles,
          })
          .pipe(Effect.catch(() => Effect.succeed([])))

        const allChunks: { readonly hash: string; readonly text: string; readonly relativePath: string }[] = []
        let indexedFiles = 0

        for (const entry of entries) {
          const fullPath = path.resolve(options.directory, entry.path)
          const content = yield* fs.readFileStringSafe(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!content || content.length > 200_000) continue
          indexedFiles++
          const chunks = chunkFile(entry.path, content)
          for (const c of chunks) {
            allChunks.push({
              hash: cache.hashText(c.text),
              text: c.text,
              relativePath: c.relativePath,
            })
          }
        }

        if (allChunks.length === 0) {
          return {
            ok: true,
            directory: options.directory,
            totalFiles: entries.length,
            indexedFiles: 0,
            totalChunks: 0,
            cachedChunks: 0,
            newChunks: 0,
            durationMs: performance.now() - t0,
          }
        }

        // Query cache in batch to discover which chunks are already embedded
        const hashes = allChunks.map((c) => c.hash)
        const cachedMap = yield* cache.getBatch(hashes, model).pipe(
          Effect.catch(() => Effect.succeed(new Map<string, readonly number[]>())),
        )

        const missingChunks = allChunks.filter((c) => !cachedMap.has(c.hash))
        const cachedChunks = allChunks.length - missingChunks.length

        // Embed missing chunks in batches
        let newChunks = 0
        for (let i = 0; i < missingChunks.length; i += batchSize) {
          const slice = missingChunks.slice(i, i + batchSize)
          const texts = slice.map((s) => s.text)
          const embeddings = yield* embedder
            .embed(texts)
            .pipe(Effect.catch(() => Effect.succeed([] as readonly (readonly number[])[])))
          if (embeddings.length === slice.length) {
            const newEntries = slice.map((s, idx) => ({
              hash: s.hash,
              vector: embeddings[idx]!,
            }))
            yield* cache.setBatch(newEntries, model).pipe(Effect.catch(() => Effect.void))
            newChunks += newEntries.length
          }
        }

        return {
          ok: true,
          directory: options.directory,
          totalFiles: entries.length,
          indexedFiles,
          totalChunks: allChunks.length,
          cachedChunks,
          newChunks,
          durationMs: performance.now() - t0,
        }
      })

    return Service.of({
      indexDirectory,
      status,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Ripgrep.node, SemanticEmbedder.node, SemanticCache.node],
})
