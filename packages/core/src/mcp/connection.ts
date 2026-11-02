export * as McpConnection from "./connection.js"

import type { OAuthClientProvider } from "@modelcontextprotocol/client"
import type { Mcp } from "@opencode/schema/mcp"
import { Cause, Effect, Exit, Scope } from "effect"
import { Environment } from "../environment/index.js"
import type { McpClient } from "./client.js"

export type Failure = Extract<Mcp.Status, { readonly status: "failed" | "needs_auth" }>

/**
 * What a connection reports to its owner. Each runs inline, in order, so the owner can keep its own
 * state and publish in step with the connection.
 */
export interface Events {
  /** An attempt is about to connect. */
  readonly connecting: Effect.Effect<void>
  /** The attempt connected and listed its tools. */
  readonly connected: Effect.Effect<void>
  readonly failed: (failure: Failure) => Effect.Effect<void>
  /** The attempt ended, however it ended. */
  readonly settled: Effect.Effect<void>
  /** A live connection was torn down for disposal, so its cached metadata is gone too. */
  readonly stopped: Effect.Effect<void>
  /** A live connection released its transport while keeping the metadata it discovered. */
  readonly released: Effect.Effect<void>
  /** The live connection closed on its own. Runs under the lock; the owner decides how to stop. */
  readonly closed: (reason: string) => Effect.Effect<void>
  readonly toolsChanged: Effect.Effect<void>
  readonly promptsChanged: Effect.Effect<void>
  readonly resourcesChanged: Effect.Effect<void>
}

