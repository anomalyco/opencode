import { expect } from "bun:test"
import { cp, mkdir, symlink, unlink } from "node:fs/promises"
import path from "node:path"
import { Brand, Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schedule, Schema, Scope, Stream } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Plugin } from "@opencode/core/plugin"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { PluginModule } from "@opencode/core/plugin/module"
import { Rpc } from "@opencode/core/rpc"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { createForeignPackageFilter, ensurePluginRuntime } from "@opencode/plugin/runtime"
import { createLoader, discoverPluginRuntimeSpecifiers, pluginRuntimeLoaderCode } from "@opencode/plugin/runtime-modules"
import { tempGlobalLayer } from "../fixture/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

ensurePluginRuntime()

const it = testEffect(
  Layer.mergeAll(
    PluginTestLayer,
    AppNodeBuilder.build(Npm.node, [Global.node.replace(tempGlobalLayer)]),
    Watcher.layer().pipe(Layer.provide(Watcher.nativeLayer)),
  ),
)

it.live("watches creation of an external helper with missing parent directories", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const entry = path.join(directory.path, "plugin/index.ts")
    yield* Effect.promise(() => Bun.write(entry, 'export { default } from "../shared/new/nested/helper.ts"'))
    const modules = yield* PluginModule.make()
    const operation = { type: "add" as const, target: path.dirname(entry), options: {} }
    expect(Exit.isFailure(yield* modules.load(operation).pipe(Effect.exit))).toBe(true)
    const changed = yield* modules
      .changes()
      .pipe(Stream.runHead, Effect.timeout("5 seconds"), Effect.forkScoped({ startImmediately: true }))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory.path, "shared/new/nested/helper.ts"),
        'export default { id: "appeared", async setup() {} }',
      ),
    )
    yield* Fiber.join(changed)
    const loaded = yield* modules.load(operation)
    expect(loaded).toMatchObject({ id: "appeared" })
  }),
)

it.live("interrupts pending watcher setup when the loader scope closes during module evaluation", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const entry = path.join(directory.path, "index.ts")
    const entered = path.join(directory.path, "entered")
    const release = path.join(directory.path, "release")
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Bun.write(release, "release")).pipe(
        Effect.andThen(Deferred.succeed(gate, undefined)),
        Effect.andThen(Scope.close(scope, Exit.void)),
      ),
    )
    yield* Effect.promise(() =>
      Bun.write(
        entry,
        `
        await Bun.write(${JSON.stringify(entered)}, "entered")
        while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(5)
        export default { id: "pending", async setup() {} }
      `,
      ),
    )
    const modules = yield* PluginModule.make().pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(Watcher.Service, {
        subscribe: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
            Effect.as(Stream.never),
          ),
      }),
    )
    yield* modules.load({ type: "add", target: directory.path, options: {} }).pipe(Effect.forkIn(scope))
    yield* Deferred.await(started)
    yield* Effect.promise(() => Bun.file(entered).exists()).pipe(
      Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("5 millis") }),
      Effect.timeout("2 seconds"),
    )
    yield* Scope.close(scope, Exit.void)
    expect(yield* Deferred.isDone(stopped)).toBe(true)
    yield* Effect.promise(() => Bun.write(release, "release"))
    // Let the uncancellable native import finish; Bun's test runner detects unhandled rejections.
    yield* Effect.promise(() => Bun.sleep(50))
  }),
)

