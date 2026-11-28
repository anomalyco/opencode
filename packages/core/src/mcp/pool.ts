export * as McpPool from "./pool.js"

import type { AuthProvider } from "@modelcontextprotocol/client"
import type { Mcp } from "@opencode/schema/mcp"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpFetch } from "@opencode/util/effect/app-node-platform"
import { Cause, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Schema, Scope, Semaphore } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Environment } from "../environment/index.js"
import { SharedCache } from "../shared-cache.js"
import { canonicalJson } from "../util/canonical-json.js"
import type { McpClient } from "./client.js"
import { McpConnection } from "./connection.js"

export interface Input extends Omit<McpConnection.Input, "endpointLoads" | "shared"> {
  /**
   * Run once per start: what tells this connection apart from every other one to the same server (see `key`),
   * and the OAuth provider to open it with. Both come from one credential selection, so a slot's key and the
   * account it connects as can't disagree.
   */
  readonly select: Effect.Effect<Selection>
}

export interface Selection {
  readonly key: string
  readonly authProvider: Effect.Effect<AuthProvider | undefined>
}

export interface Interface {
  /**
   * A Location's connection to a server that may be shared. Each start joins the connection other
   * Locations hold under the same key, or opens it, and each stop lets go of it; the last to let go
   * closes it. A server that negotiates the legacy protocol, or that answers but refuses or breaks the
   * pooled handshake, is never shared: the Location connects on its own, exactly as it would unpooled,
   * and every later start for that key skips straight to that.
   */
  readonly connection: (input: Input) => McpConnection.Connection
  /** Serializes unshared remote endpoint handshakes across Locations on the same host. */
  readonly endpointLoads: KeyedMutex.KeyedMutex<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpPool") {}

/**
 * Everything that could make two connections behave differently, so only identical ones are shared.
 * The server's name is left out; each Location keeps its own. Secrets appear only as fingerprints.
 * Each mapping below names every field of what it keys, so a new field fails to compile until it is
 * keyed or left out on purpose with `null`.
 */
export const key = (
  input: Omit<McpConnection.Spec, "name" | "directory" | "config"> &
    (
      | {
          readonly config: Mcp.RemoteConfig
          /** The active OAuth credential's ID, which a token refresh keeps and a sign-in replaces. */
          readonly credential: string | undefined
        }
      | {
          readonly config: Mcp.LocalConfig
          /** The directory the server runs in, as `McpStdio.resolveCwd` resolves it for the spawn. */
          readonly cwd: string
        }
    ),
) => {
  const spec = {
    clientInfo: input.clientInfo ?? null,
    skills: input.skills ?? false,
  } satisfies Record<keyof Omit<McpConnection.Spec, "name" | "directory" | "config">, Schema.Json>
  const timeout = {
    startup: input.config.timeout?.startup ?? null,
    catalog: input.config.timeout?.catalog ?? null,
    execution: input.config.timeout?.execution ?? null,
  } satisfies Record<keyof Mcp.TimeoutConfig, Schema.Json>
  // `disabled` and `pool` decide whether this connection opens, not how it behaves.
  const common = {
    type: input.config.type,
    timeout,
    protocol: input.config.protocol ?? "auto",
    disabled: null,
    pool: null,
  }
  if ("credential" in input) {
    const oauth = input.config.oauth
    return canonicalJson({
      ...spec,
      ...common,
      credential: input.credential ?? null,
      url: input.config.url,
      headers: fingerprint(input.config.headers),
      oauth:
        oauth === false
          ? false
          : ({
              client_id: oauth?.client_id ?? null,
              client_secret: fingerprint(oauth?.client_secret),
              scope: oauth?.scope ?? null,
              callback_port: oauth?.callback_port ?? null,
              redirect_uri: oauth?.redirect_uri ?? null,
              auth_server_metadata_url: oauth?.auth_server_metadata_url ?? null,
            } satisfies Record<keyof Mcp.OAuthConfig, Schema.Json>),
      // A remote server's URL gains ?codemode=false unless Code Mode is off.
      codemode: input.config.codemode !== false,
    } satisfies Record<keyof Mcp.RemoteConfig | "credential", Schema.Json>)
  }
  // Only Locations on this host share local servers, so the execution plane is always the host.
  return canonicalJson({
    ...spec,
    ...common,
    plane: "host",
    command: input.config.command,
    // Where the configured `cwd` resolves to, so equal paths written differently still match.
    cwd: input.cwd,
    environment: fingerprint(input.config.environment),
    // Decides how this Location exposes the tools, not how the connection behaves.
    codemode: null,
  } satisfies Record<keyof Mcp.LocalConfig | "plane", Schema.Json>)
}

function fingerprint(secret: string | Readonly<Record<string, string>> | undefined) {
  if (secret === undefined || (typeof secret === "object" && Object.keys(secret).length === 0)) return null
  return SharedCache.fingerprint(typeof secret === "string" ? secret : canonicalJson(secret))
}

// A Location holding a shared connection. The pool reaches Locations only through the holders
// registered right now, never through the one that opened the connection.
interface Holder {
  readonly authProvider: Effect.Effect<AuthProvider | undefined>
  readonly elicitation: McpClient.ElicitationHandler["create"]
  readonly closed: (reason: string) => void
  readonly changed: (kind: McpConnection.Kind) => void
}

type Outcome = "connected" | "private" | McpConnection.Failure

interface Slot {
  readonly connection: McpConnection.Connection
  readonly holders: Set<Holder>
  readonly lock: Semaphore.Semaphore
  readonly outcome: Deferred.Deferred<Outcome>
  start?: Fiber.Fiber<void>
  connected: boolean
}

type Mode =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Joining"; readonly claim: Scope.Closeable; readonly holder: Holder }
  | {
      readonly _tag: "Shared"
      readonly claim: Scope.Closeable
      readonly holder: Holder
      readonly connection: McpConnection.Connection
    }
  | { readonly _tag: "Private"; readonly connection: McpConnection.Connection }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const run = yield* FiberSet.makeRuntime<never, void, never>()
    const host = Environment.local(yield* ChildProcessSpawner)
    const fetch = yield* FetchHttpClient.Fetch
    const slots = new Map<string, Slot>()
    const endpointLoads = KeyedMutex.makeUnsafe<string>()
    // Keys whose server refused the pooled handshake or negotiated legacy. Kept for the life of the process.
    // Legacy ones' private connections skip the 2026-07-28 probe; a refusal proves nothing about the
    // protocol, so those keep the configured one.
    const unpoolable = new Map<string, "refused" | "legacy">()
    // Names of local servers already warned about for having no cwd, which keeps each project's folder in the key.
    const unfixed = new Set<string>()

