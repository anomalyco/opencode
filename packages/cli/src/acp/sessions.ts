import { isDeepStrictEqual } from "node:util"
import type { McpServer, SessionConfigOption } from "@agentclientprotocol/sdk"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
import { Mcp } from "@opencode/schema/mcp"
import type { Session } from "@opencode/schema/session"
import { Cause, Deferred, Effect, Exit, Queue, Ref, Scope, Stream } from "effect"
import type { ACPCatalog, Catalog } from "./catalog"
import { ACPClient } from "./client"
import { availableCommands, configOptions, type Selection } from "./config-option"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"

export type SupportedMcpServer = Exclude<McpServer, { readonly type: "acp" | "sse" }>

export type Attached = {
  readonly id: Session.ID
  readonly cwd: string
  readonly selection: Ref.Ref<Selection>
}

export interface Interface {
  readonly attach: (
    session: Session.Info,
    cwd: string,
    mcpServers: readonly SupportedMcpServer[],
  ) => Effect.Effect<{ readonly attached: Attached; readonly configOptions: SessionConfigOption[] }, ACPError.Failure>
  readonly detach: (sessionID: string) => Effect.Effect<void>
  readonly release: (attached: Attached) => Effect.Effect<void>
  readonly require: (sessionID: string) => Effect.Effect<Attached, ACPError.SessionNotFoundError>
  readonly fork: (attached: Attached, effect: Effect.Effect<void>) => Effect.Effect<void, ACPError.SessionNotFoundError>
}

type Entry = {
  readonly attached: Attached
  readonly scope: Scope.Closeable
  readonly selected: Queue.Queue<Selection>
}

