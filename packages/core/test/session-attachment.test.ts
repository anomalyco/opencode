import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect, test } from "bun:test"
import { Media, Message } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionAttachment } from "@opencode/core/session/attachment"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { SessionStore } from "@opencode/core/session/store"
import { Skill } from "@opencode/core/skill"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Base64, FileAttachment } from "@opencode/schema/prompt"
import { DateTime, Effect, Layer, LayerMap } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = Model.Ref.make({ id: Model.ID.make("example-model"), providerID: Provider.ID.make("example") })
const other = Model.Ref.make({ id: Model.ID.make("other-model"), providerID: Provider.ID.make("example") })
const usage = { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }

const image = (name: string) =>
  FileAttachment.make({
    data: Base64.make(Buffer.from(name).toString("base64")),
    mime: "image/png",
    source: { type: "inline" },
    name,
  })
const text = FileAttachment.make({
  data: Base64.make(Buffer.from("notes").toString("base64")),
  mime: "text/plain",
  source: { type: "inline" },
  name: "notes.txt",
})

const user = (value: string, files: FileAttachment[], excludedFiles?: number[]) =>
  SessionMessage.User.make({
    id: id(value),
    type: "user",
    text: value,
    files,
    excludedFiles,
    time: { created },
  })

const assistant = (
  value: string,
  input: {
    readonly model?: Model.Ref
    readonly content?: SessionMessage.Assistant["content"]
    readonly tokens?: typeof usage
    readonly error?: SessionMessage.Assistant["error"]
  } = {},
) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model: input.model ?? model,
    content: input.content ?? [],
    tokens: input.tokens,
    error: input.error,
    time: { created, completed: created },
  })

const reader = (callID: string, excludedContent?: number[]) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id: callID,
    name: "read",
    state: {
      status: "completed",
      input: {},
      content: [
        { type: "text", text: "PDF read successfully" },
        { type: "file", uri: "data:application/pdf;base64,JVBERi0=", mime: "application/pdf", name: "/repo/a.pdf" },
      ],
    },
    excludedContent,
    time: { created, completed: created },
  })

describe("SessionAttachment.candidates", () => {
  test("suspects only attachments added since the model last accepted a request", () => {
    const messages = [
      user("first", [image("before.png")]),
      assistant("accepted", { content: [reader("call-read")] }),
      assistant("rejected", { error: { type: SessionAttachment.REJECTED, message: "Rejected" } }),
      user("second", [image("after.png"), text]),
    ]

    expect(SessionAttachment.candidates(messages, model)).toEqual([
      { messageID: id("accepted"), callID: "call-read", index: 1, mime: "application/pdf", name: "/repo/a.pdf" },
      { messageID: id("second"), index: 0, mime: "image/png", name: "after.png" },
    ])
  })

  test("treats usage without output as acceptance", () => {
    const messages = [user("first", [image("before.png")]), assistant("empty", { tokens: usage })]

    expect(SessionAttachment.candidates(messages, model)).toEqual([])
  })

  test("suspects every attachment when the model has never accepted one", () => {
    const messages = [
      user("first", [image("one.png")]),
      assistant("other-model", { model: other, content: [reader("call-read")] }),
      user("second", [image("two.png")]),
    ]

    expect(SessionAttachment.candidates(messages, model).map((candidate) => candidate.name)).toEqual([
      "one.png",
      "/repo/a.pdf",
      "two.png",
    ])
  })

  test("leaves out excluded attachments", () => {
    const messages = [
      user("first", [image("one.png"), image("two.png")], [0]),
      assistant("tool", { content: [reader("call-read", [1])], error: { type: "x", message: "x" } }),
    ]

    expect(SessionAttachment.candidates([messages[0]], model).map((candidate) => candidate.name)).toEqual(["two.png"])
    expect(SessionAttachment.unknown(messages, [{ messageID: id("first"), index: 0 }])).toEqual([])
    expect(
      SessionAttachment.unknown(messages, [
        { messageID: id("first"), index: 2 },
        { messageID: id("tool"), callID: "call-read", index: 0 },
      ]),
    ).toHaveLength(2)
  })

  test("names suspects only in rejection errors", () => {
    const suspects = SessionAttachment.candidates([user("first", [image("bad.png")])], model)

    expect(SessionAttachment.describe({ type: SessionAttachment.REJECTED, message: "Rejected" }, suspects)).toEqual({
      type: SessionAttachment.REJECTED,
      message: "Rejected\nAttachments the model has not accepted yet: bad.png (image/png)",
    })
    expect(SessionAttachment.describe({ type: "provider.invalid-request", message: "Bad" }, suspects)).toEqual({
      type: "provider.invalid-request",
      message: "Bad",
    })
  })
})

