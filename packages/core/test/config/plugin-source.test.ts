import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Directory, Document, Info, type Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Logger } from "effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const entries = (plugins: string[]) => [new Document({ type: "document", info: new Info({ plugins }) })]

const scanEntries = (fs: FSUtil.Interface, location: Location.Interface, entries: readonly Entry[]) => {
  const warnings: unknown[] = []
  const logger = Logger.make(({ logLevel, message }) => {
    if (logLevel === "Warn") warnings.push(message)
  })
  return ConfigPluginSource.scan(fs, location, entries).pipe(
    Effect.provide(Logger.layer([logger])),
    Effect.map((operations) => ({ operations, warnings })),
  )
}

const scan = (fs: FSUtil.Interface, location: Location.Interface, plugins: string[]) =>
  scanEntries(fs, location, entries(plugins))

it.live("warns when a plugin directory has no server, GUI, or TUI entrypoint", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const directory = path.join(root.path, "empty-plugin")
    yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
    const fsService = yield* FSUtil.Service
    const location = yield* Location.Service

    const result = yield* scan(fsService, location, [directory])

    expect(result.operations).toEqual([])
    expect(result.warnings).toContainEqual([
      "plugin directory has no server, GUI, or TUI entrypoint",
      { target: directory },
    ])
  }),
)

// Windows requires Developer Mode or elevation for file symlinks; the containment path is covered on POSIX.
const symlinkIt = process.platform === "win32" ? it.live.skip : it.live

symlinkIt("warns when a plugin entrypoint resolves outside its directory", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const directory = path.join(root.path, "plugin")
    const outside = path.join(root.path, "outside")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory, { recursive: true })
      await fs.mkdir(outside, { recursive: true })
      await fs.writeFile(path.join(outside, "index.js"), "export default { id: 'probe', setup() {} }")
      await fs.symlink(path.join(outside, "index.js"), path.join(directory, "index.js"))
    })
    const fsService = yield* FSUtil.Service
    const location = yield* Location.Service
    const resolvedRoot = yield* fsService.resolve(directory)
    const resolvedEntrypoint = yield* fsService.resolve(path.join(outside, "index.js"))

    const result = yield* scan(fsService, location, [directory])

    expect(result.operations).toEqual([])
    expect(result.warnings).toContainEqual([
      "plugin entrypoint resolves outside plugin directory",
      { target: directory, root: resolvedRoot, entrypoint: resolvedEntrypoint },
    ])
  }),
)

it.live("keeps a plugin directory whose server entrypoint is contained", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const directory = path.join(root.path, "plugin")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, "index.js"), "export default { id: 'probe', setup() {} }")
    })
    const fsService = yield* FSUtil.Service
    const location = yield* Location.Service

    const result = yield* scan(fsService, location, [directory])

    expect(result.operations.map((operation) => operation.target)).toEqual([directory])
    expect(result.warnings).toEqual([])
  }),
)

it.live("keeps a GUI-only plugin directory without warning", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const directory = path.join(root.path, "gui-plugin")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, "gui-experimental.cjs"), "module.exports = {}")
    })
    const fsService = yield* FSUtil.Service
    const location = yield* Location.Service

    const result = yield* scan(fsService, location, [directory])

    expect(result.operations.map((operation) => operation.target)).toEqual([directory])
    expect(result.warnings).toEqual([])
  }),
)

it.live("silently skips a TUI-only plugin directory", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const directory = path.join(root.path, "tui-plugin")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, "tui.ts"), "export default {}")
    })
    const fsService = yield* FSUtil.Service
    const location = yield* Location.Service

    const result = yield* scan(fsService, location, [directory])

    expect(result.operations).toEqual([])
    expect(result.warnings).toEqual([])
  }),
)

it.live("does not warn for auto-discovered helper directories", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const helper = path.join(root.path, "plugin", "lib")
    yield* Effect.promise(() => fs.mkdir(helper, { recursive: true }))
    const fsService = yield* FSUtil.Service
    const location = yield* Location.Service

    const result = yield* scanEntries(fsService, location, [
      new Directory({ type: "directory", path: AbsolutePath.make(root.path) }),
    ])

    expect(result.operations).toEqual([])
    expect(result.warnings).toEqual([])
  }),
)
