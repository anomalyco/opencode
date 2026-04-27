import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { Filesystem } from "../../src/util"
import { createPlugTask, type PlugCtx, type PlugDeps } from "../../src/cli/cmd/plug"
import { tmpdir } from "../fixture/fixture"

function deps(global: string, target: string | Error): PlugDeps {
  return {
    spinner: () => ({
      start() {},
      stop() {},
    }),
    log: {
      error() {},
      info() {},
      success() {},
    },
    resolve: async () => {
      if (target instanceof Error) throw target
      return target
    },
    readText: (file) => Filesystem.readText(file),
    write: async (file, text) => {
      await Filesystem.write(file, text)
    },
    exists: (file) => Filesystem.exists(file),
    files: (dir, name) => [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)],
    global,
  }
}

function ctx(dir: string): PlugCtx {
  return {
    vcs: "git",
    worktree: dir,
    directory: dir,
  }
}

function ctxDir(dir: string, worktree: string): PlugCtx {
  return {
    vcs: "none",
    worktree,
    directory: dir,
  }
}

function ctxRoot(dir: string): PlugCtx {
  return {
    vcs: "git",
    worktree: "/",
    directory: dir,
  }
}

async function plugin(
  dir: string,
  kinds?: Array<"server" | "tui">,
  opts?: {
    server?: Record<string, unknown>
    tui?: Record<string, unknown>
  },
  themes?: string[],
) {
  const p = path.join(dir, "plugin")
  const server = kinds?.includes("server") ?? false
  const tui = kinds?.includes("tui") ?? false
  const exports: Record<string, unknown> = {}
  if (server) {
    exports["./server"] = opts?.server
      ? {
          import: "./server.js",
          config: opts.server,
        }
      : "./server.js"
  }
  if (tui) {
    exports["./tui"] = opts?.tui
      ? {
          import: "./tui.js",
          config: opts.tui,
        }
      : "./tui.js"
  }
  await fs.mkdir(p, { recursive: true })
  await Bun.write(
    path.join(p, "package.json"),
    JSON.stringify(
      {
        name: "acme",
        version: "1.0.0",
        ...(server ? { main: "./server.js" } : {}),
        ...(Object.keys(exports).length ? { exports } : {}),
        ...(themes?.length ? { "oc-themes": themes } : {}),
      },
      null,
      2,
    ),
  )
  return p
}

async function read(file: string) {
  return Filesystem.readJson<{
    plugin?: unknown[]
  }>(file)
}

