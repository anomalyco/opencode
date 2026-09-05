import { describe, expect, test, mock } from "bun:test"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parsePluginEntries,
  entryName,
  serializeEntries,
  readConfig,
  mutateConfig,
  ConfigParseError,
  type ConfigTarget,
} from "./plugin-config"

const tmp = async () => mkdtemp(join(tmpdir(), "opencode-plugin-config-"))
const writeTarget = async (name: string, content: string): Promise<ConfigTarget> => {
  const dir = await tmp()
  const path = join(dir, name)
  await writeFile(path, content)
  return { path, jsonc: name.endsWith(".jsonc") }
}

describe("parsePluginEntries", () => {
  test("returns empty array for missing/invalid values", () => {
    expect(parsePluginEntries(undefined)).toEqual([])
    expect(parsePluginEntries(null)).toEqual([])
    expect(parsePluginEntries("nope")).toEqual([])
    expect(parsePluginEntries(42)).toEqual([])
  })
  test("keeps string and tuple entries, drops junk", () => {
    expect(parsePluginEntries(["a", ["b", { x: 1 }], 42, null])).toEqual(["a", ["b", { x: 1 }]])
  })
  test("drops malformed tuples", () => {
    expect(parsePluginEntries([["a"], ["b", { x: 1 }, "extra"]])).toEqual([["b", { x: 1 }]])
  })
})

describe("entryName / serializeEntries", () => {
  test("round-trips forms", () => {
    const entries: (string | [string, Record<string, unknown>])[] = ["a", ["b", { x: 1 }]]
    expect(entries.map(entryName)).toEqual(["a", "b"])
    expect(serializeEntries(entries)).toEqual(["a", ["b", { x: 1 }]])
  })
})

describe("readConfig", () => {
  test("reads plugins from json", async () => {
    const target = await writeTarget("opencode.json", `{"$schema":"x","plugin":["a"]}`)
    const cfg = await readConfig(target)
    expect(cfg.plugins).toEqual(["a"])
    expect(cfg.data.$schema).toBe("x")
  })
  test("jsonc preserves comments in raw and parses data", async () => {
    const target = await writeTarget(
      "opencode.jsonc",
      `{\n // my comment\n "model": "x", "plugin": ["a"]\n}`,
    )
    const cfg = await readConfig(target)
    expect(cfg.data.model).toBe("x")
    expect(cfg.plugins).toEqual(["a"])
    expect(cfg.raw).toContain("// my comment")
  })
  test("throws ConfigParseError with path on bad content", async () => {
    const target = await writeTarget("opencode.json", `{oops`)
    try {
      await readConfig(target)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigParseError)
      expect((e as ConfigParseError).path).toBe(target.path)
    }
  })
  test("missing file yields empty config", async () => {
    const cfg = await readConfig({ path: join(await tmp(), "opencode.json"), jsonc: false })
    expect(cfg.plugins).toEqual([])
    expect(cfg.raw).toBe("")
  })
})

describe("mutateConfig", () => {
  test("add writes plugin entry to json preserving unknown keys", async () => {
    const target = await writeTarget("opencode.json", `{"$schema":"x","model":"m"}`)
    const { changed } = await mutateConfig(target, { kind: "add", name: "opencode-wakatime" })
    expect(changed).toBe(true)
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.model).toBe("m")
    expect(data.$schema).toBe("x")
    expect(data.plugin).toEqual(["opencode-wakatime"])
  })
  test("add preserves tuple form when re-adding with entry", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    await mutateConfig(target, { kind: "add", name: "b", entry: ["b", { opt: true }] })
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.plugin).toEqual(["a", ["b", { opt: true }]])
  })
  test("add is idempotent by name", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    const { changed } = await mutateConfig(target, { kind: "add", name: "a" })
    expect(changed).toBe(false)
  })
  test("consecutive add of same entry reports unchanged on second call", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    const first = await mutateConfig(target, { kind: "add", name: "b", entry: ["b", { opt: 1 }] })
    expect(first.changed).toBe(true)
    const second = await mutateConfig(target, { kind: "add", name: "b", entry: ["b", { opt: 1 }] })
    expect(second.changed).toBe(false)
  })
  test("remove keeps other entries and tuple options", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a",["b",{x:1}]]}`)
    const { changed } = await mutateConfig(target, { kind: "remove", name: "b" })
    expect(changed).toBe(true)
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.plugin).toEqual(["a"])
  })
  test("remove of absent entry reports unchanged", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    const { changed } = await mutateConfig(target, { kind: "remove", name: "zzz" })
    expect(changed).toBe(false)
  })
  test("jsonc mutation preserves comments and formatting", async () => {
    const content = `{\n // keep me\n "model": "x",\n "plugin": ["a"]\n}`
    const target = await writeTarget("opencode.jsonc", content)
    await mutateConfig(target, { kind: "add", name: "b" })
    const out = await readFile(target.path, "utf8")
    expect(out).toContain("// keep me")
    expect(out).toContain(`"model": "x"`)
    const data = JSON.parse(out.replace(/\s*\/\/.*$/gm, ""))
    expect(data.plugin).toEqual(["a", "b"])
  })
  test("refuses to write on parse failure", async () => {
    const target = await writeTarget("opencode.json", `{oops`)
    await expect(mutateConfig(target, { kind: "add", name: "a" })).rejects.toBeInstanceOf(ConfigParseError)
    expect(await readFile(target.path, "utf8")).toBe(`{oops`)
  })
  test("conflict: plugin array changed on disk between read and write", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    // Simulate a race: capture config, then external process edits the file.
    const first = await readConfig(target)
    await writeFile(target.path, `{"plugin":["a","intruder"]}`)
    // mutateConfig re-reads internally; craft mutation against stale expectation
    // by removing "intruder" (which was not there at first read) — should still apply
    // since re-read strategy is: apply to latest content, only error if OUR
    // target entry's presence flipped unexpectedly.
    const { changed } = await mutateConfig(target, { kind: "add", name: "intruder" })
    expect(changed).toBe(true)
    expect(first.plugins).toEqual(["a"])
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.plugin).toContain("intruder")
  })

  test("conflict: unrelated plugin added on disk between internal read and write throws", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"],"model":"m"}`)
    // No prior caller read: mutateConfig's own readConfig IS the "before"
    // snapshot. Another writer lands between that read and the pre-write
    // re-read. Mock node:fs/promises so that after mutateConfig's first
    // internal read of this path, a concurrent write lands adding an
    // unrelated plugin; the pre-write re-read then sees divergent content.
    const fs = "node:fs/promises"
    const targetPath = target.path
    let injected = false
    mock.module(fs, () => {
      const actual = require(fs)
      const readFile = async (p: any, ...rest: any[]) => {
        const raw = await actual.readFile(p, ...rest)
        if (p === targetPath && !injected && String(raw).includes(`"plugin"`)) {
          injected = true
          await actual.writeFile(targetPath, `{"plugin":["a","unrelated"],"model":"m"}`)
        }
        return raw
      }
      const patched = { ...actual, readFile }
      return { ...patched, default: patched }
    })
    try {
      const { mutateConfig: mutated } = await import("./plugin-config")
      await expect(mutated(target, { kind: "add", name: "b" })).rejects.toThrow(/Config changed while editing/)
      const data = JSON.parse(await readFile(targetPath, "utf8"))
      // The concurrent writer's entry must survive — no silent clobber.
      expect(data.plugin).toEqual(["a", "unrelated"])
      expect(data.model).toBe("m")
    } finally {
      mock.restore()
    }
  })
})
