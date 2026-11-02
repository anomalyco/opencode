export * as McpPool from "./pool.js"

import path from "node:path"
import type { OAuthClientProvider } from "@modelcontextprotocol/client"
import type { Mcp } from "@opencode/schema/mcp"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Cause, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Scope, Semaphore } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { Environment } from "../environment/index.js"
import { SharedCache } from "../shared-cache.js"
import type { McpClient } from "./client.js"
import { McpConnection } from "./connection.js"

export interface Input extends McpConnection.Input {
  /** What tells this connection apart from every other one to the same server; see `key`. Read on every start. */
  readonly key: Effect.Effect<string>
}

export interface Interface {
  /**
   * A Location's connection to a server that may be shared. Each start joins the connection other
   * Locations hold under the same key, or opens it, and each stop lets go of it; the last to let go
   * closes it. A server that negotiates the legacy protocol is never shared: the Location connects on
   * its own, exactly as it would unpooled, and every later start for that key skips straight to that.
   */
  readonly connection: (input: Input) => McpConnection.Connection
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpPool") {}

/**
 * Everything that could make two connections behave differently, so only identical ones are shared.
 * The server's name is left out; each Location keeps its own. Secrets appear only as fingerprints.
 */
export const key = (input: {
  readonly config: Mcp.ServerConfig
  readonly directory: string
  /** The active OAuth credential's ID, which a token refresh keeps and a sign-in replaces. */
  readonly credential?: string
  readonly clientInfo?: { readonly name: string; readonly version: string }
}) => {
  const config = input.config
  const common = [config.protocol, config.timeout ?? null, input.clientInfo ?? null]
  if (config.type === "remote")
    return JSON.stringify([
      "remote",
      config.url,
      fingerprint(config.headers),
      config.oauth ? { ...config.oauth, client_secret: fingerprint(config.oauth.client_secret) } : config.oauth,
      // A remote server's URL gains ?codemode=false unless Code Mode is off.
      config.codemode !== false,
      input.credential ?? null,
      ...common,
    ])
  // Only Locations on this host share local servers, so the execution plane is always the host.
  return JSON.stringify([
    "local",
    "host",
    config.command,
    // As the stdio transport resolves it.
    config.cwd ? path.resolve(input.directory, config.cwd) : input.directory,
    fingerprint(config.environment),
    ...common,
  ])
}

function fingerprint(secret: string | Record<string, string> | undefined) {
  if (secret === undefined) return null
  return SharedCache.fingerprint(
    typeof secret === "string"
      ? secret
      : JSON.stringify(Object.entries(secret).toSorted(([a], [b]) => a.localeCompare(b))),
  )
}

// A Location holding a shared connection. The pool reaches Locations only through the holders
// registered right now, never through the one that opened the connection.
interface Holder {
  readonly authProvider: Effect.Effect<OAuthClientProvider | undefined>
  readonly elicitation: McpClient.ElicitationHandler["create"]
  readonly closed: (reason: string) => void
  readonly changed: (kind: McpConnection.Kind) => void
}

type Outcome = "connected" | "legacy" | McpConnection.Failure

interface Slot {
  readonly connection: McpConnection.Connection
  readonly holders: Set<Holder>
  readonly lock: Semaphore.Semaphore
  readonly outcome: Deferred.Deferred<Outcome>
  start?: Fiber.Fiber<void>
  connected: boolean
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const run = yield* FiberSet.makeRuntime<never, void, never>()
    const driver = Environment.makeLocalDriver(yield* ChildProcessSpawner)
    const host = Environment.Service.of({ files: Environment.makeFiles(driver), spawner: driver.spawner })
    const slots = new Map<string, Slot>()
    // Keys whose server negotiated the legacy protocol. Kept for the life of the process.
    const legacy = new Set<string>()