    // Takes only the spec from the Location that opens it: the connection outlives that Location's claim.
    const open = (key: string, spec: McpConnection.Spec) => {
      const slot: Slot = {
        holders: new Set(),
        lock: Semaphore.makeUnsafe(1),
        outcome: Deferred.makeUnsafe(),
        connected: false,
        connection: McpConnection.make({
          spec,
          endpointLoads,
          shared: true,
          // Every holder of a key presents the same credential, so any of them can build the provider.
          authProvider: Effect.suspend(() => slot.holders.values().next().value?.authProvider ?? Effect.undefined),
          elicitation: {
            // Elicitations a request carries reach that request's Location. Any other one, which the
            // server could not tie to a request, goes to every holder and the first answer wins; the
            // others are interrupted, which cancels their forms.
            create: (request) =>
              Effect.suspend(() => {
                const holders = Array.from(slot.holders)
                if (holders.length === 0) return Effect.succeed({ action: "cancel" as const })
                return Effect.raceAll(holders.map((holder) => holder.elicitation(request)))
              }),
            complete: () => Effect.void,
          },
          environment: host,
          fetch,
          scope,
          lock: (effect) => slot.lock.withPermit(effect),
          callbacks: run,
          fork: run,
          events: {
            connecting: Effect.void,
            connected: Effect.void,
            // A server that answered but refused the pooled handshake, such as one that wants roots, may
            // still accept the Location's own connection; anything unreachable would only fail again.
            failed: (failure, answered) =>
              Effect.gen(function* () {
                detach(key, slot)
                if (answered) {
                  unpoolable.set(key, "refused")
                  yield* Effect.logWarning("mcp pool ignored: server refused the shared connection", {
                    server: spec.name,
                    error: failure.error,
                  })
                }
                yield* Deferred.succeed(slot.outcome, answered ? "private" : failure)
              }),
            legacy: (version) =>
              Effect.gen(function* () {
                detach(key, slot)
                unpoolable.set(key, "legacy")
                yield* Effect.logWarning("mcp pool ignored: server speaks an older protocol", {
                  server: spec.name,
                  version,
                })
                yield* Deferred.succeed(slot.outcome, "private")
              }),
            settled: Effect.void,
            closed: (reason) =>
              Effect.gen(function* () {
                detach(key, slot)
                const holders = Array.from(slot.holders)
                slot.holders.clear()
                yield* slot.connection.stop
                for (const holder of holders) holder.closed(reason)
              }),
            changed: (kind) =>
              Effect.sync(() => {
                if (slot.connected) for (const holder of slot.holders) holder.changed(kind)
              }),
          },
        }),
      }
      slots.set(key, slot)
      return slot
    }

