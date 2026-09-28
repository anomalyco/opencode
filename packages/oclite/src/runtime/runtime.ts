// Runtime service + app layer composition (ARCHITECTURE §3). `start` resolves the model, profile, ruleset,
// tools and system prompt once, then forks the loop and hands back a RunHandle.
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import {
  AppConfig,
  Asker,
  ConfigError,
  Hooks,
  LlmGateway,
  Mcp,
  Permission,
  Runtime,
  SessionStore,
  ToolRegistry,
  type ResolvedConfig,
  type RunResult,
  type RunState,
  type RuntimeShape,
  type TokenUsage,
} from "../contract"
import { persist } from "../llm/probe"
import { mcpForRun } from "../mcp/tools"
import { harnessPrompt, select } from "../profile/profiles"
import { replay, validId } from "../session/store"
import { make } from "../subagent/manager"
import { taskTool } from "../subagent/task"
import { parse } from "../tools/text-protocol"
import { system } from "./context"
import { run, type LoopDeps, type LoopResult } from "./loop"

export interface RuntimeOptions {
  /** Retry backoff in ms (default 2/4/8 s; OCLITE_RETRY_SCALE multiplies it, for subprocess tests). */
  retryDelays?: readonly number[]
}

// Every service module exports `layer`; they load as module objects (also keeps them off the startup path).
export function appLayer(cfg: ResolvedConfig, asker: Layer.Layer<Asker>, http?: Layer.Layer<HttpClient.HttpClient>, options: RuntimeOptions = {}) {
  return Layer.unwrap(
    Effect.promise(async () => {
      const hooks = await import("../hooks/hooks")
      const client = await import("../llm/client")
      const mcp = await import("../mcp/client")
      const permission = await import("../permission/permission")
      const store = await import("../session/store")
      const registry = await import("../tools/registry")
      const config = Layer.succeed(AppConfig, cfg)
      const base = Layer.mergeAll(config, store.layer, hooks.layer.pipe(Layer.provide(config)), mcp.layer, http ? client.layerWith(http) : client.layer)
      const services = Layer.provideMerge(
        Layer.provideMerge(registry.layer, permission.layer.pipe(Layer.provideMerge(asker))),
        base.pipe(Layer.provide(config)),
      )
      return Layer.provideMerge(layer(options), services)
    }),
  )
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
      const mcp = yield* Mcp
      const asker = yield* Asker
      const scale = Number(process.env.OCLITE_RETRY_SCALE ?? 1)
      // Children start through this runtime's own `start` (declared below; only called after the layer is built).
      const subagents = make({ start: (input, sink) => start(input, sink), store, cfg, ask: asker.ask })
      const deps: LoopDeps = {
        gateway,
        store,
        hooks,
        subagents,
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
          // A `transport: mcp` child process starts its top-level runs at the depth its parent gave it.
          const depth = input.parent ? input.parent.depth + 1 : Number(process.env.OCLITE_DEPTH ?? 0)
          if (input.session_id !== undefined && !validId(input.session_id))
            return yield* new ConfigError({ message: `invalid session id "${input.session_id}"` })
          const previous = input.session_id ? yield* store.read(input.session_id) : []
          const fresh = !previous.some((record) => record.type === "session")
          // A sub-agent id is chosen by the manager before its session exists; any other unknown id is an error.
          if (input.session_id && fresh && !input.parent)
            return yield* new ConfigError({ message: `unknown session "${input.session_id}"` })
          const session_id = !fresh
            ? input.session_id!
            : yield* store.create({ id: input.session_id ?? "", cwd, agent: agent.name, model: handle.ref, profile: profile.name,
                depth, parent_id: input.parent?.session_id, parent_call_id: input.parent?.call_id, created_at: Date.now() })
          const agent_path = input.parent ? [agent.name] : []
          const status = (phase: "tools" | "instructions" | "notice", message: string) =>
            sink({ session_id, agent_path, type: "status", phase, message })
          const servers = yield* mcpForRun(mcp, profile, (names) => store.append(session_id, { type: "tools_activated", names }), (key, message) =>
            gateway.notice(key, message).pipe(Effect.flatMap((first) => (first ? status("notice", message) : Effect.void))))
          const ruleset = permission.ruleset({ agent, mode: input.permissionMode ?? cfg.permissionMode,
            parent: input.parent?.ruleset, mcpReadOnly: servers.readOnly })
          yield* status("tools", "building tools")
          const ctx = { session_id, cwd, agent, depth, ruleset, sink, profile }
          const mode = input.permissionMode ?? cfg.permissionMode
          const parentReadOnly = mode === "plan" || agent.read_only
          const tools = yield* registry.build(ctx, [...servers.extra, taskTool({ ctx, subagents, cfg, parentReadOnly })], handle.capabilities)
          const mcpInstructions = yield* servers.bind(tools, replay(previous).activated)
          yield* status("instructions", "loading instructions")
          const prompt = yield* Effect.promise(() =>
            system({ harness: harnessPrompt(profile, handle), agent, cfg: { ...cfg, cwd }, profile, textProtocolPrompt: tools.textProtocolPrompt, mcpInstructions }),
          )
          yield* Effect.forEach(prompt.notices, (notice) => status("notice", notice), { discard: true })
          yield* sink({ session_id, agent_path, type: "system", agent: agent.name, model: handle.ref, profile: profile.name,
            tools: Object.keys(tools.tools).sort(), mcp: (yield* mcp.status()).map((item) => ({ name: item.name, status: item.status })) })
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
          // A watcher settles the Deferred once, so every await works even after an earlier waiter was interrupted.
          const done = yield* Deferred.make<RunResult>()
          const finished: { state?: RunState } = {}
          yield* Fiber.await(fiber).pipe(
            Effect.flatMap((exit) =>
              Effect.gen(function* () {
                yield* subagents.cancelAll(session_id) // no child outlives its parent's run
                // Descendants' denials count too (headless exit 3), as do text-protocol give-ups.
                const denied = (yield* permission.denials(session_id)) + (yield* subagents.denials(session_id)) +
                  (Exit.isSuccess(exit) ? (exit.value.protocolFailures ?? 0) : 0)
                const base = { session_id, turns: progress.step, usage: progress.tokens, denied, text: "" }
                const value: RunResult = Exit.isSuccess(exit)
                  ? { ...base, ...result(exit.value), state: exit.value.reason === "error" ? "failed" : exit.value.reason === "cancelled" ? "cancelled" : "completed" }
                  : Cause.hasInterrupts(exit.cause)
                    ? { ...base, state: "cancelled", reason: "cancelled" }
                    : { ...base, state: "failed", reason: "error", error: Cause.pretty(exit.cause) }
                finished.state = value.state
                yield* Deferred.succeed(done, value)
              }),
            ),
            Effect.forkDetach,
          )
          return {
            session_id,
            send: (message: string) => Effect.sync(() => void steers.push(message)),
            cancel: Fiber.interrupt(fiber).pipe(Effect.asVoid),
            status: Effect.sync(() => ({ state: finished.state ?? "running", step: progress.step, started_at, tokens: progress.tokens })),
            await: Deferred.await(done),
          }
        })

      return Runtime.of({ start, subagents })
    }),
  )
}

function result(value: LoopResult) {
  return { reason: value.reason, text: value.text, turns: value.turns, usage: value.usage, error: value.error }
}
