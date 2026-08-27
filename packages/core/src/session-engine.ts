export * as SessionEngine from "./session-engine.js"

import { Context, Effect, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Agent } from "./agent.js"
import { Catalog } from "./catalog.js"
import { Location } from "./location.js"
import { McpInstructions } from "./mcp/instructions.js"
import { McpTool } from "./tool/mcp.js"
import { PluginSupervisor } from "./plugin/supervisor.js"
import { Session } from "./session.js"
import { SessionEngineBindings } from "./session/engine-bindings.js"
import { SessionRunnerModel } from "./session/runner/model.js"
import { SessionSchema } from "./session/schema.js"
import { Snapshot } from "./snapshot.js"
import { Tool } from "./tool.js"
import { compileWithHoistedGlobals, sessionEngineGroup, type SessionEngine, type SessionEngineError } from "./location-services.js"
import type { AbsolutePath } from "./schema.js"

/**
 * Values-constructed session environment: the engine tier of the location
 * graph, booted without discovery, plugins, or MCP. Capabilities arrive
 * through the same draft APIs plugins use, so registry invariants (hook
 * wiring, image normalization, permission gating) hold by construction.
 */
export interface Options {
  readonly directory: AbsolutePath
  /**
   * Fixed model for every drain in this environment, bypassing catalog
   * resolution (SessionRunnerModel.resolved is the values-side constructor).
   * Omit to resolve through the populated catalog instead.
   */
  readonly model?: SessionRunnerModel.Resolved
  /** Capture filesystem snapshots around attempts. Defaults to false. */
  readonly snapshots?: boolean
  readonly tools?: (draft: Tool.Draft) => void
  readonly agents?: (draft: Agent.Draft) => void
  readonly catalog?: (draft: Catalog.Draft) => void
}

type PromptOptions = Omit<Parameters<Session.Interface["prompt"]>[0], "sessionID">
type SessionOptions = Omit<Parameters<Session.Interface["create"]>[0], "location" | "parentID">

export interface SessionHandle {
  readonly id: SessionSchema.ID
  readonly prompt: (input: PromptOptions) => ReturnType<Session.Interface["prompt"]>
  readonly interrupt: (input?: { readonly continue?: boolean }) => Effect.Effect<boolean>
}

export interface Handle {
  /**
   * Ensure a durable session and bind it to this environment. Reusing a
   * Session ID adopts the existing Session (creation args are ignored then),
   * so reconnection after a restart is the same call with the same ID. The
   * binding lives until the environment's scope closes; drains resolve the
   * bound graph instead of the Session's Location graph.
   */
  readonly session: (input?: SessionOptions) => Effect.Effect<SessionHandle, Session.NotFoundError>
}

export interface Interface {
  readonly make: (options: Options) => Effect.Effect<Handle, SessionEngineError, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionEngine") {}

/**
 * Captures the application root's MemoMap at construction (the same trick
 * LayerMap.make uses), so each environment's hoisted global nodes dedupe
 * against the running Database, Bus, and SessionStore instead of building
 * second instances. The engine subtree itself builds fresh per environment.
 *
 * Like buildLocationServiceMap, the layer must receive the application
 * root's replacements: hoisted globals otherwise compile their original
 * implementations and a composed root (test harness, embedded host) would
 * build second, differently-configured instances.
 */
const layerWith = (base: LayerNode.Replacements) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const memoMap = Layer.CurrentMemoMap.forkOrCreate(yield* Effect.context<never>())
      const bindings = yield* SessionEngineBindings.Service
      const sessions = yield* Session.Service

      const make = Effect.fn("SessionEngine.make")(function* (options: Options) {
        const scope = yield* Effect.scope
        const location = Location.Ref.make({ directory: options.directory })
        // Later entries win in the replacement map, so environment-specific
        // substitutions override same-node entries from the application root.
        const replacements: LayerNode.Replacements = [
          ...base,
          [Location.node, Location.boundNode(location)],
          [PluginSupervisor.node, PluginSupervisor.noop],
          [McpTool.node, McpTool.noop],
          [McpInstructions.node, McpInstructions.noop],
          ...(options.snapshots === true ? [] : [[Snapshot.node, Snapshot.noopLayer] as const]),
          ...(options.model === undefined
            ? []
            : [[SessionRunnerModel.node, SessionRunnerModel.fixed(options.model)] as const]),
        ]
        const context = yield* Layer.buildWithMemoMap(
          compileWithHoistedGlobals(sessionEngineGroup, replacements),
          memoMap,
          scope,
        )

        const populate = Effect.gen(function* () {
          const tools = options.tools
          if (tools) yield* Tool.Service.use((service) => service.transform(tools))
          const agents = options.agents
          if (agents) yield* Agent.Service.use((service) => service.transform(agents))
          const catalog = options.catalog
          if (catalog) yield* Catalog.Service.use((service) => service.transform(catalog))
        })
        yield* populate.pipe(Effect.provide(context), Effect.provideService(Scope.Scope, scope))

        const session = Effect.fn("SessionEngine.session")(function* (input?: SessionOptions) {
          // Create-or-adopt: ID reuse returns the existing durable Session, and the
          // binding outranks its recorded Location even if the directories differ.
          const info = yield* sessions.create({ ...input, location })
          // Bind in the environment's scope: teardown must unbind every session so
          // drains fall back to the Location graph instead of a torn-down context.
          yield* bindings.bind(info.id, context).pipe(Effect.provideService(Scope.Scope, scope))
          return {
            id: info.id,
            prompt: (promptInput: PromptOptions) => sessions.prompt({ ...promptInput, sessionID: info.id }),
            interrupt: (interruptInput?: { readonly continue?: boolean }) =>
              sessions.interrupt(info.id, interruptInput),
          } as const
        })

        return { session } as const
      })

      return Service.of({ make })
    }),
  )

/** Thread the application root's replacements through, mirroring buildLocationServiceMap. */
export const configured = (replacements: LayerNode.Replacements = []) =>
  makeGlobalNode({ service: Service, layer: layerWith(replacements), deps: [SessionEngineBindings.node, Session.node] })

export const node = configured()
