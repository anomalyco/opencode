import { expect, test } from "bun:test"
import type { PluginInfo } from "@opencode-ai/client"
import type { PackageStatus } from "@opencode-ai/schema/plugin"
import { Global } from "@opencode-ai/util/global"
import { InputRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Info } from "../src/config"
import type { PackageResolver } from "../src/plugin/context"
import { probe } from "./fixture/plugin-inspection"
import { tmpdir } from "./fixture/fixture"
import { createEventStream, createFetch, json } from "./fixture/tui-client"

const target = "fixture-plugin@latest"
const entrypoint = new URL("./fixture/plugin-inspection.tsx", import.meta.url).href

async function boot(
  directory: string,
  options: {
    width?: number
    kittyKeyboard?: boolean
    plugins?: Info["plugins"]
    server?: () => PluginInfo[]
    check?: PackageResolver["check"]
    resolve?: PackageResolver["resolve"]
  } = {},
) {
  const app = await createTestRenderer({
    width: options.width ?? 100,
    height: 24,
    useThread: false,
    kittyKeyboard: options.kittyKeyboard ?? true,
  })
  const location = { directory, project: { id: "proj_fixture", directory, canonical: directory } }
  const events = createEventStream()
  const requests: { path: string; directory: string | null; target: string }[] = []
  const calls = createFetch(async (url, request) => {
    if (url.pathname.startsWith("/api/plugin/")) {
      const body = await request.json()
      requests.push({ path: url.pathname, directory: url.searchParams.get("location[directory]"), target: body.target })
      return json({ location, data: { installed: "9.0.0", available: "10.0.0", mutable: true } })
    }
    if (url.pathname === "/api/plugin") {
      return json({ location, data: options.server?.() ?? [] })
    }
    if (url.pathname === "/api/location")
      return json({ ...location, directory: url.searchParams.get("location[directory]") ?? directory })
    if (url.pathname === "/api/fs/list") return json({ location, data: [] })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const config: Info = { animations: false, plugins: options.plugins ?? [target], keybinds: { "plugins.list": "f6" } }
  const cwd = process.cwd()
  process.chdir(directory)
  probe.setups = 0
  probe.cleanups = 0
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => structuredClone(config),
        update: async (update) => {
          update(config)
          return structuredClone(config)
        },
      },
      packages: {
        resolve: options.resolve ?? (async () => ({ entrypoint, revision: "1.0.0" })),
        check: options.check ?? (async () => ({ installed: "1.0.0", available: "2.0.0", mutable: true })),
      },
      terminalHandoff: async () => ({ renderer: app.renderer, mode: "dark", complete: () => {} }),
      args: {},
      log: () => {},
    }).pipe(
      Effect.provide(
        Global.layerWith(
          Object.fromEntries(
            ["home", "config", "data", "cache", "state", "tmp", "bin", "log", "repos"].map((name) => [
              name,
              path.join(directory, name),
            ]),
          ),
        ),
      ),
      Effect.provide(FileSystem.layerNoop({})),
    ),
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Ask anything"), { maxPasses: 100 })
  return {
    ...app,
    events,
    requests,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await task.finally(async () => {
        process.chdir(cwd)
        events.disconnect()
        await server.stop(true)
      })
    },
  }
}