    // Takes only data from the Location that opens it: the connection outlives that Location's claim.
    const open = (key: string, input: Pick<Input, "name" | "config" | "directory" | "clientInfo">) => {
      const slot: Slot = {
        holders: new Set(),
        lock: Semaphore.makeUnsafe(1),
        outcome: Deferred.makeUnsafe(),
        connected: false,
        connection: McpConnection.make({
          name: input.name,
          config: input.config,
          directory: input.directory,
          shared: true,
          clientInfo: input.clientInfo,
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
          scope,
          lock: (effect) => slot.lock.withPermit(effect),
          callbacks: run,
          fork: run,
          events: {
            connecting: Effect.void,
            connected: Effect.void,
            failed: (failure) =>
              Effect.suspend(() => {
                detach(key, slot)
                return Deferred.succeed(slot.outcome, failure)
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
        const client = slot.connection.client
        // A failed start already settled the outcome.
        if (!client) return
        if (!client.modern) {
          legacy.add(key)
          detach(key, slot)
          yield* slot.connection.stop
          yield* Deferred.succeed(slot.outcome, "legacy")
          return
        }
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

    const acquire = Effect.fnUntraced(function* (key: string, input: Input, holder: Holder) {
      if (legacy.has(key)) return "legacy" as const
      const slot =
        slots.get(key) ??
        open(key, { name: input.name, config: input.config, directory: input.directory, clientInfo: input.clientInfo })
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
      const own = McpConnection.make(input)
      const state: { claim?: Scope.Closeable; holder?: Holder; shared?: McpConnection.Connection } = {}
      const live = () => state.shared ?? own
      // The shared connection carries the name of the Location that opened it; forms show this Location's.
      const elicit: McpClient.ElicitationHandler["create"] = (request) =>
        input.elicitation.create({ ...request, server: input.name })

      // Holder callbacks run in the Location's own callback runtime, under its lock, and only while the
      // claim they belong to is the current one.
      const current = (holder: Holder, effect: () => Effect.Effect<void>) =>
        input.callbacks(
          Effect.suspend(() => (state.holder === holder ? effect() : Effect.void)).pipe(input.lock, Effect.ignore),
        )

      const clear = Effect.suspend(() => {
        const claim = state.claim
        state.claim = undefined
        state.holder = undefined
        state.shared = undefined
        return claim ? Scope.close(claim, Exit.void) : Effect.void
      })

      // Resolves false when the server negotiated legacy, leaving the start to the Location's own connection.
      const join = (key: string) =>
        Effect.gen(function* () {
          yield* input.events.connecting
          const claim = yield* Scope.fork(input.scope)
          const holder: Holder = {
            authProvider: input.authProvider,
            elicitation: elicit,
            closed: (reason) => current(holder, () => input.events.closed(reason)),
            changed: (kind) => current(holder, () => input.events.changed(kind)),
          }
          state.claim = claim
          state.holder = holder
          const outcome = yield* acquire(key, input, holder).pipe(
            Scope.provide(claim),
            Effect.onInterrupt(() => clear),
          )
          if (outcome === "legacy") {
            yield* clear
            return false
          }
          if ("status" in outcome) {
            yield* clear
            yield* input.events.failed(outcome)
            return true
          }
          state.shared = outcome
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
          return live().client
        },
        get tools() {
          return live().tools
        },
        get prompts() {
          return live().prompts
        },
        start: Effect.gen(function* () {
          const key = yield* input.key
          if (!legacy.has(key) && (yield* join(key))) return
          yield* own.start
        }),
        stop: Effect.gen(function* () {
          if (!state.claim) return yield* own.stop
          yield* clear
          yield* input.events.changed("tools")
          yield* input.events.changed("resources")
          yield* input.events.changed("prompts")
        }),
        recovering: (client, request) =>
          state.shared
            ? state.shared.recovering(client, (client) => request(bind(client)))
            : own.recovering(client, request),
        catalog: (client) => live().catalog(client),
      }
    }

    return Service.of({ connection })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [CrossSpawnSpawner.node] })