describe("plugin.install.task", () => {
  test("writes both server and tui config entries", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server", "tui"])
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)

    const server = await read(path.join(tmp.path, ".opencode", "opencode.jsonc"))
    const tui = await read(path.join(tmp.path, ".opencode", "tui.jsonc"))
    expect(server.plugin).toEqual(["acme@1.2.3"])
    expect(tui.plugin).toEqual(["acme@1.2.3"])
  })

  test("writes default options from exports config metadata", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server", "tui"], {
      server: { custom: true, other: false },
      tui: { compact: true },
    })
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)

    const server = await read(path.join(tmp.path, ".opencode", "opencode.jsonc"))
    const tui = await read(path.join(tmp.path, ".opencode", "tui.jsonc"))
    expect(server.plugin).toEqual([["acme@1.2.3", { custom: true, other: false }]])
    expect(tui.plugin).toEqual([["acme@1.2.3", { compact: true }]])
  })

  test("preserves JSONC comments when adding plugins to server and tui config", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server", "tui"])
    const cfg = path.join(tmp.path, ".opencode")
    const server = path.join(cfg, "opencode.jsonc")
    const tui = path.join(cfg, "tui.jsonc")
    await fs.mkdir(cfg, { recursive: true })
    await Bun.write(
      server,
      `{
  // server head
  "plugin": [
    // server keep
    "seed@1.0.0"
  ],
  // server tail
  "model": "x"
}
`,
    )
    await Bun.write(
      tui,
      `{
  // tui head
  "plugin": [
    // tui keep
    "seed@1.0.0"
  ],
  // tui tail
  "theme": "opencode"
}
`,
    )

    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)

    const serverText = await fs.readFile(server, "utf8")
    const tuiText = await fs.readFile(tui, "utf8")
    expect(serverText).toContain("// server head")
    expect(serverText).toContain("// server keep")
    expect(serverText).toContain("// server tail")
    expect(tuiText).toContain("// tui head")
    expect(tuiText).toContain("// tui keep")
    expect(tuiText).toContain("// tui tail")

    const serverJson = parseJsonc(serverText) as { plugin?: unknown[] }
    const tuiJson = parseJsonc(tuiText) as { plugin?: unknown[] }
    expect(serverJson.plugin).toEqual(["seed@1.0.0", "acme@1.2.3"])
    expect(tuiJson.plugin).toEqual(["seed@1.0.0", "acme@1.2.3"])
  })

  test("preserves JSONC comments when force replacing plugin version", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".opencode", "opencode.jsonc")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await Bun.write(
      cfg,
      `{
  "plugin": [
    // keep this note
    "acme@1.0.0"
  ]
}
`,
    )

    const run = createPlugTask(
      {
        mod: "acme@2.0.0",
        force: true,
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)

    const text = await fs.readFile(cfg, "utf8")
    expect(text).toContain("// keep this note")

    const json = parseJsonc(text) as { plugin?: unknown[] }
    expect(json.plugin).toEqual(["acme@2.0.0"])
  })

  test("supports resolver target pointing to a file", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const file = path.join(target, "index.js")
    await Bun.write(file, "export {}")
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), file),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    const server = await read(path.join(tmp.path, ".opencode", "opencode.jsonc"))
    expect(server.plugin).toEqual(["acme@1.2.3"])
  })

  test("does not change configured package version without force", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".opencode", "opencode.json")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await Bun.write(cfg, JSON.stringify({ plugin: ["acme@1.0.0"] }, null, 2))

    const run = createPlugTask(
      {
        mod: "acme@2.0.0",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    const json = await read(cfg)
    expect(json.plugin).toEqual(["acme@1.0.0"])
  })

  test("does not change scoped package version without force", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".opencode", "opencode.json")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await Bun.write(cfg, JSON.stringify({ plugin: ["@scope/acme@1.0.0"] }, null, 2))

    const run = createPlugTask(
      {
        mod: "@scope/acme@2.0.0",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    const json = await read(cfg)
    expect(json.plugin).toEqual(["@scope/acme@1.0.0"])
  })

  test("keeps file plugin entries and still adds npm plugin", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".opencode", "opencode.json")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await Bun.write(cfg, JSON.stringify({ plugin: ["file:///tmp/acme.ts"] }, null, 2))

    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    const json = await read(cfg)
    expect(json.plugin).toEqual(["file:///tmp/acme.ts", "acme@1.2.3"])
  })

  test("force replaces configured package version and keeps tuple options", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".opencode", "opencode.json")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await Bun.write(
      cfg,
      JSON.stringify(
        {
          plugin: [["acme@1.0.0", { mode: "safe" }], "acme@1.1.0", "other@1.0.0"],
        },
        null,
        2,
      ),
    )

    const run = createPlugTask(
      {
        mod: "acme@2.0.0",
        force: true,
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    const json = await read(cfg)
    expect(json.plugin).toEqual([["acme@2.0.0", { mode: "safe" }], "other@1.0.0"])
  })

  test("writes to global scope when global flag is set", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const global = path.join(tmp.path, "global")
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
        global: true,
      },
      deps(global, target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)

    expect(await Filesystem.exists(path.join(global, "opencode.jsonc"))).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
  })

  test("writes local scope under directory when vcs is not git", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const directory = path.join(tmp.path, "dir")
    const worktree = path.join(tmp.path, "worktree")
    await fs.mkdir(directory, { recursive: true })
    await fs.mkdir(worktree, { recursive: true })
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctxDir(directory, worktree))
    expect(ok).toBe(true)
    expect(await Filesystem.exists(path.join(directory, ".opencode", "opencode.jsonc"))).toBe(true)
    expect(await Filesystem.exists(path.join(worktree, ".opencode", "opencode.jsonc"))).toBe(false)
  })

  test("writes local scope under directory when worktree is root slash", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const directory = path.join(tmp.path, "dir")
    await fs.mkdir(directory, { recursive: true })
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctxRoot(directory))
    expect(ok).toBe(true)
    expect(await Filesystem.exists(path.join(directory, ".opencode", "opencode.jsonc"))).toBe(true)
  })

  test("writes tui local scope under directory when worktree is root slash", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["tui"])
    const directory = path.join(tmp.path, "dir")
    await fs.mkdir(directory, { recursive: true })
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctxRoot(directory))
    expect(ok).toBe(true)
    expect(await Filesystem.exists(path.join(directory, ".opencode", "tui.jsonc"))).toBe(true)
  })

  test("writes only tui config for tui-only plugins", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["tui"])
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "tui.jsonc"))).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
  })

  test("writes tui config for oc-themes-only packages", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, undefined, undefined, ["themes/forest.json"])
    await fs.mkdir(path.join(target, "themes"), { recursive: true })
    await Bun.write(path.join(target, "themes", "forest.json"), JSON.stringify({ theme: { text: "#fff" } }, null, 2))
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "tui.jsonc"))).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)

    const tui = await read(path.join(tmp.path, ".opencode", "tui.jsonc"))
    expect(tui.plugin).toEqual(["acme@1.2.3"])
  })

  test("returns false for oc-themes outside plugin directory", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, undefined, undefined, ["../outside.json"])
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(false)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "tui.jsonc"))).toBe(false)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
  })

  test("force replaces version in both server and tui configs", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server", "tui"])
    const server = path.join(tmp.path, ".opencode", "opencode.json")
    const tui = path.join(tmp.path, ".opencode", "tui.json")
    await fs.mkdir(path.dirname(server), { recursive: true })
    await Bun.write(server, JSON.stringify({ plugin: ["acme@1.0.0", "other@1.0.0"] }, null, 2))
    await Bun.write(tui, JSON.stringify({ plugin: [["acme@1.0.0", { mode: "safe" }], "other@1.0.0"] }, null, 2))

    const run = createPlugTask(
      {
        mod: "acme@2.0.0",
        force: true,
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(true)
    const serverJson = await read(server)
    const tuiJson = await read(tui)
    expect(serverJson.plugin).toEqual(["acme@2.0.0", "other@1.0.0"])
    expect(tuiJson.plugin).toEqual([["acme@2.0.0", { mode: "safe" }], "other@1.0.0"])
  })

  test("returns false and keeps config unchanged for invalid JSONC", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".opencode", "opencode.jsonc")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    const bad = '{"plugin": ["acme@1.0.0",}'
    await Bun.write(cfg, bad)

    const run = createPlugTask(
      {
        mod: "acme@2.0.0",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(false)
    expect(await fs.readFile(cfg, "utf8")).toBe(bad)
  })

  test("returns false when manifest declares no supported targets", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path)
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(false)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "tui.jsonc"))).toBe(false)
  })

  test("returns false when manifest cannot be read", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "plugin")
    await fs.mkdir(target, { recursive: true })
    const run = createPlugTask(
      {
        mod: "acme@1.2.3",
      },
      deps(path.join(tmp.path, "global"), target),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(false)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
  })

  test("returns false when install fails", async () => {
    await using tmp = await tmpdir()
    const run = createPlugTask(
      {
        mod: "acme@9.9.9",
      },
      deps(path.join(tmp.path, "global"), new Error("boom")),
    )

    const ok = await run(ctx(tmp.path))
    expect(ok).toBe(false)
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
  })
})