async function open(app: Awaited<ReturnType<typeof boot>>, search = "fixture.inspection") {
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => frame.includes("Plugins") && frame.includes("Search"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText(search)
  await app.waitForFrame((frame) => frame.includes(search) && !frame.includes("Search"))
}

test("explicit checks are read-only, retain loaded snapshots, and preserve toggle/filter behavior", async () => {
  await using tmp = await tmpdir()
  const checked: string[] = []
  const resolved: string[] = []
  let disk = "1.0.0"
  await using app = await boot(tmp.path, {
    resolve: async (spec) => {
      resolved.push(spec)
      return { entrypoint, revision: disk }
    },
    check: async (spec) => {
      checked.push(spec)
      return { installed: disk, available: "3.0.0", mutable: true }
    },
  })
  await open(app)
  expect(checked).toEqual([])
  app.mockInput.pressEnter()
  const details = await app.waitForFrame((frame) => frame.includes("Loaded") && frame.includes("Check for updates"))
  expect(details).toContain("1.0.0")
  expect(details).not.toMatch(/Update package|Reload installed|Enable in this terminal/)
  disk = "2.0.0"
  app.mockInput.pressKey("r", { ctrl: true })
  const result = await app.waitForFrame((frame) => frame.includes("New revision available"))
  expect(result).toMatch(/Loaded\s+1\.0\.0/)
  expect(result).toMatch(/Installed\s+2\.0\.0/)
  expect(checked).toEqual([target])
  expect(resolved).toEqual([target])
  expect([probe.setups, probe.cleanups]).toEqual([1, 0])
  expect(app.requests).toEqual([])
  await expect(probe.plugins().check("unconfigured-plugin")).rejects.toThrow("Not a configured package")
  await expect(probe.plugins().check("opencode.plugins")).rejects.toThrow("Not a configured package")
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("↑ update") && frame.includes("disable"))
  expect(app.renderer.currentFocusedEditor?.plainText).toBe("fixture.inspection")
  app.mockInput.pressKey(" ")
  await app.waitForFrame((frame) => frame.includes("enable"))
  expect(
    probe
      .plugins()
      .registered()
      .find((item) => item.id === "fixture.inspection")?.revision,
  ).toBe("1.0.0")
  app.mockInput.pressKey(" ")
  await app.waitForFrame((frame) => frame.includes("disable"))
  await probe.config().update((draft) => {
    draft.plugins = [{ package: target, options: { flag: true } }]
  })
  await app.waitFor(() => probe.setups === 3)
  expect(
    probe
      .plugins()
      .registered()
      .find((item) => item.id === "fixture.inspection")?.revision,
  ).toBe("1.0.0")
  await probe.config().update((draft) => {
    draft.plugins = [{ package: target, options: { fail: true } }]
  })
  await app.waitFor(() =>
    probe
      .plugins()
      .list()
      .some((item) => item.status === "failed"),
  )
  expect(
    probe
      .plugins()
      .registered()
      .find((item) => item.id === "fixture.inspection"),
  ).toMatchObject({ active: true, revision: "1.0.0" })
})

