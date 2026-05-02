import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { BackgroundJob } from "@/background/job"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Bus.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    BackgroundJob.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

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
  const assistant: MessageV2.Assistant = {
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
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(
  session: Session.Interface,
  opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string; wait?: Effect.Effect<void> },
): TaskPromptOps {
  return {
    cancel() {},
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.gen(function* () {
        opts?.onPrompt?.(input)
        if (opts?.wait) yield* opts.wait
        const userID = input.messageID ?? MessageID.ascending()
        const user: MessageV2.User = {
          id: userID,
          role: "user",
          sessionID: input.sessionID,
          agent: input.agent ?? "build",
          model: input.model ?? ref,
          tools: input.tools,
          time: { created: Date.now() },
        }
        yield* session.updateMessage(user)

        const parts = input.parts.map((part) => ({
          ...part,
          id: part.id ?? PartID.ascending(),
          messageID: user.id,
          sessionID: input.sessionID,
        }))
        yield* Effect.forEach(parts, (part) => session.updatePart(part), { discard: true })

        if (input.noReply) {
          return {
            info: user,
            parts,
          }
        }

        const result = reply({ ...input, messageID: user.id }, opts?.text ?? "done")
        yield* session.updateMessage(result.info)
        yield* Effect.forEach(result.parts, (part) => session.updatePart(part), { discard: true })
        return result
      }),
    loop: (input) =>
      Effect.sync(() =>
        reply(
          {
            sessionID: input.sessionID,
            messageID: MessageID.ascending(),
            agent: "build",
            model: ref,
            parts: [],
          },
          opts?.text ?? "done",
        ),
      ),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
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
  it.live("description sorts subagents by name and is stable across calls", () =>
    provideTmpdirInstance(
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
    ),
  )

  it.live("description hides denied subagents for the caller", () =>
    provideTmpdirInstance(
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
    ),
  )

  it.live("execute resumes an existing task session from task_id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps(sessions, { text: "resumed", onPrompt: (input) => (seen = input) })

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
        expect(result.output).toContain(`task_id: ${child.id}`)
        expect(seen?.sessionID).toBe(child.id)
      }),
    ),
  )

  it.live("execute asks by default and skips checks when bypassed", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const calls: unknown[] = []
        const promptOps = stubOps(sessions)

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
    ),
  )

  it.live("execute creates a child when task_id does not exist", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps(sessions, { text: "created", onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_id: SessionID.make("ses_missing"),
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
        expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
        expect(seen?.sessionID).toBe(result.metadata.sessionId)
      }),
    ),
  )

  it.live("execute shapes child permissions for task, todowrite, and primary tools", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps(sessions, { onPrompt: (input) => (seen = input) })

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
          expect(child.permission).toEqual([
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "bash",
              pattern: "*",
              action: "allow",
            },
            {
              permission: "read",
              pattern: "*",
              action: "allow",
            },
          ])
          expect(seen?.tools).toEqual({
            todowrite: false,
            bash: false,
            read: false,
          })
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
    ),
  )

  it.live("execute launches background tasks without waiting for completion", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const jobs = yield* BackgroundJob.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const latch = yield* Deferred.make<void>()

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
              promptOps: stubOps(sessions, { wait: Deferred.await(latch) }),
            },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.metadata.sessionId).toBeDefined()
        expect(result.metadata.background).toBe(true)
        expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
        expect(result.output).toContain("state: running")
        expect((yield* jobs.get(result.metadata.sessionId))?.status).toBe("running")

        yield* Deferred.succeed(latch, undefined)
        expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.status).toBe("completed")
      }),
    ),
  )

  it.live("background tasks inject completion into the parent session and resume when idle", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const jobs = yield* BackgroundJob.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const loops: string[] = []

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
                ...stubOps(sessions, { text: "background done" }),
                loop(input) {
                  loops.push(input.sessionID)
                  return Effect.sync(() =>
                    reply(
                      {
                        sessionID: input.sessionID,
                        messageID: MessageID.ascending(),
                        agent: "build",
                        model: ref,
                        parts: [],
                      },
                      "looped",
                    ),
                  )
                },
              } satisfies TaskPromptOps,
            },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.status).toBe("completed")

        const parent = yield* sessions.findMessage(chat.id, (msg) => msg.info.role === "user")
        expect(parent._tag).toBe("Some")
        if (parent._tag !== "Some") return
        expect(parent.value.parts.find((part) => part.type === "text")?.text).toContain("Background task completed")
        expect(parent.value.parts.find((part) => part.type === "text")?.text).toContain("background done")
        expect(loops).toEqual([chat.id])

        const child = yield* sessions.findMessage(result.metadata.sessionId, (msg) => msg.info.role === "assistant")
        expect(child._tag).toBe("Some")
        if (child._tag !== "Some") return
        expect(child.value.parts.find((part) => part.type === "text")?.text).toBe("background done")
      }),
    ),
  )
})