it.live("loads plugins and their transitive dependencies against the host's Effect and @opencode/plugin instances", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const pluginDir = path.join(directory.path, "plugin")
    const pluginEffectDir = path.join(pluginDir, "node_modules/effect")
    const hostEffectDir = path.dirname(Bun.resolveSync("effect/package.json", import.meta.dir))

    yield* Effect.promise(async () => {
      await cp(path.join(hostEffectDir, "dist"), path.join(pluginEffectDir, "dist"), {
        recursive: true,
        filter: (src) => !src.endsWith(".d.ts") && !src.endsWith(".map") && !/httpApi(?:Scalar|Swagger)\.js$/.test(src),
      })
      const pkg = { ...(await Bun.file(path.join(hostEffectDir, "package.json")).json()), version: "4.0.0-rc.111" }

      // Sabotage the plugin's own Effect copy with the version-skew failure modes so loading it would crash:
      // 1. Effect.log reading an incompatible fiber log-level property (crashing host logger with logLevel.toUpperCase)
      // 2. Effect.runPromise calling fiber.succeedWith on a host fiber
      // 3. Schema.withDecodingDefault / Schema.Int / Schema.isPattern / Schema.Trim using foreign parser sentinels
      const internalEffectPath = path.join(pluginEffectDir, "dist/internal/effect.js")
      const originalInternalEffect = await Bun.file(internalEffectPath).text()
      const logPattern =
        /const logLevel = level \?\? fiber\.(?:currentLogLevel|cache\.logLevel);\r?\n\s*if \(isLogLevelGreaterThan\(fiber\.(?:minimumLogLevel|cache\.minimumLogLevel), logLevel\)\) \{/
      const runPromisePattern = /const runPromiseExit = runPromiseExitWith\(context\);/
      expect(logPattern.test(originalInternalEffect)).toBe(true)
      expect(runPromisePattern.test(originalInternalEffect)).toBe(true)

      await writeFiles(pluginDir, {
        "node_modules/effect/package.json": JSON.stringify(pkg),
        "node_modules/effect/dist/internal/effect.js": originalInternalEffect
          .replace(
            logPattern,
            "const logLevel = level ?? fiber.foreignSkew?.logLevel;\n    if (isLogLevelGreaterThan(fiber.foreignSkew?.minimumLogLevel, logLevel)) {",
          )
          .replace(
            runPromisePattern,
            "if (true) return (effect) => Promise.resolve().then(() => { const fiber = {}; return fiber.succeedWith(effect); });\n  const runPromiseExit = runPromiseExitWith(context);",
          ),
        "node_modules/transitive-dep/package.json":
          '{"name":"transitive-dep","type":"module","exports":{".":"./index.js"}}',
        "node_modules/transitive-dep/index.js": `import { Effect, Schema } from "effect"
import { some } from "effect/Option"
export const depToolInput = Schema.Struct({
  mode: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("from-dep"))),
  count: Schema.Int,
  code: Schema.Trim.check(Schema.isPattern(/^v[0-9]+$/)),
})
export const depCaptured = { Effect, Schema, some }`,
        "node_modules/@opencode/plugin/package.json":
          '{"name":"@opencode/plugin","type":"module","exports":{"./effect":"./effect.js","./rpc":"./rpc.js"}}',
        "node_modules/@opencode/plugin/effect.js": "export const Plugin = { define: (p) => p }",
        "node_modules/@opencode/plugin/rpc.js": "export const Rpc = { define: (d) => d }",
        "index.ts": `import { Plugin } from "@opencode/plugin/effect"
import { Rpc } from "@opencode/plugin/rpc"
import { Effect, Schema } from "effect"
import { some } from "effect/Option"
import { nominal } from "effect/Brand"
import { depCaptured, depToolInput } from "transitive-dep"

export const captured = {
  plugin: { Effect, Schema, some, nominal },
  dep: depCaptured,
  pluginCount: -1,
}

const Contract = Rpc.define({
  id: "host-effect-rpc",
  methods: {
    check: {
      input: Schema.Struct({
        count: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(5))),
        tag: Schema.Trim.check(Schema.isPattern(/^v[0-9]+$/)),
      }),
      output: Schema.Struct({ value: Schema.String }),
    },
  },
  events: {},
})

export default Plugin.define({
  id: "host-effect-fixture",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.log("setup log from plugin")
      const listed = yield* Effect.promise(() =>
        Effect.runPromise(ctx.plugin.list().pipe(Effect.orDie)),
      )
      captured.pluginCount = listed.data.length

      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: "check_tool",
          description: "Tool with decoding default from transitive dependency and Int/Trim/isPattern checks",
          input: depToolInput,
          output: Schema.Struct({ formatted: Schema.String }),
          execute: ({ mode, count, code }) =>
            Effect.log("executing check_tool").pipe(
              Effect.as({
                output: { formatted: \`\${mode}:\${code}:\${count}\` },
                content: \`\${mode}:\${code}:\${count}\`,
              }),
            ),
        })
      })

      yield* ctx.rpc.register(Contract, {
        check: ({ count, tag }) =>
          Effect.log("executing rpc check").pipe(
            Effect.as({ value: \`\${tag}#\${count}\` }),
          ),
      }).pipe(Effect.orDie)
    }),
})`,
      })
    })

    const modules = yield* PluginModule.make()
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const rpc = yield* Rpc.Service

    const definition = yield* modules.load({ type: "add", target: pluginDir, options: {} })
    if ("pending" in definition || "blocked" in definition) return yield* Effect.die(new Error("Local plugin was not loaded"))
    yield* plugins.activate([definition])
    yield* plugins.awaitActivation

    expect(yield* plugins.list()).toMatchObject([{ id: "host-effect-fixture", state: { status: "active" } }])

    const imported = yield* Effect.promise(() => import(path.join(pluginDir, "index.ts")))
    expect(imported.captured.plugin.Effect).toBe(Effect)
    expect(imported.captured.plugin.Schema).toBe(Schema)
    expect(imported.captured.plugin.some).toBe(Option.some)
    expect(imported.captured.plugin.nominal).toBe(Brand.nominal)
    expect(imported.captured.dep.Effect).toBe(Effect)
    expect(imported.captured.dep.Schema).toBe(Schema)
    expect(imported.captured.dep.some).toBe(Option.some)
    expect(imported.captured.pluginCount).toBe(0)

    const checkTool = (yield* tools.list()).find((tool) => tool.id === "check_tool")
    expect(checkTool).toBeDefined()
    if (!checkTool) return

    const context = {
      sessionID: Session.ID.make("ses_host_effect"),
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.make("msg_host_effect"),
      id: Tool.CallID.make("call_host_effect"),
      progress: () => Effect.void,
    }

    expect(yield* execute(checkTool, { count: 3, code: "  v42  " }, context)).toEqual({
      output: { formatted: "from-dep:v42:3" },
      content: [{ type: "text", text: "from-dep:v42:3" }],
    })
    expect(yield* rpc.call("host-effect-rpc", "check", { tag: " v9 " })).toEqual({ value: "v9#5" })
  }),
)

