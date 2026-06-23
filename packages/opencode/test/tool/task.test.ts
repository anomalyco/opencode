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
import { SubagentLimits } from "@/session/subagent-limits"
import { TurnBudget } from "@/session/turn-budget"

import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

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

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seedMessages = Effect.fn("TaskToolTest.seedMessages")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID,
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
  return assistant
})

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const assistant = yield* seedMessages(chat.id)
  return { chat, assistant }
})

/**
 * Seeds a parent chain of `depth` sessions (root → deepest) and puts a
 * user/assistant message pair on the deepest one so the task tool can run
 * from it. Depth = chain.length, matching Session.lineage.
 */
const seedChain = Effect.fn("TaskToolTest.seedChain")(function* (depth: number) {
  const session = yield* Session.Service
  const chain: Session.Info[] = []
  for (let i = 0; i < depth; i++) {
    chain.push(
      yield* session.create({
        parentID: chain.at(-1)?.id,
        title: i === 0 ? "root" : `level ${i + 1}`,
      }),
    )
  }
  const deepest = chain.at(-1)!
  const assistant = yield* seedMessages(deepest.id)
  return { chain, deepest, assistant }
})

const taskParams = {
  description: "inspect bug",
  prompt: "look into the cache key path",
  subagent_type: "general",
}

function taskCtx(input: {
  sessionID: SessionID
  messageID: MessageID
  promptOps: TaskPromptOps
  extra?: Record<string, unknown>
  ask?: (req?: unknown) => Effect.Effect<void>
}) {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "build",
    abort: new AbortController().signal,
    extra: { promptOps: input.promptOps, ...input.extra },
    messages: [],
    metadata: () => Effect.void,
    ask: input.ask ?? (() => Effect.void),
  }
}

/**
 * The typed subagent-limit errors fail inside the tool body and surface as
 * defects through the execute boundary's `Effect.orDie` (same path as the
 * existing untyped tool errors); tests match on the defect instance.
 */
function defectOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (!Exit.isFailure(exit)) return undefined
  return exit.cause.reasons.find(Cause.isDieReason)?.defect
}

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
        expect(child.permission).toEqual(
          expect.arrayContaining([
            { permission: "todowrite", pattern: "*", action: "deny" },
            { permission: "bash", pattern: "*", action: "deny" },
            { permission: "read", pattern: "*", action: "deny" },
          ]),
        )
        // T6 (design-final §4.2): below the depth limit (childDepth 2 of 5)
        // there is NO task auto-deny anymore — spawn capability is governed by
        // the agent permission via the runtime merge.
        expect(child.permission!.filter((rule) => rule.permission === "task")).toEqual([])
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

  it.instance("a default-agent child below the limit gets no task deny and may spawn", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = stubOps()

      // `general` has no exact `task` rule — before T6 its child session got
      // the pauschal task deny; now the child (depth 2 < 5) stays spawn-able.
      const result = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      const child = yield* sessions.get(result.metadata.sessionId)
      expect(child.permission!.filter((rule) => rule.permission === "task")).toEqual([])

      // ...and the child can actually spawn the next level.
      const childAssistant = yield* seedMessages(child.id)
      const grandchild = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: child.id, messageID: childAssistant.id, promptOps }),
      )
      expect((yield* sessions.get(grandchild.metadata.sessionId)).parentID).toBe(child.id)
    }),
  )

  it.instance("a child spawned AT the depth limit carries a task deny", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      // Spawner at depth 4 ⇒ child at depth 5 = maxDepth: the last level is a
      // pure work level and its session ruleset denies task.
      const { deepest, assistant } = yield* seedChain(4)
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps: stubOps() }),
      )
      const child = yield* sessions.get(result.metadata.sessionId)
      expect(child.parentID).toBe(deepest.id)
      expect(child.permission).toEqual(
        expect.arrayContaining([{ permission: "task", pattern: "*", action: "deny" }]),
      )
    }),
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

