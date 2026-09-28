// Runtime service + app layer composition (ARCHITECTURE §3). `start` resolves the model, profile, ruleset,
// tools and system prompt once, then forks the loop and hands back a RunHandle.
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import {
  AppConfig,
  ConfigError,
  Hooks,
  LlmGateway,
  Permission,
  Runtime,
  SessionStore,
  SpawnError,
  ToolRegistry,
  type Asker,
  type ResolvedConfig,
  type RunResult,
  type RunState,
  type RuntimeShape,
  type SubagentsShape,
  type TokenUsage,
} from "../contract"
import { layer as hooksLayer } from "../hooks/hooks"
import { layer as gatewayLayer, layerWith } from "../llm/client"
import { persist } from "../llm/probe"
import { layer as permissionLayer } from "../permission/permission"
import { harnessPrompt, select } from "../profile/profiles"
import { layer as storeLayer, replay } from "../session/store"
import { layer as registryLayer } from "../tools/registry"
import { parse } from "../tools/text-protocol"
import { system } from "./context"
import { run, type LoopDeps } from "./loop"

export interface RuntimeOptions {
  /** Retry backoff in ms (default 2/4/8 s; OCLITE_RETRY_SCALE multiplies it, for subprocess tests). */
  retryDelays?: readonly number[]
}

export function appLayer(cfg: ResolvedConfig, asker: Layer.Layer<Asker>, http?: Layer.Layer<HttpClient.HttpClient>, options: RuntimeOptions = {}) {
  const config = Layer.succeed(AppConfig, cfg)
  const base = Layer.mergeAll(config, storeLayer, hooksLayer.pipe(Layer.provide(config)), http ? layerWith(http) : gatewayLayer)
  const services = Layer.provideMerge(
    Layer.provideMerge(registryLayer, permissionLayer.pipe(Layer.provide(asker))),
    base.pipe(Layer.provide(config)),
  )
  return Layer.provideMerge(layer(options), services)
}

export function layer(options: RuntimeOptions = {}) {
  return Layer.effect(
    Runtime,
    Effect.gen(function* () {
      const cfg = yield* AppConfig
      const gateway = yield* LlmGateway
      const store = yield* SessionStore
      const registry = yield* ToolRegistry
      const permission = yield* Permission
      const hooks = yield* Hooks
      const scale = Number(process.env.OCLITE_RETRY_SCALE ?? 1)
      const deps: LoopDeps = {
        gateway,
        store,
        hooks,
        // Phase 5 seam: subagent/manager.ts `make({ start })` replaces this stub (task tool, background queue).
        subagents: noSubagents,
        parse,
        persistContext: (handle, tokens) => persist(handle.baseURL, handle.model.id, { context_window: tokens }, "error-400"),
        retryDelays: options.retryDelays ?? [2000, 4000, 8000].map((ms) => ms * scale),
      }

      const start: RuntimeShape["start"] = (input, sink) =>
        Effect.gen(function* () {
          const agent = cfg.agents[input.agent]
          if (!agent) return yield* new ConfigError({ message: `unknown agent "${input.agent}"` })
          const handle = yield* gateway.resolve(agent.model ?? input.model ?? cfg.model)
          const profile = select({ explicit: input.profile ?? cfg.profile, handle })
          const cwd = input.cwd ?? cfg.cwd
          const depth = input.parent ? input.parent.depth + 1 : 0
          const previous = input.session_id ? yield* store.read(input.session_id) : []
          if (input.session_id && !previous.some((record) => record.type === "session"))
            return yield* new ConfigError({ message: `unknown session "${input.session_id}"` })
          const session_id =
            input.session_id ??
            (yield* store.create({ id: "", cwd, agent: agent.name, model: handle.ref, profile: profile.name, depth,
              parent_id: input.parent?.session_id, parent_call_id: input.parent?.call_id, created_at: Date.now() }))
          const agent_path = input.parent ? [agent.name] : []
          const status = (phase: "tools" | "instructions" | "notice", message: string) =>
            sink({ session_id, agent_path, type: "status", phase, message })
          const ruleset = permission.ruleset({ agent, mode: input.permissionMode ?? cfg.permissionMode,
            parent: input.parent?.ruleset, mcpReadOnly: [] })
          yield* status("tools", "building tools")
          const tools = yield* registry.build({ session_id, cwd, agent, depth, ruleset, sink, profile }, [], handle.capabilities)
          yield* status("instructions", "loading instructions")
          const prompt = yield* Effect.promise(() =>
            system({ harness: harnessPrompt(profile, handle), agent, cfg: { ...cfg, cwd }, profile, textProtocolPrompt: tools.textProtocolPrompt }),
          )
          yield* Effect.forEach(prompt.notices, (notice) => status("notice", notice), { discard: true })
          yield* sink({ session_id, agent_path, type: "system", agent: agent.name, model: handle.ref, profile: profile.name,
            tools: Object.keys(tools.tools).sort(), mcp: [] })
          const text = typeof input.prompt === "string" ? input.prompt
            : input.prompt.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
          yield* store.append(session_id, { type: "user", turn: replay(previous).turn, text, synthetic: false })

          const steers: string[] = []
          const progress = { step: 0, tokens: { input: 0, output: 0, estimated: false } as TokenUsage }
          const started_at = Date.now()
          const fiber = yield* run(deps, {
            session_id, agent_path, agent, handle, profile, system: prompt.text, tools, cwd, sink, progress,
            maxTurns: Math.min(input.maxTurns ?? cfg.maxTurns ?? Infinity, agent.steps ?? Infinity),
            thinking: input.thinking ?? cfg.thinking ?? agent.thinking,
            steers: () => Effect.sync(() => steers.splice(0)),
          }).pipe(Effect.forkDetach)
          const finished: { state?: RunState } = {}
          const result = Fiber.await(fiber).pipe(
            Effect.flatMap((exit) =>
              Effect.gen(function* () {
                const denied = yield* permission.denials(session_id)
                const base = { session_id, turns: progress.step, usage: progress.tokens, denied, text: "" }
                const value: RunResult = Exit.isSuccess(exit)
                  ? { ...base, ...exit.value, state: exit.value.reason === "error" ? "failed" : exit.value.reason === "cancelled" ? "cancelled" : "completed" }
                  : Cause.hasInterrupts(exit.cause)
                    ? { ...base, state: "cancelled", reason: "cancelled" }
                    : { ...base, state: "failed", reason: "error", error: Cause.pretty(exit.cause) }
                finished.state = value.state
                return value
              }),
            ),
            Effect.cached,
          )
          const awaited = yield* result
          return {
            session_id,
            send: (message: string) => Effect.sync(() => void steers.push(message)),
            cancel: Fiber.interrupt(fiber).pipe(Effect.asVoid),
            status: Effect.sync(() => ({ state: finished.state ?? "running", step: progress.step, started_at, tokens: progress.tokens })),
            await: awaited,
          }
        })

      return Runtime.of({ start, subagents: noSubagents })
    }),
  )
}

const phase5 = () => new SpawnError({ message: "sub-agents arrive in phase 5" })

const noSubagents: SubagentsShape = {
  spawn: () => Effect.fail(phase5()),
  wait: () => Effect.die(phase5()),
  get: () => Effect.succeed(undefined),
  send: () => Effect.succeed(false),
  cancel: () => Effect.succeed(undefined),
  takeFinished: () => Effect.succeed([]),
  running: () => Effect.succeed(0),
  envelope: () => "",
}
