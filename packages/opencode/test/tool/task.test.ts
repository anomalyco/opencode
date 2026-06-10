/**
 * @spec-handoff
 * @interface TaskTool input schema — OPTIONAL `model` parameter
 *   model?: string   // format "providerID/modelID", e.g. "anthropic/claude-sonnet-4"
 *   Lives in BaseParameterFields (src/tool/task.ts:53-56) so it flows into BOTH
 *   `BaseParameters` (jsonSchema) and `Parameters`.
 *
 * @behavior
 *   1. model OMITTED → subagent runs on `agent.model` if set, else inherits the parent
 *      assistant message's { providerID, modelID }. The `model` passed to ops.prompt
 *      equals that inherited/agent model; `variant` stays the parent variant when the
 *      agent has no model of its own.
 *   2. model = VALID "providerID/modelID" → overrides BOTH agent.model and parent
 *      inheritance. Parsed with Provider.parseModel and validated with Provider.getModel.
 *      The `model` passed to ops.prompt equals the parsed { providerID, modelID }, and
 *      `variant` becomes undefined (treated like an explicit agent-model override). The
 *      override beats the subagent's OWN configured model, not just parent inheritance.
 *   3. model = unknown provider OR unknown model → Provider.getModel raises
 *      ModelNotFoundError; the tool FAILS with a clear, actionable error whose message
 *      contains the offending "providerID/modelID". ops.prompt is never called and NO
 *      child subagent session is created (validation short-circuits before spawning).
 *   4. model = malformed string with no "/" → FAIL with a clear error mentioning the bad
 *      string. No silent fallthrough to the inherited model.
 *   5. model = "" (empty string) → FAIL with a clear error. Empty is NOT treated as
 *      "omitted": the gate is `params.model !== undefined`, not a truthiness check, so an
 *      empty string never silently inherits. ops.prompt is never called.
 *   6. model = prototype-polluting key, e.g. "anthropic/__proto__" or "__proto__/x" →
 *      FAIL with a clear, actionable error naming the offending value. Must NOT bypass
 *      validation (treating Object.prototype as a "found" model) and must NOT surface a
 *      raw "Cannot read properties of undefined" TypeError. ops.prompt is never called.
 *   7. model = VALID multi-slash modelID, e.g. "openrouter/anthropic/claude-3.5" →
 *      providerID is the FIRST segment ("openrouter"); modelID is the remainder joined
 *      back with "/" ("anthropic/claude-3.5"). Resolves and is passed through to ops.prompt
 *      exactly as { providerID: "openrouter", modelID: "anthropic/claude-3.5" }.
 *
 * @edge-cases
 *   - Only a present (`!== undefined`) model string triggers validation; omission alone
 *     preserves the inheritance behavior. An empty string is present → it validates → fails.
 *   - Override validation runs through Provider.getModel BEFORE the child session is created
 *     and BEFORE ops.prompt — a failed validation must short-circuit so neither happens.
 *   - The error message must surface the user-supplied model string for actionability,
 *     including for prototype-polluting keys (no raw TypeError leakage).
 *
 * @helpers Provider.parseModel, Provider.getModel, Provider.ModelNotFoundError
 * @see src/provider/provider.ts (getModel record lookup: provider.ts:1747-1768;
 *      parseModel split-on-"/": provider.ts:1944)
 */
import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { ProviderTest } from "../fake/provider"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    EventV2Bridge.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
    RuntimeFlags.layer(flags),
  ).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer())
const background = testEffect(layer({ experimentalBackgroundSubagents: true }))

// A model the Task tool's `model` override is allowed to resolve to.
// Distinct from `ref` (the inherited parent/seed model) so override vs. inheritance
// can be told apart by the captured ops.prompt input.
const overrideRef = {
  providerID: ProviderV2.ID.make("anthropic"),
  modelID: ModelV2.ID.make("claude-sonnet-4"),
}

// A second valid model whose modelID itself contains slashes. parseModel keeps the
// FIRST "/" segment as the providerID and joins the rest back as the modelID, so the
// string "openrouter/anthropic/claude-3.5" must resolve to this pair.
const multiSlashRef = {
  providerID: ProviderV2.ID.make("openrouter"),
  modelID: ModelV2.ID.make("anthropic/claude-3.5"),
}

// Known-model catalog for the override-validation tests. Declared as plain object
// literals ON PURPOSE: the real Provider.getModel resolves models with record lookups
// (`s.providers[providerID]` provider.ts:1749, then `provider.models[modelID]`
// provider.ts:1760). A prototype key like "__proto__" therefore resolves through
// Object.prototype here exactly as it would against real provider state, which is what
// lets the prototype-key tests exercise the genuine lookup hazard instead of a
// pre-sanitized mock.
const knownModels: Record<string, { models: Record<string, Provider.Model> }> = {
  anthropic: {
    models: {
      "claude-sonnet-4": ProviderTest.model({ id: overrideRef.modelID, providerID: overrideRef.providerID }),
    },
  },
  openrouter: {
    models: {
      "anthropic/claude-3.5": ProviderTest.model({ id: multiSlashRef.modelID, providerID: multiSlashRef.providerID }),
    },
  },
}