it.live("redirects plugin dependencies with a nested Effect 3 installation to the host, allows effect/package.json, and fails loudly on unprovided subpaths", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const pluginDir = path.join(directory.path, "v3-dep-plugin")
    const badDir = path.join(directory.path, "removed-subpath-plugin")
    const v3DepDir = path.join(pluginDir, "node_modules/v3-dep")

    yield* Effect.promise(() =>
      writeFiles(directory.path, {
        "v3-dep-plugin/node_modules/effect/package.json":
          '{"name":"effect","version":"4.0.0-rc.111","type":"module","exports":{"./package.json":"./package.json"}}',
        "v3-dep-plugin/node_modules/v3-dep/node_modules/effect/package.json":
          '{"name":"effect","version":"3.19.19","type":"module","exports":{".":"./index.js","./Option":"./Option.js","./ReadonlyArray":"./ReadonlyArray.js"}}',
        "v3-dep-plugin/node_modules/v3-dep/node_modules/effect/index.js":
          "export const Effect = { major: 3 }; export const Schema = { major: 3 }",
        "v3-dep-plugin/node_modules/v3-dep/node_modules/effect/Option.js": "export const some = () => ({ major: 3 })",
        "v3-dep-plugin/node_modules/v3-dep/node_modules/effect/ReadonlyArray.js": "export const fromIterable = () => []",
        "v3-dep-plugin/node_modules/v3-dep/package.json":
          '{"name":"v3-dep","type":"module","exports":{".":"./index.js","./v3-only":"./v3-only.js"}}',
        "v3-dep-plugin/node_modules/v3-dep/index.js":
          'import { Effect, Schema } from "effect"; import { some } from "effect/Option"; export const v3DepCaptured = { Effect, Schema, some }',
        "v3-dep-plugin/node_modules/v3-dep/v3-only.js":
          'import { fromIterable } from "effect/ReadonlyArray"; export { fromIterable }',
        "v3-dep-plugin/index.ts":
          'import pkg from "effect/package.json" with { type: "json" }; import { v3DepCaptured } from "v3-dep"; export const effectPkgName = pkg.name; export { v3DepCaptured }; export default { id: "v3-dep-plugin", async setup() {} }',
        "removed-subpath-plugin/node_modules/effect/package.json":
          '{"name":"effect","type":"module","exports":{"./RemovedLegacySubpath":"./RemovedLegacySubpath.js"}}',
        "removed-subpath-plugin/node_modules/effect/RemovedLegacySubpath.js": "export const legacy = true",
        "removed-subpath-plugin/index.ts":
          'import { legacy } from "effect/RemovedLegacySubpath"; export default { id: "removed-subpath", async setup() { void legacy } }',
      }),
    )

    const modules = yield* PluginModule.make()
    expect(yield* modules.load({ type: "add", target: pluginDir, options: {} })).toMatchObject({ id: "v3-dep-plugin" })

    const imported = yield* Effect.promise(() => import(path.join(pluginDir, "index.ts")))
    expect(imported.effectPkgName).toBe("effect")
    expect(imported.v3DepCaptured.Effect).toBe(Effect)
    expect(imported.v3DepCaptured.Schema).toBe(Schema)
    expect(imported.v3DepCaptured.some).toBe(Option.some)
    yield* Effect.promise(async () => {
      await expect(import(path.join(v3DepDir, "v3-only.js"))).rejects.toThrow("effect/ReadonlyArray.js")
    })

    const exit = yield* modules.load({ type: "add", target: badDir, options: {} }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain("effect/RemovedLegacySubpath.js")
    }
  }),
)

