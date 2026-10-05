import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM, Message, ToolNamespace } from "../../src/index.js"
import { DigitalOcean } from "../../src/providers/digitalocean.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

describe("DigitalOcean native APIs", () => {
  it.effect("keeps effort overlays working when the API is overridden", () =>
    Effect.gen(function* () {
      const fromMessages = DigitalOcean.configure({ apiKey: "fixture", providerOptions: { effort: "high" } })
      const fromResponses = DigitalOcean.configure({ apiKey: "fixture", providerOptions: { reasoningEffort: "high" } })
      const chat = yield* compileRequest(
        LLM.request({ model: fromMessages.chat("anthropic-claude-sonnet-5.5"), prompt: "Hello" }),
      )
      const responses = yield* compileRequest(
        LLM.request({ model: fromMessages.responses("anthropic-claude-sonnet-5.5"), prompt: "Hello" }),
      )
      const messages = yield* compileRequest(
        LLM.request({ model: fromResponses.messages("openai-gpt-5-nano"), prompt: "Hello" }),
      )
      expect(chat.body).toMatchObject({ reasoning_effort: "high" })
      expect(responses.body).toMatchObject({ reasoning: { effort: "high" } })
      expect(messages.body).toMatchObject({ output_config: { effort: "high" } })
    }),
  )

  test("defaults Claude to Messages and other models to Responses", () => {
    const provider = DigitalOcean.configure({ apiKey: "fixture" })
    for (const id of ["anthropic-claude-sonnet-5.5", "anthropic-claude-haiku-4.5", "claude-opus-4-8"]) {
      expect(provider.model(id).route.id).toBe("digitalocean-messages")
      expect(provider.model(id).route.endpoint.path).toBe("/messages")
    }
    for (const id of ["openai-gpt-6-1-sol", "openai-gpt-5-nano", "kimi-k3", "qwen3.8-max", "router:default"]) {
      expect(provider.model(id).route.id).toBe("digitalocean-responses")
    }
    expect(provider.chat("anthropic-claude-sonnet-5.5").route.id).toBe("digitalocean")
    expect(provider.responses("anthropic-claude-sonnet-5.5").route.id).toBe("digitalocean-responses")
    expect(provider.messages("openai-gpt-6-1-sol").route.id).toBe("digitalocean-messages")
  })

  it.effect("compiles native Messages thinking, effort, and automatic cache markers", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: DigitalOcean.configure({
          apiKey: "fixture",
          providerOptions: { effort: "high", thinking: { type: "adaptive", display: "summarized" } },
        }).model("anthropic-claude-sonnet-5.5"),
        system: "Be concise.",
        prompt: "Hello",
      })
      const compiled = yield* compileRequest(request)
      expect(compiled.body).toMatchObject({
        model: "anthropic-claude-sonnet-5.5",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
        system: [{ text: "Be concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ text: "Hello", cache_control: { type: "ephemeral" } }] }],
      })
      expect(compiled.body.tool_choice).toBeUndefined()
    }),
  )

  it.effect("preserves native Responses namespaces without forcing tool choice", () =>
    Effect.gen(function* () {
      const compiled = yield* compileRequest(
        LLM.request({
          model: DigitalOcean.configure({ apiKey: "fixture" }).model("openai-gpt-5.4-nano"),
          prompt: "Look up the weather.",
          tools: [
            ToolNamespace.make({
              name: "weather",
              description: "Weather tools",
              tools: [
                { name: "lookup", description: "Look up weather", inputSchema: { type: "object", properties: {} } },
              ],
            }),
          ],
        }),
      )
      expect(compiled.body).toMatchObject({
        model: "openai-gpt-5.4-nano",
        store: false,
        include: ["reasoning.encrypted_content"],
        tools: [{ type: "namespace", name: "weather", tools: [{ type: "function", name: "lookup" }] }],
      })
      expect(compiled.body.tool_choice).toBeUndefined()
    }),
  )

  it.effect("emits chronological effort updates only on supported Responses models", () =>
    Effect.gen(function* () {
      for (const id of [
        "openai-gpt-6-1-sol",
        "openai-gpt-7-sol",
        "openai-gpt-10.2-sol",
        "openai-gpt-54-nano",
        "openai-gpt-5.4-nano",
      ]) {
        const compiled = yield* compileRequest(
          LLM.request({
            model: DigitalOcean.configure({
              apiKey: "fixture",
              providerOptions: { reasoningEffort: "high" },
            }).responses(id),
            messages: [
              Message.user("Hello"),
              Message.assistant("Hi"),
              Message.effort({ previous: "low", effort: "high" }),
              Message.user("Continue"),
            ],
          }),
        )
        if (id !== "openai-gpt-5.4-nano" && id !== "openai-gpt-54-nano") {
          expect(compiled.body).toMatchObject({
            reasoning: { effort: "low" },
            input: expect.arrayContaining([{ type: "configuration_update", reasoning: { effort: "high" } }]),
          })
          continue
        }
        expect(compiled.body).toMatchObject({ reasoning: { effort: "high" } })
        expect(JSON.stringify(compiled.body)).not.toContain("configuration_update")
      }
    }),
  )

  it.effect("keeps rejected effort markers out while delivering native system updates", () =>
    Effect.gen(function* () {
      const compiled = yield* compileRequest(
        LLM.request({
          model: DigitalOcean.configure({ apiKey: "fixture", providerOptions: { effort: "high" } }).messages(
            "anthropic-claude-opus-4.8",
          ),
          messages: [
            Message.user("Hello"),
            Message.assistant("Hi"),
            Message.effort({ previous: "low", effort: "high" }),
            Message.user("Continue"),
            Message.system("New instruction"),
          ],
        }),
      )
      expect(compiled.body).toMatchObject({ output_config: { effort: "high" } })
      expect(compiled.body).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "New instruction" })]),
          }),
        ]),
      })
      expect(JSON.stringify(compiled.body)).not.toContain("<system-update>")
    }),
  )
})
