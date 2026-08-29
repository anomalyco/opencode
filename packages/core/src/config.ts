export * as Config from "./config.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { type ParseError, parse } from "jsonc-parser"
import { Context, Effect, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect"
import {
  AgentsDirectory,
  ClaudeDirectory,
  Directory,
  Document,
  Info,
  type Entry,
  Event,
} from "@opencode-ai/schema/config"
import { Credential } from "./credential.js"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"
import { ConfigVariable } from "./config/variable.js"
import { ConfigNormalize } from "./config/normalize.js"
import { WellKnown } from "./wellknown.js"

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries.findLast((entry): entry is Document => entry.type === "document" && entry.info[key] !== undefined)
    ?.info[key]
}

export interface Interface {
  /** Returns location config documents and discovery sources from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /**
   * Streams raw filesystem updates under config roots. Config owns root
   * topology and watch reconciliation; domain owners filter this feed for the
   * source files they parse and rebuild their own state.
   */
  readonly changes: () => Stream.Stream<Watcher.Update>
}

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
  // false skips the global config dir, ~/.claude, and ~/.agents; wellknown,
  // file, and content entries still load.
  global: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export interface TestInterface extends Interface {
  /** Replaces the entries returned by subsequent entries() calls. */
  readonly setEntries: (entries: Entry[]) => Effect.Effect<void>
  /** Emits one filesystem update to every changes() subscriber. */
  readonly emitChange: (update: Watcher.Update) => Effect.Effect<void>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/Config/Test") {}

/** In-memory config for tests: static entries with replaceable state and a test-driven change feed. */
export const testLayer = (initial: Entry[] = []) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const entries = yield* Ref.make(initial)
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const service = Test.of({
        entries: () => Ref.get(entries),
        changes: () => Stream.fromPubSub(updates),
        setEntries: (next) => Ref.set(entries, next),
        emitChange: (update) => PubSub.publish(updates, update).pipe(Effect.asVoid),
      })
      return Context.empty().pipe(Context.add(Service, service), Context.add(Test, service))
    }),
  )

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const wellknown = yield* WellKnown.Service
      const names = ["opencode.json", "opencode.jsonc"]
      const reloadLock = Semaphore.makeUnsafe(1)
      const fileTargets = new Set<AbsolutePath>()
      const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
      const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
      const parseInfo = Effect.fn("Config.parseInfo")(function* (text: string, source: string) {
        const errors: ParseError[] = []
        const input: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) {
          yield* Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: "$",
            kind: "invalid",
            action: "rejected malformed JSON or JSONC document",
          })
          return
        }
        const result = ConfigNormalize.normalize(input)
        yield* Effect.forEach(result.diagnostics, (diagnostic) =>
          Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`,
            kind: diagnostic.kind,
            action: diagnostic.message,
          }),
        )
        if (result.type === "rejected") return
        const info = Option.getOrUndefined(decodeInfo(result.encoded))
        if (info) return info
        yield* Effect.logWarning("configuration normalization diagnostic", {
          source,
          path: "$",
          kind: "invalid",
          action: "rejected canonical configuration after final validation",
        })
      })

      const loadFile = Effect.fnUntraced(function* (filepath: string) {
        const text = yield* fs.readFileStringSafe(filepath)
        if (text === undefined) return
        const substituted = yield* ConfigVariable.substitute({ type: "path", path: filepath, text })
        const info = yield* parseInfo(substituted, filepath)
        if (!info) return
        return new Document({ type: "document", path: AbsolutePath.make(filepath), info })
      })

      const loadWellknownEntry = Effect.fnUntraced(function* (entry: WellKnown.Entry) {
        const auth = entry.manifest.auth
        if (!auth) return []
        const credential = (yield* credentials.list(entry.integrationID)).at(-1)
        if (!credential || credential.value.type !== "key") return []
        const variables = { [auth.env]: credential.value.key }
        const configs = yield* wellknown
          .resolve(entry, variables)
          .pipe(
            Effect.catch(() =>
              Effect.logWarning("failed to load wellknown config", { source: entry.origin }).pipe(
                Effect.as([] as const),
              ),
            ),
          )
        return yield* Effect.forEach(configs, (config) =>
          ConfigVariable.substitute({
            type: "virtual",
            source: entry.origin,
            dir: entry.origin,
            text: JSON.stringify(config),
            env: variables,
          }).pipe(
            Effect.flatMap((text) => parseInfo(text, entry.origin)),
            Effect.map((info) => (info ? new Document({ type: "document", info }) : undefined)),
          ),
        ).pipe(Effect.map((documents) => documents.filter((document) => document !== undefined)))
      })

      const loadWellknown = Effect.fn("Config.loadWellknown")(function* () {
        const entries = yield* wellknown
          .entries()
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to discover wellknown config", { error }).pipe(Effect.as([] as const)),
            ),
          )
        return yield* Effect.forEach(entries, loadWellknownEntry).pipe(Effect.map((documents) => documents.flat()))
      })

      const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath) {
        return [
          ...(yield* Effect.forEach(names, (file) => loadFile(path.join(directory, file))).pipe(
            Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
          )),
          new Directory({ type: "directory", path: directory }),
        ]
      })

      const discover = Effect.fn("Config.discover")(function* () {
        const globalDirectory = AbsolutePath.make(global.config)
        const globalAgentsDirectory = AbsolutePath.make(path.join(global.home, ".agents"))
        const globalClaudeDirectory = AbsolutePath.make(path.join(global.home, ".claude"))
        const locationIsGlobal = path.resolve(location.directory) === path.resolve(global.config)
        const discovered =
          locationIsGlobal || options?.project === false
            ? []
            : yield* fs
                .up({
                  targets: [".opencode", ".claude", ".agents", ...names.toReversed()],
                  start: location.directory,
                })
                .pipe(Effect.orDie)

        const globalEnabled = options?.global !== false
        // A walked path that resolves into a global root is global config
        // however the walk reached it (home above the project, or a location
        // beneath the global config dir), so global: false excludes it
        // uniformly — classified once here, not per consumer below.
        const globalRoots = [globalDirectory, globalClaudeDirectory, globalAgentsDirectory].map((item) =>
          path.resolve(item),
        )
        const visible = globalEnabled
          ? discovered
          : discovered.filter((item) => {
              const resolved = path.resolve(item)
              return !globalRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
            })
        // We load certain files from a few other folders in the ecosystem
        const claude = [
          ...new Set([
            ...(globalEnabled && (yield* fs.isDir(globalClaudeDirectory)) ? [globalClaudeDirectory] : []),
            ...visible.filter((item) => path.basename(item) === ".claude").toReversed(),
          ]),
        ].map((directory) => new ClaudeDirectory({ type: "claude", path: AbsolutePath.make(directory) }))
        const agents = [
          ...new Set([
            ...(globalEnabled && (yield* fs.isDir(globalAgentsDirectory)) ? [globalAgentsDirectory] : []),
            ...visible.filter((item) => path.basename(item) === ".agents").toReversed(),
          ]),
        ].map((directory) => new AgentsDirectory({ type: "agents", path: AbsolutePath.make(directory) }))

        const projectDirectories = visible
          .filter((item) => path.basename(item) === ".opencode")
          .toReversed()
          .map((directory) => AbsolutePath.make(directory))
        const directPaths = visible
          .filter((item) => ![".agents", ".claude", ".opencode"].includes(path.basename(item)))
          .toReversed()
        fileTargets.clear()
        directPaths.forEach((filepath) => fileTargets.add(AbsolutePath.make(filepath)))
        const direct = yield* Effect.forEach(directPaths, (filepath) => loadFile(filepath)).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.filter((entry): entry is Document => entry !== undefined)),
        )

        const file = options?.file
        if (file) fileTargets.add(AbsolutePath.make(path.resolve(file)))
        const explicit = file
          ? yield* loadFile(path.resolve(file)).pipe(
              Effect.map((config) => (config ? [config] : [])),
              Effect.orDie,
            )
          : []
        const content =
          options?.content !== undefined
            ? yield* ConfigVariable.substitute({
                type: "virtual",
                source: "OPENCODE_CONFIG_CONTENT",
                dir: location.directory,
                text: options.content,
              }).pipe(
                Effect.flatMap((text) => parseInfo(text, "OPENCODE_CONFIG_CONTENT")),
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
                Effect.orDie,
              )
            : []

        // Global entries sit below explicit and direct files; project
        // directories rank above them.
        const globalSupplementary = globalEnabled ? yield* loadDirectory(globalDirectory).pipe(Effect.orDie) : []
        const projectSupplementary = yield* Effect.forEach(projectDirectories, loadDirectory).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.flat()),
        )
        return [
          ...(yield* loadWellknown().pipe(Effect.orDie)),
          ...claude,
          ...agents,
          ...globalSupplementary,
          ...explicit,
          ...direct,
          ...projectSupplementary,
          ...content,
        ]
      })

      const initial = yield* discover()
      let configs = initial
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      // Vendored trees inside config roots (a plugin's node_modules, a nested
      // .git) produce event blizzards that can never change discovery output.
      const ignore = ["node_modules", ".git", "**/{node_modules,.git}/**"]
      // Watch-once: roots leave discovery only by deletion, so a stale watch is
      // inert, bounded, and dies with this layer — and keeping a deleted root's
      // watch alive is exactly what makes its recreation observable.
      const watched = new Set<string>()
      const reconcile = Effect.fn("Config.reconcileWatches")(function* (entries: readonly Entry[]) {
        const directories = entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : []))
        const files = [
          ...entries.flatMap((entry) => (entry.type === "document" && entry.path ? [entry.path] : [])),
          ...fileTargets,
        ]
        const targets = [
          ...directories.map((path) => ({ path, type: "directory" as const, ignore })),
          ...files
            .filter((file) => !directories.some((directory) => FSUtil.contains(directory, file)))
            .map((path) => ({ path, type: "file" as const })),
        ]
        for (const target of targets) {
          const key = JSON.stringify(target)
          if (watched.has(key)) continue
          watched.add(key)
          const stream = yield* watcher.subscribe(target)
          yield* stream.pipe(
            Stream.runForEach((update) => PubSub.publish(updates, update)),
            Effect.forkScoped({ startImmediately: true }),
          )
        }
      })

      const reload = Effect.fn("Config.reload")(
        function* () {
          const next = yield* discover()
          yield* reconcile(next)
          if (isDeepStrictEqual(configs, next)) return
          configs = next
          yield* bus.publish(Event.Updated, {})
        },
        (effect) => reloadLock.withPermit(effect),
      )

      yield* Stream.fromPubSub(updates).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach((update) =>
          reload().pipe(
            Effect.catchCause((cause) => Effect.logError("failed to reload config", { path: update.path, cause })),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filterEffect((event) =>
          wellknown.entries().pipe(
            Effect.map((entries) => entries.some((entry) => entry.integrationID === event.data.integrationID)),
            Effect.orElseSucceed(() => false),
          ),
        ),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(WellKnown.Event.Updated).pipe(
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown sources", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 minutes").pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (!wellknown.snapshot().length) return Effect.void
            return Effect.gen(function* () {
              const changed = yield* wellknown
                .refresh()
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to refresh wellknown manifests", { error }).pipe(Effect.as(false)),
                  ),
                )
              if (!changed) yield* reload()
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to refresh wellknown config", { cause })))
          }),
        ),
        Effect.forever,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* reconcile(initial)

      return Service.of({
        entries: Effect.fnUntraced(function* () {
          return configs
        }),
        changes: () => Stream.fromPubSub(updates),
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [Watcher.node, Bus.node, FSUtil.node, Global.node, Location.node, Credential.node, WellKnown.node],
  })
}

export const node = configured()
