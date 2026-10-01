import type { CommandInfo, ModelInfo, ModelRef, OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import type { ConfigOptionProvider } from "./config-option"

export type Catalog = {
  readonly providers: ConfigOptionProvider[]
  readonly models: ModelInfo[]
  readonly defaultModel: ModelRef
  readonly modes: Array<{ id: string; name: string; description?: string }>
  readonly defaultModeID: string
  readonly commands: CommandInfo[]
}

export type Change = { readonly previous: Catalog; readonly current: Catalog }

export class NotReadyError extends Schema.TaggedError<NotReadyError>()("ACPCatalogNotReadyError", {
  message: Schema.String,
}) {}

export class LoadError extends Schema.TaggedError<LoadError>()("ACPCatalogLoadError", {
  cause: Schema.Defect(),
}) {}

export type Error = NotReadyError | LoadError

export interface Interface {
  /** Loads a directory's catalog once. Concurrent callers share the load, and a failed load is not cached. */
  readonly get: (cwd: string) => Effect.Effect<Catalog, Error>
  /** Resolves after a reload that started after the call. A failed reload keeps the previous catalog. */
  readonly reload: (cwd: string) => Effect.Effect<void, Error>
  readonly changes: (cwd: string) => Stream.Stream<Change, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Catalog") {}

type Entry = {
  readonly catalog: SubscriptionRef.SubscriptionRef<Catalog>
  readonly reloads: Queue.Queue<Deferred.Deferred<void>>
}

// Provider, integration, and credential changes reach the catalog through model.updated.
const reloadOn = new Set<OpenCodeEvent["type"]>(["model.updated", "agent.updated", "command.updated"])

// The prompt handler routes `/compact` to session compaction instead of running it as a server command.
const compact = { name: "compact", description: "Compact the session" } satisfies CommandInfo

export const make = Effect.fnUntraced(function* (client: OpenCodeClient) {
  const scope = yield* Effect.scope
  const entries = new Map<string, Deferred.Deferred<Entry, Error>>()
  const connected = yield* Deferred.make<void>()

  // Subscribe before the first read so an update between the read and the subscription is not lost.
  yield* Stream.fromAsyncIterable(client.event.subscribe(), (cause) => cause).pipe(
    Stream.runForEach((event) => {
      if (event.type === "server.connected") return Deferred.succeed(connected, undefined)
      if (!reloadOn.has(event.type)) return Effect.void
      const directory = event.location?.directory
      const targets = directory === undefined ? [...entries.values()] : [entries.get(FSUtil.resolve(directory))]
      return Effect.forEach(
        targets.filter((entry) => entry !== undefined),
        (entry) =>
          Deferred.await(entry).pipe(
            Effect.flatMap((loaded) => Queue.offer(loaded.reloads, Deferred.makeUnsafe<void>())),
            Effect.ignore,
            Effect.forkIn(scope),
          ),
        { discard: true },
      )
    }),
    Effect.ignore,
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped,
  )

  const create = Effect.fnUntraced(function* (cwd: string) {
    yield* Deferred.await(connected)
    const entry: Entry = {
      catalog: yield* SubscriptionRef.make<Catalog>(yield* load(client, cwd)),
      reloads: yield* Queue.unbounded<Deferred.Deferred<void>>(),
    }
    // Requests that arrive during a reload coalesce into the next one, so the latest request wins.
    yield* Queue.takeAll(entry.reloads).pipe(
      Effect.flatMap((waiters) =>
        load(client, cwd).pipe(
          Effect.flatMap((next) => SubscriptionRef.set(entry.catalog, next)),
          Effect.ignore,
          Effect.andThen(Effect.forEach(waiters, (done) => Deferred.succeed(done, undefined), { discard: true })),
        ),
      ),
      Effect.forever,
      Effect.forkIn(scope),
    )
    return entry
  })

  const entry = (cwd: string) =>
    Effect.suspend(() => {
      const key = FSUtil.resolve(cwd)
      const cached = entries.get(key)
      if (cached) return Deferred.await(cached)
      const loading = Deferred.makeUnsafe<Entry, Error>()
      entries.set(key, loading)
      return create(cwd).pipe(
        Effect.onExit((exit) => {
          if (Exit.isFailure(exit)) entries.delete(key)
          return Deferred.done(loading, exit)
        }),
        Effect.forkIn(scope),
        Effect.andThen(Deferred.await(loading)),
      )
    })

  return Service.of({
    get: Effect.fn("cli.acp.catalog.get")(function* (cwd) {
      const loaded = yield* entry(cwd)
      return yield* SubscriptionRef.get(loaded.catalog)
    }),
    reload: Effect.fn("cli.acp.catalog.reload")(function* (cwd) {
      const loaded = yield* entry(cwd)
      const done = yield* Deferred.make<void>()
      yield* Queue.offer(loaded.reloads, done)
      yield* Deferred.await(done)
    }),
    changes: (cwd) =>
      Stream.unwrap(entry(cwd).pipe(Effect.map((loaded) => SubscriptionRef.changes(loaded.catalog)))).pipe(
        Stream.mapAccum(
          () => Option.none<Catalog>(),
          (previous, current) =>
            [Option.some(current), Option.isSome(previous) ? [{ previous: previous.value, current }] : []] as const,
        ),
      ),
  })
})

export const layer = (client: OpenCodeClient) => Layer.effect(Service, make(client))

/** Server commands plus the built-in commands ACP handles itself. */
export function commands(catalog: Catalog) {
  if (catalog.commands.some((command) => command.name === compact.name)) return catalog.commands
  return [...catalog.commands, compact]
}

export type Live = {
  readonly cwd: string
  current: Catalog
}

/** Temporary adapter for the promise-based `ACPService` until sessions consume the service directly. */
export function promise(input: {
  readonly catalog: Interface
  readonly run: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Promise<A>
  readonly changed: (live: Live, previous: Catalog) => Promise<unknown>
}) {
  const lives = new Map<string, Live>()
  // Rejects with what the promise loader threw, so request errors stay unchanged.
  const run = <A>(effect: Effect.Effect<A, Error, Scope.Scope>) =>
    input.run(
      effect.pipe(
        Effect.mapError((error) =>
          error._tag === "ACPCatalogLoadError" ? error.cause : new globalThis.Error(error.message),
        ),
      ),
    )
  return {
    get: (cwd: string) =>
      run(
        Effect.gen(function* () {
          const current = yield* input.catalog.get(cwd)
          const key = FSUtil.resolve(cwd)
          const existing = lives.get(key)
          if (existing) return existing
          const live: Live = { cwd, current }
          lives.set(key, live)
          yield* input.catalog.changes(cwd).pipe(
            Stream.runForEach((change) =>
              Effect.promise(() => {
                live.current = change.current
                return input.changed(live, change.previous).catch(() => {})
              }),
            ),
            Effect.ignore,
            Effect.forkScoped({ startImmediately: true }),
          )
          return live
        }),
      ),
    reload: (live: Live) =>
      run(
        input.catalog.reload(live.cwd).pipe(
          Effect.andThen(input.catalog.get(live.cwd)),
          Effect.map((current) => {
            live.current = current
          }),
        ),
      ),
  }
}

const load = (client: OpenCodeClient, cwd: string) =>
  read(client, cwd).pipe(
    // Some providers discover models in the background after plugin startup begins.
    Effect.retry({
      while: (error) => error._tag === "ACPCatalogNotReadyError",
      schedule: Schedule.spaced("25 millis").pipe(Schedule.upTo({ duration: "5 seconds" })),
    }),
    Effect.withSpan("cli.acp.catalog.load"),
  )

const read = Effect.fnUntraced(function* (client: OpenCodeClient, cwd: string) {
  const location = { directory: cwd }
  const [modelResult, defaultResult, agentResult, commandResult] = yield* Effect.tryPromise({
    try: (signal) =>
      Promise.all([
        client.model.list({ location }, { signal }),
        client.model.default({ location }, { signal }),
        client.agent.list({ location }, { signal }),
        client.command.list({ location }, { signal }),
      ]),
    catch: (cause) => new LoadError({ cause }),
  })
  const models = modelResult.data.filter((model) => model.enabled)
  const preferred = defaultResult.data
  // Parallel reads can straddle initialization; select only from this model list.
  const defaultModel = preferred
    ? models.find((model) => model.providerID === preferred.providerID && model.id === preferred.id)
    : models[0]
  if (!defaultModel) return yield* new NotReadyError({ message: "No models are available" })
  const agents = agentResult.data.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const defaultAgent = agents.find((agent) => agent.mode === "primary") ?? agents[0]
  if (!defaultAgent) return yield* new NotReadyError({ message: "No primary agents are available" })
  return {
    providers: providers(models),
    models,
    defaultModel: {
      providerID: defaultModel.providerID,
      id: defaultModel.id,
      variant: defaultModel.variants.find((variant) => variant.id === "default")?.id,
    },
    modes: agents.map((agent) => ({ id: agent.id, name: agent.name, description: agent.description })),
    defaultModeID: defaultAgent.id,
    commands: commandResult.data,
  } satisfies Catalog
})

function providers(models: readonly ModelInfo[]): ConfigOptionProvider[] {
  return Array.from(new Set(models.map((model) => model.providerID)))
    .toSorted()
    .map((providerID) => ({
      id: providerID,
      name: providerID,
      models: models
        .filter((model) => model.providerID === providerID)
        .map((model) => ({ id: model.id, name: model.name, variants: model.variants.map((variant) => variant.id) })),
    }))
}

export * as ACPCatalog from "./catalog"