describe("excluded attachments in model requests", () => {
  test("replace excluded user files with a note and keep the rest", () => {
    const [lowered] = toLLMMessages([user("prompt", [image("bad.png"), image("good.png"), text], [0])], model)

    expect(lowered?.content).toEqual([
      Message.text("prompt"),
      Message.text(
        '[Attachment omitted: "bad.png" (image/png). The model provider rejected a request that included it, so the user chose to continue without it. Its contents are not available; tell the user if you need them.]',
      ),
      { type: "media", media: Media.base64(image("good.png").data, "image/png"), filename: "good.png" },
      expect.objectContaining({ type: "text", text: expect.stringContaining("Attached file: notes.txt") }),
    ])
  })

  test("replace excluded tool result files without changing other results", () => {
    const messages = toLLMMessages(
      [
        assistant("tools", {
          content: [
            reader("call-bad", [1]),
            reader("call-good"),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call-error",
              name: "read",
              state: {
                status: "error",
                input: {},
                error: { type: "tool.execution", message: "Partial" },
                content: [{ type: "file", uri: "data:image/png;base64,AA==", mime: "image/png" }],
              },
              excludedContent: [0],
              time: { created, completed: created },
            }),
          ],
        }),
      ],
      model,
    )
    const results = messages.flatMap((message) => message.content.filter((part) => part.type === "tool-result"))

    expect(results.map((part) => part.result)).toEqual([
      {
        type: "content",
        value: [
          { type: "text", text: "PDF read successfully" },
          { type: "text", text: expect.stringContaining('[Attachment omitted: "/repo/a.pdf" (application/pdf).') },
        ],
      },
      {
        type: "content",
        value: [
          { type: "text", text: "PDF read successfully" },
          { type: "file", uri: "data:application/pdf;base64,JVBERi0=", mime: "application/pdf", name: "/repo/a.pdf" },
        ],
      },
      {
        type: "error",
        value: {
          error: { type: "tool.execution", message: "Partial" },
          content: [{ type: "text", text: expect.stringContaining("[Attachment omitted: image/png.") }],
        },
      },
    ])
  })
})

const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      (_ref: Location.Ref) =>
        // Prompt preparation needs only image normalization and hooks from the location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.mergeAll(
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node])),
          Layer.mock(Skill.Service, { get: () => Effect.undefined, list: () => Effect.succeed([]) }),
          Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
        ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
    ),
  ),
  deps: [],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

describe("Session.excludeAttachments", () => {
  it.effect("projects user file exclusions without changing stored files, and forks keep them", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      })
      const prompt = yield* sessions.prompt({
        sessionID: session.id,
        text: "Compare these",
        files: [
          { uri: PNG, name: "first.png" },
          { uri: PNG, name: "second.png" },
        ],
        resume: false,
      })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")

      expect((yield* sessions.attachments(session.id)).map((candidate) => candidate.name)).toEqual([
        "first.png",
        "second.png",
      ])
      yield* sessions.excludeAttachments({
        sessionID: session.id,
        attachments: [{ messageID: prompt.id, index: 1 }],
        resume: false,
      })

      const [stored] = yield* sessions.context(session.id)
      expect(stored).toMatchObject({ type: "user", excludedFiles: [1] })
      expect(stored?.type === "user" ? stored.files?.map((file) => file.name) : []).toEqual(["first.png", "second.png"])
      expect((yield* sessions.attachments(session.id)).map((candidate) => candidate.name)).toEqual(["first.png"])

      const forked = yield* sessions.fork({ sessionID: session.id })
      expect(yield* sessions.context(forked.id)).toEqual([expect.objectContaining({ excludedFiles: [1] })])
    }),
  )
})
