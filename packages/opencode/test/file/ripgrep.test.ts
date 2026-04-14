import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Ripgrep } from "../../src/file/ripgrep"

async function seed(dir: string, count: number, size = 16) {
  const txt = "a".repeat(size)
  await Promise.all(Array.from({ length: count }, (_, i) => Bun.write(path.join(dir, `file-${i}.txt`), `${txt}${i}\n`)))
}

function env(name: string, value: string | undefined) {
  const prev = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  return () => {
    if (prev === undefined) delete process.env[name]
    else process.env[name] = prev
  }
}

describe("file.ripgrep", () => {
  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
        await Bun.write(path.join(dir, ".opencode", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(await Ripgrep.files({ cwd: tmp.path }))
    expect(files.includes("visible.txt")).toBe(true)
    expect(files.includes(path.join(".opencode", "thing.json"))).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
        await Bun.write(path.join(dir, ".opencode", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(await Ripgrep.files({ cwd: tmp.path, hidden: false }))
    expect(files.includes("visible.txt")).toBe(true)
    expect(files.includes(path.join(".opencode", "thing.json"))).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    const result = await Ripgrep.search({ cwd: tmp.path, pattern: "needle" })
    expect(result.partial).toBe(false)
    expect(result.items).toEqual([])
  })

  test("search returns match metadata with normalized path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "match.ts"), "const needle = 1\n")
      },
    })

    const result = await Ripgrep.search({ cwd: tmp.path, pattern: "needle" })
    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path.text).toBe(path.join("src", "match.ts"))
    expect(result.items[0]?.line_number).toBe(1)
    expect(result.items[0]?.lines.text).toContain("needle")
  })

  test("files returns empty when glob matches no files in worker mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "packages", "console"), { recursive: true })
        await Bun.write(path.join(dir, "packages", "console", "package.json"), "{}")
      },
    })

    const ctl = new AbortController()
    const files = await Array.fromAsync(
      await Ripgrep.files({
        cwd: tmp.path,
        glob: ["packages/*"],
        signal: ctl.signal,
      }),
    )

    expect(files).toEqual([])
  })

  test("ignores RIPGREP_CONFIG_PATH in direct mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const needle = 1\n")
      },
    })

    const restore = env("RIPGREP_CONFIG_PATH", path.join(tmp.path, "missing-ripgreprc"))
    try {
      const result = await Ripgrep.search({ cwd: tmp.path, pattern: "needle" })
      expect(result.items).toHaveLength(1)
    } finally {
      restore()
    }
  })

  test("ignores RIPGREP_CONFIG_PATH in worker mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const needle = 1\n")
      },
    })

    const restore = env("RIPGREP_CONFIG_PATH", path.join(tmp.path, "missing-ripgreprc"))
    try {
      const ctl = new AbortController()
      const result = await Ripgrep.search({
        cwd: tmp.path,
        pattern: "needle",
        signal: ctl.signal,
      })
      expect(result.items).toHaveLength(1)
    } finally {
      restore()
    }
  })

  test("aborts files scan in worker mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await seed(dir, 4000)
      },
    })

    const ctl = new AbortController()
    const iter = await Ripgrep.files({ cwd: tmp.path, signal: ctl.signal })
    const pending = Array.fromAsync(iter)
    setTimeout(() => ctl.abort(), 0)

    const err = await pending.catch((err) => err)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("AbortError")
  }, 15_000)

  test("aborts search in worker mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await seed(dir, 512, 64 * 1024)
      },
    })

    const ctl = new AbortController()
    const pending = Ripgrep.search({ cwd: tmp.path, pattern: "needle", signal: ctl.signal })
    setTimeout(() => ctl.abort(), 0)

    const err = await pending.catch((err) => err)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("AbortError")
  }, 15_000)
})

describe("Ripgrep.Service", () => {
  test("search returns matched rows", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'needle'\n")
        await Bun.write(path.join(dir, "skip.txt"), "const value = 'other'\n")
      },
    })

    const result = await Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      return yield* rg.search({ cwd: tmp.path, pattern: "needle", glob: ["*.ts"] })
    }).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromise)

    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path.text).toContain("match.ts")
    expect(result.items[0]?.lines.text).toContain("needle")
  })

  test("search supports explicit file targets", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'needle'\n")
        await Bun.write(path.join(dir, "skip.ts"), "const value = 'needle'\n")
      },
    })

    const file = path.join(tmp.path, "match.ts")
    const result = await Effect.gen(function* () {
      const rg = yield* Ripgrep.Service
      return yield* rg.search({ cwd: tmp.path, pattern: "needle", file: [file] })
    }).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.runPromise)

    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path.text).toBe(file)
  })

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
