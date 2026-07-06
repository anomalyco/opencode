import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { jsonSchema } from "ai"
import { LLMRequestPrep } from "@/session/llm/request"

const sessionID = "test-session-123"

const model = {
  id: "openai/gpt-4",
  providerID: "openai",
  api: {
    id: "gpt-4",
    npm: "@ai-sdk/openai",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
  },
  limit: { output: 4096 },
  options: {},
  headers: {},
} as any

type RequestHookOutput = {
  system: string[]
  messages: Array<{ role: string; content: string }>
  headers: Record<string, string>
  params: {
    options: Record<string, unknown>
  }
}

describe("LLMRequestPrep.prepare", () => {
  test("runs model request hook before provider execution", async () => {
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: "msg_user-test",
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "openai", modelID: "gpt-4" },
        } as any,
        sessionID,
        model,
        agent: {
          name: "test",
          prompt: "system",
          mode: "primary",
          options: {},
          permission: [],
        } as any,
        system: [],
        messages: [{ role: "user", content: "secret@example.com" }],
        tools: {
          lookup: {
            description: "Look up a value",
            inputSchema: jsonSchema({ type: "object", properties: {} }),
          },
        },
        provider: { id: "openai", options: {} } as any,
        auth: undefined,
        plugin: {
          trigger: (name: string, _input: unknown, output: unknown) => {
            if (name !== "model.request.before") return Effect.succeed(output)
            const request = output as RequestHookOutput
            request.system = ["redacted system"]
            request.messages = [{ role: "user", content: "[redacted]" }]
            request.headers["x-redacted"] = "1"
            request.params.options.redacted = true
            return Effect.succeed(output)
          },
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        } as any,
        flags: { outputTokenMax: 32_000, client: "test" } as any,
        isWorkflow: false,
      }),
    )

    expect(result.system).toEqual(["redacted system"])
    expect(result.messages).toEqual([{ role: "user", content: "[redacted]" }])
    expect((result.headers as Record<string, string>)["x-redacted"]).toBe("1")
    expect(result.params.options.redacted).toBe(true)
    expect(result.messageTransformOptions.redacted).toBe(true)
    expect(result.tools.lookup.strict).toBe(false)
  })
})
