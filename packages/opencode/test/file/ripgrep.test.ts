import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"
import { testEffect } from "../lib/effect"

const it = testEffect(Ripgrep.defaultLayer)

const tmpdir = (init?: (dir: string) => Effect.Effect<void>) =>
  Effect.acquireRelease(
    Effect.promise(async () => fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-")))),
    (dir) =>
      Effect.promise(() =>
        fs.rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        }),
      ).pipe(Effect.ignore),
  ).pipe(Effect.tap((dir) => init?.(dir) ?? Effect.void))

const write = (file: string, data: string) => Effect.promise(() => Bun.write(file, data))
const mkdir = (dir: string) => Effect.promise(() => fs.mkdir(dir, { recursive: true }))
const collectFiles = (input: Ripgrep.FilesInput) =>
  Ripgrep.Service.use((rg) =>
    rg.files(input).pipe(
      Stream.runCollect,
      Effect.map((c) => [...c]),
    ),
  )

const withRipgrepConfig = <A, E, R>(value: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env["RIPGREP_CONFIG_PATH"]
      process.env["RIPGREP_CONFIG_PATH"] = value
      return prev
    }),
    () => effect,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env["RIPGREP_CONFIG_PATH"]
        else process.env["RIPGREP_CONFIG_PATH"] = prev
      }),
  )

describe("file.ripgrep", () => {
  it.live("defaults to include hidden", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "visible.txt"), "hello")
          yield* mkdir(path.join(dir, ".opencode"))
          yield* write(path.join(dir, ".opencode", "thing.json"), "{}")
        }),
      )

      const files = yield* collectFiles({ cwd: dir })
      expect(files.includes("visible.txt")).toBe(true)
      expect(files.includes(path.join(".opencode", "thing.json"))).toBe(true)
    }),
  )

  it.live("hidden false excludes hidden", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "visible.txt"), "hello")
          yield* mkdir(path.join(dir, ".opencode"))
          yield* write(path.join(dir, ".opencode", "thing.json"), "{}")
        }),
      )

      const files = yield* collectFiles({ cwd: dir, hidden: false })
      expect(files.includes("visible.txt")).toBe(true)
      expect(files.includes(path.join(".opencode", "thing.json"))).toBe(false)
    }),
  )

  it.live("search returns empty when nothing matches", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const value = 'other'\n"))

      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" }))
      expect(result.partial).toBe(false)
      expect(result.items).toEqual([])
    }),
  )

  it.live("search returns match metadata with normalized path", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* mkdir(path.join(dir, "src"))
          yield* write(path.join(dir, "src", "match.ts"), "const needle = 1\n")
        }),
      )

      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" }))
      expect(result.partial).toBe(false)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toBe(path.join("src", "match.ts"))
      expect(result.items[0]?.line_number).toBe(1)
      expect(result.items[0]?.lines.text).toContain("needle")
    }),
  )

  it.live("search returns matched rows with glob filter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "match.ts"), "const value = 'needle'\n")
          yield* write(path.join(dir, "skip.txt"), "const value = 'other'\n")
        }),
      )

      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle", glob: ["*.ts"] }))
      expect(result.partial).toBe(false)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toContain("match.ts")
      expect(result.items[0]?.lines.text).toContain("needle")
    }),
  )

  it.live("search supports explicit file targets", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "match.ts"), "const value = 'needle'\n")
          yield* write(path.join(dir, "skip.ts"), "const value = 'needle'\n")
        }),
      )

      const file = path.join(dir, "match.ts")
      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle", file: [file] }))
      expect(result.partial).toBe(false)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toBe(file)
    }),
  )

  it.live("files returns empty when glob matches no files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* mkdir(path.join(dir, "packages", "console"))
          yield* write(path.join(dir, "packages", "console", "package.json"), "{}")
        }),
      )

      const files = yield* collectFiles({ cwd: dir, glob: ["packages/*"] })
      expect(files).toEqual([])
    }),
  )

  it.live("files returns stream of filenames", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "a.txt"), "hello")
          yield* write(path.join(dir, "b.txt"), "world")
        }),
      )

      const files = yield* collectFiles({ cwd: dir }).pipe(Effect.map((files) => files.sort()))
      expect(files).toEqual(["a.txt", "b.txt"])
    }),
  )

  it.live("files respects glob filter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "keep.ts"), "yes")
          yield* write(path.join(dir, "skip.txt"), "no")
        }),
      )

      const files = yield* collectFiles({ cwd: dir, glob: ["*.ts"] })
      expect(files).toEqual(["keep.ts"])
    }),
  )

  it.live("files dies on nonexistent directory", () =>
    Effect.gen(function* () {
      const exit = yield* Ripgrep.Service.use((rg) =>
        rg.files({ cwd: "/tmp/nonexistent-dir-12345" }).pipe(Stream.runCollect),
      ).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.live("ignores RIPGREP_CONFIG_PATH in direct mode", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const needle = 1\n"))

      const result = yield* withRipgrepConfig(
        path.join(dir, "missing-ripgreprc"),
        Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" })),
      )
      expect(result.items).toHaveLength(1)
    }),
  )

  it.live("ignores RIPGREP_CONFIG_PATH in worker mode", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const needle = 1\n"))

      const result = yield* withRipgrepConfig(
        path.join(dir, "missing-ripgreprc"),
        Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" })),
      )
      expect(result.items).toHaveLength(1)
    }),
  )
})