test.each([40, 100])("pinned checks, busy/error details, and CLI spec guidance at width %s", async (width) => {
  await using tmp = await tmpdir()
  const pending = Promise.withResolvers<PackageStatus>()
  let calls = 0
  await using app = await boot(tmp.path, {
    width,
    check: () => {
      calls++
      return pending.promise
    },
  })
  await open(app)
  app.mockInput.pressKey("r", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Checking..."))
  app.mockInput.pressKey("r", { ctrl: true })
  expect(calls).toBe(1)
  pending.resolve({ available: "2.0.0", mutable: false })
  await app.waitForFrame((frame) => frame.includes("pinned"))
  app.mockInput.pressEnter()
  const frame = await app.waitForFrame((frame) => frame.includes("Pinned source."))
  expect(frame).not.toContain("New revision available")
  expect(frame).not.toMatch(/Update package|Reload installed/)
  if (width === 100) expect(frame).toMatch(/Installed\s+Unknown/)
  app.mockInput.pressKey("\x1b[6~")
  await app.waitForFrame((frame) => frame.includes("cli.json"))
  expect(app.requests).toEqual([])
})

test.each(["active", "failed", "without-tui"])(
  "late %s server inventory uses the default check scope and shares results",
  async (kind) => {
    await using tmp = await tmpdir()
    let server: PluginInfo[] = []
    await using app = await boot(tmp.path, {
      server: () => server,
      check: async () => {
        throw new Error("Companion must check on server")
      },
    })
    probe.navigate("/projects/active-session")
    await app.waitFor(() => probe.location().current?.directory === "/projects/active-session")
    await open(app)
    const info = {
      id: "fixture.server",
      source: { type: "package" as const, package: target },
      tui: kind === "active",
      revision: "9.0.0",
    }
    server = [
      kind === "failed" ? { ...info, status: "failed", error: "Server fixture failed" } : { ...info, status: "active" },
    ]
    app.events.emit({ id: "evt_fixture", created: Date.now(), type: "plugin.updated", data: {} })
    app.mockInput.pressKey("c", { ctrl: true })
    await app.mockInput.typeText("fixture.server")
    await app.waitForFrame((frame) => frame.includes("fixture.server") && frame.includes("Server"))
    app.mockInput.pressKey("c", { ctrl: true })
    await app.mockInput.typeText("fixture.inspection")
    await app.waitForFrame((frame) => frame.includes("fixture.inspection") && !frame.includes("fixture.server"))
    app.mockInput.pressKey("r", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("↑ update"))
    expect(app.requests).toEqual([{ path: "/api/plugin/check", directory: tmp.path, target }])
    app.mockInput.pressEnter()
    const details = await app.waitForFrame((frame) => frame.includes("Loaded") && frame.includes("Installed"))
    expect(details).toMatch(/Loaded\s+1\.0\.0/)
    expect(details).toMatch(/Installed\s+9\.0\.0/)
    app.mockInput.pressEscape()
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    app.mockInput.pressKey("c", { ctrl: true })
    await app.mockInput.typeText("fixture.server")
    await app.waitForFrame(
      (frame) => frame.includes("fixture.server") && frame.includes(kind === "failed" ? "failed" : "↑ update"),
    )
    app.mockInput.pressEnter()
    const shared = await app.waitForFrame((frame) => frame.includes("Installed"))
    expect(shared).toMatch(/Installed\s+9\.0\.0/)
    expect(app.requests).toHaveLength(1)
  },
)

test("failed checks keep existing error investigation accessible", async () => {
  await using tmp = await tmpdir()
  await using app = await boot(tmp.path, {
    check: async () => {
      throw new Error("Registry unavailable")
    },
  })
  await probe.config().update((draft) => {
    draft.plugins = [{ package: target, options: { fail: true } }]
  })
  await app.waitFor(() =>
    probe
      .plugins()
      .list()
      .some((item) => item.status === "failed"),
  )
  await open(app)
  app.mockInput.pressKey("r", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("failed"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("View error details"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressEnter()
  const errors = await app.waitForFrame(
    (frame) =>
      frame.includes("Registry unavailable") &&
      frame.includes("Fixture setup failed") &&
      frame.includes("i investigate"),
  )
  expect(errors).toContain("Load error:")
  expect(errors).toContain("Check error:")
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("View error details"))
})

test.each(["opencode.system", entrypoint])("builtins and local sources have no package check: %s", async (spec) => {
  await using tmp = await tmpdir()
  await using app = await boot(tmp.path, { plugins: spec.startsWith("opencode.") ? [] : [spec] })
  await open(app, spec.startsWith("opencode.") ? "opencode" : "fixture.inspection")
  app.mockInput.pressEnter()
  const frame = await app.waitForFrame((frame) => frame.includes("Not applicable"))
  expect(frame).not.toContain("Check for updates")
  expect(frame).not.toMatch(/Update package|Reload installed/)
  app.mockInput.pressKey("\x1b[6~")
  await app.waitForFrame((frame) =>
    frame.includes(spec.startsWith("opencode.") ? "Updates with OpenCode" : "no package check"),
  )
  expect(app.requests).toEqual([])
})

test.each([false, true])(
  "real paging keys expose overflowing package revisions with Kitty %s",
  async (kittyKeyboard) => {
    await using tmp = await tmpdir()
    const source = `git+https://example.com/${"nested-directory/".repeat(16)}plugin.git#main`
    const one = "a".repeat(40)
    const two = "b".repeat(40)
    await Bun.write(path.join(tmp.path, "overflow.ts"), 'export default { id: "fixture.overflow", setup() {} }\n')
    await using app = await boot(tmp.path, {
      kittyKeyboard,
      plugins: [source],
      resolve: async () => ({ entrypoint: pathToFileURL(path.join(tmp.path, "overflow.ts")).href, revision: one }),
      check: async () => ({ installed: one, available: two, mutable: true }),
    })
    await open(app, "fixture.overflow")
    app.mockInput.pressEnter()
    const top = await app.waitForFrame((frame) => frame.includes("Source") && frame.includes("Check for updates"))
    expect(top).not.toContain("Available")
    app.mockInput.pressKey("r", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("New revision available"))
    app.mockInput.pressKey("\x1b[6~")
    await app.waitForFrame((frame) => !frame.includes("Runtime"))
    app.mockInput.pressKey("\x1b[6~")
    const scrolled = await app.waitForFrame((frame) => frame.includes("Installed") && frame.includes("Available"))
    expect(scrolled).toContain(one)
    expect(scrolled).toContain(two)
    app.mockInput.pressKey("\x1b[5~")
    app.mockInput.pressKey("\x1b[5~")
    await app.waitForFrame((frame) => frame.includes("Runtime") && !frame.includes("Available"))
  },
)
