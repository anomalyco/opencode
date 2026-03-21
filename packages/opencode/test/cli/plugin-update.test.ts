import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const seen = {
  install: [] as Array<{ pkg: string; version: string }>,
  load: 0,
  out: [] as string[],
}

mock.module("../../src/project/instance", () => ({
  Instance: {
    provide: async (input: { directory: string; fn: () => Promise<unknown> | unknown }) => input.fn(),
    directory: process.cwd(),
    worktree: process.cwd(),
  },
}))

mock.module("../../src/config/config", () => ({
  Config: {
    getGlobal: async () => ({ plugin: ["foo", "@scope/bar@1.2.3", "file:///tmp/plugin.ts", "npm:baz@latest"] }),
    readFile: async () => undefined,
    deduplicatePlugins: (list: string[]) => Array.from(new Set(list)),
  },
}))

mock.module("../../src/config/paths", () => ({
  ConfigPaths: {
    projectFiles: async () => [],
    fileInDirectory: () => [],
    parseText: async (text: string) => JSON.parse(text),
  },
}))

mock.module("../../src/bun", () => ({
  BunProc: {
    install: async (pkg: string, version: string) => {
      seen.install.push({ pkg, version })
      return `/tmp/node_modules/${pkg}`
    },
  },
}))

mock.module("../../src/plugin/index", () => ({
  Plugin: {
    init: async () => {
      seen.load += 1
    },
    list: async () => [],
  },
}))

mock.module("../../src/cli/ui", () => ({
  UI: {
    println: (msg: string) => seen.out.push(msg),
    error: (msg: string) => seen.out.push(msg),
    empty: () => {},
    logo: () => "",
    Style: { TEXT_SUCCESS_BOLD: "", TEXT_NORMAL: "" },
  },
}))

describe("plugin update", () => {
  afterEach(() => {
    seen.install.length = 0
    seen.out.length = 0
    seen.load = 0
    process.exitCode = 0
  })

  test("classifies plugin specifiers through command output", async () => {
    const mod = await import("../../src/config/config")
    const spy = spyOn(mod.Config, "getGlobal").mockResolvedValue({
      plugin: [
        "foo",
        "@scope/foo",
        "foo@1.0.0",
        "file:///tmp/plugin.ts",
        "opencode-copilot-auth@1.2.3",
        "foo@github:acme/foo",
        "foo/bar",
      ],
    })
    const { PluginUpdateCommand } = await import("../../src/cli/cmd/plugin")

    await PluginUpdateCommand.handler({ _: [], $0: "opencode" })

    expect(seen.install).toEqual([
      { pkg: "foo", version: "latest" },
      { pkg: "@scope/foo", version: "latest" },
    ])
    expect(seen.out.join("\n")).toContain("skipped_locked foo@1.0.0")
    expect(seen.out.join("\n")).toContain("skipped_local file:///tmp/plugin.ts")
    expect(seen.out.join("\n")).toContain("skipped_ignored opencode-copilot-auth@1.2.3")
    expect(seen.out.join("\n")).toContain("skipped_unsupported foo@github:acme/foo")
    expect(seen.out.join("\n")).toContain("skipped_unsupported foo/bar")
    spy.mockRestore()
  })

  test("updates npm plugins and skips locked, local, unsupported entries", async () => {
    const { PluginUpdateCommand } = await import("../../src/cli/cmd/plugin")

    await PluginUpdateCommand.handler({ _: [], $0: "opencode" })

    expect(seen.install).toEqual([{ pkg: "foo", version: "latest" }])
    expect(seen.load).toBe(0)
    expect(seen.out.join("\n")).toContain("foo")
    expect(seen.out.join("\n")).toContain("skipped_locked")
    expect(seen.out.join("\n")).toContain("skipped_local")
    expect(seen.out.join("\n")).toContain("skipped_unsupported")
  })

  test("returns success when there are no updatable npm plugins", async () => {
    const mod = await import("../../src/config/config")
    const spy = spyOn(mod.Config, "getGlobal").mockResolvedValue({ plugin: ["file:///tmp/plugin.ts", "foo@1.0.0"] })
    const { PluginUpdateCommand } = await import("../../src/cli/cmd/plugin")

    await PluginUpdateCommand.handler({ _: [], $0: "opencode" })

    expect(seen.install).toEqual([])
    expect(seen.out.join("\n")).toContain("No config npm plugins to update")
    expect(seen.out.join("\n")).toContain("updated=0 current=0 skipped=2 failed=0")
    spy.mockRestore()
  })

  test("reports current when installed version does not change", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-plugin-update-"))
    const cache = path.join(root, "cache")
    const mod = await import("../../src/config/config")
    const bun = await import("../../src/bun")
    const global = await import("../../src/global")
    const cfg = spyOn(mod.Config, "getGlobal").mockResolvedValue({ plugin: ["foo"] })
    const install = spyOn(bun.BunProc, "install").mockImplementation(async (pkg) => {
      const file = path.join(cache, "node_modules", pkg, "package.json")
      await fs.mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, JSON.stringify({ version: "1.0.0" }))
      seen.install.push({ pkg, version: "latest" })
      return path.dirname(file)
    })

    await fs.mkdir(path.join(cache, "node_modules", "foo"), { recursive: true })
    await Bun.write(path.join(cache, "node_modules", "foo", "package.json"), JSON.stringify({ version: "1.0.0" }))

    const prev = global.Global.Path.cache
    ;(global.Global.Path as { cache: string }).cache = cache

    try {
      const { PluginUpdateCommand } = await import("../../src/cli/cmd/plugin")
      await PluginUpdateCommand.handler({ _: [], $0: "opencode" })
      expect(seen.out.join("\n")).toContain("current foo")
    } finally {
      ;(global.Global.Path as { cache: string }).cache = prev
      install.mockRestore()
      cfg.mockRestore()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("reports install failures with cause and sets exit code", async () => {
    const mod = await import("../../src/config/config")
    const bun = await import("../../src/bun")
    const cfg = spyOn(mod.Config, "getGlobal").mockResolvedValue({ plugin: ["foo"] })
    const install = spyOn(bun.BunProc, "install").mockRejectedValue(new Error("fetch failed"))
    const { PluginUpdateCommand } = await import("../../src/cli/cmd/plugin")

    await PluginUpdateCommand.handler({ _: [], $0: "opencode" })

    expect(seen.out.join("\n")).toContain("failed foo fetch failed")
    expect(process.exitCode).toBe(1)
    install.mockRestore()
    cfg.mockRestore()
  })
})