export interface Input {
  readonly name: string
  readonly config: Mcp.ServerConfig
  readonly directory: string
  readonly clientInfo?: { readonly name: string; readonly version: string }
  /** Read on every attempt, so a credential change applies to the next one. */
  readonly authProvider: Effect.Effect<OAuthClientProvider | undefined>
  readonly elicitation: McpClient.ElicitationHandler
  /** A stdio server is spawned on this execution plane. */
  readonly environment: Environment.Interface
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

/** One server connection, reconnected in place, with the metadata it discovered. */
export interface Connection {
  readonly client: McpClient.Connection | undefined
  /** The server's tool list as listed. Each refresh replaces the array. */
  readonly tools: ReadonlyArray<McpClient.Tool> | undefined
  readonly prompts: ReadonlyArray<McpClient.Prompt> | undefined
  /** Retained while the transport is released so startup and prompts survive an idle disconnect. */
  readonly instructions: string | undefined
  readonly title: string | undefined
  /** The resource catalog most recently listed through this connection, retained while released. */
  readonly catalog: Catalog | undefined
  /** Connects and lists tools; a failure is reported through `failed`. */
  readonly start: Effect.Effect<void>
  /** Tears the connection down for disposal, dropping every cached catalog. */
  readonly stop: Effect.Effect<void>
  /** Releases the transport after discovery while keeping the cached catalogs for the next use. */
  readonly release: Effect.Effect<void>
  /**
   * Runs a request against `client` and, if that request observed a session expiry, reconnects and
   * runs it once more against the replacement. Any other failure passes through.
   */
  readonly recovering: <A, E extends Error>(
    client: McpClient.Connection,
    run: (client: McpClient.Connection) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>
  /** Lists the resource catalog through the live connection and caches the result. */
  readonly loadCatalog: (client: McpClient.Connection) => Effect.Effect<Catalog, Error>
}

export function make(input: Input): Connection {
  const state: {
    scope?: Scope.Closeable
    client?: McpClient.Connection
    tools?: ReadonlyArray<McpClient.Tool>
    prompts?: ReadonlyArray<McpClient.Prompt>
    instructions?: string
    title?: string
    catalog?: Catalog
  } = {}

  // Runs a connection callback under the lock, dropping it if the connection is no longer the live
  // client, so late SDK callbacks cannot commit obsolete state.
  const whenLive =
    (client: McpClient.Connection) =>
    <E>(effect: Effect.Effect<void, E>) =>
      input.callbacks(
        Effect.suspend(() => (state.client === client ? effect : Effect.void)).pipe(input.lock, Effect.ignore),
      )

  const refreshTools = (client: McpClient.Connection) =>
    client.tools().pipe(
      Effect.map((tools) => {
        state.tools = tools
      }),
    )

  const refreshPrompts = (client: McpClient.Connection) =>
    client.prompts().pipe(
      Effect.orElseSucceed(() => []),
      Effect.map((prompts) => {
        state.prompts = prompts
      }),
      Effect.andThen(input.events.promptsChanged),
    )

  // Re-establishes a connection whose HTTP session the server dropped, unless another path already
  // replaced it while this one waited for the lock.
  const recover = (client: McpClient.Connection) =>
    Effect.gen(function* () {
      if (state.client !== client) return
      yield* Effect.logInfo("mcp session expired, reconnecting", { server: input.name })
      yield* stop
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
        (error) => recover(client).pipe(Effect.flatMap(() => (state.client ? run(state.client) : Effect.fail(error)))),
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
    client.onResourcesChanged(() =>
      live(
        Effect.suspend(() => {
          state.catalog = undefined
          return input.events.resourcesChanged
        }),
      ),
    )
  }

  const start: Effect.Effect<void> = Effect.suspend(() =>
    Effect.gen(function* () {
      yield* input.events.connecting
      // Checked before the OAuth provider is built, which parses the URL too.
      if (input.config.type === "remote" && !URL.canParse(input.config.url))
        return yield* input.events.failed({ status: "failed", error: `Invalid MCP server URL: ${input.config.url}` })
      const scope = yield* Scope.fork(input.scope)
      state.scope = scope
      const authProvider = yield* input.authProvider
      const { McpClient } = yield* Effect.promise(() => import("./client.js"))
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
        Scope.provide(scope),
        input.handshake,
        Effect.exit,
      )
      if (Exit.isSuccess(result)) {
        state.client = result.value.client
        state.tools = result.value.tools
        state.prompts = []
        state.instructions = result.value.client.instructions
        state.title = result.value.client.title
        state.catalog = undefined
        watch(result.value.client)
        yield* input.events.connected
        whenLive(result.value.client)(refreshPrompts(result.value.client))
        return
      }
      yield* Scope.close(scope, Exit.void)
      state.scope = undefined
      const error = Cause.squash(result.cause)
      yield* input.events.failed(
        error instanceof McpClient.NeedsAuthError
          ? { status: "needs_auth", error: error.message }
          : { status: "failed", error: error instanceof Error ? error.message : String(error) },
      )
    }).pipe(
      Effect.ensuring(input.events.settled),
      Effect.annotateLogs({ server: input.name, directory: input.directory, connectionID: crypto.randomUUID() }),
    ),
  )

  const stop = Effect.gen(function* () {
    const scope = state.scope
    if (!scope) return
    state.scope = undefined
    state.client = undefined
    state.tools = undefined
    state.prompts = undefined
    state.instructions = undefined
    state.title = undefined
    state.catalog = undefined
    yield* Scope.close(scope, Exit.void)
    yield* input.events.stopped
  })

  // Idle release closes only the transport. The tools, prompts, instructions, title and resource
  // catalog stay available, because MCP has no protocol for proving a tool left no persistent state.
  const release = Effect.gen(function* () {
    const scope = state.scope
    if (!scope) return
    state.scope = undefined
    state.client = undefined
    yield* Scope.close(scope, Exit.void)
    yield* input.events.released
  })

  const loadCatalog = (client: McpClient.Connection) =>
    recovering(client, (client) =>
      Effect.all(
        {
          resources: client.resources(),
          // Some servers declare resources without implementing template listing.
          templates: client.resourceTemplates().pipe(Effect.orElseSucceed(() => [])),
        },
        { concurrency: "unbounded" },
      ),
    ).pipe(
      Effect.map((catalog) => {
        if (state.client === client) state.catalog = catalog
        return catalog
      }),
    )

  return {
    get client() {
      return state.client
    },
    get tools() {
      return state.tools
    },
    get prompts() {
      return state.prompts
    },
    get instructions() {
      return state.instructions
    },
    get title() {
      return state.title
    },
    get catalog() {
      return state.catalog
    },
    start,
    stop,
    release,
    recovering,
    loadCatalog,
  }
}
