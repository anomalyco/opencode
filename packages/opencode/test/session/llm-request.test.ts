import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMRequestPrep } from "@/session/llm/request"

describe("LLMRequestPrep.prepare", () => {
  const model = {
    id: "openai/gpt-5.4",
    providerID: "openai",
    api: { id: "gpt-5.4", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    name: "gpt-5.4",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  }

  const prepare = (agent: string) => {
    const hooks: string[] = []
    return Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: "msg_user-test",
          sessionID: "ses_test",
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        } as any,
        sessionID: "ses_test",
        model: model as any,
        agent: {
          name: agent,
          mode: "primary",
          prompt: `You are the ${agent} agent.`,
          options: {},
          permission: [],
        } as any,
        system: [],
        messages: [{ role: "user", content: "Hello" }],
        small: false,
        tools: {},
        provider: { id: "openai", options: {} } as any,
        auth: undefined,
        plugin: {
          trigger: (name: string, _input: unknown, output: unknown) => {
            hooks.push(name)
            return Effect.succeed(output)
          },
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        } as any,
        flags: { outputTokenMax: 32_000, client: "test" } as any,
        isWorkflow: false,
      }),
    ).then(() => hooks)
  }

  test("skips experimental.chat.system.transform for the title agent", async () => {
    expect(await prepare("title")).not.toContain("experimental.chat.system.transform")
  })

  test.each(["build", "compaction"])("runs experimental.chat.system.transform for the %s agent", async (agent) => {
    expect(await prepare(agent)).toContain("experimental.chat.system.transform")
  })
})