// Mirror Provider.getModel (provider.ts:1747-1768): a missing provider OR a missing
// model raises ModelNotFoundError; whatever the records resolve is treated as a found
// model — including anything reachable via the prototype chain. The record lookups are
// deliberately unguarded so prototype-polluting keys behave as they do in production.
const providerMock = Layer.mock(Provider.Service)({
  getModel: (providerID, modelID) =>
    Effect.gen(function* () {
      const provider = knownModels[providerID]
      if (!provider) return yield* Effect.fail(new Provider.ModelNotFoundError({ providerID, modelID, suggestions: [] }))
      const info = provider.models[modelID]
      if (!info) return yield* Effect.fail(new Provider.ModelNotFoundError({ providerID, modelID, suggestions: [] }))
      return info
    }),
})

const withModel = testEffect(Layer.mergeAll(layer(), providerMock))

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`<task id="${child.id}" state="completed">`)
      expect(seen?.sessionID).toBe(child.id)
      expect(seen?.variant).toBe("xhigh")
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`<task id="${result.metadata.sessionId}" state="completed">`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.agent).toBe("reviewer")
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "read",
            pattern: "*",
            action: "deny",
          },
        ])
        expect(seen?.tools).toBeUndefined()
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("rejects background execution when the experiment is disabled", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("promotes a running foreground task without restarting it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = yield* Deferred.make<void>()
      const done = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.PromptInput>()
      let runs = 0
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            return Deferred.succeed(injected, input).pipe(Effect.as(reply(input, "injected")))
          }
          return Effect.gen(function* () {
            runs += 1
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(done)
            return reply(input, "background done")
          })
        },
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      const job = (yield* jobs.list())[0]
      expect(job).toBeDefined()
      if (!job) throw new Error("task job not found")
      expect(job.metadata?.parentSessionId).toBe(chat.id)
      yield* jobs.promote(job.id)

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect((yield* jobs.get(result.metadata.sessionId))?.status).toBe("running")
      expect(runs).toBe(1)

      yield* Deferred.succeed(done, undefined)
      expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.output).toBe("background done")
      expect((yield* Deferred.await(injected)).parts[0]?.type).toBe("text")
      expect(runs).toBe(1)
    }),
  )

  background.instance("execute launches background tasks without waiting for completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const job = yield* jobs.get(result.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect(job?.status).toBe("running")
    }),
  )

  background.instance("background task completion waits for running updates", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const first = defer<void>()
      const second = defer<void>()
      const updated = defer<SessionPrompt.PromptInput>()
      const injected = defer<SessionPrompt.PromptInput>()
      let prompts = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            injected.resolve(input)
            return Effect.succeed(reply(input, "done"))
          }
          prompts++
          if (prompts === 1) return Effect.promise(() => first.promise).pipe(Effect.as(reply(input, "first done")))
          updated.resolve(input)
          return Effect.promise(() => second.promise).pipe(Effect.as(reply(input, "second done")))
        },
      }
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const started = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        context,
      )
      const result = yield* def.execute(
        {
          description: "add investigation scope",
          prompt: "also inspect cancellation",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context,
      )

      expect(result.metadata.sessionId).toBe(started.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain("Background task updated")
      first.resolve()
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")
      expect((yield* Effect.promise(() => updated.promise)).parts).toEqual([
        { type: "text", text: "also inspect cancellation" },
      ])

      second.resolve()
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("second done")
      const notification = yield* Effect.promise(() => injected.promise)
      expect(notification.variant).toBe("xhigh")
      expect(notification.parts[0]?.type).toBe("text")
      if (notification.parts[0]?.type === "text") expect(notification.parts[0].text).toContain("second done")
    }),
  )

  background.instance("background tasks complete through the background job service", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("background done")
    }),
  )

  background.instance("background task completion does not wait for the parent async prompt", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps({ text: "background done" }),
              prompt: (input) =>
                input.sessionID === chat.id ? Effect.never : Effect.succeed(reply(input, "background done")),
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
    }),
  )

  background.instance("removing the parent session cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("removing the child task session cancels its running background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(result.metadata.sessionId)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("cancelling the parent run cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* runState.cancel(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a child run cancels its own pre-runner task job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })

      yield* runState.cancel(child.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a parent run recursively cancels descendant background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })
      yield* jobs.start({
        id: grandchild.id,
        type: "task",
        metadata: { parentSessionId: child.id, sessionId: grandchild.id },
        run: Effect.never,
      })

      yield* runState.cancel(chat.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )
})