describe("tool.task depth guard", () => {
  it.instance("refuses to spawn from a session at the maximum nesting depth before asking", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { deepest, assistant } = yield* seedChain(5)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const asks: unknown[] = []
      const promptOps = stubOps()

      const exit = yield* def
        .execute(
          taskParams,
          taskCtx({
            sessionID: deepest.id,
            messageID: assistant.id,
            promptOps,
            ask: (req) => Effect.sync(() => void asks.push(req)),
          }),
        )
        .pipe(Effect.exit)

      const error = defectOf(exit)
      expect(error).toBeInstanceOf(SubagentLimits.SubagentDepthError)
      const depthError = error as SubagentLimits.SubagentDepthError
      expect(depthError.depth).toBe(5)
      expect(depthError.limit).toBe(5)
      // The guard sits BEFORE the ask and before any session is created.
      expect(asks).toHaveLength(0)
      expect(yield* sessions.children(deepest.id)).toHaveLength(0)
    }),
  )

  it.instance("depth guard also fires for the bypassAgentCheck subtask path", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { deepest, assistant } = yield* seedChain(5)
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          taskParams,
          taskCtx({
            sessionID: deepest.id,
            messageID: assistant.id,
            promptOps: stubOps(),
            extra: { bypassAgentCheck: true },
          }),
        )
        .pipe(Effect.exit)

      expect(defectOf(exit)).toBeInstanceOf(SubagentLimits.SubagentDepthError)
      expect(yield* sessions.children(deepest.id)).toHaveLength(0)
    }),
  )

  it.instance("spawns from depths 2 through 4 and parents the child correctly", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()

      for (const depth of [2, 3, 4]) {
        const { deepest, assistant } = yield* seedChain(depth)
        const result = yield* def.execute(
          taskParams,
          taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps: stubOps() }),
        )
        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(deepest.id)
        expect(result.output).toContain(`state="completed"`)
      }
    }),
  )
})

describe("tool.task resume validation", () => {
  it.instance("refuses task_id resumes that are not direct children", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chain, deepest, assistant } = yield* seedChain(3)
      const foreign = yield* sessions.create({ title: "foreign tree" })
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // Self, root ancestor, direct parent (= ancestor), and a foreign tree:
      // all are refused with a typed error instead of being silently adopted
      // (the pre-fix behavior deadlocked on ancestor resumes).
      for (const target of [deepest.id, chain[0]!.id, chain[1]!.id, foreign.id]) {
        const exit = yield* awaitWithTimeout(
          def
            .execute(
              { ...taskParams, task_id: target },
              taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps: stubOps() }),
            )
            .pipe(Effect.exit),
          `resume of ${target} hung`,
        )
        const error = defectOf(exit)
        expect(error).toBeInstanceOf(SubagentLimits.SubagentResumeError)
        expect((error as SubagentLimits.SubagentResumeError).taskID).toBe(target)
      }
    }),
  )
})

