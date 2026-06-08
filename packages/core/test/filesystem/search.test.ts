import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Fff } from "#fff"
import { Search } from "@opencode-ai/core/filesystem/search"
import { testEffect } from "../lib/effect"

const it = testEffect(Search.defaultLayer)

const tmpdir = (init?: (dir: string) => Effect.Effect<void>) =>
  Effect.acquireRelease(
    Effect.promise(async () => fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-")))),
    (dir) =>
      Effect.promise(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })).pipe(
        Effect.ignore,
      ),
  ).pipe(Effect.tap((dir) => init?.(dir) ?? Effect.void))

const write = (file: string, data: string) => Effect.promise(() => Bun.write(file, data))
const waitForFileIndex = (search: Search.Interface, cwd: string) =>
  search.glob({ cwd, pattern: "**/*", limit: 1 }).pipe(Effect.ignore)

describe("file.search", () => {
  it.live("uses fff for Bun-backed grep", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "src", "match.ts"), "const needle = 1\n")

      const search = yield* Search.Service
      const result = yield* search.search({ cwd: dir, pattern: "needle", limit: 10 })

      expect(result.engine).toBe("fff")
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toBe("src/match.ts")
    }),
  )

  it.live("keeps fuzzy file abbreviation matches", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "README.md"), "hello\n")

      const search = yield* Search.Service
      yield* waitForFileIndex(search, dir)
      const results = yield* search.file({ cwd: dir, query: "rdme", limit: 10 })

      expect(results).toContain("README.md")
    }),
  )

  it.live("keeps empty file query candidates", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "README.md"), "hello\n")
      yield* write(path.join(dir, "src", "main.ts"), "export const main = true\n")

      const search = yield* Search.Service
      yield* waitForFileIndex(search, dir)
      const results = yield* search.file({ cwd: dir, query: "", limit: 10, kind: "all" })

      expect(results).toContain("README.md")
      expect(results).toContain("src/")
      expect(results).not.toContain("")
    }),
  )

  it.live("stabilizes equal score file candidates by path length", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "src", "longer-name.ts"), "export const longer = true\n")
      yield* write(path.join(dir, "a.ts"), "export const shorter = true\n")

      const search = yield* Search.Service
      yield* waitForFileIndex(search, dir)
      const results = yield* search.file({ cwd: dir, query: "", limit: 10 })

      expect(results?.slice(0, 2)).toEqual(["a.ts", "src/longer-name.ts"])
    }),
  )

  it.live("keeps paging grep results without an explicit limit", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "matches.txt"), Array.from({ length: 150 }, (_, idx) => `needle ${idx}\n`).join(""))

      const search = yield* Search.Service
      const result = yield* search.search({ cwd: dir, pattern: "needle" })

      expect(result.items).toHaveLength(150)
    }),
  )

  it.live("uses byte ranges for UTF-8 grep submatches", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "unicode.txt"), "éneedle\n")

      const search = yield* Search.Service
      const result = yield* search.search({ cwd: dir, pattern: "needle", limit: 10 })

      expect(result.items[0]?.submatches[0]?.match.text).toBe("needle")
    }),
  )

  it.live("post-filters fff grep include matches", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "src", "match.ts"), "needle\n")
      yield* write(path.join(dir, "src", "match.txt"), "needle\n")

      const search = yield* Search.Service
      const result = yield* search.search({ cwd: dir, pattern: "needle", glob: ["*.ts"], limit: 10 })

      expect(result.engine).toBe("fff")
      expect(result.items.map((entry) => entry.path.text)).toEqual(["src/match.ts"])
    }),
  )

  it.live("keeps fff grep include no-match results", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "src", "match.ts"), "needle\n")

      const search = yield* Search.Service
      const result = yield* search.search({ cwd: dir, pattern: "missing", glob: ["*.ts"], limit: 10 })

      expect(result.engine).toBe("fff")
      expect(result.items).toEqual([])
    }),
  )

  it.live("post-filters fff glob matches", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "src", "match.ts"), "export const value = 1\n")
      yield* write(path.join(dir, "src", "match.txt"), "hello\n")

      const search = yield* Search.Service
      const result = yield* search.glob({ cwd: dir, pattern: "**/*.ts", limit: 10 })

      expect(result.files).toEqual([path.join(dir, "src", "match.ts")])
    }),
  )

  it.live("tracks an opened file against its originating query", () =>
    Effect.gen(function* () {
      expect(Fff.available()).toBe(true)
      const dir = yield* tmpdir()
      yield* write(path.join(dir, "alpha-target-one.ts"), "export const one = 1\n")
      yield* write(path.join(dir, "alpha-target-two.ts"), "export const two = 2\n")

      const search = yield* Search.Service
      yield* waitForFileIndex(search, dir)
      const results = yield* search.file({ cwd: dir, query: "alpha target two", limit: 10 })
      expect(results).toContain("alpha-target-two.ts")

      // open() records the query->file association in fff's history db via the
      // live picker. It must resolve a remembered file and run without error.
      yield* search.open({ cwd: dir, file: "alpha-target-two.ts" })
    }),
  )
})
