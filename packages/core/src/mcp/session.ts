export * as McpSession from "./session.js"

import type { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { isDeepStrictEqual } from "node:util"
import { Context, Effect, Latch, Layer, Stream } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Credential } from "../credential.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Environment } from "../environment/index.js"
import { Form } from "../form.js"
import { Location } from "../location.js"
import { SessionStore } from "../session/store.js"
import { Mcp } from "./index.js"

type Owner = Extract<Mcp.Owner, { readonly type: "session" }>
type Entry = Mcp.Entry<Owner>
type Registry = { readonly servers: Map<Mcp.ServerName, Entry>; readonly locks: KeyedMutex.KeyedMutex<Mcp.ServerName> }

export interface OwnedTool {
  readonly tool: Mcp.Tool
  readonly call: (input: {
    readonly args?: Record<string, unknown>
    readonly sessionID: Session.ID
  }) => Effect.Effect<Mcp.ToolResult, Mcp.ToolCallError>
}

/**
 * MCP capabilities visible to one Session: Location servers plus the servers registered for the Session
 * or one of its ancestors, nearest owner first. A visible Session-scoped server shadows the Location
 * server of the same name.
 */
export interface View {
  readonly shadowed: ReadonlySet<string>
  readonly servers: ReadonlyArray<Mcp.ServerInfo>
  /** Tools of the visible Location servers. */
  readonly tools: ReadonlyArray<Mcp.Tool>
  readonly owned: ReadonlyArray<OwnedTool>
  readonly instructions: ReadonlyArray<Mcp.ServerInstructions>
  readonly resourceCatalog: Effect.Effect<Mcp.ResourceCatalog>
  readonly resources: (server: string) => Effect.Effect<Mcp.ResourceCatalog, Error>
  readonly readResource: (input: {
    readonly server: string
    readonly uri: string
  }) => Effect.Effect<Mcp.ResourceContent | undefined, Error>
}