describe("tool.task tree cap", () => {
  it.instance("caps lifetime spawns per session tree via the test seam", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.treeLimit = 2
      const sessions = yield* Session.Service
      const { chain, deepest, assistant } = yield* seedChain(2)
      const root = chain[0]!
      const rootAssistant = yield* seedMessages(root.id)
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // Spawn #1 from level 2, spawn #2 from the root: both count against the
      // SAME tree because the counter keys on the root session.
      const first = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps: stubOps() }),
      )
      yield* def.execute(taskParams, taskCtx({ sessionID: root.id, messageID: rootAssistant.id, promptOps: stubOps() }))

      const exit = yield* def
        .execute(taskParams, taskCtx({ sessionID: root.id, messageID: rootAssistant.id, promptOps: stubOps() }))
        .pipe(Effect.exit)
      const error = defectOf(exit)
      expect(error).toBeInstanceOf(SubagentLimits.SubagentTreeLimitError)
      const limitError = error as SubagentLimits.SubagentTreeLimitError
      expect(limitError.started).toBe(2)
      expect(limitError.limit).toBe(2)

      // The mid-tree session hits the same tree-wide cap.
      const midExit = yield* def
        .execute(taskParams, taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps: stubOps() }))
        .pipe(Effect.exit)
      expect(defectOf(midExit)).toBeInstanceOf(SubagentLimits.SubagentTreeLimitError)

      // Resuming an existing child is not a new spawn and passes the gate.
      const resumed = yield* def.execute(
        { ...taskParams, task_id: first.metadata.sessionId },
        taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps: stubOps() }),
      )
      expect(resumed.metadata.sessionId).toBe(first.metadata.sessionId)

      // A second tree (different root) keeps its own counter.
      const { chat: otherRoot, assistant: otherAssistant } = yield* seed("Other tree")
      const other = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: otherRoot.id, messageID: otherAssistant.id, promptOps: stubOps() }),
      )
      expect((yield* sessions.get(other.metadata.sessionId)).parentID).toBe(otherRoot.id)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          SubagentLimits.__testHooks.treeLimit = undefined
        }),
      ),
    ),
  )

  it.instance("enforces the cap atomically under parallel spawns (lost-update race)", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.treeLimit = 3
      const sessions = yield* Session.Service
      // Production session creation does real async I/O; the in-process test
      // create is effectively synchronous, so the racers would never yield
      // inside the gate window here. Reinstate the async boundary
      // deterministically: every racer reaches `create` (and thus passed the
      // gate) before any create completes — the exact lost-update window.
      const wrapped: typeof sessions = {
        ...sessions,
        create: (input) => Effect.yieldNow.pipe(Effect.andThen(sessions.create(input))),
      }
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool.pipe(Effect.provideService(Session.Service, wrapped))
      const def = yield* tool.init()
      const promptOps = stubOps()

      // 5 spawns race through the gate: the reservation must be a synchronous
      // check-and-set so EXACTLY treeLimit succeed. The pre-fix sequence
      // (read started → async sessions.create → set started+1) let every
      // racer read the same stale count and systematically undercount.
      const exits = yield* Effect.all(
        Array.from({ length: 5 }, () =>
          def
            .execute(taskParams, taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }))
            .pipe(Effect.exit),
        ),
        { concurrency: "unbounded" },
      )

      const refused = exits.filter((exit) => defectOf(exit) instanceof SubagentLimits.SubagentTreeLimitError)
      expect(exits.filter(Exit.isSuccess)).toHaveLength(3)
      expect(refused).toHaveLength(2)
      // Exactly the cap's worth of child sessions exist...
      expect(yield* sessions.children(chat.id)).toHaveLength(3)
      // ...and the counter settled AT the limit: the next spawn reports 3/3.
      const followUp = yield* def
        .execute(taskParams, taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }))
        .pipe(Effect.exit)
      const error = defectOf(followUp)
      expect(error).toBeInstanceOf(SubagentLimits.SubagentTreeLimitError)
      expect((error as SubagentLimits.SubagentTreeLimitError).started).toBe(3)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          SubagentLimits.__testHooks.treeLimit = undefined
        }),
      ),
    ),
  )

  it.instance("releases the reserved slot again when session creation fails", () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.treeLimit = 1
      const real = yield* Session.Service
      let explode = false
      const wrapped: typeof real = {
        ...real,
        create: (input) => (explode ? Effect.die(new Error("injected create failure")) : real.create(input)),
      }
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool.pipe(Effect.provideService(Session.Service, wrapped))
      const def = yield* tool.init()
      const promptOps = stubOps()

      // The reservation happens BEFORE sessions.create; when create dies the
      // slot must be released again or the failed attempt eats the cap.
      explode = true
      const failed = yield* def
        .execute(taskParams, taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }))
        .pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(defectOf(failed)).not.toBeInstanceOf(SubagentLimits.SubagentTreeLimitError)
      expect(yield* real.children(chat.id)).toHaveLength(0)

      // The tree's single slot is still available after the failed create.
      explode = false
      const result = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }),
      )
      expect((yield* real.get(result.metadata.sessionId)).parentID).toBe(chat.id)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          SubagentLimits.__testHooks.treeLimit = undefined
        }),
      ),
    ),
  )
})

