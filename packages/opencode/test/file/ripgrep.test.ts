import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Ripgrep } from "../../src/file/ripgrep"

describe("file.ripgrep", () => {
  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
        await Bun.write(path.join(dir, ".opencode", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".opencode", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
        await Bun.write(path.join(dir, ".opencode", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path, hidden: false }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".opencode", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    const hits = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle",
    })

    expect(hits).toEqual([])
  })
})

describe("Ripgrep.Service", () => {
  test("files returns stream of filenames", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "hello")
        await Bun.write(path.join(dir, "b.txt"), "world")
      },
    })

    const files = await Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      return yield* rg.files({ cwd: tmp.path }).pipe(
        Stream.runCollect,
        Effect.map((chunk) => [...chunk].sort()),
      )
    }).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromise)

    expect(files).toEqual(["a.txt", "b.txt"])
  })

  test("files respects glob filter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "keep.ts"), "yes")
        await Bun.write(path.join(dir, "skip.txt"), "no")
      },
    })

    const files = await Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      return yield* rg.files({ cwd: tmp.path, glob: ["*.ts"] }).pipe(
        Stream.runCollect,
        Effect.map((chunk) => [...chunk]),
      )
    }).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromise)

    expect(files).toEqual(["keep.ts"])
  })

  test("files dies on nonexistent directory", async () => {
    const exit = await Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      return yield* rg.files({ cwd: "/tmp/nonexistent-dir-12345" }).pipe(Stream.runCollect)
    }).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromiseExit)

    expect(exit._tag).toBe("Failure")
  })
})