it.live("discovers exported specifiers from the resolved tree even when dist/ exists, and validates barrel loader routing, async loader dedup, and Windows foreign filters", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const consumerDir = path.join(directory.path, "consumer")
    const asyncModPath = path.join(directory.path, "async-mod.ts")

    yield* Effect.promise(() =>
      writeFiles(directory.path, {
        "consumer/node_modules/@opencode/plugin/package.json": JSON.stringify({
          name: "@opencode/plugin",
          type: "module",
          exports: {
            ".": "./src/promise/index.ts",
            "./effect": "./src/effect/index.ts",
            "./effect/*": "./src/effect/*.ts",
          },
        }),
        "consumer/node_modules/@opencode/plugin/src/promise/index.ts": "export const root = 'src'",
        "consumer/node_modules/@opencode/plugin/src/effect/index.ts": "export * as plugin from './plugin.ts'",
        "consumer/node_modules/@opencode/plugin/src/effect/plugin.ts": "export const leaf = 'src'",
        "consumer/node_modules/@opencode/plugin/src/unexported.ts": "export const secret = true",
        "consumer/node_modules/@opencode/plugin/dist/promise/index.js": "export const root = 'dist'",
        "consumer/node_modules/@opencode/plugin/dist/effect/index.js": "export const index = 'dist'",
        "consumer/node_modules/@opencode/plugin/dist/effect/plugin.js": "export const leaf = 'dist'",
        "async-mod.ts": "await new Promise((r) => setTimeout(r, 20)); export const nonce = Math.random()",
      }),
    )

    const discovered = discoverPluginRuntimeSpecifiers(consumerDir, ["@opencode/plugin"])
    expect(discovered.get("@opencode/plugin")?.replaceAll("\\", "/")).toEndWith("src/promise/index.ts")
    expect(discovered.get("@opencode/plugin/effect")?.replaceAll("\\", "/")).toEndWith("src/effect/index.ts")
    expect(discovered.get("@opencode/plugin/effect/plugin")?.replaceAll("\\", "/")).toEndWith("src/effect/plugin.ts")
    expect(discovered.has("@opencode/plugin/unexported")).toBe(false)

    const hostDiscovered = discoverPluginRuntimeSpecifiers()
    expect(hostDiscovered.has("effect/schema/SchemaJITCompiler")).toBe(true)
    expect(hostDiscovered.has("effect/schema/SchemaJITCompiler/enable")).toBe(true)
    expect(pluginRuntimeLoaderCode("effect/Option", hostDiscovered)).toBe('() => require("effect")["Option"]')
    expect(pluginRuntimeLoaderCode("effect/testing", hostDiscovered)).toBe('() => require("effect/testing")')
    expect(hostDiscovered.has("effect/http/MultipartParser/HeadersParser")).toBe(true)
    expect(pluginRuntimeLoaderCode("effect/http/MultipartParser/HeadersParser", hostDiscovered)).toBe(
      '() => require("effect/http/MultipartParser/HeadersParser")',
    )
    expect(pluginRuntimeLoaderCode("effect/schema/SchemaJITCompiler", hostDiscovered)).toBe(
      '() => require("effect/schema")["SchemaJITCompiler"]',
    )
    expect(pluginRuntimeLoaderCode("effect/schema/SchemaJITCompiler/enable", hostDiscovered)).toBe(
      '() => require("effect/schema/SchemaJITCompiler/enable")',
    )

    const loadAsync = createLoader(asyncModPath)
    const first = loadAsync()
    const second = loadAsync()
    expect(first).toBeInstanceOf(Promise)
    expect(first).toBe(second)
    const [res1, res2] = yield* Effect.promise(() => Promise.all([first, second]))
    expect(res1).toBe(res2)

    const winFilter = createForeignPackageFilter([
      "C:\\runner\\_work\\opencode\\node_modules\\.bun\\effect@4.0.0-rc.112\\node_modules\\effect",
    ])
    expect(
      winFilter.test(
        "C:\\runner\\_work\\opencode\\node_modules\\.bun\\effect@4.0.0-rc.112\\node_modules\\effect\\dist\\index.js",
      ),
    ).toBe(false)
    expect(
      winFilter.test(
        "C:/runner/_work/opencode/node_modules/.bun/effect@4.0.0-rc.112/node_modules/effect/dist/index.js",
      ),
    ).toBe(false)
    expect(winFilter.test("C:\\Users\\plugin\\node_modules\\effect\\dist\\index.js")).toBe(true)
    expect(winFilter.test("C:/Users/plugin/node_modules/effect/dist/index.js")).toBe(true)
    expect(winFilter.test("C:\\Users\\user\\.bun\\install\\cache\\effect@4.0.1@@@1\\dist\\index.js")).toBe(true)
    expect(winFilter.test("C:/Users/user/.bun/install/cache/effect@4.0.1@@@1/dist/index.js")).toBe(true)
  }),
)