describe("tool.task root routing", () => {
  it.instance("stamps the tree root into job metadata and routes permissions to it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chain, deepest, assistant } = yield* seedChain(3)
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: deepest.id, messageID: assistant.id, promptOps }),
      )

      // T4.1: permission asks bubble to the ROOT of the tree, not the spawner.
      expect(seen?.permissionSessionID).toBe(chain[0]!.id)
      // T2.4: the job metadata carries the root id next to the parent id.
      expect(result.metadata.rootSessionId).toBe(chain[0]!.id)
      expect(result.metadata.parentSessionId).toBe(deepest.id)
      const job = yield* jobs.get(result.metadata.sessionId)
      expect(job?.metadata?.rootSessionId).toBe(chain[0]!.id)
      expect(job?.metadata?.parentSessionId).toBe(deepest.id)
    }),
  )

  it.instance("keeps root spawns byte-compatible: root id equals the caller id", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(taskParams, taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }))

      expect(seen?.permissionSessionID).toBe(chat.id)
      expect(result.metadata.rootSessionId).toBe(chat.id)
      expect((yield* jobs.get(result.metadata.sessionId))?.metadata?.rootSessionId).toBe(chat.id)
    }),
  )
})

describe("tool.task turn budget", () => {
  it.instance("threads the shared turn budget pool by reference into the child prompt", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const pool = TurnBudget.make({ usd: 5 })
      let seen: Parameters<TaskPromptOps["prompt"]>[0] | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      yield* def.execute(
        taskParams,
        taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps, extra: { turnBudget: pool } }),
      )

      // Reference identity, not a copy: every level charges the same pool.
      expect(seen?.turnBudgetPool).toBe(pool)
    }),
  )

  it.instance("leaves the pool unset when the turn has no budget", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: Parameters<TaskPromptOps["prompt"]>[0] | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      yield* def.execute(taskParams, taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps }))

      expect(seen?.turnBudgetPool).toBeUndefined()
    }),
  )

  it.instance("refuses NEW spawns when the pool is exhausted but still resumes children", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const usdPool = TurnBudget.make({ usd: 1 })
      TurnBudget.chargeDirect(usdPool, { usd: 1 })
      const exit = yield* def
        .execute(
          taskParams,
          taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps: stubOps(), extra: { turnBudget: usdPool } }),
        )
        .pipe(Effect.exit)
      expect(defectOf(exit)).toBeInstanceOf(SubagentLimits.SubagentBudgetError)

      const tokenPool = TurnBudget.make({ tokens: 100 })
      TurnBudget.chargeDirect(tokenPool, { usd: 0, tokens: 100 })
      const tokenExit = yield* def
        .execute(
          taskParams,
          taskCtx({
            sessionID: chat.id,
            messageID: assistant.id,
            promptOps: stubOps(),
            extra: { turnBudget: tokenPool },
          }),
        )
        .pipe(Effect.exit)
      expect(defectOf(tokenExit)).toBeInstanceOf(SubagentLimits.SubagentBudgetError)

      // No new session was created by the gated attempts.
      expect(yield* sessions.children(chat.id)).toHaveLength(1)

      // Soft cap: resuming the running child is still allowed.
      const resumed = yield* def.execute(
        { ...taskParams, task_id: child.id },
        taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps: stubOps(), extra: { turnBudget: usdPool } }),
      )
      expect(resumed.metadata.sessionId).toBe(child.id)
    }),
  )

  it.instance("spawns while the pool still has headroom", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const pool = TurnBudget.make({ usd: 2 })
      TurnBudget.chargeDirect(pool, { usd: 1 })

      const result = yield* def.execute(
        taskParams,
        taskCtx({ sessionID: chat.id, messageID: assistant.id, promptOps: stubOps(), extra: { turnBudget: pool } }),
      )
      expect((yield* sessions.get(result.metadata.sessionId)).parentID).toBe(chat.id)
    }),
  )
})
