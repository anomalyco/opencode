import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool } from "../../src/tool/task"
import { TeamTool } from "../../src/tool/team"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.team", () => {
  test("executes child tasks and aggregates outputs", async () => {
    await using tmp = await tmpdir({ git: true })
    const prior = TaskTool.init

    ;(TaskTool as unknown as { init: typeof TaskTool.init }).init = (async (ctx: Parameters<typeof prior>[0]) => {
      const def = await prior(ctx)
      return {
        ...def,
        async execute(input: Parameters<typeof def.execute>[0]) {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return {
            title: input.description,
            metadata: {
              sessionId: SessionID.make("session_child"),
              model: {
                modelID: ModelID.make("gpt-5"),
                providerID: ProviderID.make("openai"),
              },
            },
            output: [
              `task_id: child_${input.subagent_type}`,
              "",
              "<task_result>",
              `ok: ${input.description}`,
              "</task_result>",
            ].join("\n"),
          }
        },
      }
    }) as unknown as typeof TaskTool.init

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const team = await TeamTool.init({ agent: build ?? undefined })
          const calls: string[] = []

          const result = await team.execute(
            {
              description: "parallel checks",
              concurrency: 2,
              tasks: [
                {
                  id: "a",
                  description: "research issue",
                  subagent_type: "explore",
                  prompt: "Find files related to session prompt.",
                },
                {
                  id: "b",
                  description: "read docs",
                  subagent_type: "docs",
                  prompt: "Summarize docs structure.",
                },
              ],
            },
            {
              sessionID: SessionID.make("session_test"),
              messageID: MessageID.make("msg_test"),
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              ask: async (input) => {
                calls.push(input.permission)
              },
            },
          )

          expect(result.title).toBe("parallel checks")
          expect(result.metadata.total).toBe(2)
          expect(result.metadata.successful).toBe(2)
          expect(result.metadata.failed).toBe(0)
          expect(result.metadata.children).toHaveLength(2)
          expect(result.output).toContain("Team summary")
          expect(calls).toHaveLength(2)
        },
      })
    } finally {
      ;(TaskTool as unknown as { init: typeof TaskTool.init }).init = prior
    }
  })

  test("keeps collect-all behavior when a child fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const prior = TaskTool.init

    ;(TaskTool as unknown as { init: typeof TaskTool.init }).init = (async (ctx: Parameters<typeof prior>[0]) => {
      const def = await prior(ctx)
      return {
        ...def,
        async execute(input: Parameters<typeof def.execute>[0]) {
          if (input.description.includes("fail")) throw new Error("boom")
          return {
            title: input.description,
            metadata: {
              sessionId: SessionID.make("session_child"),
              model: {
                modelID: ModelID.make("gpt-5"),
                providerID: ProviderID.make("openai"),
              },
            },
            output: `task_id: child_${input.subagent_type}`,
          }
        },
      }
    }) as unknown as typeof TaskTool.init

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const team = await TeamTool.init({ agent: build ?? undefined })

          const result = await team.execute(
            {
              description: "mixed checks",
              tasks: [
                {
                  id: "ok",
                  description: "good task",
                  subagent_type: "explore",
                  prompt: "ok",
                },
                {
                  id: "bad",
                  description: "fail task",
                  subagent_type: "docs",
                  prompt: "bad",
                },
              ],
            },
            {
              sessionID: SessionID.make("session_test"),
              messageID: MessageID.make("msg_test"),
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              ask: async () => undefined,
            },
          )

          expect(result.metadata.total).toBe(2)
          expect(result.metadata.successful).toBe(1)
          expect(result.metadata.failed).toBe(1)
          expect(result.output).toContain("status: error")
        },
      })
    } finally {
      ;(TaskTool as unknown as { init: typeof TaskTool.init }).init = prior
    }
  })

  test("keeps collect-all behavior when one subagent permission is denied", async () => {
    await using tmp = await tmpdir({ git: true })
    const prior = TaskTool.init

    ;(TaskTool as unknown as { init: typeof TaskTool.init }).init = (async (ctx: Parameters<typeof prior>[0]) => {
      const def = await prior(ctx)
      return {
        ...def,
        async execute(input: Parameters<typeof def.execute>[0]) {
          return {
            title: input.description,
            metadata: {
              sessionId: SessionID.make("session_child"),
              model: {
                modelID: ModelID.make("gpt-5"),
                providerID: ProviderID.make("openai"),
              },
            },
            output: `task_id: child_${input.subagent_type}`,
          }
        },
      }
    }) as unknown as typeof TaskTool.init

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const team = await TeamTool.init({ agent: build ?? undefined })

          const result = await team.execute(
            {
              description: "permission checks",
              tasks: [
                {
                  id: "deny",
                  description: "blocked task",
                  subagent_type: "docs",
                  prompt: "blocked",
                },
                {
                  id: "ok",
                  description: "allowed task",
                  subagent_type: "explore",
                  prompt: "allowed",
                },
              ],
            },
            {
              sessionID: SessionID.make("session_test"),
              messageID: MessageID.make("msg_test"),
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              ask: async (input) => {
                if (input.patterns[0] === "docs") throw new Error("denied docs")
              },
            },
          )

          expect(result.metadata.total).toBe(2)
          expect(result.metadata.successful).toBe(1)
          expect(result.metadata.failed).toBe(1)
          expect(result.output).toContain("denied docs")
        },
      })
    } finally {
      ;(TaskTool as unknown as { init: typeof TaskTool.init }).init = prior
    }
  })
})