    const connect = (key: string, slot: Slot) =>
      Effect.gen(function* () {
        yield* slot.connection.start
        // A failed or legacy start already settled the outcome.
        if (!slot.connection.client) return
        slot.connected = true
        yield* Deferred.succeed(slot.outcome, "connected")
      }).pipe(
        slot.lock.withPermit,
        // Holders wait on the outcome, so an attempt that dies still settles it.
        Effect.onError((cause) =>
          Effect.suspend(() => {
            detach(key, slot)
            return Deferred.succeed(slot.outcome, { status: "failed", error: String(Cause.squash(cause)) })
          }),
        ),
      )

    const detach = (key: string, slot: Slot) => {
      if (slots.get(key) === slot) slots.delete(key)
    }

    // Closes as soon as the last holder lets go, interrupting a start nobody waits for anymore.
    const release = (key: string, slot: Slot, holder: Holder) =>
      Effect.suspend(() => {
        slot.holders.delete(holder)
        if (slot.holders.size > 0) return Effect.void
        detach(key, slot)
        return Effect.gen(function* () {
          if (slot.start) yield* Fiber.interrupt(slot.start)
          yield* slot.connection.stop.pipe(slot.lock.withPermit)
        })
      })

    const acquire = Effect.fnUntraced(function* (key: string, spec: McpConnection.Spec, holder: Holder) {
      if (unpoolable.has(key)) return "private" as const
      const slot = slots.get(key) ?? open(key, spec)
      yield* Effect.acquireRelease(
        Effect.sync(() => slot.holders.add(holder)),
        () => release(key, slot, holder),
      )
      // Started once a holder is registered: the attempt reads its OAuth provider from the holders.
      slot.start ??= run(connect(key, slot))
      const outcome = yield* Deferred.await(slot.outcome)
      return outcome === "connected" ? slot.connection : outcome
    })

