// Run from packages/core: bun script/benchmark-config-watch.ts --ref <commit|working>
// Optional: --depths 0,20,60 --locations 1,20,100 --reloads 3 --noise 100
// Each case runs in a fresh process; only config/watcher sources vary by ref.
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { Context, Effect, Layer, Logger, Stream } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import type { Config } from "../src/config"
import type { Watcher } from "../src/filesystem/watcher"
import { Bus } from "../src/bus"
import { Credential } from "../src/credential"
import { WellKnown } from "../src/wellknown"
import { Location } from "../src/location"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "../src/schema"
import { AppNodeBuilder } from "../src/effect/app-node-builder"

const args = parseArgs({
  options: {
    ref: { type: "string", default: "working" },
    depths: { type: "string", default: "0,20,60" },
    locations: { type: "string", default: "1,20,100" },
    reloads: { type: "string", default: "3" },
    noise: { type: "string", default: "100" },
    snapshot: { type: "string" },
  },
}).values
const integers = (text: string, min: number, max: number) =>
  text.split(",").map((text) => {
    const value = Number(text)
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected ${min}..${max}: ${text}`)
    return value
  })
const depths = integers(args.depths, 0, 60)
const locations = integers(args.locations, 1, 100)
if (depths.length * locations.length > 9) throw new Error("At most nine scenarios per run")
const reloads = integers(args.reloads, 1, 10)[0]
const noise = integers(args.noise, 0, 1000)[0]
const core = path.resolve(import.meta.dir, "..")
const repository = path.resolve(core, "../..")
const git = async (...args: string[]) => {
  const result = Bun.spawn(["git", "-C", repository, ...args], { stdout: "pipe", stderr: "pipe" })
  const [text, error, status] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ])
  if (status) throw new Error(error)
  return text
}

if (!args.snapshot) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-bench-source-"))
  try {
    const revision = (await git("rev-parse", args.ref === "working" ? "HEAD" : `${args.ref}^{commit}`)).trim()
    const hashes: Record<string, string> = {}
    const measured = ["src/config.ts", "src/config/discovery.ts", "src/config/watch.ts", "src/filesystem/watcher.ts"]
    const available =
      args.ref === "working"
        ? measured
        : (await git("ls-tree", "-r", "--name-only", revision, "packages/core/src"))
            .trim()
            .split("\n")
            .map((file) => file.slice("packages/core/".length))
    const directories = ["src", "src/filesystem", "src/config"]
    for (const directory of directories) await fs.mkdir(path.join(root, directory), { recursive: true })
    // Snapshot measured sources; use this checkout for unchanged imports.
    for (const directory of directories) {
      for (const entry of await fs.readdir(path.join(core, directory))) {
        const relative = path.join(directory, entry)
        if (measured.includes(relative) || directories.includes(relative)) continue
        await fs.symlink(path.join(core, relative), path.join(root, relative))
      }
    }
    await fs.symlink(path.join(core, "node_modules"), path.join(root, "node_modules"))
    await fs.copyFile(path.join(core, "package.json"), path.join(root, "package.json"))
    for (const relative of measured.filter((file) => available.includes(file))) {
      const source =
        args.ref === "working"
          ? await Bun.file(path.join(core, relative)).text()
          : await git("show", `${revision}:packages/core/${relative}`)
      hashes[relative] = createHash("sha256").update(source).digest("hex")
      await Bun.write(path.join(root, relative), source)
    }
    const results: unknown[] = []
    for (const depth of depths) {
      for (const count of locations) {
        console.error(`config benchmark: ${args.ref}, depth=${depth}, locations=${count}`)
        const child = Bun.spawn(
          [
            process.execPath,
            import.meta.path,
            "--snapshot",
            root,
            "--depths",
            String(depth),
            "--locations",
            String(count),
            "--reloads",
            String(reloads),
            "--noise",
            String(noise),
          ],
          { cwd: core, stdout: "pipe", stderr: "inherit", timeout: 120_000 },
        )
        const output = await new Response(child.stdout).text()
        if (await child.exited) throw new Error(`Benchmark child failed: depth=${depth}, locations=${count}`)
        results.push(JSON.parse(output))
      }
    }
    console.log(
      JSON.stringify(
        {
          ref: args.ref,
          revision,
          hashes,
          bun: Bun.version,
          platform: process.platform,
          caveats: [
            "Config, discovery, watch planning and filesystem/watcher.ts vary by ref; other source/dependencies use this checkout.",
            "Startup ms is warm Config construction; CPU/calls include post-readiness settling. Imports, fixtures and shared dependencies are excluded.",
            "Discovery is clamped at the fixture root instead of scanning host ancestors.",
            "Heap uses two forced GCs and includes one changes observer per location; RSS includes allocator/JIT/native noise.",
            "Native subscriptions count Native interface handles (logical if pooled); Linux inotify delta counts kernel watches.",
            "Discovery count uses empty WellKnown.entries calls; file loads count readFileStringSafe attempts.",
            "Noise CPU includes fixture writes and settling (at least 450ms); native events may be coalesced.",
          ],
          results,
        },
        null,
        2,
      ),
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
} else {
  const config: typeof Config = (await import(pathToFileURL(path.join(args.snapshot, "src/config.ts")).href)).Config
  const watcher: typeof Watcher = (
    await import(pathToFileURL(path.join(args.snapshot, "src/filesystem/watcher.ts")).href)
  ).Watcher
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-bench-fixture-")))
  const depth = depths[0]
  const count = locations[0]
  const project = path.join(root, "project")
  const global = Global.make(
    Object.fromEntries(
      ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [
        key,
        path.join(root, key),
      ]),
    ),
  )
  const directories = Array.from({ length: count }, (_, index) =>
    path.join(project, ...Array.from({ length: depth }, (_, index) => `d${index}`), `sibling-${index}`),
  )
  const calls = { discoveries: 0, up: 0, resolve: 0, loads: 0, nativeEvents: 0, configEvents: 0 }
  let pending = 0
  const measure = <A, E>(key: "up" | "resolve" | "loads", effect: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      calls[key]++
      pending++
      return effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pending--
          }),
        ),
      )
    })
  const native = { active: 0, files: 0, entries: 0, directories: 0, acquired: 0, failed: 0 }
  const delta = (before: typeof calls) => ({
    discoveries: calls.discoveries - before.discoveries,
    up: calls.up - before.up,
    resolve: calls.resolve - before.resolve,
    loads: calls.loads - before.loads,
    nativeEvents: calls.nativeEvents - before.nativeEvents,
    configEvents: calls.configEvents - before.configEvents,
  })
  const memory = () => {
    Bun.gc(true)
    Bun.gc(true)
    const value = process.memoryUsage()
    return { heapUsed: value.heapUsed, rss: value.rss }
  }
  const inotify = async () => {
    if (process.platform !== "linux") return undefined
    const files = await fs.readdir("/proc/self/fdinfo")
    const text = await Promise.all(
      files.map((file) => fs.readFile(`/proc/self/fdinfo/${file}`, "utf8").catch(() => "")),
    )
    return text.flatMap((text) => text.split("\n")).filter((line) => line.startsWith("inotify ")).length
  }
  const settle = Effect.gen(function* () {
    while (true) {
      const before = JSON.stringify([calls, native])
      yield* Effect.sleep("150 millis")
      if (!pending && before === JSON.stringify([calls, native])) return
    }
  }).pipe(Effect.timeout("15 seconds"))
  const program = Effect.gen(function* () {
    const shared = yield* Layer.build(
      AppNodeBuilder.build(Bus.node, [Global.node.replace(Layer.succeed(Global.Service, global))]),
    )
    const filesystem = yield* Layer.build(AppNodeBuilder.build(FSUtil.node))
    const realFS = Context.get(filesystem, FSUtil.Service)
    const measuredFS = FSUtil.Service.of({
      ...realFS,
      up: (options) => measure("up", realFS.up({ ...options, stop: project })),
      resolve: (target) => measure("resolve", realFS.resolve(target)),
      readFileStringSafe: (target) => measure("loads", realFS.readFileStringSafe(target)),
    })
    const nativeContext = yield* Layer.build(watcher.nativeLayer)
    const realNative = Context.get(nativeContext, watcher.Native)
    const measuredNative = watcher.Native.of({
      subscribe: (input) =>
        Effect.gen(function* () {
          if (!FSUtil.contains(root, input.target)) return yield* Effect.die(`Watch escaped fixture: ${input.target}`)
          pending++
          const subscription = yield* realNative
            .subscribe({
              ...input,
              publish: (update) => {
                calls.nativeEvents++
                input.publish(update)
              },
            })
            .pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  pending--
                }),
              ),
            )
          if (!subscription) {
            native.failed++
            return undefined
          }
          const key = input.type === "file" ? "files" : input.type === "entries" ? "entries" : "directories"
          native.active++
          native[key]++
          native.acquired++
          return {
            ...subscription,
            unsubscribe: async () => {
              await subscription.unsubscribe()
              native.active--
              native[key]--
            },
          }
        }),
    })
    const watcherContext = yield* Layer.build(
      watcher.layer().pipe(Layer.provide(Layer.succeed(watcher.Native, measuredNative))),
    )
    const dependencies = Context.mergeAll(
      shared,
      watcherContext,
      Context.make(Global.Service, global),
      Context.make(FSUtil.Service, measuredFS),
      Context.make(
        Credential.Service,
        Credential.Service.of({
          all: () => Effect.succeed([]),
          list: () => Effect.succeed([]),
          get: () => Effect.undefined,
          create: () => Effect.die("unused"),
          activate: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
          remove: () => Effect.die("unused"),
        }),
      ),
      Context.make(
        WellKnown.Service,
        WellKnown.Service.of({
          entries: () =>
            Effect.sync(() => {
              calls.discoveries++
              return []
            }),
          snapshot: () => [],
          refresh: () => Effect.succeed(false),
          add: () => Effect.die("unused"),
          remove: () => Effect.die("unused"),
          resolve: () => Effect.die("unused"),
        }),
      ),
    )
    const build = (directory: string) =>
      Layer.build(config.layer()).pipe(
        Effect.provideContext(dependencies),
        Effect.provideService(Location.Service, {
          directory: AbsolutePath.make(directory),
          project: {
            id: Project.ID.global,
            directory: AbsolutePath.make(project),
            canonical: AbsolutePath.make(project),
          },
        }),
      )
    // Exclude initial module/JIT allocation from retained per-location state.
    yield* build(directories[0]).pipe(Effect.andThen(settle), Effect.scoped)
    native.acquired = 0
    const configs: Config.Interface[] = []
    const before = memory()
    const kernelBefore = yield* Effect.promise(inotify)
    const startCalls = { ...calls }
    const startCPU = process.cpuUsage()
    const start = performance.now()
    for (const directory of directories) {
      const context = yield* build(directory)
      const service = Context.get(context, config.Service)
      configs.push(service)
      yield* service.changes().pipe(
        Stream.runForEach(() =>
          Effect.sync(() => {
            calls.configEvents++
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    }
    const constructed = performance.now() - start
    // Include readiness rescans in CPU/memory, but not construction wall time.
    yield* settle
    const startup = { ms: constructed, cpu: process.cpuUsage(startCPU), calls: delta(startCalls) }
    const after = memory()
    const retained = { heapBytes: after.heapUsed - before.heapUsed, rssBytes: after.rss - before.rss }
    const kernelAfter = yield* Effect.promise(inotify)
    const subscriptions = {
      ...native,
      inotifyWatches: kernelAfter === undefined || kernelBefore === undefined ? undefined : kernelAfter - kernelBefore,
    }
    if (native.failed) return yield* Effect.die("Native watcher acquisition failed")
    const latencies: number[] = []
    const reloadCalls = { ...calls }
    for (let index = 0; index < reloads; index++) {
      const value = `reload-${index}`
      const start = performance.now()
      yield* Effect.promise(() => Bun.write(path.join(project, "opencode.json"), JSON.stringify({ shell: value })))
      yield* Effect.gen(function* () {
        while (true) {
          const entries = yield* Effect.forEach(configs, (service) => service.entries())
          if (entries.every((entries) => config.latest(entries, "shell") === value)) return
          yield* Effect.sleep("2 millis")
        }
      }).pipe(Effect.timeout("15 seconds"))
      latencies.push(performance.now() - start)
    }
    const reloaded = { ms: latencies, calls: delta(reloadCalls) }
    const noiseResults: unknown[] = []
    for (const target of [project, path.join(project, ".opencode")]) {
      yield* Effect.sleep("300 millis")
      const before = { ...calls }
      const cpu = process.cpuUsage()
      const start = performance.now()
      for (let index = 0; index < noise; index++) {
        yield* Effect.promise(() => Bun.write(path.join(target, `unrelated-${index}.txt`), "x"))
      }
      yield* Effect.sleep("300 millis")
      yield* settle
      noiseResults.push({
        target: path.relative(project, target) || ".",
        writes: noise,
        ms: performance.now() - start,
        cpu: process.cpuUsage(cpu),
        calls: delta(before),
      })
    }
    return { depth, locations: count, startup, retained, subscriptions, reload: reloaded, noise: noiseResults }
  }).pipe(Effect.scoped, Effect.provide(Logger.layer([])))
  try {
    await Promise.all(
      [...Object.values(global), ...directories, path.join(project, ".opencode")].map((directory) =>
        fs.mkdir(directory, { recursive: true }),
      ),
    )
    await Bun.write(path.join(project, "opencode.json"), JSON.stringify({ shell: "initial" }))
    const result = await Effect.runPromise(program)
    if (native.active) throw new Error(`Leaked ${native.active} subscriptions`)
    console.log(JSON.stringify({ ...result, activeAfterClose: native.active }))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}