describe("tool.task model override", () => {
  // Behavior 1 — omitting `model` preserves inheritance. The captured ops.prompt input
  // uses the parent/seed model and keeps the parent variant (the "general" agent has no
  // model of its own).
  withModel.instance("omitting model preserves inherited parent model and variant", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(seen?.model).toEqual(ref)
      expect(seen?.variant).toBe("xhigh")
    }),
  )

  // Behavior 2 — a valid "providerID/modelID" overrides both agent.model and parent
  // inheritance. The captured model equals Provider.parseModel(params.model), and variant
  // is undefined (treated like an explicit agent-model override).
  withModel.instance("valid model param overrides agent and parent inheritance", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      // Stored in a const so the extra `model` key is accepted by width subtyping
      // until task.ts adds it to the schema (RED phase).
      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/claude-sonnet-4",
      }

      yield* def.execute(params, {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })

      expect(seen?.model).toEqual(overrideRef)
      expect(seen?.variant).toBeUndefined()
    }),
  )

  // Behavior 3 — a well-formed "providerID/modelID" that Provider.getModel rejects fails
  // the tool with a clear, actionable error mentioning the offending model; ops.prompt is
  // never called.
  withModel.instance("unknown model param fails with an actionable error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "bogus/does-not-exist",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("Invalid task model")
      expect(rendered).toContain("bogus/does-not-exist")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 4 — a string with no "/" fails with a clear error mentioning the bad value —
  // no silent fallthrough to the inherited model.
  withModel.instance("malformed model param without a slash fails clearly", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "not-a-valid-model",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("Invalid task model")
      expect(rendered).toContain("not-a-valid-model")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 5 (M1) — RED until the gate becomes `params.model !== undefined`. An empty
  // string is currently falsy, so the impl silently inherits and reaches ops.prompt. The
  // spec is the opposite: an empty model string is PRESENT, so it must validate and fail,
  // and ops.prompt must never be called.
  withModel.instance("empty-string model param fails instead of silently inheriting", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 6 (M3) — RED until prototype keys are rejected. The provider mock resolves
  // models with the same unguarded record lookup the real Provider.getModel uses, so
  // "anthropic/__proto__" currently resolves Object.prototype as a "found" model and
  // BYPASSES validation, reaching ops.prompt. The spec is that a prototype-polluting key
  // fails with a clear error naming the offending value, and ops.prompt is never called.
  withModel.instance("prototype-key model param (anthropic/__proto__) fails clearly", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/__proto__",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("anthropic/__proto__")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 6 (M3) — RED until prototype keys are rejected. With "__proto__" as the
  // providerID the real record lookup resolves Object.prototype as the provider, then
  // reads `provider.models` (undefined) and indexes it, surfacing a raw
  // "Cannot read properties of undefined" TypeError instead of an actionable error. The
  // spec is a clear error naming the offending value, with ops.prompt never called.
  withModel.instance("prototype-key model param (__proto__/x) fails with an actionable error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "__proto__/x",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("__proto__/x")
      expect(rendered).not.toContain("Cannot read properties of undefined")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 7 (M6) — a VALID model whose modelID itself contains slashes resolves and is
  // passed through to ops.prompt verbatim. parseModel keeps only the FIRST segment as the
  // providerID and joins the rest as the modelID, so "openrouter/anthropic/claude-3.5"
  // must reach ops.prompt as { providerID: "openrouter", modelID: "anthropic/claude-3.5" }.
  withModel.instance("valid multi-slash modelID resolves and is passed through verbatim", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "openrouter/anthropic/claude-3.5",
      }

      yield* def.execute(params, {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })

      expect(seen?.model).toEqual(multiSlashRef)
      expect(seen?.variant).toBeUndefined()
    }),
  )

  // Behavior 2 (M6) — the explicit override beats the subagent's OWN configured model, not
  // merely parent inheritance. The "scoped" subagent is configured with its own model
  // (anthropic/claude-sonnet-4); calling Task with a DIFFERENT valid model
  // (openrouter/anthropic/claude-3.5) must send the explicit override — not the agent's own
  // model and not the inherited parent model — to ops.prompt.
  withModel.instance(
    "explicit model param beats the subagent's own configured model",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const params = {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "scoped",
          model: "openrouter/anthropic/claude-3.5",
        }

        yield* def.execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })

        // The explicit override wins over the agent's own model (overrideRef) and over the
        // inherited parent model (ref).
        expect(seen?.model).toEqual(multiSlashRef)
        expect(seen?.model).not.toEqual(overrideRef)
        expect(seen?.variant).toBeUndefined()
      }),
    {
      config: {
        agent: {
          scoped: {
            mode: "subagent",
            model: "anthropic/claude-sonnet-4",
          },
        },
      },
    },
  )

  // Behavior 3/5 (M5) — RED until model validation moves BEFORE child-session creation.
  // The impl currently creates the child session (task.ts:155-171) before validating the
  // override (task.ts:184-203), so an invalid model leaves an orphan child session behind.
  // The spec is that an invalid model short-circuits before any child session is created.
  withModel.instance("invalid model param creates no child session (validates first)", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "bogus/does-not-exist",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(prompted).toBe(false)
      // Observe the side effect directly: a failed validation must not spawn a child.
      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(0)
    }),
  )
})
