import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerPluginManager } from "./plugin-manager"

// Bun caches os.homedir() at process start, so runtime process.env.HOME
// overrides never take effect. Patch homedir() to read HOME at call time;
// plugin-config's ESM import of node:os resolves through this mock.
mock.module("node:os", () => {
  const actual = require("node:os")
  const patched = { ...actual, homedir: () => process.env.HOME ?? "/mock-home" }
  return { ...patched, default: patched }
})

type Recorded = { channel: string; fn: (...args: any[]) => any }
// electron-store cannot initialize outside the Electron runtime (it touches
// electron.app.getPath), so tests inject a Map-backed store via the optional
// `store` dependency on registerPluginManager.
const makeStoreStub = () => {
  const map = new Map<string, string>()
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: string) => void map.set(key, value),
  }
}
const makeHarness = () => {
  const recorded: Recorded[] = []
  const handlers = {
    handle: (channel: string, fn: (...args: any[]) => any) => recorded.push({ channel, fn }),
  }
  const call = async (channel: string, ...args: any[]) => {
    const found = recorded.find((r) => r.channel === channel)
    if (!found) throw new Error("no handler: " + channel)
    return await found.fn({} as any, ...args)
  }
  return { handlers, recorded, call }
}

const home = process.env.HOME!

describe("registerPluginManager", () => {
  let userData: string
  let project: string
  let savedHome: string | undefined
  let tempHome: string | undefined
  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "opencode-pm-user-"))
    project = await mkdtemp(join(tmpdir(), "opencode-pm-proj-"))
    savedHome = process.env.HOME
    tempHome = await mkdtemp(join(tmpdir(), "opencode-pm-home-"))
    process.env.HOME = tempHome
  })
  afterEach(async () => {
    // Restore HOME first, then remove the temp home while it is still referenced
    process.env.HOME = savedHome
    for (const d of [userData, project, tempHome]) {
      if (typeof d === "string") await rm(d, { recursive: true, force: true })
    }
  })

  test("install global writes ~/.config/opencode/opencode.json", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, store: makeStoreStub() })
    await h.call("plugins:install", "opencode-wakatime", undefined, "global", project)
    const content = await readFile(join(process.env.HOME!, ".config/opencode/opencode.json"), "utf8")
    expect(JSON.parse(content).plugin).toEqual(["opencode-wakatime"])
  })

  test("install project writes <dir>/opencode.json", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, store: makeStoreStub() })
    await h.call("plugins:install", "opencode-wakatime", ["opencode-wakatime", { a: 1 }], "project", project)
    const content = await readFile(join(project, "opencode.json"), "utf8")
    expect(JSON.parse(content).plugin).toEqual([["opencode-wakatime", { a: 1 }]])
  })

  test("read-configs returns both scopes with provenance", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, store: makeStoreStub() })
    await writeFile(join(project, "opencode.json"), `{"plugin":["a",["b",{"x":1}]]}`)
    const configs = await h.call("plugins:read-configs", project)
    expect(configs.global).toEqual([])
    expect(configs.project).toEqual(["a", ["b", { x: 1 }]])
    expect(configs.paths.global).toContain("opencode.json")
    expect(configs.paths.project).toBe(join(project, "opencode.json"))
  })

  test("remove with remember records recently-removed and re-enable restores", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, store: makeStoreStub() })
    await writeFile(join(project, "opencode.json"), `{"plugin":[["b",{"x":1}]]}`)
    await h.call("plugins:remove", "b", "project", true, project)
    const content = await readFile(join(project, "opencode.json"), "utf8")
    expect(JSON.parse(content).plugin).toEqual([])
    const configs = await h.call("plugins:read-configs", project)
    expect(configs.recentlyRemoved).toHaveLength(1)
    expect(configs.recentlyRemoved[0].name).toBe("b")
    expect(configs.recentlyRemoved[0].entry).toEqual(["b", { x: 1 }])
    // re-enable
    await h.call("plugins:install", "b", ["b", { x: 1 }], "project", project)
    const after = await h.call("plugins:read-configs", project)
    expect(after.recentlyRemoved).toHaveLength(0)
  })

  test("remove without forget drops the record entirely (uninstall)", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, store: makeStoreStub() })
    await writeFile(join(project, "opencode.json"), `{"plugin":["b"]}`)
    await h.call("plugins:remove", "b", "project", false, project)
    const configs = await h.call("plugins:read-configs", project)
    expect(configs.recentlyRemoved).toHaveLength(0)
  })

  test("catalog channel returns entries array", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, store: makeStoreStub(), catalog: { entries: [], fetchedAt: 1, stale: false } })
    const result = await h.call("plugins:fetch-catalog")
    expect(Array.isArray(result.entries)).toBe(true)
  })
})