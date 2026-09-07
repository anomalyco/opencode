import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient, ImageInput, LLM, LLMEvent, LLMRequest, Message, ToolDefinition } from "../../src/index.js"
import { Meta } from "../../src/providers/meta.js"
import { MetaMessages } from "../../src/protocols/meta-messages.js"
import { AnthropicMessages } from "../../src/protocols/anthropic-messages.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

it.effect("Meta selects Messages and lowers native search alongside ordinary functions", () =>
  Effect.gen(function* () {
    const model = Meta.messagesModel("muse-spark-1.3", { apiKey: "fixture", baseURL: "https://gateway.example/v1" })
    expect(model.route.endpoint).toMatchObject({ baseURL: "https://gateway.example/v1", path: "/messages" })
    expect(MetaMessages.protocol.stream).toBe(AnthropicMessages.protocol.stream)
    const compiled = yield* compileRequest(
      LLM.request({
        model,
        prompt: "Search",
        tools: [
          Meta.webSearch({ userLocation: { country: "US" } }),
          ToolDefinition.make({ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }),
        ],
        providerOptions: { effort: "low" },
        generation: { maxTokens: 1024 },
      }),
    )
    expect(compiled.body).toMatchObject({
      max_tokens: 1024,
      thinking: { type: "adaptive", display: "omitted" },
      output_config: { effort: "low" },
      tools: [
        { type: "web_search", name: "web_search", user_location: { type: "approximate", country: "US" } },
        { name: "lookup", description: "Lookup", input_schema: { type: "object" } },
      ],
    })
    const entrypoint = yield* Effect.promise(() => import("@opencode-ai/ai/providers/meta/messages"))
    expect(entrypoint.model("muse-spark-1.3", {}).route.id).toBe("meta-messages")
  }),
)

it.effect("Meta rejects unsupported native tools instead of sending them as local functions", () =>
  Effect.gen(function* () {
    for (const input of [
      {
        model: Meta.responses("muse-spark-1.3"),
        tool: ToolDefinition.make({
          name: "foreign",
          description: "Foreign tool",
          inputSchema: {},
          native: { other: { type: "web_search" } },
        }),
      },
      { model: Meta.messages("muse-spark-1.3"), tool: Meta.imageGeneration() },
      { model: Meta.messages("muse-spark-1.3"), tool: Meta.webSearch({ searchContextSize: "low" }) },
    ]) {
      const error = yield* compileRequest(
        LLM.request({ model: input.model, prompt: "Hello", tools: [input.tool] }),
      ).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
    }
  }),
)

it.effect("Meta Images preserves request overlays, bearer auth, JSON edit inputs and URL output formats", () =>
  Effect.gen(function* () {
    const response = yield* Image.generate({
      model: Meta.configure({
        apiKey: "fixture",
        baseURL: "https://gateway.example/v1",
        headers: { "x-client": "test" },
      }).image("muse-image-1.0"),
      prompt: "Edit",
      images: [ImageInput.bytes(Uint8Array.from([1, 2, 3]), "image/png")],
      options: {
        outputFormat: "webp",
        responseFormat: "url",
        reasoningStrength: "low",
        toolEnablement: { enable_web_search: false },
        output_format: "png",
      },
      http: { body: { output_format: "jpeg" }, query: { trace: "1" } },
    })
    expect(response.image?.mediaType).toBe("image/jpeg")
    expect(response.image?.data).toBe("https://images.example/result.jpg")
  }).pipe(
    Effect.provide(
      ImageClient.layer.pipe(
        Layer.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(request.url).toBe("https://gateway.example/v1/images/edits?trace=1")
              expect(input.request.headers.authorization).toBe("Bearer fixture")
              expect(input.request.headers["x-client"]).toBe("test")
              expect(JSON.parse(input.text)).toEqual({
                model: "muse-image-1.0",
                prompt: "Edit",
                images: [{ image_url: "data:image/png;base64,AQID" }],
                output_format: "jpeg",
                response_format: "url",
                reasoning_strength: "low",
                tool_enablement: { enable_web_search: false },
              })
              return input.respond(
                JSON.stringify({ output_format: "jpeg", data: [{ url: "https://images.example/result.jpg" }] }),
                { headers: { "content-type": "application/json" } },
              )
            }),
          ),
        ),
      ),
    ),
  ),
)

for (const streamed of [false, true]) {
  it.effect(
    `Meta recovers terminal image output ${streamed ? "without duplicating streamed items" : "with its signed replay handle"}`,
    () =>
      Effect.gen(function* () {
        const item = { type: "image_generation_call", id: "ig_signed", status: "completed", result: "iVBORw0KGgo=" }
        const request = LLM.request({
          model: Meta.configure({ apiKey: "fixture" }).responses("muse-image-1.0"),
          prompt: "Draw",
        })
        const response = yield* LLM.generate(request).pipe(
          Effect.provide(
            fixedResponse(
              sseEvents(
                { type: "response.created", response: { id: "resp_image" } },
                ...(streamed
                  ? [
                      { type: "response.output_item.added", output_index: 0, item },
                      { type: "response.output_item.done", output_index: 0, item },
                    ]
                  : []),
                { type: "response.completed", response: { id: "resp_image", output: [item] } },
              ),
            ),
          ),
        )
        expect(response.events.filter(LLMEvent.is.toolResult)).toHaveLength(1)
        expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
        expect(response.events.filter(LLMEvent.is.toolResult)[0]?.result).toEqual({
          type: "content",
          value: [{ type: "file", mime: "image/png", uri: "data:image/png;base64,iVBORw0KGgo=" }],
        })
        const replay = yield* compileRequest(
          LLMRequest.update(request, { messages: [...request.messages, response.message, Message.user("Edit")] }),
        )
        expect(replay.body.input).toContainEqual({
          type: "image_generation_call",
          id: "ig_signed",
          status: "completed",
          result: null,
        })
      }),
  )
}

it.effect("Meta rejects malformed image data from terminal-only Responses output", () =>
  Effect.gen(function* () {
    const error = yield* LLM.generate(
      LLM.request({ model: Meta.configure({ apiKey: "fixture" }).responses("muse-image-1.0"), prompt: "Draw" }),
    ).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents({
            type: "response.completed",
            response: {
              id: "resp_invalid",
              output: [{ type: "image_generation_call", id: "ig_invalid", result: "!not-base64!" }],
            },
          }),
        ),
      ),
      Effect.flip,
    )
    expect(error.reason._tag).toBe("InvalidProviderOutput")
  }),
)
