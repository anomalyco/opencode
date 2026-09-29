import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { createOpenaiCompatible } from "@opencode/core/github-copilot/copilot-provider"
import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { it } from "../lib/effect"

const models = [
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6-astra",
  "gpt-5.6-luna",
  "gpt-5-chat-latest",
  "o1-mini",
  "o1-preview",
  "future-model",
]

const options = [
  { reasoningEffort: "max", reasoningSummary: "auto", serviceTier: "flex" },
  { reasoningEffort: "future-effort", serviceTier: "priority" },
  { reasoningSummary: "detailed" },
  {},
]

// #51850: supplied settings must reach Copilot without model-name capability guesses.
for (const modelID of models) {
  for (const mode of ["generate", "stream"] as const) {
    for (const settings of options) {
      it.live(`${modelID} ${mode} preserves supplied settings ${JSON.stringify(settings)}`, () =>
        Effect.gen(function* () {
          const requests: Array<Record<string, unknown>> = []
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                async fetch(request) {
                  const body = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
                    await request.json(),
                  )
                  requests.push(body)
                  const response = {
                    id: "resp_fixture",
                    created_at: 0,
                    model: modelID,
                    output: [],
                    usage: { input_tokens: 1, output_tokens: 1 },
                  }
                  if (body.stream !== true) return Response.json(response)
                  return new Response(`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`, {
                    headers: { "Content-Type": "text/event-stream" },
                  })
                },
              }),
            ),
            (server) => Effect.sync(() => server.stop(true)),
          )
          const model = createOpenaiCompatible({ baseURL: server.url.href.replace(/\/$/, "") }).responses(modelID)
          const input: LanguageModelV3CallOptions = {
            prompt: [
              { role: "system", content: "System instruction" },
              { role: "user", content: [{ type: "text", text: "Hello" }] },
            ],
            temperature: 0.25,
            topP: 0.9,
            providerOptions: { copilot: settings },
          }
          const warnings = yield* Effect.promise(async () => {
            if (mode === "generate") return (await model.doGenerate(input)).warnings
            const response = await model.doStream(input)
            const events = []
            for await (const event of response.stream) events.push(event)
            return events.find((event) => event.type === "stream-start")?.warnings
          })

          expect(requests).toHaveLength(1)
          expect(requests[0]).toMatchObject({
            model: modelID,
            temperature: 0.25,
            top_p: 0.9,
            input: [
              { role: "system", content: "System instruction" },
              { role: "user", content: [{ type: "input_text", text: "Hello" }] },
            ],
            include: ["reasoning.encrypted_content"],
            store: false,
          })
          expect(requests[0]?.reasoning).toEqual(
            settings.reasoningEffort !== undefined || settings.reasoningSummary !== undefined
              ? {
                  ...(settings.reasoningEffort !== undefined ? { effort: settings.reasoningEffort } : {}),
                  ...(settings.reasoningSummary !== undefined ? { summary: settings.reasoningSummary } : {}),
                }
              : undefined,
          )
          expect(requests[0]?.service_tier).toBe(settings.serviceTier)
          expect(requests[0]?.stream).toBe(mode === "stream" ? true : undefined)
          expect(warnings).toEqual([])
        }),
      )
    }
  }
}
