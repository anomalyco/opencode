export * as McpConnection from "./connection.js"

import type { OAuthClientProvider } from "@modelcontextprotocol/client"
import type { Mcp } from "@opencode/schema/mcp"
import { Cause, Clock, Effect, Exit, Latch, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { Environment } from "../environment/index.js"
import type { McpClient } from "./client.js"

export type Failure = Extract<Mcp.Status, { readonly status: "failed" | "needs_auth" }>
type Disabled = Extract<Mcp.Status, { readonly status: "disabled" }>

/** Where one server stands. Only `connected` holds a client, so readers never see a connected server without one. */
export type State =
  | Disabled
  /** An attempt is connecting. `settled` opens once the server leaves this state. */
  | { readonly status: "pending"; readonly started: number; readonly settled: Latch.Latch }
  | {
      readonly status: "connected"
      readonly scope: Scope.Closeable
      readonly client: McpClient.Connection
      /** The server's tool list as listed. Each refresh replaces the array. */
      readonly tools: ReadonlyArray<McpClient.Tool>
      readonly prompts: ReadonlyArray<McpClient.Prompt>
    }
  | Failure

export const status = (state: State): Mcp.Status =>
  state.status === "pending" || state.status === "connected" ? { status: state.status } : state

/**
 * What a connection reports to its owner. Each runs inline, in order, so the owner can keep its own
 * state and publish in step with the connection.
 */
export interface Events {
  /** An attempt is about to connect; the server is pending. */
  readonly connecting: Effect.Effect<void>
  /** The attempt connected and listed its tools. */
  readonly connected: Effect.Effect<void>
  readonly failed: (failure: Failure) => Effect.Effect<void>
  /** A live connection was torn down. */
  readonly stopped: Effect.Effect<void>
  /** The live connection closed on its own. Runs under the lock; the owner decides how to stop. */
  readonly closed: (reason: string) => Effect.Effect<void>
  readonly toolsChanged: Effect.Effect<void>
  readonly promptsChanged: Effect.Effect<void>
  readonly resourcesChanged: Effect.Effect<void>
}

export interface Input {
  readonly name: string
  readonly config: Mcp.ServerConfig
  /** When the server was created. A server pending from creation keeps the startup window that began then. */
  readonly started: number
  readonly directory: string
  readonly clientInfo?: { readonly name: string; readonly version: string }
  /** Read on every attempt, so a credential change applies to the next one. */
  readonly authProvider: Effect.Effect<OAuthClientProvider | undefined>
  readonly elicitation: McpClient.ElicitationHandler
  /** A stdio server is spawned on this execution plane. */
  readonly environment: Environment.Interface
  /** A remote server is reached with this fetch. */
  readonly fetch: typeof globalThis.fetch
  /** Each attempt's scope is forked from this one. */
  readonly scope: Scope.Scope
  /** Serializes lifecycle work. Callbacks and recovery take it; `start` and `stop` expect the caller to hold it. */
  readonly lock: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>
  /** Wraps the handshake and initial tool list. */
  readonly handshake: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>
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

/** One server connection, reconnected in place, with the catalogs it listed. */
export interface Connection {
  readonly state: State
  readonly client: McpClient.Connection | undefined
  readonly tools: ReadonlyArray<McpClient.Tool> | undefined
  readonly prompts: ReadonlyArray<McpClient.Prompt> | undefined
  /** Replaces any live connection, then connects and lists tools; a failure is reported through `failed`. */
  readonly start: Effect.Effect<void>
  /** Tears down the live connection or abandons a pending one, leaving the server disabled or failed. */
  readonly stop: (next?: Disabled | Failure) => Effect.Effect<void>
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

export function make(input: Input): Connection {
  let state: State = input.config.disabled
    ? { status: "disabled" }
    : { status: "pending", started: input.started, settled: Latch.makeUnsafe() }

  // Every move to another state goes through here, so leaving `pending` always releases its waiters
  // and leaving `connected` always closes its scope.
  const set = (next: State) =>
    Effect.gen(function* () {
      const previous = state
      state = next
      if (previous.status === "pending") yield* previous.settled.open
      if (previous.status !== "connected") return
      yield* Scope.close(previous.scope, Exit.void)
      yield* input.events.stopped
    })

  // Tool and prompt refreshes keep the connection, so they update it in place.
  const update = (
    client: McpClient.Connection,
    lists: { tools?: ReadonlyArray<McpClient.Tool>; prompts?: ReadonlyArray<McpClient.Prompt> },
  ) =>
    Effect.sync(() => {
      if (state.status === "connected" && state.client === client) state = { ...state, ...lists }
    })

  const fail = (failure: Failure) => set(failure).pipe(Effect.andThen(input.events.failed(failure)))

  // Runs a connection callback under the lock, dropping it if the connection is no longer the live
  // client, so late SDK callbacks cannot commit obsolete state.
  const whenLive =
    (client: McpClient.Connection) =>
    <E>(effect: Effect.Effect<void, E>) =>
      input.callbacks(
        Effect.suspend(() => (state.status === "connected" && state.client === client ? effect : Effect.void)).pipe(
          input.lock,
          Effect.ignore,
        ),
      )

  const refreshTools = (client: McpClient.Connection) =>
    client.tools().pipe(Effect.flatMap((tools) => update(client, { tools })))

  const refreshPrompts = (client: McpClient.Connection) =>
    client.prompts().pipe(
      Effect.orElseSucceed(() => []),
      Effect.flatMap((prompts) => update(client, { prompts })),
      Effect.andThen(input.events.promptsChanged),
    )

  // Re-establishes a connection whose HTTP session the server dropped, unless another path already
  // replaced it while this one waited for the lock.
  const recover = (client: McpClient.Connection) =>
    Effect.gen(function* () {
      if (state.status !== "connected" || state.client !== client) return
      yield* Effect.logInfo("mcp session expired, reconnecting", { server: input.name })
      yield* start
    }).pipe(input.lock)

  const recovering = <A, E extends Error>(
    client: McpClient.Connection,
    run: (client: McpClient.Connection) => Effect.Effect<A, E>,
  ) =>
    run(client).pipe(
      Effect.catchIf(
        // The client module is loaded lazily, so match the tagged error by tag rather than class.
        (error) => "_tag" in error && error._tag === "MCP.SessionExpiredError",
        (error) =>
          recover(client).pipe(
            Effect.flatMap(() => (state.status === "connected" ? run(state.client) : Effect.fail(error))),
          ),
      ),
    )

  const watch = (client: McpClient.Connection) => {
    const live = whenLive(client)
    client.onClose((reason) => live(input.events.closed(reason)))
    // Background refreshes (list-changed) can observe the expiry too; they do not retry, so
    // reconnect here for them. Foreground calls reconnect through `recovering`.
    client.onSessionExpired(() => input.fork(recover(client)))
    client.onToolsChanged(() => live(refreshTools(client).pipe(Effect.andThen(input.events.toolsChanged))))
    client.onPromptsChanged(() => live(refreshPrompts(client)))
    client.onResourcesChanged(() => live(input.events.resourcesChanged))
  }

  const start: Effect.Effect<void> = Effect.suspend(() =>
    Effect.gen(function* () {
      if (state.status !== "pending")
        yield* set({ status: "pending", started: yield* Clock.currentTimeMillis, settled: Latch.makeUnsafe() })
      yield* input.events.connecting
      // Checked before the OAuth provider is built, which parses the URL too.
      if (input.config.type === "remote" && !URL.canParse(input.config.url))
        return yield* fail({ status: "failed", error: `Invalid MCP server URL: ${input.config.url}` })
      const authProvider = yield* input.authProvider
      const { McpClient } = yield* Effect.promise(() => import("./client.js"))
      const scope = yield* Scope.fork(input.scope)
      // List tools as part of connect so a failure here marks the server failed rather than
      // leaving it connected with a silently empty tool list and no path to recover.
      const result = yield* McpClient.connect(
        input.name,
        input.config,
        input.directory,
        authProvider,
        input.elicitation,
        input.clientInfo,
      ).pipe(
        Effect.flatMap((client) => client.tools().pipe(Effect.map((tools) => ({ client, tools })))),
        Effect.provideService(Environment.Service, input.environment),
        Effect.provideService(FetchHttpClient.Fetch, input.fetch),
        Scope.provide(scope),
        input.handshake,
        Effect.onError(() => Scope.close(scope, Exit.void)),
        Effect.exit,
      )
      if (Exit.isSuccess(result)) {
        const client = result.value.client
        yield* set({ status: "connected", scope, client, tools: result.value.tools, prompts: [] })
        watch(client)
        yield* input.events.connected
        whenLive(client)(refreshPrompts(client))
        return
      }
      const error = Cause.squash(result.cause)
      yield* fail(
        error instanceof McpClient.NeedsAuthError
          ? { status: "needs_auth", error: error.message }
          : { status: "failed", error: error instanceof Error ? error.message : String(error) },
      )
    }).pipe(Effect.annotateLogs({ server: input.name, directory: input.directory, connectionID: crypto.randomUUID() })),
  )

  return {
    get state() {
      return state
    },
    get client() {
      return state.status === "connected" ? state.client : undefined
    },
    get tools() {
      return state.status === "connected" ? state.tools : undefined
    },
    get prompts() {
      return state.status === "connected" ? state.prompts : undefined
    },
    start,
    stop: (next = { status: "disabled" }) => set(next),
    recovering,
    catalog: (client) =>
      recovering(client, (client) =>
        Effect.all(
          {
            resources: client.resources(),
            // Some servers declare resources without implementing template listing.
            templates: client.resourceTemplates().pipe(Effect.orElseSucceed(() => [])),
          },
          { concurrency: "unbounded" },
        ),
      ),
  }
}
