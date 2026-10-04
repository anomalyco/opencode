import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { LayerNode } from "../src/effect/layer-node"
import { SemanticIndexer, type WatchEvent } from "../src/semantic/indexer"
import { SemanticEmbedder } from "../src/semantic/embedder"
import { SemanticCache } from "../src/semantic/cache"

describe("SemanticIndexer Service", () => {
  it("indexes a directory, caches vectors in SQLite, and skips cached chunks incrementally", async () => {
    const tmpDir = path.join(os.tmpdir(), `test-semantic-indexer-${Date.now()}`)
    const tmpDbPath = path.join(tmpDir, "test-cache.sqlite")
    await fs.mkdir(tmpDir, { recursive: true })

    await fs.writeFile(
      path.join(tmpDir, "service.ts"),
      "export class UserService {\n  findUser(id: string) {\n    return { id, name: 'Alice' };\n  }\n}",
    )
    await fs.writeFile(
      path.join(tmpDir, "auth.py"),
      "def verify_password(p: str) -> bool:\n    return len(p) >= 8\n",
    )

    const mockVector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
    const mockEmbedderLayer = Layer.succeed(
      SemanticEmbedder.Service,
      SemanticEmbedder.Service.of({
        isAvailable: () => Effect.succeed(true),
        embedOne: () => Effect.succeed(mockVector),
        embed: (texts) => Effect.succeed(texts.map(() => mockVector)),
      }),
    )

    const db = SemanticCache.createDatabase(tmpDbPath)
    const mockCacheLayer = Layer.succeed(SemanticCache.Service, SemanticCache.makeService(db))

    const testLayer = LayerNode.compile(SemanticIndexer.node, [
      [SemanticEmbedder.node, mockEmbedderLayer],
      [SemanticCache.node, mockCacheLayer],
    ])

    const program = Effect.gen(function* () {
      const indexer = yield* SemanticIndexer.Service

      // Run 1: Cold index
      const run1 = yield* indexer.indexDirectory({
        directory: tmpDir,
        include: "**/*.{ts,py}",
      })

      expect(run1.ok).toBe(true)
      expect(run1.indexedFiles).toBe(2)
      expect(run1.totalChunks).toBeGreaterThanOrEqual(2)
      expect(run1.newChunks).toBe(run1.totalChunks)
      expect(run1.cachedChunks).toBe(0)

      // Status check
      const stat = yield* indexer.status()
      expect(stat.available).toBe(true)
      expect(stat.totalCached).toBe(run1.totalChunks)

      // Run 2: Incremental index (all chunks must hit cache)
      const run2 = yield* indexer.indexDirectory({
        directory: tmpDir,
        include: "**/*.{ts,py}",
      })

      expect(run2.ok).toBe(true)
      expect(run2.indexedFiles).toBe(2)
      expect(run2.newChunks).toBe(0)
      expect(run2.cachedChunks).toBe(run1.totalChunks)
    }).pipe(
      Effect.provide(testLayer),
    )

    await Effect.runPromise(program)

    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("indexes a single file with indexFile and skips cached chunks", async () => {
    const tmpDir = path.join(os.tmpdir(), `test-index-file-${Date.now()}`)
    const tmpDbPath = path.join(tmpDir, "test-file-cache.sqlite")
    await fs.mkdir(tmpDir, { recursive: true })

    const targetFile = path.join(tmpDir, "calculator.ts")
    await fs.writeFile(targetFile, "export function add(a: number, b: number): number {\n  return a + b;\n}\n")

    const mockVector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
    const mockEmbedderLayer = Layer.succeed(
      SemanticEmbedder.Service,
      SemanticEmbedder.Service.of({
        isAvailable: () => Effect.succeed(true),
        embedOne: () => Effect.succeed(mockVector),
        embed: (texts) => Effect.succeed(texts.map(() => mockVector)),
      }),
    )

    const db = SemanticCache.createDatabase(tmpDbPath)
    const mockCacheLayer = Layer.succeed(SemanticCache.Service, SemanticCache.makeService(db))

    const testLayer = LayerNode.compile(SemanticIndexer.node, [
      [SemanticEmbedder.node, mockEmbedderLayer],
      [SemanticCache.node, mockCacheLayer],
    ])

    const program = Effect.gen(function* () {
      const indexer = yield* SemanticIndexer.Service

      // Cold index single file
      const r1 = yield* indexer.indexFile(targetFile)
      expect(r1.ok).toBe(true)
      expect(r1.totalChunks).toBe(1)
      expect(r1.newChunks).toBe(1)
      expect(r1.cachedChunks).toBe(0)

      // Warm index same file
      const r2 = yield* indexer.indexFile(targetFile)
      expect(r2.ok).toBe(true)
      expect(r2.totalChunks).toBe(1)
      expect(r2.newChunks).toBe(0)
      expect(r2.cachedChunks).toBe(1)
    }).pipe(Effect.provide(testLayer))

    await Effect.runPromise(program)

    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("watches a directory reactively and indexes new files upon debounce", async () => {
    const tmpDir = path.join(os.tmpdir(), `test-watch-indexer-${Date.now()}`)
    const tmpDbPath = path.join(tmpDir, "test-watch-cache.sqlite")
    await fs.mkdir(tmpDir, { recursive: true })

    const mockVector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
    const mockEmbedderLayer = Layer.succeed(
      SemanticEmbedder.Service,
      SemanticEmbedder.Service.of({
        isAvailable: () => Effect.succeed(true),
        embedOne: () => Effect.succeed(mockVector),
        embed: (texts) => Effect.succeed(texts.map(() => mockVector)),
      }),
    )

    const db = SemanticCache.createDatabase(tmpDbPath)
    const mockCacheLayer = Layer.succeed(SemanticCache.Service, SemanticCache.makeService(db))

    const testLayer = LayerNode.compile(SemanticIndexer.node, [
      [SemanticEmbedder.node, mockEmbedderLayer],
      [SemanticCache.node, mockCacheLayer],
    ])

    const events: WatchEvent[] = []

    const program = Effect.gen(function* () {
      const indexer = yield* SemanticIndexer.Service

      const unsub = yield* indexer.watch({
        directory: tmpDir,
        debounceMs: 150,
        onEvent: (ev) => {
          events.push(ev)
        },
      })

      // Wait for watcher to initialize native subscription
      yield* Effect.sleep("150 millis")

      // Write a new file
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(tmpDir, "math.ts"),
          "export const square = (n: number) => n * n;\n",
        ),
      )

      // Wait for debounce and processing
      yield* Effect.sleep("600 millis")

      yield* Effect.promise(() => unsub())
    }).pipe(Effect.provide(testLayer))

    await Effect.runPromise(program)

    // Verify watcher emitted ready and indexed event
    expect(events.some((e) => e.type === "ready")).toBe(true)
    expect(events.some((e) => e.type === "indexed" && e.file.endsWith("math.ts"))).toBe(true)

    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  it("handles offline embedder gracefully with clear error description", async () => {
    const offlineEmbedderLayer = Layer.succeed(
      SemanticEmbedder.Service,
      SemanticEmbedder.Service.of({
        isAvailable: () => Effect.succeed(false),
        embedOne: () => Effect.die("offline"),
        embed: () => Effect.die("offline"),
      }),
    )

    const testLayer = LayerNode.compile(SemanticIndexer.node, [
      [SemanticEmbedder.node, offlineEmbedderLayer],
    ])

    const program = Effect.gen(function* () {
      const indexer = yield* SemanticIndexer.Service
      const res = yield* indexer.indexDirectory({
        directory: process.cwd(),
      })
      expect(res.ok).toBe(false)
      expect(res.error).toContain("offline")
    }).pipe(
      Effect.provide(testLayer),
    )

    await Effect.runPromise(program)
  })
})
