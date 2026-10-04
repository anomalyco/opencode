import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
import type { Agent } from "@opencode/schema/agent"
import type { Command } from "@opencode/schema/command"
import type { Model } from "@opencode/schema/model"
import { FSUtil } from "@opencode/util/fs-util"
import { Cause, Deferred, Effect, Exit, Schedule, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import type { ConfigOptionProvider } from "./config-option"

export const builtinCommands = new Map([
  ["compact", { description: "Compact the session", start: "compaction" as const }],
])

export type Catalog = {
  readonly providers: ConfigOptionProvider[]
  readonly models: ReadonlyArray<Model.Info>
  readonly defaultModel: Model.Ref
  readonly modes: ReadonlyArray<{ id: Agent.ID; name: string; description?: string }>
  readonly defaultModeID: Agent.ID
  readonly commands: ReadonlyArray<Command.Info>
}

class NotReadyError extends Schema.TaggedError<NotReadyError>()("ACPCatalogNotReadyError", {
  reason: Schema.Literals(["models", "agents"]),
}) {
  override get message() {
    return this.reason === "models" ? "No models are available" : "No primary agents are available"
  }
}

class LoadError extends Schema.TaggedError<LoadError>()("ACPCatalogLoadError", {
  cause: Schema.Defect(),
}) {}

export type Error = NotReadyError | LoadError

export interface Interface {
  readonly get: (cwd: string) => Effect.Effect<Catalog, Error>
  readonly reload: (cwd: string) => Effect.Effect<void, Error>
  readonly changes: (cwd: string) => Stream.Stream<Catalog, Error>
}

type Entry = {
  readonly cwd: string
  readonly catalog: SubscriptionRef.SubscriptionRef<Catalog>
  readonly lock: Semaphore.Semaphore
  requestedGeneration: number
  loadedGeneration: number
}

const reloadOn = new Set<OpenCodeEvent["type"]>(["model.updated", "agent.updated", "command.updated"])

export const make = Effect.fnUntraced(function* (client: OpenCodeClient) {
  const scope = yield* Effect.scope
  const entries = new Map<string, Deferred.Deferred<Entry, Error>>()
  const connected = yield* Deferred.make<void>()

  // Requests queued behind a running load share the next one.
  const reload = (entry: Entry) =>
    Effect.suspend(() => {
      const target = ++entry.requestedGeneration
      return entry.lock.withPermit(
        Effect.suspend(() => {
          if (entry.loadedGeneration >= target) return Effect.void
          const generation = entry.requestedGeneration
          return load(client, entry.cwd).pipe(
            Effect.flatMap((next) => SubscriptionRef.set(entry.catalog, next)),
            Effect.ignore,
            Effect.andThen(
              Effect.sync(() => {
                entry.loadedGeneration = generation
              }),
            ),
          )
        }),
      )
    })

  // Subscribe before the first read so an update between the read and the subscription is not lost.
  yield* client.event.subscribe().pipe(
    Stream.runForEach((event) => {
      if (event.type === "server.connected") return Deferred.succeed(connected, undefined)
      if (!reloadOn.has(event.type)) return Effect.void
      const directory = event.location?.directory
      const targets = directory === undefined ? [...entries.values()] : [entries.get(FSUtil.resolve(directory))]
      return Effect.forEach(
        targets.filter((entry) => entry !== undefined),
        (entry) => Deferred.await(entry).pipe(Effect.flatMap(reload), Effect.ignore, Effect.forkIn(scope)),
        { discard: true },
      )
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP catalog event stream failed", cause),
    ),
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped,
  )

  const create = Effect.fnUntraced(function* (cwd: string) {
    yield* Deferred.await(connected)
    return {
      cwd,
      catalog: yield* SubscriptionRef.make<Catalog>(yield* load(client, cwd)),
      lock: Semaphore.makeUnsafe(1),
      requestedGeneration: 0,
      loadedGeneration: 0,
    } satisfies Entry
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

  return {
    get: Effect.fnUntraced(function* (cwd) {
      const loaded = yield* entry(cwd)
      return yield* SubscriptionRef.get(loaded.catalog)
    }),
    reload: Effect.fn("cli.acp.catalog.reload")(function* (cwd) {
      yield* reload(yield* entry(cwd))
    }),
    changes: (cwd) => Stream.unwrap(entry(cwd).pipe(Effect.map((loaded) => SubscriptionRef.changes(loaded.catalog)))),
  } satisfies Interface
})

const load = (client: OpenCodeClient, cwd: string) =>
  read(client, cwd).pipe(
    // Providers may still be discovering models after startup.
    Effect.retry({
      while: (error) => error._tag === "ACPCatalogNotReadyError",
      schedule: Schedule.spaced("25 millis").pipe(Schedule.upTo({ duration: "5 seconds" })),
    }),
    Effect.withSpan("cli.acp.catalog.load"),
  )

const read = Effect.fnUntraced(function* (client: OpenCodeClient, cwd: string) {
  const location = { directory: cwd }
  const [modelResult, defaultResult, agentResult, commandResult] = yield* Effect.all(
    [
      client.model.list({ location }),
      client.model.default({ location }),
      client.agent.list({ location }),
      client.command.list({ location }),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => new LoadError({ cause })))
  const models = modelResult.data.filter((model) => model.enabled)
  const preferred = defaultResult.data
  // The parallel default read can name a model missing from this list.
  const defaultModel = preferred
    ? models.find((model) => model.providerID === preferred.providerID && model.id === preferred.id)
    : models[0]
  if (!defaultModel) return yield* new NotReadyError({ reason: "models" })
  const agents = agentResult.data.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  // Core lists its resolved default agent first, the same one a new session runs.
  const defaultAgent = agents[0]
  if (!defaultAgent) return yield* new NotReadyError({ reason: "agents" })
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
    commands: commandResult.data.filter((command) => !builtinCommands.has(command.name)),
  } satisfies Catalog
})

function providers(models: ReadonlyArray<Model.Info>) {
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
