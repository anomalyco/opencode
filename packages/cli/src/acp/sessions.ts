import { isDeepStrictEqual } from "node:util"
import type { McpServer, SessionConfigOption } from "@agentclientprotocol/sdk"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
import { Mcp } from "@opencode/schema/mcp"
import type { Model } from "@opencode/schema/model"
import type { Session } from "@opencode/schema/session"
import { FSUtil } from "@opencode/util/fs-util"
import { Cause, Deferred, Effect, Exit, Queue, Ref, Scope, Stream } from "effect"
import type { ACPCatalog, Catalog } from "./catalog"
import { ACPClient } from "./client"
import { availableCommands, configOptions, type Change, type Selection } from "./config-option"
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
  readonly select: (attached: Attached, change: Change) => Effect.Effect<void, ACPError.Error>
  /** Adds the session's MCP servers again after its Location was shut down, which drops them. */
  readonly restoreMcp: (attached: Attached) => Effect.Effect<void, ACPError.Error>
}

type Entry = {
  readonly attached: Attached
  readonly scope: Scope.Closeable
  readonly selected: Queue.Queue<Change>
  /** The selection the server last reported, which a switch to the same value leaves alone without an echo. */
  confirmed: Selection
  /** This adapter's switches whose echo has not arrived, oldest first. */
  readonly pending: Change[]
}

type McpState = {
  readonly servers: Map<string, Mcp.ServerConfig>
  readonly registered: Map<string, Mcp.ServerConfig>
}

type SelectedEvent = Extract<OpenCodeEvent, { type: "session.model.selected" | "session.agent.selected" }>
type ForwardedEvent = Extract<OpenCodeEvent, { type: "session.renamed" | "location.shutdown" }> | SelectedEvent

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly catalog: ACPCatalog.Interface
}) {
  const scope = yield* Effect.scope
  const sessions = new Map<string, Entry>()
  // Outlives entries so re-attaching does not re-add servers.
  const mcpBySession = new Map<string, McpState>()
  const connected = yield* Deferred.make<void>()

  // Subscribe before any attach so a switch right after `sessions.set` reaches the session.
  yield* input.client.event.subscribe().pipe(
    Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void)),
    Stream.filter(
      (event): event is ForwardedEvent =>
        event.type === "session.model.selected" ||
        event.type === "session.agent.selected" ||
        event.type === "session.renamed" ||
        event.type === "location.shutdown",
    ),
    Stream.runForEach((event) => {
      if (event.type === "location.shutdown") return Effect.sync(() => shutdown(event.location?.directory))
      const entry = sessions.get(event.data.sessionID)
      if (!entry) return Effect.void
      if (event.type === "session.renamed")
        return input.connection
          .sessionUpdate({
            sessionId: entry.attached.id,
            update: { sessionUpdate: "session_info_update", title: event.data.title },
          })
          .pipe(Effect.ignore)
      return echoed(
        entry,
        event.type === "session.model.selected" ? { model: event.data.model } : { modeID: event.data.agent },
      )
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP selection event stream failed", cause),
    ),
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped,
  )

  // A Location shutdown drops the MCP servers added to it, so they are added again before the next prompt.
  const shutdown = (directory: string | undefined) => {
    const target = directory === undefined ? undefined : FSUtil.resolve(directory)
    sessions.forEach((entry, sessionID) => {
      if (target === undefined || FSUtil.resolve(entry.attached.cwd) === target)
        mcpBySession.get(sessionID)?.registered.clear()
    })
  }

  // Echoes arrive in switch order, so a matched echo also settles this adapter's earlier switches of the same kind,
  // and while one of them is in flight it, not the echo, decides the selection.
  const echoed = (entry: Entry, change: Change) =>
    Effect.suspend(() => {
      entry.confirmed = { ...entry.confirmed, ...change }
      const index = entry.pending.findIndex((item) => sameChange(item, change))
      const settled = entry.pending.filter((item, position) => position <= index && sameKind(item, change))
      settled.forEach((item) => entry.pending.splice(entry.pending.indexOf(item), 1))
      if (index !== -1 || entry.pending.some((item) => sameKind(item, change))) return Effect.void
      return Queue.offer(entry.selected, change)
    })

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
      const mcp = mcpBySession.get(attached.id) ?? { servers: new Map(), registered: new Map() }
      mcpBySession.set(attached.id, mcp)
      servers.forEach((server) => mcp.servers.set(server.name, mcpConfig(server)))
      return Effect.forEach(
        [...mcp.servers],
        ([name, config]) =>
          Effect.suspend(() => {
            if (isDeepStrictEqual(mcp.registered.get(name), config)) return Effect.void
            mcp.registered.set(name, config)
            return input.client.experimental.mcp
              .add({ server: name, location: { directory: attached.cwd }, config })
              .pipe(
                Effect.catch(ACPClient.classify),
                Effect.onError(() => Effect.sync(() => mcp.registered.delete(name))),
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
        mcpBySession.delete(sessionID)
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
        selected: yield* Queue.unbounded<Change>(),
        confirmed: { model: session.model, modeID: session.agent },
        pending: [],
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
    // Update selection before switching so the echoed event is a no-op, and restore it if the switch fails.
    select: Effect.fnUntraced(function* (attached, change) {
      const current = sessions.get(attached.id)
      const entry = current?.attached === attached ? current : undefined
      // The server publishes nothing for a switch to its current value, so only a real change waits for an echo.
      const tracked = entry && !holds(entry.confirmed, change) ? { ...change } : undefined
      if (entry && tracked) entry.pending.push(tracked)
      const previous = yield* Ref.getAndUpdate(attached.selection, (selection) => ({ ...selection, ...change }))
      yield* (
        "model" in change
          ? input.client.session.switchModel({ sessionID: attached.id, model: change.model })
          : input.client.session.switchAgent({ sessionID: attached.id, agent: change.modeID })
      ).pipe(
        Effect.catch(ACPClient.classify),
        Effect.onError(() =>
          Effect.suspend(() => {
            if (entry && tracked && entry.pending.includes(tracked))
              entry.pending.splice(entry.pending.indexOf(tracked), 1)
            const latest =
              entry?.pending.findLast((item) => sameKind(item, change)) ?? field(entry?.confirmed ?? previous, change)
            return Ref.update(attached.selection, (selection) => ({ ...selection, ...latest }))
          }),
        ),
      )
    }),
    restoreMcp: Effect.fnUntraced(function* (attached) {
      if (mcpBySession.has(attached.id)) yield* registerMcp(attached, [])
    }),
  } satisfies Interface
})

function sameKind(a: Change, b: Change) {
  return "model" in a === "model" in b
}

function sameChange(a: Change, b: Change) {
  return sameKind(a, b) && holds(a, b)
}

// Core treats a missing variant as the default one.
function sameModel(a: Model.Ref | undefined, b: Model.Ref | undefined) {
  return a?.providerID === b?.providerID && a?.id === b?.id && (a?.variant ?? "default") === (b?.variant ?? "default")
}

function holds(selection: Selection, change: Change) {
  return "model" in change ? sameModel(selection.model, change.model) : selection.modeID === change.modeID
}

/** The value `selection` has for the setting `change` switches. */
function field(selection: Selection, change: Change): Selection {
  return "model" in change ? { model: selection.model } : { modeID: selection.modeID }
}

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