async function writeFiles(root: string, files: Record<string, string>) {
  await Promise.all(Object.entries(files).map(([file, text]) => Bun.write(path.join(root, file), text)))
}

it.live("blocks a local plugin before module initialization and honors replacement policies", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const entered = path.join(directory.path, "entered")
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory.path, "index.ts"),
        `
      await Bun.write(${JSON.stringify(entered)}, "loaded")
      export default { id: "policy-fixture", async setup() {} }
    `,
      ),
    )
    const managed = yield* ManagedPolicy.Service
    const modules = yield* PluginModule.make()
    const operation = { type: "add" as const, target: directory.path, options: {} }
    yield* managed.set({
      statements: [{ action: "integration.use", resource: `plugin:${directory.path}`, effect: "deny" }],
    })
    expect(yield* modules.load(operation)).toEqual({ blocked: true })
    expect(yield* Effect.promise(() => Bun.file(entered).exists())).toBe(false)
    yield* managed.set({ statements: [] })
    expect(yield* modules.load(operation)).toMatchObject({ id: "policy-fixture" })
    expect(yield* Effect.promise(() => Bun.file(entered).exists())).toBe(true)
  }),
)

for (const target of ["policy-fixture@1.2.3", "@scope/policy-fixture@1.2.3"]) {
  it.live(`blocks versioned package ${target} before npm resolution or installation`, () =>
    Effect.gen(function* () {
      const managed = yield* ManagedPolicy.Service
      const modules = yield* PluginModule.make()
      yield* managed.set({
        statements: [
          { action: "integration.use", resource: `plugin:${target.slice(0, target.lastIndexOf("@"))}`, effect: "deny" },
        ],
      })
      const operation = { type: "add" as const, target, options: {} }
      expect(yield* modules.load(operation, { install: false })).toEqual({ blocked: true })
      expect(yield* modules.load(operation, { install: true })).toEqual({ blocked: true })
    }),
  )
}

it.live("follows a plugin directory symlink retargeted since the previous load", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const first = path.join(directory.path, "first")
    const second = path.join(directory.path, "second")
    const source = path.join(directory.path, "plugin")
    yield* Effect.promise(async () => {
      await mkdir(first, { recursive: true })
      await mkdir(second, { recursive: true })
      await Bun.write(path.join(first, "index.ts"), 'export default { id: "first", setup() {} }')
      await Bun.write(path.join(second, "index.ts"), 'export default { id: "second", setup() {} }')
      await symlink(first, source, process.platform === "win32" ? "junction" : undefined)
    })

    const modules = yield* PluginModule.make()
    const operation = { type: "add" as const, target: source, options: {} }
    expect(yield* modules.load(operation)).toMatchObject({ id: "first" })

    yield* Effect.promise(async () => {
      await unlink(source)
      await symlink(second, source, process.platform === "win32" ? "junction" : undefined)
    })
    expect(yield* modules.load(operation)).toMatchObject({ id: "second" })
  }),
)
