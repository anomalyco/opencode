export * as McpConnection from "./connection.js"

import type { AuthProvider } from "@modelcontextprotocol/client"
import type { Mcp } from "@opencode/schema/mcp"
import { Cause, Effect, Exit, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { Environment } from "../environment/index.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import type { McpClient } from "./client.js"
import { McpError } from "./errors.js"

export type Failure = Extract<Mcp.Status, { readonly status: "failed" | "needs_auth" }>

/** The catalogs a server can change, in the order a teardown announces them. */
export const KINDS = ["tools", "resources", "prompts", "skills"] as const
export type Kind = (typeof KINDS)[number]

/**
 * What a connection reports to its owner. Each runs inline, in order, so the owner can keep its own
 * state and publish in step with the connection.
 */
export interface Events {
  /** An attempt is about to connect. */
  readonly connecting: Effect.Effect<void>
  /** The attempt connected and listed its tools. */
  readonly connected: Effect.Effect<void>
  /** `answered` is true when the server was reached but refused or broke the handshake. */
  readonly failed: (failure: Failure, answered: boolean) => Effect.Effect<void>
  /** The attempt ended, however it ended. */
  readonly settled: Effect.Effect<void>
  /**
   * The live connection ended on its own: it closed, or the server refused its credential. Runs under the lock; the
   * owner decides how to stop.
   */
  readonly closed: (failure: Failure) => Effect.Effect<void>
  /** A catalog changed: the server said so, or the connection was torn down and every catalog emptied. */
  readonly changed: (kind: Kind) => Effect.Effect<void>
  /**
   * Shared connections only: the server negotiated an older protocol than 2026-07-28, so the attempt closed
   * right after the handshake, without listing tools. Reported instead of `connected` or `failed`.
   */
  readonly legacy?: (version: string | undefined) => Effect.Effect<void>
}

/** Everything about the server to connect to and what capabilities to negotiate with it. */
export interface Spec {
  readonly name: string
  readonly config: Mcp.ServerConfig
  readonly directory: string
  readonly clientInfo?: { readonly name: string; readonly version: string }
  /** Lists the server's MCP Skills when it offers them. */
  readonly skills?: boolean
}

export interface Input {
  readonly spec: Spec
  /**
   * Serves several Locations: it answers no `roots/list`, since no one directory owns it, and skips the
   * per-endpoint handshake turn, since it is already the only connection for its key.
   */
  readonly shared?: boolean
  /** Read on every attempt, so a credential change applies to the next one. */
  readonly authProvider: Effect.Effect<AuthProvider | undefined>
  readonly elicitation: McpClient.ElicitationHandler
  /** A stdio server is spawned on this execution plane. */
  readonly environment: Environment.Interface
  /** A remote server is reached with this fetch. */
  readonly fetch: typeof globalThis.fetch
  /** Each attempt's scope is forked from this one. */
  readonly scope: Scope.Scope
  /** Serializes lifecycle work. Callbacks and recovery take it; `start` and `stop` expect the caller to hold it. */
  readonly lock: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>
  /**
   * Unshared connections to one remote endpoint, from any number of Locations on the same host, take turns at
   * their handshake so the endpoint does not receive a startup burst.
   */
  readonly endpointLoads: KeyedMutex.KeyedMutex<string>
  /** Runs callbacks from the live connection. */
  readonly callbacks: (effect: Effect.Effect<void>) => unknown
  /** Runs recovery that a background request triggered. */
  readonly fork: (effect: Effect.Effect<void>) => unknown
  readonly events: Events
}

export interface Catalog {
  readonly resources: ReadonlyArray<McpClient.Resource>
  readonly templates: ReadonlyArray<McpClient.ResourceTemplate>
}

export const readCatalog = (client: McpClient.Connection): Effect.Effect<Catalog, Error> =>
  Effect.all(
    {
      resources: client.resources(),
      // Some servers declare resources without implementing template listing.
      templates: client.resourceTemplates().pipe(Effect.orElseSucceed(() => [])),
    },
    { concurrency: "unbounded" },
  )

/** One server connection, reconnected in place, with the catalogs it listed. */
export interface Connection {
  readonly client: McpClient.Connection | undefined
  /** The server's tool list as listed. Each refresh replaces the array. */
  readonly tools: ReadonlyArray<McpClient.Tool> | undefined
  readonly prompts: ReadonlyArray<McpClient.Prompt> | undefined
  /** The server's skill entries as listed, when it offers MCP Skills. Each refresh replaces the array. */
  readonly skills: ReadonlyArray<McpClient.Skill> | undefined
  /** Connects and lists tools; a failure is reported through `failed`. */
  readonly start: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  /**
   * Runs a request against `client` and, if that request observed a session expiry, reconnects and
   * runs it once more against the replacement. Any other failure passes through.
   */
  readonly recovering: <A, E extends Error>(
    client: McpClient.Connection,
    run: (client: McpClient.Connection) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>
  readonly catalog: (client: McpClient.Connection) => Effect.Effect<Catalog, Error>
}

interface Connected {
  readonly _tag: "Connected"
  readonly scope: Scope.Closeable
  readonly client: McpClient.Connection
  readonly tools: ReadonlyArray<McpClient.Tool>
  readonly prompts: ReadonlyArray<McpClient.Prompt>
  readonly skills: ReadonlyArray<McpClient.Skill>
}

type State = { readonly _tag: "Idle" } | { readonly _tag: "Connecting"; readonly scope: Scope.Closeable } | Connected

export function make(input: Input): Connection {
  let state: State = { _tag: "Idle" }
  const current = () => (state._tag === "Connected" ? state : undefined)
  // Replaces a catalog listed by `client`, unless another connection has replaced it since.
  const update = (client: McpClient.Connection, catalogs: Partial<Pick<Connected, "tools" | "prompts" | "skills">>) => {
    if (state._tag === "Connected" && state.client === client) state = { ...state, ...catalogs }
  }

  // Runs a connection callback under the lock, dropping it if the connection is no longer the live
  // client, so late SDK callbacks cannot commit obsolete state.
  const whenLive =
    (client: McpClient.Connection) =>
    <E>(effect: Effect.Effect<void, E>) =>
      input.callbacks(
        Effect.suspend(() => (current()?.client === client ? effect : Effect.void)).pipe(input.lock, Effect.ignore),
      )

  const refreshTools = (client: McpClient.Connection) =>
    client.tools().pipe(Effect.map((tools) => update(client, { tools })))

  const refreshPrompts = (client: McpClient.Connection) =>
    client.prompts().pipe(
      Effect.map((prompts) => update(client, { prompts })),
      Effect.andThen(input.events.changed("prompts")),
    )

  const refreshSkills = (client: McpClient.Connection) =>
    client.skills
      ? client.skills.list().pipe(
          Effect.map((skills) => update(client, { skills })),
          Effect.andThen(input.events.changed("skills")),
        )
      : Effect.void

  // Re-establishes a connection whose HTTP session the server dropped, unless another path already
  // replaced it while this one waited for the lock.
  const recover = (client: McpClient.Connection) =>
    Effect.gen(function* () {
      if (current()?.client !== client) return
      yield* Effect.logInfo("mcp session expired, reconnecting", { server: input.spec.name })
      yield* stop
      yield* start
    }).pipe(input.lock)

  // A request the server refused for authorization ends the connection in needs_auth, as a refused connect does, so the
  // status says so and later calls stop refreshing a token the server will not take.
  const refused = (client: McpClient.Connection, message: string) =>
    Effect.suspend(() =>
      current()?.client === client ? input.events.closed({ status: "needs_auth", error: message }) : Effect.void,
    ).pipe(input.lock)

  const recovering = <A, E extends Error>(
    client: McpClient.Connection,
    run: (client: McpClient.Connection) => Effect.Effect<A, E>,
  ) => {
    // A retry after reconnecting runs on the new client, so a refusal there must end that one.
    const attempt = (target: McpClient.Connection) =>
      run(target).pipe(
        Effect.tapError((error) =>
          error instanceof McpError.NeedsAuthError ? refused(target, error.message) : Effect.void,
        ),
      )
    return attempt(client).pipe(
      Effect.catchIf(
        (error) => error instanceof McpError.SessionExpiredError,
        (error) =>
          recover(client).pipe(
            Effect.flatMap(() => {
              const replacement = current()?.client
              return replacement ? attempt(replacement) : Effect.fail(error)
            }),
          ),
      ),
    )
  }

  const watch = (client: McpClient.Connection) => {
    const live = whenLive(client)
    client.onClose((reason) => live(input.events.closed({ status: "failed", error: reason })))
    // Background refreshes (list-changed) can observe the expiry too; they do not retry, so
    // reconnect here for them. Foreground calls reconnect through `recovering`.
    client.onSessionExpired(() => input.fork(recover(client)))
    client.onToolsChanged(() => live(refreshTools(client).pipe(Effect.andThen(input.events.changed("tools")))))
    client.onPromptsChanged(() => live(refreshPrompts(client)))
    // MCP Skills announces a changed skill list as a resource list change.
    client.onResourcesChanged(() => live(input.events.changed("resources").pipe(Effect.andThen(refreshSkills(client)))))
  }

  const start: Effect.Effect<void> = Effect.suspend(() =>
    Effect.gen(function* () {
      yield* input.events.connecting
      // Checked before the OAuth provider is built, which parses the URL too.
      const config = input.spec.config
      if (config.type === "remote" && !URL.canParse(config.url))
        return yield* input.events.failed({ status: "failed", error: `Invalid MCP server URL: ${config.url}` }, false)
      const scope = yield* Scope.fork(input.scope)
      state = { _tag: "Connecting", scope }
      const authProvider = yield* input.authProvider
      const { McpClient } = yield* Effect.promise(() => import("./client.js"))
      // List tools as part of connect so a failure here marks the server failed rather than
      // leaving it connected with a silently empty tool list and no path to recover. A shared connection
      // decides first: it can only be shared on 2026-07-28, so an older server is never asked to list.
      const result = yield* McpClient.connect({
        ...input.spec,
        server: input.spec.name,
        authProvider,
        elicitation: input.elicitation,
        roots: !input.shared,
        events: true,
      }).pipe(
        Effect.flatMap(
          (client): Effect.Effect<{ client: McpClient.Connection; tools?: ReadonlyArray<McpClient.Tool> }, Error> =>
            input.shared && !client.modern
              ? Effect.succeed({ client })
              : client.tools().pipe(Effect.map((tools) => ({ client, tools }))),
        ),
        Effect.provideService(Environment.Service, input.environment),
        Effect.provideService(FetchHttpClient.Fetch, input.fetch),
        Scope.provide(scope),
        (effect) =>
          config.type === "remote" && !input.shared ? input.endpointLoads.withLock(config.url)(effect) : effect,
        Effect.exit,
      )
      if (Exit.isSuccess(result)) {
        const client = result.value.client
        const tools = result.value.tools
        if (!tools) {
          state = { _tag: "Idle" }
          yield* Scope.close(scope, Exit.void)
          return yield* input.events.legacy?.(client.protocolVersion) ?? Effect.void
        }
        state = { _tag: "Connected", scope, client, tools, prompts: [], skills: [] }
        watch(client)
        yield* input.events.connected
        whenLive(client)(refreshPrompts(client))
        whenLive(client)(refreshSkills(client))
        return
      }
      state = { _tag: "Idle" }
      yield* Scope.close(scope, Exit.void)
      const error = Cause.squash(result.cause)
      yield* input.events.failed(
        error instanceof McpError.NeedsAuthError
          ? { status: "needs_auth", error: error.message }
          : { status: "failed", error: error instanceof Error ? error.message : String(error) },
        error instanceof McpError.ConnectError && error.answered === true,
      )
    }).pipe(
      Effect.ensuring(input.events.settled),
      Effect.annotateLogs({
        server: input.spec.name,
        directory: input.spec.directory,
        connectionID: crypto.randomUUID(),
      }),
    ),
  )

  const stop = Effect.gen(function* () {
    if (state._tag === "Idle") return
    const scope = state.scope
    state = { _tag: "Idle" }
    yield* Scope.close(scope, Exit.void)
    for (const kind of KINDS) yield* input.events.changed(kind)
  })

  return {
    get client() {
      return current()?.client
    },
    get tools() {
      return current()?.tools
    },
    get prompts() {
      return current()?.prompts
    },
    get skills() {
      return current()?.skills
    },
    start,
    stop,
    recovering,
    catalog: (client) => recovering(client, readCatalog),
  }
}
