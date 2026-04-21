import { describe, expect, spyOn, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import { getMessageStats } from "../../src/cli/cmd/tui/feature-plugins/sidebar/context"

void Log.init({ print: false })

describe("stats command", () => {
  test("counts messages for the sidebar context box", () => {
    expect(getMessageStats([{ role: "user" }, { role: "assistant" }, { role: "assistant" }])).toEqual({
      total: 3,
      user: 1,
      assistant: 2,
    })
  })

  test(
    "counts user and assistant messages separately",
    async () => {
    await using tmp = await tmpdir({ git: true })

    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({ title: "stats test" }))),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const user1 = MessageID.ascending()
        const user2 = MessageID.ascending()

        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updateMessage({
              id: user1,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test" },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info),
          ),
        )

        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updateMessage({
              id: user2,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test" },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info),
          ),
        )

        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updateMessage({
              id: MessageID.ascending(),
              sessionID: session.id,
              role: "assistant",
              time: { created: Date.now() },
              parentID: user1,
              modelID: "test-model" as never,
              providerID: "test-provider" as never,
              mode: "",
              agent: "default",
              path: { cwd: "/", root: "/" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            } as unknown as MessageV2.Info),
          ),
        )
      },
    })

    const { aggregateSessionStats, displayStats } = await import("../../src/cli/cmd/stats")
    const stats = await aggregateSessionStats()

    expect(stats.totalMessages).toBe(3)
    expect(stats.userMessages).toBe(2)
    expect(stats.assistantMessages).toBe(1)

    const logs = spyOn(console, "log").mockImplementation(() => {})
    displayStats(stats)

    const output = logs.mock.calls.map((call) => String(call[0]))
    expect(output.some((line) => line.includes("User Messages"))).toBe(true)
    expect(output.some((line) => line.includes("Assistant Messages"))).toBe(true)
    logs.mockRestore()
    },
    { timeout: 30000 },
  )
})