type SelectedEvent = Extract<OpenCodeEvent, { type: "session.model.selected" | "session.agent.selected" }>

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly catalog: ACPCatalog.Interface
}) {
  const scope = yield* Effect.scope
  const sessions = new Map<string, Entry>()
  // Outlives entries so re-attaching does not re-add servers.
  const registeredMcpBySession = new Map<string, Map<string, Mcp.ServerConfig>>()
  const connected = yield* Deferred.make<void>()

  // Subscribe before any attach so a switch right after `sessions.set` reaches the session.
  yield* input.client.event.subscribe().pipe(
    Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void)),
    Stream.filter(
      (event): event is SelectedEvent =>
        event.type === "session.model.selected" || event.type === "session.agent.selected",
    ),
    Stream.runForEach((event) => {
      const entry = sessions.get(event.data.sessionID)
      if (!entry) return Effect.void
      return Queue.offer(
        entry.selected,
        event.type === "session.model.selected" ? { model: event.data.model } : { modeID: event.data.agent },
      )
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP selection event stream failed", cause),
    ),
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped,
  )

  const sendCommands = (sessionID: string, catalog: Catalog) =>
    input.connection.sessionUpdate({
      sessionId: sessionID,
      update: { sessionUpdate: "available_commands_update", availableCommands: availableCommands(catalog) },
    })

  const changed = Effect.fnUntraced(function* (attached: Attached, previous: Catalog, next: Catalog, patch: Selection) {
    const selection = yield* Ref.getAndUpdate(attached.selection, (current) => ({ ...current, ...patch }))
    const options = configOptions(next, { ...selection, ...patch })
    if (!isDeepStrictEqual(options, configOptions(previous, selection))) {
      yield* input.connection.sessionUpdate({
        sessionId: attached.id,
        update: { sessionUpdate: "config_option_update", configOptions: options },
      })
    }
    if (!isDeepStrictEqual(next.commands, previous.commands)) yield* sendCommands(attached.id, next)
  })

  const registerMcp = (attached: Attached, servers: readonly SupportedMcpServer[]) =>
    Effect.suspend(() => {
      const registered = registeredMcpBySession.get(attached.id) ?? new Map<string, Mcp.ServerConfig>()
      registeredMcpBySession.set(attached.id, registered)
      return Effect.forEach(
        servers,
        (server) =>
          Effect.suspend(() => {
            const config = mcpConfig(server)
            if (isDeepStrictEqual(registered.get(server.name), config)) return Effect.void
            registered.set(server.name, config)
            return input.client.mcp.add({ server: server.name, location: { directory: attached.cwd }, config }).pipe(
              Effect.catch(ACPClient.classify),
              Effect.onError(() => Effect.sync(() => registered.delete(server.name))),
              Effect.uninterruptible,
            )
          }),
        { concurrency: "unbounded", discard: true },
      )
    })

  const remove = (sessionID: string, entry: Entry) =>
    Effect.suspend(() => {
      if (sessions.get(sessionID) === entry) {
        sessions.delete(sessionID)
        registeredMcpBySession.delete(sessionID)
      }
      return Scope.close(entry.scope, Exit.void)
    })

  return {
    attach: Effect.fn("cli.acp.sessions.attach")(function* (session, cwd, mcpServers) {
      yield* Deferred.await(connected)
      const current = yield* input.catalog.get(cwd)
      const entry: Entry = {
        attached: {
          id: session.id,
          cwd,
          selection: yield* Ref.make<Selection>({ model: session.model, modeID: session.agent }),
        },
        scope: Scope.forkUnsafe(scope),
        selected: yield* Queue.unbounded<Selection>(),
      }
      // Swap synchronously so concurrent attaches of one ID cannot both keep a scope.
      const replaced = sessions.get(session.id)
      sessions.set(session.id, entry)
      if (replaced) yield* Scope.close(replaced.scope, Exit.void)
      yield* registerMcp(entry.attached, mcpServers).pipe(Effect.onError(() => remove(session.id, entry)))
      const responded = yield* ACPConnection.Responded
      // `changes` replays the latest catalog, so a reload since `current` still pushes.
      // One fold keeps catalog and selection consistent.
      yield* Effect.gen(function* () {
        yield* responded
        yield* sendCommands(session.id, current)
        yield* Stream.merge(
          input.catalog.changes(cwd).pipe(Stream.map((catalog) => ({ catalog, patch: {} }))),
          Stream.fromQueue(entry.selected).pipe(Stream.map((patch) => ({ catalog: undefined, patch }))),
        ).pipe(
          Stream.runFoldEffect(
            () => current,
            (previous, step) => {
              const next = step.catalog ?? previous
              return changed(entry.attached, previous, next, step.patch).pipe(Effect.ignore, Effect.as(next))
            },
          ),
        )
      }).pipe(Effect.ignore, Effect.forkIn(entry.scope))
      return {
        attached: entry.attached,
        configOptions: configOptions(current, yield* Ref.get(entry.attached.selection)),
      }
    }),
    detach: Effect.fn("cli.acp.sessions.detach")(function* (sessionID) {
      const entry = sessions.get(sessionID)
      if (entry) yield* remove(sessionID, entry)
    }),
    release: Effect.fn("cli.acp.sessions.release")(function* (attached) {
      const entry = sessions.get(attached.id)
      if (entry?.attached === attached) yield* remove(attached.id, entry)
    }),
    require: Effect.fnUntraced(function* (sessionID) {
      const entry = sessions.get(sessionID)
      if (!entry) return yield* new ACPError.SessionNotFoundError({ sessionId: sessionID })
      return entry.attached
    }),
    fork: Effect.fn("cli.acp.sessions.fork")(function* (attached, effect) {
      const entry = sessions.get(attached.id)
      if (entry?.attached !== attached) return yield* new ACPError.SessionNotFoundError({ sessionId: attached.id })
      yield* Effect.forkIn(effect, entry.scope, { startImmediately: true })
    }),
  } satisfies Interface
})

function mcpConfig(server: SupportedMcpServer) {
  if ("type" in server) {
    return new Mcp.RemoteConfig({
      type: "remote",
      url: server.url,
      headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
      oauth: false,
    })
  }
  return new Mcp.LocalConfig({
    type: "local",
    command: [server.command, ...server.args],
    environment: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
  })
}

export * as ACPSessions from "./sessions"
