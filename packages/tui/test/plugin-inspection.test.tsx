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
const updateTarget = "fixture-update@latest"
async function updateGraphs(directory: string) {
  const sources = await Promise.all(
    ["a", "b"].map(async (version) => {
      const root = new URL(`./fixture/update-${version}/tui.tsx`, import.meta.url)
      const entry = path.join(directory, `update-${version}`, "tui.tsx")
      await Bun.write(
        entry,
        (await Bun.file(root).text()).replace('"../plugin-inspection"', JSON.stringify(entrypoint)),
      )
      await Bun.write(
        path.join(directory, `update-${version}`, "helper.ts"),
        await Bun.file(new URL("helper.ts", root)).text(),
      )
      return pathToFileURL(entry).href
    }),
  )
  return { a: sources[0], b: sources[1] }
}

async function boot(
  directory: string,
  options: {
    width?: number
    kittyKeyboard?: boolean
    plugins?: Info["plugins"]
    server?: () => PluginInfo[]
    check?: PackageResolver["check"]
    resolve?: PackageResolver["resolve"]
    update?: PackageResolver["update"]
    commit?: PackageResolver["commit"]
    inventoryError?: () => boolean
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
  const inventories: (string | null)[] = []
  const calls = createFetch(async (url, request) => {
    if (url.pathname.startsWith("/api/plugin/")) {
      const body = await request.json()
      requests.push({ path: url.pathname, directory: url.searchParams.get("location[directory]"), target: body.target })
      return json({ location, data: { installed: "9.0.0", available: "10.0.0", mutable: true } })
    }
    if (url.pathname === "/api/plugin") {
      inventories.push(url.searchParams.get("location[directory]"))
      if (options.inventoryError?.()) return json({ message: "Inventory unavailable" }, { status: 503 })
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
  probe.updateSetups = []
  probe.updateCleanups = []
  probe.updateEvents = []
  probe.updateSetup = Promise.resolve()
  probe.failUpdate = false
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
        update: options.update ?? (async () => ({})),
        commit: options.commit ?? (async () => {}),
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
    inventories,
    task,
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
    expect(details).not.toContain("Update & Apply")
    app.mockInput.pressKey("\x1b[6~")
    await app.waitForFrame((frame) => frame.includes("Inspection only") && frame.includes("hot apply"))
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

test.each([40, 100])(
  "Update & Apply swaps only active target code and preserves manual mode at width %s",
  async (width) => {
    await using tmp = await tmpdir()
    const versions = await updateGraphs(tmp.path)
    const pending = Promise.withResolvers<Awaited<ReturnType<PackageResolver["update"]>>>()
    let selected = { entrypoint: versions.a, revision: "1.0.0" }
    const updates: string[] = []
    const checks: string[] = []
    const resolutions: string[] = []
    await using app = await boot(tmp.path, {
      width,
      plugins: [target, updateTarget],
      resolve: async (spec) => {
        resolutions.push(spec)
        return spec === target ? { entrypoint, revision: "1.0.0" } : selected
      },
      check: async (spec) => {
        checks.push(spec)
        return { installed: selected.revision, available: "2.0.0", mutable: true }
      },
      update: (spec) => {
        updates.push(spec)
        return pending.promise
      },
      commit: async (spec, entry) => {
        expect(spec).toBe(updateTarget)
        expect(probe.updateSetups).toEqual(["A", "B"])
        expect(
          probe
            .plugins()
            .registered()
            .find((item) => item.id === "fixture.update"),
        ).toMatchObject({ active: true, revision: "2.0.0" })
        selected = { entrypoint: entry.entrypoint!, revision: entry.revision! }
      },
    })
    await app.waitForFrame((frame) => frame.includes("Update code A"))
    expect(await probe.plugins().deactivate("opencode.sidebar.context")).toBe(true)
    const order = probe
      .plugins()
      .registered()
      .map((item) => item.id)
    await open(app, "fixture.update")
    app.mockInput.pressEnter()
    const unchecked = await app.waitForFrame((frame) => frame.includes("Check for updates"))
    expect(unchecked).not.toMatch(/>.*Update & Apply/)
    app.mockInput.pressKey("r", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("Update & Apply") && frame.includes("New revision available"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    const busy = await app.waitForFrame((frame) => frame.includes("Updating & applying..."))
    expect(busy.split("\n").length).toBeLessThanOrEqual(25)
    await app.waitFor(() => updates.length === 1)
    app.mockInput.pressEnter()
    expect(updates).toEqual([updateTarget])
    expect(selected.entrypoint).toBe(versions.a)
    expect(probe.updateCleanups).toEqual([])
    pending.resolve({ entrypoint: versions.b, revision: "2.0.0" })
    await app.waitFor(() => selected.entrypoint === versions.b)
    await app.waitForFrame((frame) => !frame.includes("Updating & applying...") && frame.includes("Check for updates"))
    if (width === 100) {
      const details = await app.waitForFrame((frame) => /Loaded\s+2\.0\.0/.test(frame))
      expect(details).toMatch(/Installed\s+2\.0\.0/)
      expect(details).toMatch(/Available\s+2\.0\.0/)
      expect(details).not.toContain("New revision available")
    }
    expect(probe.updateSetups).toEqual(["A", "B"])
    expect(probe.updateCleanups).toEqual(["A"])
    expect([probe.setups, probe.cleanups]).toEqual([1, 0])
    expect(
      probe
        .plugins()
        .registered()
        .map((item) => item.id),
    ).toEqual(order)
    expect(
      probe
        .plugins()
        .registered()
        .find((item) => item.id === "opencode.sidebar.context")?.active,
    ).toBe(false)
    expect(resolutions).toEqual([target, updateTarget])
    expect(checks).toEqual([updateTarget])
    expect(app.requests).toEqual([])
    app.mockInput.pressEscape()
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("fixture.update")
    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => frame.includes("Update code B"))
    await probe.config().update((draft) => {
      draft.plugins = [target, { package: updateTarget, options: { flag: true } }]
    })
    await app.waitFor(() => probe.updateSetups.length === 3)
    expect(probe.updateSetups).toEqual(["A", "B", "B"])
    expect(resolutions).toEqual([target, updateTarget])
  },
)

test("a fresh graph applies changed helper code even with identical root bytes and package revision", async () => {
  await using tmp = await tmpdir()
  const versions = await updateGraphs(tmp.path)
  expect(await Bun.file(new URL(versions.a)).text()).toBe(await Bun.file(new URL(versions.b)).text())
  let selected = versions.a
  await using app = await boot(tmp.path, {
    plugins: [target, updateTarget],
    resolve: async (spec) => ({ entrypoint: spec === target ? entrypoint : selected, revision: "1.0.0" }),
    update: async () => ({ entrypoint: versions.b, revision: "1.0.0" }),
    commit: async (_spec, entry) => {
      selected = entry.entrypoint!
    },
  })
  await app.waitForFrame((frame) => frame.includes("Update code A"))
  await probe.plugins().deactivate("fixture.inspection")
  expect(await probe.plugins().update(updateTarget)).toEqual({ installed: "1.0.0", available: "1.0.0", mutable: true })
  await app.waitForFrame((frame) => frame.includes("Update code B"))
  expect(selected).toBe(versions.b)
  expect(probe.updateSetups).toEqual(["A", "B"])
  expect([probe.setups, probe.cleanups]).toEqual([1, 1])
  expect(
    probe
      .plugins()
      .registered()
      .find((item) => item.id === "fixture.inspection")?.active,
  ).toBe(false)
})

test.each(["import", "invalid", "id", "setup"])(
  "failed %s candidate retains last-good code and cache selection, then permits retry",
  async (kind) => {
    await using tmp = await tmpdir()
    const versions = await updateGraphs(tmp.path)
    const bad = pathToFileURL(path.join(tmp.path, "candidate.ts")).href
    if (kind === "invalid") await Bun.write(new URL(bad), "export default {}\n")
    if (kind === "id") await Bun.write(new URL(bad), 'export default { id: "fixture.changed", setup() {} }\n')
    let candidate = kind === "setup" ? versions.b : bad
    let selected = versions.a
    await using app = await boot(tmp.path, {
      plugins: [target, updateTarget],
      resolve: async (spec) => ({ entrypoint: spec === target ? entrypoint : selected, revision: "1.0.0" }),
      update: async () => ({ entrypoint: candidate, revision: "2.0.0" }),
      commit: async (_spec, entry) => {
        selected = entry.entrypoint!
      },
    })
    await app.waitForFrame((frame) => frame.includes("Update code A"))
    probe.failUpdate = kind === "setup"
    await expect(probe.plugins().update(updateTarget)).rejects.toThrow()
    await app.waitForFrame((frame) => frame.includes("Update code A"))
    expect(selected).toBe(versions.a)
    expect(
      probe
        .plugins()
        .registered()
        .find((item) => item.id === "fixture.update"),
    ).toMatchObject({ active: true, revision: "1.0.0" })
    expect(
      probe
        .plugins()
        .list()
        .find((item) => item.target === updateTarget),
    ).toMatchObject({ status: "failed", error: expect.stringContaining("previous version still active") })
    expect(probe.updateCleanups).toEqual(kind === "setup" ? ["A"] : [])
    expect(probe.updateSetups).toEqual(kind === "setup" ? ["A", "B", "A"] : ["A"])
    expect([probe.setups, probe.cleanups]).toEqual([1, 0])
    expect(probe.plugins().canUpdate(updateTarget)).toBe(true)
    app.events.emit({ id: "evt_apply_probe", type: "server.connected", data: {} })
    await app.waitFor(() => probe.updateEvents.length > 0)
    expect(probe.updateEvents).toEqual(["A"])
    candidate = versions.b
    probe.failUpdate = false
    await probe.plugins().update(updateTarget)
    await app.waitForFrame((frame) => frame.includes("Update code B"))
    expect(selected).toBe(versions.b)
  },
)

test.each(["active", "failed", "without-tui", "read-error"])(
  "fresh %s server ownership blocks downloads at the default location",
  async (kind) => {
    await using tmp = await tmpdir()
    let server: PluginInfo[] = []
    let readError = false
    let updates = 0
    await using app = await boot(tmp.path, {
      server: () => server,
      inventoryError: () => readError,
      update: async () => {
        updates++
        return {}
      },
    })
    probe.navigate("/projects/active-session")
    await app.waitFor(() => probe.location().current?.directory === "/projects/active-session")
    await open(app)
    app.mockInput.pressKey("r", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("↑ update"))
    const info = { id: "fixture.server", source: { type: "package" as const, package: target }, tui: kind === "active" }
    if (kind === "read-error") readError = true
    else
      server = [
        kind === "failed"
          ? { ...info, status: "failed", error: "Failed server plugin" }
          : { ...info, status: "active" },
      ]
    const reads = app.inventories.length
    await expect(probe.plugins().update(target)).rejects.toThrow()
    expect(app.inventories.length).toBeGreaterThan(reads)
    expect(app.inventories.at(-1)).toBe(tmp.path)
    expect(updates).toBe(0)
    expect([probe.setups, probe.cleanups]).toEqual([1, 0])
    expect(app.requests).toEqual([])
  },
)

test("unknown, local, built-in, disabled, failed-initial and pinned packages cannot update", async () => {
  await using tmp = await tmpdir()
  const versions = await updateGraphs(tmp.path)
  const local = pathToFileURL(path.join(tmp.path, "local.ts")).href
  await Bun.write(new URL(local), 'export default { id: "fixture.local", setup() {} }\n')
  let mutable = false
  let updates = 0
  await using app = await boot(tmp.path, {
    plugins: [target, "fixture-broken@latest", updateTarget, "-fixture.update", local],
    resolve: async (spec) => {
      if (spec === updateTarget) return { entrypoint: versions.a, revision: "1.0.0" }
      if (spec !== target) throw new Error("Initial import unavailable")
      return { entrypoint, revision: "1.0.0" }
    },
    check: async () => ({ mutable }),
    update: async () => {
      updates++
      if (!mutable) throw new Error("Pinned package cannot be updated")
      return {}
    },
  })
  for (const spec of ["unknown", local, "opencode.sidebar.context", "fixture-broken@latest", updateTarget]) {
    expect(probe.plugins().canUpdate(spec)).toBe(false)
    await expect(probe.plugins().update(spec)).rejects.toThrow("Not an active CLI-only")
  }
  await expect(probe.plugins().update(target)).rejects.toThrow("Pinned")
  mutable = true
  await probe.plugins().deactivate("fixture.inspection")
  expect(probe.plugins().canUpdate(target)).toBe(false)
  await expect(probe.plugins().update(target)).rejects.toThrow("Not an active CLI-only")
  await open(app)
  app.mockInput.pressKey("r", { ctrl: true })
  await app.waitForFrame((frame) => !frame.includes("Checking...") && frame.includes("enable"))
  app.mockInput.pressEnter()
  const detail = await app.waitForFrame((frame) => frame.includes("Check for updates"))
  expect(detail).not.toContain("Update & Apply")
  app.mockInput.pressKey("\x1b[6~")
  await app.waitForFrame((frame) => frame.includes("disabled or unloaded"))
  expect(updates).toBe(1)
})

test("cache commit failure truthfully keeps new code owned and exposes the persistence error", async () => {
  await using tmp = await tmpdir()
  const versions = await updateGraphs(tmp.path)
  const selected = versions.a
  await using app = await boot(tmp.path, {
    plugins: [target, updateTarget],
    resolve: async (spec) => ({ entrypoint: spec === target ? entrypoint : selected, revision: "1.0.0" }),
    update: async () => ({ entrypoint: versions.b, revision: "2.0.0" }),
    commit: async () => {
      throw new Error("Cache write denied")
    },
  })
  await app.waitForFrame((frame) => frame.includes("Update code A"))
  await open(app, "fixture.update")
  app.mockInput.pressKey("r", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("↑ update"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Update & Apply"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("View error details") && !frame.includes("Updating & applying..."))
  const detail = await app.waitForFrame((frame) => /Loaded\s+2\.0\.0/.test(frame))
  expect(detail).toMatch(/Installed\s+1\.0\.0/)
  app.mockInput.pressArrow("down")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Update error:") && frame.includes("Cache write denied"))
  expect(selected).toBe(versions.a)
  expect(
    probe
      .plugins()
      .registered()
      .find((item) => item.id === "fixture.update"),
  ).toMatchObject({ active: true, revision: "2.0.0" })
  app.events.emit({ id: "evt_apply_probe", type: "server.connected", data: {} })
  await app.waitFor(() => probe.updateEvents.length > 0)
  expect(probe.updateEvents).toEqual(["B"])
  await probe.plugins().deactivate("fixture.update")
  expect(probe.updateCleanups).toEqual(["A", "B"])
})

test("queued updates read ownership only when their serialized operation starts", async () => {
  await using tmp = await tmpdir()
  const versions = await updateGraphs(tmp.path)
  const pending = Promise.withResolvers<Awaited<ReturnType<PackageResolver["update"]>>>()
  let inventory: PluginInfo[] = []
  let updates = 0
  await using app = await boot(tmp.path, {
    plugins: [target, updateTarget],
    server: () => inventory,
    resolve: async (spec) => ({ entrypoint: spec === target ? entrypoint : versions.a, revision: "1.0.0" }),
    update: () => {
      updates++
      return pending.promise
    },
  })
  await app.waitForFrame((frame) => frame.includes("Update code A"))
  const first = probe.plugins().update(updateTarget)
  await app.waitFor(() => updates === 1)
  const queued = probe
    .plugins()
    .update(updateTarget)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  inventory = [
    {
      source: { type: "package", package: updateTarget },
      status: "failed",
      tui: false,
      error: "Late server owner",
    },
  ]
  pending.resolve({ entrypoint: versions.b, revision: "2.0.0" })
  await first
  expect(await queued).toMatchObject({ message: expect.stringContaining("inspection only") })
  expect(updates).toBe(1)
  expect(probe.updateSetups).toEqual(["A", "B"])
  await app.waitForFrame((frame) => frame.includes("Update code B"))
})

test.each([
  { phase: "download", cause: "removal" },
  { phase: "download", cause: "shutdown" },
  { phase: "setup", cause: "removal" },
  { phase: "setup", cause: "shutdown" },
])("update aborts without publishing when $cause crosses async $phase", async ({ phase, cause }) => {
  await using tmp = await tmpdir()
  const versions = await updateGraphs(tmp.path)
  const downloading = Promise.withResolvers<void>()
  const download = Promise.withResolvers<Awaited<ReturnType<PackageResolver["update"]>>>()
  const setup = Promise.withResolvers<void>()
  let selected = versions.a
  let commits = 0
  await using app = await boot(tmp.path, {
    plugins: [target, updateTarget],
    resolve: async (spec) => ({ entrypoint: spec === target ? entrypoint : selected, revision: "1.0.0" }),
    update: () => {
      downloading.resolve()
      return phase === "download" ? download.promise : Promise.resolve({ entrypoint: versions.b, revision: "2.0.0" })
    },
    commit: async (_spec, entry) => {
      commits++
      selected = entry.entrypoint!
    },
  })
  await app.waitForFrame((frame) => frame.includes("Update code A"))
  probe.updateSetup = setup.promise
  const operation = probe
    .plugins()
    .update(updateTarget)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  try {
    await downloading.promise
    if (phase === "setup") await app.waitFor(() => probe.updateSetups.includes("B"))
    if (cause === "shutdown") app.renderer.destroy()
    if (cause === "removal")
      await probe.config().update((draft) => {
        draft.plugins = [target]
      })
  } finally {
    download.resolve({ entrypoint: versions.b, revision: "2.0.0" })
    setup.resolve()
  }
  expect(await operation).toMatchObject({ message: expect.stringContaining("update aborted") })
  if (cause === "shutdown") await app.task
  if (cause === "removal")
    await app.waitFor(
      () =>
        !probe
          .plugins()
          .registered()
          .some((item) => item.id === "fixture.update"),
    )
  expect(selected).toBe(versions.a)
  expect(commits).toBe(0)
  expect(probe.updateSetups).toEqual(phase === "download" ? ["A"] : ["A", "B"])
  expect(probe.updateCleanups).toEqual(phase === "download" ? ["A"] : ["A", "B"])
  expect(probe.plugins().canUpdate(updateTarget)).toBe(false)
  if (cause === "shutdown") expect(probe.plugins().registered()).toEqual([])
})