/** Process-local MCP servers owned by a Session, released on removal or when the Session is deleted or moved away. */
export interface Interface {
  /** Re-adding an identical config is a no-op; a different config replaces only this Session's server. */
  readonly add: (sessionID: Session.ID, server: string, config: Mcp.ServerConfig) => Effect.Effect<void>
  readonly remove: (sessionID: Session.ID, server: string) => Effect.Effect<void, Mcp.NotFoundError>
  readonly view: (sessionID: Session.ID) => Effect.Effect<View>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpSession") {}

export const layer = (options?: Mcp.Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const mcp = yield* Mcp.Service
      const store = yield* SessionStore.Service
      const bus = yield* Bus.Service
      const location = yield* Location.Service
      const registries = new Map<Session.ID, Registry>()

      const withRegistry = <A, E, R>(
        sessionID: Session.ID,
        name: Mcp.ServerName,
        effect: (servers: Map<Mcp.ServerName, Entry>) => Effect.Effect<A, E, R>,
      ) =>
        Effect.suspend(() => {
          const registry = registries.get(sessionID) ?? { servers: new Map(), locks: KeyedMutex.makeUnsafe() }
          registries.set(sessionID, registry)
          return registry.locks
            .withLock(name)(effect(registry.servers))
            .pipe(
              // Forget the Session once its last server is gone and no operation still waits on its locks.
              Effect.ensuring(
                Effect.gen(function* () {
                  if (registry.servers.size > 0 || (yield* registry.locks.size) > 0) return
                  if (registries.get(sessionID) === registry) registries.delete(sessionID)
                }),
              ),
            )
        })

      const runtime = yield* Mcp.makeRuntime<Owner>({
        options,
        lock: (name, owner) => (effect) => withRegistry(owner.id, name, () => effect),
      })

      const remove = (sessionID: Session.ID, server: string) => {
        const name = Mcp.ServerName.make(server)
        return withRegistry(sessionID, name, (servers) =>
          Effect.gen(function* () {
            const entry = servers.get(name)
            if (!entry) return yield* new Mcp.NotFoundError({ server: name })
            yield* runtime.stop(name, entry)
            servers.delete(name)
          }),
        )
      }

      const visible = Effect.fnUntraced(function* (sessionID: Session.ID) {
        const scoped = new Map<Mcp.ServerName, Entry>()
        if (registries.size === 0) return scoped
        let current: Session.ID | undefined = sessionID
        while (current) {
          for (const [name, entry] of registries.get(current)?.servers ?? [])
            if (!scoped.has(name)) scoped.set(name, entry)
          current = (yield* store.get(current))?.parentID
        }
        return scoped
      })

      yield* bus.subscribe([SessionEvent.Deleted, SessionEvent.Moved]).pipe(
        Stream.filter(
          (event) =>
            event.type === "session.deleted" ||
            event.data.location.directory !== location.directory ||
            event.data.location.workspaceID !== location.workspaceID,
        ),
        Stream.runForEach((event) =>
          Effect.forEach(
            Array.from(registries.get(event.data.sessionID)?.servers.keys() ?? []),
            (name) => remove(event.data.sessionID, name).pipe(Effect.ignore),
            { concurrency: "unbounded", discard: true },
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

      return Service.of({
        add: Effect.fn("McpSession.add")(function* (sessionID, server, serverConfig) {
          const name = Mcp.ServerName.make(server)
          const config = Mcp.cloneConfig(serverConfig)
          yield* withRegistry(sessionID, name, (servers) =>
            Effect.gen(function* () {
              const previous = servers.get(name)
              if (previous && isDeepStrictEqual(previous.config, config)) return
              if (previous) yield* runtime.stop(name, previous)
              const entry: Entry = {
                owner: { type: "session", id: sessionID },
                config,
                status: { status: "pending" },
                startup: Latch.makeUnsafe(),
              }
              servers.set(name, entry)
              // Session-scoped servers are not registered as OAuth integrations: integration IDs derive from
              // name and URL, so owners sharing one would share and prematurely dispose its registration.
              yield* runtime.open(name, entry)
            }),
          )
        }),
        remove: Effect.fn("McpSession.remove")(remove),
        view: Effect.fn("McpSession.view")(function* (sessionID) {
          const scoped = yield* visible(sessionID)
          const local = yield* Effect.all({
            servers: mcp.servers(),
            tools: mcp.tools(),
            instructions: mcp.instructions(),
          })
          const shadowed = new Set<string>(scoped.keys())
          const owned = Array.from(scoped)
          return {
            shadowed,
            servers: [
              ...local.servers.filter((server) => !shadowed.has(server.name)),
              ...owned.map(([name, entry]): Mcp.ServerInfo => ({ name, status: entry.status })),
            ].toSorted((a, b) => a.name.localeCompare(b.name)),
            tools: local.tools.filter((tool) => !shadowed.has(tool.server)),
            owned: owned
              .flatMap(([name, entry]) =>
                (entry.tools ?? []).map(
                  (tool): OwnedTool => ({
                    tool,
                    call: (input) => runtime.callTool(name, entry, { ...input, name: tool.name }),
                  }),
                ),
              )
              .toSorted((a, b) => a.tool.server.localeCompare(b.tool.server) || a.tool.name.localeCompare(b.tool.name)),
            instructions: [
              ...local.instructions.filter((item) => !shadowed.has(item.server)),
              ...owned.flatMap(([server, entry]) =>
                entry.client?.instructions ? [{ server, instructions: entry.client.instructions }] : [],
              ),
            ].toSorted((a, b) => a.server.localeCompare(b.server)),
            resourceCatalog: Effect.all(
              [mcp.resourceCatalog(), ...owned.map(([name, entry]) => runtime.catalog(name, entry))],
              { concurrency: "unbounded" },
            ).pipe(
              Effect.map(([catalog, ...catalogs]) =>
                Mcp.mergeCatalogs([
                  {
                    resources: catalog.resources.filter((resource) => !shadowed.has(resource.server)),
                    templates: catalog.templates.filter((template) => !shadowed.has(template.server)),
                  },
                  ...catalogs,
                ]),
              ),
            ),
            resources: (server) => {
              const name = Mcp.ServerName.make(server)
              const entry = scoped.get(name)
              return entry ? runtime.resources(name, entry) : mcp.resources({ server })
            },
            readResource: (input) => {
              const name = Mcp.ServerName.make(input.server)
              const entry = scoped.get(name)
              return entry ? runtime.readResource(name, entry, input.uri) : mcp.readResource(input)
            },
          }
        }),
      })
    }),
  )

export function configured(options?: Mcp.Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [Mcp.node, SessionStore.node, Location.node, Environment.node, Bus.node, Form.node, Credential.node],
  })
}

export const node = configured()
