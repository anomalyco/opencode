import { describe, expect, test } from "bun:test"
import { LanguageModel, Message, ToolResultPart } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { Agent } from "@opencode-ai/core/agent"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Image } from "@opencode-ai/core/image"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { boundImages, SessionModelRequest, unsupportedParts } from "@opencode-ai/core/session/model-request"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Tool } from "@opencode-ai/core/tool"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, SessionModelRequest.node, PluginHooks.node]), [
    Image.node.replace(Layer.mock(Image.Service, { normalize: (_, content) => Effect.succeed(content) })),
  ]),
)

it.effect("isolates nested context-hook tool schemas from registry catalogs and subsequent requests", () =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const hooks = yield* PluginHooks.Service
    const requests = yield* SessionModelRequest.Service
    const input = { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
    yield* registry.transform((draft) => {
      const tool = { name: "echo", description: "Echo", input, execute: () => Effect.succeed({ content: "ok" }) }
      draft.add(tool)
      draft.add({ ...tool, name: "direct", options: { codemode: false } })
    })
    const hook = yield* hooks.register("session", "context", (event) =>
      Effect.sync(() => {
        const direct = event.tools.direct
        if (!direct) throw new Error("Missing direct tool")
        Object.assign(direct.input.properties ?? {}, { value: { type: "number" } })
      }),
    )
    const first = yield* registry.snapshot()
    const instructions = yield* readInitial(CodeModeInstructions.make(first.codeModeCatalog))
    const scope = {
      session: Schema.decodeUnknownSync(SessionSchema.Info)({
        id: "ses_schema_isolation",
        projectID: "schema-isolation",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, updated: 0 },
        location: { directory: "/project" },
      }),
      agentID: Agent.ID.make("build"),
      model: SessionRunnerModel.resolved(
        LanguageModel.make({ id: "fixture", provider: "test", route: OpenAIChat.route }),
        { capabilities: capabilities(["text"]), cost: [], limit: { context: 200000, output: 32000 } },
      ),
      tools: first,
    }
    const prepared = yield* requests.prepare({ scope, transcript: { system: [], messages: [] } })
    expect(prepared.request.tools?.find((tool) => tool.name === "direct")?.inputSchema.properties).toEqual({
      value: { type: "number" },
    })
    expect(input.properties.value.type).toBe("string")
    expect(first.definitions.find((tool) => tool.name === "direct")?.inputSchema.properties).toEqual({
      value: { type: "string" },
    })
    yield* hook.dispose
    const second = yield* registry.snapshot()
    expect(yield* readInitial(CodeModeInstructions.make(second.codeModeCatalog))).toEqual(instructions)
    const next = yield* requests.prepare({
      scope: { ...scope, tools: second },
      transcript: { system: [], messages: [] },
    })
    expect(next.request.tools?.find((tool) => tool.name === "direct")?.inputSchema.properties).toEqual({
      value: { type: "string" },
    })
    const search = yield* second.execute({
      sessionID: scope.session.id,
      agent: scope.agentID,
      messageID: SessionMessage.ID.make("msg_schema_isolation"),
      call: { type: "tool-call", id: "search-isolation", name: "execute", input: { code: "return search({})" } },
    })
    expect(search.output).toMatchObject({ output: expect.stringContaining("value: string") })
    expect(instructions.text).toContain("value: string")
  }),
)

describe("SessionModelRequest.unsupportedParts", () => {
  test("replaces unsupported user media with a visible error", () => {
    const messages = unsupportedParts(
      [
        Message.user([
          Message.text("Describe these files"),
          { type: "media", mediaType: "image/png", data: "aGVsbG8=", filename: "logo.png" },
          { type: "media", mediaType: "application/pdf", data: "JVBERg==", filename: "document.pdf" },
        ]),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content).toEqual([
      Message.text("Describe these files"),
      Message.text('ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.'),
      Message.text('ERROR: Cannot read "document.pdf" (this model does not support pdf input). Inform the user.'),
    ])
  })

  test("replaces unsupported media nested in tool results", () => {
    const messages = unsupportedParts(
      [
        Message.tool(
          ToolResultPart.make({
            id: "call_1",
            name: "read",
            result: {
              type: "content",
              value: [
                { type: "text", text: "Image read successfully" },
                { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "logo.png" },
              ],
            },
          }),
        ),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          {
            type: "text",
            text: 'ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.',
          },
        ],
      },
    })
  })

  test("preserves supported media", () => {
    const message = Message.user({ type: "media", mediaType: "image/png", data: "aGVsbG8=" })
    expect(unsupportedParts([message], capabilities(["text", "image"]))[0]?.content).toEqual(message.content)
  })
})

describe("SessionModelRequest.boundImages", () => {
  test("preserves images below the trigger", () => {
    const messages = [Message.user({ type: "media", mediaType: "image/png", data: "aGVsbG8=" })]
    expect(boundImages(messages)).toBe(messages)
  })

  test("replaces oldest images until the retained payload reaches the target", () => {
    const image = "a".repeat(9 * 1024 * 1024)
    const messages = [
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "first.png" }),
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "second.png" }),
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "third.png" }),
    ]
    const result = boundImages(messages)

    expect(result[0]?.content[0]).toMatchObject({ type: "text" })
    expect(result[1]?.content[0]).toMatchObject({ type: "text" })
    expect(result[2]?.content[0]).toMatchObject({ type: "media", filename: "third.png" })
  })

  test("replaces images nested in tool results", () => {
    const image = "a".repeat(13 * 1024 * 1024)
    const result = boundImages([
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [
              { type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png", name: "first.png" },
              { type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png", name: "second.png" },
            ],
          },
        }),
      ),
    ])

    expect(result[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [{ type: "text" }, { type: "file", name: "second.png" }],
      },
    })
  })
})