    const connection = (input: Input): McpConnection.Connection => {
      let mode: Mode = { _tag: "Idle" }
      const live = () => (mode._tag === "Shared" || mode._tag === "Private" ? mode.connection : undefined)
      // The shared connection carries the name of the Location that opened it; forms show this Location's.
      const elicit: McpClient.ElicitationHandler["create"] = (request) =>
        input.elicitation.create({ ...request, server: input.spec.name })

      // Holder callbacks run in the Location's own callback runtime, under its lock, and only while the
      // claim they belong to is the current one.
      const current = (holder: Holder, effect: () => Effect.Effect<void>) =>
        input.callbacks(
          Effect.suspend(() =>
            (mode._tag === "Joining" || mode._tag === "Shared") && mode.holder === holder ? effect() : Effect.void,
          ).pipe(input.lock, Effect.ignore),
        )

      const clear = Effect.suspend(() => {
        if (mode._tag !== "Joining" && mode._tag !== "Shared") return Effect.void
        const claim = mode.claim
        mode = { _tag: "Idle" }
        return Scope.close(claim, Exit.void)
      })

      // Resolves false when the key can't be shared, leaving the start to the Location's own connection.
      const join = (selected: Selection) =>
        Effect.gen(function* () {
          yield* input.events.connecting
          const claim = yield* Scope.fork(input.scope)
          const holder: Holder = {
            authProvider: selected.authProvider,
            elicitation: elicit,
            closed: (reason) => current(holder, () => input.events.closed(reason)),
            changed: (kind) => current(holder, () => input.events.changed(kind)),
          }
          mode = { _tag: "Joining", claim, holder }
          const outcome = yield* acquire(selected.key, input.spec, holder).pipe(
            Scope.provide(claim),
            Effect.onInterrupt(() => clear),
          )
          if (outcome === "private") {
            yield* clear
            return false
          }
          if ("status" in outcome) {
            yield* clear
            yield* input.events.failed(outcome, false)
            return true
          }
          mode = { _tag: "Shared", claim, holder, connection: outcome }
          yield* input.events.connected
          return true
        }).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) && !exit.value ? Effect.void : input.events.settled)))

      // Requests through a shared connection bring this Location's elicitation handler along.
      const bind = (client: McpClient.Connection): McpClient.Connection => ({
        ...client,
        callTool: (request) => client.callTool({ elicitation: elicit, ...request }),
        prompt: (request) => client.prompt({ elicitation: elicit, ...request }),
        readResource: (request) => client.readResource({ elicitation: elicit, ...request }),
      })

      return {
        get client() {
          return live()?.client
        },
        get tools() {
          return live()?.tools
        },
        get prompts() {
          return live()?.prompts
        },
        get skills() {
          return live()?.skills
        },
        start: Effect.gen(function* () {
          if (
            input.spec.config.type === "local" &&
            input.spec.config.cwd === undefined &&
            !unfixed.has(input.spec.name)
          ) {
            unfixed.add(input.spec.name)
            yield* Effect.logWarning(
              "mcp pool ignored: local server has no fixed cwd, so each directory runs its own",
              {
                server: input.spec.name,
              },
            )
          }
          const selected = yield* input.select
          if (!unpoolable.has(selected.key) && (yield* join(selected))) return
          const config =
            unpoolable.get(selected.key) === "legacy"
              ? { ...input.spec.config, protocol: "legacy" as const }
              : input.spec.config
          const own = McpConnection.make({
            ...input,
            spec: { ...input.spec, config },
            authProvider: selected.authProvider,
            endpointLoads,
          })
          mode = { _tag: "Private", connection: own }
          yield* own.start
        }),
        stop: Effect.gen(function* () {
          if (mode._tag === "Idle") return
          if (mode._tag === "Private") {
            const own = mode.connection
            mode = { _tag: "Idle" }
            return yield* own.stop
          }
          yield* clear
          yield* input.events.changed("tools")
          yield* input.events.changed("resources")
          yield* input.events.changed("prompts")
          yield* input.events.changed("skills")
        }),
        recovering: (client, request) => {
          if (mode._tag === "Shared") return mode.connection.recovering(client, (client) => request(bind(client)))
          if (mode._tag === "Private") return mode.connection.recovering(client, request)
          return request(client)
        },
        catalog: (client) => live()?.catalog(client) ?? McpConnection.readCatalog(client),
      }
    }

    return Service.of({ connection, endpointLoads })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [CrossSpawnSpawner.node, httpFetch] })
