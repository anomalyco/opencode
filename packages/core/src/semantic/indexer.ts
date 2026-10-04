export * as SemanticIndexer from "./indexer"

import { Context, Effect, Layer } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"
import { Ripgrep } from "../ripgrep"
import { SemanticEmbedder } from "./embedder"
import { SemanticCache } from "./cache"
import { chunkFile } from "../tool/semantic-search"
import { Ignore } from "../filesystem/ignore"
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

export interface FileIndexResult {
  readonly ok: boolean
  readonly file: string
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

export type WatchEvent =
  | { readonly type: "ready"; readonly directory: string }
  | { readonly type: "indexed"; readonly file: string; readonly result: FileIndexResult }
  | { readonly type: "deleted"; readonly file: string }
  | { readonly type: "error"; readonly error: string }

export interface WatchOptions {
  readonly directory: string
  readonly include?: string
  readonly model?: string
  readonly debounceMs?: number
  readonly onEvent?: (event: WatchEvent) => void
}

export interface Interface {
  readonly indexDirectory: (options: IndexOptions) => Effect.Effect<IndexResult>
  readonly indexFile: (filePath: string, model?: string) => Effect.Effect<FileIndexResult>
  readonly watch: (options: WatchOptions) => Effect.Effect<() => Promise<void>>
  readonly status: (model?: string) => Effect.Effect<CacheStatusResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticIndexer") {}

const DEFAULT_INCLUDE = "**/*.{ts,tsx,js,jsx,py,go,rs,md}"
const DEFAULT_BATCH_SIZE = 20
const DEFAULT_MAX_FILES = 500
const DEFAULT_DEBOUNCE_MS = 1500

const SUPPORTED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".md"]

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

    const indexFile = (filePath: string, model = process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text") =>
      Effect.gen(function* () {
        const t0 = performance.now()
        const content = yield* fs.readFileStringSafe(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!content) {
          return {
            ok: false,
            file: filePath,
            totalChunks: 0,
            cachedChunks: 0,
            newChunks: 0,
            durationMs: performance.now() - t0,
            error: "File not found or unreadable",
          }
        }
        if (content.length > 200_000) {
          return {
            ok: false,
            file: filePath,
            totalChunks: 0,
            cachedChunks: 0,
            newChunks: 0,
            durationMs: performance.now() - t0,
            error: "File exceeds 200KB limit for semantic embedding",
          }
        }

        const chunks = chunkFile(filePath, content)
        if (chunks.length === 0) {
          return {
            ok: true,
            file: filePath,
            totalChunks: 0,
            cachedChunks: 0,
            newChunks: 0,
            durationMs: performance.now() - t0,
          }
        }

        const hashed = chunks.map((c) => ({
          hash: cache.hashText(c.text),
          text: c.text,
          relativePath: c.relativePath,
        }))

        const hashes = hashed.map((c) => c.hash)
        const cachedMap = yield* cache
          .getBatch(hashes, model)
          .pipe(Effect.catch(() => Effect.succeed(new Map<string, readonly number[]>())))

        const missing = hashed.filter((c) => !cachedMap.has(c.hash))
        const cachedChunks = hashed.length - missing.length

        let newChunks = 0
        if (missing.length > 0) {
          const isUp = yield* embedder.isAvailable()
          if (!isUp) {
            return {
              ok: false,
              file: filePath,
              totalChunks: chunks.length,
              cachedChunks,
              newChunks: 0,
              durationMs: performance.now() - t0,
              error: `Ollama embedding service is offline or model '${model}' is not installed.`,
            }
          }

          const texts = missing.map((m) => m.text)
          const embeddings = yield* embedder
            .embed(texts)
            .pipe(Effect.catch(() => Effect.succeed([] as readonly (readonly number[])[])))

          if (embeddings.length === missing.length) {
            const entries = missing.map((m, idx) => ({
              hash: m.hash,
              vector: embeddings[idx]!,
            }))
            yield* cache.setBatch(entries, model).pipe(Effect.catch(() => Effect.void))
            newChunks = entries.length
          }
        }

        return {
          ok: true,
          file: filePath,
          totalChunks: chunks.length,
          cachedChunks,
          newChunks,
          durationMs: performance.now() - t0,
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
        const cachedMap = yield* cache
          .getBatch(hashes, model)
          .pipe(Effect.catch(() => Effect.succeed(new Map<string, readonly number[]>())))

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

    const watch = (options: WatchOptions) =>
      Effect.sync(() => {
        const dir = path.resolve(options.directory)
        const debounceMs = Math.max(100, options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
        const model = options.model ?? (process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text")
        const pendingFiles = new Set<string>()
        let timer: NodeJS.Timeout | undefined
        let isDisposed = false

        const isSupportedFile = (f: string) => {
          const ext = path.extname(f).toLowerCase()
          if (!SUPPORTED_EXTENSIONS.includes(ext)) return false
          const relativePath = path.relative(dir, f)
          return !Ignore.match(relativePath)
        }

        const processPending = async () => {
          if (isDisposed || pendingFiles.size === 0) return
          const files = Array.from(pendingFiles)
          pendingFiles.clear()

          for (const file of files) {
            if (isDisposed) break
            const content = await Effect.runPromise(
              fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined))),
            )
            if (!content) {
              options.onEvent?.({ type: "deleted", file })
              continue
            }
            const res = await Effect.runPromise(indexFile(file, model))
            options.onEvent?.({ type: "indexed", file, result: res })
          }
        }

        const queueFile = (filePath: string) => {
          if (isDisposed || !isSupportedFile(filePath)) return
          pendingFiles.add(filePath)
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            void processPending()
          }, debounceMs)
        }

        let parcelSubscription: { unsubscribe: () => Promise<void> } | undefined
        let nodeWatcher: import("fs").FSWatcher | undefined

        const setupNodeWatcher = () => {
          try {
            const nodeFs = require("fs")
            nodeWatcher = nodeFs.watch(dir, { recursive: true }, (_eventType: string, filename: string | null) => {
              if (!filename || isDisposed) return
              const full = path.resolve(dir, filename)
              queueFile(full)
            })
            options.onEvent?.({ type: "ready", directory: dir })
          } catch (err: any) {
            options.onEvent?.({ type: "error", error: err?.message ?? "Failed to initialize node watcher" })
          }
        }

        const backend =
          process.platform === "linux"
            ? "inotify"
            : process.platform === "darwin"
              ? "fs-events"
              : process.platform === "win32"
                ? "windows"
                : undefined

        try {
          const parcel = require("@parcel/watcher") as typeof import("@parcel/watcher")
          const subscribePromise = parcel.subscribe(
            dir,
            (err, events) => {
              if (err || isDisposed) return
              for (const ev of events) {
                queueFile(ev.path)
              }
            },
            { ignore: [...Ignore.PATTERNS], backend },
          )
          subscribePromise
            .then((sub) => {
              if (isDisposed) {
                void sub.unsubscribe()
              } else {
                parcelSubscription = sub
                options.onEvent?.({ type: "ready", directory: dir })
              }
            })
            .catch(() => {
              setupNodeWatcher()
            })
        } catch {
          setupNodeWatcher()
        }

        return async () => {
          isDisposed = true
          if (timer) clearTimeout(timer)
          if (parcelSubscription) await parcelSubscription.unsubscribe().catch(() => {})
          if (nodeWatcher) nodeWatcher.close()
        }
      })

    return Service.of({
      indexDirectory,
      indexFile,
      watch,
      status,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Ripgrep.node, SemanticEmbedder.node, SemanticCache.node],
})
